// Cotações de renda variável: a Edge Function update-quotes busca o preço de cada posição
// (investment_holdings) e grava quantidade × cotação como valor de mercado do dia.

import { supabase } from './supabase'
import { reload } from './store'

export interface QuoteResult {
  ok: boolean
  /** investimentos com valor de mercado gravado */
  updated: number
  /** tickers cotados com sucesso */
  priced: number
  lines: string[]
  errors: string[]
  mensagem: string
}

/** Chama a Edge Function, recarrega posições e valores e devolve o relatório */
export async function updateQuotesNow(): Promise<QuoteResult> {
  const { data, error } = await supabase.functions.invoke<QuoteResult>('update-quotes', { body: {} })
  if (error) {
    // a função devolve JSON com "mensagem" mesmo em erro
    const ctx = (error as { context?: Response }).context
    const body = ctx ? await ctx.json().catch(() => null) : null
    throw new Error(body?.mensagem ?? error.message)
  }
  if (!data) throw new Error('Sem resposta da atualização de cotações.')
  await reload(['investmentHoldings', 'investmentSnapshots'])
  return data
}
