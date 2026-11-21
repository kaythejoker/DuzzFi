// Comemoração de meta batida: estado global do overlay de balões (<CelebrationLayer /> fica no Shell)

import type { PlannedCheckpoint } from './wealthGoal'
import { fmtBRL, fmtDate } from './format'

export interface Party {
  title: string
  subtitle?: string
  details?: { label: string; value: string }[]
}

let current: Party | null = null
const listeners = new Set<() => void>()

export function celebrate(p: Party) {
  current = p
  listeners.forEach((l) => l())
}

export function closeCelebration() {
  current = null
  listeners.forEach((l) => l())
}

export function subscribeCelebration(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const VICTORY_TITLE = 'Você é um homem de 10 milhões!!!'

export function currentCelebration() {
  return current
}

export function partyFor(cp: Pick<PlannedCheckpoint, 'date' | 'age' | 'target'>, netWorth: number, early: boolean): Party {
  return {
    title: VICTORY_TITLE,
    subtitle: early
      ? `Você já passou da meta dos ${cp.age} anos, e o checkpoint é só em ${fmtDate(cp.date)}.`
      : `Checkpoint dos ${cp.age} anos batido em ${fmtDate(cp.date)}.`,
    details: [
      { label: 'Seu patrimônio', value: fmtBRL(netWorth) },
      { label: `Meta dos ${cp.age}`, value: fmtBRL(cp.target) },
    ],
  }
}

/** Comemoração do marco inicial: o dia em que a regra começou */
export function startParty(date: string, netWorth: number, next?: Pick<PlannedCheckpoint, 'date' | 'age' | 'target'>): Party {
  return {
    title: VICTORY_TITLE,
    subtitle: `Marco inicial: a regra começa hoje, ${fmtDate(date)}.${next ? ` Próximo checkpoint: ${next.age} anos, em ${fmtDate(next.date)}.` : ''}`,
    details: [
      { label: 'Ponto de partida', value: fmtBRL(netWorth) },
      ...(next ? [{ label: `Meta dos ${next.age}`, value: fmtBRL(next.target) }] : []),
    ],
  }
}
