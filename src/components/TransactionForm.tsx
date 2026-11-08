import { useEffect, useMemo, useState } from 'react'
import { repo } from '../data/store'
import type { Transaction, TxType } from '../db/types'
import { useAccounts, useCategories, useIncomeSources, useRecurringExpenses } from '../hooks/useData'
import { todayISO } from '../lib/format'
import { Field, Modal, MoneyInput, Segmented } from './ui'

export interface TransactionFormProps {
  open: boolean
  onClose: () => void
  /** transação existente para edição */
  editing?: Transaction | null
  /** valores iniciais ao criar */
  defaults?: Partial<Transaction>
}

export function TransactionForm({ open, onClose, editing, defaults }: TransactionFormProps) {
  const accounts = useAccounts()
  const categories = useCategories()
  const sources = useIncomeSources()
  const bills = useRecurringExpenses()

  const base = useMemo<Transaction>(
    () => ({
      date: todayISO(),
      amount: 0,
      type: 'expense',
      description: '',
      accountId: accounts.find((a) => !a.archived)?.id,
      createdAt: new Date().toISOString(),
      ...defaults,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaults, accounts.length],
  )

  const [form, setForm] = useState<Transaction>(editing ?? base)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(editing ? { ...editing } : base)
      setError(null)
    }
  }, [open, editing, base])

  const cats = useMemo(
    () => categories.filter((c) => !c.archived && (form.type === 'transfer' ? false : c.type === form.type)),
    [categories, form.type],
  )
  const activeAccounts = accounts.filter((a) => !a.archived)
  const bankAccounts = activeAccounts.filter((a) => a.type !== 'credit_card')
  const cards = activeAccounts.filter((a) => a.type === 'credit_card')

  function set<K extends keyof Transaction>(k: K, v: Transaction[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function setType(t: TxType) {
    setForm((f) => ({
      ...f,
      type: t,
      categoryId: undefined,
      incomeSourceId: t === 'income' ? f.incomeSourceId : undefined,
      recurringExpenseId: t === 'expense' ? f.recurringExpenseId : undefined,
    }))
  }

  function onBillChange(id: number | undefined) {
    const bill = bills.find((b) => b.id === id)
    setForm((f) => ({
      ...f,
      recurringExpenseId: id,
      categoryId: f.categoryId ?? bill?.categoryId,
      description: f.description || (bill ? bill.name : ''),
      amount: f.amount || bill?.amount || 0,
    }))
  }

  function onSourceChange(id: number | undefined) {
    const src = sources.find((s) => s.id === id)
    setForm((f) => ({
      ...f,
      incomeSourceId: id,
      categoryId: f.categoryId ?? src?.defaultCategoryId,
      description: f.description || (src ? src.name : ''),
    }))
  }

  async function save(andNew = false) {
    if (!form.amount || form.amount <= 0) return setError('Informe um valor maior que zero.')
    if (!form.date) return setError('Informe a data.')
    if (form.type === 'transfer' && (!form.toAccountId || form.toAccountId === form.accountId))
      return setError('Escolha uma conta de destino diferente da origem.')
    setSaving(true)
    try {
      const payload: Transaction = {
        ...form,
        description: form.description.trim() || (form.type === 'transfer' ? 'Transferência' : 'Sem descrição'),
        tags: form.tags?.filter(Boolean),
      }
      if (payload.type !== 'transfer') delete payload.toAccountId
      if (payload.type !== 'income') delete payload.incomeSourceId
      if (payload.type !== 'expense') delete payload.recurringExpenseId
      if (editing?.id) await repo.transactions.put({ ...payload, id: editing.id })
      else await repo.transactions.add(payload)
      if (andNew) {
        setForm({ ...base, type: form.type, date: form.date, accountId: form.accountId })
      } else onClose()
    } catch (e) {
      setError(`Não consegui salvar: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar lançamento' : 'Novo lançamento'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          {!editing && (
            <button className="btn-secondary" disabled={saving} onClick={() => save(true)}>
              Salvar e novo
            </button>
          )}
          <button className="btn-primary" disabled={saving} onClick={() => save(false)}>
            Salvar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={form.type}
          onChange={setType}
          options={[
            { value: 'expense', label: 'Despesa' },
            { value: 'income', label: 'Receita' },
            { value: 'transfer', label: 'Transferência' },
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor">
            <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} autoFocus />
          </Field>
          <Field label="Data">
            <input type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>

        <Field label="Descrição">
          <input
            className="input"
            placeholder={form.type === 'income' ? 'Ex.: Salário outubro' : 'Ex.: Mercado'}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        {form.type === 'income' && (
          <Field label="Fonte de renda" hint="Cadastre fontes em “Fontes de renda” para acompanhar CLT, sociedades, empresas etc.">
            <select
              className="input"
              value={form.incomeSourceId ?? ''}
              onChange={(e) => onSourceChange(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">— Nenhuma —</option>
              {sources.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        )}

        {form.type === 'expense' && bills.length > 0 && (
          <Field label="Despesa fixa" hint="Vincule para marcar a conta como paga neste mês.">
            <select
              className="input"
              value={form.recurringExpenseId ?? ''}
              onChange={(e) => onBillChange(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">— Nenhuma —</option>
              {bills.filter((b) => b.active || b.id === form.recurringExpenseId).map((b) => (
                <option key={b.id} value={b.id}>{b.name} (dia {b.dueDay})</option>
              ))}
            </select>
          </Field>
        )}

        {form.type !== 'transfer' && (
          <Field label="Categoria">
            <select
              className="input"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">— Sem categoria —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={form.type === 'transfer' ? 'Conta de origem' : 'Conta'}>
            <select
              className="input"
              value={form.accountId ?? ''}
              onChange={(e) => set('accountId', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">— Nenhuma —</option>
              <optgroup label="Contas">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </optgroup>
              {cards.length > 0 && form.type !== 'transfer' && (
                <optgroup label="Cartões de crédito">
                  {cards.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          {form.type === 'transfer' && (
            <Field label="Conta de destino">
              <select
                className="input"
                value={form.toAccountId ?? ''}
                onChange={(e) => set('toAccountId', e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">— Escolha —</option>
                <optgroup label="Contas">
                  {bankAccounts.filter((a) => a.id !== form.accountId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
                {cards.length > 0 && (
                  <optgroup label="Pagar fatura do cartão">
                    {cards.filter((a) => a.id !== form.accountId).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
          )}
        </div>

        <Field label="Observações">
          <textarea className="input min-h-[60px]" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {error && <p className="text-sm text-expense">{error}</p>}
      </div>
    </Modal>
  )
}
