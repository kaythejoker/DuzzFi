// Sincronização dos bancos via Open Finance (Pluggy) -> lançamentos do Duzz Finance
//
// Para cada item (banco conectado no Meu Pluggy): lista as contas, liga cada uma a uma conta do app
// (criando se precisar), busca as transações novas e grava como lançamentos com import_hash
// "pluggy:<id>", categorizados pelas palavras-chave do app. Pares saída/entrada entre contas suas
// viram transferência; pagamento de fatura vira transferência da conta para o cartão.

import type { Account, Category, Db, Investment, NewTransaction, OpenFinanceItem, Registry } from './db.ts'
import type { Pluggy, PluggyAccount, PluggyInvestment, PluggyItem, PluggyTransaction } from './pluggy.ts'
import { addDays, brl, keywordMatches, normalize, todayISO, wholeWord } from './text.ts'

export const HASH_PREFIX = 'pluggy:'
export const SYNC_TAG = 'open-finance'

export interface SyncOptions {
  /** quantos dias para trás na primeira sincronização de uma conta */
  firstSyncDays?: number
  /** quantos dias antes do último lançamento importado reconferir (lançamentos que o banco posta atrasado) */
  overlapDays?: number
  today?: string
}

export interface SyncReport {
  ok: boolean
  added: number
  skipped: number
  lines: string[]
  errors: string[]
  startedAt: string
  finishedAt: string
}

/** Lançamento candidato, ainda sem dedup/categoria */
export interface Candidate {
  pluggyId: string
  date: string
  amount: number
  type: 'expense' | 'income'
  description: string
  memo: string
  accountId: number
  bank: 'BANK' | 'CREDIT'
  institution: string
  /** pagamento de fatura visto pelo lado do cartão (não vira lançamento: já entra pela conta) */
  cardPayment: boolean
  pending: boolean
  installment?: string
}

// ---------- mapeamento de uma transação do Pluggy ----------

const GENERIC_RE = /meu\s*pluggy/i
const PAYMENT_RE = /\b(pagamento|pagto|pgto|payment)\b.*\b(fatura|cart[aã]o|recebid[oa])\b|\bfatura\b.*\b(pag|cart)/i
const TRANSFER_HINT_RE = /\b(pix|ted|doc|tef|transf\w*|resgate|aplica\w*|fatura|pagamento|payment|cart[aã]o)\b/i
const CARD_BILL_RE = /\b(fatura|cart[aã]o de cr[eé]dito|credit card)\b/i
/** Aplicação e resgate (caixinha, RDB, CDB, poupança): dinheiro mudando de lugar, não gasto nem receita */
const INVEST_RE = /^(aplica[cç][aã]o|resgate)\b|\b(rdb|cdb|caixinha|poupan[cç]a|tesouro)\b/i
/** Lançamentos contábeis do cartão que vêm em pares que se anulam (atraso de fatura no Nubank): não são dinheiro */
const BOOKKEEPING_RE = /^(saldo em atraso|cr[eé]dito de atraso|encerramento de d[ií]vida|juros de d[ií]vida encerrada)$/i

export function toCandidate(t: PluggyTransaction, acc: PluggyAccount, appAccountId: number, institution: string): Candidate | null {
  const raw = typeof t.amountInAccountCurrency === 'number' && t.amountInAccountCurrency !== 0 ? t.amountInAccountCurrency : t.amount
  if (!raw || !Number.isFinite(raw)) return null
  const amount = Math.round(Math.abs(raw) * 100) / 100
  if (!amount) return null
  const desc = clean(t.description || t.merchant?.name || t.descriptionRaw || 'Sem descrição')
  if (acc.type === 'CREDIT' && BOOKKEEPING_RE.test(desc)) return null
  const memoParts = [t.descriptionRaw && clean(t.descriptionRaw) !== desc ? clean(t.descriptionRaw) : '', t.paymentData?.paymentMethod ?? '']
  let type: 'expense' | 'income'
  let cardPayment = false
  if (acc.type === 'CREDIT') {
    // cartão: positivo = compra; negativo = pagamento da fatura ou estorno
    type = raw > 0 ? 'expense' : 'income'
    cardPayment = raw < 0 && PAYMENT_RE.test(`${t.description} ${t.descriptionRaw ?? ''}`)
  } else {
    type = raw < 0 ? 'expense' : 'income'
  }
  const inst = t.creditCardMetadata
  const installment =
    inst?.installmentNumber && inst.totalInstallments && inst.totalInstallments > 1 ? `${inst.installmentNumber}/${inst.totalInstallments}` : undefined
  return {
    pluggyId: t.id,
    date: localDate(t.date),
    amount,
    type,
    description: desc,
    memo: memoParts.filter(Boolean).join(' · '),
    accountId: appAccountId,
    bank: acc.type,
    institution,
    cardPayment,
    pending: t.status === 'PENDING',
    installment,
  }
}

/** Data do lançamento no fuso do Brasil (o Pluggy manda ISO em UTC) */
export function localDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : todayISO(d)
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

// ---------- transferências entre contas suas ----------

export interface Mapped extends Candidate {
  /** quando a saída foi casada com uma entrada em outra conta sua */
  transferTo?: number
  pairedId?: string
}

/**
 * Saída numa conta + entrada de mesmo valor em outra conta sua (mesmo dia ou dia seguinte) = transferência.
 * Pagamento de fatura numa conta bancária vira transferência para o cartão da mesma instituição (ou o único cartão).
 */
export function pairTransfers(cands: Candidate[], accounts: Account[]): Mapped[] {
  const out: Mapped[] = cands.map((c) => ({ ...c }))
  const used = new Set<string>()
  const incomes = out.filter((c) => c.type === 'income' && !c.cardPayment)

  for (const exp of out) {
    // compra no cartão nunca é transferência para uma conta sua; na conta, só saídas que parecem movimentação própria
    if (exp.type !== 'expense' || exp.cardPayment || exp.bank === 'CREDIT' || !TRANSFER_HINT_RE.test(`${exp.description} ${exp.memo}`)) continue
    // aplicação vai para o investimento do próprio banco, nunca para outra conta
    if (INVEST_RE.test(exp.description)) continue
    const match = incomes.find(
      (inc) =>
        !used.has(inc.pluggyId) &&
        inc.accountId !== exp.accountId &&
        inc.amount === exp.amount &&
        Math.abs(dayDiff(inc.date, exp.date)) <= 1 &&
        // entrada no cartão só casa se for pagamento de fatura
        (inc.bank !== 'CREDIT' || PAYMENT_RE.test(inc.description) || CARD_BILL_RE.test(exp.description)),
    )
    if (match) {
      used.add(match.pluggyId)
      exp.transferTo = match.accountId
      exp.pairedId = match.pluggyId
      continue
    }
    if (exp.bank === 'BANK' && CARD_BILL_RE.test(exp.description)) {
      const card = pickCard(exp, accounts)
      if (card) exp.transferTo = card.id
    }
  }
  return out.filter((c) => !used.has(c.pluggyId))
}

function pickCard(exp: Candidate, accounts: Account[]) {
  const cards = accounts.filter((a) => a.type === 'credit_card' && !a.archived && a.id !== exp.accountId)
  if (cards.length === 1) return cards[0]
  const inst = normalize(exp.institution)
  const same = cards.filter((a) => inst && (normalize(a.institution ?? '').includes(inst) || normalize(a.name).includes(inst)))
  if (same.length === 1) return same[0]
  const named = cards.filter((a) => wholeWord(normalize(exp.description), firstWord(a.institution ?? a.name)))
  return named.length === 1 ? named[0] : undefined
}

const firstWord = (s: string) => normalize(s).split(/[^a-z0-9]+/).find((w) => w.length >= 3) ?? s

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000)
}

// ---------- categoria, despesa fixa, fonte de renda ----------

export function suggestCategory(text: string, type: 'expense' | 'income', cats: Category[]) {
  const n = normalize(text)
  let best: { id: number; len: number } | undefined
  for (const c of cats) {
    if (c.type !== type || c.archived) continue
    for (const kw of c.keywords) {
      const len = normalize(kw).length
      if (keywordMatches(n, kw) && (!best || len > best.len)) best = { id: c.id, len }
    }
  }
  return best?.id ?? null
}

const GENERIC = new Set(['plano', 'conta', 'pagamento', 'mensal', 'mensalidade', 'sociedade', 'empresa', 'servico', 'servicos', 'solutions', 'banco'])

/** Cadastro cuja palavra-chave mais longa aparece na descrição */
function matchKeywords<T extends { keywords: string[] }>(text: string, items: T[]): T | undefined {
  const n = normalize(text)
  let best: { item: T; len: number } | undefined
  for (const it of items)
    for (const kw of it.keywords) {
      const len = normalize(kw).length
      if (len && keywordMatches(n, kw) && (!best || len > best.len)) best = { item: it, len }
    }
  return best?.item
}

/** Nome do cadastro (ou uma palavra marcante dele) aparece na descrição */
function matchName<T extends { name: string }>(text: string, items: T[]): T | undefined {
  const n = normalize(text)
  const full = items.filter((it) => keywordMatches(n, it.name))
  if (full.length === 1) return full[0]
  const byWord = items.filter((it) =>
    normalize(it.name)
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 4 && !GENERIC.has(w) && wholeWord(n, w)),
  )
  return byWord.length === 1 ? byWord[0] : undefined
}

/** Pix/transferência cujo favorecido ou pagador é o próprio titular: dinheiro entre contas suas */
export function isSelfTransfer(description: string, selfNames: string[]) {
  const d = normalize(description)
  return selfNames.some((n) => n.length >= 8 && d.includes(n))
}

export function toTransaction(c: Mapped, reg: Registry, paidBills: Set<string>, selfNames: string[] = []): NewTransaction {
  const text = `${c.description} ${c.memo}`
  const notes = [`${c.institution} via Open Finance`, c.installment ? `parcela ${c.installment}` : '', c.pending ? 'pendente' : '', c.memo && c.memo !== c.description ? c.memo : '']
    .filter(Boolean)
    .join(' · ')
  const base: NewTransaction = {
    date: c.date,
    amount: c.amount,
    type: 'expense',
    description: c.description,
    accountId: c.accountId,
    notes,
    tags: [SYNC_TAG],
    importHash: HASH_PREFIX + c.pluggyId + (c.pairedId ? `+${c.pairedId}` : ''),
  }
  if (c.transferTo) return { ...base, type: 'transfer', toAccountId: c.transferTo, categoryId: null }
  // Pix para/de você mesmo (conta não sincronizada): transferência, não receita nem despesa
  if (c.bank === 'BANK' && isSelfTransfer(c.description, selfNames)) {
    return c.type === 'expense'
      ? { ...base, type: 'transfer', toAccountId: null, categoryId: null }
      : { ...base, type: 'transfer', accountId: null, toAccountId: c.accountId, categoryId: null }
  }
  // aplicação sai da conta para o investimento; resgate volta. Nenhum dos dois é despesa/receita.
  if (c.bank === 'BANK' && INVEST_RE.test(c.description)) {
    return c.type === 'expense'
      ? { ...base, type: 'transfer', toAccountId: null, categoryId: null }
      : { ...base, type: 'transfer', accountId: null, toAccountId: c.accountId, categoryId: null }
  }

  if (c.type === 'income') {
    const sources = reg.incomeSources.filter((s) => s.active)
    // primeiro pelas palavras-chave da fonte (nome da empresa que paga), depois pelo nome da fonte
    const source = matchKeywords(text, sources) ?? matchName(text, sources)
    return {
      ...base,
      type: 'income',
      incomeSourceId: source?.id ?? null,
      categoryId: source?.defaultCategoryId ?? suggestCategory(text, 'income', reg.categories),
    }
  }

  const ym = c.date.slice(0, 7)
  const bills = reg.recurringExpenses.filter(
    (b) => b.active && !paidBills.has(`${b.id}:${ym}`) && (!b.startDate || b.startDate.slice(0, 7) <= ym) && (!b.endDate || b.endDate.slice(0, 7) >= ym),
  )
  const bill = matchName(text, bills)
  const closeEnough = bill && (bill.amount === 0 || Math.abs(c.amount - bill.amount) <= Math.max(5, bill.amount * 0.2))
  if (bill && closeEnough) paidBills.add(`${bill.id}:${ym}`)
  return {
    ...base,
    type: 'expense',
    recurringExpenseId: bill && closeEnough ? bill.id : null,
    categoryId: (bill && closeEnough ? bill.categoryId : null) ?? suggestCategory(text, 'expense', reg.categories),
  }
}

// ---------- investimentos: produto do banco <-> investimento do app ----------

/** Tipo do app a partir do tipo/subtipo do Pluggy */
export function appInvestmentType(inv: PluggyInvestment): string {
  const t = `${inv.type ?? ''} ${inv.subtype ?? ''} ${inv.name ?? ''}`.toUpperCase()
  if (/TREASURY|TESOURO/.test(t)) return 'tesouro'
  if (/SAVINGS|POUPAN/.test(t)) return 'poupanca'
  if (/RETIREMENT|PREVID|PGBL|VGBL/.test(t)) return 'previdencia'
  if (/CRYPTO|CRIPTO|BITCOIN|BTC|ETH/.test(t)) return 'cripto'
  if (/REAL_ESTATE|FII|IMOBILI/.test(t)) return 'fiis'
  if (/FIXED_INCOME|CDB|RDB|LCI|LCA|CRI|CRA|DEBENTURE/.test(t)) return 'renda_fixa'
  if (/MUTUAL_FUND|FUNDO|FUND/.test(t)) return 'fundos'
  if (/EQUITY|STOCK|ACAO|AÇÃO|BDR|ETF/.test(t)) return 'acoes'
  return 'outro'
}

/** Nome legível: "Caixinha Nubank (RDB)", "CDB Porquinho · Inter" */
export function investmentLabel(inv: PluggyInvestment, institution: string) {
  const raw = clean(inv.name || inv.subtype || inv.type || 'Investimento')
  // "CDB - NU FINANCEIRA S.A. - SOCIEDADE DE CREDITO..." -> produto + banco
  const product = /^(cdb|rdb|lci|lca|cri|cra|lc)\b/i.exec(raw)?.[1]?.toUpperCase()
  if (product && /nubank|nu financeira|nu pagamentos/i.test(`${institution} ${raw}`)) return 'Caixinha Nubank'
  if (product) return `${product} · ${institution}`
  const name = raw.length > 40 ? raw.slice(0, 40).trim() : raw
  return normalize(name).includes(normalize(institution)) ? name : `${name} · ${institution}`
}

const RECONCILE_TYPES = new Set(['renda_fixa', 'poupanca'])

/**
 * Resgate que falta para aportes - resgates baterem com o valor do banco (só quando sobra dinheiro no app).
 * Data: dia seguinte ao último movimento antes do aporte mais recente (o dinheiro já tinha saído antes dele).
 */
export function missingWithdrawal(moves: { date: string; type: string; amount: number }[], bankValue: number, today: string) {
  const net = moves.reduce((s, m) => s + (m.type === 'aporte' ? m.amount : -m.amount), 0)
  const amount = Math.round((net - bankValue) * 100) / 100
  if (amount < 1) return null
  let lastAporte = -1
  moves.forEach((m, i) => {
    if (m.type === 'aporte') lastAporte = i
  })
  const before = lastAporte > 0 ? moves.slice(0, lastAporte).filter((m) => m.date < moves[lastAporte].date).pop() : undefined
  const date = before ? addDays(before.date, 1) : today
  return { amount, date: date > today ? today : date }
}

/** Valor atual informado pelo banco */
function investmentBalance(inv: PluggyInvestment) {
  for (const v of [inv.balance, inv.amount, inv.value]) if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100
  return null
}

const INVEST_TOKENS = ['rdb', 'cdb', 'porquinho', 'caixinha', 'lci', 'lca', 'poupanca', 'tesouro', 'fundo', 'cri', 'cra', 'debenture']

/** Investimento do app ligado a um produto do banco (todas as posições do mesmo produto somadas) */
export interface InvTarget {
  id: number
  name: string
  /** nome do app + nomes das posições no banco, normalizados, para reconhecer a aplicação na conta */
  match: string
  balance: number
}

/** Chave do produto: item do banco + nome legível ("CDB · Inter"). Cada aplicação no Porquinho vira uma posição nova no banco. */
export const investmentKey = (itemId: string, label: string) => `${HASH_PREFIX}${itemId}:${normalize(label)}`

/** Saídas com "resgate" no nome que não são de investimento (cashback, pontos, conta global) */
const NOT_INVEST_RE = /global account|pontos|cashback/i

/** Qual investimento do banco uma aplicação/resgate da conta se refere (pelo nome do produto na descrição) */
export function matchInvestment(description: string, candidates: InvTarget[]) {
  if (candidates.length === 0 || NOT_INVEST_RE.test(description)) return undefined
  if (candidates.length === 1) return candidates[0]
  const d = normalize(description)
  const tokens = INVEST_TOKENS.filter((t) => d.includes(t))
  const hits = candidates.filter((c) => tokens.some((t) => c.match.includes(t)))
  return hits.length === 1 ? hits[0] : undefined
}

// ---------- contas: ligação Pluggy <-> app ----------

export function appAccountType(acc: PluggyAccount): Account['type'] {
  if (acc.type === 'CREDIT') return 'credit_card'
  return /SAVINGS|POUPANCA/i.test(acc.subtype ?? '') ? 'savings' : 'checking'
}

export function accountLabel(acc: PluggyAccount, institution: string) {
  const kind = acc.type === 'CREDIT' ? 'Cartão' : /SAVINGS|POUPANCA/i.test(acc.subtype ?? '') ? 'Poupança' : 'Conta'
  const brand = acc.type === 'CREDIT' ? [acc.creditData?.brand, acc.creditData?.level].filter(Boolean).join(' ') : ''
  return `${institution} · ${kind}${brand ? ` ${brand}` : ''}`
}

/** Conta do app que ainda não está ligada e parece ser esta (mesmo tipo e instituição no nome/instituição) */
export function guessExisting(acc: PluggyAccount, institution: string, accounts: Account[]) {
  const type = appAccountType(acc)
  const inst = normalize(institution).split(/[^a-z0-9]+/).find((w) => w.length >= 3) ?? normalize(institution)
  const free = accounts.filter((a) => !a.archived && !a.externalId && a.type === type)
  const hits = free.filter((a) => normalize(a.institution ?? '').includes(inst) || normalize(a.name).includes(inst))
  return hits.length === 1 ? hits[0] : undefined
}

// ---------- a sincronização ----------

export async function syncBanks(db: Db, pluggy: Pluggy, items: OpenFinanceItem[], opts: SyncOptions = {}): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const today = opts.today ?? todayISO()
  const firstSyncDays = opts.firstSyncDays ?? 90
  const overlapDays = opts.overlapDays ?? 7
  const lines: string[] = []
  const errors: string[] = []
  const now0 = new Date().toISOString()
  let reg = await db.registry()

  type Linked = { pluggyAcc: PluggyAccount; app: Account; created: boolean; item: PluggyItem; row: OpenFinanceItem; from: string }
  const linked: Linked[] = []
  const itemErrors = new Map<number, string[]>()
  const fail = (row: OpenFinanceItem, text: string) => {
    errors.push(text)
    itemErrors.set(row.id, [...(itemErrors.get(row.id) ?? []), text])
  }

  for (const row of items) {
    let item: PluggyItem
    try {
      item = await pluggy.item(row.itemId)
    } catch (e) {
      fail(row, `Item ${row.name ?? row.itemId}: ${msg(e)}`)
      continue
    }
    // itens do Meu Pluggy vêm com o conector genérico "MeuPluggy": o nome do banco é o que o usuário deu ao item
    const connector = item.connector?.name ?? 'Banco'
    const generic = GENERIC_RE.test(connector)
    let institution = generic && row.name && !GENERIC_RE.test(row.name) ? row.name : connector
    await db.updateItem(row.id, { status: item.status, ...(generic && row.name ? {} : { name: institution }) }).catch(() => undefined)
    if (item.status === 'LOGIN_ERROR' || item.status === 'WAITING_USER_INPUT') {
      lines.push(`${institution}: conexão precisa de atenção (${item.status}). Reconecte no Meu Pluggy.`)
    } else if (item.status === 'OUTDATED') {
      lines.push(`${institution}: última atualização do banco falhou (${item.executionStatus ?? 'OUTDATED'}); usando os dados que existem.`)
    }
    let accounts: PluggyAccount[]
    try {
      accounts = await pluggy.accounts(row.itemId)
    } catch (e) {
      fail(row, `${institution}: ${msg(e)}`)
      continue
    }
    if (GENERIC_RE.test(institution)) {
      const hint = accounts.find((a) => a.marketingName)?.marketingName
      if (hint) {
        institution = hint
        await db.updateItem(row.id, { name: institution }).catch(() => undefined)
      }
    }
    for (const pluggyAcc of accounts) {
      const externalId = HASH_PREFIX + pluggyAcc.id
      let app = reg.accounts.find((a) => a.externalId === externalId)
      let created = false
      try {
        // conta criada numa rodada anterior ainda com o nome genérico do conector
        if (app && GENERIC_RE.test(app.institution ?? '') && !GENERIC_RE.test(institution)) {
          const name = app.name.replace(GENERIC_RE, institution)
          await db.updateAccount(app.id, { institution, name })
          app = { ...app, institution, name }
          lines.push(`${institution}: renomeei a conta "${name}".`)
        }
        if (!app) {
          const existing = guessExisting(pluggyAcc, institution, reg.accounts)
          if (existing) {
            await db.updateAccount(existing.id, { externalId, institution: existing.institution ?? institution })
            app = { ...existing, externalId }
            lines.push(`${institution}: liguei à conta "${existing.name}" do app.`)
          } else {
            app = await db.createAccount({ name: accountLabel(pluggyAcc, institution), type: appAccountType(pluggyAcc), institution, externalId })
            created = true
            lines.push(`${institution}: criei a conta "${app.name}" no app.`)
          }
          reg = await db.registry()
        }
        const last = await db.lastImportedDate(app.id, HASH_PREFIX)
        const from = last ? addDays(last, -overlapDays) : addDays(today, -firstSyncDays)
        linked.push({ pluggyAcc, app, created, item, row, from })
      } catch (e) {
        fail(row, `${institution} (${pluggyAcc.name}): ${msg(e)}`)
      }
    }
  }

  // ---------- investimentos de cada banco: um investimento no app por produto, saldo do dia como snapshot ----------
  // As várias posições do mesmo produto (cada aplicação no CDB Porquinho, cada caixinha) somam no mesmo investimento.
  const invByItem = new Map<number, InvTarget[]>()
  // valor que o banco informa hoje para cada investimento (zerado = 0), para conferir com aportes - resgates
  const bankValues: { id: number; name: string; type: string; value: number }[] = []
  let appInvestments: Investment[] = []
  try {
    appInvestments = await db.investments()
  } catch (e) {
    errors.push(`Lendo investimentos: ${msg(e)}`)
  }
  for (const row of items) {
    const institution = linked.find((l) => l.row.id === row.id)?.app.institution ?? row.name ?? 'Banco'
    let list: PluggyInvestment[] = []
    try {
      list = await pluggy.investments(row.itemId)
    } catch {
      list = []
    }
    const groups = new Map<string, { label: string; type: string; code: string | null; positions: PluggyInvestment[]; balance: number }>()
    for (const pi of list) {
      const label = investmentLabel(pi, institution)
      const key = investmentKey(row.itemId, label)
      const g = groups.get(key) ?? { label, type: appInvestmentType(pi), code: pi.code ?? null, positions: [], balance: 0 }
      g.positions.push(pi)
      const b = investmentBalance(pi)
      if ((pi.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE' && b !== null && b > 0) g.balance += b
      groups.set(key, g)
    }
    const mine: InvTarget[] = []
    let created = 0
    for (const [key, g] of groups) {
      const balance = Math.round(g.balance * 100) / 100
      const active = balance > 0
      // investimento criado antes do agrupamento tem o id de uma posição: é adotado e passa a usar a chave do produto
      let app =
        appInvestments.find((i) => i.externalId === key) ?? appInvestments.find((i) => g.positions.some((p) => i.externalId === HASH_PREFIX + p.id))
      try {
        if (!app && !active) continue // produto zerado/encerrado que nunca entrou: ignora
        if (!app) {
          app = await db.createInvestment({ name: g.label, type: g.type, institution, ticker: g.code, externalId: key })
          appInvestments.push(app)
          created++
        } else if (app.externalId !== key) {
          await db.updateInvestment(app.id, { externalId: key })
          const adopted: Investment = { ...app, externalId: key }
          appInvestments = appInvestments.map((i) => (i.id === adopted.id ? adopted : i))
          app = adopted
        }
        const match = normalize([app.name, ...g.positions.map((p) => `${p.name ?? ''} ${p.subtype ?? ''}`)].join(' '))
        if (active) {
          await db.upsertSnapshot(app.id, today, balance)
          await db.updateInvestment(app.id, { syncedAt: now0, ...(app.archived ? { archived: false } : {}) })
          mine.push({ id: app.id, name: app.name, match, balance })
          bankValues.push({ id: app.id, name: app.name, type: app.type, value: balance })
        } else if (!app.archived) {
          // O banco mostra zero, mas no app ainda há dinheiro aplicado (aportes - resgates): o banco costuma levar
          // um dia ou mais para informar a posição nova. Mantém o último valor em vez de zerar.
          const moves = await db.movementsOf(app.id)
          const net = moves.reduce((s, m) => s + (m.type === 'aporte' ? m.amount : -m.amount), 0)
          if (net > 1) {
            mine.push({ id: app.id, name: app.name, match, balance: 0 })
            lines.push(`${app.name}: o banco ainda não informou o valor; mantive o último.`)
            continue
          }
          // zerou no banco: registra o zero e arquiva
          await db.upsertSnapshot(app.id, today, 0)
          await db.updateInvestment(app.id, { archived: true, syncedAt: now0 })
          bankValues.push({ id: app.id, name: app.name, type: app.type, value: 0 })
        }
      } catch (e) {
        fail(row, `${institution} (${g.label}): ${msg(e)}`)
      }
    }
    invByItem.set(row.id, mine)
    if (mine.length || created) {
      const total = mine.reduce((s, m) => s + m.balance, 0)
      lines.push(`${institution}: ${mine.length} investimento${mine.length === 1 ? '' : 's'} (${brl(total)})${created ? ` · ${created} novo${created > 1 ? 's' : ''}` : ''}`)
    }
  }

  // contas podem ter sido renomeadas/ligadas acima: recarrega antes de casar transferências
  reg = await db.registry()

  // busca as transações de todas as contas antes de casar transferências entre elas
  const cands: Candidate[] = []
  const fetchedBy = new Map<number, number>()
  for (const l of linked) {
    try {
      const txs = await pluggy.transactions(l.pluggyAcc.id, l.from, today)
      fetchedBy.set(l.app.id, txs.length)
      for (const t of txs) {
        const c = toCandidate(t, l.pluggyAcc, l.app.id, l.app.institution ?? l.item.connector?.name ?? 'Banco')
        if (c) cands.push(c)
      }
    } catch (e) {
      fail(l.row, `${l.app.name}: ${msg(e)}`)
    }
  }

  // o que já está no app (qualquer lançamento com esse id, inclusive transferências casadas "id1+id2")
  const minFrom = linked.reduce((m, l) => (l.from < m ? l.from : m), today)
  const seen = new Set<string>()
  for (const h of await db.importHashes(HASH_PREFIX, addDays(minFrom, -overlapDays))) for (const id of h.slice(HASH_PREFIX.length).split('+')) seen.add(id)

  const fresh = cands.filter((c) => !seen.has(c.pluggyId) && !c.cardPayment)
  const skipped = cands.filter((c) => seen.has(c.pluggyId)).length
  const mapped = pairTransfers(fresh, reg.accounts)

  const paidBills = await db.paidBills([...new Set(mapped.map((c) => c.date.slice(0, 7)))])
  // nome do titular nas contas do banco: Pix para "Kayky ..." é movimentação entre contas suas
  const selfNames = [...new Set(linked.map((l) => normalize(l.pluggyAcc.owner ?? '')).filter((n) => n.length >= 8))]
  const rows = mapped.sort((a, b) => a.date.localeCompare(b.date)).map((c) => toTransaction(c, reg, paidBills, selfNames))
  let added = 0
  if (rows.length) {
    try {
      added = await db.insertMany(rows)
    } catch (e) {
      errors.push(`Gravando lançamentos: ${msg(e)}`)
    }
  }

  // aplicação/resgate na conta vira aporte/resgate no investimento do mesmo banco. Confere todo o período buscado,
  // não só o que entrou agora: o banco às vezes só mostra o investimento novo no dia seguinte à aplicação.
  {
    const itemOfAccount = new Map(linked.map((l) => [l.app.id, l.row.id]))
    const inApp = new Set(seen)
    if (added) for (const c of mapped) inApp.add(c.pluggyId)
    // investimento -> "data|tipo|valor" -> quantos movimentos iguais já existem
    const existing = new Map<number, Map<string, number>>()
    const movements: { investmentId: number; date: string; type: 'aporte' | 'resgate'; amount: number; notes: string }[] = []
    for (const c of [...cands].sort((a, b) => a.date.localeCompare(b.date))) {
      if (c.bank !== 'BANK' || c.cardPayment || !inApp.has(c.pluggyId) || !INVEST_RE.test(c.description)) continue
      const itemId = itemOfAccount.get(c.accountId)
      const inv = itemId != null ? matchInvestment(c.description, invByItem.get(itemId) ?? []) : undefined
      if (!inv) continue
      let have = existing.get(inv.id)
      if (!have) {
        have = new Map()
        for (const m of await db.movementsOf(inv.id)) {
          const k = `${m.date}|${m.type}|${m.amount.toFixed(2)}`
          have.set(k, (have.get(k) ?? 0) + 1)
        }
        existing.set(inv.id, have)
      }
      const type = c.type === 'expense' ? 'aporte' : 'resgate'
      const k = `${c.date}|${type}|${c.amount.toFixed(2)}`
      const n = have.get(k) ?? 0
      if (n > 0) {
        have.set(k, n - 1)
        continue
      }
      movements.push({ investmentId: inv.id, date: c.date, type, amount: c.amount, notes: `${c.description} (Open Finance)` })
    }
    if (movements.length) {
      try {
        const n = await db.insertMovements(movements)
        lines.push(`Investimentos: ${n} aporte${n === 1 ? '' : 's'}/resgate${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'}.`)
      } catch (e) {
        errors.push(`Gravando movimentos de investimento: ${msg(e)}`)
      }
    }
  }

  // Renda fixa não perde valor: se o banco mostra menos do que aportes - resgates, houve uma saída que o
  // extrato não trouxe (ex.: pagamento feito direto com o dinheiro guardado). Registra a diferença como resgate.
  for (const b of bankValues) {
    if (!RECONCILE_TYPES.has(b.type)) continue
    try {
      const adj = missingWithdrawal(await db.movementsOf(b.id), b.value, today)
      if (!adj) continue
      await db.insertMovements([{ investmentId: b.id, date: adj.date, type: 'resgate', amount: adj.amount, notes: 'Resgate não informado pelo banco (ajuste do Open Finance)' }])
      lines.push(`${b.name}: ajuste de ${brl(adj.amount)} para bater com o saldo do banco.`)
    } catch (e) {
      errors.push(`Conferindo ${b.name}: ${msg(e)}`)
    }
  }

  // o saldo do app passa a bater com o do banco: o saldo inicial absorve o que ficou fora da janela importada
  // (fatura anterior, lançamentos antigos). Cartão: saldo devido fica negativo. Também guarda limite e datas da fatura.
  const balances = await db.balances(reg.accounts)
  const now = new Date().toISOString()
  for (const l of linked) {
    const bal = balances.get(l.app.id) ?? 0
    const isCard = l.pluggyAcc.type === 'CREDIT'
    const bankBalance = isCard ? -Math.abs(l.pluggyAcc.balance) : l.pluggyAcc.balance
    const cd = l.pluggyAcc.creditData
    // fatura atual = a próxima a vencer (o saldo do cartão inclui parcelas futuras, a fatura não)
    let bill: { total: number; due: string; estimate: boolean } | undefined
    if (isCard) {
      const bills = (await pluggy.bills(l.pluggyAcc.id))
        .filter((b) => b.dueDate && Number.isFinite(Number(b.totalAmount)))
        .map((b) => ({ total: Math.abs(Number(b.totalAmount)), due: localDate(b.dueDate) }))
        .sort((a, b) => a.due.localeCompare(b.due))
      const closed = bills.find((b) => b.due >= today)
      if (closed) bill = { ...closed, estimate: false }
      else {
        // o banco só lista faturas fechadas: estima a aberta somando as compras desde o fechamento da última
        // (fechamento ~7 dias antes do vencimento). Pagamentos e lançamentos contábeis ficam de fora.
        const last = bills[bills.length - 1]
        const since = last ? addDays(last.due, -7) : addDays(today, -30)
        const recent = await pluggy.transactions(l.pluggyAcc.id, since, today).catch(() => [])
        const open = recent.reduce((sum, t) => {
          const v = typeof t.amountInAccountCurrency === 'number' && t.amountInAccountCurrency !== 0 ? t.amountInAccountCurrency : t.amount
          const d = clean(t.description ?? '')
          if (!v || localDate(t.date) > today || BOOKKEEPING_RE.test(d)) return sum
          // crédito no cartão só abate se for estorno; pagamento de fatura (qualquer nome) fica de fora
          if (v < 0 && !/estorno|reembolso|devolu|cancelamento/i.test(d)) return sum
          return sum + v
        }, 0)
        const due = last ? nextMonthSameDay(last.due) : cd?.balanceDueDate ? localDate(cd.balanceDueDate) : ''
        bill = { total: Math.max(0, Math.round(open * 100) / 100), due, estimate: true }
      }
    }
    try {
      const sync = Number.isFinite(bankBalance) && !(bankBalance === 0 && !l.created && !isCard && fetchedBy.get(l.app.id) === 0)
      await db.updateAccount(l.app.id, {
        syncedAt: now,
        bankBalance: Number.isFinite(bankBalance) ? bankBalance : null,
        ...(sync ? { initialBalance: Math.round((l.app.initialBalance + bankBalance - bal) * 100) / 100 } : {}),
        ...(isCard
          ? {
              creditLimit: typeof cd?.creditLimit === 'number' ? cd.creditLimit : undefined,
              closingDay: dayOf(cd?.balanceCloseDate),
              dueDay: bill?.due ? Number(bill.due.slice(8, 10)) : dayOf(cd?.balanceDueDate),
              currentBill: bill ? bill.total : null,
              billDueDate: bill?.due ? bill.due : null,
              billEstimated: bill ? bill.estimate : false,
            }
          : {}),
      })
    } catch (e) {
      fail(l.row, `${l.app.name}: ${msg(e)}`)
    }
    const n = rows.filter((r) => r.accountId === l.app.id || r.toAccountId === l.app.id).length
    const fetched = fetchedBy.get(l.app.id) ?? 0
    const status = isCard
      ? `${bill ? `fatura ${bill.estimate ? 'aberta ≈ ' : 'atual '}${brl(bill.total)}${bill.due ? ` (vence ${bill.due.slice(8, 10)}/${bill.due.slice(5, 7)})` : ''} · ` : ''}limite usado ${brl(Math.abs(bankBalance))}`
      : `saldo no banco ${brl(bankBalance)}`
    lines.push(`${l.app.name}: ${n ? `+${n} lançamento${n > 1 ? 's' : ''}` : 'nada novo'} (${fetched} no período) · ${status}`)
  }

  // estado por item (aparece no app)
  for (const row of items) {
    const errs = itemErrors.get(row.id)
    const mine = linked.filter((l) => l.row.id === row.id).map((l) => l.app.name)
    const report = lines.filter((ln) => mine.some((name) => ln.startsWith(name))).join('\n')
    await db
      .updateItem(row.id, { lastSyncedAt: errs ? undefined : now, lastReport: report || null, lastError: errs ? errs.join(' | ') : null })
      .catch(() => undefined)
  }

  return { ok: errors.length === 0, added, skipped, lines, errors, startedAt, finishedAt: new Date().toISOString() }
}

export function formatReport(r: SyncReport) {
  const head = r.added ? `Sincronizado: ${r.added} lançamento${r.added > 1 ? 's' : ''} novo${r.added > 1 ? 's' : ''}.` : 'Sincronizado: nada novo.'
  return [head, ...r.lines, ...(r.errors.length ? ['', 'Erros:', ...r.errors.map((e) => `- ${e}`)] : [])].join('\n')
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Mesma data um mês depois (dia 31 cai no último dia do mês seguinte) */
function nextMonthSameDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const lastD = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastD)).padStart(2, '0')}`
}

/** Dia do mês (no fuso do Brasil) de uma data ISO, ou undefined */
function dayOf(iso?: string | null) {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : Number(todayISO(d).slice(8, 10))
}
