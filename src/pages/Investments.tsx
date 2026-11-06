import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Coins, Pencil, Percent, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/Shell'
import { Badge, Card, ColorPicker, Confirm, Dot, EmptyState, Field, Kpi, Modal, MoneyInput, Segmented } from '../components/ui'
import { axisStyle, gridStroke, moneyTick, monthTick, tooltipLabelMonth, tooltipMoney, tooltipStyle } from '../components/charts'
import { useAccounts, useById, useInvestmentMovements, useInvestmentSnapshots, useInvestments } from '../hooks/useData'
import { repo } from '../data/store'
import {
  INVESTMENT_TYPE_LABEL,
  MOVEMENT_LABEL,
  PALETTE,
  type Investment,
  type InvestmentMovement,
  type InvestmentMovementType,
  type InvestmentType,
} from '../db/types'
import { investmentIncome, investmentInvested, investmentValue } from '../lib/calc'
import { endOfYM, lastMonths, ymOf } from '../lib/dates'
import { currentYM, fmtBRL, fmtDate, fmtPct, todayISO } from '../lib/format'

const emptyInv = (): Investment => ({
  name: '',
  type: 'renda_fixa',
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  createdAt: new Date().toISOString(),
})

export function InvestmentsPage() {
  const investments = useInvestments()
  const movements = useInvestmentMovements()
  const snapshots = useInvestmentSnapshots()
  const accounts = useAccounts()
  const invById = useById(investments)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Investment | null>(null)
  const [toDelete, setToDelete] = useState<Investment | null>(null)
  const [movFor, setMovFor] = useState<{ inv: Investment; type: InvestmentMovementType } | null>(null)
  const [snapFor, setSnapFor] = useState<Investment | null>(null)
  const [movDelete, setMovDelete] = useState<InvestmentMovement | null>(null)

  const rows = useMemo(
    () =>
      investments
        .filter((i) => !i.archived)
        .map((i) => {
          const invested = investmentInvested(i, movements)
          const value = investmentValue(i, movements, snapshots)
          const income = investmentIncome(i, movements)
          const result = value - invested + income
          const lastSnap = snapshots.filter((s) => s.investmentId === i.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
          return { inv: i, invested, value, income, result, resultPct: invested > 0 ? result / invested : null, lastSnap }
        })
        .sort((a, b) => b.value - a.value),
    [investments, movements, snapshots],
  )

  const totals = useMemo(() => {
    const t = { invested: 0, value: 0, income: 0 }
    for (const r of rows) {
      t.invested += r.invested
      t.value += r.value
      t.income += r.income
    }
    return { ...t, result: t.value - t.invested + t.income }
  }, [rows])

  const monthAporte = useMemo(() => {
    const ym = currentYM()
    return movements.filter((m) => ymOf(m.date) === ym && m.type === 'aporte').reduce((s, m) => s + m.amount, 0)
  }, [movements])

  const byType = useMemo(() => {
    const m = new Map<InvestmentType, number>()
    for (const r of rows) m.set(r.inv.type, (m.get(r.inv.type) ?? 0) + r.value)
    return [...m.entries()].map(([type, value]) => ({ type, name: INVESTMENT_TYPE_LABEL[type], value })).sort((a, b) => b.value - a.value)
  }, [rows])

  const evolution = useMemo(() => {
    const months = lastMonths(currentYM(), 12)
    return months.map((ym) => {
      const until = endOfYM(ym)
      let value = 0
      let invested = 0
      for (const i of investments) {
        if (i.archived) continue
        value += investmentValue(i, movements, snapshots, until)
        invested += investmentInvested(i, movements, until)
      }
      return { ym, value, invested }
    })
  }, [investments, movements, snapshots])

  const typeColors = useMemo(() => {
    const m = new Map<InvestmentType, string>()
    const keys = Object.keys(INVESTMENT_TYPE_LABEL) as InvestmentType[]
    keys.forEach((k, i) => m.set(k, PALETTE[i % PALETTE.length]))
    return m
  }, [])

  async function remove(i: Investment) {
    if (!i.id) return
    // movimentações e valores são apagados junto (FK on delete cascade)
    await repo.investments.delete(i.id)
  }

  return (
    <>
      <PageHeader
        title="Investimentos"
        subtitle="Carteira, aportes, proventos e evolução"
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>
            <Plus size={16} /> Investimento
          </button>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <Kpi label="Valor atual da carteira" value={fmtBRL(totals.value)} tone="invest" icon={<TrendingUp />} />
        <Kpi label="Total aportado (líquido)" value={fmtBRL(totals.invested)} hint="aportes − resgates" />
        <Kpi
          label="Resultado"
          value={fmtBRL(totals.result)}
          tone={totals.result >= 0 ? 'income' : 'expense'}
          hint={totals.invested ? `${fmtPct(totals.result / totals.invested)} sobre o aportado` : undefined}
        />
        <Kpi label="Proventos recebidos" value={fmtBRL(totals.income)} tone="income" icon={<Coins />} hint="dividendos + rendimentos" />
        <Kpi label="Aportes este mês" value={fmtBRL(monthAporte)} tone="accent" />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Evolução da carteira" subtitle="Valor atual vs. aportado, últimos 12 meses" className="xl:col-span-2">
          {rows.length === 0 ? (
            <EmptyState title="Sem investimentos" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={evolution}>
                  <defs>
                    <linearGradient id="gVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8a00ff" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#8a00ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={gridStroke} />
                  <XAxis dataKey="ym" tickFormatter={monthTick} tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={moneyTick} tick={axisStyle} axisLine={false} tickLine={false} width={70} />
                  <Tooltip formatter={tooltipMoney} labelFormatter={tooltipLabelMonth} {...tooltipStyle} />
                  <Area type="monotone" dataKey="value" name="Valor atual" stroke="#8a00ff" fill="url(#gVal)" strokeWidth={2} />
                  <Area type="monotone" dataKey="invested" name="Aportado" stroke="#c4a1ff" fill="none" strokeDasharray="4 4" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Alocação por tipo">
          {byType.length === 0 ? (
            <EmptyState title="Sem dados" />
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={byType} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                      {byType.map((b) => (
                        <Cell key={b.type} fill={typeColors.get(b.type)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={tooltipMoney} {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 mt-2">
                {byType.map((b) => (
                  <li key={b.type} className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><Dot color={typeColors.get(b.type)!} />{b.name}</span>
                    <span className="text-muted tabular-nums">{fmtPct(b.value / (totals.value || 1))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TrendingUp size={32} />}
            title="Cadastre seus investimentos"
            description="Ações, FIIs, renda fixa, Tesouro, cripto, exterior… Registre aportes e atualize o valor de mercado quando quiser para acompanhar a rentabilidade."
            action={<button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={16} /> Novo investimento</button>}
          />
        </Card>
      ) : (
        <Card bodyClassName="p-0!" title="Carteira">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Investimento</th>
                  <th>Tipo</th>
                  <th className="text-right">Aportado</th>
                  <th className="text-right">Valor atual</th>
                  <th className="text-right">Resultado</th>
                  <th className="text-right">Proventos</th>
                  <th className="text-right">% carteira</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.inv.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Dot color={r.inv.color} />
                        <div>
                          <p className="font-medium">{r.inv.name}{r.inv.ticker && <span className="text-muted text-xs ml-1">({r.inv.ticker})</span>}</p>
                          <p className="text-[11px] text-muted">
                            {r.inv.institution ?? ''}
                            {r.lastSnap ? ` · valor atualizado em ${fmtDate(r.lastSnap.date)}` : ' · sem atualização de valor'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td><Badge color={typeColors.get(r.inv.type)}>{INVESTMENT_TYPE_LABEL[r.inv.type]}</Badge></td>
                    <td className="text-right tabular-nums">{fmtBRL(r.invested)}</td>
                    <td className="text-right tabular-nums font-medium">{fmtBRL(r.value)}</td>
                    <td className={`text-right tabular-nums ${r.result >= 0 ? 'text-income' : 'text-expense'}`}>
                      {fmtBRL(r.result)}
                      {r.resultPct != null && <span className="text-[11px] ml-1">({fmtPct(r.resultPct)})</span>}
                    </td>
                    <td className="text-right tabular-nums text-muted">{fmtBRL(r.income)}</td>
                    <td className="text-right tabular-nums text-muted">{fmtPct(r.value / (totals.value || 1))}</td>
                    <td>
                      <div className="flex justify-end gap-0.5">
                        <button className="btn-ghost p-1.5" title="Aporte" onClick={() => setMovFor({ inv: r.inv, type: 'aporte' })}><ArrowDownToLine size={14} /></button>
                        <button className="btn-ghost p-1.5" title="Resgate" onClick={() => setMovFor({ inv: r.inv, type: 'resgate' })}><ArrowUpFromLine size={14} /></button>
                        <button className="btn-ghost p-1.5" title="Provento (dividendo / rendimento)" onClick={() => setMovFor({ inv: r.inv, type: 'dividendo' })}><Percent size={14} /></button>
                        <button className="btn-ghost p-1.5" title="Atualizar valor atual" onClick={() => setSnapFor(r.inv)}><RefreshCw size={14} /></button>
                        <button className="btn-ghost p-1.5" title="Editar" onClick={() => { setEditing(r.inv); setOpen(true) }}><Pencil size={14} /></button>
                        <button className="btn-ghost p-1.5 hover:text-expense" title="Excluir" onClick={() => setToDelete(r.inv)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {movements.length > 0 && (
        <Card title="Histórico de movimentações" className="mt-4" bodyClassName="p-0!">
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="table">
              <thead>
                <tr><th>Data</th><th>Investimento</th><th>Tipo</th><th className="text-right">Valor</th><th>Obs.</th><th></th></tr>
              </thead>
              <tbody>
                {movements.slice(0, 100).map((m) => (
                  <tr key={m.id}>
                    <td className="text-muted whitespace-nowrap">{fmtDate(m.date)}</td>
                    <td>{invById.get(m.investmentId)?.name ?? '—'}</td>
                    <td><Badge className={m.type === 'resgate' ? 'bg-expense/15 text-expense' : m.type === 'aporte' ? 'bg-invest/15 text-invest' : 'bg-income/15 text-income'}>{MOVEMENT_LABEL[m.type]}</Badge></td>
                    <td className="text-right tabular-nums">{fmtBRL(m.amount)}</td>
                    <td className="text-xs text-muted">{m.notes}</td>
                    <td className="text-right"><button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setMovDelete(m)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <InvestmentModal open={open} onClose={() => setOpen(false)} editing={editing} />
      <MovementModal
        open={!!movFor}
        onClose={() => setMovFor(null)}
        inv={movFor?.inv ?? null}
        initialType={movFor?.type ?? 'aporte'}
        accounts={accounts.filter((a) => !a.archived).map((a) => ({ id: a.id!, name: a.name }))}
      />
      <SnapshotModal open={!!snapFor} onClose={() => setSnapFor(null)} inv={snapFor} currentValue={snapFor ? investmentValue(snapFor, movements, snapshots) : 0} />
      <Confirm open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove(toDelete)} message={<>Excluir “{toDelete?.name}” e todo o seu histórico de aportes e valores?</>} />
      <Confirm open={!!movDelete} onClose={() => setMovDelete(null)} onConfirm={() => movDelete?.id && repo.investmentMovements.delete(movDelete.id)} message="Excluir esta movimentação?" />
    </>
  )
}

function InvestmentModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Investment | null }) {
  const [form, setForm] = useState<Investment>(editing ?? emptyInv())
  const [err, setErr] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ?? emptyInv())
      setErr('')
    }
  }
  const set = <K extends keyof Investment>(k: K, v: Investment[K]) => setForm((f) => ({ ...f, [k]: v }))
  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome ao investimento.')
    const payload = { ...form, name: form.name.trim() }
    if (editing?.id) await repo.investments.put({ ...payload, id: editing.id })
    else await repo.investments.add(payload)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar investimento' : 'Novo investimento'} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="space-y-4">
        <Field label="Nome"><input className="input" autoFocus placeholder="Ex.: CDB Inter 110% CDI, PETR4, Bitcoin" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className="input" value={form.type} onChange={(e) => set('type', e.target.value as InvestmentType)}>
              {(Object.keys(INVESTMENT_TYPE_LABEL) as InvestmentType[]).map((t) => <option key={t} value={t}>{INVESTMENT_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Ticker / código (opcional)"><input className="input" value={form.ticker ?? ''} onChange={(e) => set('ticker', e.target.value.toUpperCase() || undefined)} /></Field>
        </div>
        <Field label="Instituição / corretora"><input className="input" value={form.institution ?? ''} onChange={(e) => set('institution', e.target.value || undefined)} placeholder="XP, Nubank, Binance…" /></Field>
        <Field label="Cor"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
        <Field label="Observações"><textarea className="input min-h-[60px]" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}

function MovementModal({ open, onClose, inv, initialType, accounts }: { open: boolean; onClose: () => void; inv: Investment | null; initialType: InvestmentMovementType; accounts: { id: number; name: string }[] }) {
  const [type, setType] = useState<InvestmentMovementType>(initialType)
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [createTx, setCreateTx] = useState(true)
  const [accountId, setAccountId] = useState<number | undefined>(accounts[0]?.id)
  const [err, setErr] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setType(initialType)
      setAmount(0)
      setDate(todayISO())
      setNotes('')
      setErr('')
      setAccountId(accounts[0]?.id)
    }
  }

  async function save() {
    if (!inv?.id) return
    if (!amount) return setErr('Informe o valor.')
    await repo.investmentMovements.add({ investmentId: inv.id, date, type, amount, notes: notes || undefined })
    if (createTx && accountId && (type === 'aporte' || type === 'resgate' || type === 'dividendo')) {
        // reflete o movimento no fluxo de caixa das contas.
        // aporte/resgate são movimentações de patrimônio (não despesa/receita):
        // registradas como transferência entre a conta e a carteira de investimentos
        if (type === 'aporte') {
          await repo.transactions.add({ date, amount, type: 'transfer', description: `Aporte: ${inv.name}`, accountId, notes: 'Saída para investimentos', createdAt: new Date().toISOString() })
        } else if (type === 'resgate') {
          await repo.transactions.add({ date, amount, type: 'transfer', description: `Resgate: ${inv.name}`, toAccountId: accountId, notes: 'Entrada vinda de investimentos', createdAt: new Date().toISOString() })
        } else {
          const cat = repo.categories.rows().find((c) => c.type === 'income' && /dividendo|lucro|rendimento/i.test(c.name))
          await repo.transactions.add({ date, amount, type: 'income', description: `Dividendos: ${inv.name}`, categoryId: cat?.id, accountId, createdAt: new Date().toISOString() })
        }
    }
    onClose()
  }

  const showTx = type !== 'rendimento'
  return (
    <Modal open={open} onClose={onClose} title={`${MOVEMENT_LABEL[type]} · ${inv?.name ?? ''}`} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Registrar</button></>}>
      <div className="space-y-4">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'aporte', label: 'Aporte' },
            { value: 'resgate', label: 'Resgate' },
            { value: 'dividendo', label: 'Dividendo' },
            { value: 'rendimento', label: 'Rendimento' },
          ]}
        />
        <p className="text-xs text-muted">
          {type === 'aporte' && 'Dinheiro que entrou no investimento.'}
          {type === 'resgate' && 'Dinheiro que saiu do investimento para a sua conta.'}
          {type === 'dividendo' && 'Provento pago em dinheiro na sua conta (não altera o valor investido).'}
          {type === 'rendimento' && 'Juros/valorização incorporados ao próprio investimento (sem passar pela conta).'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Data"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Observações"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {showTx && (
          <div className="rounded-xl border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createTx} onChange={(e) => setCreateTx(e.target.checked)} />
              Criar lançamento correspondente nas transações
            </label>
            {createTx && (
              <Field label={type === 'aporte' ? 'Conta de origem do dinheiro' : 'Conta que recebe'}>
                <select className="input" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}

function SnapshotModal({ open, onClose, inv, currentValue }: { open: boolean; onClose: () => void; inv: Investment | null; currentValue: number }) {
  const [value, setValue] = useState(currentValue)
  const [date, setDate] = useState(todayISO())
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setValue(currentValue)
      setDate(todayISO())
    }
  }
  async function save() {
    if (!inv?.id) return
    await repo.investmentSnapshots.upsert({ investmentId: inv.id, date, value }, 'investment_id,date')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Atualizar valor · ${inv?.name ?? ''}`} width="max-w-sm" footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="space-y-4">
        <p className="text-xs text-muted">Informe quanto este investimento vale hoje (saldo na corretora). Aportes e resgates feitos depois desta data ajustam o valor automaticamente.</p>
        <Field label="Valor de mercado"><MoneyInput value={value} onChange={setValue} autoFocus /></Field>
        <Field label="Data da cotação"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
