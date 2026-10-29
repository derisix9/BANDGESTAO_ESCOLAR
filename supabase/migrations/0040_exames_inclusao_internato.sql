-- 0040 — Cinco colecções novas por registo: exames nacionais (calendário e inscrições),
-- planos educativos individuais (dados sensíveis: só admin/director, ou quem tiver acesso
-- personalizado à secção) e internato (quartos e alojamentos).
-- Equivale às linhas acrescentadas a 0005_collection_acl.sql (gerado de src/config/dataShards.json),
-- para bases onde a 0005 já foi aplicada. Idempotente.
insert into public.collection_acl
  (collection, sections, read_roles, write_roles, field_writes, owner_write, academic_year_scoped, audited, server_only)
values
  ('nationalExams', array['exames_nacionais']::text[], array['admin','director','secretaria']::text[], array['admin','director','secretaria']::text[], '{}'::jsonb, '{}'::jsonb, true, true, false),
  ('examEnrollments', array['exames_nacionais']::text[], array['admin','director','secretaria']::text[], array['admin','director','secretaria']::text[], '{}'::jsonb, '{}'::jsonb, true, true, false),
  ('individualPlans', array['plano_individual']::text[], array['admin','director']::text[], array['admin','director']::text[], '{}'::jsonb, '{}'::jsonb, true, true, false),
  ('boardingRooms', array['internato']::text[], array['admin','director','secretaria']::text[], array['admin','director','secretaria']::text[], '{}'::jsonb, '{}'::jsonb, false, true, false),
  ('boardingAllocations', array['internato']::text[], array['admin','director','secretaria']::text[], array['admin','director','secretaria']::text[], '{}'::jsonb, '{}'::jsonb, true, true, false)
on conflict (collection) do update set
  sections = excluded.sections, read_roles = excluded.read_roles, write_roles = excluded.write_roles,
  field_writes = excluded.field_writes, owner_write = excluded.owner_write,
  academic_year_scoped = excluded.academic_year_scoped, audited = excluded.audited, server_only = excluded.server_only;
