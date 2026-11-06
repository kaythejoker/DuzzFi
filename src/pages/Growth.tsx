import { useMemo, useState } from 'react'
import { Award, Flame, Rocket, Target } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '../components/Shell'
import { Card, EmptyState, Kpi, Segmented } from '../components/ui'
import { axisStyle, gridStroke, moneyTick, monthTick, tooltipLabelMonth, tooltipMoney, tooltipStyle } from '../components/charts'
import {
  useAccounts,
  useAssetValuations,
  useAssets,
  useIncomeSources,
  useInvestmentMovements,
  useInvestmentSnapshots,
  useInvestments,
  useTransactions,
} from '../hooks/useData'
import { INCOME_TYPE_LABEL, type IncomeSourceType } from '../db/types'
import { incomeByTypeSeries, monthlySeries, netWorthSeries, pctChange } from '../lib/calc'
import { lastMonths, ymOf } from '../lib/dates'
import { currentYM, fmtBRL, fmtMonthLong, fmtPct } from '../lib/format'

const TYPE_COLORS: Record<IncomeSourceType, string> = {
  clt: '#2fd18b', pj: '#5fe0a6', sociedade: '#8a00ff', empresa: '#c4a1ff', freelance: '#ffc857',
  dividendos: '#2dd4bf', aluguel: '#fb923c', juros: '#38bdf8', outro: '#9a9aa5',
}

export function GrowthPage() {
  const [range, setRange] = useState<'12' | '24' | '36'>('12')
  const count = Number(range)
  const ym = currentYM()

  const txs = useTransactions()
  const sources = useIncomeSources()
  const accounts = useAccounts()
  const investments = useInvestments()
  const movements = useInvestmentMovements()
  const snapshots = useInvestmentSnapshots()
  const assets = useAssets()
  const valuations = useAssetValuations()

  const nw = useMemo(
    () => netWorthSeries({ accounts, txs, investments, movements, snapshots, assets, valuations }, ym, count),
    [accounts, txs, investments, movements, snapshots, assets, valuations, ym, count],
  )
  const flow = useMemo(() => monthlySeries(txs, ym, count), [txs, ym, count])
  const incomeByType = useMemo(() => incomeByTypeSeries(txs, sources, ym, count), [txs, sources, ym, count])
  const types = useMemo(() => {
    const s = new Set<string>()
    for (const r of incomeByType) for (const k of Object.keys(r)) if (k !== 'ym') s.add(k)
    return [...s] as IncomeSourceType[]
  }, [incomeByType])

  const aportes = useMemo(() => {
    const months = lastMonths(ym, count)
    const m = new Map(months.map((x) => [x, 0]))
    for (const mv of movements) {
      if (mv.type !== 'aporte') continue
      const k = ymOf(mv.date)
      if (m.has(k)) m.set(k, m.get(k)! + mv.amount)
    }
    return months.map((x) => ({ ym: x, aporte: m.get(x)! }))
  }, [movements, ym, count])

  const flowWithAportes = useMemo(
    () => flow.map((f, i) => ({ ...f, aporte: aportes[i]?.aporte ?? 0, savingsPct: f.savingsRate * 100 })),
    [flow, aportes],
  )

  // destaques
  const first = nw[0]
  const last = nw[nw.length - 1]
  const nwGrowth = pctChange(last?.netWorth ?? 0, first?.netWorth ?? 0)
  const last12 = flow.slice(-12)
  const prev12 = useMemo(() => monthlySeries(txs, lastMonths(ym, 13)[0], 12), [txs, ym])
  const income12 = last12.reduce((s, f) => s + f.income, 0)
  const incomePrev12 = prev12.reduce((s, f) => s + f.income, 0)
  const saved12 = last12.reduce((s, f) => s + f.balance, 0)
  const avgSavings = income12 ? saved12 / income12 : 0
  const bestMonth = [...flow].sort((a, b) => b.income - a.income)[0]
  const totalAportes12 = aportes.slice(-12).reduce((s, a) => s + a.aporte, 0)

  const yearly = useMemo(() => {
    const years = new Map<string, { year: string; income: number; expense: number; saved: number; aporte: number; nwEnd: number }>()
    for (const t of txs) {
      const y = t.date.slice(0, 4)
      if (!years.has(y)) years.set(y, { year: y, income: 0, expense: 0, saved: 0, aporte: 0, nwEnd: 0 })
      const r = years.get(y)!
      if (t.type === 'income') r.income += t.amount
      else if (t.type === 'expense') r.expense += t.amount
    }
    for (const m of movements) {
      if (m.type !== 'aporte') continue
      const y = m.date.slice(0, 4)
      if (!years.has(y)) years.set(y, { year: y, income: 0, expense: 0, saved: 0, aporte: 0, nwEnd: 0 })
      years.get(y)!.aporte += m.amount
    }
    const list = [...years.values()].sort((a, b) => a.year.localeCompare(b.year))
    for (const r of list) {
      r.saved = r.income - r.expense
      const endYM = r.year === ym.slice(0, 4) ? ym : `${r.year}-12`
      const s = netWorthSeries({ accounts, txs, investments, movements, snapshots, assets, valuations }, endYM, 1)
      r.nwEnd = s[0]?.netWorth ?? 0
    }
    return list
  }, [txs, movements, accounts, investments, snapshots, assets, valuations, ym])

  const hasData = txs.length > 0 || movements.length > 0 || valuations.length > 0

  return (
    <>
      <PageHeader
        title="Crescimento"
        subtitle="Sua evolução financeira como um todo: renda, poupança, investimentos e patrimônio"
        actions={<Segmented value={range} onChange={setRange} options={[{ value: '12', label: '12 meses' }, { value: '24', label: '24 meses' }, { value: '36', label: '36 meses' }]} />}
      />

      {!hasData && (
        <Card className="mb-6">
          <EmptyState icon={<Rocket size={32} />} title="Ainda não há histórico" description="Conforme você lança receitas, despesas, aportes e valores de empresas/bens, esta página mostra toda a sua trajetória." />
        </Card>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <Kpi
          label={`Patrimônio líquido · crescimento em ${range} meses`}
          value={fmtBRL((last?.netWorth ?? 0) - (first?.netWorth ?? 0))}
          tone={(last?.netWorth ?? 0) >= (first?.netWorth ?? 0) ? 'income' : 'expense'}
          icon={<Rocket />}
          hint={nwGrowth != null ? `${fmtPct(nwGrowth)} · de ${fmtBRL(first?.netWorth ?? 0)} para ${fmtBRL(last?.netWorth ?? 0)}` : `Hoje: ${fmtBRL(last?.netWorth ?? 0)}`}
        />
        <Kpi
          label="Renda · últimos 12m vs 12m anteriores"
          value={fmtBRL(income12)}
          tone="income"
          icon={<Flame />}
          hint={incomePrev12 ? `${fmtPct(pctChange(income12, incomePrev12))} vs ${fmtBRL(incomePrev12)}` : 'sem período anterior para comparar'}
        />
        <Kpi label="Taxa de poupança média (12m)" value={fmtPct(avgSavings)} tone="accent" icon={<Target />} hint={`${fmtBRL(saved12)} guardados · ${fmtBRL(totalAportes12)} aportados`} />
        <Kpi label="Melhor mês de renda" value={bestMonth ? fmtBRL(bestMonth.income) : '—'} icon={<Award />} hint={bestMonth?.income ? fmtMonthLong(bestMonth.ym) : undefined} />
      </div>

      <Card title="Evolução do patrimônio" subtitle="Caixa + investimentos + empresas/bens, descontando passivos" className="mb-4">
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={nw}>
              <defs>
                {[['gCash', '#2fd18b'], ['gInv', '#8a00ff'], ['gAst', '#c4a1ff']].map(([id, c]) => (
                  <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.1} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="cash" stackId="1" name="Caixa" stroke="#2fd18b" fill="url(#gCash)" />
              <Area type="monotone" dataKey="investments" stackId="1" name="Investimentos" stroke="#8a00ff" fill="url(#gInv)" />
              <Area type="monotone" dataKey="assets" stackId="1" name="Empresas & bens" stroke="#c4a1ff" fill="url(#gAst)" />
              <Line type="monotone" dataKey="liabilities" name="Passivos" stroke="#ff5c7a" strokeDasharray="4 4" dot={false} />
              <Line type="monotone" dataKey="netWorth" name="Patrimônio líquido" stroke="#ffffff" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Renda por tipo de fonte" subtitle="CLT, sociedades, empresas, freelas… empilhado por mês">
          {types.length === 0 ? (
            <EmptyState title="Sem receitas" description="Vincule recebimentos às fontes de renda." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={incomeByType}>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
                  <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {types.map((t) => <Bar key={t} dataKey={t} stackId="a" name={INCOME_TYPE_LABEL[t] ?? t} fill={TYPE_COLORS[t] ?? '#9a9aa5'} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Poupança e aportes" subtitle="Quanto sobrou do mês e quanto foi investido">
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={flowWithAportes}>
                <CartesianGrid vertical={false} stroke={gridStroke} />
                <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis yAxisId="money" tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
                <YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={40} domain={[-50, 100]} />
                <Tooltip
                  formatter={(v, name) => (name === 'Taxa de poupança' ? `${Number(v).toFixed(1)}%` : fmtBRL(Number(v)))}
                  labelFormatter={tooltipLabelMonth}
                  {...tooltipStyle}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="money" dataKey="balance" name="Sobra do mês" fill="#2fd18b" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="money" dataKey="aporte" name="Aportes" fill="#8a00ff" radius={[4, 4, 0, 0]} />
                <Line yAxisId="pct" type="monotone" dataKey="savingsPct" name="Taxa de poupança" stroke="#ffc857" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Receitas vs despesas" subtitle="Tendência do fluxo de caixa" className="mb-4">
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={flow}>
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2fd18b" stopOpacity={0.4} /><stop offset="100%" stopColor="#2fd18b" stopOpacity={0} /></linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5c7a" stopOpacity={0.4} /><stop offset="100%" stopColor="#ff5c7a" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="income" name="Receitas" stroke="#2fd18b" fill="url(#gInc)" strokeWidth={2} />
              <Area type="monotone" dataKey="expense" name="Despesas" stroke="#ff5c7a" fill="url(#gExp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {yearly.length > 0 && (
        <Card title="Resumo por ano" bodyClassName="p-0!">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th className="text-right">Receitas</th>
                  <th className="text-right">Despesas</th>
                  <th className="text-right">Sobra</th>
                  <th className="text-right">Taxa poupança</th>
                  <th className="text-right">Aportes</th>
                  <th className="text-right">Patrimônio (fim)</th>
                  <th className="text-right">Crescimento renda</th>
                </tr>
              </thead>
              <tbody>
                {yearly.map((r, i) => {
                  const prev = yearly[i - 1]
                  const g = prev ? pctChange(r.income, prev.income) : null
                  return (
                    <tr key={r.year}>
                      <td className="font-medium">{r.year}</td>
                      <td className="text-right tabular-nums text-income">{fmtBRL(r.income)}</td>
                      <td className="text-right tabular-nums text-expense">{fmtBRL(r.expense)}</td>
                      <td className={`text-right tabular-nums ${r.saved >= 0 ? 'text-income' : 'text-expense'}`}>{fmtBRL(r.saved)}</td>
                      <td className="text-right tabular-nums">{r.income ? fmtPct(r.saved / r.income) : '—'}</td>
                      <td className="text-right tabular-nums text-invest">{fmtBRL(r.aporte)}</td>
                      <td className="text-right tabular-nums font-medium">{fmtBRL(r.nwEnd)}</td>
                      <td className={`text-right tabular-nums ${g == null ? 'text-muted' : g >= 0 ? 'text-income' : 'text-expense'}`}>{g == null ? '—' : fmtPct(g)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
