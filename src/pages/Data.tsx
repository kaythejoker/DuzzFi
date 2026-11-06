import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FileSpreadsheet, FileUp, Upload } from 'lucide-react'
import { PageHeader } from '../components/Shell'
import { Badge, Card, Confirm, Field, Modal } from '../components/ui'
import { useAccounts, useCategories, useIncomeSources } from '../hooks/useData'
import { repo } from '../data/store'
import type { Transaction } from '../db/types'
import { hashRows, isOfx, parseOfx, previewCsv, rowsFromCsv, suggestCategory, type CsvColumns, type CsvPreview, type ParsedRow } from '../lib/import'
import { seedIfNeeded } from '../db/seed'
import { exportBackupJson, exportInvestmentsCsv, exportTransactionsCsv, restoreBackup, wipeAll, type Backup, type RestoreMode } from '../lib/export'
import { fmtBRL, fmtDate } from '../lib/format'

interface StagedRow extends ParsedRow {
  hash: string
  include: boolean
  duplicate: boolean
  categoryId?: number
  incomeSourceId?: number
}

export function DataPage() {
  const accounts = useAccounts()
  const categories = useCategories()
  const sources = useIncomeSources()
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState<CsvPreview | null>(null)
  const [cols, setCols] = useState<CsvColumns | null>(null)
  const [invert, setInvert] = useState(false)
  const [ofxRows, setOfxRows] = useState<ParsedRow[] | null>(null)
  const [accountId, setAccountId] = useState<number | undefined>(undefined)
  const [staged, setStaged] = useState<StagedRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null)
  const [error, setError] = useState('')

  const [restore, setRestore] = useState<{ data: Backup; mode: RestoreMode } | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const activeAccounts = accounts.filter((a) => !a.archived)
  const effectiveAccount = accountId ?? activeAccounts[0]?.id

  const parsedRows = useMemo<ParsedRow[]>(() => {
    if (ofxRows) return ofxRows
    if (csv && cols) return rowsFromCsv(csv, cols, invert)
    return []
  }, [ofxRows, csv, cols, invert])

  async function onFile(file: File) {
    setError('')
    setDone(null)
    setStaged(null)
    setFileName(file.name)
    const buf = await file.arrayBuffer()
    // tenta UTF-8, cai para latin1 se houver caracteres inválidos
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (text.includes('�')) text = new TextDecoder('iso-8859-1').decode(buf)
    if (isOfx(text, file.name)) {
      const rows = parseOfx(text)
      if (rows.length === 0) return setError('Não encontrei lançamentos neste arquivo OFX.')
      setOfxRows(rows)
      setCsv(null)
      setCols(null)
    } else {
      const p = previewCsv(text)
      if (p.rows.length === 0) return setError('Não encontrei linhas com data neste arquivo. Confira se é um CSV de extrato.')
      setCsv(p)
      setCols(p.guess)
      setOfxRows(null)
    }
  }

  async function stage() {
    setError('')
    const hashes = hashRows(parsedRows)
    const existing = new Set(repo.transactions.rows().map((t) => t.importHash).filter(Boolean))
    const rows: StagedRow[] = parsedRows.map((r, i) => {
      const hash = hashes[i]
      const dup = existing.has(hash)
      return {
        ...r,
        hash,
        duplicate: dup,
        include: !dup,
        categoryId: suggestCategory(`${r.description} ${r.memo ?? ''}`, r.type, categories),
      }
    })
    setStaged(rows)
  }

  async function commit() {
    if (!staged) return
    setImporting(true)
    try {
      const toAdd: Transaction[] = staged
        .filter((r) => r.include)
        .map((r) => ({
          date: r.date,
          amount: r.amount,
          type: r.type,
          description: r.description,
          notes: r.memo,
          categoryId: r.categoryId,
          incomeSourceId: r.type === 'income' ? r.incomeSourceId : undefined,
          accountId: effectiveAccount,
          importHash: r.hash,
          createdAt: new Date().toISOString(),
        }))
      await repo.transactions.bulkAdd(toAdd)
      setDone({ added: toAdd.length, skipped: staged.length - toAdd.length })
      setStaged(null)
      setCsv(null)
      setOfxRows(null)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setImporting(false)
    }
  }

  function updateRow(i: number, patch: Partial<StagedRow>) {
    setStaged((s) => (s ? s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : s))
  }

  async function onBackupFile(file: File) {
    setError('')
    try {
      const data = JSON.parse(await file.text()) as Backup
      if (data.app !== 'duzzfinance') throw new Error()
      setRestore({ data, mode: 'append' })
    } catch {
      setError('Este arquivo não é um backup válido do DuzzFinance.')
    }
    if (backupRef.current) backupRef.current.value = ''
  }

  const stats = staged
    ? {
        total: staged.length,
        include: staged.filter((r) => r.include).length,
        dup: staged.filter((r) => r.duplicate).length,
        exp: staged.filter((r) => r.include && r.type === 'expense').reduce((s, r) => s + r.amount, 0),
        inc: staged.filter((r) => r.include && r.type === 'income').reduce((s, r) => s + r.amount, 0),
      }
    : null

  return (
    <>
      <PageHeader title="Importar / Exportar" subtitle="Traga o extrato do banco, faça backups e leve seus dados para onde quiser" />

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        {/* Importar */}
        <Card title="Importar extrato" subtitle="CSV ou OFX exportado do seu banco (Nubank, Inter, Itaú, BB, Bradesco, C6, XP…)" className="xl:col-span-2">
          <div
            className="border-2 border-dashed border-border rounded-2xl p-6 text-center hover:border-brand/60 transition cursor-pointer"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) onFile(f)
            }}
          >
            <FileUp className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">{fileName || 'Arraste o arquivo aqui ou clique para escolher'}</p>
            <p className="text-xs text-muted mt-1">.csv, .txt, .ofx, .qfx</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,.ofx,.qfx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>

          {error && <p className="text-sm text-expense mt-3 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
          {done && (
            <p className="text-sm text-income mt-3">
              ✓ Importação concluída: {done.added} lançamento(s) adicionados{done.skipped ? `, ${done.skipped} ignorados` : ''}.
            </p>
          )}

          {(csv || ofxRows) && !staged && (
            <div className="mt-4 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Conta de destino">
                  <select className="input" value={effectiveAccount ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                    {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
                {csv && cols && (
                  <label className="flex items-center gap-2 text-sm mt-6">
                    <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
                    Inverter sinal (fatura de cartão: valores positivos são gastos)
                  </label>
                )}
              </div>

              {csv && cols && (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-xs font-medium text-muted mb-2">Mapeamento de colunas (detectado automaticamente, ajuste se precisar)</p>
                  <div className="grid sm:grid-cols-5 gap-3">
                    {(['date', 'description', 'amount'] as const).map((k) => (
                      <Field key={k} label={k === 'date' ? 'Data' : k === 'description' ? 'Descrição' : 'Valor'}>
                        <select className="input" value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: Number(e.target.value) })}>
                          {csv.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                        </select>
                      </Field>
                    ))}
                    <Field label="Histórico (opcional)">
                      <select className="input" value={cols.memo ?? ''} onChange={(e) => setCols({ ...cols, memo: e.target.value ? Number(e.target.value) : undefined })}>
                        <option value="">— não há —</option>
                        {csv.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                      </select>
                    </Field>
                    <Field label="Crédito (se separado)">
                      <select className="input" value={cols.credit ?? ''} onChange={(e) => setCols({ ...cols, credit: e.target.value ? Number(e.target.value) : undefined })}>
                        <option value="">— não há —</option>
                        {csv.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted mb-2">Prévia ({parsedRows.length} lançamentos reconhecidos)</p>
                <div className="overflow-x-auto max-h-56 overflow-y-auto rounded-xl border border-border">
                  <table className="table">
                    <thead><tr><th>Data</th><th>Descrição</th><th className="text-right">Valor</th></tr></thead>
                    <tbody>
                      {parsedRows.slice(0, 15).map((r, i) => (
                        <tr key={i}>
                          <td className="text-muted whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="max-w-[320px]">
                            <p className="truncate">{r.description}</p>
                            {r.memo && <p className="text-[11px] text-muted truncate">{r.memo}</p>}
                          </td>
                          <td className={`text-right tabular-nums ${r.type === 'expense' ? 'text-expense' : 'text-income'}`}>{r.type === 'expense' ? '- ' : '+ '}{fmtBRL(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-end">
                <button className="btn-primary" disabled={parsedRows.length === 0} onClick={stage}>Continuar: revisar e categorizar</button>
              </div>
            </div>
          )}
        </Card>

        {/* Exportar */}
        <div className="space-y-4">
          <Card title="Exportar" subtitle="Seus dados são seus">
            <div className="space-y-2">
              <button className="btn-secondary w-full justify-start" onClick={exportBackupJson}><Database size={16} /> Backup completo (JSON)</button>
              <button className="btn-secondary w-full justify-start" onClick={exportTransactionsCsv}><FileSpreadsheet size={16} /> Transações (CSV p/ Excel)</button>
              <button className="btn-secondary w-full justify-start" onClick={exportInvestmentsCsv}><FileSpreadsheet size={16} /> Investimentos (CSV)</button>
            </div>
            <p className="text-[11px] text-muted mt-3">O backup JSON contém tudo (contas, categorias, lançamentos, rendas, investimentos, patrimônio) e pode ser restaurado aqui em qualquer navegador.</p>
          </Card>
          <Card title="Restaurar backup">
            <button className="btn-secondary w-full justify-start" onClick={() => backupRef.current?.click()}><Upload size={16} /> Escolher arquivo .json</button>
            <input ref={backupRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && onBackupFile(e.target.files[0])} />
          </Card>
          <Card title="Zona de perigo" className="border-expense/30">
            <button className="btn-danger w-full justify-start" onClick={() => setWipeOpen(true)}><AlertTriangle size={16} /> Apagar todos os dados</button>
          </Card>
        </div>
      </div>

      {/* Revisão */}
      {staged && stats && (
        <Card
          title="Revisar importação"
          subtitle={`${stats.include} de ${stats.total} serão importados · ${stats.dup} duplicado(s) detectado(s) · + ${fmtBRL(stats.inc)} / − ${fmtBRL(stats.exp)}`}
          bodyClassName="p-0!"
          action={
            <div className="flex gap-2">
              <button className="btn-secondary py-1.5!" onClick={() => setStaged(null)}>Voltar</button>
              <button className="btn-primary py-1.5!" disabled={importing || stats.include === 0} onClick={commit}>
                <Download size={14} /> Importar {stats.include}
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8"><input type="checkbox" checked={staged.every((r) => r.include)} onChange={(e) => setStaged(staged.map((r) => ({ ...r, include: e.target.checked })))} /></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th className="text-right">Valor</th>
                  <th>Categoria</th>
                  <th>Fonte (receitas)</th>
                </tr>
              </thead>
              <tbody>
                {staged.map((r, i) => (
                  <tr key={r.hash + i} className={!r.include ? 'opacity-50' : ''}>
                    <td><input type="checkbox" checked={r.include} onChange={(e) => updateRow(i, { include: e.target.checked })} /></td>
                    <td className="text-muted whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td>
                      <p className="truncate max-w-[300px]">{r.description}</p>
                      {r.memo && <p className="text-[11px] text-muted truncate max-w-[300px]">{r.memo}</p>}
                      {r.duplicate && <Badge className="bg-warn/15 text-warn">já importado</Badge>}
                    </td>
                    <td className={`text-right tabular-nums whitespace-nowrap ${r.type === 'expense' ? 'text-expense' : 'text-income'}`}>{r.type === 'expense' ? '- ' : '+ '}{fmtBRL(r.amount)}</td>
                    <td>
                      <select className="input py-1! text-xs!" value={r.categoryId ?? ''} onChange={(e) => updateRow(i, { categoryId: e.target.value ? Number(e.target.value) : undefined })}>
                        <option value="">— sem categoria —</option>
                        {categories.filter((c) => c.type === r.type && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      {r.type === 'income' ? (
                        <select className="input py-1! text-xs!" value={r.incomeSourceId ?? ''} onChange={(e) => updateRow(i, { incomeSourceId: e.target.value ? Number(e.target.value) : undefined })}>
                          <option value="">—</option>
                          {sources.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Restore modal */}
      <Modal
        open={!!restore}
        onClose={() => setRestore(null)}
        title="Restaurar backup"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRestore(null)}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={restoring}
              onClick={async () => {
                if (!restore) return
                setRestoring(true)
                try {
                  await restoreBackup(restore.data, restore.mode)
                  setRestore(null)
                  setDone(null)
                } catch (e) {
                  setError((e as Error).message)
                  setRestore(null)
                } finally {
                  setRestoring(false)
                }
              }}
            >
              {restoring ? 'Restaurando…' : 'Restaurar'}
            </button>
          </>
        }
      >
        {restore && (
          <div className="space-y-3 text-sm">
            <p>
              Backup de <b>{fmtDate(restore.data.exportedAt.slice(0, 10))}</b> com{' '}
              <b>{(restore.data.tables.transactions?.length ?? 0).toLocaleString('pt-BR')}</b> lançamentos,{' '}
              <b>{restore.data.tables.investments?.length ?? 0}</b> investimentos e <b>{restore.data.tables.incomeSources?.length ?? 0}</b> fontes de renda.
            </p>
            <label className="flex items-start gap-2">
              <input type="radio" checked={restore.mode === 'append'} onChange={() => setRestore({ ...restore, mode: 'append' })} className="mt-1" />
              <span><b>Adicionar</b>: mantém o que já existe e acrescenta os registros do backup. Lançamentos importados de extrato que já existem são ignorados.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" checked={restore.mode === 'replace'} onChange={() => setRestore({ ...restore, mode: 'replace' })} className="mt-1" />
              <span><b>Substituir</b>: apaga tudo que está na sua conta e deixa exatamente como no backup.</span>
            </label>
          </div>
        )}
      </Modal>

      <Confirm
        open={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title="Apagar todos os dados?"
        onConfirm={async () => { await wipeAll(); await seedIfNeeded(true) }}
        message="Isso remove contas, categorias, lançamentos, rendas, investimentos e patrimônio da sua conta no banco. Categorias padrão e uma conta são recriadas. Exporte um backup antes se quiser guardar."
      />
    </>
  )
}
