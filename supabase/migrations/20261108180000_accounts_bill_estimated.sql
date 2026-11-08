-- Marca quando a fatura atual do cartão foi estimada (banco só informa faturas fechadas)
alter table public.accounts
  add column bill_estimated boolean not null default false;

comment on column public.accounts.bill_estimated is 'true = fatura atual estimada pelas compras desde o fechamento da última fatura';
