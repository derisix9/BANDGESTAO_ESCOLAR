-- 0037 — Duas colecções novas por registo: acompanhamento de evasão escolar e lançamentos contabilísticos manuais.
-- Equivale às duas linhas acrescentadas a 0005_collection_acl.sql (gerado de src/config/dataShards.json),
-- para bases onde a 0005 já foi aplicada. Idempotente.
insert into public.collection_acl
  (collection, sections, read_roles, write_roles, field_writes, owner_write, academic_year_scoped, audited, server_only)
values
  ('dropoutFollowUps', array['evasao_escolar']::text[], array['admin','director','secretaria']::text[], array['admin','director','secretaria']::text[], '{}'::jsonb, '{}'::jsonb, true, true, false),
  ('journalEntries', array['balancete_contabilistico']::text[], array['admin','financeiro']::text[], array['admin','financeiro']::text[], '{}'::jsonb, '{}'::jsonb, false, true, false)
on conflict (collection) do update set
  sections = excluded.sections, read_roles = excluded.read_roles, write_roles = excluded.write_roles,
  field_writes = excluded.field_writes, owner_write = excluded.owner_write,
  academic_year_scoped = excluded.academic_year_scoped, audited = excluded.audited, server_only = excluded.server_only;
