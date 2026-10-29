-- 0035 — Permitir eliminar utilizadores que já criaram/registaram dados.
--
-- Sintoma: ao eliminar uma conta (ex.: Funcionário da secretaria) a Edge Function delete-user devolvia
-- 400 "Database error deleting user". Causa: várias tabelas guardam quem criou/registou/emitiu algo
-- (created_by, updated_by, registered_by, issued_by, actor...) com chave estrangeira para auth.users SEM
-- "on delete", logo o Postgres recusa apagar qualquer utilizador que já tenha deixado esse rasto.
--
-- Correção: todas as FK de colunas simples public.* → auth.users(id) que bloqueiam a eliminação passam a
-- "on delete set null" (o registo fica, só perde a referência a quem o fez). Se a coluna era NOT NULL,
-- deixa de o ser. Dinâmico: apanha também tabelas que não estejam listadas aqui. Idempotente.
do $$
declare
  r   record;
  col text;
begin
  for r in
    select c.conrelid, c.conrelid::regclass as tbl, c.conname, c.conkey
      from pg_constraint c
      join pg_class t     on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and c.confdeltype in ('a', 'r')          -- NO ACTION / RESTRICT
       and n.nspname = 'public'
       and array_length(c.conkey, 1) = 1
  loop
    select a.attname into col
      from pg_attribute a
     where a.attrelid = r.conrelid and a.attnum = r.conkey[1];

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s alter column %I drop not null', r.tbl, col);
    execute format('alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete set null',
                   r.tbl, r.conname, col);
    raise notice 'FK % em % (%) → on delete set null', r.conname, r.tbl, col;
  end loop;
end $$;
