import { useMemo, useState } from 'react'
import { Building2, CreditCard, Landmark, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader } from '../components/Shell'
import { CreditCardsCard } from '../components/CreditCards'
import { Badge, Card, ColorPicker, Confirm, Dot, EmptyState, Field, Kpi, Modal, MoneyInput, Segmented } from '../components/ui'
import { tooltipMoney, tooltipStyle } from '../components/charts'
import {
  useAccounts,
  useAssetValuations,
  useAssets,
  useInvestmentMovements,
  useInvestmentSnapshots,
  useInvestments,
  useTransactions,
} from '../hooks/useData'
import { repo } from '../data/store'
import {
  ACCOUNT_TYPE_LABEL,
  ASSET_TYPE_LABEL,
  ASSET_TYPES_BY_KIND,
  PALETTE,
  type Account,
  type AccountType,
  type Asset,
  type AssetType,
} from '../db/types'
import { accountBalance, assetValue, netWorthSeries } from '../lib/calc'
import { currentYM, fmtBRL, fmtDate, fmtPct, todayISO } from '../lib/format'

const emptyAccount = (): Account => ({ name: '', type: 'checking', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], initialBalance: 0, createdAt: new Date().toISOString() })
const emptyAsset = (kind: 'ativo' | 'passivo'): Asset => ({ name: '', type: kind === 'ativo' ? 'empresa' : 'emprestimo', kind, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], createdAt: new Date().toISOString() })

export function NetWorthPage() {
  const accounts = useAccounts()
  const txs = useTransactions()
  const investments = useInvestments()
  const movements = useInvestmentMovements()
  const snapshots = useInvestmentSnapshots()
  const assets = useAssets()
  const valuations = useAssetValuations()

  const [accOpen, setAccOpen] = useState(false)
  const [accEditing, setAccEditing] = useState<Account | null>(null)
  const [accDelete, setAccDelete] = useState<Account | null>(null)
  const [assetOpen, setAssetOpen] = useState<null | 'ativo' | 'passivo'>(null)
  const [assetEditing, setAssetEditing] = useState<Asset | null>(null)
  const [assetDelete, setAssetDelete] = useState<Asset | null>(null)
  const [valFor, setValFor] = useState<Asset | null>(null)

  const nw = useMemo(
    () => netWorthSeries({ accounts, txs, investments, movements, snapshots, assets, valuations }, currentYM(), 2),
    [accounts, txs, investments, movements, snapshots, assets, valuations],
  )
  const now = nw[1]
  const prev = nw[0]

  // cartão de crédito não é conta: fica na seção própria, fora do caixa
  const accRows = useMemo(
    () => accounts.filter((a) => !a.archived && a.type !== 'credit_card').map((a) => ({ acc: a, balance: accountBalance(a, txs) })),
    [accounts, txs],
  )
  const cardRows = useMemo(
    () => accounts.filter((a) => !a.archived && a.type === 'credit_card').map((a) => ({ acc: a, balance: accountBalance(a, txs) })),
    [accounts, txs],
  )
  const assetRows = useMemo(
    () =>
      assets
        .filter((a) => !a.archived)
        .map((a) => {
          const last = valuations.filter((v) => v.assetId === a.id).sort((x, y) => (x.date < y.date ? 1 : -1))[0]
          return { asset: a, value: assetValue(a, valuations), raw: last?.value ?? 0, lastDate: last?.date }
        }),
    [assets, valuations],
  )

  const composition = [
    { name: 'Caixa (contas)', value: now.cash, color: '#2fd18b' },
    { name: 'Investimentos', value: now.investments, color: '#8a00ff' },
    { name: 'Empresas & bens', value: now.assets, color: '#c4a1ff' },
  ].filter((c) => c.value > 0)
  const gross = now.cash + now.investments + now.assets

  async function removeAccount(a: Account) {
    if (!a.id) return
    await repo.accounts.update(a.id, { archived: true })
  }
  async function removeAsset(a: Asset) {
    if (!a.id) return
    // o histórico de valores é apagado junto (FK on delete cascade)
    await repo.assets.delete(a.id)
  }

  return (
    <>
      <PageHeader title="Patrimônio & Contas" subtitle="Onde o dinheiro está: contas, investimentos, empresas, bens e dívidas" />

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <Kpi
          label="Patrimônio líquido"
          value={fmtBRL(now.netWorth)}
          tone="accent"
          hint={prev.netWorth ? `${now.netWorth >= prev.netWorth ? '▲' : '▼'} ${fmtBRL(Math.abs(now.netWorth - prev.netWorth))} vs mês passado` : undefined}
        />
        <Kpi label="Caixa em contas" value={fmtBRL(now.cash)} tone="income" icon={<Landmark />} />
        <Kpi label="Investimentos" value={fmtBRL(now.investments)} tone="invest" />
        <Kpi label="Empresas & bens" value={fmtBRL(now.assets)} icon={<Building2 />} />
        <Kpi label="Passivos" value={fmtBRL(now.liabilities)} tone="expense" icon={<CreditCard />} hint={gross ? `${fmtPct(now.liabilities / gross)} do bruto` : undefined} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        {/* Contas */}
        <Card
          title="Contas"
          subtitle="Saldo = saldo inicial + lançamentos"
          className="xl:col-span-2"
          action={<button className="btn-secondary py-1.5!" onClick={() => { setAccEditing(null); setAccOpen(true) }}><Plus size={14} /> Conta</button>}
        >
          {accRows.length === 0 ? (
            <EmptyState title="Nenhuma conta" />
          ) : (
            <ul className="divide-y divide-border/60">
              {accRows.map(({ acc, balance }) => (
                <li key={acc.id} className="py-2.5 flex items-center justify-between gap-3 group">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${acc.color}22` }}>
                      <Dot color={acc.color} size={12} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{acc.name}</p>
                      <p className="text-[11px] text-muted">{ACCOUNT_TYPE_LABEL[acc.type]}{acc.institution ? ` · ${acc.institution}` : ''}{acc.externalId ? ' · Open Finance' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={`font-semibold tabular-nums ${balance < 0 ? 'text-expense' : ''}`}>{fmtBRL(balance)}</p>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <button className="btn-ghost p-1.5" onClick={() => { setAccEditing(acc); setAccOpen(true) }}><Pencil size={14} /></button>
                      <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => setAccDelete(acc)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Composição do patrimônio bruto">
          {composition.length === 0 ? (
            <EmptyState title="Sem dados ainda" description="Lance transações, investimentos ou bens." />
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={composition} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                      {composition.map((c) => <Cell key={c.name} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={tooltipMoney} {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 mt-2">
                {composition.map((c) => (
                  <li key={c.name} className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><Dot color={c.color} />{c.name}</span>
                    <span className="text-muted tabular-nums">{fmtPct(c.value / (gross || 1))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <CreditCardsCard
        rows={cardRows}
        onAdd={() => { setAccEditing({ ...emptyAccount(), type: 'credit_card' }); setAccOpen(true) }}
        onEdit={(a) => { setAccEditing(a); setAccOpen(true) }}
        onDelete={setAccDelete}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <AssetList
          title="Empresas, sociedades & bens"
          subtitle="Participações e ativos com valor estimado"
          kind="ativo"
          rows={assetRows.filter((r) => r.asset.kind === 'ativo')}
          onAdd={() => { setAssetEditing(null); setAssetOpen('ativo') }}
          onEdit={(a) => { setAssetEditing(a); setAssetOpen(a.kind) }}
          onDelete={setAssetDelete}
          onValuate={setValFor}
        />
        <AssetList
          title="Dívidas & passivos"
          subtitle="Empréstimos, financiamentos e outras obrigações"
          kind="passivo"
          rows={assetRows.filter((r) => r.asset.kind === 'passivo')}
          onAdd={() => { setAssetEditing(null); setAssetOpen('passivo') }}
          onEdit={(a) => { setAssetEditing(a); setAssetOpen(a.kind) }}
          onDelete={setAssetDelete}
          onValuate={setValFor}
        />
      </div>

      <AccountModal open={accOpen} onClose={() => setAccOpen(false)} editing={accEditing} />
      <AssetModal open={!!assetOpen} onClose={() => setAssetOpen(null)} editing={assetEditing} kind={assetOpen ?? 'ativo'} />
      <ValuationModal open={!!valFor} onClose={() => setValFor(null)} asset={valFor} current={valFor ? assetRows.find((r) => r.asset.id === valFor.id)?.raw ?? 0 : 0} />
      <Confirm open={!!accDelete} onClose={() => setAccDelete(null)} onConfirm={() => accDelete && removeAccount(accDelete)} message={<>Arquivar a conta “{accDelete?.name}”? Ela deixa de aparecer, mas os lançamentos são mantidos.</>} />
      <Confirm open={!!assetDelete} onClose={() => setAssetDelete(null)} onConfirm={() => assetDelete && removeAsset(assetDelete)} message={<>Excluir “{assetDelete?.name}” e seu histórico de valores?</>} />
    </>
  )
}

function AssetList({ title, subtitle, kind, rows, onAdd, onEdit, onDelete, onValuate }: {
  title: string
  subtitle: string
  kind: 'ativo' | 'passivo'
  rows: { asset: Asset; value: number; raw: number; lastDate?: string }[]
  onAdd: () => void
  onEdit: (a: Asset) => void
  onDelete: (a: Asset) => void
  onValuate: (a: Asset) => void
}) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <Card title={title} subtitle={subtitle} action={<button className="btn-secondary py-1.5!" onClick={onAdd}><Plus size={14} /> {kind === 'ativo' ? 'Ativo' : 'Passivo'}</button>}>
      {rows.length === 0 ? (
        <EmptyState
          icon={kind === 'ativo' ? <Building2 size={28} /> : <CreditCard size={28} />}
          title={kind === 'ativo' ? 'Nenhuma empresa ou bem cadastrado' : 'Nenhuma dívida cadastrada'}
          description={kind === 'ativo' ? 'Cadastre sua participação em empresas/sociedades (com % e valuation), imóveis e veículos para contar no patrimônio.' : 'Financiamentos, empréstimos e dívidas de cartão reduzem o patrimônio líquido.'}
        />
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {rows.map(({ asset, value, raw, lastDate }) => (
              <li key={asset.id} className="py-2.5 flex items-center justify-between gap-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${asset.color}22` }}>
                    <Dot color={asset.color} size={12} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{asset.name}</p>
                    <p className="text-[11px] text-muted flex flex-wrap items-center gap-1.5">
                      <Badge color={asset.color}>{ASSET_TYPE_LABEL[asset.type]}</Badge>
                      {asset.ownershipPct != null && (asset.type === 'empresa' || asset.type === 'sociedade') && <span>{asset.ownershipPct}% de {fmtBRL(raw)}</span>}
                      {lastDate ? <span>· atualizado {fmtDate(lastDate)}</span> : <span className="text-warn">· sem valor informado</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className={`font-semibold tabular-nums ${kind === 'passivo' ? 'text-expense' : ''}`}>{fmtBRL(value)}</p>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button className="btn-ghost p-1.5" title="Atualizar valor" onClick={() => onValuate(asset)}><RefreshCw size={14} /></button>
                    <button className="btn-ghost p-1.5" onClick={() => onEdit(asset)}><Pencil size={14} /></button>
                    <button className="btn-ghost p-1.5 hover:text-expense" onClick={() => onDelete(asset)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-right text-sm text-muted mt-3">Total: <b className={kind === 'passivo' ? 'text-expense' : 'text-text'}>{fmtBRL(total)}</b></p>
        </>
      )}
    </Card>
  )
}

function AccountModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Account | null }) {
  const [form, setForm] = useState<Account>(editing ?? emptyAccount())
  const [err, setErr] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ?? emptyAccount())
      setErr('')
    }
  }
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setForm((f) => ({ ...f, [k]: v }))
  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome à conta.')
    const payload = { ...form, name: form.name.trim() }
    if (editing?.id) await repo.accounts.put({ ...payload, id: editing.id })
    else await repo.accounts.add(payload)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={editing?.id ? (form.type === 'credit_card' ? 'Editar cartão' : 'Editar conta') : form.type === 'credit_card' ? 'Novo cartão' : 'Nova conta'} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="space-y-4">
        <Field label="Nome"><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nubank, Itaú, Carteira…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className="input" value={form.type} onChange={(e) => set('type', e.target.value as AccountType)}>
              {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Instituição"><input className="input" value={form.institution ?? ''} onChange={(e) => set('institution', e.target.value || undefined)} /></Field>
        </div>
        {form.type === 'credit_card' ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Limite"><MoneyInput value={form.creditLimit ?? 0} onChange={(v) => set('creditLimit', v || undefined)} /></Field>
              <Field label="Fecha dia"><input className="input" type="number" min={1} max={31} value={form.closingDay ?? ''} onChange={(e) => set('closingDay', e.target.value ? Number(e.target.value) : undefined)} /></Field>
              <Field label="Vence dia"><input className="input" type="number" min={1} max={31} value={form.dueDay ?? ''} onChange={(e) => set('dueDay', e.target.value ? Number(e.target.value) : undefined)} /></Field>
            </div>
            <Field label="Fatura em aberto hoje" hint="Valor que você já deve neste cartão antes dos lançamentos registrados aqui. Fica como saldo inicial negativo.">
              <MoneyInput value={Math.max(0, -form.initialBalance)} onChange={(v) => set('initialBalance', -Math.abs(v))} />
            </Field>
          </>
        ) : (
          <Field label="Saldo inicial" hint="Saldo da conta antes do primeiro lançamento registrado aqui.">
            <MoneyInput value={form.initialBalance} onChange={(v) => set('initialBalance', v)} />
          </Field>
        )}
        <Field label="Cor"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}

function AssetModal({ open, onClose, editing, kind }: { open: boolean; onClose: () => void; editing: Asset | null; kind: 'ativo' | 'passivo' }) {
  const [form, setForm] = useState<Asset>(editing ?? emptyAsset(kind))
  const [initialValue, setInitialValue] = useState(0)
  const [err, setErr] = useState('')
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(editing ?? emptyAsset(kind))
      setInitialValue(0)
      setErr('')
    }
  }
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => setForm((f) => ({ ...f, [k]: v }))
  const isCompany = form.type === 'empresa' || form.type === 'sociedade'
  async function save() {
    if (!form.name.trim()) return setErr('Dê um nome.')
    const payload: Asset = { ...form, name: form.name.trim(), ownershipPct: isCompany ? form.ownershipPct ?? 100 : undefined }
    if (editing?.id) await repo.assets.put({ ...payload, id: editing.id })
    else {
      const saved = await repo.assets.add(payload)
      if (initialValue) await repo.assetValuations.add({ assetId: saved.id!, date: todayISO(), value: initialValue })
    }
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar' : form.kind === 'ativo' ? 'Nova empresa / bem' : 'Novo passivo'} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="space-y-4">
        <Segmented value={form.kind} onChange={(k) => setForm({ ...form, kind: k, type: ASSET_TYPES_BY_KIND[k][0] })} options={[{ value: 'ativo', label: 'Ativo' }, { value: 'passivo', label: 'Passivo' }]} />
        <Field label="Nome"><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={form.kind === 'ativo' ? 'Duzz Ltda, Apartamento, Carro' : 'Financiamento apto, Empréstimo'} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className="input" value={form.type} onChange={(e) => set('type', e.target.value as AssetType)}>
              {ASSET_TYPES_BY_KIND[form.kind].map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          {isCompany && (
            <Field label="Sua participação (%)">
              <input type="number" min={0} max={100} step={0.5} className="input" value={form.ownershipPct ?? 100} onChange={(e) => set('ownershipPct', Number(e.target.value))} />
            </Field>
          )}
        </div>
        {!editing && (
          <Field label={isCompany ? 'Valuation atual da empresa (100%)' : form.kind === 'ativo' ? 'Valor estimado hoje' : 'Saldo devedor hoje'} hint={isCompany ? 'Sua parte é calculada pela % de participação.' : undefined}>
            <MoneyInput value={initialValue} onChange={setInitialValue} />
          </Field>
        )}
        <Field label="Cor"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
        <Field label="Observações"><textarea className="input min-h-[60px]" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="CNPJ, sócios, taxa de juros, prazo…" /></Field>
        {err && <p className="text-sm text-expense">{err}</p>}
      </div>
    </Modal>
  )
}

function ValuationModal({ open, onClose, asset, current }: { open: boolean; onClose: () => void; asset: Asset | null; current: number }) {
  const [value, setValue] = useState(current)
  const [date, setDate] = useState(todayISO())
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setValue(current)
      setDate(todayISO())
    }
  }
  const isCompany = asset?.type === 'empresa' || asset?.type === 'sociedade'
  async function save() {
    if (!asset?.id) return
    await repo.assetValuations.upsert({ assetId: asset.id, date, value }, 'asset_id,date')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Atualizar valor · ${asset?.name ?? ''}`} width="max-w-sm" footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="space-y-4">
        <Field label={isCompany ? 'Valuation da empresa (100%)' : asset?.kind === 'passivo' ? 'Saldo devedor' : 'Valor estimado'} hint={isCompany && asset?.ownershipPct != null ? `Sua parte (${asset.ownershipPct}%): ${fmtBRL(value * asset.ownershipPct / 100)}` : undefined}>
          <MoneyInput value={value} onChange={setValue} autoFocus />
        </Field>
        <Field label="Data"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
