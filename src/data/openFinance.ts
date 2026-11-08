// Open Finance: bancos conectados (itens do Meu Pluggy) e a sincronização feita pela Edge Function sync-banks

import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { reload } from './store'
import type { OpenFinanceItem } from '../db/types'

export interface SyncResult {
  ok: boolean
  added: number
  skipped: number
  lines: string[]
  errors: string[]
  mensagem: string
}

let items: OpenFinanceItem[] = []
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const fromDb = (r: Record<string, unknown>): OpenFinanceItem => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) if (k !== 'user_id' && v !== null) out[toCamel(k)] = v
  return out as unknown as OpenFinanceItem
}

export async function loadOpenFinanceItems() {
  const { data, error } = await supabase.from('open_finance_items').select('*').order('id')
  if (error) throw new Error(error.message)
  items = (data as Record<string, unknown>[]).map(fromDb)
  loaded = true
  emit()
}

export function useOpenFinanceItems() {
  const list = useSyncExternalStore(subscribe, () => items)
  useEffect(() => {
    if (!loaded) loadOpenFinanceItems().catch(() => undefined)
  }, [])
  return list
}

/** Aceita o id puro ou uma URL/trecho que contenha o UUID do item */
export function parseItemId(input: string) {
  const m = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return m ? m[0].toLowerCase() : null
}

export async function addOpenFinanceItem(itemId: string) {
  const { error } = await supabase.from('open_finance_items').insert({ item_id: itemId })
  if (error) throw new Error(error.code === '23505' ? 'Esse banco já está conectado.' : error.message)
  await loadOpenFinanceItems()
}

export async function removeOpenFinanceItem(id: number) {
  const { error } = await supabase.from('open_finance_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await loadOpenFinanceItems()
}

/** Chama a Edge Function, recarrega contas e lançamentos e devolve o relatório */
export async function syncBanksNow(firstSyncDays?: number): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>('sync-banks', {
    body: firstSyncDays ? { primeiraSincronizacaoDias: firstSyncDays } : {},
  })
  if (error) {
    // a função devolve JSON com "mensagem" mesmo em erro
    const ctx = (error as { context?: Response }).context
    const body = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(body?.mensagem ?? error.message)
  }
  if (!data) throw new Error('Sem resposta da sincronização.')
  await Promise.all([reload(['accounts', 'transactions']), loadOpenFinanceItems()])
  return data
}
