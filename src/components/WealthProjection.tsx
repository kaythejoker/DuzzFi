import { useEffect, useMemo, useState } from 'react'
import { Calculator, RotateCcw } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Field, Kpi, MoneyInput } from './ui'
import { axisStyle, gridStroke, moneyTick, tooltipMoney, tooltipStyle } from './charts'
import { ageAt, describeMonths, projectWealth } from '../lib/projection'
import { shiftYM } from '../lib/dates'
import { currentYM, fmtBRL, fmtMonthShort, fmtPct } from '../lib/format'

/** O que os dados reais dizem hoje, usado como ponto de partida do simulador */
export interface CurrentScenario {
  /** caixa + investimentos hoje */
  liquidWealth: number
  /** aporte médio mensal dos últimos meses (movimentos de investimento) */
  avgContribution: number
  /** sobra média do mês (receitas − despesas) nos últimos meses */
  avgSavings: number
  /** 13º estimado (soma do esperado mensal das fontes CLT) */
  thirteenth: number
  /** quantos meses entraram nas médias */
  monthsConsidered: number
}

interface Inputs {
  start: number
  monthly: number
  growth: number
  extraDecember: number
  annualReturn: number
  inflation: number
  target: number
  startYM: string
  birthDate: string
}

const STORAGE_KEY = 'duzz.projection.v1'

function defaults(s: CurrentScenario): Inputs {
  const monthly = s.avgContribution > 0 ? s.avgContribution : Math.max(0, s.avgSavings)
  return {
    start: Math.max(0, Math.round(s.liquidWealth)),
    monthly: Math.round(monthly),
    growth: 5,
    extraDecember: Math.round(s.thirteenth),
    annualReturn: 10,
    inflation: 4,
    target: 1_000_000,
    startYM: shiftYM(currentYM(), 1),
    birthDate: '',
  }
}

function load(): Partial<Inputs> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Inputs>) : null
  } catch {
    return null
  }
}

export function WealthProjection({ scenario }: { scenario: CurrentScenario }) {
  const base = useMemo(() => defaults(scenario), [scenario])
  const [saved, setSaved] = useState<Partial<Inputs> | null>(() => load())
  // enquanto o usuário não mexeu, os campos seguem os dados reais; depois, o que ele digitou (lembrado no navegador)
  const form: Inputs = useMemo(() => ({ ...base, ...(saved ?? {}) }), [base, saved])

  useEffect(() => {
    try {
      if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      /* sem storage, segue sem lembrar */
    }
  }, [saved])

  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) => setSaved((s) => ({ ...form, ...(s ?? {}), [k]: v }))
  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignora */
    }
    setSaved(form.birthDate ? { birthDate: form.birthDate } : null)
  }

  const proj = useMemo(
    () =>
      projectWealth({
        start: form.start,
        monthly: form.monthly,
        growthPerYear: form.growth / 100,
        extraDecember: form.extraDecember,
        annualReturn: form.annualReturn / 100,
        inflation: form.inflation / 100,
        target: form.target,
        startYM: /^\d{4}-\d{2}$/.test(form.startYM) ? form.startYM : shiftYM(currentYM(), 1),
      }),
    [form],
  )

  // gráfico mais leve: um ponto a cada 3 meses, sempre com o último
  const chartData = useMemo(() => proj.points.filter((_, i) => i % 3 === 0 || i === proj.points.length - 1), [proj])
  const ymAt = (m: number | null) => (m == null ? null : proj.points[m - 1]?.ym ?? null)
  const when = (m: number | null) => {
    const ym = ymAt(m)
    if (!ym || m == null) return 'não atinge em 40 anos'
    const age = form.birthDate ? ageAt(form.birthDate, ym) : null
    return `${fmtMonthShort(ym)} · ${describeMonths(m)}${age != null ? ` · ${age} anos` : ''}`
  }
  const lastPoint = proj.points[proj.points.length - 1]
  const investedAtTarget = proj.targetNominalMonth ? proj.points[proj.targetNominalMonth - 1]?.invested : null

  return (
    <Card
      title="Projeção de patrimônio"
      subtitle="Juros compostos a partir do que você tem hoje. Linha cheia em reais correntes; tracejada em dinheiro de hoje, descontando a inflação."
      className="mb-4"
      action={
        <button className="btn-secondary py-1.5!" onClick={reset} title="Voltar para os números reais">
          <RotateCcw size={14} /> Meus números
        </button>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Meta (nominal)" value={when(proj.targetNominalMonth)} tone="accent" icon={<Calculator />} />
        <Kpi label="Meta em dinheiro de hoje" value={when(proj.targetRealMonth)} tone="invest" />
        <Kpi label="Aportado até a meta" value={investedAtTarget != null ? fmtBRL(investedAtTarget) : '—'} hint={investedAtTarget != null ? `${fmtPct(investedAtTarget / form.target)} da meta é do seu bolso` : undefined} />
        <Kpi
          label="Aporte no último ano"
          value={fmtBRL(form.monthly * Math.pow(1 + form.growth / 100, Math.max(0, Math.floor(((proj.targetNominalMonth ?? proj.points.length) - 1) / 12))))}
          hint="por mês, ao atingir a meta"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Field label="Patrimônio de partida" hint={`Hoje: caixa + investimentos = ${fmtBRL(scenario.liquidWealth)}`}>
          <MoneyInput value={form.start} onChange={(v) => set('start', v)} />
        </Field>
        <Field
          label="Aporte mensal"
          hint={
            scenario.monthsConsidered
              ? `Média real: aportes ${fmtBRL(scenario.avgContribution)} · sobra do mês ${fmtBRL(scenario.avgSavings)} (${scenario.monthsConsidered} meses)`
              : 'Sem histórico ainda'
          }
        >
          <MoneyInput value={form.monthly} onChange={(v) => set('monthly', v)} />
        </Field>
        <Field label="Aporte cresce por ano (%)" hint="Promoções e aumentos indo para o aporte">
          <input className="input" type="number" step="0.5" value={form.growth} onChange={(e) => set('growth', Number(e.target.value))} />
        </Field>
        <Field label="Extra em dezembro (13º)" hint={scenario.thirteenth ? `Fontes CLT: ${fmtBRL(scenario.thirteenth)}` : undefined}>
          <MoneyInput value={form.extraDecember} onChange={(v) => set('extraDecember', v)} />
        </Field>
        <Field label="Rentabilidade ao ano (%)" hint="Nominal, antes da inflação">
          <input className="input" type="number" step="0.5" value={form.annualReturn} onChange={(e) => set('annualReturn', Number(e.target.value))} />
        </Field>
        <Field label="Inflação ao ano (%)">
          <input className="input" type="number" step="0.5" value={form.inflation} onChange={(e) => set('inflation', Number(e.target.value))} />
        </Field>
        <Field label="Meta">
          <MoneyInput value={form.target} onChange={(v) => set('target', v)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Começa em">
            <input className="input" type="month" value={form.startYM} onChange={(e) => set('startYM', e.target.value)} />
          </Field>
          <Field label="Nascimento" hint="Para mostrar a idade">
            <input className="input" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="projNominal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8a00ff" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#8a00ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} vertical={false} />
            <XAxis dataKey="ym" tick={axisStyle} tickFormatter={(v: string) => v.slice(0, 4)} interval={Math.max(0, Math.floor(chartData.length / 10))} />
            <YAxis tick={axisStyle} tickFormatter={moneyTick} width={64} />
            <Tooltip formatter={tooltipMoney} labelFormatter={(l) => fmtMonthShort(String(l))} {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={form.target} stroke="#ffc857" strokeDasharray="4 4" label={{ value: 'meta', fill: '#ffc857', fontSize: 10, position: 'insideTopLeft' }} />
            <Area type="monotone" dataKey="nominal" name="Patrimônio (reais correntes)" stroke="#8a00ff" fill="url(#projNominal)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="real" name="Em dinheiro de hoje" stroke="#2fd18b" fill="none" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Area type="monotone" dataKey="invested" name="Total aportado" stroke="#9a9aa5" fill="none" strokeWidth={1} strokeDasharray="2 3" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto mt-4">
        <table className="table">
          <thead>
            <tr>
              <th>Marco</th>
              <th>Em reais correntes</th>
              <th>Em dinheiro de hoje</th>
            </tr>
          </thead>
          <tbody>
            {proj.milestones.map((m) => (
              <tr key={m.amount}>
                <td className="font-medium">{fmtBRL(m.amount)}{m.amount === form.target ? ' · meta' : ''}</td>
                <td className="tabular-nums">{when(m.nominalMonth)}</td>
                <td className="tabular-nums text-muted">{when(m.realMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lastPoint && (
        <p className="text-[11px] text-muted mt-3">
          Estimativa. Rentabilidade constante, aportes sem falhar, sem impostos nem taxas. No fim do horizonte simulado ({fmtMonthShort(lastPoint.ym)}): {fmtBRL(lastPoint.nominal)} nominais, {fmtBRL(lastPoint.real)} em dinheiro de hoje, {fmtBRL(lastPoint.invested)} aportados.
        </p>
      )}
    </Card>
  )
}
