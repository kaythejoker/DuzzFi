// Utilidades de texto e datas (mesmas regras do app em src/lib/import.ts)

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Normaliza caractere a caractere mantendo o mesmo comprimento do texto original,
 * para que posições encontradas no texto normalizado valham também no original.
 */
export function normalizeKeepLength(s: string) {
  let out = ''
  for (const ch of s) {
    const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    out += n.length === ch.length ? n : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Palavras-chave curtas (até 4 letras) só casam com a palavra inteira,
 * para "bar" não pegar "Barra"; as maiores casam em qualquer parte.
 */
export function keywordMatches(normalizedText: string, keyword: string) {
  const k = normalize(keyword)
  if (!k) return false
  if (k.length > 4) return normalizedText.includes(k)
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}($|[^a-z0-9])`).test(normalizedText)
}

/** Casa a palavra/expressão inteira (sem pegar pedaço de outra palavra) */
export function wholeWord(normalizedText: string, phrase: string) {
  const k = normalize(phrase)
  if (!k) return null
  const m = new RegExp(`(^|[^a-z0-9])(${escapeRe(k)})(?=$|[^a-z0-9])`).exec(normalizedText)
  return m ? { index: m.index + m[1].length, length: m[2].length } : null
}

export const TZ = process.env.TZ_APP || 'America/Sao_Paulo'

/** Data de hoje (yyyy-MM-dd) no fuso do Brasil */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function lastDayOfMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Dia do mês dentro do mês informado (dia 31 em fevereiro vira o último dia) */
export function dayInYM(ym: string, day: number) {
  return `${ym}-${String(Math.min(day, lastDayOfMonth(ym))).padStart(2, '0')}`
}

export function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (n: number) => BRL.format(n).replace(/ /g, ' ')

const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "hoje", "ontem", "sexta, 31/out"... */
export function dateLabel(iso: string, today = todayISO()) {
  if (iso === today) return 'hoje'
  if (iso === addDays(today, -1)) return 'ontem'
  if (iso === addDays(today, -2)) return 'anteontem'
  const d = new Date(`${iso}T12:00:00Z`)
  return `${WEEKDAYS_PT[d.getUTCDay()]}, ${d.getUTCDate()}/${MONTHS_PT[d.getUTCMonth()]}`
}

export function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
