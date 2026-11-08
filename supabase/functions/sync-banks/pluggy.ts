// Cliente mínimo da API do Pluggy (Open Finance) — https://docs.pluggy.ai
// Para uso pessoal: conecte os bancos no Meu Pluggy (meu.pluggy.ai), pegue o Client ID / Secret
// da aplicação demo no dashboard.pluggy.ai e o id de cada item (banco) conectado.

const BASE = 'https://api.pluggy.ai'

export interface PluggyConfig {
  clientId: string
  clientSecret: string
}

export interface PluggyItem {
  id: string
  /** UPDATING, UPDATED, OUTDATED, LOGIN_ERROR, WAITING_USER_INPUT */
  status: string
  executionStatus?: string | null
  lastUpdatedAt?: string | null
  connector: { id: number; name: string; imageUrl?: string; type?: string }
  error?: { code?: string; message?: string } | null
}

export interface PluggyAccount {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT'
  /** CHECKING_ACCOUNT, SAVINGS_ACCOUNT, CREDIT_CARD... */
  subtype?: string | null
  name: string
  marketingName?: string | null
  number?: string | null
  balance: number
  currencyCode?: string
  creditData?: {
    brand?: string | null
    level?: string | null
    creditLimit?: number | null
    availableCreditLimit?: number | null
    /** data de fechamento da fatura atual (ISO) */
    balanceCloseDate?: string | null
    /** data de vencimento da fatura atual (ISO) */
    balanceDueDate?: string | null
  } | null
}

export interface PluggyTransaction {
  id: string
  accountId: string
  description: string
  descriptionRaw?: string | null
  /** conta bancária: negativo = saída. cartão: positivo = compra, negativo = pagamento da fatura/estorno */
  amount: number
  amountInAccountCurrency?: number | null
  currencyCode?: string
  /** ISO 8601 (UTC) */
  date: string
  type?: 'DEBIT' | 'CREDIT'
  status?: 'PENDING' | 'POSTED'
  category?: string | null
  merchant?: { name?: string | null } | null
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null } | null
  paymentData?: { paymentMethod?: string | null } | null
}

export class Pluggy {
  private key?: { value: string; expiresAt: number }
  private legacyTransactions = false

  constructor(private cfg: PluggyConfig) {}

  private async apiKey(force = false) {
    if (!force && this.key && Date.now() < this.key.expiresAt) return this.key.value
    const res = await fetch(`${BASE}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Pluggy: login falhou (HTTP ${res.status}). Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.`)
    const body = (await res.json()) as { apiKey?: string }
    if (!body.apiKey) throw new Error('Pluggy: resposta do login sem apiKey.')
    this.key = { value: body.apiKey, expiresAt: Date.now() + 90 * 60_000 } // vale 2h
    return body.apiKey
  }

  private async get<T>(path: string, retry = true): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': await this.apiKey() }, signal: AbortSignal.timeout(60_000) })
    if (res.status === 401 && retry) {
      await this.apiKey(true)
      return this.get<T>(path, false)
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200)
      throw Object.assign(new Error(`Pluggy GET ${path.split('?')[0]} respondeu ${res.status}${text ? `: ${text}` : ''}`), { status: res.status })
    }
    return (await res.json()) as T
  }

  item(id: string) {
    return this.get<PluggyItem>(`/items/${encodeURIComponent(id)}`)
  }

  async accounts(itemId: string) {
    const r = await this.get<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`)
    return r.results ?? []
  }

  /** Transações de uma conta entre duas datas (yyyy-MM-dd, inclusivas), todas as páginas */
  async transactions(accountId: string, from: string, to: string): Promise<PluggyTransaction[]> {
    if (this.legacyTransactions) return this.transactionsLegacy(accountId, from, to)
    try {
      return await this.transactionsV2(accountId, from, to)
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status !== 404 && status !== 403) throw e
      this.legacyTransactions = true
      return this.transactionsLegacy(accountId, from, to)
    }
  }

  private async transactionsV2(accountId: string, from: string, to: string) {
    const out: PluggyTransaction[] = []
    let path: string | null = `/v2/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${from}&dateTo=${to}`
    for (let i = 0; path && i < 200; i++) {
      const page: { results: PluggyTransaction[]; next?: string | null } = await this.get(path)
      out.push(...(page.results ?? []))
      path = nextPath(page.next)
    }
    return out
  }

  private async transactionsLegacy(accountId: string, from: string, to: string) {
    const out: PluggyTransaction[] = []
    for (let page = 1; page < 200; page++) {
      const r: { results: PluggyTransaction[]; totalPages?: number } = await this.get(
        `/transactions?accountId=${encodeURIComponent(accountId)}&from=${from}&to=${to}&pageSize=500&page=${page}`,
      )
      out.push(...(r.results ?? []))
      if (!r.totalPages || page >= r.totalPages) break
    }
    return out
  }
}

/** `next` vem como query string ("?accountId=...&after=..."), caminho ou URL completa */
function nextPath(next: string | null | undefined): string | null {
  if (!next) return null
  if (next.startsWith('http')) return next.replace(BASE, '')
  if (next.startsWith('?')) return `/v2/transactions${next}`
  if (next.startsWith('/')) return next
  return `/v2/transactions?${next}`
}
