// Acesso ao banco do Duzz Finance para um usuário específico (service role, filtrando por user_id)

import type { SupabaseClient } from '@supabase/supabase-js'
import { lastDay } from './text.ts'

export type TxType = 'expense' | 'income' | 'transfer'

export interface Account {
  id: number
  name: string
  type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'wallet' | 'other'
  institution: string | null
  initialBalance: number
  archived: boolean
  externalId: string | null
}

export interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  keywords: string[]
  archived: boolean
}

export interface IncomeSource {
  id: number
  name: string
  active: boolean
  defaultCategoryId: number | null
  /** trechos da descrição do banco que identificam a fonte (ex.: nome da empresa) */
  keywords: string[]
}

export interface RecurringExpense {
  id: number
  name: string
  amount: number
  categoryId: number | null
  active: boolean
  startDate: string | null
  endDate: string | null
}

export interface Registry {
  accounts: Account[]
  categories: Category[]
  incomeSources: IncomeSource[]
  recurringExpenses: RecurringExpense[]
}

export interface NewTransaction {
  date: string
  amount: number
  type: TxType
  description: string
  categoryId?: number | null
  accountId?: number | null
  toAccountId?: number | null
  incomeSourceId?: number | null
  recurringExpenseId?: number | null
  notes?: string | null
  tags?: string[]
  importHash?: string | null
}

export interface Investment {
  id: number
  name: string
  type: string
  externalId: string | null
  archived: boolean
}

export interface OpenFinanceItem {
  id: number
  itemId: string
  name: string | null
}

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const ACCOUNT_COLUMNS = 'id, name, type, institution, initial_balance, archived, external_id'

function toAccount(r: Row): Account {
  return {
    id: Number(r.id),
    name: String(r.name),
    type: r.type as Account['type'],
    institution: (r.institution as string | null) ?? null,
    initialBalance: Number(r.initial_balance),
    archived: Boolean(r.archived),
    externalId: (r.external_id as string | null) ?? null,
  }
}

export class Db {
  constructor(
    private sb: SupabaseClient,
    readonly userId: string,
  ) {}

  private async q<T>(fn: (sb: SupabaseClient) => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await fn(this.sb)
    if (error) throw new Error(error.message)
    return data as T
  }

  /**
   * Lê TODAS as linhas de uma consulta, em páginas de 1000: o PostgREST devolve no máximo 1000 por vez,
   * e somar só parte dos lançamentos distorce saldos e dedup. A consulta precisa vir ordenada.
   */
  // deno-lint-ignore no-explicit-any
  private async all<T>(build: (sb: SupabaseClient) => any): Promise<T[]> {
    const out: T[] = []
    const page = 1000
    for (let from = 0; ; from += page) {
      const rows = await this.q<T[]>((sb) => build(sb).range(from, from + page - 1))
      out.push(...rows)
      if (rows.length < page) break
    }
    return out
  }

  async items(): Promise<OpenFinanceItem[]> {
    const rows = await this.q<Row[]>((sb) => sb.from('open_finance_items').select('id, item_id, name').eq('user_id', this.userId).order('id'))
    return rows.map((r) => ({ id: Number(r.id), itemId: String(r.item_id), name: (r.name as string | null) ?? null }))
  }

  async updateItem(id: number, patch: { name?: string | null; status?: string | null; lastSyncedAt?: string | null; lastReport?: string | null; lastError?: string | null }) {
    const row: Row = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.status !== undefined) row.status = patch.status
    if (patch.lastSyncedAt !== undefined) row.last_synced_at = patch.lastSyncedAt
    if (patch.lastReport !== undefined) row.last_report = patch.lastReport
    if (patch.lastError !== undefined) row.last_error = patch.lastError
    await this.q((sb) => sb.from('open_finance_items').update(row).eq('id', id).eq('user_id', this.userId).select('id'))
  }

  async registry(): Promise<Registry> {
    const u = this.userId
    const [accounts, categories, incomeSources, recurringExpenses] = await Promise.all([
      this.q<Row[]>((sb) => sb.from('accounts').select(ACCOUNT_COLUMNS).eq('user_id', u).order('id')),
      this.q<Row[]>((sb) => sb.from('categories').select('id, name, type, keywords, archived').eq('user_id', u).order('id')),
      this.q<Row[]>((sb) => sb.from('income_sources').select('id, name, active, default_category_id, keywords').eq('user_id', u).order('id')),
      this.q<Row[]>((sb) => sb.from('recurring_expenses').select('id, name, amount, category_id, active, start_date, end_date').eq('user_id', u).order('id')),
    ])
    return {
      accounts: accounts.map(toAccount),
      categories: categories.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        type: r.type as Category['type'],
        keywords: (r.keywords as string[] | null) ?? [],
        archived: Boolean(r.archived),
      })),
      incomeSources: incomeSources.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        active: Boolean(r.active),
        defaultCategoryId: num(r.default_category_id),
        keywords: (r.keywords as string[] | null) ?? [],
      })),
      recurringExpenses: recurringExpenses.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        amount: Number(r.amount),
        categoryId: num(r.category_id),
        active: Boolean(r.active),
        startDate: (r.start_date as string | null) ?? null,
        endDate: (r.end_date as string | null) ?? null,
      })),
    }
  }

  async createAccount(a: { name: string; type: Account['type']; institution: string; externalId: string }): Promise<Account> {
    const row = await this.q<Row>((sb) =>
      sb
        .from('accounts')
        .insert({ user_id: this.userId, name: a.name, type: a.type, institution: a.institution, external_id: a.externalId, synced_at: new Date().toISOString() })
        .select(ACCOUNT_COLUMNS)
        .single(),
    )
    return toAccount(row)
  }

  async updateAccount(
    id: number,
    patch: {
      name?: string
      initialBalance?: number
      externalId?: string | null
      syncedAt?: string | null
      institution?: string | null
      bankBalance?: number | null
      creditLimit?: number | null
      closingDay?: number | null
      dueDay?: number | null
      currentBill?: number | null
      billDueDate?: string | null
      billEstimated?: boolean
    },
  ) {
    const row: Row = {}
    if (patch.billEstimated !== undefined) row.bill_estimated = patch.billEstimated
    if (patch.currentBill !== undefined) row.current_bill = patch.currentBill
    if (patch.billDueDate !== undefined) row.bill_due_date = patch.billDueDate
    if (patch.name !== undefined) row.name = patch.name
    if (patch.bankBalance !== undefined) row.bank_balance = patch.bankBalance
    if (patch.creditLimit !== undefined) row.credit_limit = patch.creditLimit
    if (patch.closingDay !== undefined) row.closing_day = patch.closingDay
    if (patch.dueDay !== undefined) row.due_day = patch.dueDay
    if (patch.initialBalance !== undefined) row.initial_balance = patch.initialBalance
    if (patch.externalId !== undefined) row.external_id = patch.externalId
    if (patch.syncedAt !== undefined) row.synced_at = patch.syncedAt
    if (patch.institution !== undefined) row.institution = patch.institution
    await this.q((sb) => sb.from('accounts').update(row).eq('id', id).eq('user_id', this.userId).select('id'))
  }

  async insertMany(txs: NewTransaction[]): Promise<number> {
    let n = 0
    for (let i = 0; i < txs.length; i += 500) {
      const chunk = txs.slice(i, i + 500).map((t) => ({
        user_id: this.userId,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description: t.description,
        category_id: t.categoryId ?? null,
        account_id: t.accountId ?? null,
        to_account_id: t.toAccountId ?? null,
        income_source_id: t.incomeSourceId ?? null,
        recurring_expense_id: t.recurringExpenseId ?? null,
        notes: t.notes ?? null,
        tags: t.tags ?? null,
        import_hash: t.importHash ?? null,
      }))
      const rows = await this.q<Row[]>((sb) => sb.from('transactions').insert(chunk).select('id'))
      n += rows.length
    }
    return n
  }

  // ---------- investimentos ----------

  async investments(): Promise<Investment[]> {
    const rows = await this.q<Row[]>((sb) => sb.from('investments').select('id, name, type, external_id, archived').eq('user_id', this.userId).order('id'))
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      type: String(r.type),
      externalId: (r.external_id as string | null) ?? null,
      archived: Boolean(r.archived),
    }))
  }

  async createInvestment(i: { name: string; type: string; institution: string | null; ticker?: string | null; externalId: string }): Promise<Investment> {
    const row = await this.q<Row>((sb) =>
      sb
        .from('investments')
        .insert({ user_id: this.userId, name: i.name, type: i.type, institution: i.institution, ticker: i.ticker ?? null, external_id: i.externalId, synced_at: new Date().toISOString() })
        .select('id, name, type, external_id, archived')
        .single(),
    )
    return { id: Number(row.id), name: String(row.name), type: String(row.type), externalId: (row.external_id as string | null) ?? null, archived: Boolean(row.archived) }
  }

  async updateInvestment(id: number, patch: { archived?: boolean; syncedAt?: string | null; institution?: string | null; externalId?: string | null }) {
    const row: Row = {}
    if (patch.externalId !== undefined) row.external_id = patch.externalId
    if (patch.archived !== undefined) row.archived = patch.archived
    if (patch.syncedAt !== undefined) row.synced_at = patch.syncedAt
    if (patch.institution !== undefined) row.institution = patch.institution
    await this.q((sb) => sb.from('investments').update(row).eq('id', id).eq('user_id', this.userId).select('id'))
  }

  /** Valor do investimento numa data (um por dia) */
  async upsertSnapshot(investmentId: number, date: string, value: number) {
    await this.q((sb) =>
      sb
        .from('investment_snapshots')
        .upsert({ user_id: this.userId, investment_id: investmentId, date, value }, { onConflict: 'investment_id,date' })
        .select('id'),
    )
  }

  async insertMovements(rows: { investmentId: number; date: string; type: 'aporte' | 'resgate'; amount: number; notes: string }[]) {
    if (!rows.length) return 0
    const data = await this.q<Row[]>((sb) =>
      sb
        .from('investment_movements')
        .insert(rows.map((m) => ({ user_id: this.userId, investment_id: m.investmentId, date: m.date, type: m.type, amount: m.amount, notes: m.notes })))
        .select('id'),
    )
    return data.length
  }

  /** Aportes e resgates de um investimento, em ordem de data */
  async movementsOf(investmentId: number): Promise<{ date: string; type: string; amount: number }[]> {
    const rows = await this.all<Row>((sb) =>
      sb
        .from('investment_movements')
        .select('date, type, amount')
        .eq('user_id', this.userId)
        .eq('investment_id', investmentId)
        .in('type', ['aporte', 'resgate'])
        .order('date')
        .order('id'),
    )
    return rows.map((r) => ({ date: String(r.date), type: String(r.type), amount: Number(r.amount) }))
  }

  /** import_hash dos lançamentos vindos do Open Finance a partir de uma data */
  async importHashes(prefix: string, from: string): Promise<string[]> {
    const rows = await this.all<Row>((sb) =>
      sb.from('transactions').select('import_hash').eq('user_id', this.userId).like('import_hash', `${prefix}%`).gte('date', from).order('id'),
    )
    return rows.map((r) => String(r.import_hash))
  }

  /** Data do lançamento mais recente importado do Open Finance nessa conta */
  async lastImportedDate(accountId: number, prefix: string): Promise<string | null> {
    const rows = await this.q<Row[]>((sb) =>
      sb
        .from('transactions')
        .select('date')
        .eq('user_id', this.userId)
        .like('import_hash', `${prefix}%`)
        .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`)
        .order('date', { ascending: false })
        .limit(1),
    )
    return rows[0] ? String(rows[0].date) : null
  }

  /** Despesas fixas já quitadas por mês ("<id>:<yyyy-MM>") nos meses informados */
  async paidBills(months: string[]): Promise<Set<string>> {
    const out = new Set<string>()
    if (!months.length) return out
    const sorted = [...months].sort()
    const rows = await this.all<Row>((sb) =>
      sb
        .from('transactions')
        .select('date, recurring_expense_id')
        .eq('user_id', this.userId)
        .not('recurring_expense_id', 'is', null)
        .gte('date', `${sorted[0]}-01`)
        .lte('date', lastDay(sorted[sorted.length - 1]))
        .order('id'),
    )
    for (const r of rows) out.add(`${r.recurring_expense_id}:${String(r.date).slice(0, 7)}`)
    return out
  }

  /** Saldo atual de cada conta (saldo inicial + entradas - saídas) */
  async balances(accounts: Account[]): Promise<Map<number, number>> {
    const rows = await this.all<Row>((sb) => sb.from('transactions').select('amount, type, account_id, to_account_id').eq('user_id', this.userId).order('id'))
    const bal = new Map(accounts.map((a) => [a.id, a.initialBalance]))
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
    for (const [k, v] of bal) bal.set(k, Math.round(v * 100) / 100)
    return bal
  }
}
