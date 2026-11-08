// Ferramentas que o Claude enxerga no MCP do Duzz Finance

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { defaultAccountId, findByName, handlePhrase, monthSummary, txLine } from './actions'
import type { NewTransaction, TxType } from './domain'
import type { Finance } from './finance'
import { formatReport, type SyncReport } from './sync'
import { dayInYM, keywordMatches, normalize, todayISO } from './text'

const TYPE_MAP: Record<string, TxType> = { despesa: 'expense', receita: 'income', transferencia: 'transfer' }
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use yyyy-MM-dd')
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'use yyyy-MM')

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (e: unknown): ToolResult => ({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(e)
  }
}

export function buildMcpServer(finance: Finance, opts: { defaultAccount?: string; sync?: () => Promise<SyncReport> } = {}) {
  const server = new McpServer(
    { name: 'duzz-finance', version: '1.0.0' },
    {
      instructions: [
        'MCP do Duzz Finance, o controle financeiro pessoal do usuário (valores em reais, datas em yyyy-MM-dd, fuso de São Paulo).',
        'Para anotar algo que o usuário falou ou ditou, prefira `lancar_frase` com a frase como ele disse; use `registrar_lancamento` quando já souber os campos.',
        'Depois de lançar, confirme em uma linha o que foi gravado. Se ele disser que errou, use `desfazer_ultimo` ou `editar_lancamento`.',
        'Use `cadastros` para ver nomes exatos de categorias, contas, despesas fixas e fontes de renda.',
        ...(opts.sync
          ? ['`sincronizar_bancos` puxa agora as transações dos bancos conectados via Open Finance (elas também entram sozinhas periodicamente).']
          : []),
      ].join(' '),
    },
  )

  server.registerTool(
    'lancar_frase',
    {
      title: 'Lançar a partir de uma frase',
      description:
        'Entende uma frase em português e grava o lançamento. Ex.: "gastei 35 no mercado ontem", "uber 18,50 no cartão", ' +
        '"paguei o aluguel", "caiu o salário", "recebi 500 do freela", "transferi 200 pra reserva", "desfaz o último". ' +
        'Descobre valor, data, conta, categoria (pelas palavras-chave do app) e despesa fixa/fonte de renda citada. ' +
        'Com salvar=false só mostra o que lançaria.',
      inputSchema: {
        frase: z.string().min(1).describe('A frase como o usuário falou'),
        salvar: z.boolean().default(true).describe('false = só pré-visualizar'),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ frase, salvar }) =>
      run(async () => {
        const r = await handlePhrase(finance, frase, { save: salvar, tag: 'mcp', defaultAccount: opts.defaultAccount })
        if (!r.ok) throw new Error(r.message)
        return r.transaction && 'id' in r.transaction ? `${r.message}\n(id #${r.transaction.id})` : r.message
      }),
  )

  server.registerTool(
    'registrar_lancamento',
    {
      title: 'Registrar lançamento',
      description:
        'Grava uma despesa, receita ou transferência com campos explícitos. Categoria, conta, despesa fixa e fonte de renda são ' +
        'informadas pelo NOME (veja `cadastros`). Sem categoria, ela é sugerida pelas palavras-chave da descrição.',
      inputSchema: {
        tipo: z.enum(['despesa', 'receita', 'transferencia']),
        valor: z.number().positive().describe('Valor em reais, sempre positivo'),
        descricao: z.string().min(1),
        data: dateSchema.optional().describe('Padrão: hoje'),
        categoria: z.string().optional(),
        conta: z.string().optional().describe('Conta de origem. Padrão: conta principal'),
        conta_destino: z.string().optional().describe('Só para transferência'),
        despesa_fixa: z.string().optional().describe('Despesa fixa que este pagamento quita (ex.: Aluguel)'),
        fonte_renda: z.string().optional().describe('Fonte de renda deste recebimento (ex.: Salário CLT)'),
        observacao: z.string().optional(),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    (a) =>
      run(async () => {
        const reg = await finance.registry()
        const type = TYPE_MAP[a.tipo]
        const activeAccounts = reg.accounts.filter((x) => !x.archived)
        const accountId = a.conta ? findByName(activeAccounts, a.conta, 'conta').id : defaultAccountId(reg, opts.defaultAccount)
        let toAccountId: number | null = null
        if (type === 'transfer') {
          if (!a.conta_destino) throw new Error('Transferência precisa de conta_destino.')
          toAccountId = findByName(activeAccounts, a.conta_destino, 'conta').id
          if (toAccountId === accountId) throw new Error('Conta de origem e destino são a mesma.')
        }
        const bill = a.despesa_fixa ? findByName(reg.recurringExpenses, a.despesa_fixa, 'despesa fixa') : undefined
        const source = a.fonte_renda ? findByName(reg.incomeSources, a.fonte_renda, 'fonte de renda') : undefined
        let categoryId: number | null = null
        if (type !== 'transfer') {
          const cats = reg.categories.filter((c) => c.type === type && !c.archived)
          if (a.categoria) categoryId = findByName(cats, a.categoria, 'categoria').id
          else categoryId = bill?.categoryId ?? source?.defaultCategoryId ?? suggest(a.descricao, cats) ?? null
        }
        const tx: NewTransaction = {
          date: a.data ?? todayISO(),
          amount: Math.round(a.valor * 100) / 100,
          type,
          description: a.descricao,
          categoryId,
          accountId: accountId ?? null,
          toAccountId,
          recurringExpenseId: type === 'expense' ? (bill?.id ?? null) : null,
          incomeSourceId: type === 'income' ? (source?.id ?? null) : null,
          notes: a.observacao ?? null,
          tags: ['mcp'],
        }
        const saved = await finance.insert(tx)
        return `Anotado: ${txLine(saved, reg)}`
      }),
  )

  server.registerTool(
    'desfazer_ultimo',
    {
      title: 'Desfazer último lançamento',
      description: 'Apaga o último lançamento criado pelo MCP ou por voz (não mexe no que foi feito no app).',
      inputSchema: {},
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    () =>
      run(async () => {
        const reg = await finance.registry()
        const last = await finance.lastCreatedHere()
        if (!last) throw new Error('Nenhum lançamento feito pelo MCP ou por voz para desfazer.')
        await finance.remove(last.id)
        return `Apaguei: ${txLine(last, reg)}`
      }),
  )

  server.registerTool(
    'editar_lancamento',
    {
      title: 'Editar lançamento',
      description: 'Corrige um lançamento pelo id (veja `ultimos_lancamentos`). Só os campos informados mudam.',
      inputSchema: {
        id: z.number().int().positive(),
        valor: z.number().positive().optional(),
        descricao: z.string().min(1).optional(),
        data: dateSchema.optional(),
        categoria: z.string().optional(),
        conta: z.string().optional(),
        observacao: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      run(async () => {
        const reg = await finance.registry()
        const current = await finance.get(a.id)
        if (!current) throw new Error(`Lançamento #${a.id} não existe.`)
        const patch: Partial<NewTransaction> = {}
        if (a.valor !== undefined) patch.amount = Math.round(a.valor * 100) / 100
        if (a.descricao !== undefined) patch.description = a.descricao
        if (a.data !== undefined) patch.date = a.data
        if (a.observacao !== undefined) patch.notes = a.observacao
        if (a.conta !== undefined) patch.accountId = findByName(reg.accounts.filter((x) => !x.archived), a.conta, 'conta').id
        if (a.categoria !== undefined) {
          if (current.type === 'transfer') throw new Error('Transferência não tem categoria.')
          patch.categoryId = findByName(reg.categories.filter((c) => c.type === current.type && !c.archived), a.categoria, 'categoria').id
        }
        if (!Object.keys(patch).length) throw new Error('Nada para mudar.')
        const saved = await finance.update(a.id, patch)
        return `Atualizado: ${txLine(saved, reg)}`
      }),
  )

  server.registerTool(
    'apagar_lancamento',
    {
      title: 'Apagar lançamento',
      description: 'Apaga um lançamento pelo id. Confirme com o usuário antes, mostrando qual é.',
      inputSchema: { id: z.number().int().positive() },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) =>
      run(async () => {
        const reg = await finance.registry()
        const removed = await finance.remove(id)
        if (!removed) throw new Error(`Lançamento #${id} não existe.`)
        return `Apaguei: ${txLine(removed, reg)}`
      }),
  )

  server.registerTool(
    'ultimos_lancamentos',
    {
      title: 'Últimos lançamentos',
      description: 'Lista os lançamentos mais recentes, com id. Filtra por mês (yyyy-MM) e/ou texto da descrição.',
      inputSchema: {
        quantidade: z.number().int().min(1).max(100).default(10),
        mes: monthSchema.optional(),
        busca: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ quantidade, mes, busca }) =>
      run(async () => {
        const reg = await finance.registry()
        const today = todayISO()
        const txs = await finance.list({
          limit: quantidade,
          search: busca,
          ...(mes ? { from: `${mes}-01`, to: dayInYM(mes, 31) } : {}),
        })
        if (!txs.length) return 'Nenhum lançamento encontrado.'
        return txs.map((t) => txLine(t, reg, today)).join('\n')
      }),
  )

  server.registerTool(
    'resumo_mes',
    {
      title: 'Resumo do mês',
      description: 'Receitas, despesas, gastos por categoria (com limite), despesas fixas pagas/pendentes e saldo das contas.',
      inputSchema: { mes: monthSchema.optional().describe('Padrão: mês atual') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ mes }) => run(() => monthSummary(finance, mes ?? todayISO().slice(0, 7))),
  )

  server.registerTool(
    'cadastros',
    {
      title: 'Cadastros',
      description: 'Nomes de contas, categorias, despesas fixas e fontes de renda, para usar nas outras ferramentas.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const reg = await finance.registry(true)
        const cats = (t: 'expense' | 'income') =>
          reg.categories
            .filter((c) => c.type === t && !c.archived)
            .map((c) => c.name)
            .join(', ')
        return [
          `Contas: ${reg.accounts.filter((a) => !a.archived).map((a) => a.name).join(', ')}`,
          `Categorias de despesa: ${cats('expense')}`,
          `Categorias de receita: ${cats('income')}`,
          `Despesas fixas: ${reg.recurringExpenses.filter((b) => b.active).map((b) => `${b.name} (dia ${b.dueDay})`).join(', ') || 'nenhuma'}`,
          `Fontes de renda: ${reg.incomeSources.filter((s) => s.active).map((s) => s.name).join(', ') || 'nenhuma'}`,
        ].join('\n')
      }),
  )

  if (opts.sync) {
    const sync = opts.sync
    server.registerTool(
      'sincronizar_bancos',
      {
        title: 'Sincronizar bancos (Open Finance)',
        description:
          'Busca agora as transações novas dos bancos e cartões conectados via Open Finance (Pluggy) e grava como lançamentos, ' +
          'categorizados pelas palavras-chave. Mostra o saldo de cada conta no banco. Pode levar alguns segundos.',
        inputSchema: {},
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      () => run(async () => formatReport(await sync())),
    )
  }

  return server
}

function suggest(text: string, cats: { id: number; name: string; keywords: string[] }[]) {
  const n = normalize(text)
  let best: { id: number; len: number } | undefined
  for (const c of cats)
    for (const kw of [...c.keywords, c.name]) {
      const len = normalize(kw).length
      if (keywordMatches(n, kw) && (!best || len > best.len)) best = { id: c.id, len }
    }
  return best?.id
}

