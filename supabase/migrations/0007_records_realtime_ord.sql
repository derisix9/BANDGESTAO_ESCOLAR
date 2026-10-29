-- =====================================================================
-- 0007 — Preparar `records` para o uso real pela app
--  1) `ord` passa a decimal: a app insere registos "entre" dois vizinhos (ex.: 2.5), o que `bigint` recusava.
--  2) Tempo real: alterações feitas por um utilizador aparecem aos outros sem recarregar a página.
-- Seguro de correr mais do que uma vez.
-- =====================================================================
alter table public.records alter column ord type double precision;

do $$ begin
  alter publication supabase_realtime add table public.records;
exception
  when duplicate_object then null;     -- já estava
  when undefined_object then null;     -- Postgres sem Realtime (testes locais)
end $$;
