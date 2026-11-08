import type {
  Account,
  Asset,
  AssetValuation,
  IncomeSource,
  IncomeSourceType,
  Investment,
  InvestmentMovement,
  InvestmentSnapshot,
  Transaction,
} from '../db/types'
import { endOfYM, lastMonths, ymOf } from './dates'

export interface MonthSummary {
  ym: string
  income: number
  expense: number
  balance: number
  savingsRate: number
}

/** Lançamentos sem as entradas em cartão de crédito (estorno/ajuste não é dinheiro recebido) */
export function withoutCardCredits(txs: Transaction[], accounts: Account[]) {
  const cards = cardAccountIds(accounts)
  if (cards.size === 0) return txs
  return txs.filter((t) => !(t.type === 'income' && t.accountId != null && cards.has(t.accountId)))
}

/** Ids das contas que são cartão de crédito (crédito no cartão é estorno, não receita) */
export function cardAccountIds(accounts: Account[]) {
  return new Set(accounts.filter((a) => a.type === 'credit_card').map((a) => a.id!))
}

/** Soma um lançamento no resumo: entrada em cartão (estorno, ajuste) abate das despesas em vez de virar receita */
function addToSummary(s: MonthSummary, t: Transaction, cards?: Set<number>) {
  const onCard = cards != null && t.accountId != null && cards.has(t.accountId)
  if (t.type === 'income') {
    if (onCard) s.expense -= t.amount
    else s.income += t.amount
  } else if (t.type === 'expense') s.expense += t.amount
}

export function summarizeMonth(txs: Transaction[], ym: string, cards?: Set<number>): MonthSummary {
  const s: MonthSummary = { ym, income: 0, expense: 0, balance: 0, savingsRate: 0 }
  for (const t of txs) if (ymOf(t.date) === ym) addToSummary(s, t, cards)
  s.balance = s.income - s.expense
  s.savingsRate = s.income > 0 ? s.balance / s.income : 0
  return s
}

export function monthlySeries(txs: Transaction[], endYM: string, count: number, cards?: Set<number>): MonthSummary[] {
  const months = lastMonths(endYM, count)
  const map = new Map<string, MonthSummary>()
  for (const m of months) map.set(m, { ym: m, income: 0, expense: 0, balance: 0, savingsRate: 0 })
  for (const t of txs) {
    const s = map.get(ymOf(t.date))
    if (!s) continue
    addToSummary(s, t, cards)
  }
  for (const s of map.values()) {
    s.balance = s.income - s.expense
    s.savingsRate = s.income > 0 ? s.balance / s.income : 0
  }
  return months.map((m) => map.get(m)!)
}

export function sumByCategory(txs: Transaction[], ym: string | null, type: 'expense' | 'income') {
  const map = new Map<number | undefined, number>()
  for (const t of txs) {
    if (t.type !== type) continue
    if (ym && ymOf(t.date) !== ym) continue
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount)
  }
  return map
}

export function sumByIncomeSource(txs: Transaction[], ym: string | null) {
  const map = new Map<number | undefined, number>()
  for (const t of txs) {
    if (t.type !== 'income') continue
    if (ym && ymOf(t.date) !== ym) continue
    map.set(t.incomeSourceId, (map.get(t.incomeSourceId) ?? 0) + t.amount)
  }
  return map
}

/** Receita mensal agrupada por tipo de fonte (CLT, sociedade, empresa...) */
export function incomeByTypeSeries(
  txs: Transaction[],
  sources: IncomeSource[],
  endYM: string,
  count: number,
): { ym: string; [k: string]: number | string }[] {
  const months = lastMonths(endYM, count)
  const srcType = new Map<number, IncomeSourceType>()
  for (const s of sources) if (s.id != null) srcType.set(s.id, s.type)
  const rows = months.map((ym) => ({ ym }) as { ym: string; [k: string]: number | string })
  const idx = new Map(months.map((m, i) => [m, i]))
  for (const t of txs) {
    if (t.type !== 'income') continue
    const i = idx.get(ymOf(t.date))
    if (i == null) continue
    const type = (t.incomeSourceId != null && srcType.get(t.incomeSourceId)) || 'outro'
    rows[i][type] = ((rows[i][type] as number) ?? 0) + t.amount
  }
  return rows
}

/** Saldo de uma conta (saldo inicial + receitas - despesas +/- transferências) até uma data */
export function accountBalance(acc: Account, txs: Transaction[], untilISO?: string) {
  let bal = acc.initialBalance
  for (const t of txs) {
    if (untilISO && t.date > untilISO) continue
    if (t.type === 'income' && t.accountId === acc.id) bal += t.amount
    else if (t.type === 'expense' && t.accountId === acc.id) bal -= t.amount
    else if (t.type === 'transfer') {
      if (t.accountId === acc.id) bal -= t.amount
      if (t.toAccountId === acc.id) bal += t.amount
    }
  }
  return bal
}

/**
 * Quanto entrou menos quanto saiu das contas (dinheiro de verdade) no mês.
 * Diferente de receitas - despesas: compra no cartão não sai da conta na hora, pagar a fatura sim;
 * transferência para fora (ou para um cartão) também sai.
 */
export function monthCashFlow(accounts: Account[], txs: Transaction[], ym: string) {
  const bank = new Set(accounts.filter((a) => !a.archived && a.type !== 'credit_card').map((a) => a.id))
  let flow = 0
  for (const t of txs) {
    if (ymOf(t.date) !== ym) continue
    const from = t.accountId != null && bank.has(t.accountId)
    const to = t.toAccountId != null && bank.has(t.toAccountId)
    if (t.type === 'income' && from) flow += t.amount
    else if (t.type === 'expense' && from) flow -= t.amount
    else if (t.type === 'transfer') {
      if (from && !to) flow -= t.amount
      if (to && !from) flow += t.amount
    }
  }
  return flow
}

/** Valor atual de um investimento: último snapshot, ou (aportes - resgates + rendimentos) se não houver snapshot */
export function investmentValue(
  inv: Investment,
  movements: InvestmentMovement[],
  snapshots: InvestmentSnapshot[],
  untilISO?: string,
) {
  const snaps = snapshots
    .filter((s) => s.investmentId === inv.id && (!untilISO || s.date <= untilISO))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const last = snaps[0]
  // movimentos posteriores ao último snapshot ajustam o valor
  let value = last ? last.value : 0
  const since = last?.date ?? ''
  for (const m of movements) {
    if (m.investmentId !== inv.id) continue
    if (untilISO && m.date > untilISO) continue
    if (last && m.date <= since) continue
    if (m.type === 'aporte' || m.type === 'rendimento') value += m.amount
    else if (m.type === 'resgate') value -= m.amount
    // dividendos saem para a conta; não alteram o valor investido
  }
  return value
}

export function investmentInvested(inv: Investment, movements: InvestmentMovement[], untilISO?: string) {
  let v = 0
  for (const m of movements) {
    if (m.investmentId !== inv.id) continue
    if (untilISO && m.date > untilISO) continue
    if (m.type === 'aporte') v += m.amount
    else if (m.type === 'resgate') v -= m.amount
  }
  return v
}

export function investmentIncome(inv: Investment, movements: InvestmentMovement[]) {
  let v = 0
  for (const m of movements) {
    if (m.investmentId !== inv.id) continue
    if (m.type === 'rendimento' || m.type === 'dividendo') v += m.amount
  }
  return v
}

export function assetValue(asset: Asset, valuations: AssetValuation[], untilISO?: string) {
  const vals = valuations
    .filter((v) => v.assetId === asset.id && (!untilISO || v.date <= untilISO))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const raw = vals[0]?.value ?? 0
  const pct = asset.ownershipPct != null ? asset.ownershipPct / 100 : 1
  return asset.type === 'empresa' || asset.type === 'sociedade' ? raw * pct : raw
}

export interface NetWorthPoint {
  ym: string
  cash: number
  investments: number
  assets: number
  liabilities: number
  netWorth: number
}

export function netWorthSeries(
  params: {
    accounts: Account[]
    txs: Transaction[]
    investments: Investment[]
    movements: InvestmentMovement[]
    snapshots: InvestmentSnapshot[]
    assets: Asset[]
    valuations: AssetValuation[]
  },
  endYM: string,
  count: number,
): NetWorthPoint[] {
  const months = lastMonths(endYM, count)
  return months.map((ym) => {
    const until = endOfYM(ym)
    const cash = params.accounts
      .filter((a) => !a.archived && a.type !== 'credit_card')
      .reduce((s, a) => s + accountBalance(a, params.txs, until), 0)
    const cardDebt = params.accounts
      .filter((a) => !a.archived && a.type === 'credit_card')
      .reduce((s, a) => s + Math.max(0, -accountBalance(a, params.txs, until)), 0)
    const investments = params.investments
      .filter((i) => !i.archived)
      .reduce((s, i) => s + investmentValue(i, params.movements, params.snapshots, until), 0)
    const assets = params.assets
      .filter((a) => !a.archived && a.kind === 'ativo')
      .reduce((s, a) => s + assetValue(a, params.valuations, until), 0)
    const liabilities =
      params.assets
        .filter((a) => !a.archived && a.kind === 'passivo')
        .reduce((s, a) => s + assetValue(a, params.valuations, until), 0) + cardDebt
    return { ym, cash, investments, assets, liabilities, netWorth: cash + investments + assets - liabilities }
  })
}

export function pctChange(curr: number, prev: number) {
  if (!prev) return null
  return (curr - prev) / Math.abs(prev)
}
