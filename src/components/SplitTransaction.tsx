import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field, Modal, MoneyInput } from './ui'
import { repo } from '../data/store'
import { useCategories, useRecurringExpenses } from '../hooks/useData'
import type { Transaction } from '../db/types'
import { fmtBRL } from '../lib/format'

interface Part {
  amount: number
  description: string
  categoryId?: number
  recurringExpenseId?: number
}

/**
 * Divide um lançamento em várias partes (ex.: um Pix só que paga aluguel, internet e luz).
 * A primeira parte fica no lançamento original (mantém o vínculo com o banco); as demais viram
 * lançamentos novos na mesma data e conta. A soma das partes precisa bater com o valor original.
 */
export function SplitTransaction({ open, onClose, tx }: { open: boolean; onClose: () => void; tx: Transaction | null }) {
  const categories = useCategories()
  const bills = useRecurringExpenses()
  const [parts, setParts] = useState<Part[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && tx) {
      setParts([
        { amount: tx.amount, description: tx.description, categoryId: tx.categoryId, recurringExpenseId: tx.recurringExpenseId },
        { amount: 0, description: '' },
      ])
      setError('')
    }
  }, [open, tx])

  if (!tx) return null
  const cats = categories.filter((c) => !c.archived && c.type === tx.type)
  const activeBills = bills.filter((b) => b.active)
  const total = parts.reduce((s, p) => s + (p.amount || 0), 0)
  const remainder = Math.round((tx.amount - total) * 100) / 100

  const set = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const onBill = (i: number, id?: number) => {
    const bill = activeBills.find((b) => b.id === id)
    set(i, {
      recurringExpenseId: id,
      description: parts[i].description || bill?.name || '',
      categoryId: parts[i].categoryId ?? bill?.categoryId,
      amount: parts[i].amount || bill?.amount || 0,
    })
  }
  /** joga a diferença na última parte */
  const fillRemainder = () => setParts((ps) => ps.map((p, idx) => (idx === ps.length - 1 ? { ...p, amount: Math.round((p.amount + remainder) * 100) / 100 } : p)))

  async function save() {
    if (!tx?.id) return
    const clean = parts.filter((p) => p.amount > 0)
    if (clean.length < 2) return setError('Informe pelo menos duas partes com valor.')
    if (Math.abs(remainder) >= 0.01) return setError(`As partes somam ${fmtBRL(total)}, mas o lançamento é de ${fmtBRL(tx.amount)}. Falta ${fmtBRL(remainder)}.`)
    if (clean.some((p) => !p.description.trim())) return setError('Dê uma descrição a cada parte.')
    setSaving(true)
    setError('')
    try {
      const note = `Parte de "${tx.description}" (${fmtBRL(tx.amount)})`
      const tags = Array.from(new Set([...(tx.tags ?? []), 'dividido']))
      const [first, ...rest] = clean
      await repo.transactions.put({
        ...tx,
        id: tx.id,
        amount: first.amount,
        description: first.description.trim(),
        categoryId: first.categoryId,
        recurringExpenseId: tx.type === 'expense' ? first.recurringExpenseId : undefined,
        notes: tx.notes ? `${tx.notes} · ${note}` : note,
        tags,
      })
      await repo.transactions.bulkAdd(
        rest.map((p) => ({
          date: tx.date,
          amount: p.amount,
          type: tx.type,
          description: p.description.trim(),
          categoryId: p.categoryId,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId,
          incomeSourceId: tx.incomeSourceId,
          recurringExpenseId: tx.type === 'expense' ? p.recurringExpenseId : undefined,
          notes: note,
          tags,
          createdAt: new Date().toISOString(),
        })),
      )
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dividir lançamento"
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Dividir'}</button>
        </>
      }
    >
      <p className="text-sm text-muted mb-4">
        <b className="text-text">{tx.description}</b> · {fmtBRL(tx.amount)}. As partes precisam somar o valor original. A primeira parte continua ligada ao banco.
      </p>
      <div className="space-y-3">
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-xl border border-border p-3">
            <div className="col-span-12 sm:col-span-3"><Field label="Valor"><MoneyInput value={p.amount} onChange={(v) => set(i, { amount: v })} /></Field></div>
            <div className="col-span-12 sm:col-span-4"><Field label="Descrição"><input className="input" value={p.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Aluguel, Internet…" /></Field></div>
            <div className="col-span-6 sm:col-span-2">
              <Field label="Categoria">
                <select className="input" value={p.categoryId ?? ''} onChange={(e) => set(i, { categoryId: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">—</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            {tx.type === 'expense' && (
              <div className="col-span-5 sm:col-span-2">
                <Field label="Despesa fixa">
                  <select className="input" value={p.recurringExpenseId ?? ''} onChange={(e) => onBill(i, e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">—</option>
                    {activeBills.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <div className="col-span-1 flex justify-end">
              {parts.length > 2 && (
                <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setParts((ps) => ps.filter((_, idx) => idx !== i))} aria-label="Remover parte"><Trash2 size={14} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm">
        <button className="btn-secondary py-1.5!" onClick={() => setParts((ps) => [...ps, { amount: 0, description: '' }])}><Plus size={14} /> Parte</button>
        <span className={Math.abs(remainder) < 0.01 ? 'text-income' : 'text-expense'}>
          Soma {fmtBRL(total)} de {fmtBRL(tx.amount)}
          {Math.abs(remainder) >= 0.01 && (
            <> · <button className="underline underline-offset-2" onClick={fillRemainder}>jogar {fmtBRL(remainder)} na última parte</button></>
          )}
        </span>
      </div>
      {error && <p className="text-sm text-expense mt-3">{error}</p>}
    </Modal>
  )
}
