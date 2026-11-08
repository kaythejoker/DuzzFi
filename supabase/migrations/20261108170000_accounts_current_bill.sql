-- Cartão de crédito: fatura atual (a próxima a vencer) separada do limite usado.
-- O limite usado inclui parcelas futuras; a fatura atual é o que vence agora.
alter table public.accounts
  add column current_bill numeric(14, 2),
  add column bill_due_date date;

comment on column public.accounts.current_bill is 'Valor da fatura atual do cartão (próxima a vencer), informado pelo banco via Open Finance';
comment on column public.accounts.bill_due_date is 'Vencimento da fatura atual';
