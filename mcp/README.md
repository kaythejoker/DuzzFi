# Duzz Finance · MCP + voz

Lance gastos e receitas falando. Tudo roda na sua VPS:

```
iPhone ──(Atalho / Siri: áudio)──► /voz ──► Whisper local ──► entende a frase ──► Supabase
Claude (iPhone, desktop, Code) ──► /mcp/<token> ──► ferramentas do Duzz Finance ──► Supabase
Seus bancos ──(Open Finance / Meu Pluggy)──► sincronização a cada 6h ──► lançamentos ──► Supabase
```

- **`server/`**: servidor Node. Tem o MCP (Streamable HTTP) e a rota de voz.
- **`whisper/`**: transcrição local com [faster-whisper](https://github.com/SYSTRAN/faster-whisper). O áudio não sai da sua VPS.
- **`Caddyfile`**: HTTPS automático (Let's Encrypt).

O servidor entra no Supabase com o **seu login do app**, então o RLS continua valendo e ele só enxerga os seus dados.

## O que dá pra falar

| Você fala | Vira |
| --- | --- |
| "gastei 35,90 no mercado ontem" | Despesa R$ 35,90 · Mercado · Alimentação · ontem |
| "uber de dezoito reais no cartão" | Despesa R$ 18,00 · Uber · Transporte · conta do cartão |
| "paguei o aluguel" | Despesa fixa Aluguel com o valor cadastrado, marcada como paga |
| "caiu o salário" | Receita da fonte Salário CLT com o valor esperado |
| "recebi 500 do freela dia 3" | Receita R$ 500 · Freela · dia 3 |
| "transferi 200 pra reserva" | Transferência da conta principal para a conta "reserva" |
| "desfaz" / "apaga o último" | Apaga o último lançamento feito por voz ou MCP |

A categoria sai das **palavras-chave das categorias** do app (as mesmas da importação de extrato). Se uma palavra cair na categoria errada, ajuste as palavras-chave em Categorias. Os lançamentos por voz recebem a etiqueta `voz` e guardam a frase original na observação.

## Ferramentas do MCP

`lancar_frase`, `registrar_lancamento`, `desfazer_ultimo`, `editar_lancamento`, `apagar_lancamento`, `ultimos_lancamentos`, `resumo_mes`, `cadastros` e, com o Open Finance configurado, `sincronizar_bancos`.

---

## Instalação na VPS (passo a passo)

Você precisa de uma VPS Linux (Ubuntu 22.04/24.04) com **pelo menos 2 GB de RAM** (4 GB se for usar o modelo `medium`) e acesso SSH como root ou com `sudo`.

### 1. Instalar o Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

### 2. Abrir as portas 80 e 443

Se usar o firewall `ufw`:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Se o seu provedor tem firewall no painel (Hetzner, AWS, Oracle...), libere 80 e 443 lá também.

### 3. Baixar o projeto

```bash
git clone https://github.com/kaythejoker/DuzzFi.git /opt/duzzfi
cd /opt/duzzfi/mcp
```

### 4. Configurar

```bash
cp .env.example .env
openssl rand -hex 32     # copie o resultado: é o seu MCP_TOKEN
nano .env
```

Preencha:

- **`DOMAIN`**: se não tiver domínio, use o IP da VPS com traços + `.sslip.io`. Exemplo: o IP `203.0.113.10` vira `203-0-113-10.sslip.io`. Se tiver domínio, crie um registro A apontando para o IP e use ele aqui (ex.: `duzz.seudominio.com`).
- **`MCP_TOKEN`**: o valor gerado acima. Funciona como senha, não compartilhe.
- **`SUPABASE_PUBLISHABLE_KEY`**: a mesma `VITE_SUPABASE_PUBLISHABLE_KEY` do `.env.local` do app.
- **`DUZZ_EMAIL`** / **`DUZZ_PASSWORD`**: seu login do Duzz Finance.

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`. Depois proteja o arquivo:

```bash
chmod 600 .env
```

### 5. Subir

```bash
docker compose up -d --build
docker compose logs -f
```

Na primeira vez o Whisper baixa o modelo (≈ 500 MB no `small`). Espere aparecer `Modelo pronto.` e `Duzz Finance MCP ouvindo na porta 8787`. Saia dos logs com `Ctrl+C`; os serviços continuam rodando.

### 6. Testar

Troque `SEU_DOMINIO` e `SEU_TOKEN`:

```bash
curl https://SEU_DOMINIO/health
curl -X POST "https://SEU_DOMINIO/voz?salvar=0&formato=texto" \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: text/plain" \
  --data "gastei 35 reais no mercado"
```

A segunda resposta deve ser algo como `Lançaria: Despesa de R$ 35,00 · Mercado · Alimentação ...`. Com `salvar=0` nada é gravado.

---

## Usar no iPhone

### Opção A: Atalho com Siri (voz → Whisper da VPS)

No app **Atalhos**, toque em **+** e monte:

1. **Gravar Áudio**: Início *Imediatamente*, Fim *Ao Tocar*. (Para soltar sozinho quando você para de falar, troque por *Após pausa*.)
2. **Obter Conteúdo do URL**:
   - URL: `https://SEU_DOMINIO/voz?formato=texto`
   - Método: **POST**
   - Cabeçalhos: `Authorization` = `Bearer SEU_TOKEN`
   - Corpo da Solicitação: **Arquivo**, escolhendo o *Áudio Gravado*
3. **Falar Texto** com o *Conteúdo do URL*. Se preferir só ler, use **Mostrar Resultado**.

Dê o nome **"Anotar gasto"**. Agora é só dizer *"E aí Siri, anotar gasto"*, falar a frase e ouvir a confirmação. Também dá para pôr o atalho na Tela de Início ou no botão de Ação.

Para desfazer, rode o atalho e diga *"desfaz"*.

### Opção B: Claude (app do iPhone, desktop ou web)

Em **claude.ai → Configurações → Conectores → Adicionar conector personalizado**:

- Nome: `Duzz Finance`
- URL: `https://SEU_DOMINIO/mcp/SEU_TOKEN`

O conector aparece também no app do Claude no iPhone. Aí é só falar ou digitar *"anota 42 no mercado"*, *"quanto gastei com alimentação esse mês?"*, *"quais contas fixas faltam pagar?"*. O modo de voz do Claude também funciona.

No **Claude Code**:

```bash
claude mcp add --transport http duzz-finance https://SEU_DOMINIO/mcp/SEU_TOKEN
```

O token vai na URL porque o conector personalizado do claude.ai não aceita cabeçalho. Ele só trafega por HTTPS. Se vazar, gere outro com `openssl rand -hex 32`, troque no `.env` e rode `docker compose up -d`.

---

## Open Finance: transações dos bancos entrando sozinhas

Com o [Meu Pluggy](https://meu.pluggy.ai) (gratuito para pessoa física) o servidor puxa as transações de todos os seus bancos e cartões e grava como lançamentos, sem importar extrato. Os bancos atualizam no Meu Pluggy uma vez por dia; o servidor confere a cada 6 h (`PLUGGY_SYNC_HOURS`).

### Configurar

1. Crie a conta em [meu.pluggy.ai](https://meu.pluggy.ai) e conecte seus bancos (o consentimento é feito no app de cada banco).
2. Entre em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) com a mesma conta, abra a aplicação **demo** e conecte os itens do Meu Pluggy a ela. Copie o **Client ID**, o **Client Secret** e o **id de cada item** (um por banco).
3. Aplique a migration `supabase/migrations/20261108120000_accounts_open_finance.sql` no Supabase (SQL Editor ou `supabase db push`).
4. No `.env` da VPS preencha `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `PLUGGY_ITEMS` (ids separados por vírgula) e rode `docker compose up -d`.

A primeira sincronização começa 15 s depois de subir e traz os últimos 90 dias (`PLUGGY_FIRST_SYNC_DAYS`). Para forçar agora:

```bash
curl -X POST "https://SEU_DOMINIO/sync?formato=texto" -H "Authorization: Bearer SEU_TOKEN"
```

Ou peça ao Claude: *"sincroniza os bancos"* (ferramenta `sincronizar_bancos`). `GET /sync` mostra a última sincronização.

### O que ela faz

- **Contas**: cada conta/cartão do banco vira uma conta no app (ex.: "Nubank · Conta", "Nubank · Cartão"). Se já existir uma conta do mesmo tipo com o nome do banco no nome ou na instituição, ela é reaproveitada. Pode renomear à vontade no app: a ligação fica no campo `external_id`. Conta nova recebe o saldo inicial ajustado para bater com o saldo do banco.
- **Lançamentos**: `import_hash = pluggy:<id>` garante que nada entra duas vezes. Categoria pelas **palavras-chave** das categorias; despesa fixa e fonte de renda pelo nome (ex.: "Aluguel", "Salário"). Recebem a etiqueta `open-finance` e a observação "Banco via Open Finance".
- **Transferências**: saída numa conta e entrada de mesmo valor em outra conta sua (até 1 dia de diferença) viram uma transferência só. Pagamento de fatura vira transferência conta → cartão, e o "pagamento recebido" do lado do cartão é ignorado.
- **Cartão**: compras entram na data da compra (inclusive as da fatura aberta); parcelas vêm com "parcela 2/10" na observação.

Se apagar no app um lançamento dos últimos 7 dias, ele volta na próxima sincronização (o servidor reconfere essa janela). Lançamentos mais antigos apagados não voltam.

Quando um banco pede reconexão, a sincronização avisa (`LOGIN_ERROR`): refaça o consentimento no Meu Pluggy.

## Manutenção

```bash
cd /opt/duzzfi && git pull && cd mcp && docker compose up -d --build   # atualizar
docker compose logs -f mcp        # ver o que foi entendido em cada frase
docker compose logs -f whisper    # tempo de cada transcrição
docker compose restart            # reiniciar
```

**Ajustes do Whisper** (no `.env`, depois `docker compose up -d`):

- `WHISPER_MODEL=small`: bom equilíbrio. Num CPU de 2 núcleos, uma frase leva uns 2 a 5 s.
- `WHISPER_MODEL=medium`: erra menos nomes, mas é ~3× mais lento e usa ~2,5 GB de RAM.
- `WHISPER_MODEL=base`: para VPS com 1 GB de RAM.

## Desenvolvimento local

```bash
cd mcp/server
npm install
npm test           # testes do interpretador de frases e da sincronização
npm run typecheck
```
