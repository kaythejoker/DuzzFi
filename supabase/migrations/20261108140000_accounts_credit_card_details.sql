-- Cartão de crédito não é conta: limite, dia de fechamento e vencimento da fatura, e saldo informado pelo banco
-- (preenchidos pela sincronização Open Finance ou à mão no app).
alter table public.accounts
  add column credit_limit numeric(14, 2) check (credit_limit is null or credit_limit >= 0),
  add column closing_day smallint check (closing_day is null or (closing_day between 1 and 31)),
  add column due_day smallint check (due_day is null or (due_day between 1 and 31)),
  add column bank_balance numeric(14, 2);

comment on column public.accounts.credit_limit is 'Limite total do cartão de crédito';
comment on column public.accounts.closing_day is 'Dia do mês em que a fatura fecha';
comment on column public.accounts.due_day is 'Dia do mês em que a fatura vence';
comment on column public.accounts.bank_balance is 'Saldo informado pelo banco na última sincronização (cartão: valor devido, negativo)';
