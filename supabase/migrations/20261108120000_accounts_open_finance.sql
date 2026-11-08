-- Contas sincronizadas via Open Finance (Pluggy): id da conta no provedor e última sincronização.
-- Os lançamentos importados usam transactions.import_hash = 'pluggy:<id da transação>' (já único por usuário).
alter table public.accounts
  add column external_id text,
  add column synced_at timestamptz;

create unique index accounts_user_external_id_key on public.accounts (user_id, external_id) where external_id is not null;

comment on column public.accounts.external_id is 'Conta no Open Finance ("pluggy:<accountId>") quando sincronizada automaticamente';
comment on column public.accounts.synced_at is 'Última sincronização com o banco via Open Finance';
