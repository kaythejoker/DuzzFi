// Acesso ao banco do Duzz Finance (Supabase), logado como você: o RLS continua valendo.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Account, Category, IncomeSource, NewTransaction, RecurringExpense, Registry, Transaction } from './domain'
import { TYPE_LABEL } from './domain'
import { brl, dateLabel, todayISO } from './text'

export interface FinanceConfig {
  url: string
  key: string
  email: string
  password: string
}

const TX_COLUMNS =
  'id, date, amount, type, description, category_id, account_id, to_account_id, income_source_id, recurring_expense_id, notes, tags, created_at'

/** Etiquetas dos lançamentos criados fora do app (usadas no "desfazer") */
export const ORIGIN_TAGS = ['voz', 'mcp']

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function toTx(r: Row): Transaction {
  return {
    id: Number(r.id),
    date: String(r.date),
    amount: Number(r.amount),
    type: r.type as Transaction['type'],
    description: String(r.description ?? ''),
    categoryId: num(r.category_id),
    accountId: num(r.account_id),
    toAccountId: num(r.to_account_id),
    incomeSourceId: num(r.income_source_id),
    recurringExpenseId: num(r.recurring_expense_id),
    notes: (r.notes as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? null,
    createdAt: String(r.created_at),
  }
}

function toRow(tx: Partial<NewTransaction>) {
  const map: Record<string, string> = {
    date: 'date',
    amount: 'amount',
    type: 'type',
    description: 'description',
    categoryId: 'category_id',
    accountId: 'account_id',
    toAccountId: 'to_account_id',
    incomeSourceId: 'income_source_id',
    recurringExpenseId: 'recurring_expense_id',
    notes: 'notes',
    tags: 'tags',
    importHash: 'import_hash',
  }
  const row: Row = {}
  for (const [k, v] of Object.entries(tx)) if (k in map && v !== undefined) row[map[k]] = v
  return row
}

export class Finance {
  private sb: SupabaseClient
  private cache?: { at: number; data: Registry }
  private signingIn?: Promise<void>

  constructor(private cfg: FinanceConfig) {
    this.sb = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: true } })
  }

  private async auth() {
    const { data } = await this.sb.auth.getSession()
    if (data.session) return
    this.signingIn ??= (async () => {
      const { error } = await this.sb.auth.signInWithPassword({ email: this.cfg.email, password: this.cfg.password })
      if (error) throw new Error(`Login no Supabase falhou: ${error.message}`)
    })().finally(() => (this.signingIn = undefined))
    await this.signingIn
  }

  private async q<T>(fn: (sb: SupabaseClient) => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
    await this.auth()
    const { data, error } = await fn(this.sb)
    if (error) throw new Error(error.message)
    return data as T
  }

  /** Contas, categorias, fontes de renda e despesas fixas (cache de 30s) */
  async registry(force = false): Promise<Registry> {
    if (!force && this.cache && Date.now() - this.cache.at < 30_000) return this.cache.data
    const [accounts, categories, incomeSources, recurringExpenses] = await Promise.all([
      this.q<Row[]>((sb) => sb.from('accounts').select('id, name, type, institution, initial_balance, archived, external_id, synced_at').order('id')),
      this.q<Row[]>((sb) => sb.from('categories').select('id, name, type, keywords, budget, archived').order('id')),
      this.q<Row[]>((sb) => sb.from('income_sources').select('id, name, expected_monthly, pay_day, active, default_category_id').order('id')),
      this.q<Row[]>((sb) =>
        sb.from('recurring_expenses').select('id, name, amount, due_day, category_id, account_id, active, start_date, end_date').order('due_day'),
      ),
    ])
    const data: Registry = {
      accounts: accounts.map(
        (r): Account => ({
          id: Number(r.id),
          name: String(r.name),
          type: r.type as Account['type'],
          institution: (r.institution as string | null) ?? null,
          initialBalance: Number(r.initial_balance),
          archived: Boolean(r.archived),
          externalId: (r.external_id as string | null) ?? null,
          syncedAt: (r.synced_at as string | null) ?? null,
        }),
      ),
      categories: categories.map(
        (r): Category => ({
          id: Number(r.id),
          name: String(r.name),
          type: r.type as Category['type'],
          keywords: (r.keywords as string[] | null) ?? [],
          budget: num(r.budget),
          archived: Boolean(r.archived),
        }),
      ),
      incomeSources: incomeSources.map(
        (r): IncomeSource => ({
          id: Number(r.id),
          name: String(r.name),
          expectedMonthly: Number(r.expected_monthly),
          payDay: num(r.pay_day),
          active: Boolean(r.active),
          defaultCategoryId: num(r.default_category_id),
        }),
      ),
      recurringExpenses: recurringExpenses.map(
        (r): RecurringExpense => ({
          id: Number(r.id),
          name: String(r.name),
          amount: Number(r.amount),
          dueDay: Number(r.due_day),
          categoryId: num(r.category_id),
          accountId: num(r.account_id),
          active: Boolean(r.active),
          startDate: (r.start_date as string | null) ?? null,
          endDate: (r.end_date as string | null) ?? null,
        }),
      ),
    }
    this.cache = { at: Date.now(), data }
    return data
  }

  /** Insere vários lançamentos de uma vez (lotes de 500) */
  async insertMany(txs: NewTransaction[]): Promise<Transaction[]> {
    const out: Transaction[] = []
    for (let i = 0; i < txs.length; i += 500) {
      const chunk = txs.slice(i, i + 500).map(toRow)
      const rows = await this.q<Row[]>((sb) => sb.from('transactions').insert(chunk).select(TX_COLUMNS))
      out.push(...rows.map(toTx))
    }
    return out
  }

  /** import_hash dos lançamentos vindos do Open Finance a partir de uma data (para não importar duas vezes) */
  async importHashes(prefix: string, from: string): Promise<string[]> {
    const rows = await this.q<Row[]>((sb) =>
      sb.from('transactions').select('import_hash').like('import_hash', `${prefix}%`).gte('date', from).limit(100000),
    )
    return rows.map((r) => String(r.import_hash))
  }

  /** Data do lançamento mais recente importado do Open Finance nessa conta */
  async lastImportedDate(accountId: number, prefix: string): Promise<string | null> {
    const rows = await this.q<Row[]>((sb) =>
      sb
        .from('transactions')
        .select('date')
        .like('import_hash', `${prefix}%`)
        .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`)
        .order('date', { ascending: false })
        .limit(1),
    )
    return rows[0] ? String(rows[0].date) : null
  }

  async createAccount(a: {
    name: string
    type: Account['type']
    institution?: string | null
    initialBalance?: number
    externalId?: string | null
  }): Promise<Account> {
    const row = await this.q<Row>((sb) =>
      sb
        .from('accounts')
        .insert({
          name: a.name,
          type: a.type,
          institution: a.institution ?? null,
          initial_balance: a.initialBalance ?? 0,
          external_id: a.externalId ?? null,
          synced_at: a.externalId ? new Date().toISOString() : null,
        })
        .select('id, name, type, institution, initial_balance, archived, external_id, synced_at')
        .single(),
    )
    this.cache = undefined
    return {
      id: Number(row.id),
      name: String(row.name),
      type: row.type as Account['type'],
      institution: (row.institution as string | null) ?? null,
      initialBalance: Number(row.initial_balance),
      archived: Boolean(row.archived),
      externalId: (row.external_id as string | null) ?? null,
      syncedAt: (row.synced_at as string | null) ?? null,
    }
  }

  async updateAccount(id: number, patch: { initialBalance?: number; externalId?: string | null; syncedAt?: string | null; institution?: string | null }) {
    const row: Row = {}
    if (patch.initialBalance !== undefined) row.initial_balance = patch.initialBalance
    if (patch.externalId !== undefined) row.external_id = patch.externalId
    if (patch.syncedAt !== undefined) row.synced_at = patch.syncedAt
    if (patch.institution !== undefined) row.institution = patch.institution
    await this.q((sb) => sb.from('accounts').update(row).eq('id', id).select('id'))
    this.cache = undefined
  }

  async insert(tx: NewTransaction): Promise<Transaction> {
    const row = await this.q<Row>((sb) => sb.from('transactions').insert(toRow(tx)).select(TX_COLUMNS).single())
    return toTx(row)
  }

  async update(id: number, patch: Partial<NewTransaction>): Promise<Transaction> {
    const row = await this.q<Row>((sb) => sb.from('transactions').update(toRow(patch)).eq('id', id).select(TX_COLUMNS).single())
    return toTx(row)
  }

  async get(id: number): Promise<Transaction | null> {
    const row = await this.q<Row | null>((sb) => sb.from('transactions').select(TX_COLUMNS).eq('id', id).maybeSingle())
    return row ? toTx(row) : null
  }

  async remove(id: number): Promise<Transaction | null> {
    const rows = await this.q<Row[]>((sb) => sb.from('transactions').delete().eq('id', id).select(TX_COLUMNS))
    return rows[0] ? toTx(rows[0]) : null
  }

  /** Último lançamento criado por voz ou pelo MCP */
  async lastCreatedHere(): Promise<Transaction | null> {
    const rows = await this.q<Row[]>((sb) =>
      sb.from('transactions').select(TX_COLUMNS).overlaps('tags', ORIGIN_TAGS).order('created_at', { ascending: false }).limit(1),
    )
    return rows[0] ? toTx(rows[0]) : null
  }

  async list(opts: { limit?: number; from?: string; to?: string; search?: string } = {}): Promise<Transaction[]> {
    const rows = await this.q<Row[]>((sb) => {
      let q = sb.from('transactions').select(TX_COLUMNS)
      if (opts.from) q = q.gte('date', opts.from)
      if (opts.to) q = q.lte('date', opts.to)
      if (opts.search) q = q.ilike('description', `%${opts.search.replace(/[%_]/g, '')}%`)
      return q.order('date', { ascending: false }).order('id', { ascending: false }).limit(opts.limit ?? 1000)
    })
    return rows.map(toTx)
  }

  /** Lançamentos do mês (yyyy-MM) */
  month(ym: string) {
    return this.list({ from: `${ym}-01`, to: lastDay(ym), limit: 5000 })
  }

  /** Saldo atual de cada conta (saldo inicial + entradas - saídas) */
  async balances(): Promise<{ account: Account; balance: number }[]> {
    const reg = await this.registry()
    const rows = await this.q<Row[]>((sb) => sb.from('transactions').select('amount, type, account_id, to_account_id').limit(100000))
    const bal = new Map(reg.accounts.map((a) => [a.id, a.initialBalance]))
    for (const r of rows) {
      const v = Number(r.amount)
      const from = num(r.account_id)
      const to = num(r.to_account_id)
      if (r.type === 'income' && from) bal.set(from, (bal.get(from) ?? 0) + v)
      if (r.type === 'expense' && from) bal.set(from, (bal.get(from) ?? 0) - v)
      if (r.type === 'transfer') {
        if (from) bal.set(from, (bal.get(from) ?? 0) - v)
        if (to) bal.set(to, (bal.get(to) ?? 0) + v)
      }
    }
    return reg.accounts.map((account) => ({ account, balance: Math.round((bal.get(account.id) ?? 0) * 100) / 100 }))
  }
}

function lastDay(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** "Despesa de R$ 35,00 · Mercado · Alimentação · Conta principal · hoje" */
export function describeTx(tx: Transaction | NewTransaction, reg: Registry, today = todayISO()) {
  const cat = reg.categories.find((c) => c.id === tx.categoryId)?.name
  const acc = reg.accounts.find((a) => a.id === tx.accountId)?.name
  const to = reg.accounts.find((a) => a.id === tx.toAccountId)?.name
  const parts = [`${TYPE_LABEL[tx.type]} de ${brl(tx.amount)}`, tx.description]
  if (tx.type === 'transfer') parts.push(`${acc ?? '?'} → ${to ?? '?'}`)
  else {
    parts.push(cat ?? 'sem categoria')
    if (acc) parts.push(acc)
  }
  parts.push(dateLabel(tx.date, today))
  return parts.join(' · ')
}
