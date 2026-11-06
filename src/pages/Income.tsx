import { useMemo, useState } from 'react'
import { Briefcase, CalendarClock, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/Shell'
import { MonthPicker } from '../components/MonthPicker'
import { TransactionForm } from '../components/TransactionForm'
import { UpcomingIncome } from '../components/UpcomingIncome'
import { upcomingPayments } from '../lib/payday'
import { Badge, Card, ColorPicker, Confirm, Dot, EmptyState, Field, Kpi, Modal, MoneyInput, ProgressBar } from '../components/ui'
import { axisStyle, gridStroke, moneyTick, monthTick, tooltipLabelMonth, tooltipMoney, tooltipStyle } from '../components/charts'
import { useCategories, useIncomeSources, useTransactions } from '../hooks/useData'
import { useMonth } from '../hooks/useMonth'
import { repo } from '../data/store'
import { INCOME_TYPE_LABEL, PALETTE, type IncomeSource, type IncomeSourceType, type Transaction } from '../db/types'
import { incomeByTypeSeries, sumByIncomeSource } from '../lib/calc'
import { dayInYM, lastMonths, ymOf } from '../lib/dates'
import { fmtBRL, fmtPct, todayISO } from '../lib/format'

const TYPE_COLORS: Record<IncomeSourceType, string> = {
  clt: '#2fd18b',
  pj: '#5fe0a6',
  sociedade: '#8a00ff',
  empresa: '#c4a1ff',
  freelance: '#ffc857',
  dividendos: '#2dd4bf',
  aluguel: '#fb923c',
  juros: '#38bdf8',
  outro: '#9a9aa5',
}

const emptySource = (): IncomeSource => ({
  name: '',
  type: 'clt',
  expectedMonthly: 0,
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  active: true,
  startDate: todayISO(),
})

export function IncomePage() {
  const [ym, setYm] = useMonth()
  const sources = useIncomeSources()
  const txs = useTransactions()
  const categories = useCategories()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<IncomeSource | null>(null)
  const [toDelete, setToDelete] = useState<IncomeSource | null>(null)
  const [txDefaults, setTxDefaults] = useState<Partial<Transaction> | null>(null)

  const received = useMemo(() => sumByIncomeSource(txs, ym), [txs, ym])
  const active = sources.filter((s) => s.active)
  const expected = active.reduce((s, x) => s + x.expectedMonthly, 0)
  const totalReceived = [...received.values()].reduce((a, b) => a + b, 0)
  const series = useMemo(() => incomeByTypeSeries(txs, sources, ym, 12), [txs, sources, ym])
  const typesInSeries = useMemo(() => {
    const set = new Set<string>()
    for (const r of series) for (const k of Object.keys(r)) if (k !== 'ym') set.add(k)
    return [...set] as IncomeSourceType[]
  }, [series])

  const avg12 = useMemo(() => {
    const months = lastMonths(ym, 12)
    const m = new Map<number | undefined, number>()
    for (const mo of months) for (const [id, v] of sumByIncomeSource(txs, mo)) m.set(id, (m.get(id) ?? 0) + v / 12)
    return m
  }, [txs, ym])

  const today = todayISO()
  const events = useMemo(() => upcomingPayments(sources, txs, today), [sources, txs, today])
  const pendingThisMonth = events.filter((e) => e.status !== 'received').reduce((s, e) => s + e.source.expectedMonthly, 0)

  /** Abre o formulário de recebimento já preenchido com a fonte */
  function launch(s: IncomeSource, date?: string) {
    setTxDefaults({
      type: 'income',
      incomeSourceId: s.id,
      categoryId: s.defaultCategoryId,
      description: s.name,
      amount: s.expectedMonthly,
      date: date ?? (s.payDay ? dayInYM(ym, s.payDay) : ymOf(today) === ym ? today : `${ym}-05`),
    })
  }

  const incomeThisYear = useMemo(() => {
    const y = ym.slice(0, 4)
    return txs.filter((t) => t.type === 'income' && t.date.startsWith(y)).reduce((s, t) => s + t.amount, 0)
  }, [txs, ym])

  async function remove(s: IncomeSource) {
    if (!s.id) return
    // recebimentos continuam, apenas perdem o vínculo (FK on delete set null)
    await repo.incomeSources.delete(s.id)
  }

  return (
    <>
      <PageHeader
        title="Fontes de renda"
        subtitle="CLT, sociedades, empresas, freelas, dividendos: tudo que entra, de onde vem"
        actions={
          <>
            <MonthPicker value={ym} onChange={setYm} />
            <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>
              <Plus size={16} /> Fonte de renda
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <Kpi label="Recebido no mês" value={fmtBRL(totalReceived)} tone="income" icon={<Wallet />} hint={expected ? `${fmtPct(totalReceived / expected)} do esperado` : undefined} />
        <Kpi label="Renda esperada / mês" value={fmtBRL(expected)} hint={`${active.length} fonte(s) ativa(s)`} icon={<Briefcase />} />
        <Kpi label="Média mensal (12m)" value={fmtBRL([...avg12.values()].reduce((a, b) => a + b, 0))} tone="accent" />
        <Kpi label={`Acumulado em ${ym.slice(0, 4)}`} value={fmtBRL(incomeThisYear)} tone="income" />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Receita por tipo de fonte" subtitle="Últimos 12 meses, empilhado" className="xl:col-span-2">
          {typesInSeries.length === 0 ? (
            <EmptyState title="Sem receitas registradas" description="Lance recebimentos vinculados a uma fonte." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={series}>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
                  <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {typesInSeries.map((t) => (
                    <Bar key={t} dataKey={t} stackId="a" name={INCOME_TYPE_LABEL[t] ?? t} fill={TYPE_COLORS[t] ?? '#9a9aa5'} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Composição da renda" subtitle="Mês selecionado">
          {totalReceived === 0 ? (
            <EmptyState title="Nada recebido neste mês" />
          ) : (
            <ul className="space-y-3">
              {[...received.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id, v]) => {
                  const s = sources.find((x) => x.id === id)
                  return (
                    <li key={String(id)}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-2"><Dot color={s?.color ?? '#9a9aa5'} /> {s?.name ?? 'Sem fonte'}</span>
                        <span className="tabular-nums">{fmtPct(v / totalReceived)}</span>
                      </div>
                      <ProgressBar value={v} max={totalReceived} color={s?.color ?? '#9a9aa5'} />
                    </li>
                  )
                })}
            </ul>
          )}
        </Card>
      </div>

      {active.length > 0 && (
        <Card
          title="Próximos recebimentos"
          subtitle={events.length ? `${fmtBRL(pendingThisMonth)} ainda a receber neste mês` : undefined}
          className="mb-4"
        >
          {events.length === 0 ? (
            <p className="text-sm text-muted flex items-center gap-2">
              <CalendarClock size={16} /> Defina o dia do recebimento em cada fonte (editar → “Dia que cai”) para ver aqui quando cada uma entra.
            </p>
          ) : (
            <UpcomingIncome events={events} onLaunch={(e) => launch(e.source, e.date)} />
          )}
        </Card>
      )}

      {sources.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Briefcase size={32} />}
            title="Cadastre suas fontes de renda"
            description="Salário CLT, pró-labore de sociedades, lucros de empresas, freelas, aluguéis, dividendos… Cada fonte vira uma linha no seu crescimento."
            action={<button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={16} /> Nova fonte</button>}
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sources
            .slice()
            .sort((a, b) => Number(b.active) - Number(a.active) || b.expectedMonthly - a.expectedMonthly)
            .map((s) => {
              const got = received.get(s.id) ?? 0
              return (
                <div key={s.id} className={`card p-4 group ${!s.active ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.color}22` }}>
                        <Dot color={s.color} size={12} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.name}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge color={TYPE_COLORS[s.type]}>{INCOME_TYPE_LABEL[s.type]}</Badge>
                          {s.payDay && <span className="text-[11px] text-muted font-mono">todo dia {s.payDay}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button className="btn-ghost p-1.5" onClick={() => { setEditing(s); setOpen(true) }} aria-label="Editar"><Pencil size={14} /></button>
                      <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setToDelete(s)} aria-label="Excluir"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-xs text-muted">recebido no mês</p>
                      <p className="text-xl font-semibold text-income">{fmtBRL(got)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">esperado</p>
                      <p className="text-sm">{fmtBRL(s.expectedMonthly)}</p>
                    </div>
                  </div>
                  <div className="mt-2"><ProgressBar value={got} max={s.expectedMonthly} color={s.color} /></div>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-[11px] text-muted">média 12m {fmtBRL(avg12.get(s.id) ?? 0)}{!s.active && ' · inativa'}</p>
                    <button
                      className="text-xs text-brand hover:underline cursor-pointer"
                      onClick={() => launch(s)}
                    >
                      + lançar recebimento
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      <SourceModal open={open} onClose={() => setOpen(false)} editing={editing} categories={categories.filter((c) => c.type === 'income')} />
      <TransactionForm open={!!txDefaults} onClose={() => setTxDefaults(null)} defaults={txDefaults ?? undefined} />
      <Confirm
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove(toDelete)}
        message={<>Excluir a fonte “{toDelete?.name}”? Os recebimentos continuam, mas sem vínculo com a fonte.</>}
      />
    </>
  )
}

function SourceModal({ open, onClose, editing, categories }: { open: boolean; onClose: () => void; editing: IncomeSource | null; categories: { id?: number; name: string }[] }) {
  const [form, setForm] = useState<IncomeSource>(editing ?? emptySource())
  const [err, setErr] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ?? emptySource())
      setErr('')
    }
  }
  const set = <K extends keyof IncomeSource>(k: K, v: IncomeSource[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome à fonte (ex.: Salário Empresa X).')
    const payload = { ...form, name: form.name.trim() }
    if (editing?.id) await repo.incomeSources.put({ ...payload, id: editing.id })
    else await repo.incomeSources.add(payload)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar fonte de renda' : 'Nova fonte de renda'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
    >
      <div className="space-y-4">
        <Field label="Nome">
          <input className="input" autoFocus placeholder="Ex.: Salário Acme, Sociedade Duzz, Freelas" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tipo">
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value as IncomeSourceType)}>
            {(Object.keys(INCOME_TYPE_LABEL) as IncomeSourceType[]).map((t) => (
              <option key={t} value={t}>{INCOME_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor esperado por mês">
            <MoneyInput value={form.expectedMonthly} onChange={(v) => set('expectedMonthly', v)} />
          </Field>
          <Field label="Dia que cai (1 a 31)">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              className="input"
              placeholder="Ex.: 5"
              value={form.payDay ?? ''}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                set('payDay', e.target.value && n ? Math.min(31, Math.max(1, n)) : undefined)
              }}
            />
          </Field>
        </div>
        <p className="text-[11px] text-muted -mt-2">Em meses mais curtos, o dia 31 vira o último dia do mês.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <input type="date" className="input" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || undefined)} />
          </Field>
          <Field label="Fim (se encerrada)">
            <input type="date" className="input" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
          </Field>
        </div>
        <Field label="Categoria padrão ao lançar recebimento">
          <select className="input" value={form.defaultCategoryId ?? ''} onChange={(e) => set('defaultCategoryId', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">— Nenhuma —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cor"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
        <Field label="Observações">
          <textarea className="input min-h-[60px]" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="CNPJ, % de participação, contato do RH…" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Fonte ativa
        </label>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}
