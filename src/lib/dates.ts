import { addMonths, differenceInCalendarDays, format, parseISO, startOfMonth, subMonths } from 'date-fns'

export function ymOf(iso: string) {
  return iso.slice(0, 7)
}

export function ymToDate(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

export function dateToYM(d: Date) {
  return format(d, 'yyyy-MM')
}

export function shiftYM(ym: string, delta: number) {
  return dateToYM(addMonths(ymToDate(ym), delta))
}

/** Lista de meses (yyyy-MM) terminando em `endYM`, com `count` itens */
export function lastMonths(endYM: string, count: number): string[] {
  const end = ymToDate(endYM)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(dateToYM(subMonths(end, i)))
  return out
}

/** Todos os meses entre duas datas ISO (inclusive) */
export function monthsBetween(startISO: string, endISO: string): string[] {
  const start = startOfMonth(parseISO(startISO))
  const end = startOfMonth(parseISO(endISO))
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(dateToYM(cur))
    cur = addMonths(cur, 1)
  }
  return out
}

export function monthRange(ym: string) {
  const start = `${ym}-01`
  const d = ymToDate(ym)
  const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const end = format(endDate, 'yyyy-MM-dd')
  return { start, end }
}

/** último dia do mês em ISO */
export function endOfYM(ym: string) {
  return monthRange(ym).end
}

/** Data (ISO) do dia `day` no mês `ym`; em meses mais curtos usa o último dia (dia 31 em fevereiro → 28/29) */
export function dayInYM(ym: string, day: number) {
  const last = Number(endOfYM(ym).slice(8))
  return `${ym}-${String(Math.min(Math.max(1, day), last)).padStart(2, '0')}`
}

/** Dias de `fromISO` até `toISO` (negativo se `toISO` já passou) */
export function daysUntil(fromISO: string, toISO: string) {
  return differenceInCalendarDays(parseISO(toISO), parseISO(fromISO))
}
