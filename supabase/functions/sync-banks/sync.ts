// Sincronização dos bancos via Open Finance (Pluggy) -> lançamentos do Duzz Finance
//
// Para cada item (banco conectado no Meu Pluggy): lista as contas, liga cada uma a uma conta do app
// (criando se precisar), busca as transações novas e grava como lançamentos com import_hash
// "pluggy:<id>", categorizados pelas palavras-chave do app. Pares saída/entrada entre contas suas
// viram transferência; pagamento de fatura vira transferência da conta para o cartão.

import type { Account, Category, Db, NewTransaction, OpenFinanceItem, Registry } from './db.ts'
import type { Pluggy, PluggyAccount, PluggyItem, PluggyTransaction } from './pluggy.ts'
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

const PAYMENT_RE = /\b(pagamento|pagto|pgto|payment)\b.*\b(fatura|cart[aã]o|recebid[oa])\b|\bfatura\b.*\b(pag|cart)/i
const CARD_BILL_RE = /\b(fatura|cart[aã]o de cr[eé]dito|credit card)\b/i

export function toCandidate(t: PluggyTransaction, acc: PluggyAccount, appAccountId: number, institution: string): Candidate | null {
  const raw = typeof t.amountInAccountCurrency === 'number' && t.amountInAccountCurrency !== 0 ? t.amountInAccountCurrency : t.amount
  if (!raw || !Number.isFinite(raw)) return null
  const amount = Math.round(Math.abs(raw) * 100) / 100
  if (!amount) return null
  const desc = clean(t.description || t.merchant?.name || t.descriptionRaw || 'Sem descrição')
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
    if (exp.type !== 'expense' || exp.cardPayment) continue
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

export function toTransaction(c: Mapped, reg: Registry, paidBills: Set<string>): NewTransaction {
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

  if (c.type === 'income') {
    const source = matchName(text, reg.incomeSources.filter((s) => s.active))
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
    const institution = item.connector?.name ?? 'Banco'
    await db.updateItem(row.id, { name: institution, status: item.status }).catch(() => undefined)
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
    for (const pluggyAcc of accounts) {
      const externalId = HASH_PREFIX + pluggyAcc.id
      let app = reg.accounts.find((a) => a.externalId === externalId)
      let created = false
      try {
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

  // busca as transações de todas as contas antes de casar transferências entre elas
  const cands: Candidate[] = []
  const fetchedBy = new Map<number, number>()
  for (const l of linked) {
    try {
      const txs = await pluggy.transactions(l.pluggyAcc.id, l.from, today)
      fetchedBy.set(l.app.id, txs.length)
      for (const t of txs) {
        const c = toCandidate(t, l.pluggyAcc, l.app.id, l.item.connector?.name ?? 'Banco')
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
  const rows = mapped.sort((a, b) => a.date.localeCompare(b.date)).map((c) => toTransaction(c, reg, paidBills))
  let added = 0
  if (rows.length) {
    try {
      added = await db.insertMany(rows)
    } catch (e) {
      errors.push(`Gravando lançamentos: ${msg(e)}`)
    }
  }

  // saldo inicial da conta recém-criada = saldo do banco - efeito dos lançamentos importados
  const balances = await db.balances(reg.accounts)
  const now = new Date().toISOString()
  for (const l of linked) {
    const bal = balances.get(l.app.id) ?? 0
    const bankBalance = l.pluggyAcc.type === 'CREDIT' ? -Math.abs(l.pluggyAcc.balance) : l.pluggyAcc.balance
    try {
      if (l.created && Number.isFinite(bankBalance)) {
        await db.updateAccount(l.app.id, { initialBalance: Math.round((bankBalance - bal) * 100) / 100, syncedAt: now })
      } else await db.updateAccount(l.app.id, { syncedAt: now })
    } catch (e) {
      fail(l.row, `${l.app.name}: ${msg(e)}`)
    }
    const n = rows.filter((r) => r.accountId === l.app.id || r.toAccountId === l.app.id).length
    const fetched = fetchedBy.get(l.app.id) ?? 0
    const drift = !l.created && Math.abs(bankBalance - bal) >= 0.01 ? ` · no app ${brl(bal)}` : ''
    lines.push(`${l.app.name}: ${n ? `+${n} lançamento${n > 1 ? 's' : ''}` : 'nada novo'} (${fetched} no período) · saldo no banco ${brl(bankBalance)}${drift}`)
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
