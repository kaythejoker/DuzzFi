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
| Despesas fixas | Aluguel, contas e assinaturas com dia de vencimento: o que vence, o que já foi pago no mês e o peso na renda |
| Fontes de renda | CLT, PJ, sociedade, empresa, freela, dividendos, aluguel… com valor esperado vs recebido e dia em que cai |
| Investimentos | Carteira por tipo, aportes, resgates, proventos, atualização do valor de mercado e rentabilidade |
| Patrimônio & Contas | Contas bancárias, participações em empresas/sociedades (com % e valuation), bens e dívidas |
| Crescimento | Evolução do patrimônio líquido, renda por tipo de fonte, taxa de poupança, aportes e resumo por ano |
| Importar / Exportar | Bancos conectados via Open Finance, importação de extrato CSV/OFX, backup JSON, exportação CSV e restauração |

## Open Finance: transações dos bancos entrando sozinhas

Com o [Meu Pluggy](https://meu.pluggy.ai) (gratuito para pessoa física) as transações de todos os seus bancos e cartões entram no app sem importar extrato. Tudo roda no Supabase: uma Edge Function (`supabase/functions/sync-banks`) agendada pelo `pg_cron` a cada 6 horas, mais o botão **Sincronizar agora** na página Importar / Exportar. Os bancos atualizam no Meu Pluggy uma vez por dia.

### Configurar uma vez

1. Crie a conta em [meu.pluggy.ai](https://meu.pluggy.ai) e conecte seus bancos (o consentimento é feito no app de cada banco).
2. Entre em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) com a mesma conta, abra a aplicação **demo** e conecte seus itens do Meu Pluggy a ela, escolhendo o conector **Meu Pluggy** (não o do banco direto). Cada banco vira um **item** com um id.
3. No Supabase, em **Edge Functions → Secrets**, crie `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` com os valores da aplicação demo.
4. No app, em **Importar / Exportar → Open Finance**, cole o id de cada item e clique em **Conectar banco**. Depois **Sincronizar agora**.

Se estiver subindo o projeto do zero: aplique as migrations (`accounts_open_finance` e `open_finance_items`, que também criam o segredo no Vault e o agendamento) e faça o deploy da função com `supabase functions deploy sync-banks --no-verify-jwt`.

### O que a sincronização faz

- **Contas**: cada conta/cartão do banco vira uma conta no app (ex.: "Nubank · Conta", "Nubank · Cartão"). Se já existir uma conta do mesmo tipo com o nome do banco no nome ou na instituição, ela é reaproveitada. Pode renomear à vontade: a ligação fica no campo `external_id`. Conta nova recebe saldo inicial ajustado para bater com o saldo do banco.
- **Lançamentos**: `import_hash = pluggy:<id>` garante que nada entra duas vezes. Categoria pelas **palavras-chave** das categorias; despesa fixa e fonte de renda pelo nome (ex.: "Aluguel", "Salário"). Recebem a etiqueta `open-finance`.
- **Transferências**: saída numa conta e entrada de mesmo valor em outra conta sua (até 1 dia de diferença) viram uma transferência só. Pagamento de fatura vira transferência conta → cartão, e o "pagamento recebido" do lado do cartão é ignorado.
- **Cartão**: compras entram na data da compra (inclusive as da fatura aberta); parcelas vêm com "parcela 2/10" na observação.
- **Primeira sincronização** traz 90 dias. Se já importou extrato desses meses, vai duplicar (o hash do extrato é outro): apague os lançamentos antigos antes ou conecte só depois.

Se apagar no app um lançamento dos últimos 7 dias, ele volta na próxima sincronização (essa janela é reconferida). Quando um banco pede reconexão, o item aparece como "reconectar no Meu Pluggy".

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

## Lançar por voz (MCP)

A pasta [`mcp/`](mcp/README.md) tem um servidor MCP com Whisper local para rodar numa VPS. Com ele dá para lançar gastos falando no iPhone (Atalho da Siri) ou pelo Claude. O passo a passo de instalação está em [mcp/README.md](mcp/README.md).

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, Supabase (Postgres + Auth), Recharts, PapaParse, date-fns. Identidade visual da Duzz: fontes Outfit, Geist e Geist Mono, roxo `#8a00ff` sobre fundo `#0b0b0f`.
