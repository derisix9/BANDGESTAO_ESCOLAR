-- =====================================================================
-- 0008 — Regras para muitas escolas
--  1) Índices por (escola, colecção, …): cada pedido toca só nas linhas da escola, nunca na base toda.
--  2) Ficheiros (fotos, BI, certificados, PDFs) NÃO vão para a base: bucket privado `school-files`,
--     com a MESMA regra de permissões da colecção a que pertencem.
--     Caminho obrigatório:  {institution_id}/{colecção}/{id_do_registo}/{ficheiro}
-- SQL standard + blocos protegidos para o que é específico do Supabase (Storage), para poder mudar de fornecedor.
-- =====================================================================

-- ---------- 1) Índices ----------
create index if not exists records_list_idx on public.records (institution_id, collection, ord);
-- filtro "alunos/matrículas de uma turma" no servidor
create index if not exists records_class_idx on public.records (institution_id, collection, (data ->> 'classId'));
create index if not exists records_status_idx on public.records (institution_id, collection, (data ->> 'status'));

-- pesquisa por nome (contém…) sem varrer a tabela
do $$ begin
  create extension if not exists pg_trgm;
  create index if not exists records_name_trgm on public.records
    using gin (lower(data ->> 'name') gin_trgm_ops);
exception when others then
  raise notice 'pg_trgm indisponível: a pesquisa por nome fica sem índice (%).', sqlerrm;
end $$;

-- ---------- 2) Ficheiros no Storage ----------
do $$ begin
  if to_regnamespace('storage') is null then
    raise notice 'Sem Storage (Postgres local): saltado.'; return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('school-files', 'school-files', false, 5242880,
          array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

  drop policy if exists school_files_read   on storage.objects;
  drop policy if exists school_files_insert on storage.objects;
  drop policy if exists school_files_update on storage.objects;
  drop policy if exists school_files_delete on storage.objects;

  -- pasta 1 = escola do utilizador; pasta 2 = colecção → ler/escrever exige o mesmo acesso à colecção
  create policy school_files_read on storage.objects for select to authenticated
    using (bucket_id = 'school-files'
           and (storage.foldername(name))[1] = app.current_institution()
           and app.can_access((storage.foldername(name))[2], 'read'));
  create policy school_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'school-files'
           and (storage.foldername(name))[1] = app.current_institution()
           and app.can_access((storage.foldername(name))[2], 'write'));
  create policy school_files_update on storage.objects for update to authenticated
    using (bucket_id = 'school-files'
           and (storage.foldername(name))[1] = app.current_institution()
           and app.can_access((storage.foldername(name))[2], 'write'));
  create policy school_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'school-files'
           and (storage.foldername(name))[1] = app.current_institution()
           and app.can_access((storage.foldername(name))[2], 'write'));
end $$;
