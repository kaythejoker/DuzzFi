# Duzz Finance

Controle financeiro pessoal completo: gastos, receitas, fontes de renda (CLT, sociedades, empresas, freelas), investimentos, patrimônio e a evolução de tudo isso ao longo do tempo.

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e entre com seu email e senha.

## Banco de dados (Supabase)

Os dados ficam num projeto Supabase pessoal (`wenjxwdxsdvmfmmaschn`), com login por email e senha. Cada tabela tem RLS: um usuário só lê e grava as próprias linhas.

1. **Schema:** aplique `supabase/migrations/20261105120000_init.sql`, pelo MCP do Supabase ou colando no SQL Editor do painel.
2. **Chaves:** copie `.env.example` para `.env.local` e preencha a chave publicável (Project Settings → API Keys → Publishable key). Reinicie `npm run dev` depois de editar.
3. **Conta:** crie sua conta na tela inicial do app. Se a confirmação de email estiver ativa, confirme pelo link.
4. **Recomendado:** depois de criar sua conta, desative novos cadastros em Authentication → Sign In / Providers, já que o app é de uso pessoal.

Na primeira entrada o app cria as categorias padrão e uma conta "Conta principal".

## Páginas

| Página | Para quê |
| --- | --- |
| Dashboard | Resumo do mês: receitas, despesas, saldo, aportes, patrimônio, gastos por categoria, orçamento e últimos lançamentos |
| Transações | Todos os lançamentos, com busca, filtros, edição e recategorização em massa |
| Categorias & Orçamento | Categorias de gasto/receita, limite mensal por categoria e palavras-chave para categorizar extratos automaticamente |
| Fontes de renda | CLT, PJ, sociedade, empresa, freela, dividendos, aluguel… com valor esperado vs recebido |
| Investimentos | Carteira por tipo, aportes, resgates, proventos, atualização do valor de mercado e rentabilidade |
| Patrimônio & Contas | Contas bancárias, participações em empresas/sociedades (com % e valuation), bens e dívidas |
| Crescimento | Evolução do patrimônio líquido, renda por tipo de fonte, taxa de poupança, aportes e resumo por ano |
| Importar / Exportar | Importação de extrato CSV/OFX, backup JSON, exportação CSV e restauração |

## Importando extratos

1. Exporte o extrato do banco em **CSV** ou **OFX** (Nubank, Inter, Itaú, BB, Bradesco, C6, XP etc.).
2. Arraste o arquivo em **Importar / Exportar**.
3. Confira o mapeamento de colunas (data, descrição, valor). Ele é detectado automaticamente.
4. Para **fatura de cartão**, marque "Inverter sinal" se os gastos vierem positivos.
5. Revise: as categorias são sugeridas pelas palavras-chave de cada categoria, e lançamentos já importados antes são marcados como duplicados e desmarcados.

## Como os números são calculados

- **Saldo da conta** = saldo inicial + receitas − despesas ± transferências.
- **Valor de um investimento** = último valor de mercado informado + aportes/rendimentos − resgates feitos depois dessa data. Sem valor informado, usa o total aportado.
- **Aportes e resgates** registrados na página de Investimentos viram transferências nas transações, então não contam como despesa nem como receita.
- **Empresas e sociedades** entram no patrimônio pela sua participação: valuation × %.
- **Patrimônio líquido** = contas + investimentos + empresas e bens − dívidas (incluindo saldo negativo de cartão de crédito).

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Supabase (Postgres + Auth), Recharts, PapaParse, date-fns. Identidade visual da Duzz: fontes Outfit, Geist e Geist Mono, roxo `#8a00ff` sobre fundo `#0b0b0f`.
