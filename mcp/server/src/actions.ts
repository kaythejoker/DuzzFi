// Ações compartilhadas entre as ferramentas do MCP e a rota de voz

import type { NewTransaction, Registry, Transaction } from './domain'
import { describeTx, type Finance } from './finance'
import { parseSpoken } from './parse'
import { brl, dateLabel, dayInYM, normalize, todayISO } from './text'

export interface ActionResult {
  ok: boolean
  /** frase curta para mostrar/falar ("Anotado: Despesa de R$ 35,00 · Mercado...") */
  message: string
  transaction?: Transaction | NewTransaction
}

/** Encontra um cadastro pelo nome (exato, depois parcial). Erro se não achar ou se for ambíguo. */
export function findByName<T extends { id: number; name: string }>(items: T[], name: string, what: string): T {
  const n = normalize(name)
  const exact = items.filter((i) => normalize(i.name) === n)
  if (exact.length === 1) return exact[0]
  const partial = items.filter((i) => normalize(i.name).includes(n) || n.includes(normalize(i.name)))
  if (partial.length === 1) return partial[0]
  const options = items.map((i) => i.name).join(', ')
  if (partial.length > 1) throw new Error(`"${name}" bate com mais de um(a) ${what}: ${partial.map((i) => i.name).join(', ')}.`)
  throw new Error(`Não achei ${what} "${name}". Opções: ${options || 'nenhuma cadastrada'}.`)
}

export function defaultAccountId(reg: Registry, preferred?: string) {
  const active = reg.accounts.filter((a) => !a.archived)
  if (preferred) {
    const hit = active.find((a) => normalize(a.name) === normalize(preferred))
    if (hit) return hit.id
  }
  return (active.find((a) => a.type === 'checking') ?? active[0])?.id
}

/** Entende uma frase falada e (se `save`) grava o lançamento */
export async function handlePhrase(
  finance: Finance,
  text: string,
  opts: { save: boolean; tag: string; defaultAccount?: string },
): Promise<ActionResult> {
  const reg = await finance.registry()
  const today = todayISO()
  const parsed = parseSpoken(text, reg, { today, defaultAccountId: defaultAccountId(reg, opts.defaultAccount) })

  if (parsed.kind === 'error') return { ok: false, message: parsed.error }

  if (parsed.kind === 'undo') {
    const last = await finance.lastCreatedHere()
    if (!last) return { ok: false, message: 'Não achei nenhum lançamento feito por voz para desfazer.' }
    if (!opts.save) return { ok: true, message: `Apagaria: ${describeTx(last, reg, today)}`, transaction: last }
    await finance.remove(last.id)
    return { ok: true, message: `Apaguei: ${describeTx(last, reg, today)}`, transaction: last }
  }

  const tx: NewTransaction = { ...parsed.tx, tags: [opts.tag], notes: `Dito: "${parsed.text}"` }
  const extra = parsed.warnings.length ? ` (${parsed.warnings.join(' ')})` : ''
  if (!opts.save) return { ok: true, message: `Lançaria: ${describeTx(tx, reg, today)}${extra}`, transaction: tx }
  const saved = await finance.insert(tx)
  return { ok: true, message: `Anotado: ${describeTx(saved, reg, today)}${extra}`, transaction: saved }
}

/** Resumo do mês em texto */
export async function monthSummary(finance: Finance, ym: string) {
  const reg = await finance.registry()
  const today = todayISO()
  const [txs, balances] = await Promise.all([finance.month(ym), finance.balances()])
  const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  const byCat = new Map<number | null, number>()
  for (const t of txs) if (t.type === 'expense') byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount)
  const catLines = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => {
      const c = reg.categories.find((x) => x.id === id)
      const limit = c?.budget ? ` de ${brl(c.budget)} (${Math.round((v / c.budget) * 100)}%)` : ''
      return `- ${c?.name ?? 'Sem categoria'}: ${brl(v)}${limit}`
    })

  const bills = reg.recurringExpenses.filter(
    (b) => b.active && (!b.startDate || b.startDate.slice(0, 7) <= ym) && (!b.endDate || b.endDate.slice(0, 7) >= ym),
  )
  const billLines = bills.map((b) => {
    const paid = txs.find((t) => t.recurringExpenseId === b.id)
    const due = dayInYM(ym, b.dueDay)
    const status = paid ? `paga ${dateLabel(paid.date, today)}` : due < today ? 'ATRASADA' : `vence ${dateLabel(due, today)}`
    return `- ${b.name}: ${brl(b.amount)} · ${status}`
  })

  const balLines = balances.filter((b) => !b.account.archived).map((b) => `- ${b.account.name}: ${brl(b.balance)}`)

  return [
    `Resumo de ${ym}`,
    `Receitas: ${brl(income)} · Despesas: ${brl(expense)} · Sobra: ${brl(income - expense)}`,
    '',
    'Despesas por categoria:',
    ...(catLines.length ? catLines : ['- nenhuma ainda']),
    '',
    'Despesas fixas:',
    ...(billLines.length ? billLines : ['- nenhuma cadastrada']),
    '',
    'Saldo das contas hoje:',
    ...balLines,
  ].join('\n')
}

export function txLine(t: Transaction, reg: Registry, today = todayISO()) {
  return `#${t.id} · ${describeTx(t, reg, today)}`
}
