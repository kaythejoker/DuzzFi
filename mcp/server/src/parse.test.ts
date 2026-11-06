// Testes do interpretador de frases: npm test
import assert from 'node:assert/strict'
import type { Registry } from './domain'
import { numberWordsToDigits, parseBrNumber, parseSpoken } from './parse'

const reg: Registry = {
  accounts: [
    { id: 1, name: 'Conta principal', type: 'checking', institution: 'Banco Inter', initialBalance: 0, archived: false },
    { id: 2, name: 'Global Account (dólar)', type: 'checking', institution: 'Banco Inter', initialBalance: 0, archived: true },
    { id: 3, name: 'Nubank', type: 'credit_card', institution: 'Nubank', initialBalance: 0, archived: false },
    { id: 4, name: 'Caixinha reserva', type: 'savings', institution: null, initialBalance: 0, archived: false },
  ],
  categories: [
    { id: 1, name: 'Moradia', type: 'expense', keywords: ['aluguel', 'luz', 'cemig', 'fibra'], budget: null, archived: false },
    { id: 2, name: 'Alimentação', type: 'expense', keywords: ['mercado', 'ifood', 'padaria', 'pizza', 'restaurante'], budget: null, archived: false },
    { id: 3, name: 'Transporte', type: 'expense', keywords: ['uber', 'onibus'], budget: null, archived: false },
    { id: 7, name: 'Assinaturas', type: 'expense', keywords: ['netflix', 'spotify'], budget: null, archived: false },
    { id: 24, name: 'Combustível', type: 'expense', keywords: ['posto', 'gasolina', 'etanol'], budget: null, archived: false },
    { id: 26, name: 'Pensão', type: 'expense', keywords: [], budget: null, archived: false },
    { id: 16, name: 'Salário', type: 'income', keywords: ['salario'], budget: null, archived: false },
    { id: 17, name: 'Pró-labore', type: 'income', keywords: ['pro labore'], budget: null, archived: false },
    { id: 19, name: 'Freelance / Serviços', type: 'income', keywords: ['freela', 'servico'], budget: null, archived: false },
  ],
  incomeSources: [
    { id: 1, name: 'Salário CLT', expectedMonthly: 4800, payDay: 7, active: true, defaultCategoryId: 16 },
    { id: 2, name: 'Sociedade Nutrivox', expectedMonthly: 1000, payDay: 10, active: true, defaultCategoryId: 17 },
  ],
  recurringExpenses: [
    { id: 2, name: 'Pensão do Lucca', amount: 700, dueDay: 10, categoryId: 26, accountId: null, active: true, startDate: null, endDate: null },
    { id: 3, name: 'Aluguel', amount: 300, dueDay: 7, categoryId: 1, accountId: null, active: true, startDate: null, endDate: null },
    { id: 6, name: 'Plano Celular', amount: 40, dueDay: 10, categoryId: 7, accountId: null, active: true, startDate: null, endDate: null },
  ],
}

const today = '2026-11-06' // sexta-feira
const p = (s: string) => parseSpoken(s, reg, { today })

let failures = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').join('\n     ')}`)
  }
}

function tx(s: string) {
  const r = p(s)
  if (r.kind !== 'create') throw new Error(`esperava lançamento, veio ${JSON.stringify(r)}`)
  return r.tx
}

check('números BR', () => {
  assert.equal(parseBrNumber('1.200,50'), 1200.5)
  assert.equal(parseBrNumber('35,9'), 35.9)
  assert.equal(parseBrNumber('35.90'), 35.9)
  assert.equal(parseBrNumber('1.200'), 1200)
  assert.equal(parseBrNumber('1,200'), 1200)
})

check('por extenso', () => {
  assert.equal(numberWordsToDigits('trinta e cinco reais'), '35 reais')
  assert.equal(numberWordsToDigits('mil e duzentos reais'), '1200 reais')
  assert.equal(numberWordsToDigits('um uber de vinte'), 'um uber de 20')
  assert.equal(numberWordsToDigits('um real e cinquenta'), '1 real e 50')
  assert.equal(numberWordsToDigits('dois mil e quinhentos'), '2500')
})

check('gasto simples', () => {
  const t = tx('Gastei 35 reais no mercado')
  assert.deepEqual([t.type, t.amount, t.description, t.categoryId, t.accountId, t.date], ['expense', 35, 'Mercado', 2, 1, today])
})

check('ontem + centavos', () => {
  const t = tx('gastei 35,90 na padaria ontem')
  assert.deepEqual([t.amount, t.description, t.categoryId, t.date], [35.9, 'Padaria', 2, '2026-11-05'])
})

check('R$ e cartão', () => {
  const t = tx('Uber de R$ 18,50 no cartão')
  assert.deepEqual([t.amount, t.description, t.categoryId, t.accountId], [18.5, 'Uber', 3, 3])
})

check('por extenso com centavos', () => {
  const t = tx('paguei trinta e dois reais e noventa centavos de gasolina')
  assert.deepEqual([t.amount, t.categoryId, t.description], [32.9, 24, 'Gasolina'])
})

check('despesa fixa sem valor', () => {
  const r = p('paguei o aluguel')
  assert.equal(r.kind, 'create')
  if (r.kind !== 'create') return
  assert.deepEqual([r.tx.amount, r.tx.recurringExpenseId, r.tx.categoryId, r.tx.description], [300, 3, 1, 'Aluguel'])
})

check('despesa fixa por palavra', () => {
  const t = tx('paguei a pensão, 700 reais')
  assert.deepEqual([t.recurringExpenseId, t.categoryId, t.description, t.amount], [2, 26, 'Pensão do Lucca', 700])
})

check('compra não vira despesa fixa', () => {
  const t = tx('comprei um celular de 2 mil reais')
  assert.deepEqual([t.recurringExpenseId, t.amount], [null, 2000])
})

check('salário', () => {
  const t = tx('caiu o salário')
  assert.deepEqual([t.type, t.amount, t.incomeSourceId, t.categoryId, t.description], ['income', 4800, 1, 16, 'Salário CLT'])
})

check('receita freela', () => {
  const t = tx('recebi 500 do freela')
  assert.deepEqual([t.type, t.amount, t.categoryId, t.description], ['income', 500, 19, 'Freela'])
})

check('dia do mês', () => {
  assert.equal(tx('gastei 20 no ifood dia 3').date, '2026-11-03')
  assert.equal(tx('gastei 20 no ifood dia 20').date, '2026-10-20')
  assert.equal(tx('gastei 20 no ifood no dia 3 de outubro').date, '2026-10-03')
  assert.equal(tx('pizza 60 reais 31/10').date, '2026-10-31')
})

check('dia da semana', () => {
  assert.equal(tx('gastei 50 no posto na segunda').date, '2026-11-02')
  assert.equal(tx('gastei 50 no posto na sexta').date, '2026-11-06')
})

check('transferência entre contas', () => {
  const t = tx('transferi 200 pra caixinha reserva')
  assert.deepEqual([t.type, t.accountId, t.toAccountId, t.categoryId], ['transfer', 1, 4, null])
})

check('pix para pessoa é despesa', () => {
  const t = tx('fiz um pix de 50 pro João')
  assert.deepEqual([t.type, t.amount, t.description], ['expense', 50, 'Pix pro João'])
})

check('sem categoria avisa', () => {
  const r = p('gastei 15 reais com chaveiro')
  assert.equal(r.kind, 'create')
  if (r.kind === 'create') {
    assert.equal(r.tx.description, 'Chaveiro')
    assert.equal(r.tx.categoryId, null)
    assert.ok(r.warnings.some((w) => w.includes('sem categoria')))
  }
})

check('desfazer', () => {
  assert.equal(p('desfaz').kind, 'undo')
  assert.equal(p('apaga o último lançamento').kind, 'undo')
  assert.equal(p('cancela isso').kind, 'undo')
})

check('sem valor', () => {
  assert.equal(p('gastei no mercado').kind, 'error')
})

if (failures) {
  console.log(`\n${failures} teste(s) falharam`)
  process.exit(1)
}
console.log('\ntodos os testes passaram')
