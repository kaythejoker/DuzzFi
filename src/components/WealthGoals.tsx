// Tela de metas de patrimônio por idade (substitui a antiga projeção): meta de hoje, próximo checkpoint,
// gráfico meta × patrimônio real e a tabela com todos os aniversários até os 50.

import { useMemo, useState } from 'react'
import { CalendarClock, Flag, PartyPopper, Settings2, Target, TrendingUp } from 'lucide-react'
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, EmptyState, Field, Kpi, Modal, MoneyInput, Segmented } from './ui'
import { axisStyle, gridStroke, moneyTick, tooltipStyle } from './charts'
import { celebrate, partyFor, startParty } from '../lib/celebration'
import { useWealthGoal } from '../hooks/useWealthGoal'
import { repo } from '../data/store'
import { netWorthAt } from '../lib/calc'
import { endOfYM, monthsBetween, daysUntil } from '../lib/dates'
import { DEFAULT_ANCHORS, ageOn, fmtMultiple, targetOn, type PlannedCheckpoint } from '../lib/wealthGoal'
import { fmtBRL, fmtDate, todayISO } from '../lib/format'
import type { WealthGoal } from '../db/types'

const ts = (iso: string) => Date.parse(`${iso}T12:00:00`)
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)

export function WealthGoals() {
  const { goal, stored, params, salary, derivedSalary, today, netWorthNow, schedule } = useWealthGoal()
  const [editing, setEditing] = useState(false)

  if (!goal) {
    return (
      <Card title="Metas de patrimônio" subtitle="Quanto ter em cada aniversário" className="mb-4">
        <EmptyState
          icon={<Target size={32} />}
          title="Nenhuma regra definida"
          description="Defina sua data de nascimento e a reserva de emergência: a meta de cada aniversário sai da regra reserva + múltiplo do salário anual (1,5× aos 25, 4× aos 30, 12× aos 40, 30× aos 50)."
          action={<button className="btn-primary" onClick={() => setEditing(true)}>Criar regra</button>}
        />
        <GoalSettings open={editing} onClose={() => setEditing(false)} derivedSalary={derivedSalary} />
      </Card>
    )
  }

  return (
    <>
      <GoalView
        goal={goal}
        stored={stored}
        params={params}
        salary={salary}
        today={today}
        netWorthNow={netWorthNow}
        schedule={schedule}
        onEdit={() => setEditing(true)}
      />
      <GoalSettings open={editing} onClose={() => setEditing(false)} goal={goal} derivedSalary={derivedSalary} />
    </>
  )
}

type GoalData = ReturnType<typeof useWealthGoal>

function GoalView({
  goal,
  stored,
  params,
  salary,
  today,
  netWorthNow,
  schedule,
  onEdit,
}: Pick<GoalData, 'stored' | 'params' | 'salary' | 'today' | 'netWorthNow' | 'schedule'> & { goal: WealthGoal; onEdit: () => void }) {
  const anchors = (goal.anchors?.length ? goal.anchors : DEFAULT_ANCHORS).map((a) => a.age).sort((a, b) => a - b)
  const [until, setUntil] = useState(String(anchors.find((a) => schedule.some((p) => p.age === a && p.date > today)) ?? anchors[anchors.length - 1]))

  const byDate = useMemo(() => new Map(stored.map((c) => [c.date, c])), [stored])
  const targetToday = targetOn(goal, schedule, today)
  const next = schedule.find((p) => p.date >= today && !byDate.get(p.date)?.evaluatedAt)
  const nextAnchor = schedule.find((p) => p.anchor && p.date >= today)
  const daysLeft = next ? daysUntil(today, next.date) : 0
  const gap = next ? next.target - netWorthNow : 0
  const monthsLeft = Math.max(1, daysLeft / 30.44)
  const ahead = netWorthNow - targetToday

  // gráfico: linha da meta (início + checkpoints) e patrimônio real no fim de cada mês desde o início
  const chart = useMemo(() => {
    const limitAge = Number(until)
    const pts = schedule.filter((p) => p.age <= limitAge)
    const rows = new Map<number, { t: number; target?: number; actual?: number }>()
    const put = (iso: string, k: 'target' | 'actual', v: number) => {
      const t = ts(iso)
      rows.set(t, { ...(rows.get(t) ?? { t }), [k]: v })
    }
    put(goal.startDate, 'target', goal.startNetWorth ?? 0)
    for (const p of pts) put(p.date, 'target', p.target)
    const ends = monthsBetween(goal.startDate, today).map(endOfYM).filter((d) => d > goal.startDate && d < today)
    for (const d of [goal.startDate, ...ends, today]) put(d, 'actual', Math.round(netWorthAt(params, d).netWorth * 100) / 100)
    return [...rows.values()].sort((a, b) => a.t - b.t)
  }, [schedule, until, goal.startDate, goal.startNetWorth, today, params])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display text-lg font-bold">Metas de patrimônio</h2>
          <p className="text-xs text-muted mt-0.5">
            Checkpoint em todo aniversário · reserva de {fmtBRL(goal.emergencyReserve)} + múltiplo do salário anual ({fmtBRL(salary)})
          </p>
        </div>
        <button className="btn-secondary inline-flex items-center gap-1.5" onClick={onEdit}>
          <Settings2 size={14} /> Ajustar regra
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <Kpi
          label="Patrimônio hoje"
          value={fmtBRL(netWorthNow)}
          tone={ahead >= 0 ? 'income' : 'expense'}
          icon={<TrendingUp />}
          hint={`Meta de hoje: ${fmtBRL(targetToday)} · ${ahead >= 0 ? `${fmtBRL(ahead)} acima` : `${fmtBRL(-ahead)} abaixo`}`}
        />
        <Kpi
          label="Próximo checkpoint"
          value={next ? fmtBRL(next.target) : '—'}
          tone="accent"
          icon={<CalendarClock />}
          hint={next ? `${next.age} anos · ${fmtDate(next.date)} · ${daysLeft === 0 ? 'é hoje!' : `faltam ${daysLeft} dias`}` : 'Todos os checkpoints já passaram'}
        />
        <Kpi
          label="Falta para o próximo"
          value={next ? (gap <= 0 ? 'Batido!' : fmtBRL(gap)) : '—'}
          tone={gap <= 0 ? 'income' : 'neutral'}
          icon={<Target />}
          hint={next && gap > 0 ? `${fmtBRL(gap / monthsLeft)} por mês até ${fmtDate(next.date)}` : next ? 'Já está acima da meta do próximo aniversário' : undefined}
        />
        <Kpi
          label="Próximo marco"
          value={nextAnchor ? `${nextAnchor.age} anos` : '—'}
          icon={<Flag />}
          hint={nextAnchor ? `${fmtBRL(nextAnchor.target)} (${fmtBRL(goal.emergencyReserve)} + ${fmtMultiple(nextAnchor.multiple ?? 0)} salário) · ${fmtDate(nextAnchor.date)}` : undefined}
        />
      </div>

      <Card
        title="Meta × patrimônio real"
        subtitle="A linha tracejada é a meta (sobe entre um aniversário e outro); a cheia é o seu patrimônio líquido"
        action={<Segmented value={until} onChange={setUntil} options={anchors.map((a) => ({ value: String(a), label: `Até os ${a}` }))} />}
        className="mb-4"
      >
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={chart}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tick={axisStyle}
                axisLine={false}
                tickLine={false}
                tickFormatter={(t: number) => isoOf(t).slice(0, 4)}
              />
              <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                formatter={(v) => fmtBRL(Number(v))}
                labelFormatter={(t) => {
                  const iso = isoOf(Number(t))
                  return `${fmtDate(iso)} · ${ageOn(goal.birthDate, iso)} anos`
                }}
                {...tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="linear" dataKey="target" name="Meta" stroke="#c4a1ff" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              <Line type="monotone" dataKey="actual" name="Patrimônio líquido" stroke="#2fd18b" strokeWidth={2.5} dot={false} connectNulls />
              {schedule
                .filter((p) => p.anchor && p.age <= Number(until))
                .map((p) => (
                  <ReferenceDot key={p.date} x={ts(p.date)} y={p.target} r={5} fill="#8a00ff" stroke="#c4a1ff" />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Checkpoints" subtitle="Um por aniversário até os 50. Metas já avaliadas ficam congeladas com o salário daquele dia." className="mb-4" bodyClassName="p-0!">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Idade</th>
                <th>Regra</th>
                <th className="text-right">Meta</th>
                <th className="text-right">Patrimônio no dia</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {byDate.get(goal.startDate) && (
                <tr>
                  <td className="tabular-nums whitespace-nowrap">{fmtDate(goal.startDate)}</td>
                  <td>{ageOn(goal.birthDate, goal.startDate)}</td>
                  <td className="text-muted whitespace-nowrap">marco inicial</td>
                  <td className="text-right tabular-nums">—</td>
                  <td className="text-right tabular-nums">{fmtBRL(goal.startNetWorth ?? 0)}</td>
                  <td className="whitespace-nowrap">
                    <Badge color="#2fd18b">Começou</Badge>
                    <button
                      className="btn-ghost p-1 ml-1 align-middle"
                      title="Comemorar de novo"
                      aria-label="Comemorar de novo"
                      onClick={() => celebrate(startParty(goal.startDate, goal.startNetWorth ?? 0, schedule[0]))}
                    >
                      <PartyPopper size={14} />
                    </button>
                  </td>
                </tr>
              )}
              {schedule.map((p) => (
                <CheckpointRow key={p.date} p={p} s={byDate.get(p.date)} today={today} reserve={goal.emergencyReserve} firstAnchor={anchors[0]} isNext={p.date === next?.date} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function CheckpointRow({
  p,
  s,
  today,
  reserve,
  firstAnchor,
  isNext,
}: {
  p: PlannedCheckpoint
  s?: GoalData['stored'][number]
  today: string
  reserve: number
  firstAnchor: number
  isNext: boolean
}) {
  const target = s?.evaluatedAt ? s.target : p.target
  const rule = p.multiple == null ? `rumo aos ${firstAnchor}` : `${fmtBRL(reserve).replace(',00', '')} + ${fmtMultiple(p.multiple)} salário`
  const status = s?.evaluatedAt ? (s.met ? 'met' : 'missed') : s?.celebratedAt ? 'early' : p.date < today ? 'pending' : isNext ? 'next' : 'future'

  return (
    <tr className={isNext ? 'bg-roxo/5' : undefined}>
      <td className="tabular-nums whitespace-nowrap">{fmtDate(p.date)}</td>
      <td className={p.anchor ? 'font-bold' : undefined}>{p.age}</td>
      <td className="text-muted whitespace-nowrap">{rule}</td>
      <td className={`text-right tabular-nums ${p.anchor ? 'font-bold' : ''}`}>{fmtBRL(target)}</td>
      <td className="text-right tabular-nums">{s?.netWorth != null ? fmtBRL(s.netWorth) : '—'}</td>
      <td className="whitespace-nowrap">
        {status === 'met' && <Badge color="#2fd18b">Batida</Badge>}
        {status === 'early' && <Badge color="#2fd18b">Batida antes ({fmtDate(s!.hitEarlyAt ?? today)})</Badge>}
        {status === 'missed' && <Badge color="#ff5c7a">Não bateu</Badge>}
        {status === 'next' && <Badge color="#c4a1ff">Próximo</Badge>}
        {status === 'pending' && <Badge color="#ffc857">Avaliando…</Badge>}
        {status === 'future' && <span className="text-xs text-muted">—</span>}
        {(status === 'met' || status === 'early') && s?.netWorth != null && (
          <button className="btn-ghost p-1 ml-1 align-middle" title="Comemorar de novo" aria-label="Comemorar de novo" onClick={() => celebrate(partyFor({ ...p, target }, s.netWorth!, status === 'early'))}>
            <PartyPopper size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

function GoalSettings({ open, onClose, goal, derivedSalary }: { open: boolean; onClose: () => void; goal?: WealthGoal; derivedSalary: number }) {
  if (!open) return null
  return <GoalSettingsForm onClose={onClose} goal={goal} derivedSalary={derivedSalary} />
}

function GoalSettingsForm({ onClose, goal, derivedSalary }: { onClose: () => void; goal?: WealthGoal; derivedSalary: number }) {
  const [birthDate, setBirthDate] = useState(goal?.birthDate ?? '')
  const [reserve, setReserve] = useState(goal?.emergencyReserve ?? 10000)
  const [salary, setSalary] = useState(goal?.annualSalary ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return setError('Informe a data de nascimento.')
    setSaving(true)
    setError(null)
    try {
      const patch = { birthDate, emergencyReserve: reserve, annualSalary: salary > 0 ? salary : undefined }
      if (goal?.id) await repo.wealthGoals.update(goal.id, patch)
      else await repo.wealthGoals.add({ ...patch, startDate: todayISO(), anchors: DEFAULT_ANCHORS })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={goal ? 'Ajustar regra de patrimônio' : 'Criar regra de patrimônio'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Data de nascimento" hint="Os checkpoints caem em cada aniversário.">
          <input type="date" className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label="Reserva de emergência" hint="Somada à meta de todos os marcos.">
          <MoneyInput value={reserve} onChange={setReserve} />
        </Field>
        <Field
          label="Salário anual (opcional)"
          hint={`Em branco usa as fontes de renda CLT/PJ ativas × 12: hoje ${fmtBRL(derivedSalary)}. Metas já avaliadas não mudam.`}
        >
          <MoneyInput value={salary} onChange={setSalary} placeholder={derivedSalary.toFixed(2).replace('.', ',')} />
        </Field>
        <p className="text-xs text-muted">
          Marcos: {(goal?.anchors?.length ? goal.anchors : DEFAULT_ANCHORS).map((a) => `${a.age} anos = reserva + ${fmtMultiple(a.multiple)}`).join(' · ')}. Entre os marcos o múltiplo sobe igual a cada ano.
          {goal && ` Regra começou em ${fmtDate(goal.startDate)}${goal.startNetWorth != null ? ` com ${fmtBRL(goal.startNetWorth)}` : ''}.`}
        </p>
        {error && <p className="text-sm text-expense">{error}</p>}
      </div>
    </Modal>
  )
}
