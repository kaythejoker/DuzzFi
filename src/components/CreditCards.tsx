import { CreditCard, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Card, Dot, EmptyState, ProgressBar } from './ui'
import type { Account } from '../db/types'
import { fmtBRL } from '../lib/format'

export interface CardRow {
  acc: Account
  /** saldo calculado (saldo inicial + lançamentos); negativo = fatura em aberto */
  balance: number
}

/**
 * Cartões de crédito não são contas nem dinheiro: aqui aparecem fatura atual, limite, disponível,
 * fechamento e vencimento. As compras continuam sendo lançamentos (despesas) do cartão; pagar a fatura
 * é uma transferência da conta para o cartão.
 */
export function CreditCardsCard({ rows, onAdd, onEdit, onDelete }: { rows: CardRow[]; onAdd: () => void; onEdit: (a: Account) => void; onDelete: (a: Account) => void }) {
  const totalOwed = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0)
  const totalLimit = rows.reduce((s, r) => s + (r.acc.creditLimit ?? 0), 0)
  return (
    <Card
      title="Cartões de crédito"
      subtitle={rows.length ? `Fatura em aberto: ${fmtBRL(totalOwed)}${totalLimit ? ` · limite total ${fmtBRL(totalLimit)}` : ''}` : 'Fatura, limite, fechamento e vencimento. Não entram no caixa.'}
      className="mb-4"
      action={<button className="btn-secondary py-1.5!" onClick={onAdd}><Plus size={14} /> Cartão</button>}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<CreditCard />} title="Nenhum cartão" description="Conecte o banco via Open Finance ou cadastre um cartão." />
      ) : (
        <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(({ acc, balance }) => {
            const owed = Math.max(0, -balance)
            const credit = Math.max(0, balance)
            const limit = acc.creditLimit ?? 0
            const available = limit ? Math.max(0, limit - owed) : null
            const pct = limit ? owed / limit : 0
            return (
              <li key={acc.id} className="rounded-2xl border border-border p-4 group">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${acc.color}22` }}>
                      <CreditCard size={16} style={{ color: acc.color }} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{acc.name}</p>
                      <p className="text-[11px] text-muted truncate">
                        {acc.institution ?? 'Cartão de crédito'}
                        {acc.externalId ? ' · Open Finance' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                    <button className="btn-ghost p-1.5" onClick={() => onEdit(acc)}><Pencil size={14} /></button>
                    <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => onDelete(acc)}><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">Fatura atual</p>
                    <p className={`font-display text-xl font-bold tabular-nums ${owed ? 'text-expense' : 'text-text'}`}>{fmtBRL(owed)}</p>
                  </div>
                  {credit > 0 && <Badge color="#2fd18b">crédito {fmtBRL(credit)}</Badge>}
                  {!!pct && <span className="text-xs text-muted tabular-nums">{Math.round(pct * 100)}% do limite</span>}
                </div>

                {limit > 0 && (
                  <div className="mt-2">
                    <ProgressBar value={owed} max={limit} color={pct > 0.8 ? '#ff5c7a' : pct > 0.5 ? '#ffc857' : acc.color} />
                    <p className="text-[11px] text-muted mt-1 flex justify-between">
                      <span>Limite {fmtBRL(limit)}</span>
                      <span>Disponível {fmtBRL(available ?? 0)}</span>
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-muted mt-2 flex items-center gap-2">
                  <Dot color={acc.color} size={6} />
                  {acc.closingDay ? `fecha dia ${acc.closingDay}` : 'fechamento não informado'}
                  {' · '}
                  {acc.dueDay ? `vence dia ${acc.dueDay}` : 'vencimento não informado'}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
