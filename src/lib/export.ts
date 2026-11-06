import Papa from 'papaparse'
import { getState, repo, TABLE_NAMES, type TableName, type Tables } from '../data/store'
import { fmtDate } from './format'

export interface Backup {
  app: 'duzzfinance'
  version: 1 | 2
  exportedAt: string
  tables: Partial<Record<TableName, unknown[]>>
}

export function buildBackup(): Backup {
  const s = getState()
  const tables: Backup['tables'] = {}
  for (const name of TABLE_NAMES) tables[name] = s[name]
  return { app: 'duzzfinance', version: 2, exportedAt: new Date().toISOString(), tables }
}

export function download(filename: string, content: string | Blob, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportBackupJson() {
  const b = buildBackup()
  download(`duzzfinance-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2), 'application/json')
}

const brNumber = (v: number) => v.toFixed(2).replace('.', ',')

export function exportTransactionsCsv() {
  const s = getState()
  const cat = new Map(s.categories.map((c) => [c.id, c.name]))
  const acc = new Map(s.accounts.map((a) => [a.id, a.name]))
  const src = new Map(s.incomeSources.map((x) => [x.id, x.name]))
  const rows = [...s.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      Data: fmtDate(t.date),
      Tipo: t.type === 'expense' ? 'Despesa' : t.type === 'income' ? 'Receita' : 'Transferência',
      Descrição: t.description,
      Valor: brNumber(t.type === 'expense' ? -t.amount : t.amount),
      Categoria: t.categoryId != null ? cat.get(t.categoryId) ?? '' : '',
      'Fonte de renda': t.incomeSourceId != null ? src.get(t.incomeSourceId) ?? '' : '',
      Conta: t.accountId != null ? acc.get(t.accountId) ?? '' : '',
      'Conta destino': t.toAccountId != null ? acc.get(t.toAccountId) ?? '' : '',
      Observações: t.notes ?? '',
      Tags: (t.tags ?? []).join(' '),
    }))
  const csv = '﻿' + Papa.unparse(rows, { delimiter: ';' })
  download(`duzzfinance-transacoes-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
}

export function exportInvestmentsCsv() {
  const s = getState()
  const name = new Map(s.investments.map((i) => [i.id, i.name]))
  const rows = [
    ...s.investmentMovements.map((m) => ({ date: m.date, Investimento: name.get(m.investmentId) ?? '', Registro: m.type, Valor: brNumber(m.amount), Obs: m.notes ?? '' })),
    ...s.investmentSnapshots.map((x) => ({ date: x.date, Investimento: name.get(x.investmentId) ?? '', Registro: 'valor_atual', Valor: brNumber(x.value), Obs: '' })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, ...r }) => ({ Data: fmtDate(date), ...r }))
  const csv = '﻿' + Papa.unparse(rows, { delimiter: ';' })
  download(`duzzfinance-investimentos-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
}

/** replace: apaga tudo e restaura; append: adiciona o conteúdo do backup ao que já existe */
export type RestoreMode = 'replace' | 'append'

/** Campos que apontam para outra tabela, para remapear ids antigos -> novos */
const FKS: Partial<Record<TableName, Record<string, TableName>>> = {
  incomeSources: { defaultCategoryId: 'categories' },
  transactions: { categoryId: 'categories', accountId: 'accounts', toAccountId: 'accounts', incomeSourceId: 'incomeSources' },
  investmentMovements: { investmentId: 'investments' },
  investmentSnapshots: { investmentId: 'investments' },
  assetValuations: { assetId: 'assets' },
}

export async function restoreBackup(data: Backup, mode: RestoreMode, onProgress?: (msg: string) => void) {
  if (data.app !== 'duzzfinance' || !data.tables) throw new Error('Arquivo não parece ser um backup do DuzzFinance.')
  if (mode === 'replace') await wipeAll()

  const existingHashes = new Set(getState().transactions.map((t) => t.importHash).filter(Boolean))
  const idMap = Object.fromEntries(TABLE_NAMES.map((n) => [n, new Map<number, number>()])) as Record<TableName, Map<number, number>>

  for (const name of TABLE_NAMES) {
    let rows = (data.tables[name] ?? []) as (Tables[TableName] & { id?: number })[]
    if (rows.length === 0) continue
    onProgress?.(`Restaurando ${name} (${rows.length})…`)
    if (name === 'transactions') rows = rows.filter((r) => !(r as Tables['transactions']).importHash || !existingHashes.has((r as Tables['transactions']).importHash))
    const fks = FKS[name] ?? {}
    const prepared = rows.map((r) => {
      const copy: Record<string, unknown> = { ...r }
      delete copy.id
      for (const [field, target] of Object.entries(fks)) {
        const old = copy[field] as number | undefined
        if (old == null) continue
        const mapped = idMap[target].get(old)
        // referência para algo que não veio no backup: obrigatória -> descarta a linha; opcional -> limpa
        if (mapped == null) copy[field] = undefined
        else copy[field] = mapped
      }
      return copy
    })
    const required = name === 'investmentMovements' || name === 'investmentSnapshots' ? 'investmentId' : name === 'assetValuations' ? 'assetId' : null
    const keepIdx = prepared.map((p, i) => (required && p[required] == null ? -1 : i)).filter((i) => i >= 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = await (repo[name] as any).bulkAdd(keepIdx.map((i) => prepared[i]))
    keepIdx.forEach((origIdx, j) => {
      const oldId = rows[origIdx].id
      const newId = (saved[j] as { id?: number }).id
      if (oldId != null && newId != null) idMap[name].set(oldId, newId)
    })
  }
}

/** Apaga todos os dados do usuário (ordem inversa por causa das FKs) */
export async function wipeAll() {
  for (const name of [...TABLE_NAMES].reverse()) await repo[name].clear()
}
