// Tipos mínimos do banco do Duzz Finance usados pelo MCP

export type TxType = 'expense' | 'income' | 'transfer'

export interface Account {
  id: number
  name: string
  type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'wallet' | 'other'
  institution: string | null
  initialBalance: number
  archived: boolean
}

export interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  keywords: string[]
  budget: number | null
  archived: boolean
}

export interface IncomeSource {
  id: number
  name: string
  expectedMonthly: number
  payDay: number | null
  active: boolean
  defaultCategoryId: number | null
}

export interface RecurringExpense {
  id: number
  name: string
  amount: number
  dueDay: number
  categoryId: number | null
  accountId: number | null
  active: boolean
  startDate: string | null
  endDate: string | null
}

export interface Transaction {
  id: number
  date: string
  amount: number
  type: TxType
  description: string
  categoryId: number | null
  accountId: number | null
  toAccountId: number | null
  incomeSourceId: number | null
  recurringExpenseId: number | null
  notes: string | null
  tags: string[] | null
  createdAt: string
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
}

/** Tudo que o MCP precisa saber para entender um lançamento */
export interface Registry {
  accounts: Account[]
  categories: Category[]
  incomeSources: IncomeSource[]
  recurringExpenses: RecurringExpense[]
}

export const TYPE_LABEL: Record<TxType, string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
}
