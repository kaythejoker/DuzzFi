import { repo } from '../data/store'
import { supabase } from '../data/supabase'
import type { Category } from './types'

const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  // Despesas
  { name: 'Moradia', type: 'expense', color: '#8a00ff', icon: 'home', keywords: ['aluguel', 'condominio', 'condomínio', 'iptu', 'luz', 'energia', 'enel', 'cemig', 'agua', 'água', 'sabesp', 'gas', 'fibra', 'vivo fibra', 'claro'] },
  { name: 'Alimentação', type: 'expense', color: '#fb923c', icon: 'utensils', keywords: ['mercado', 'supermercado', 'carrefour', 'extra', 'pao de acucar', 'assai', 'atacadao', 'ifood', 'rappi', 'restaurante', 'padaria', 'lanchonete', 'burger', 'pizza', 'mc donalds', 'mcdonalds', 'subway'] },
  { name: 'Transporte', type: 'expense', color: '#ffc857', icon: 'car', keywords: ['uber', '99app', '99 pop', '99 tecnologia', 'posto', 'combustivel', 'combustível', 'gasolina', 'ipiranga', 'shell', 'estacionamento', 'pedagio', 'pedágio', 'metro', 'onibus', 'bilhete unico'] },
  { name: 'Saúde', type: 'expense', color: '#f472b6', icon: 'heart-pulse', keywords: ['farmacia', 'farmácia', 'drogaria', 'droga raia', 'drogasil', 'pacheco', 'hospital', 'clinica', 'clínica', 'laboratorio', 'plano de saude', 'unimed', 'amil', 'dentista'] },
  { name: 'Educação', type: 'expense', color: '#c4a1ff', icon: 'graduation-cap', keywords: ['curso', 'faculdade', 'udemy', 'alura', 'escola', 'livro', 'amazon livros', 'coursera'] },
  { name: 'Lazer', type: 'expense', color: '#34d399', icon: 'party-popper', keywords: ['cinema', 'show', 'ingresso', 'bar', 'viagem', 'hotel', 'airbnb', 'booking', 'steam', 'playstation', 'xbox'] },
  { name: 'Assinaturas', type: 'expense', color: '#38bdf8', icon: 'tv', keywords: ['netflix', 'spotify', 'amazon prime', 'disney', 'hbo', 'max', 'youtube', 'apple.com', 'icloud', 'google one', 'chatgpt', 'openai', 'anthropic', 'adobe', 'microsoft', 'notion', 'figma'] },
  { name: 'Compras', type: 'expense', color: '#e879f9', icon: 'shopping-bag', keywords: ['amazon', 'mercado livre', 'mercadolivre', 'shopee', 'aliexpress', 'magazine', 'magalu', 'americanas', 'shein', 'renner', 'zara', 'riachuelo'] },
  { name: 'Vestuário', type: 'expense', color: '#c084fc', icon: 'shirt', keywords: ['roupa', 'tenis', 'tênis', 'nike', 'adidas', 'centauro'] },
  { name: 'Pets', type: 'expense', color: '#facc15', icon: 'paw-print', keywords: ['petz', 'cobasi', 'veterinario', 'veterinário', 'pet shop', 'petshop'] },
  { name: 'Impostos e taxas', type: 'expense', color: '#ff5c7a', icon: 'landmark', keywords: ['darf', 'das simples', 'simples nacional', 'inss', 'imposto', 'tarifa', 'taxa', 'iof', 'anuidade', 'juros'] },
  { name: 'Cuidados pessoais', type: 'expense', color: '#fb7185', icon: 'sparkles', keywords: ['barbearia', 'salao', 'salão', 'cabelereiro', 'academia', 'smartfit', 'smart fit', 'bluefit'] },
  { name: 'Presentes e doações', type: 'expense', color: '#2dd4bf', icon: 'gift', keywords: ['presente', 'doacao', 'doação'] },
  { name: 'Investimento (saída)', type: 'expense', color: '#818cf8', icon: 'trending-up', keywords: ['aplicacao', 'aplicação', 'tesouro', 'cdb', 'xp inv', 'rico', 'nuinvest', 'clear', 'binance', 'inter invest'] },
  { name: 'Outros', type: 'expense', color: '#9a9aa5', icon: 'circle-ellipsis', keywords: [] },
  // Receitas
  { name: 'Salário', type: 'income', color: '#2fd18b', icon: 'briefcase', keywords: ['salario', 'salário', 'folha', 'pagamento salario'] },
  { name: 'Pró-labore', type: 'income', color: '#5fe0a6', icon: 'building-2', keywords: ['pro labore', 'pró-labore', 'prolabore'] },
  { name: 'Distribuição de lucros', type: 'income', color: '#1fa86e', icon: 'pie-chart', keywords: ['lucro', 'distribuicao', 'distribuição', 'dividendo'] },
  { name: 'Freelance / Serviços', type: 'income', color: '#9aefc6', icon: 'laptop', keywords: ['nf', 'nota fiscal', 'servico', 'serviço'] },
  { name: 'Rendimentos', type: 'income', color: '#2dd4bf', icon: 'percent', keywords: ['rendimento', 'juros', 'resgate'] },
  { name: 'Aluguel recebido', type: 'income', color: '#8a00ff', icon: 'key-round', keywords: ['aluguel recebido'] },
  { name: 'Reembolso', type: 'income', color: '#c4a1ff', icon: 'rotate-ccw', keywords: ['reembolso', 'estorno', 'devolucao', 'devolução', 'devolvido', 'receita federal', 'restituicao'] },
  { name: 'Outras receitas', type: 'income', color: '#9a9aa5', icon: 'plus-circle', keywords: [] },
]

/**
 * Cria categorias padrão e uma conta na primeira vez que o usuário entra.
 * A marca "seeded" fica nos metadados do usuário, então excluir todas as
 * categorias depois não faz elas voltarem sozinhas.
 */
export async function seedIfNeeded(force = false) {
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user || (!force && user.user_metadata?.duzz_seeded)) return
  if (repo.categories.rows().length === 0) await repo.categories.bulkAdd(DEFAULT_CATEGORIES as Category[])
  if (repo.accounts.rows().length === 0) {
    await repo.accounts.add({
      name: 'Conta principal',
      type: 'checking',
      color: '#8a00ff',
      initialBalance: 0,
      createdAt: new Date().toISOString(),
    })
  }
  await supabase.auth.updateUser({ data: { duzz_seeded: true } })
}
