import type { IncomeSource, Transaction } from '../db/types'
import { dayInYM, daysUntil, shiftYM, ymOf } from './dates'

export type PayStatus = 'late' | 'today' | 'upcoming' | 'received'

export interface PayEvent {
  source: IncomeSource
  /** próxima data de recebimento (ou a deste mês, se ainda não caiu) */
  date: string
  /** dias até `date` (negativo = já passou) */
  days: number
  status: PayStatus
  /** quanto já entrou desta fonte no mês atual */
  receivedThisMonth: number
}

const ORDER: Record<PayStatus, number> = { late: 0, today: 1, upcoming: 2, received: 3 }

/** Calendário das fontes ativas que têm dia de recebimento definido, em relação a `today` */
export function upcomingPayments(sources: IncomeSource[], txs: Transaction[], today: string): PayEvent[] {
  const ym = ymOf(today)
  const events: PayEvent[] = []
  for (const s of sources) {
    if (!s.active || !s.payDay || s.id == null) continue
    if (s.endDate && s.endDate < today) continue
    const receivedThisMonth = txs
      .filter((t) => t.type === 'income' && t.incomeSourceId === s.id && ymOf(t.date) === ym)
      .reduce((sum, t) => sum + t.amount, 0)
    if (receivedThisMonth > 0) {
      const next = dayInYM(shiftYM(ym, 1), s.payDay)
      events.push({ source: s, date: next, days: daysUntil(today, next), status: 'received', receivedThisMonth })
      continue
    }
    const due = dayInYM(ym, s.payDay)
    const days = daysUntil(today, due)
    events.push({ source: s, date: due, days, status: days < 0 ? 'late' : days === 0 ? 'today' : 'upcoming', receivedThisMonth })
  }
  return events.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.days - b.days)
}
