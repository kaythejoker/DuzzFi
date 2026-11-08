// Utilidades de texto e datas (mesmas regras do app em src/lib/import.ts)

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Palavras-chave curtas (até 4 letras) só casam com a palavra inteira; as maiores casam em qualquer parte */
export function keywordMatches(normalizedText: string, keyword: string) {
  const k = normalize(keyword)
  if (!k) return false
  if (k.length > 4) return normalizedText.includes(k)
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}($|[^a-z0-9])`).test(normalizedText)
}

/** Casa a palavra/expressão inteira */
export function wholeWord(normalizedText: string, phrase: string) {
  const k = normalize(phrase)
  if (!k) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}(?=$|[^a-z0-9])`).test(normalizedText)
}

export const TZ = 'America/Sao_Paulo'

/** Data (yyyy-MM-dd) no fuso do Brasil */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function lastDay(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (n: number) => BRL.format(n).replace(/ /g, ' ')
