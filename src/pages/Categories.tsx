import { useMemo, useState } from 'react'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/Shell'
import { MonthPicker } from '../components/MonthPicker'
import { Card, ColorPicker, Confirm, Dot, EmptyState, Field, Modal, MoneyInput, ProgressBar, Segmented } from '../components/ui'
import { useCategories, useTransactions } from '../hooks/useData'
import { useMonth } from '../hooks/useMonth'
import { repo } from '../data/store'
import { PALETTE, type Category } from '../db/types'
import { sumByCategory } from '../lib/calc'
import { fmtBRL, fmtPct } from '../lib/format'
import { lastMonths } from '../lib/dates'

const emptyCat = (type: 'expense' | 'income'): Category => ({
  name: '',
  type,
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  budget: undefined,
  keywords: [],
})

export function CategoriesPage() {
  const [ym, setYm] = useMonth()
  const [tab, setTab] = useState<'expense' | 'income'>('expense')
  const categories = useCategories()
  const txs = useTransactions()
  const [editing, setEditing] = useState<Category | null>(null)
  const [open, setOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Category | null>(null)

  const spent = useMemo(() => sumByCategory(txs, ym, tab), [txs, ym, tab])
  const avg3 = useMemo(() => {
    const months = lastMonths(ym, 3)
    const m = new Map<number | undefined, number>()
    for (const mo of months) {
      for (const [id, v] of sumByCategory(txs, mo, tab)) m.set(id, (m.get(id) ?? 0) + v / 3)
    }
    return m
  }, [txs, ym, tab])

  const list = useMemo(
    () =>
      categories
        .filter((c) => c.type === tab && !c.archived)
        .map((c) => ({ ...c, spent: spent.get(c.id) ?? 0, avg: avg3.get(c.id) ?? 0 }))
        .sort((a, b) => b.spent - a.spent),
    [categories, tab, spent, avg3],
  )
  const total = list.reduce((s, c) => s + c.spent, 0)
  const totalBudget = list.reduce((s, c) => s + (c.budget ?? 0), 0)
  const uncategorized = spent.get(undefined) ?? 0

  async function remove(c: Category) {
    if (!c.id) return
    // o banco deixa os lançamentos desta categoria como "sem categoria" (FK on delete set null)
    await repo.categories.delete(c.id)
  }

  return (
    <>
      <PageHeader
        title="Categorias & Orçamento"
        subtitle="Organize seus gastos e defina limites mensais"
        actions={
          <>
            <MonthPicker value={ym} onChange={setYm} />
            <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>
              <Plus size={16} /> Categoria
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'expense', label: 'Despesas' }, { value: 'income', label: 'Receitas' }]} />
        <div className="text-sm text-muted">
          Total no mês: <b className="text-text">{fmtBRL(total)}</b>
          {tab === 'expense' && totalBudget > 0 && (
            <> · Orçamento: <b className="text-text">{fmtBRL(totalBudget)}</b> ({fmtPct(total / totalBudget)})</>
          )}
          {uncategorized > 0 && <> · Sem categoria: <b className="text-warn">{fmtBRL(uncategorized)}</b></>}
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Tags size={32} />} title="Nenhuma categoria" action={<button className="btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>Criar categoria</button>} />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((c) => {
            const pctOfTotal = total ? c.spent / total : 0
            const over = c.budget && c.spent > c.budget
            return (
              <div key={c.id} className="card p-4 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${c.color}22` }}>
                      <Dot color={c.color} size={12} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted">{fmtPct(pctOfTotal)} do total · média 3m {fmtBRL(c.avg)}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button className="btn-ghost p-1.5" onClick={() => { setEditing(c); setOpen(true) }} aria-label="Editar"><Pencil size={14} /></button>
                    <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setToDelete(c)} aria-label="Excluir"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <p className={`text-xl font-semibold ${over ? 'text-expense' : ''}`}>{fmtBRL(c.spent)}</p>
                  {c.type === 'expense' && c.budget ? (
                    <p className="text-xs text-muted">
                      limite {fmtBRL(c.budget)} · {over ? <span className="text-expense">estourou {fmtBRL(c.spent - c.budget)}</span> : <span className="text-income">resta {fmtBRL(c.budget - c.spent)}</span>}
                    </p>
                  ) : c.type === 'expense' ? (
                    <button className="text-xs text-muted hover:text-brand cursor-pointer" onClick={() => { setEditing(c); setOpen(true) }}>definir limite</button>
                  ) : null}
                </div>
                <div className="mt-2">
                  <ProgressBar value={c.spent} max={c.budget ?? total} color={c.color} />
                </div>
                {c.keywords && c.keywords.length > 0 && (
                  <p className="text-[11px] text-muted mt-2 truncate" title={c.keywords.join(', ')}>
                    auto: {c.keywords.slice(0, 4).join(', ')}{c.keywords.length > 4 ? '…' : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <CategoryModal open={open} onClose={() => setOpen(false)} editing={editing} defaultType={tab} />
      <Confirm
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove(toDelete)}
        message={<>Excluir a categoria “{toDelete?.name}”? Os lançamentos ficarão “sem categoria”.</>}
      />
    </>
  )
}

function CategoryModal({ open, onClose, editing, defaultType }: { open: boolean; onClose: () => void; editing: Category | null; defaultType: 'expense' | 'income' }) {
  const [form, setForm] = useState<Category>(editing ?? emptyCat(defaultType))
  const [kw, setKw] = useState((editing?.keywords ?? []).join(', '))
  const [err, setErr] = useState('')

  // reinicializa ao abrir
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ?? emptyCat(defaultType))
      setKw((editing?.keywords ?? []).join(', '))
      setErr('')
    }
  }

  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome à categoria.')
    const payload: Category = {
      ...form,
      name: form.name.trim(),
      keywords: kw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      budget: form.type === 'expense' && form.budget ? form.budget : undefined,
    }
    if (editing?.id) await repo.categories.put({ ...payload, id: editing.id })
    else await repo.categories.add(payload)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar categoria' : 'Nova categoria'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}
    >
      <div className="space-y-4">
        <Segmented value={form.type} onChange={(t) => setForm({ ...form, type: t })} options={[{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }]} />
        <Field label="Nome">
          <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {form.type === 'expense' && (
          <Field label="Limite mensal (orçamento)" hint="Deixe vazio para não acompanhar orçamento nesta categoria.">
            <MoneyInput value={form.budget ?? 0} onChange={(v) => setForm({ ...form, budget: v || undefined })} />
          </Field>
        )}
        <Field label="Cor">
          <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
        </Field>
        <Field label="Palavras-chave para importação automática" hint="Separe por vírgula. Ao importar extratos, lançamentos cuja descrição contenha uma dessas palavras caem nesta categoria.">
          <textarea className="input min-h-[70px]" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="ifood, mercado, padaria" />
        </Field>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}
