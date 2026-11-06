// ---------- Tipos de domínio ----------

export type TxType = 'expense' | 'income' | 'transfer'

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'wallet' | 'other'

export interface Account {
  id?: number
  name: string
  type: AccountType
  institution?: string
  color: string
  initialBalance: number
  archived?: boolean
  createdAt: string
}

export interface Category {
  id?: number
  name: string
  type: 'expense' | 'income'
  color: string
  icon?: string
  /** limite mensal (orçamento) para despesas */
  budget?: number
  /** palavras-chave usadas na categorização automática de extratos */
  keywords?: string[]
  archived?: boolean
}

export interface Transaction {
  id?: number
  /** yyyy-MM-dd */
  date: string
  /** sempre positivo; o sinal vem de `type` */
  amount: number
  type: TxType
  description: string
  categoryId?: number
  accountId?: number
  /** para transferências: conta destino */
  toAccountId?: number
  incomeSourceId?: number
  /** despesa fixa que este lançamento paga (no mês do lançamento) */
  recurringExpenseId?: number
  notes?: string
  tags?: string[]
  /** hash único usado para evitar importar o mesmo lançamento duas vezes */
  importHash?: string
  createdAt: string
}

/** Despesa fixa que se repete todo mês (aluguel, internet, academia...) */
export interface RecurringExpense {
  id?: number
  name: string
  amount: number
  /** dia do vencimento (1-31; meses curtos usam o último dia) */
  dueDay: number
  categoryId?: number
  accountId?: number
  color: string
  notes?: string
  active: boolean
  startDate?: string
  endDate?: string
}

export type IncomeSourceType =
  | 'clt'
  | 'pj'
  | 'sociedade'
  | 'empresa'
  | 'freelance'
  | 'dividendos'
  | 'aluguel'
  | 'juros'
  | 'outro'

export interface IncomeSource {
  id?: number
  name: string
  type: IncomeSourceType
  /** valor esperado por mês */
  expectedMonthly: number
  /** dia do mês em que o recebimento costuma cair (1-31) */
  payDay?: number
  startDate?: string
  endDate?: string
  color: string
  notes?: string
  active: boolean
  /** categoria de receita padrão ao lançar um recebimento */
  defaultCategoryId?: number
}

export type InvestmentType =
  | 'acoes'
  | 'fiis'
  | 'renda_fixa'
  | 'tesouro'
  | 'cripto'
  | 'fundos'
  | 'previdencia'
  | 'exterior'
  | 'poupanca'
  | 'outro'

export interface Investment {
  id?: number
  name: string
  type: InvestmentType
  institution?: string
  ticker?: string
  color: string
  notes?: string
  archived?: boolean
  createdAt: string
}

export type InvestmentMovementType = 'aporte' | 'resgate' | 'rendimento' | 'dividendo'

export interface InvestmentMovement {
  id?: number
  investmentId: number
  date: string
  type: InvestmentMovementType
  amount: number
  notes?: string
}

/** Valor de mercado do investimento em uma data (geralmente fim do mês) */
export interface InvestmentSnapshot {
  id?: number
  investmentId: number
  date: string
  value: number
}

export type AssetType =
  | 'empresa'
  | 'sociedade'
  | 'imovel'
  | 'veiculo'
  | 'outro_ativo'
  | 'emprestimo'
  | 'financiamento'
  | 'cartao'
  | 'outro_passivo'

export interface Asset {
  id?: number
  name: string
  type: AssetType
  kind: 'ativo' | 'passivo'
  /** % de participação (empresas/sociedades) */
  ownershipPct?: number
  color: string
  notes?: string
  archived?: boolean
  createdAt: string
}

export interface AssetValuation {
  id?: number
  assetId: number
  date: string
  value: number
}

export interface Setting {
  key: string
  value: unknown
}

// ---------- Rótulos ----------

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  credit_card: 'Cartão de crédito',
  cash: 'Dinheiro',
  wallet: 'Carteira digital',
  other: 'Outro',
}

export const INCOME_TYPE_LABEL: Record<IncomeSourceType, string> = {
  clt: 'CLT (salário)',
  pj: 'PJ / Nota fiscal',
  sociedade: 'Sociedade (pró-labore / lucros)',
  empresa: 'Empresa própria',
  freelance: 'Freelance',
  dividendos: 'Dividendos',
  aluguel: 'Aluguel',
  juros: 'Juros / Rendimentos',
  outro: 'Outro',
}

export const INVESTMENT_TYPE_LABEL: Record<InvestmentType, string> = {
  acoes: 'Ações',
  fiis: 'Fundos imobiliários',
  renda_fixa: 'Renda fixa (CDB, LCI, LCA)',
  tesouro: 'Tesouro Direto',
  cripto: 'Criptomoedas',
  fundos: 'Fundos de investimento',
  previdencia: 'Previdência',
  exterior: 'Exterior (ETFs, stocks)',
  poupanca: 'Poupança',
  outro: 'Outro',
}

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  empresa: 'Empresa própria',
  sociedade: 'Participação societária',
  imovel: 'Imóvel',
  veiculo: 'Veículo',
  outro_ativo: 'Outro ativo',
  emprestimo: 'Empréstimo',
  financiamento: 'Financiamento',
  cartao: 'Dívida de cartão',
  outro_passivo: 'Outro passivo',
}

export const ASSET_TYPES_BY_KIND: Record<'ativo' | 'passivo', AssetType[]> = {
  ativo: ['empresa', 'sociedade', 'imovel', 'veiculo', 'outro_ativo'],
  passivo: ['emprestimo', 'financiamento', 'cartao', 'outro_passivo'],
}

export const MOVEMENT_LABEL: Record<InvestmentMovementType, string> = {
  aporte: 'Aporte',
  resgate: 'Resgate',
  rendimento: 'Rendimento',
  dividendo: 'Dividendo',
}

export const PALETTE = [
  '#8a00ff', '#a855f7', '#c4a1ff', '#5a22c7', '#2fd18b', '#ffc857',
  '#ff5c7a', '#38bdf8', '#f472b6', '#fb923c', '#5fe0a6', '#e879f9',
  '#818cf8', '#2dd4bf', '#facc15', '#9a9aa5',
]
