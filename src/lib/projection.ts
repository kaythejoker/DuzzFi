// Projeção de patrimônio com juros compostos: aporte mensal que cresce ao ano, 13º em dezembro,
// rentabilidade anual e inflação (para mostrar o resultado também em dinheiro de hoje).

import { shiftYM } from './dates'

export interface ProjectionParams {
  /** patrimônio de partida */
  start: number
  /** aporte mensal no primeiro ano */
  monthly: number
  /** crescimento do aporte por ano (0.10 = 10%) */
  growthPerYear: number
  /** valor extra aportado em dezembro (13º), no primeiro ano */
  extraDecember: number
  /** rentabilidade nominal ao ano (0.12 = 12%) */
  annualReturn: number
  /** inflação ao ano (0.04 = 4%) */
  inflation: number
  /** meta em reais */
  target: number
  /** primeiro mês da projeção (yyyy-MM) */
  startYM: string
  /** horizonte máximo em anos */
  maxYears?: number
}

export interface ProjectionPoint {
  ym: string
  /** meses desde o início (1 = primeiro mês) */
  month: number
  nominal: number
  /** em dinheiro de hoje (descontada a inflação) */
  real: number
  /** total aportado até aqui (nominal) */
  invested: number
}

export interface Milestone {
  amount: number
  /** mês em que o valor nominal cruza a marca (null = não cruza no horizonte) */
  nominalMonth: number | null
  /** mês em que o valor em dinheiro de hoje cruza a marca */
  realMonth: number | null
}

export interface Projection {
  points: ProjectionPoint[]
  milestones: Milestone[]
  /** mês em que a meta é atingida (nominal / real) */
  targetNominalMonth: number | null
  targetRealMonth: number | null
}

export function projectWealth(p: ProjectionParams): Projection {
  const maxMonths = Math.round((p.maxYears ?? 40) * 12)
  const r = Math.pow(1 + p.annualReturn, 1 / 12) - 1
  const infl = Math.pow(1 + p.inflation, 1 / 12) - 1
  const marks = [...new Set([100_000, 250_000, 500_000, 1_000_000, p.target].filter((v) => v > 0))].sort((a, b) => a - b)
  const milestones: Milestone[] = marks.map((amount) => ({ amount, nominalMonth: null, realMonth: null }))

  const points: ProjectionPoint[] = []
  let nominal = p.start
  let invested = 0
  let ym = p.startYM
  for (let m = 1; m <= maxMonths; m++) {
    const year = Math.floor((m - 1) / 12)
    const factor = Math.pow(1 + p.growthPerYear, year)
    const isDecember = ym.endsWith('-12')
    const contribution = p.monthly * factor + (isDecember ? p.extraDecember * factor : 0)
    nominal = nominal * (1 + r) + contribution
    invested += contribution
    const real = nominal / Math.pow(1 + infl, m)
    points.push({ ym, month: m, nominal: round2(nominal), real: round2(real), invested: round2(invested) })
    for (const ms of milestones) {
      if (ms.nominalMonth == null && nominal >= ms.amount) ms.nominalMonth = m
      if (ms.realMonth == null && real >= ms.amount) ms.realMonth = m
    }
    // para depois de cruzar a meta em dinheiro de hoje, com alguma folga para o gráfico
    const targetReal = milestones.find((x) => x.amount === p.target)?.realMonth
    if (targetReal != null && m >= targetReal + 12) break
    ym = shiftYM(ym, 1)
  }
  const target = milestones.find((x) => x.amount === p.target)
  return { points, milestones, targetNominalMonth: target?.nominalMonth ?? null, targetRealMonth: target?.realMonth ?? null }
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** "3 anos e 2 meses" */
export function describeMonths(m: number) {
  const y = Math.floor(m / 12)
  const mo = m % 12
  if (y === 0) return `${mo} ${mo === 1 ? 'mês' : 'meses'}`
  if (mo === 0) return `${y} ${y === 1 ? 'ano' : 'anos'}`
  return `${y} ${y === 1 ? 'ano' : 'anos'} e ${mo} ${mo === 1 ? 'mês' : 'meses'}`
}

/** Idade (anos completos) numa data yyyy-MM, dado o nascimento yyyy-MM-dd */
export function ageAt(birthISO: string, ym: string) {
  const [by, bm] = birthISO.split('-').map(Number)
  const [y, m] = ym.split('-').map(Number)
  if (!by || !bm || !y || !m) return null
  // considera o fim do mês da projeção: no mês do aniversário já conta o ano novo
  return y - by - (m < bm ? 1 : 0)
}
