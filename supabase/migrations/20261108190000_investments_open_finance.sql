-- Investimentos sincronizados via Open Finance (Pluggy): id do produto no provedor e última sincronização.
-- O saldo informado pelo banco entra como snapshot do dia; aplicações e resgates viram movimentos.
alter table public.investments
  add column external_id text,
  add column synced_at timestamptz;

create unique index investments_user_external_id_key on public.investments (user_id, external_id) where external_id is not null;

comment on column public.investments.external_id is 'Produto no Open Finance ("pluggy:<investmentId>") quando sincronizado automaticamente';
comment on column public.investments.synced_at is 'Última sincronização com o banco via Open Finance';
