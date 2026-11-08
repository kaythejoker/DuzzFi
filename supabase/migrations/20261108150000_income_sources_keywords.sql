-- Palavras-chave das fontes de renda: a sincronização Open Finance e a importação ligam o recebimento
-- à fonte pelo texto do banco (ex.: "IA SEM LIMITES" -> Salário CLT), seja qual for o valor.
alter table public.income_sources
  add column keywords text[] not null default '{}';

comment on column public.income_sources.keywords is 'Trechos da descrição do banco que identificam esta fonte (ex.: nome da empresa que paga)';
