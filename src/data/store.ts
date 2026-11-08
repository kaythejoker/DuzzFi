import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type {
  Account,
  Asset,
  AssetValuation,
  Category,
  IncomeSource,
  Investment,
  InvestmentMovement,
  InvestmentSnapshot,
  RecurringExpense,
  Transaction,
} from '../db/types'

// ---------- tabelas ----------

export interface Tables {
  accounts: Account
  categories: Category
  recurringExpenses: RecurringExpense
  transactions: Transaction
  incomeSources: IncomeSource
  investments: Investment
  investmentMovements: InvestmentMovement
  investmentSnapshots: InvestmentSnapshot
  assets: Asset
  assetValuations: AssetValuation
}

export type TableName = keyof Tables

/** Ordem respeita as dependências (FKs): quem é referenciado vem antes */
export const TABLE_NAMES: TableName[] = [
  'accounts',
  'categories',
  'incomeSources',
  'recurringExpenses',
  'transactions',
  'investments',
  'investmentMovements',
  'investmentSnapshots',
  'assets',
  'assetValuations',
]

const DB_NAME: Record<TableName, string> = {
  accounts: 'accounts',
  categories: 'categories',
  recurringExpenses: 'recurring_expenses',
  transactions: 'transactions',
  incomeSources: 'income_sources',
  investments: 'investments',
  investmentMovements: 'investment_movements',
  investmentSnapshots: 'investment_snapshots',
  assets: 'assets',
  assetValuations: 'asset_valuations',
}

/** Tabelas cujas linhas mudam quando uma linha desta tabela é excluída (FK set null / cascade) */
const DELETE_EFFECTS: Partial<Record<TableName, TableName[]>> = {
  accounts: ['transactions', 'recurringExpenses'],
  categories: ['transactions', 'incomeSources', 'recurringExpenses'],
  incomeSources: ['transactions'],
  recurringExpenses: ['transactions'],
  investments: ['investmentMovements', 'investmentSnapshots'],
  assets: ['assetValuations'],
}

const ORDER: Partial<Record<TableName, { column: string; ascending: boolean }>> = {
  transactions: { column: 'date', ascending: false },
  investmentMovements: { column: 'date', ascending: false },
}

// ---------- conversão camelCase <-> snake_case ----------

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function toDb(row: object, nullifyUndefined: boolean) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || k === 'userId') continue
    if (v === undefined) {
      if (nullifyUndefined) out[toSnake(k)] = null
      continue
    }
    out[toSnake(k)] = v
  }
  return out
}

function fromDb<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id' || v === null) continue
    // numeric pode vir como string dependendo da precisão
    out[toCamel(k)] = typeof v === 'string' && /^(amount|value|budget|initial_balance|expected_monthly|ownership_pct|bank_balance|credit_limit|current_bill)$/.test(k) ? Number(v) : v
  }
  return out as T
}

// ---------- store em memória ----------

type State = { [K in TableName]: Tables[K][] } & { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string }

const emptyState = (): State => ({
  accounts: [],
  categories: [],
  recurringExpenses: [],
  transactions: [],
  incomeSources: [],
  investments: [],
  investmentMovements: [],
  investmentSnapshots: [],
  assets: [],
  assetValuations: [],
  status: 'idle',
})

let state: State = emptyState()
const listeners = new Set<() => void>()

function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<K extends keyof State>(key: K): State[K] {
  return useSyncExternalStore(subscribe, () => state[key])
}

export function getState() {
  return state
}

export function resetStore() {
  setState(emptyState())
}

function sortRows<K extends TableName>(name: K, rows: Tables[K][]): Tables[K][] {
  const o = ORDER[name]
  if (!o) return rows
  const col = toCamel(o.column) as keyof Tables[K]
  return [...rows].sort((a, b) => {
    const x = String(a[col] ?? '')
    const y = String(b[col] ?? '')
    if (x === y) return ((b as { id?: number }).id ?? 0) - ((a as { id?: number }).id ?? 0)
    return o.ascending ? (x < y ? -1 : 1) : x < y ? 1 : -1
  })
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

/** Busca todas as linhas (paginando de 1000 em 1000) */
async function fetchAll<K extends TableName>(name: K): Promise<Tables[K][]> {
  const page = 1000
  let from = 0
  const all: Tables[K][] = []
  for (;;) {
    const rows = check(
      await supabase
        .from(DB_NAME[name])
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + page - 1),
    ) as Record<string, unknown>[]
    all.push(...rows.map((r) => fromDb<Tables[K]>(r)))
    if (rows.length < page) break
    from += page
  }
  return sortRows(name, all)
}

export async function reload(names: TableName[] = TABLE_NAMES) {
  const results = await Promise.all(names.map((n) => fetchAll(n)))
  const patch: Partial<State> = {}
  names.forEach((n, i) => ((patch as Record<string, unknown>)[n] = results[i]))
  setState(patch)
}

export async function loadAll() {
  setState({ status: 'loading', error: undefined })
  try {
    await reload()
    setState({ status: 'ready' })
  } catch (e) {
    setState({ status: 'error', error: (e as Error).message })
  }
}

// ---------- repositório (gravações) ----------

function upsertLocal<K extends TableName>(name: K, rows: Tables[K][]) {
  const byId = new Map(rows.map((r) => [(r as { id?: number }).id, r]))
  const current = state[name] as Tables[K][]
  const kept = current.filter((r) => !byId.has((r as { id?: number }).id))
  setState({ [name]: sortRows(name, [...kept, ...rows]) } as Partial<State>)
}

function removeLocal(name: TableName, ids: number[]) {
  const set = new Set(ids)
  const current = state[name] as { id?: number }[]
  setState({ [name]: current.filter((r) => !set.has(r.id!)) } as Partial<State>)
}

function table<K extends TableName>(name: K) {
  type Row = Tables[K]
  const t = () => supabase.from(DB_NAME[name])

  return {
    async add(row: Row): Promise<Row> {
      const data = check(await t().insert(toDb(row, false)).select().single())
      const saved = fromDb<Row>(data as Record<string, unknown>)
      upsertLocal(name, [saved])
      return saved
    },

    async bulkAdd(rows: Row[]): Promise<Row[]> {
      const saved: Row[] = []
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => toDb(r, false))
        const data = check(await t().insert(chunk).select()) as Record<string, unknown>[]
        saved.push(...data.map((d) => fromDb<Row>(d)))
      }
      upsertLocal(name, saved)
      return saved
    },

    /** Substitui a linha inteira (campos ausentes viram null) */
    async put(row: Row & { id: number }): Promise<Row> {
      const data = check(await t().update(toDb(row, true)).eq('id', row.id).select().single())
      const saved = fromDb<Row>(data as Record<string, unknown>)
      upsertLocal(name, [saved])
      return saved
    },

    /** Atualiza só os campos informados (undefined vira null) */
    async update(id: number, patch: Partial<Row>): Promise<void> {
      await this.updateMany([id], patch)
    },

    async updateMany(ids: number[], patch: Partial<Row>): Promise<void> {
      if (ids.length === 0) return
      const data = check(await t().update(toDb(patch, true)).in('id', ids).select()) as Record<string, unknown>[]
      upsertLocal(name, data.map((d) => fromDb<Row>(d)))
    },

    async upsert(row: Row, onConflict: string): Promise<Row> {
      const data = check(await t().upsert(toDb(row, false), { onConflict }).select().single())
      const saved = fromDb<Row>(data as Record<string, unknown>)
      upsertLocal(name, [saved])
      return saved
    },

    async delete(id: number): Promise<void> {
      await this.bulkDelete([id])
    },

    async bulkDelete(ids: number[]): Promise<void> {
      if (ids.length === 0) return
      for (let i = 0; i < ids.length; i += 500) check(await t().delete().in('id', ids.slice(i, i + 500)))
      removeLocal(name, ids)
      const effects = DELETE_EFFECTS[name]
      if (effects) await reload(effects)
    },

    /** Remove todas as linhas do usuário nesta tabela */
    async clear(): Promise<void> {
      check(await t().delete().gte('id', 0))
      setState({ [name]: [] } as Partial<State>)
    },

    /** Linhas atualmente carregadas na memória */
    rows(): Row[] {
      return state[name] as Row[]
    },
  }
}

export const repo = {
  accounts: table('accounts'),
  categories: table('categories'),
  recurringExpenses: table('recurringExpenses'),
  transactions: table('transactions'),
  incomeSources: table('incomeSources'),
  investments: table('investments'),
  investmentMovements: table('investmentMovements'),
  investmentSnapshots: table('investmentSnapshots'),
  assets: table('assets'),
  assetValuations: table('assetValuations'),
}
