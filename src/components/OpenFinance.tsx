import { useState } from 'react'
import { AlertTriangle, Landmark, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge, Card, Confirm } from './ui'
import { addOpenFinanceItem, parseItemId, removeOpenFinanceItem, syncBanksNow, useOpenFinanceItems, type SyncResult } from '../data/openFinance'
import type { OpenFinanceItem } from '../db/types'

const STATUS: Record<string, { label: string; color: string }> = {
  UPDATED: { label: 'conectado', color: '#2fd18b' },
  UPDATING: { label: 'atualizando', color: '#38bdf8' },
  OUTDATED: { label: 'desatualizado', color: '#ffc857' },
  LOGIN_ERROR: { label: 'reconectar no Meu Pluggy', color: '#ff5c7a' },
  WAITING_USER_INPUT: { label: 'precisa de ação no banco', color: '#ff5c7a' },
}

function when(iso?: string) {
  if (!iso) return 'nunca sincronizado'
  const d = new Date(iso)
  return `sincronizado ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function OpenFinanceCard() {
  const items = useOpenFinanceItems()
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<OpenFinanceItem | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  async function add() {
    const id = parseItemId(input)
    if (!id) return setError('Cole o id do item (um UUID, ex.: 1b2c3d4e-…). Ele aparece no dashboard da Pluggy, na aplicação demo.')
    setError('')
    setAdding(true)
    try {
      await addOpenFinanceItem(id)
      setInput('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function sync() {
    setError('')
    setResult(null)
    setSyncing(true)
    try {
      setResult(await syncBanksNow())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card
      title="Open Finance"
      subtitle="Transações dos seus bancos e cartões entram sozinhas, a cada 6 horas, via Meu Pluggy"
      className="mb-4"
      action={
        <button className="btn-primary" disabled={syncing || items.length === 0} onClick={sync}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      }
    >
      {items.length > 0 && (
        <ul className="divide-y divide-border mb-4">
          {items.map((it) => {
            const st = it.status ? STATUS[it.status] : undefined
            return (
              <li key={it.id} className="py-2.5 flex items-start justify-between gap-3 group">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><Landmark size={16} className="text-brand" /></span>
                  <div className="min-w-0">
                    <p className="font-medium truncate flex items-center gap-2">
                      {it.name ?? 'Banco (aguardando a primeira sincronização)'}
                      {st && <Badge color={st.color}>{st.label}</Badge>}
                    </p>
                    <p className="text-[11px] text-muted">{when(it.lastSyncedAt)} · item {it.itemId.slice(0, 8)}…</p>
                    {it.lastError && <p className="text-[11px] text-expense mt-1">{it.lastError}</p>}
                    {it.lastReport && !it.lastError && <p className="text-[11px] text-muted mt-1 whitespace-pre-line">{it.lastReport}</p>}
                  </div>
                </div>
                <button className="btn-ghost p-1.5 hover:text-expense opacity-0 group-hover:opacity-100 transition" title="Desconectar" onClick={() => setRemoving(it)}>
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="input flex-1"
          placeholder="Id do item do Meu Pluggy (UUID)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn-secondary" disabled={adding || !input.trim()} onClick={add}><Plus size={16} /> Conectar banco</button>
      </div>
      <button className="text-[11px] text-muted mt-2 underline-offset-2 hover:underline" onClick={() => setShowHelp((v) => !v)}>
        {showHelp ? 'Esconder' : 'Onde pego o id do item?'}
      </button>
      {showHelp && (
        <ol className="text-xs text-muted mt-2 space-y-1 list-decimal pl-5">
          <li>Crie a conta grátis em <b>meu.pluggy.ai</b> e conecte seus bancos (a autorização é feita no app de cada banco).</li>
          <li>Entre em <b>dashboard.pluggy.ai</b> com a mesma conta, abra a aplicação <b>demo</b> e conecte seus itens do Meu Pluggy a ela (escolha o conector "Meu Pluggy", não o do banco).</li>
          <li>Cada banco conectado vira um <b>item</b> com um id (UUID). Cole o id aqui, um por banco.</li>
          <li>O Client ID e o Client Secret da aplicação demo ficam nos segredos da Edge Function <code>sync-banks</code> no Supabase (PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET).</li>
        </ol>
      )}

      {error && <p className="text-sm text-expense mt-3 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
      {result && (
        <div className={`mt-3 rounded-xl border p-3 text-sm whitespace-pre-line ${result.ok ? 'border-income/30' : 'border-expense/30'}`}>
          {result.mensagem}
        </div>
      )}

      <Confirm
        open={!!removing}
        title="Desconectar banco?"
        message="As contas e lançamentos já importados continuam no app; só param de entrar novos. Para revogar o consentimento de verdade, faça isso no Meu Pluggy."
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing?.id) removeOpenFinanceItem(removing.id).catch((e) => setError((e as Error).message))
        }}
      />
    </Card>
  )
}

