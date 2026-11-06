// Entende frases faladas em português ("gastei 35 no mercado ontem") e monta um lançamento.
// Não usa IA: regras simples + palavras-chave das categorias cadastradas no app.

import type { Account, NewTransaction, Registry, TxType } from './domain'
import { addDays, capitalize, dayInYM, keywordMatches, normalize, normalizeKeepLength, prevMonth, todayISO, wholeWord } from './text'

export type ParseResult =
  | { kind: 'create'; tx: NewTransaction; warnings: string[]; text: string }
  | { kind: 'undo'; text: string }
  | { kind: 'error'; error: string; text: string }

export interface ParseOptions {
  today?: string
  /** conta usada quando a frase não cita nenhuma */
  defaultAccountId?: number
}

type Range = [number, number]

// ---------- números por extenso ----------

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
}

/** "trinta e cinco reais" -> "35 reais"; "mil e duzentos" -> "1200". "um uber" continua "um uber". */
export function numberWordsToDigits(original: string) {
  const n = normalizeKeepLength(original)
  const words = [...n.matchAll(/[a-z]+/g)].map((m) => ({ w: m[0], start: m.index, end: m.index + m[0].length }))
  const runs: { start: number; end: number; value: number; count: number; next?: string }[] = []
  let i = 0
  while (i < words.length) {
    if (!(words[i].w in UNITS) && words[i].w !== 'mil') {
      i++
      continue
    }
    let total = 0
    let current = 0
    let count = 0
    let j = i
    let lastEnd = words[i].start
    while (j < words.length) {
      const { w, start, end } = words[j]
      if (n.slice(lastEnd, start).trim() !== '') break // só espaços entre as palavras
      if (w === 'e' && count > 0 && j + 1 < words.length && (words[j + 1].w in UNITS || words[j + 1].w === 'mil')) {
        lastEnd = end
        j++
        continue
      }
      if (w === 'mil') {
        total += (current || 1) * 1000
        current = 0
      } else if (w in UNITS) {
        current += UNITS[w]
      } else break
      count++
      lastEnd = end
      j++
    }
    const runWords = words.slice(i, j).filter((x) => x.w !== 'e')
    const next = words[j]?.w
    const single = runWords.length === 1 ? runWords[0].w : null
    const isArticle = single === 'um' || single === 'uma'
    const afterDigit = single === 'mil' && /\d\s*$/.test(n.slice(0, words[i].start))
    const moneyNext = next !== undefined && /^(reais|real|conto|contos|pila|pilas|centavos?)$/.test(next)
    if (count > 0 && !afterDigit && (!isArticle || moneyNext)) {
      runs.push({ start: words[i].start, end: words[j - 1].end, value: total + current, count })
    }
    i = Math.max(j, i + 1)
  }
  let out = original
  for (const r of runs.reverse()) out = out.slice(0, r.start) + String(r.value) + out.slice(r.end)
  return out
}

// ---------- valores ----------

/** "1.200,50" -> 1200.5 · "35,9" -> 35.9 · "35.90" -> 35.9 · "1.200" -> 1200 */
export function parseBrNumber(s: string) {
  let t = s
  if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (t.includes(',')) {
    const last = t.split(',').pop()!
    t = last.length <= 2 ? t.replace(/,(?=[^,]*$)/, '.').replace(/,/g, '') : t.replace(/,/g, '')
  } else if (t.includes('.')) {
    const parts = t.split('.')
    if (parts.length > 2 || parts[parts.length - 1].length === 3) t = t.replace(/\./g, '')
  }
  const v = Number(t)
  return Number.isFinite(v) ? v : NaN
}

const NUM = String.raw`\d+(?:[.,]\d+)*`
const MONEY_WORD = String.raw`(?:reais|real|conto|contos|pila|pilas|mangos?|brl)`

function findAmount(text: string): { value: number; range: Range } | null {
  const tries: [RegExp, (m: RegExpExecArray) => number][] = [
    // 35 reais e 90 centavos
    [new RegExp(String.raw`(${NUM})\s*${MONEY_WORD}\s+e\s+(\d{1,2})(?:\s*centavos?)?`), (m) => parseBrNumber(m[1]) + Number(m[2]) / 100],
    // R$ 35,90 / R$ 1,5 mil
    [new RegExp(String.raw`r\$\s*(${NUM})(\s*mil)?`), (m) => parseBrNumber(m[1]) * (m[2] ? 1000 : 1)],
    // 35 reais / 1,5 mil reais
    [new RegExp(String.raw`(${NUM})(\s*mil)?\s*${MONEY_WORD}\b`), (m) => parseBrNumber(m[1]) * (m[2] ? 1000 : 1)],
    // 2 mil
    [new RegExp(String.raw`(${NUM})\s*mil\b`), (m) => parseBrNumber(m[1]) * 1000],
    // 50 centavos
    [new RegExp(String.raw`(\d+)\s*centavos?\b`), (m) => Number(m[1]) / 100],
    // qualquer número solto
    [new RegExp(String.raw`(?<![\d/])(${NUM})(?![\d/])`), (m) => parseBrNumber(m[1])],
  ]
  for (const [re, fn] of tries) {
    const m = re.exec(text)
    if (m) {
      const value = Math.round(fn(m) * 100) / 100
      if (Number.isFinite(value) && value > 0) return { value, range: [m.index, m.index + m[0].length] }
    }
  }
  return null
}

// ---------- datas ----------

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}
const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }

function findDate(n: string, today: string): { date: string; range: Range } | null {
  let m: RegExpExecArray | null
  if ((m = /\b(?:de |hoje de )?anteontem\b/.exec(n))) return { date: addDays(today, -2), range: [m.index, m.index + m[0].length] }
  if ((m = /\b(?:de )?ontem\b(?: a noite| de noite| a tarde| de manha)?/.exec(n))) return { date: addDays(today, -1), range: [m.index, m.index + m[0].length] }
  if ((m = /\b(?:de )?hoje\b(?: a noite| de noite| a tarde| de manha| cedo)?/.exec(n))) return { date: today, range: [m.index, m.index + m[0].length] }
  // 05/11, 5/11/2026
  if ((m = /\b(?:em |no dia |dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(n))) {
    const d = Number(m[1])
    const mo = Number(m[2])
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4))
    if (!m[3] && `${y}-${String(mo).padStart(2, '0')}` > today.slice(0, 7)) y-- // "25/12" dito em janeiro = ano passado
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { date: dayInYM(`${y}-${String(mo).padStart(2, '0')}`, d), range: [m.index, m.index + m[0].length] }
    }
  }
  // dia 3, no dia 3 de novembro
  if ((m = /\b(?:no |na |em )?dia (\d{1,2})(?: de ([a-z]+))?\b/.exec(n))) {
    const d = Number(m[1])
    const monthWord = m[2] && MONTHS[m[2]]
    let ym = today.slice(0, 7)
    let range: Range = [m.index, m.index + m[0].length]
    if (monthWord) {
      let y = Number(today.slice(0, 4))
      if (monthWord > Number(today.slice(5, 7))) y--
      ym = `${y}-${String(monthWord).padStart(2, '0')}`
    } else {
      if (m[2]) range = [m.index, m.index + m[0].length - m[2].length - 4] // "de xxx" não era mês
      if (d > Number(today.slice(8, 10))) ym = prevMonth(ym) // dia que ainda não chegou = mês passado
    }
    if (d >= 1 && d <= 31) return { date: dayInYM(ym, d), range }
  }
  // segunda, na sexta-feira, sábado passado
  if ((m = /\b(?:na |no |nessa |nesse |essa |esse |semana passada na |semana passada no )?(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:[- ]feira)?(?: passad[oa])?\b/.exec(n))) {
    const target = WEEKDAYS[m[1]]
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
    const diff = (dow - target + 7) % 7
    return { date: addDays(today, -diff), range: [m.index, m.index + m[0].length] }
  }
  return null
}

// ---------- contas ----------

const GENERIC_ACCOUNT_WORDS = new Set(['conta', 'banco', 'account', 'corrente', 'minha', 'meu', 'principal'])
const TYPE_WORDS: Partial<Record<Account['type'], string[]>> = {
  credit_card: ['cartao de credito', 'no credito', 'cartao'],
  cash: ['dinheiro', 'especie', 'dinheiro vivo'],
  savings: ['poupanca'],
}

interface AccountHit {
  account: Account
  index: number
  length: number
  /** palavra imediatamente antes ("pra", "da"...) */
  before: string
}

function findAccounts(n: string, accounts: Account[]): AccountHit[] {
  const active = accounts.filter((a) => !a.archived)
  const hits: AccountHit[] = []
  for (const a of active) {
    const phrases = new Set<string>([normalize(a.name)])
    for (const w of normalize(a.name).split(/\s+/)) if (w.length >= 4 && !GENERIC_ACCOUNT_WORDS.has(w)) phrases.add(w)
    if (a.institution) {
      const inst = normalize(a.institution).replace(/^banco /, '')
      const shared = active.filter((o) => o.institution && normalize(o.institution).replace(/^banco /, '') === inst).length > 1
      if (!shared && inst.length >= 3) phrases.add(inst)
    }
    const sameType = active.filter((o) => o.type === a.type).length
    if (sameType === 1) for (const w of TYPE_WORDS[a.type] ?? []) phrases.add(w)
    // "conta principal" também atende por "principal"
    if (/principal/.test(normalize(a.name))) phrases.add('principal')
    let best: { index: number; length: number } | null = null
    for (const p of phrases) {
      const hit = wholeWord(n, p)
      if (hit && (!best || hit.length > best.length)) best = hit
    }
    if (best) {
      const before = /([a-z]+)\s+$/.exec(n.slice(0, best.index))?.[1] ?? ''
      hits.push({ account: a, ...best, before })
    }
  }
  return hits.sort((x, y) => x.index - y.index)
}

// ---------- despesas fixas e fontes de renda ----------

const GENERIC_NAME_WORDS = new Set(['plano', 'conta', 'pagamento', 'mensal', 'mensalidade', 'sociedade', 'empresa', 'servico', 'servicos', 'solutions'])

/** Nome inteiro sempre vale; uma palavra marcante do nome ("pensão", "salário") só se `allowWord` */
function matchByName<T extends { name: string }>(n: string, items: T[], allowWord: boolean): T | undefined {
  const full = items.find((it) => keywordMatches(n, it.name))
  if (full || !allowWord) return full
  const byWord = items.filter((it) =>
    normalize(it.name)
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w) && wholeWord(n, w)),
  )
  return byWord.length === 1 ? byWord[0] : undefined
}

// ---------- descrição ----------

const STOPWORDS = new Set([
  'no', 'na', 'nos', 'nas', 'em', 'de', 'do', 'da', 'dos', 'das', 'com', 'pro', 'pra', 'para', 'pelo', 'pela', 'por',
  'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'foi', 'que', 'eu', 'reais', 'real', 'centavos', 'agora', 'ai', 'entao', 'la',
  'valor', 'mais', 'menos', 'tipo', 'ne', 'tá', 'ta', 'hoje', 'ontem', 'custou', 'deu', 'r$',
])

const TRIGGERS = new RegExp(
  String.raw`\b(?:eu\s+)?(?:gastei|paguei|comprei|pagar|paga|lanca|lancar|lance|anota|anotar|anote|registra|registrar|registre|coloca|coloque|adiciona|adicione|recebi|ganhei|entrou|entraram|caiu|cairam|me pagou|me pagaram|me mandou|me mandaram|me transferiu|vendi|transferi|transfere|transferir|passei|movi|guardei|fiz um|fiz uma|tive um gasto|tive uma despesa|uma despesa|um gasto|despesa de|gasto de|receita de|no valor de|de valor)\b`,
  'g',
)

function cutRanges(original: string, ranges: Range[]) {
  const keep = original.split('')
  for (const [a, b] of ranges) for (let i = a; i < b; i++) keep[i] = ' '
  return keep.join('')
}

function cleanDescription(s: string) {
  let words = s
    .replace(/[.,;:!?"“”]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const isStop = (w: string) => STOPWORDS.has(normalize(w))
  while (words.length && isStop(words[0])) words.shift()
  while (words.length && isStop(words[words.length - 1])) words.pop()
  // preposições repetidas no meio ("mercado no no") viram uma só
  words = words.filter((w, i) => !(isStop(w) && i > 0 && isStop(words[i - 1]) && normalize(w) === normalize(words[i - 1])))
  return capitalize(words.join(' ').trim())
}

// ---------- frase completa ----------

const INCOME_RE = /\b(recebi|ganhei|entrou|entraram|caiu|cairam|recebimento|me pagou|me pagaram|me mandou|me mandaram|me transferiu|me fez um pix|vendi|rendeu|rendimento)\b/
const TRANSFER_RE = /\b(transferi|transfere|transferir|transferencia|passei|movi|guardei)\b/
const EXPENSE_RE = /\b(gastei|paguei|comprei|gasto|despesa)\b/
const UNDO_RE = /^(?:por favor\s+)?(desfaz\w*|desfaca|cancela\w*|apaga\w*|exclui\w*|remove\w*|deleta\w*)\b/

export function parseSpoken(input: string, reg: Registry, opts: ParseOptions = {}): ParseResult {
  const today = opts.today ?? todayISO()
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) return { kind: 'error', error: 'Não ouvi nada. Tenta de novo?', text }

  const plain = normalize(text).replace(/[.!?]+$/, '')
  if (UNDO_RE.test(plain) && (/\b(ultim[oa]|lancamento|isso|esse|essa|anterior)\b/.test(plain) || plain.split(' ').length <= 2)) {
    return { kind: 'undo', text }
  }

  const original = numberWordsToDigits(text)
  const n = normalizeKeepLength(original)
  const cuts: Range[] = []
  const warnings: string[] = []

  // data
  const date = findDate(n, today)
  if (date) cuts.push(date.range)
  const afterDate = cutRanges(n, cuts)

  // valor
  const amount = findAmount(afterDate)
  if (amount) {
    // leva junto o "de", "por", "no valor de" logo antes do valor
    const lead = /(?:\s(?:de|por|no valor de|valor de|custou|foi|deu))+\s*$/.exec(afterDate.slice(0, amount.range[0]))
    cuts.push([lead ? lead.index : amount.range[0], amount.range[1]])
  }

  // tipo
  const masked = cutRanges(n, cuts)
  let type: TxType = 'expense'
  if (INCOME_RE.test(masked) && !EXPENSE_RE.test(masked.slice(0, masked.search(INCOME_RE)))) type = 'income'

  // contas
  const hits = findAccounts(masked, reg.accounts)
  const defaultAccount =
    reg.accounts.find((a) => a.id === opts.defaultAccountId && !a.archived) ??
    reg.accounts.filter((a) => !a.archived && a.type === 'checking').sort((a, b) => a.id - b.id)[0] ??
    reg.accounts.filter((a) => !a.archived).sort((a, b) => a.id - b.id)[0]
  let accountId: number | undefined
  let toAccountId: number | undefined
  if (TRANSFER_RE.test(masked) && hits.length) {
    const dest = hits.find((h) => /^(pra|para|pro|na|no|pros|pras)$/.test(h.before)) ?? (hits.length > 1 ? hits[hits.length - 1] : hits[0])
    const origin = hits.find((h) => h !== dest && /^(da|do|de)$/.test(h.before)) ?? hits.find((h) => h !== dest)
    const originAcc = origin?.account ?? defaultAccount
    if (originAcc && originAcc.id !== dest.account.id) {
      type = 'transfer'
      accountId = originAcc.id
      toAccountId = dest.account.id
    }
  }
  if (type !== 'transfer') accountId = hits[0]?.account.id
  for (const h of hits) {
    const lead = /(?:\s(?:no|na|do|da|de|pelo|pela|com o|com a|pra|para|pro|usando o|usando a))+\s*$/.exec(n.slice(0, h.index))
    cuts.push([lead ? lead.index : h.index, h.index + h.length])
  }

  // despesa fixa / fonte de renda citada pelo nome ("paguei a pensão", "caiu o salário")
  const paying = /\b(paguei|pagar|paga|pago|conta d[aeo]|boleto|fatura|mensalidade|parcela)\b/.test(masked)
  const bill =
    type === 'expense'
      ? matchByName(masked, reg.recurringExpenses.filter((b) => b.active), paying)
      : undefined
  const source = type === 'income' ? matchByName(masked, reg.incomeSources.filter((s) => s.active), true) : undefined

  let value = amount?.value
  if (!value && bill) {
    value = bill.amount
    warnings.push(`Usei o valor cadastrado da despesa fixa ${bill.name}.`)
  }
  if (!value && source && source.expectedMonthly > 0) {
    value = source.expectedMonthly
    warnings.push(`Usei o valor esperado de ${source.name}.`)
  }
  if (!value) return { kind: 'error', error: `Não entendi o valor em "${text}".`, text }

  // categoria
  let categoryId: number | undefined = bill?.categoryId ?? source?.defaultCategoryId ?? undefined
  if (!categoryId && type !== 'transfer') {
    let best: { id: number; len: number } | undefined
    for (const c of reg.categories) {
      if (c.type !== type || c.archived) continue
      for (const kw of [...(c.keywords ?? []), c.name]) {
        const len = normalize(kw).length
        if (keywordMatches(masked, kw) && (!best || len > best.len)) best = { id: c.id, len }
      }
    }
    categoryId = best?.id
    if (!categoryId) warnings.push('Ficou sem categoria.')
  }

  // descrição: o que sobra da frase tirando verbo, valor, data e conta
  for (const m of n.matchAll(TRIGGERS)) cuts.push([m.index, m.index + m[0].length])
  let description = cleanDescription(cutRanges(original, cuts))
  if (bill) description = bill.name
  else if (source && normalize(description).split(/\s+/).every((w) => !w || normalize(source.name).includes(w))) description = source.name
  if (!description) {
    if (type === 'transfer') description = 'Transferência entre contas'
    else description = reg.categories.find((c) => c.id === categoryId)?.name ?? 'Lançamento por voz'
  }

  const tx: NewTransaction = {
    date: date?.date ?? today,
    amount: value,
    type,
    description,
    categoryId: type === 'transfer' ? null : (categoryId ?? null),
    accountId: accountId ?? bill?.accountId ?? defaultAccount?.id ?? null,
    toAccountId: toAccountId ?? null,
    incomeSourceId: source?.id ?? null,
    recurringExpenseId: bill?.id ?? null,
  }
  return { kind: 'create', tx, warnings, text }
}
