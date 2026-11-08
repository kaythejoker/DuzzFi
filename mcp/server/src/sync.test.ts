// Testes da sincronização Open Finance (parte pura, sem rede): npm test
import assert from 'node:assert/strict'
import type { Account, Registry } from './domain'
import { Pluggy, type PluggyAccount, type PluggyTransaction } from './pluggy'
import { guessExisting, localDate, pairTransfers, toCandidate, toTransaction, type Candidate } from './sync'

const bank: PluggyAccount = { id: 'acc-bank', itemId: 'it1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta corrente', balance: 1500 }
const card: PluggyAccount = { id: 'acc-card', itemId: 'it1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Cartão', balance: 800 }

const accounts: Account[] = [
  { id: 1, name: 'Nubank · Conta', type: 'checking', institution: 'Nubank', initialBalance: 0, archived: false, externalId: 'pluggy:acc-bank' },
  { id: 2, name: 'Nubank · Cartão', type: 'credit_card', institution: 'Nubank', initialBalance: 0, archived: false, externalId: 'pluggy:acc-card' },
  { id: 3, name: 'Inter', type: 'checking', institution: 'Banco Inter', initialBalance: 0, archived: false, externalId: null },
]

const reg: Registry = {
  accounts,
  categories: [
    { id: 1, name: 'Moradia', type: 'expense', keywords: ['aluguel', 'luz'], budget: null, archived: false },
    { id: 2, name: 'Alimentação', type: 'expense', keywords: ['mercado', 'ifood'], budget: null, archived: false },
    { id: 16, name: 'Salário', type: 'income', keywords: ['salario'], budget: null, archived: false },
  ],
  incomeSources: [{ id: 1, name: 'Salário CLT', expectedMonthly: 4800, payDay: 7, active: true, defaultCategoryId: 16 }],
  recurringExpenses: [{ id: 3, name: 'Aluguel', amount: 1200, dueDay: 7, categoryId: 1, accountId: null, active: true, startDate: null, endDate: null }],
}

const tx = (over: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  accountId: 'acc-bank',
  description: 'x',
  amount: -10,
  date: '2026-11-05T03:00:00.000Z',
  status: 'POSTED',
  ...over,
})

let failures = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok  ${name}`)
  } catch (e) {
    failures++
    console.log(`ERR ${name}\n    ${(e as Error).message}`)
  }
}

check('data em UTC vira dia local', () => {
  assert.equal(localDate('2026-11-05T03:00:00.000Z'), '2026-11-05')
  assert.equal(localDate('2026-11-06T01:30:00.000Z'), '2026-11-05') // 22:30 em SP
})

check('conta bancária: negativo = despesa, positivo = receita', () => {
  const d = toCandidate(tx({ description: 'Mercado Extra', amount: -85.5 }), bank, 1, 'Nubank')!
  assert.equal(d.type, 'expense')
  assert.equal(d.amount, 85.5)
  const c = toCandidate(tx({ description: 'Pix recebido', amount: 200 }), bank, 1, 'Nubank')!
  assert.equal(c.type, 'income')
})

check('cartão: positivo = compra, negativo com "pagamento" = pagamento de fatura', () => {
  const buy = toCandidate(tx({ accountId: 'acc-card', description: 'IFOOD', amount: 42 }), card, 2, 'Nubank')!
  assert.equal(buy.type, 'expense')
  assert.equal(buy.cardPayment, false)
  const pay = toCandidate(tx({ accountId: 'acc-card', description: 'Pagamento recebido', amount: -800 }), card, 2, 'Nubank')!
  assert.equal(pay.cardPayment, true)
  const refund = toCandidate(tx({ accountId: 'acc-card', description: 'Estorno Amazon', amount: -30 }), card, 2, 'Nubank')!
  assert.equal(refund.type, 'income')
  assert.equal(refund.cardPayment, false)
})

check('parcela e moeda estrangeira', () => {
  const c = toCandidate(
    tx({ accountId: 'acc-card', description: 'AMAZON', amount: 58, currencyCode: 'USD', amountInAccountCurrency: 298.19, creditCardMetadata: { installmentNumber: 2, totalInstallments: 10 } }),
    card,
    2,
    'Nubank',
  )!
  assert.equal(c.amount, 298.19)
  assert.equal(c.installment, '2/10')
})

const cand = (over: Partial<Candidate>): Candidate => ({
  pluggyId: over.pluggyId ?? Math.random().toString(36).slice(2),
  date: '2026-11-05',
  amount: 100,
  type: 'expense',
  description: 'x',
  memo: '',
  accountId: 1,
  bank: 'BANK',
  institution: 'Nubank',
  cardPayment: false,
  pending: false,
  ...over,
})

check('saída numa conta + entrada igual em outra = transferência', () => {
  const out = pairTransfers(
    [
      cand({ pluggyId: 'a', description: 'Pix enviado', amount: 300, accountId: 1 }),
      cand({ pluggyId: 'b', description: 'Pix recebido', amount: 300, type: 'income', accountId: 3, date: '2026-11-06' }),
      cand({ pluggyId: 'c', description: 'Mercado', amount: 50 }),
    ],
    accounts,
  )
  assert.equal(out.length, 2)
  const t = out.find((c) => c.pluggyId === 'a')!
  assert.equal(t.transferTo, 3)
  assert.equal(t.pairedId, 'b')
  const row = toTransaction(t, reg, new Set())
  assert.equal(row.type, 'transfer')
  assert.equal(row.importHash, 'pluggy:a+b')
})

check('pagamento de fatura na conta vira transferência para o cartão', () => {
  const out = pairTransfers([cand({ pluggyId: 'p', description: 'Pagamento de fatura cartão', amount: 800 })], accounts)
  assert.equal(out[0].transferTo, 2)
})

check('categoria por palavra-chave, despesa fixa e fonte de renda', () => {
  const paid = new Set<string>()
  const rent = toTransaction(cand({ description: 'Pix enviado Imobiliaria Aluguel', amount: 1200 }), reg, paid)
  assert.equal(rent.recurringExpenseId, 3)
  assert.equal(rent.categoryId, 1)
  // segundo "aluguel" no mês não quita a despesa fixa de novo
  const again = toTransaction(cand({ description: 'Aluguel garagem', amount: 1200 }), reg, paid)
  assert.equal(again.recurringExpenseId, null)
  assert.equal(again.categoryId, 1)
  const food = toTransaction(cand({ description: 'IFOOD *RESTAURANTE', amount: 40 }), reg, paid)
  assert.equal(food.categoryId, 2)
  const pay = toTransaction(cand({ description: 'Salario Empresa XYZ', amount: 4800, type: 'income' }), reg, paid)
  assert.equal(pay.type, 'income')
  assert.equal(pay.incomeSourceId, 1)
  assert.equal(pay.categoryId, 16)
  assert.ok(pay.tags?.includes('open-finance'))
})

check('liga a uma conta existente da mesma instituição', () => {
  const inter: PluggyAccount = { id: 'acc-inter', itemId: 'it2', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'CC', balance: 10 }
  assert.equal(guessExisting(inter, 'Banco Inter', accounts)?.id, 3)
  const nu: PluggyAccount = { id: 'acc-nu2', itemId: 'it1', type: 'BANK', subtype: 'SAVINGS_ACCOUNT', name: 'Caixinha', balance: 10 }
  assert.equal(guessExisting(nu, 'Nubank', accounts), undefined)
})

// cliente HTTP com fetch falso: login, cabeçalho e paginação por cursor
const calls: string[] = []
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.pluggy.ai', '')}`)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/auth')) return json({ apiKey: 'k1' })
  if ((init?.headers as Record<string, string>)['x-api-key'] !== 'k1') return json({ message: 'unauthorized' }, 401)
  if (url.includes('/v2/transactions') && !url.includes('after=')) return json({ results: [{ id: 't1' }], next: '?accountId=a&after=c2' })
  if (url.includes('after=c2')) return json({ results: [{ id: 't2' }], next: null })
  return json({ message: 'not found' }, 404)
}) as typeof fetch

await (async () => {
  const api = new Pluggy({ clientId: 'id', clientSecret: 'secret' }, fakeFetch)
  try {
    const txs = await api.transactions('a', '2026-10-01', '2026-11-08')
    assert.deepEqual(
      txs.map((t) => t.id),
      ['t1', 't2'],
    )
    assert.equal(calls.filter((c) => c.endsWith('/auth')).length, 1)
    assert.equal(calls[1], 'GET /v2/transactions?accountId=a&dateFrom=2026-10-01&dateTo=2026-11-08')
    assert.equal(calls[2], 'GET /v2/transactions?accountId=a&after=c2')
    console.log('ok  cliente Pluggy: login uma vez e paginação por cursor')
  } catch (e) {
    failures++
    console.log(`ERR cliente Pluggy
    ${(e as Error).message}`)
  }
})()

if (failures) {
  console.log(`\n${failures} teste(s) falharam`)
  process.exit(1)
}
console.log('\nTodos os testes passaram')
