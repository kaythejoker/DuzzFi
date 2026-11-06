-- Dia do mês em que cada fonte de renda costuma cair (ex.: salário dia 5)
alter table public.income_sources
  add column pay_day smallint check (pay_day is null or (pay_day between 1 and 31));

comment on column public.income_sources.pay_day is 'Dia do mês em que o recebimento costuma cair (1-31; meses curtos usam o último dia)';
