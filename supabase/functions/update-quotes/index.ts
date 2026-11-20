// Edge Function: atualiza a cotação das posições de renda variável e grava o valor de mercado do dia.
//
// Quem chama:
//   - o app, com o JWT do usuário logado (botão "Atualizar cotações"): só esse usuário;
//   - o pg_cron, com o cabeçalho x-sync-secret (mesmo segredo da sync-banks): todo mundo que tem posições.
//
// Para cada posição (investment_holdings) busca o preço no Yahoo Finance; para cada investimento cujas
// posições têm preço, grava quantidade × cotação em investment_snapshots na data do pregão.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchQuotes } from './quotes.ts'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } })

function env(name: string) {
  const v = Deno.env.get(name)?.trim()
  if (!v) throw new Error(`Falta o segredo ${name} nas Edge Function secrets.`)
  return v
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl = (n: number) => BRL.format(n).replace(/ /g, ' ')
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })

interface HoldingRow {
  id: number
  user_id: string
  investment_id: number
  ticker: string
  quantity: number | string
  last_price: number | string | null
  priced_at: string | null
  investments: { id: number; name: string; archived: boolean } | null
}

export interface QuoteReport {
  ok: boolean
  /** investimentos com valor de mercado gravado */
  updated: number
  /** tickers cotados com sucesso */
  priced: number
  lines: string[]
  errors: string[]
  mensagem: string
}

async function run(admin: SupabaseClient, userIds: string[] | null): Promise<QuoteReport> {
  let q = admin
    .from('investment_holdings')
    .select('id, user_id, investment_id, ticker, quantity, last_price, priced_at, investments!inner(id, name, archived)')
    .eq('investments.archived', false)
  if (userIds) q = q.in('user_id', userIds)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const holdings = (data ?? []) as unknown as HoldingRow[]

  const lines: string[] = []
  const errors: string[] = []
  if (!holdings.length) {
    lines.push('Nenhuma posição cadastrada. Abra "Posições" num investimento e informe ticker e quantidade.')
    return { ok: true, updated: 0, priced: 0, lines, errors, mensagem: lines.join('\n') }
  }

  const { quotes, errors: quoteErrors } = await fetchQuotes(holdings.map((h) => h.ticker))
  for (const [, msg] of quoteErrors) errors.push(msg)

  // guarda o preço (ou o erro) em cada posição
  for (const h of holdings) {
    const qt = quotes.get(h.ticker)
    const patch = qt ? { last_price: qt.price, priced_at: qt.date, quote_error: null } : { quote_error: quoteErrors.get(h.ticker) ?? 'sem cotação' }
    const { error: e } = await admin.from('investment_holdings').update(patch).eq('id', h.id)
    if (e) errors.push(`${h.ticker}: não consegui gravar a cotação (${e.message})`)
  }

  // valor de mercado por investimento = Σ quantidade × preço (usa o último preço conhecido quando a busca de hoje falhou)
  const byInv = new Map<number, HoldingRow[]>()
  for (const h of holdings) byInv.set(h.investment_id, [...(byInv.get(h.investment_id) ?? []), h])

  let updated = 0
  for (const [investmentId, hs] of byInv) {
    const name = hs[0].investments?.name ?? `#${investmentId}`
    let value = 0
    let date = ''
    const parts: string[] = []
    const noQuote: string[] = []
    const noQty: string[] = []
    for (const h of hs) {
      const qt = quotes.get(h.ticker)
      const price = qt?.price ?? (h.last_price != null ? Number(h.last_price) : null)
      const pricedAt = qt?.date ?? h.priced_at
      const qty = Number(h.quantity)
      if (price == null || !pricedAt) noQuote.push(h.ticker)
      // posição descoberta pelo banco sem quantidade: o valor ficaria incompleto, então espera o usuário preencher
      if (!(qty > 0)) noQty.push(h.ticker)
      if (price == null || !pricedAt || !(qty > 0)) continue
      value += qty * price
      if (pricedAt > date) date = pricedAt
      parts.push(`${h.ticker} ${num(qty)} × ${brl(price)}`)
    }
    if (noQuote.length || noQty.length) {
      const why = [noQuote.length ? `falta cotação de ${noQuote.join(', ')}` : '', noQty.length ? `falta a quantidade de ${noQty.join(', ')} (Posições)` : ''].filter(Boolean).join(' e ')
      errors.push(`${name}: valor não atualizado porque ${why}`)
      continue
    }
    const rounded = Math.round(value * 100) / 100
    const { error: e } = await admin
      .from('investment_snapshots')
      .upsert({ user_id: hs[0].user_id, investment_id: investmentId, date, value: rounded }, { onConflict: 'investment_id,date' })
    if (e) {
      errors.push(`${name}: não consegui gravar o valor (${e.message})`)
      continue
    }
    updated++
    lines.push(`${name}: ${brl(rounded)} em ${date.split('-').reverse().join('/')} (${parts.join(' · ')})`)
  }

  const ok = errors.length === 0
  const mensagem = [...lines, ...errors.map((e) => `⚠ ${e}`)].join('\n') || 'Nada para atualizar.'
  return { ok, updated, priced: quotes.size, lines, errors, mensagem }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { ok: false, mensagem: 'use POST' })

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

    let userIds: string[] | null
    const secret = req.headers.get('x-sync-secret')
    const auth = req.headers.get('authorization')
    if (secret) {
      const { data, error } = await admin.rpc('sync_banks_secret')
      if (error || !data || !timingSafeEqual(String(data), secret)) return json(401, { ok: false, mensagem: 'não autorizado' })
      userIds = null
    } else if (auth?.startsWith('Bearer ')) {
      const { data, error } = await admin.auth.getUser(auth.slice(7))
      if (error || !data.user) return json(401, { ok: false, mensagem: 'não autorizado' })
      userIds = [data.user.id]
    } else return json(401, { ok: false, mensagem: 'não autorizado' })

    const report = await run(admin, userIds)
    console.log(`[quotes] ${userIds ? userIds.join(',') : 'cron'} · ${report.ok ? 'ok' : 'com erros'} · ${report.updated} investimentos, ${report.priced} tickers${report.errors.length ? ` · ${report.errors.join(' | ')}` : ''}`)
    return json(200, report)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[quotes]', message)
    return json(500, { ok: false, mensagem: message })
  }
})

function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
