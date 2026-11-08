// Servidor HTTP do Duzz Finance na VPS
//   /mcp/<token>  -> MCP (Streamable HTTP) para o Claude (app do iPhone, desktop, Claude Code)
//   /voz          -> recebe um áudio (Atalho do iPhone), transcreve com o Whisper local e lança
//   /sync         -> POST: puxa as transações dos bancos (Open Finance / Pluggy) agora
//   /health       -> verificação simples

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { handlePhrase } from './actions'
import { Finance } from './finance'
import { Pluggy } from './pluggy'
import { formatReport, syncBanks, type SyncOptions, type SyncReport } from './sync'
import { buildMcpServer } from './tools'
import { transcribe, type Audio } from './whisper'

function env(name: string, required = true) {
  const v = process.env[name]?.trim()
  if (required && !v) {
    console.error(`Falta a variável de ambiente ${name} (veja mcp/.env.example)`)
    process.exit(1)
  }
  return v ?? ''
}

const PORT = Number(process.env.PORT || 8787)
const TOKEN = env('MCP_TOKEN')
if (TOKEN.length < 24) {
  console.error('MCP_TOKEN precisa ter pelo menos 24 caracteres (gere com: openssl rand -hex 32)')
  process.exit(1)
}
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:8000'
const DEFAULT_ACCOUNT = process.env.DEFAULT_ACCOUNT || undefined
const MAX_BODY = 25 * 1024 * 1024

const finance = new Finance({
  url: env('SUPABASE_URL'),
  key: env('SUPABASE_PUBLISHABLE_KEY'),
  email: env('DUZZ_EMAIL'),
  password: env('DUZZ_PASSWORD'),
})

// ---------- Open Finance (Pluggy) ----------

const PLUGGY_ITEMS = (process.env.PLUGGY_ITEMS ?? '')
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean)
const pluggy =
  process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET && PLUGGY_ITEMS.length
    ? new Pluggy({ clientId: process.env.PLUGGY_CLIENT_ID.trim(), clientSecret: process.env.PLUGGY_CLIENT_SECRET.trim() })
    : undefined
const SYNC_OPTS: SyncOptions = {
  items: PLUGGY_ITEMS,
  firstSyncDays: Number(process.env.PLUGGY_FIRST_SYNC_DAYS || 90),
}
const SYNC_EVERY_MS = Math.max(1, Number(process.env.PLUGGY_SYNC_HOURS || 6)) * 3_600_000

let syncing: Promise<SyncReport> | undefined
let lastSync: SyncReport | undefined

/** Roda a sincronização (uma por vez; quem chegar durante uma em andamento espera o resultado dela) */
function runSync(): Promise<SyncReport> {
  if (!pluggy) return Promise.reject(new Error('Open Finance não configurado: defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEMS no .env.'))
  syncing ??= syncBanks(finance, pluggy, SYNC_OPTS)
    .then((r) => {
      lastSync = r
      console.log(`[sync] ${r.ok ? 'ok' : 'com erros'} · +${r.added} novos, ${r.skipped} já existiam${r.errors.length ? ` · ${r.errors.join(' | ')}` : ''}`)
      return r
    })
    .finally(() => (syncing = undefined))
  return syncing
}

if (pluggy) {
  console.log(`Open Finance: ${PLUGGY_ITEMS.length} banco(s) · sincroniza a cada ${SYNC_EVERY_MS / 3_600_000}h`)
  const tick = () => runSync().catch((e) => console.error('[sync]', e instanceof Error ? e.message : e))
  setTimeout(tick, 15_000).unref()
  setInterval(tick, SYNC_EVERY_MS).unref()
}

// ---------- utilidades HTTP ----------

function sameToken(given: string | undefined | null) {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearer(req: IncomingMessage) {
  const h = req.headers.authorization
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw Object.assign(new Error('Arquivo grande demais (máx. 25 MB)'), { status: 413 })
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

// ---------- MCP ----------

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  // modo sem sessão: um servidor/transporte novo por requisição
  const server = buildMcpServer(finance, { defaultAccount: DEFAULT_ACCOUNT, sync: pluggy ? runSync : undefined })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  let body: unknown
  if (req.method === 'POST') {
    const raw = await readBody(req)
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined
    } catch {
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'JSON inválido' }, id: null })
    }
  }
  await transport.handleRequest(req, res, body)
}

// ---------- voz ----------

/** Vocabulário que ajuda o Whisper a acertar nomes (categorias, contas, despesas fixas...) */
async function whisperPrompt() {
  const reg = await finance.registry()
  const names = [
    ...reg.recurringExpenses.filter((b) => b.active).map((b) => b.name),
    ...reg.incomeSources.filter((s) => s.active).map((s) => s.name),
    ...reg.accounts.filter((a) => !a.archived).map((a) => a.name),
    ...reg.categories.filter((c) => !c.archived).map((c) => c.name),
  ]
  // vocabulário, não uma frase pronta: frase de exemplo pode "vazar" para a transcrição
  return `Lançamentos financeiros em reais (R$ 12,50). ${names.join(', ')}.`.slice(0, 700)
}

async function audioFromRequest(req: IncomingMessage, raw: Buffer): Promise<Audio | { text: string }> {
  const type = (req.headers['content-type'] ?? '').toLowerCase()
  if (type.startsWith('multipart/form-data')) {
    const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': type } }).formData()
    const text = form.get('texto') ?? form.get('text')
    if (typeof text === 'string' && text.trim()) return { text }
    const file = [...form.values()].find((v): v is File => typeof v !== 'string')
    if (!file) throw Object.assign(new Error('Mande o áudio no campo "file" (ou o texto no campo "texto").'), { status: 400 })
    return { data: new Uint8Array(await file.arrayBuffer()), filename: file.name || 'audio.m4a', contentType: file.type }
  }
  if (type.startsWith('application/json')) {
    const json = JSON.parse(raw.toString('utf8')) as { texto?: string; text?: string }
    const text = json.texto ?? json.text
    if (!text) throw Object.assign(new Error('JSON sem o campo "texto".'), { status: 400 })
    return { text }
  }
  if (type.startsWith('text/plain')) return { text: raw.toString('utf8') }
  if (!raw.length) throw Object.assign(new Error('Nenhum áudio recebido.'), { status: 400 })
  const ext = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : 'm4a'
  return { data: new Uint8Array(raw), filename: `audio.${ext}`, contentType: type || 'audio/mp4' }
}

async function handleVoice(req: IncomingMessage, res: ServerResponse, url: URL) {
  const asText = url.searchParams.get('formato') === 'texto'
  const save = url.searchParams.get('salvar') !== '0'
  const raw = await readBody(req)
  const input = await audioFromRequest(req, raw)
  const heard = 'text' in input ? input.text.trim() : await transcribe(WHISPER_URL, input, await whisperPrompt())
  const result = heard
    ? await handlePhrase(finance, heard, { save, tag: 'voz', defaultAccount: DEFAULT_ACCOUNT })
    : { ok: false, message: 'Não ouvi nada. Tenta de novo?' }
  console.log(`[voz] ${result.ok ? 'ok' : 'erro'} · "${heard}" -> ${result.message}`)
  if (asText) return send(res, 200, result.message, 'text/plain; charset=utf-8')
  send(res, 200, { ok: result.ok, ouvido: heard, mensagem: result.message, lancamento: result.transaction ?? null })
}

// ---------- roteamento ----------

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  try {
    if (path === '/health') return send(res, 200, { ok: true })

    const mcpMatch = /^\/mcp(?:\/([^/]+))?$/.exec(path)
    if (mcpMatch) {
      if (!sameToken(mcpMatch[1] ? decodeURIComponent(mcpMatch[1]) : bearer(req))) return send(res, 401, { error: 'não autorizado' })
      return await handleMcp(req, res)
    }

    if (path === '/voz') {
      if (!sameToken(bearer(req) ?? url.searchParams.get('token'))) return send(res, 401, { error: 'não autorizado' })
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' })
      return await handleVoice(req, res, url)
    }

    if (path === '/sync') {
      if (!sameToken(bearer(req) ?? url.searchParams.get('token'))) return send(res, 401, { error: 'não autorizado' })
      if (req.method === 'GET') return send(res, 200, { configurado: Boolean(pluggy), rodando: Boolean(syncing), ultima: lastSync ?? null })
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' })
      const report = await runSync()
      if (url.searchParams.get('formato') === 'texto') return send(res, 200, formatReport(report), 'text/plain; charset=utf-8')
      return send(res, 200, { ok: report.ok, novos: report.added, repetidos: report.skipped, linhas: report.lines, erros: report.errors, mensagem: formatReport(report) })
    }

    send(res, 404, { error: 'não encontrado' })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[${req.method} ${path}]`, message)
    if (url.searchParams.get('formato') === 'texto') send(res, status, `Deu erro: ${message}`, 'text/plain; charset=utf-8')
    else send(res, status, { ok: false, mensagem: `Deu erro: ${message}` })
  }
})

http.listen(PORT, () => console.log(`Duzz Finance MCP ouvindo na porta ${PORT}`))
