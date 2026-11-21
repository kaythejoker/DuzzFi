// Fica no Shell: ao entrar no app avalia os checkpoints de patrimônio que chegaram, comemora meta batida
// (inclusive antes da hora e no marco inicial, o dia em que a regra começou) e mostra o lembrete quando o próximo checkpoint está perto.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, PartyPopper, Target, X } from 'lucide-react'
import { celebrate, partyFor, startParty } from '../lib/celebration'
import { useWealthGoal } from '../hooks/useWealthGoal'
import { repo, useStore } from '../data/store'
import { netWorthAt } from '../lib/calc'
import { ageOn, planEvaluations, reminderFor, type Reminder } from '../lib/wealthGoal'
import { fmtBRL, fmtDate } from '../lib/format'

const DISMISS_KEY = 'duzz.goal.dismissed.v1'

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function writeDismissed(keys: string[]) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(keys.slice(-50)))
  } catch {
    /* sem storage: o lembrete volta na próxima visita */
  }
}

export function WealthGoalWatcher() {
  const { goal, stored, params, salary, today, netWorthNow, schedule } = useWealthGoal()
  const status = useStore('status')
  const busy = useRef(false)
  // ao terminar bem uma gravação roda de novo (em erro não, para não ficar tentando em loop): o passo seguinte (ex.: marco inicial depois do ponto de partida) não se perde
  const [round, setRound] = useState(0)
  const release = () => {
    busy.current = false
    setRound((r) => r + 1)
  }

  useEffect(() => {
    // só com tudo carregado: senão o patrimônio do dia sairia zerado
    if (status !== 'ready' || !goal?.id || busy.current) return
    // primeira vez: guarda o patrimônio do dia em que a regra começou (ponto de partida até o primeiro marco)
    if (goal.startNetWorth == null) {
      busy.current = true
      const start = Math.round(netWorthAt(params, goal.startDate).netWorth * 100) / 100
      repo.wealthGoals
        .update(goal.id, { startNetWorth: start })
        .then(release, (e) => {
          busy.current = false
          console.error('[metas] ponto de partida', e)
        })
      return
    }
    // marco inicial: o dia em que a regra começou também é comemorado, uma vez, na primeira entrada
    if (!stored.some((c) => c.date === goal.startDate)) {
      busy.current = true
      const now = new Date().toISOString()
      const start = goal.startNetWorth
      repo.wealthCheckpoints
        .upsert(
          { date: goal.startDate, age: ageOn(goal.birthDate, goal.startDate), target: start, annualSalary: salary, netWorth: start, met: true, evaluatedAt: now, celebratedAt: now },
          'user_id,date',
        )
        .then(() => celebrate(startParty(goal.startDate, start, schedule[0])))
        .then(release, (e) => {
          busy.current = false
          console.error('[metas] marco inicial', e)
        })
      return
    }
    const plan = planEvaluations({ schedule, stored, today, salary, netWorthOn: (d) => netWorthAt(params, d).netWorth })
    if (!plan.upserts.length) return
    busy.current = true
    ;(async () => {
      for (const u of plan.upserts) await repo.wealthCheckpoints.upsert(u, 'user_id,date')
      // várias de uma vez (ficou tempo sem entrar): comemora a mais recente
      const c = plan.celebrations[plan.celebrations.length - 1]
      if (c) celebrate(partyFor(c.checkpoint, c.netWorth, c.early))
    })()
      .then(release, (e) => {
        busy.current = false
        console.error('[metas] avaliação dos checkpoints', e)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, status, goal, stored, params, salary, today, schedule])

  const reminder = goal ? reminderFor(schedule, stored, today, netWorthNow) : null
  return reminder ? <ReminderBanner reminder={reminder} /> : null
}

function ReminderBanner({ reminder }: { reminder: Reminder }) {
  const key = `${reminder.checkpoint.date}:${reminder.kind}`
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(key))
  if (dismissed) return null

  const { checkpoint: cp, gap, daysLeft, kind } = reminder
  const ahead = gap <= 0
  const text =
    kind === 'missed'
      ? `Checkpoint dos ${cp.age} anos (${fmtDate(cp.date)}): ficou ${fmtBRL(gap)} abaixo da meta de ${fmtBRL(cp.target)}. Bola pra frente: o próximo já está na tela de Crescimento.`
      : kind === 'day'
        ? `Hoje é seu aniversário de ${cp.age} anos e dia de checkpoint! Meta: ${fmtBRL(cp.target)}. ${ahead ? 'Você já tem isso.' : `Faltam ${fmtBRL(gap)} até o fim do dia.`}`
        : `Faltam ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} para o checkpoint dos ${cp.age} anos (${fmtDate(cp.date)}). Meta: ${fmtBRL(cp.target)}. ${ahead ? 'Você já está acima, só manter!' : `Faltam ${fmtBRL(gap)}.`}`
  const Icon = kind === 'missed' ? Target : kind === 'day' ? PartyPopper : CalendarClock
  const tone = kind === 'missed' ? 'border-expense/40 bg-expense/5' : kind === 'day' || kind === 'week' ? 'border-warn/40 bg-warn/5' : 'border-roxo/40 bg-roxo/5'

  return (
    <div className={`rounded-xl border p-3 mb-5 flex items-start gap-3 text-sm ${tone}`} role="status">
      <Icon size={18} className="shrink-0 mt-0.5 text-lilas" />
      <p className="flex-1 min-w-0">
        {text}{' '}
        <Link to="/crescimento" className="underline underline-offset-2 text-lilas whitespace-nowrap">Ver metas</Link>
      </p>
      <button
        className="btn-ghost p-1 shrink-0"
        title="Dispensar este lembrete"
        aria-label="Dispensar este lembrete"
        onClick={() => {
          writeDismissed([...readDismissed(), key])
          setDismissed(true)
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
