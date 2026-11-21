// Regra de patrimônio por idade, com checkpoint em cada aniversário.
//
// Nos marcos (25, 30, 40, 50 anos por padrão) a meta é: reserva de emergência + múltiplo × salário anual.
// Entre dois marcos o múltiplo sobe em passos iguais a cada aniversário (25: 1,5× · 26: 2× · … · 30: 4×).
// Antes do primeiro marco a meta sai do patrimônio no dia em que a regra começou e sobe em linha reta,
// pelo tempo, até a meta do primeiro marco.

import type { IncomeSource, WealthCheckpoint, WealthGoal, WealthGoalAnchor } from '../db/types'
import { daysUntil } from './dates'

export const DEFAULT_ANCHORS: WealthGoalAnchor[] = [
  { age: 25, multiple: 1.5 },
  { age: 30, multiple: 4 },
  { age: 40, multiple: 12 },
  { age: 50, multiple: 30 },
]

/** Checkpoint planejado (ainda não necessariamente avaliado) */
export interface PlannedCheckpoint {
  date: string
  age: number
  target: number
  /** múltiplo do salário nesse aniversário (null antes do primeiro marco) */
  multiple: number | null
  /** é um dos marcos da regra (25, 30, 40, 50) */
  anchor: boolean
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Salário anual a partir das fontes de renda: CLT e PJ ativas × 12 */
export function salaryFromSources(sources: IncomeSource[]) {
  return round2(sources.filter((s) => s.active && (s.type === 'clt' || s.type === 'pj')).reduce((sum, s) => sum + s.expectedMonthly, 0) * 12)
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Data (yyyy-MM-dd) em que a pessoa completa `age` anos (29/02 vira 28/02 em ano não bissexto) */
export function birthdayOn(birthISO: string, age: number) {
  const [by, bm, bd] = birthISO.split('-').map(Number)
  const y = by + age
  const d = bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd
  return `${y}-${String(bm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Idade (anos completos) numa data */
export function ageOn(birthISO: string, dateISO: string) {
  const [by, bm, bd] = birthISO.split('-').map(Number)
  const [y, m, d] = dateISO.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

const sortAnchors = (anchors: WealthGoalAnchor[]) => [...anchors].filter((a) => a.age > 0 && a.multiple >= 0).sort((a, b) => a.age - b.age)

/** Múltiplo do salário numa idade: interpolado em passos iguais entre os marcos (null fora deles) */
export function multipleAt(anchors: WealthGoalAnchor[], age: number) {
  const list = sortAnchors(anchors)
  for (let i = 0; i < list.length; i++) {
    if (list[i].age === age) return list[i].multiple
    const next = list[i + 1]
    if (next && age > list[i].age && age < next.age) return list[i].multiple + ((next.multiple - list[i].multiple) * (age - list[i].age)) / (next.age - list[i].age)
  }
  return null
}

const time = (iso: string) => Date.parse(`${iso}T12:00:00`)

/** Todos os aniversários entre o início da regra e o último marco, com a meta de cada um */
export function buildSchedule(goal: WealthGoal, salary: number): PlannedCheckpoint[] {
  const anchors = sortAnchors(goal.anchors?.length ? goal.anchors : DEFAULT_ANCHORS)
  if (!anchors.length || !goal.birthDate) return []
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  const reserve = goal.emergencyReserve
  const ruleTarget = (multiple: number) => round2(reserve + multiple * salary)
  const firstDate = birthdayOn(goal.birthDate, first.age)
  const startValue = goal.startNetWorth ?? 0
  const anchorAges = new Set(anchors.map((a) => a.age))

  const out: PlannedCheckpoint[] = []
  for (let age = ageOn(goal.birthDate, goal.startDate) + 1; age <= last.age; age++) {
    const date = birthdayOn(goal.birthDate, age)
    if (date <= goal.startDate) continue
    if (age < first.age) {
      // até o primeiro marco: do patrimônio de partida até a meta do marco, em linha reta pelo tempo
      const frac = (time(date) - time(goal.startDate)) / (time(firstDate) - time(goal.startDate))
      out.push({ date, age, target: round2(startValue + (ruleTarget(first.multiple) - startValue) * frac), multiple: null, anchor: false })
      continue
    }
    const multiple = multipleAt(anchors, age)
    if (multiple == null) continue
    out.push({ date, age, target: ruleTarget(multiple), multiple, anchor: anchorAges.has(age) })
  }
  return out
}

/** Meta numa data qualquer: linha reta entre o checkpoint anterior (ou o início) e o próximo */
export function targetOn(goal: WealthGoal, schedule: PlannedCheckpoint[], dateISO: string) {
  let prev = { date: goal.startDate, target: goal.startNetWorth ?? 0 }
  for (const p of schedule) {
    if (p.date >= dateISO) {
      if (dateISO <= prev.date) return prev.target
      const frac = (time(dateISO) - time(prev.date)) / (time(p.date) - time(prev.date))
      return round2(prev.target + (p.target - prev.target) * frac)
    }
    prev = p
  }
  return prev.target
}

export interface Celebration {
  checkpoint: PlannedCheckpoint
  netWorth: number
  /** bateu antes da data do checkpoint */
  early: boolean
}

/**
 * O que gravar e comemorar agora:
 * - checkpoint cuja data chegou e ainda não foi avaliado: compara o patrimônio daquele dia com a meta. No próprio dia
 *   só fecha se bateu (ainda dá tempo de aportar); depois do dia, fecha batendo ou não.
 * - próximo checkpoint batido antes da hora: comemora uma vez.
 */
export function planEvaluations(params: {
  schedule: PlannedCheckpoint[]
  stored: WealthCheckpoint[]
  today: string
  salary: number
  netWorthOn: (dateISO: string) => number
  now?: string
}) {
  const now = params.now ?? new Date().toISOString()
  const byDate = new Map(params.stored.map((c) => [c.date, c]))
  const upserts: WealthCheckpoint[] = []
  const celebrations: Celebration[] = []

  for (const p of params.schedule) {
    if (p.date > params.today) break
    const s = byDate.get(p.date)
    if (s?.evaluatedAt) continue
    const netWorth = round2(params.netWorthOn(p.date))
    const met = netWorth >= p.target
    if (p.date === params.today && !met) continue
    const celebrate = met && !s?.celebratedAt
    upserts.push({
      date: p.date,
      age: p.age,
      target: p.target,
      annualSalary: params.salary,
      netWorth,
      met,
      hitEarlyAt: s?.hitEarlyAt,
      evaluatedAt: now,
      celebratedAt: celebrate ? now : s?.celebratedAt,
    })
    if (celebrate) celebrations.push({ checkpoint: p, netWorth, early: false })
  }

  const next = params.schedule.find((p) => p.date > params.today)
  if (next && !byDate.get(next.date)?.celebratedAt) {
    const netWorth = round2(params.netWorthOn(params.today))
    if (netWorth >= next.target) {
      upserts.push({ date: next.date, age: next.age, target: next.target, annualSalary: params.salary, netWorth, hitEarlyAt: params.today, celebratedAt: now })
      celebrations.push({ checkpoint: next, netWorth, early: true })
    }
  }
  return { upserts, celebrations }
}

export type ReminderKind = 'day' | 'week' | 'month' | 'missed'

export interface Reminder {
  kind: ReminderKind
  checkpoint: PlannedCheckpoint
  daysLeft: number
  /** quanto falta (positivo) ou sobra (negativo) para a meta */
  gap: number
  stored?: WealthCheckpoint
}

/** Lembrete do momento: dia do checkpoint, uma semana ou um mês antes, ou checkpoint perdido há até 7 dias */
export function reminderFor(schedule: PlannedCheckpoint[], stored: WealthCheckpoint[], today: string, netWorthNow: number): Reminder | null {
  const byDate = new Map(stored.map((c) => [c.date, c]))
  const missed = [...stored]
    .filter((c) => c.evaluatedAt && c.met === false && c.date < today && daysUntil(c.date, today) <= 7)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (missed) {
    const cp = schedule.find((p) => p.date === missed.date) ?? { date: missed.date, age: missed.age, target: missed.target, multiple: null, anchor: false }
    return { kind: 'missed', checkpoint: cp, daysLeft: daysUntil(today, missed.date), gap: missed.target - (missed.netWorth ?? 0), stored: missed }
  }
  const next = schedule.find((p) => p.date >= today && !byDate.get(p.date)?.evaluatedAt)
  if (!next) return null
  const s = byDate.get(next.date)
  if (s?.celebratedAt) return null // já bateu antes da hora
  const daysLeft = daysUntil(today, next.date)
  const kind: ReminderKind | null = daysLeft === 0 ? 'day' : daysLeft <= 7 ? 'week' : daysLeft <= 30 ? 'month' : null
  if (!kind) return null
  return { kind, checkpoint: next, daysLeft, gap: next.target - netWorthNow, stored: s }
}

/** "1,5×" */
export const fmtMultiple = (m: number) => `${(Math.round(m * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`
