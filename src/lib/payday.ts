import type { IncomeSource, RecurringExpense, Transaction } from '../db/types'
import { dayInYM, daysUntil, endOfYM, shiftYM, ymOf } from './dates'

/** late: o dia já passou e nada foi lançado · done: já entrou/foi pago neste mês */
export type ScheduleStatus = 'late' | 'today' | 'upcoming' | 'done'

export interface Scheduled<T> {
  item: T
  /** próxima data (a deste mês se ainda não foi lançado; a do mês que vem se já foi) */
  date: string
  /** dias até `date` (negativo = já passou) */
  days: number
  status: ScheduleStatus
  /** quanto já foi lançado no mês atual */
  doneThisMonth: number
}

const ORDER: Record<ScheduleStatus, number> = { late: 0, today: 1, upcoming: 2, done: 3 }

function schedule<T>(item: T, day: number, today: string, doneThisMonth: number): Scheduled<T> {
  const ym = ymOf(today)
  if (doneThisMonth > 0) {
    const next = dayInYM(shiftYM(ym, 1), day)
    return { item, date: next, days: daysUntil(today, next), status: 'done', doneThisMonth }
  }
  const due = dayInYM(ym, day)
  const days = daysUntil(today, due)
  return { item, date: due, days, status: days < 0 ? 'late' : days === 0 ? 'today' : 'upcoming', doneThisMonth }
}

const sortSchedule = <T,>(a: Scheduled<T>, b: Scheduled<T>) => ORDER[a.status] - ORDER[b.status] || a.days - b.days

/** Vale no mês de `today`? (já começou e não terminou) */
function activeInMonth(today: string, startDate?: string, endDate?: string) {
  if (startDate && startDate > endOfYM(ymOf(today))) return false
  if (endDate && endDate < today) return false
  return true
}

/** Calendário das fontes de renda ativas que têm dia de recebimento */
export function upcomingPayments(sources: IncomeSource[], txs: Transaction[], today: string): Scheduled<IncomeSource>[] {
  const ym = ymOf(today)
  return sources
    .filter((s) => s.active && s.payDay && s.id != null && activeInMonth(today, s.startDate, s.endDate))
    .map((s) => {
      const got = txs
        .filter((t) => t.type === 'income' && t.incomeSourceId === s.id && ymOf(t.date) === ym)
        .reduce((sum, t) => sum + t.amount, 0)
      return schedule(s, s.payDay!, today, got)
    })
    .sort(sortSchedule)
}

/** Total já pago de uma despesa fixa num mês (lançamentos vinculados a ela) */
export function paidInMonth(bill: RecurringExpense, txs: Transaction[], ym: string) {
  return txs
    .filter((t) => t.type === 'expense' && t.recurringExpenseId === bill.id && ymOf(t.date) === ym)
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Calendário das despesas fixas ativas */
export function upcomingBills(bills: RecurringExpense[], txs: Transaction[], today: string): Scheduled<RecurringExpense>[] {
  const ym = ymOf(today)
  return bills
    .filter((b) => b.active && b.id != null && activeInMonth(today, b.startDate, b.endDate))
    .map((b) => schedule(b, b.dueDay, today, paidInMonth(b, txs, ym)))
    .sort(sortSchedule)
}

/** Formato que a grade de calendário (components/Schedule) desenha */
export interface ScheduleItem {
  key: string | number
  name: string
  color: string
  day: number
  date: string
  days: number
  status: ScheduleStatus
  /** valor mostrado: o esperado, ou o já lançado quando `done` */
  amount: number
  onAction?: () => void
}

export function incomeItems(events: Scheduled<IncomeSource>[], onAction?: (e: Scheduled<IncomeSource>) => void): ScheduleItem[] {
  return events.map((e) => ({
    key: e.item.id!,
    name: e.item.name,
    color: e.item.color,
    day: e.item.payDay!,
    date: e.date,
    days: e.days,
    status: e.status,
    amount: e.status === 'done' ? e.doneThisMonth : e.item.expectedMonthly,
    onAction: onAction && (() => onAction(e)),
  }))
}

export function billItems(events: Scheduled<RecurringExpense>[], onAction?: (e: Scheduled<RecurringExpense>) => void): ScheduleItem[] {
  return events.map((e) => ({
    key: e.item.id!,
    name: e.item.name,
    color: e.item.color,
    day: e.item.dueDay,
    date: e.date,
    days: e.days,
    status: e.status,
    amount: e.status === 'done' ? e.doneThisMonth : e.item.amount,
    onAction: onAction && (() => onAction(e)),
  }))
}
