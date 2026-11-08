// Edge Function: sincroniza os bancos conectados via Open Finance (Pluggy) com os lançamentos do app.
//
// Quem chama:
//   - o app, com o JWT do usuário logado (botão "Sincronizar agora"): sincroniza só esse usuário;
//   - o pg_cron, com o cabeçalho x-sync-secret (segredo guardado no Vault): sincroniza todo mundo que tem itens.
//
// Segredos (Edge Function secrets): PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET (da aplicação demo no dashboard.pluggy.ai).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from '@supabase/supabase-js'
import { Db } from './db.ts'
import { Pluggy } from './pluggy.ts'
import { formatReport, syncBanks, type SyncReport } from './sync.ts'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { ok: false, mensagem: 'use POST' })

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

    // quem está chamando?
    let userIds: string[]
    const secret = req.headers.get('x-sync-secret')
    const auth = req.headers.get('authorization')
    if (secret) {
      const { data, error } = await admin.rpc('sync_banks_secret')
      if (error || !data || !timingSafeEqual(String(data), secret)) return json(401, { ok: false, mensagem: 'não autorizado' })
      const { data: rows, error: e2 } = await admin.from('open_finance_items').select('user_id')
      if (e2) throw new Error(e2.message)
      userIds = [...new Set((rows ?? []).map((r) => String(r.user_id)))]
    } else if (auth?.startsWith('Bearer ')) {
      const { data, error } = await admin.auth.getUser(auth.slice(7))
      if (error || !data.user) return json(401, { ok: false, mensagem: 'não autorizado' })
      userIds = [data.user.id]
    } else return json(401, { ok: false, mensagem: 'não autorizado' })

    const pluggy = new Pluggy({ clientId: env('PLUGGY_CLIENT_ID'), clientSecret: env('PLUGGY_CLIENT_SECRET') })
    const body = (await req.json().catch(() => ({}))) as { primeiraSincronizacaoDias?: number; reconferirDias?: number }
    const firstSyncDays = Math.min(730, Math.max(1, Number(body.primeiraSincronizacaoDias) || 90))
    // quantos dias antes do último lançamento importado reconferir (padrão 7; maior para reimportar algo apagado)
    const overlapDays = Math.min(730, Math.max(1, Number(body.reconferirDias) || 7))

    const reports: SyncReport[] = []
    for (const userId of userIds) {
      const db = new Db(admin, userId)
      const items = await db.items()
      if (!items.length) {
        reports.push({ ok: true, added: 0, skipped: 0, lines: ['Nenhum banco conectado. Adicione o id de um item do Meu Pluggy.'], errors: [], startedAt: '', finishedAt: '' })
        continue
      }
      const r = await syncBanks(db, pluggy, items, { firstSyncDays, overlapDays })
      console.log(`[sync] ${userId} · ${r.ok ? 'ok' : 'com erros'} · +${r.added} novos, ${r.skipped} já existiam${r.errors.length ? ` · ${r.errors.join(' | ')}` : ''}`)
      reports.push(r)
    }

    const merged: SyncReport = {
      ok: reports.every((r) => r.ok),
      added: reports.reduce((s, r) => s + r.added, 0),
      skipped: reports.reduce((s, r) => s + r.skipped, 0),
      lines: reports.flatMap((r) => r.lines),
      errors: reports.flatMap((r) => r.errors),
      startedAt: reports[0]?.startedAt ?? '',
      finishedAt: new Date().toISOString(),
    }
    return json(200, { ...merged, mensagem: formatReport(merged) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[sync]', message)
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
