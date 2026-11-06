import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

export function fmtBRL(v: number | undefined | null) {
  return brl.format(v ?? 0)
}

export function fmtCompact(v: number | undefined | null) {
  return brlCompact.format(v ?? 0)
}

export function fmtPct(v: number | undefined | null) {
  if (v == null || !isFinite(v)) return '—'
  return pct.format(v)
}

export function fmtSigned(v: number) {
  const s = fmtBRL(Math.abs(v))
  return v < 0 ? `- ${s}` : `+ ${s}`
}

export function fmtDate(iso: string, pattern = 'dd/MM/yyyy') {
  try {
    return format(parseISO(iso), pattern, { locale: ptBR })
  } catch {
    return iso
  }
}

/** '2025-03' -> 'mar/25' */
export function fmtMonthShort(ym: string) {
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return format(d, 'MMM/yy', { locale: ptBR })
}

/** '2025-03' -> 'março de 2025' */
export function fmtMonthLong(ym: string) {
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  const s = format(d, "MMMM 'de' yyyy", { locale: ptBR })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Converte string digitada pelo usuário ('1.234,56' / '1234.56' / 'R$ 10') em número */
export function parseMoney(input: string): number {
  if (!input) return 0
  let s = input.replace(/[^\d,.-]/g, '').trim()
  if (!s) return 0
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // decide pelo último separador
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(',', '.')
  } else if (hasDot) {
    // vários pontos ('1.234.567') => separadores de milhar; um ponto só é tratado como decimal
    const parts = s.split('.')
    if (parts.length > 2) s = parts.join('')
  }
  const n = Number(s)
  return isFinite(n) ? n : 0
}

export function todayISO() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function currentYM() {
  return format(new Date(), 'yyyy-MM')
}
