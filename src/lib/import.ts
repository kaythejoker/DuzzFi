import Papa from 'papaparse'
import type { Category } from '../db/types'
import { parseMoney } from './format'

export interface ParsedRow {
  date: string // yyyy-MM-dd
  description: string
  amount: number // positivo
  type: 'expense' | 'income'
  /** texto complementar do banco (ex.: coluna "Histórico": "Pix enviado", "Compra no débito") */
  memo?: string
  raw: string
  fitid?: string
}

export interface CsvColumns {
  date: number
  description: number
  amount: number
  /** coluna opcional com o tipo do lançamento (ex.: "Histórico") */
  memo?: number
  /** coluna opcional de crédito separada (alguns bancos separam débito/crédito) */
  credit?: number
}

export interface CsvPreview {
  headers: string[]
  rows: string[][]
  delimiter: string
  guess: CsvColumns
  headerRowIndex: number
}

// ---------- utilidades ----------

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function parseDateAny(s: string): string | null {
  const t = s.trim()
  let m: RegExpMatchArray | null
  // yyyy-MM-dd ou yyyy/MM/dd (com ou sem hora)
  if ((m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return iso(m[1], m[2], m[3])
  // dd/MM/yyyy ou dd-MM-yyyy ou dd.MM.yyyy
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return iso(m[3], m[2], m[1])
  // dd/MM/yy
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/))) return iso(`20${m[3]}`, m[2], m[1])
  // yyyyMMdd (OFX)
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})/))) return iso(m[1], m[2], m[3])
  return null
}

function iso(y: string, m: string, d: string) {
  const mm = m.padStart(2, '0')
  const dd = d.padStart(2, '0')
  const n = Number(mm)
  const nd = Number(dd)
  if (n < 1 || n > 12 || nd < 1 || nd > 31) return null
  return `${y}-${mm}-${dd}`
}

/**
 * Identificador estável de um lançamento do extrato, usado para não importar o mesmo lançamento duas vezes.
 * Leva em conta o sinal (um estorno não colide com a compra original) e o histórico.
 * Lançamentos idênticos no mesmo arquivo (ex.: dois Pix iguais no mesmo dia) são diferenciados
 * pela ordem de ocorrência: o 2º recebe "#2", o 3º "#3"...
 */
export function hashRows(rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const signed = r.type === 'expense' ? -r.amount : r.amount
    const clean = (s: string | undefined) => normalize(s ?? '').replace(/\s+/g, ' ')
    const base = r.fitid ? `fitid:${r.fitid}` : `${r.date}|${signed.toFixed(2)}|${clean(r.description)}|${clean(r.memo)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? hashString(base) : `${hashString(base)}#${n}`
  })
}

function hashString(base: string) {
  let h = 0
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}-${base.length}`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Palavra-chave curta (até 4 letras, ex.: "bar", "das", "iof") só casa com a palavra inteira,
 * para "bar" não pegar "Barra" nem "das" pegar "Bebidas". As maiores casam em qualquer parte
 * ("restaurante" pega "Rangoorestaurante").
 */
export function keywordMatches(normalizedText: string, keyword: string) {
  const k = normalize(keyword)
  if (!k) return false
  if (k.length > 4) return normalizedText.includes(k)
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}($|[^a-z0-9])`).test(normalizedText)
}

/** Sugere categoria pelas palavras-chave cadastradas (a palavra-chave mais longa vence) */
export function suggestCategory(description: string, type: 'expense' | 'income', categories: Category[]): number | undefined {
  const d = normalize(description)
  let best: { id: number; len: number } | undefined
  for (const c of categories) {
    if (c.type !== type || c.archived || !c.id || !c.keywords) continue
    for (const kw of c.keywords) {
      const len = normalize(kw).length
      if (keywordMatches(d, kw) && (!best || len > best.len)) best = { id: c.id, len }
    }
  }
  return best?.id
}

// ---------- CSV ----------

const DATE_HINTS = ['data', 'date', 'dt ', 'dia']
const DESC_HINTS = ['descri', 'historico', 'memo', 'lancamento', 'title', 'estabelecimento', 'detalhe', 'nome']
const AMOUNT_HINTS = ['valor', 'amount', 'montante', 'quantia', 'value', 'debito', 'credito']

export function previewCsv(text: string): CsvPreview {
  // detecta delimitador
  const firstLines = text.split(/\r?\n/).slice(0, 20).join('\n')
  const counts = { ';': (firstLines.match(/;/g) ?? []).length, ',': (firstLines.match(/,/g) ?? []).length, '\t': (firstLines.match(/\t/g) ?? []).length }
  const delimiter = counts[';'] >= counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ','

  const parsed = Papa.parse<string[]>(text.trim(), { delimiter, skipEmptyLines: true })
  const all = parsed.data.map((r) => r.map((c) => (c ?? '').toString().trim()))

  // header: primeira linha com >= 3 células preenchidas que contenha alguma dica
  let headerRowIndex = all.findIndex((r) => {
    const cells = r.filter(Boolean)
    if (cells.length < 2) return false
    const n = cells.map(normalize)
    return n.some((c) => DATE_HINTS.some((h) => c.includes(h))) && n.some((c) => AMOUNT_HINTS.some((h) => c.includes(h)))
  })
  let headers: string[]
  let rows: string[][]
  if (headerRowIndex === -1) {
    // sem cabeçalho: usa nomes genéricos e começa na primeira linha que parece dado
    headerRowIndex = all.findIndex((r) => r.some((c) => parseDateAny(c)))
    if (headerRowIndex === -1) headerRowIndex = 0
    const width = Math.max(...all.map((r) => r.length))
    headers = Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`)
    rows = all.slice(headerRowIndex)
  } else {
    headers = all[headerRowIndex]
    rows = all.slice(headerRowIndex + 1)
  }

  // remove linhas de saldo/rodapé (sem data)
  rows = rows.filter((r) => r.some((c) => parseDateAny(c)))

  const guess = guessColumns(headers, rows)
  return { headers, rows, delimiter, guess, headerRowIndex }
}

function guessColumns(headers: string[], rows: string[][]): CsvColumns {
  const n = headers.map(normalize)
  const find = (hints: string[], exclude: number[] = []) => {
    for (const h of hints) {
      const i = n.findIndex((c, idx) => c.includes(h) && !exclude.includes(idx))
      if (i !== -1) return i
    }
    return -1
  }
  let date = find(DATE_HINTS)
  if (date === -1) date = colWhere(rows, (c) => !!parseDateAny(c))

  let amount = find(['valor', 'amount', 'montante', 'quantia', 'value'])
  let credit: number | undefined
  const deb = find(['debito'])
  const cred = find(['credito'])
  if (amount === -1 && deb !== -1) {
    amount = deb
    if (cred !== -1) credit = cred
  }
  if (amount === -1) amount = colWhere(rows, (c) => /^-?\s*R?\$?\s*[\d.,]+$/.test(c) && !parseDateAny(c), [date])

  let description = find(DESC_HINTS, [date, amount])
  if (description === -1) {
    // coluna de texto mais longa
    let best = -1
    let bestLen = 0
    for (let i = 0; i < headers.length; i++) {
      if (i === date || i === amount) continue
      const len = rows.slice(0, 30).reduce((s, r) => s + (r[i]?.length ?? 0), 0)
      if (len > bestLen) {
        bestLen = len
        best = i
      }
    }
    description = best
  }
  // segunda coluna de texto (ex.: "Histórico" ao lado de "Descrição")
  const memo = find(DESC_HINTS, [date, amount, description, credit ?? -1])
  return { date: Math.max(0, date), description: Math.max(0, description), amount: Math.max(0, amount), credit, memo: memo === -1 ? undefined : memo }
}

function colWhere(rows: string[][], pred: (c: string) => boolean, exclude: number[] = []) {
  const width = Math.max(0, ...rows.map((r) => r.length))
  for (let i = 0; i < width; i++) {
    if (exclude.includes(i)) continue
    const sample = rows.slice(0, 20).map((r) => r[i] ?? '').filter(Boolean)
    if (sample.length && sample.filter(pred).length >= sample.length * 0.7) return i
  }
  return -1
}

export function rowsFromCsv(preview: CsvPreview, cols: CsvColumns, invertSign: boolean): ParsedRow[] {
  const out: ParsedRow[] = []
  for (const r of preview.rows) {
    const date = parseDateAny(r[cols.date] ?? '')
    if (!date) continue
    let amount = parseMoney(r[cols.amount] ?? '')
    if (cols.credit != null) {
      const c = parseMoney(r[cols.credit] ?? '')
      if (c) amount = Math.abs(c)
      else amount = -Math.abs(amount)
    }
    // débito explícito sem sinal (alguns bancos usam 'D'/'C')
    const row = r.join(' ')
    if (/\bD\b/.test(row) && !/\bC\b/.test(row) && amount > 0 && cols.credit == null && /\s[DC]\s*$/.test(r[cols.amount] ?? '')) amount = -amount
    if (invertSign) amount = -amount
    if (!amount) continue
    const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
    const memo = cols.memo != null ? clean(r[cols.memo]) : ''
    // sem descrição (ex.: "Antecipação FGTS"), o histórico vira a descrição
    const description = clean(r[cols.description]) || memo || 'Sem descrição'
    out.push({
      date,
      description,
      memo: memo && memo !== description ? memo : undefined,
      amount: Math.abs(amount),
      type: amount < 0 ? 'expense' : 'income',
      raw: r.join(preview.delimiter),
    })
  }
  return out
}

// ---------- OFX ----------

export function parseOfx(text: string): ParsedRow[] {
  const out: ParsedRow[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  for (const b of blocks) {
    const body = b.split(/<\/STMTTRN>/i)[0]
    const get = (tag: string) => {
      const m = body.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))
      return m ? m[1].trim() : ''
    }
    const dt = get('DTPOSTED')
    const date = parseDateAny(dt)
    const amt = parseMoney(get('TRNAMT').replace(',', '.'))
    if (!date || !amt) continue
    const memo = get('MEMO') || get('NAME') || 'Sem descrição'
    const fitid = get('FITID') || undefined
    out.push({
      date,
      description: memo.replace(/\s+/g, ' ').trim(),
      amount: Math.abs(amt),
      type: amt < 0 ? 'expense' : 'income',
      raw: body.trim(),
      fitid,
    })
  }
  return out
}

export function isOfx(text: string, filename: string) {
  return /\.(ofx|qfx)$/i.test(filename) || /<OFX>|<STMTTRN>/i.test(text.slice(0, 5000))
}
