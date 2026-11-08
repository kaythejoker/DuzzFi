import { useMemo, useState } from 'react'
import { ArrowLeftRight, Pencil, Plus, Scissors, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/Shell'
import { MonthPicker } from '../components/MonthPicker'
import { TransactionForm } from '../components/TransactionForm'
import { SplitTransaction } from '../components/SplitTransaction'
import { Badge, Card, Confirm, EmptyState, Money, Segmented } from '../components/ui'
import { useAccounts, useById, useCategories, useIncomeSources, useTransactions } from '../hooks/useData'
import { useMonth } from '../hooks/useMonth'
import { repo } from '../data/store'
import type { Transaction, TxType } from '../db/types'
import { ymOf } from '../lib/dates'
import { fmtBRL, fmtDate } from '../lib/format'

type Filter = 'all' | TxType

export function TransactionsPage() {
  const [ym, setYm] = useMonth()
  const [allMonths, setAllMonths] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<number | 'all'>('all')
  const [accFilter, setAccFilter] = useState<number | 'all'>('all')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [toDelete, setToDelete] = useState<Transaction | null>(null)
  const [splitting, setSplitting] = useState<Transaction | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDelete, setBulkDelete] = useState(false)

  const txs = useTransactions()
  const categories = useCategories()
  const accounts = useAccounts()
  const sources = useIncomeSources()
  const catById = useById(categories)
  const accById = useById(accounts)
  const srcById = useById(sources)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return txs.filter((t) => {
      if (!allMonths && ymOf(t.date) !== ym) return false
      if (filter !== 'all' && t.type !== filter) return false
      if (catFilter !== 'all' && t.categoryId !== catFilter) return false
      if (accFilter !== 'all' && t.accountId !== accFilter && t.toAccountId !== accFilter) return false
      if (q) {
        const hay = `${t.description} ${t.notes ?? ''} ${(t.tags ?? []).join(' ')} ${
          t.categoryId != null ? catById.get(t.categoryId)?.name ?? '' : ''
        }`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [txs, ym, allMonths, filter, catFilter, accFilter, search, catById])

  const totals = useMemo(() => {
    let inc = 0
    let exp = 0
    for (const t of rows) {
      if (t.type === 'income') inc += t.amount
      else if (t.type === 'expense') exp += t.amount
    }
    return { inc, exp, net: inc - exp }
  }, [rows])

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map((r) => r.id!)))
  }

  async function bulkCategorize(catId: number | undefined) {
    await repo.transactions.updateMany([...selected], { categoryId: catId })
    setSelected(new Set())
  }

  return (
    <>
      <PageHeader
        title="Transações"
        subtitle="Todos os seus lançamentos: despesas, receitas e transferências"
        actions={
          <>
            <MonthPicker value={ym} onChange={(v) => { setYm(v); setAllMonths(false) }} />
            <button className={allMonths ? 'btn-primary' : 'btn-secondary'} onClick={() => setAllMonths((v) => !v)}>
              {allMonths ? 'Todos os meses' : 'Só este mês'}
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }}>
              <Plus size={16} /> Lançamento
            </button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <p className="text-xs text-muted">Receitas (filtro)</p>
          <p className="text-lg font-semibold text-income">{fmtBRL(totals.inc)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Despesas (filtro)</p>
          <p className="text-lg font-semibold text-expense">{fmtBRL(totals.exp)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Resultado</p>
          <p className={`text-lg font-semibold ${totals.net >= 0 ? 'text-income' : 'text-expense'}`}>{fmtBRL(totals.net)}</p>
        </div>
      </div>

      <Card bodyClassName="p-0!">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar por descrição, nota ou categoria…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tudo' },
              { value: 'expense', label: 'Despesas' },
              { value: 'income', label: 'Receitas' },
              { value: 'transfer', label: 'Transf.' },
            ]}
          />
          <select className="input w-auto!" value={catFilter} onChange={(e) => setCatFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input w-auto!" value={accFilter} onChange={(e) => setAccFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-brand/10 border-b border-border text-sm">
            <span className="font-medium">{selected.size} selecionado(s)</span>
            <select className="input w-auto! py-1!" defaultValue="" onChange={(e) => e.target.value && bulkCategorize(e.target.value === 'none' ? undefined : Number(e.target.value))}>
              <option value="">Mudar categoria…</option>
              <option value="none">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="btn-danger py-1!" onClick={() => setBulkDelete(true)}>
              <Trash2 size={14} /> Excluir
            </button>
            <button className="btn-ghost py-1!" onClick={() => setSelected(new Set())}>Limpar</button>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight size={32} />}
            title="Nenhum lançamento encontrado"
            description={allMonths ? 'Ajuste os filtros ou crie um lançamento.' : 'Nada neste mês com os filtros atuais. Experimente “Todos os meses”.'}
            action={<button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }}><Plus size={16} /> Novo lançamento</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
                  </th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria / Fonte</th>
                  <th>Conta</th>
                  <th className="text-right">Valor</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const cat = t.categoryId != null ? catById.get(t.categoryId) : undefined
                  const src = t.incomeSourceId != null ? srcById.get(t.incomeSourceId) : undefined
                  const acc = t.accountId != null ? accById.get(t.accountId) : undefined
                  const to = t.toAccountId != null ? accById.get(t.toAccountId) : undefined
                  return (
                    <tr key={t.id}>
                      <td>
                        <input type="checkbox" checked={selected.has(t.id!)} onChange={() => toggle(t.id!)} />
                      </td>
                      <td className="whitespace-nowrap text-muted">{fmtDate(t.date)}</td>
                      <td>
                        <p className="font-medium">{t.description}</p>
                        {t.notes && <p className="text-xs text-muted truncate max-w-[280px]">{t.notes}</p>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {t.type === 'transfer' ? (
                            <Badge className="bg-surface-2 text-muted">Transferência</Badge>
                          ) : cat ? (
                            <Badge color={cat.color}>{cat.name}</Badge>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                          {src && <Badge color={src.color}>{src.name}</Badge>}
                        </div>
                      </td>
                      <td className="text-muted text-xs whitespace-nowrap">
                        {acc?.name ?? '—'}
                        {to && <> → {to.name}</>}
                      </td>
                      <td className="text-right">
                        <Money
                          value={t.type === 'expense' ? -t.amount : t.type === 'income' ? t.amount : t.amount}
                          signed={t.type !== 'transfer'}
                          className={t.type === 'transfer' ? 'text-muted' : ''}
                        />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button className="btn-ghost p-1.5" onClick={() => { setEditing(t); setFormOpen(true) }} aria-label="Editar">
                            <Pencil size={14} />
                          </button>
                          {t.type !== 'transfer' && (
                            <button className="btn-ghost p-1.5" onClick={() => setSplitting(t)} aria-label="Dividir em partes" title="Dividir em partes">
                              <Scissors size={14} />
                            </button>
                          )}
                          <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setToDelete(t)} aria-label="Excluir">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted px-3 py-2">{rows.length} lançamento(s)</p>
      </Card>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <SplitTransaction open={!!splitting} onClose={() => setSplitting(null)} tx={splitting} />
      <Confirm
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete?.id && repo.transactions.delete(toDelete.id)}
        message={<>Excluir “{toDelete?.description}” de {toDelete && fmtBRL(toDelete.amount)}? Essa ação não pode ser desfeita.</>}
      />
      <Confirm
        open={bulkDelete}
        onClose={() => setBulkDelete(false)}
        onConfirm={async () => { await repo.transactions.bulkDelete([...selected]); setSelected(new Set()) }}
        message={<>Excluir {selected.size} lançamento(s) selecionado(s)? Essa ação não pode ser desfeita.</>}
      />
    </>
  )
}
