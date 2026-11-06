import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, PiggyBank, Plus, TrendingUp, Wallet } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '../components/Shell'
import { MonthPicker } from '../components/MonthPicker'
import { TransactionForm } from '../components/TransactionForm'
import { UpcomingIncome } from '../components/UpcomingIncome'
import { upcomingPayments } from '../lib/payday'
import { Badge, Card, Delta, Dot, EmptyState, Kpi, Money, ProgressBar } from '../components/ui'
import { axisStyle, gridStroke, moneyTick, monthTick, tooltipLabelMonth, tooltipMoney, tooltipStyle } from '../components/charts'
import {
  useAccounts,
  useAssetValuations,
  useAssets,
  useById,
  useCategories,
  useIncomeSources,
  useInvestmentMovements,
  useInvestmentSnapshots,
  useInvestments,
  useTransactions,
} from '../hooks/useData'
import { useMonth } from '../hooks/useMonth'
import { monthlySeries, netWorthSeries, pctChange, sumByCategory, sumByIncomeSource, summarizeMonth } from '../lib/calc'
import { shiftYM, ymOf } from '../lib/dates'
import { fmtBRL, fmtDate, fmtPct, todayISO } from '../lib/format'

export function DashboardPage() {
  const [ym, setYm] = useMonth()
  const txs = useTransactions()
  const categories = useCategories()
  const sources = useIncomeSources()
  const accounts = useAccounts()
  const investments = useInvestments()
  const movements = useInvestmentMovements()
  const snapshots = useInvestmentSnapshots()
  const assets = useAssets()
  const valuations = useAssetValuations()
  const catById = useById(categories)
  const srcById = useById(sources)
  const [formOpen, setFormOpen] = useState(false)

  const summary = useMemo(() => summarizeMonth(txs, ym), [txs, ym])
  const prev = useMemo(() => summarizeMonth(txs, shiftYM(ym, -1)), [txs, ym])
  const series = useMemo(() => monthlySeries(txs, ym, 12), [txs, ym])

  const byCat = useMemo(() => {
    const m = sumByCategory(txs, ym, 'expense')
    return [...m.entries()]
      .map(([id, value]) => ({
        id,
        name: id != null ? catById.get(id)?.name ?? 'Sem categoria' : 'Sem categoria',
        color: id != null ? catById.get(id)?.color ?? '#9a9aa5' : '#9a9aa5',
        value,
        budget: id != null ? catById.get(id)?.budget : undefined,
      }))
      .sort((a, b) => b.value - a.value)
  }, [txs, ym, catById])

  const bySource = useMemo(() => {
    const m = sumByIncomeSource(txs, ym)
    return [...m.entries()]
      .map(([id, value]) => ({
        id,
        name: id != null ? srcById.get(id)?.name ?? 'Sem fonte' : 'Sem fonte',
        color: id != null ? srcById.get(id)?.color ?? '#9a9aa5' : '#9a9aa5',
        value,
      }))
      .sort((a, b) => b.value - a.value)
  }, [txs, ym, srcById])

  const nw = useMemo(
    () => netWorthSeries({ accounts, txs, investments, movements, snapshots, assets, valuations }, ym, 2),
    [accounts, txs, investments, movements, snapshots, assets, valuations, ym],
  )
  const nwNow = nw[1]
  const nwPrev = nw[0]

  const budgets = useMemo(
    () =>
      categories
        .filter((c) => c.type === 'expense' && c.budget && c.budget > 0 && !c.archived)
        .map((c) => ({ ...c, spent: byCat.find((b) => b.id === c.id)?.value ?? 0 }))
        .sort((a, b) => b.spent / (b.budget ?? 1) - a.spent / (a.budget ?? 1)),
    [categories, byCat],
  )
  const totalBudget = budgets.reduce((s, b) => s + (b.budget ?? 0), 0)
  const totalBudgetSpent = budgets.reduce((s, b) => s + b.spent, 0)

  const recent = useMemo(() => txs.filter((t) => ymOf(t.date) === ym).slice(0, 8), [txs, ym])
  const monthInvested = useMemo(
    () => movements.filter((m) => ymOf(m.date) === ym && m.type === 'aporte').reduce((s, m) => s + m.amount, 0),
    [movements, ym],
  )

  const hasAny = txs.length > 0
  const today = todayISO()
  const payEvents = useMemo(() => upcomingPayments(sources, txs, today), [sources, txs, today])

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do mês e do seu crescimento"
        actions={
          <>
            <MonthPicker value={ym} onChange={setYm} />
            <button className="btn-primary" onClick={() => setFormOpen(true)}>
              <Plus size={16} /> Lançamento
            </button>
          </>
        }
      />

      {!hasAny && (
        <Card className="mb-6 border-brand/30 bg-brand/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Bem-vindo ao Duzz Finance</p>
              <p className="text-sm text-muted mt-1">
                Comece lançando seus gastos e receitas, ou importe o extrato do banco. Depois cadastre suas fontes de renda,
                investimentos e participações para ver o crescimento como um todo.
              </p>
            </div>
            <div className="flex gap-2">
              <Link to="/dados" className="btn-secondary">Importar extrato</Link>
              <button className="btn-primary" onClick={() => setFormOpen(true)}>Primeiro lançamento</button>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <Kpi label="Receitas do mês" value={fmtBRL(summary.income)} tone="income" icon={<ArrowUpRight />} hint={<Delta value={pctChange(summary.income, prev.income)} />} />
        <Kpi label="Despesas do mês" value={fmtBRL(summary.expense)} tone="expense" icon={<ArrowDownRight />} hint={<Delta value={pctChange(summary.expense, prev.expense)} invert />} />
        <Kpi
          label="Saldo do mês"
          value={fmtBRL(summary.balance)}
          tone={summary.balance >= 0 ? 'income' : 'expense'}
          icon={<Wallet />}
          hint={`Taxa de poupança: ${fmtPct(summary.savingsRate)}`}
        />
        <Kpi label="Aportes no mês" value={fmtBRL(monthInvested)} tone="invest" icon={<TrendingUp />} hint={summary.income ? `${fmtPct(monthInvested / summary.income)} da receita` : undefined} />
        <Kpi
          label="Patrimônio líquido"
          value={fmtBRL(nwNow?.netWorth ?? 0)}
          tone="accent"
          icon={<PiggyBank />}
          hint={<Delta value={pctChange(nwNow?.netWorth ?? 0, nwPrev?.netWorth ?? 0)} />}
        />
      </div>

      {payEvents.length > 0 && (
        <Card
          title="Próximos recebimentos"
          subtitle="Pelo dia que cada fonte de renda costuma cair"
          action={<Link to="/rendas" className="text-xs text-brand hover:underline">Ver fontes</Link>}
          className="mb-4"
        >
          <UpcomingIncome events={payEvents} />
        </Card>
      )}

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Receitas vs despesas" subtitle="Últimos 12 meses" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} barGap={2}>
                <CartesianGrid vertical={false} stroke={gridStroke} />
                <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Receitas" fill="#2fd18b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Despesas" fill="#ff5c7a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Despesas por categoria" subtitle="Mês selecionado">
          {byCat.length === 0 ? (
            <EmptyState title="Sem despesas no mês" description="Lance gastos ou importe seu extrato." />
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={48} outerRadius={75} paddingAngle={2} stroke="none">
                      {byCat.map((c) => (
                        <Cell key={String(c.id)} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={tooltipMoney} {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 mt-2 max-h-40 overflow-y-auto pr-1">
                {byCat.map((c) => (
                  <li key={String(c.id)} className="flex items-center justify-between text-sm gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Dot color={c.color} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-muted tabular-nums shrink-0">
                      {fmtBRL(c.value)} <span className="text-[11px]">({fmtPct(c.value / (summary.expense || 1))})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card
          title="Orçamento do mês"
          subtitle={totalBudget ? `${fmtBRL(totalBudgetSpent)} de ${fmtBRL(totalBudget)}` : 'Defina limites por categoria'}
          action={<Link to="/categorias" className="text-xs text-brand hover:underline">Gerenciar</Link>}
        >
          {budgets.length === 0 ? (
            <EmptyState title="Nenhum orçamento definido" description="Em Categorias & Orçamento você define um limite mensal por categoria." />
          ) : (
            <ul className="space-y-3">
              {budgets.slice(0, 7).map((b) => (
                <li key={b.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="flex items-center gap-2"><Dot color={b.color} /> {b.name}</span>
                    <span className={b.spent > (b.budget ?? 0) ? 'text-expense' : 'text-muted'}>
                      {fmtBRL(b.spent)} / {fmtBRL(b.budget ?? 0)}
                    </span>
                  </div>
                  <ProgressBar value={b.spent} max={b.budget ?? 0} color={b.color} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Receitas por fonte" subtitle="Mês selecionado" action={<Link to="/rendas" className="text-xs text-brand hover:underline">Ver fontes</Link>}>
          {bySource.length === 0 ? (
            <EmptyState title="Sem receitas no mês" description="Lance recebimentos vinculados a uma fonte de renda." />
          ) : (
            <ul className="space-y-2.5">
              {bySource.map((s) => (
                <li key={String(s.id)}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="flex items-center gap-2"><Dot color={s.color} /> {s.name}</span>
                    <span className="tabular-nums">{fmtBRL(s.value)}</span>
                  </div>
                  <ProgressBar value={s.value} max={summary.income} color={s.color} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Últimos lançamentos" action={<Link to="/transacoes" className="text-xs text-brand hover:underline">Ver todos</Link>}>
          {recent.length === 0 ? (
            <EmptyState title="Nada por aqui ainda" />
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((t) => {
                const cat = t.categoryId != null ? catById.get(t.categoryId) : undefined
                return (
                  <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{t.description}</p>
                      <p className="text-[11px] text-muted flex items-center gap-2">
                        {fmtDate(t.date, 'dd MMM')}
                        {cat && <Badge color={cat.color}>{cat.name}</Badge>}
                        {t.type === 'transfer' && <Badge className="bg-surface-2 text-muted">Transferência</Badge>}
                      </p>
                    </div>
                    <Money
                      value={t.type === 'expense' ? -t.amount : t.type === 'income' ? t.amount : 0}
                      signed={t.type !== 'transfer'}
                      className="text-sm shrink-0"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  )
}
