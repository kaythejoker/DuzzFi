import { useState } from 'react'
import { AlertTriangle, CalendarCheck, Pencil, Plus, Repeat, Trash2, Wallet } from 'lucide-react'
import { PageHeader } from '../components/Shell'
import { ScheduleGrid } from '../components/Schedule'
import { TransactionForm } from '../components/TransactionForm'
import { Badge, Card, ColorPicker, Confirm, Dot, EmptyState, Field, Kpi, Modal, MoneyInput } from '../components/ui'
import { useAccounts, useById, useCategories, useIncomeSources, useRecurringExpenses, useTransactions } from '../hooks/useData'
import { repo } from '../data/store'
import { PALETTE, type Category, type RecurringExpense, type Transaction } from '../db/types'
import { billItems, upcomingBills } from '../lib/payday'
import { ymOf } from '../lib/dates'
import { fmtBRL, fmtDate, fmtMonthLong, fmtPct, todayISO } from '../lib/format'

/** Sugestões para começar: nome + categoria padrão */
const SUGGESTIONS: { name: string; category: string }[] = [
  { name: 'Aluguel', category: 'Moradia' },
  { name: 'Condomínio', category: 'Moradia' },
  { name: 'Luz', category: 'Moradia' },
  { name: 'Internet', category: 'Moradia' },
  { name: 'Celular', category: 'Assinaturas' },
  { name: 'Academia', category: 'Cuidados pessoais' },
  { name: 'Plano de saúde', category: 'Saúde' },
  { name: 'Streaming', category: 'Assinaturas' },
]

const emptyBill = (): RecurringExpense => ({
  name: '',
  amount: 0,
  dueDay: 10,
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  active: true,
})

export function RecurringPage() {
  const bills = useRecurringExpenses()
  const txs = useTransactions()
  const categories = useCategories()
  const accounts = useAccounts()
  const sources = useIncomeSources()
  const catById = useById(categories)
  const accById = useById(accounts)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringExpense | null>(null)
  const [preset, setPreset] = useState<Partial<RecurringExpense> | null>(null)
  const [toDelete, setToDelete] = useState<RecurringExpense | null>(null)
  const [txDefaults, setTxDefaults] = useState<Partial<Transaction> | null>(null)

  const today = todayISO()
  const ym = ymOf(today)
  const events = upcomingBills(bills, txs, today)
  const statusById = new Map(events.map((e) => [e.item.id, e]))

  const active = bills.filter((b) => b.active)
  const totalMonthly = active.reduce((s, b) => s + b.amount, 0)
  const paid = events.filter((e) => e.status === 'done').reduce((s, e) => s + e.doneThisMonth, 0)
  const pending = events.filter((e) => e.status !== 'done')
  const pendingTotal = pending.reduce((s, e) => s + e.item.amount, 0)
  const lateCount = pending.filter((e) => e.status === 'late').length
  const expectedIncome = sources.filter((s) => s.active).reduce((s, x) => s + x.expectedMonthly, 0)

  function openNew(p?: Partial<RecurringExpense>) {
    setEditing(null)
    setPreset(p ?? null)
    setOpen(true)
  }

  /** Abre o lançamento do pagamento já vinculado à despesa fixa */
  function pay(b: RecurringExpense, due: string) {
    setTxDefaults({
      type: 'expense',
      amount: b.amount,
      description: b.name,
      categoryId: b.categoryId,
      ...(b.accountId != null ? { accountId: b.accountId } : {}),
      // vencida: sugere o dia do vencimento; ainda por vir: paga hoje
      date: due < today ? due : today,
      recurringExpenseId: b.id,
    })
  }

  const sorted = [...bills].sort((a, b) => Number(b.active) - Number(a.active) || a.dueDay - b.dueDay)

  return (
    <>
      <PageHeader
        title="Despesas fixas"
        subtitle="Aluguel, contas e assinaturas que se repetem todo mês, com dia de vencimento"
        actions={
          <button className="btn-primary" onClick={() => openNew()}>
            <Plus size={16} /> Despesa fixa
          </button>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total fixo / mês" value={fmtBRL(totalMonthly)} tone="expense" icon={<Repeat />} hint={`${active.length} conta(s) ativa(s)`} />
        <Kpi label={`Pago em ${fmtMonthLong(ym).split(' ')[0]}`} value={fmtBRL(paid)} tone="income" icon={<CalendarCheck />} hint={totalMonthly ? `${fmtPct(paid / totalMonthly)} do total` : undefined} />
        <Kpi
          label="Falta pagar"
          value={fmtBRL(pendingTotal)}
          tone={lateCount ? 'expense' : 'neutral'}
          icon={<AlertTriangle />}
          hint={lateCount ? `${lateCount} vencida(s) sem pagamento` : `${pending.length} conta(s) no mês`}
        />
        <Kpi
          label="Peso na renda"
          value={expectedIncome ? fmtPct(totalMonthly / expectedIncome) : '—'}
          tone="accent"
          icon={<Wallet />}
          hint={expectedIncome ? `da renda esperada (${fmtBRL(expectedIncome)})` : 'Cadastre fontes de renda para comparar'}
        />
      </div>

      {bills.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat size={32} />}
            title="Cadastre suas despesas fixas"
            description="Tudo que se repete todo mês: aluguel, condomínio, contas, academia, assinaturas. Você vê o que vence, o que já pagou e quanto da renda já está comprometido."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.name}
                    className="btn-secondary py-1.5! text-xs!"
                    onClick={() => openNew({ name: s.name, categoryId: categories.find((c) => c.type === 'expense' && c.name === s.category)?.id })}
                  >
                    <Plus size={12} /> {s.name}
                  </button>
                ))}
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {events.length > 0 && (
            <Card title={`Calendário de ${fmtMonthLong(ym)}`} subtitle="Lance o pagamento para marcar como pago" className="mb-4">
              <ScheduleGrid
                items={billItems(events, (e) => pay(e.item, e.date))}
                doneLabel="pago"
                actionLabel="pagar"
                lateHint="Vencida e sem pagamento lançado neste mês."
              />
            </Card>
          )}

          <Card title="Todas as despesas fixas" bodyClassName="p-0!">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Despesa</th>
                    <th>Vence</th>
                    <th>Categoria</th>
                    <th>Conta</th>
                    <th>Este mês</th>
                    <th className="text-right">Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((b) => {
                    const cat = b.categoryId != null ? catById.get(b.categoryId) : undefined
                    const acc = b.accountId != null ? accById.get(b.accountId) : undefined
                    const ev = statusById.get(b.id)
                    return (
                      <tr key={b.id} className={!b.active ? 'opacity-50' : ''}>
                        <td>
                          <span className="flex items-center gap-2 font-medium"><Dot color={b.color} /> {b.name}</span>
                          {b.notes && <p className="text-xs text-muted truncate max-w-[260px]">{b.notes}</p>}
                        </td>
                        <td className="font-mono text-xs text-muted whitespace-nowrap">dia {b.dueDay}</td>
                        <td>{cat ? <Badge color={cat.color}>{cat.name}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                        <td className="text-xs text-muted whitespace-nowrap">{acc?.name ?? '—'}</td>
                        <td className="text-xs whitespace-nowrap">
                          {!b.active ? (
                            <span className="text-muted">inativa</span>
                          ) : !ev ? (
                            <span className="text-muted">fora do período</span>
                          ) : ev.status === 'done' ? (
                            <span className="text-income">pago {fmtBRL(ev.doneThisMonth)}</span>
                          ) : ev.status === 'late' ? (
                            <span className="text-warn">vencida em {fmtDate(ev.date, 'dd/MM')}</span>
                          ) : (
                            <span className="text-muted">vence {fmtDate(ev.date, 'dd/MM')}</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{fmtBRL(b.amount)}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {ev && ev.status !== 'done' && (
                              <button className="btn-ghost px-2 py-1 text-xs text-brand" onClick={() => pay(b, ev.date)}>pagar</button>
                            )}
                            <button className="btn-ghost p-1.5" onClick={() => { setEditing(b); setPreset(null); setOpen(true) }} aria-label="Editar"><Pencil size={14} /></button>
                            <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setToDelete(b)} aria-label="Excluir"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <BillModal
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        preset={preset}
        categories={categories.filter((c) => c.type === 'expense' && !c.archived)}
        accounts={accounts.filter((a) => !a.archived)}
      />
      <TransactionForm open={!!txDefaults} onClose={() => setTxDefaults(null)} defaults={txDefaults ?? undefined} />
      <Confirm
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete?.id && repo.recurringExpenses.delete(toDelete.id)}
        message={<>Excluir “{toDelete?.name}”? Os pagamentos já lançados continuam, só perdem o vínculo.</>}
      />
    </>
  )
}

function BillModal({
  open,
  onClose,
  editing,
  preset,
  categories,
  accounts,
}: {
  open: boolean
  onClose: () => void
  editing: RecurringExpense | null
  preset: Partial<RecurringExpense> | null
  categories: Category[]
  accounts: { id?: number; name: string }[]
}) {
  const [form, setForm] = useState<RecurringExpense>(emptyBill())
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ? { ...editing } : { ...emptyBill(), ...preset })
      setErr('')
    }
  }
  const set = <K extends keyof RecurringExpense>(k: K, v: RecurringExpense[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome (ex.: Aluguel).')
    if (!form.amount || form.amount <= 0) return setErr('Informe o valor mensal.')
    if (!form.dueDay) return setErr('Informe o dia do vencimento.')
    // só os campos da tabela
    const payload: RecurringExpense = {
      name: form.name.trim(),
      amount: form.amount,
      dueDay: form.dueDay,
      categoryId: form.categoryId,
      accountId: form.accountId,
      color: form.color,
      notes: form.notes?.trim() || undefined,
      active: form.active,
      startDate: form.startDate,
      endDate: form.endDate,
    }
    setSaving(true)
    setErr('')
    try {
      if (editing?.id) await repo.recurringExpenses.put({ ...payload, id: editing.id })
      else await repo.recurringExpenses.add(payload)
      onClose()
    } catch (e) {
      setErr(`Não consegui salvar: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar despesa fixa' : 'Nova despesa fixa'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          <input className="input" autoFocus placeholder="Ex.: Aluguel, Internet, Academia" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor por mês">
            <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} />
          </Field>
          <Field label="Dia do vencimento (1 a 31)">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              className="input"
              value={form.dueDay || ''}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                set('dueDay', n ? Math.min(31, Math.max(1, n)) : 0)
              }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria">
            <select className="input" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">— Sem categoria —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Conta que paga">
            <select className="input" value={form.accountId ?? ''} onChange={(e) => set('accountId', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">— Qualquer —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Começa em">
            <input type="date" className="input" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || undefined)} />
          </Field>
          <Field label="Termina em (opcional)">
            <input type="date" className="input" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
          </Field>
        </div>
        <Field label="Cor"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
        <Field label="Observações">
          <textarea className="input min-h-[60px]" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Contrato, chave Pix do proprietário, reajuste anual…" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Ativa
        </label>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}
