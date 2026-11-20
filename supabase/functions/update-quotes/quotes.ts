// Cotações de renda variável pelo endpoint público do Yahoo Finance (sem chave; atraso de ~15 min).

export interface Quote {
  /** preço do último negócio */
  price: number
  /** data do pregão a que o preço se refere (YYYY-MM-DD, horário de Brasília) */
  date: string
  currency: string
}

const TZ = 'America/Sao_Paulo'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Códigos da B3 (ITSA4, LVBI11, BBAS3, ITSA4F) ganham o sufixo .SA; o resto é passado como está (AAPL, BTC-USD) */
export function yahooSymbol(ticker: string) {
  const t = ticker.trim().toUpperCase()
  if (t.includes('.')) return t
  return /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(t) ? `${t}.SA` : t
}

export function dateInTz(unixSeconds: number, tz = TZ) {
  const d = new Date(unixSeconds * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

interface ChartMeta {
  regularMarketPrice?: number
  regularMarketTime?: number
  currency?: string
}

export async function fetchQuote(ticker: string, fetchFn: typeof fetch = fetch): Promise<Quote> {
  const symbol = yahooSymbol(ticker)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  const res = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (res.status === 404) throw new Error(`${ticker}: código não encontrado no Yahoo Finance (${symbol})`)
  if (!res.ok) throw new Error(`${ticker}: Yahoo Finance respondeu ${res.status}`)
  const body = (await res.json()) as { chart?: { result?: { meta?: ChartMeta }[] | null; error?: { description?: string } | null } }
  if (body.chart?.error) throw new Error(`${ticker}: ${body.chart.error.description ?? 'erro na cotação'}`)
  const meta = body.chart?.result?.[0]?.meta
  const price = meta?.regularMarketPrice
  if (typeof price !== 'number' || !(price > 0)) throw new Error(`${ticker}: sem preço na resposta`)
  const time = meta?.regularMarketTime
  return { price, date: typeof time === 'number' ? dateInTz(time) : dateInTz(Date.now() / 1000), currency: meta?.currency ?? 'BRL' }
}

/** Busca várias cotações de uma vez (um ticker falhando não derruba os outros) */
export async function fetchQuotes(tickers: string[], fetchFn: typeof fetch = fetch) {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))]
  const quotes = new Map<string, Quote>()
  const errors = new Map<string, string>()
  await Promise.all(
    unique.map(async (t) => {
      try {
        quotes.set(t, await fetchQuote(t, fetchFn))
      } catch (e) {
        errors.set(t, e instanceof Error ? e.message : String(e))
      }
    }),
  )
  return { quotes, errors }
}
