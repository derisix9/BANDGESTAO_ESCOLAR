-- =====================================================================
-- 0012 — Backup e restauro POR ESCOLA, num único ficheiro (tudo ou nada)
--
--   public.school_backup_export()                         → jsonb com os dados da escola do administrador
--   public.school_backup_restore(p_payload, p_confirm)    → substitui os dados da escola pelos do ficheiro
--
-- Quem chama: o administrador autenticado, pela app (supabase.rpc). A escola NUNCA vem do pedido:
-- usa-se a escola do perfil de quem está autenticado.
--
-- O ficheiro (JSON canónico; a app converte de/para XLSX, SQL e CSV, mas o que chega aqui é sempre este JSON):
--   { format, formatVersion, institutionId, schoolName, exportedAt, counts,
--     records[], docs[], publicAdmissionConfig, publicAdmissionRequests[],
--     archive: { payments[], fiscalDocuments[], fiscalSeries[] } }
--
-- O QUE SE RESTAURA (estado editável): records, institution_docs, public_admission_requests/config.
-- O QUE NUNCA SE RESTAURA (registo histórico que só cresce):
--   • audit_log, payments, fiscal_documents, fiscal_series  → só vão no ficheiro (`archive`), como referência.
--   • profiles / auth.users / user_access                   → as contas ficam como estão.
--   • facturas (records.collection = 'invoices'): as que existem ficam como estão (podem estar ligadas a
--     pagamentos); só se recriam as que faltam, com o estado reconciliado com o razão de pagamentos.
--
-- Seguro de correr mais do que uma vez. Substitui a versão anterior da 0012 (funções só para service_role).
-- =====================================================================

-- ---------- Limpeza da versão anterior (se alguma vez foi aplicada) ----------
drop function if exists public.school_backup_export(text, uuid);
drop function if exists public.school_backup_restore(text, jsonb, uuid);
drop function if exists app.export_school(text);
drop function if exists app.restore_school(text, jsonb, uuid);
drop function if exists app.backup_format();

-- ---------- Auditoria dos registos: não inundar a cadeia durante um restauro ----------
-- (o restauro regista UM evento resumo; sem isto cada linha apagada/inserida geraria um evento)
create or replace function app.audit_records() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a boolean; row_ record;
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then return null; end if;
  row_ := case when tg_op = 'DELETE' then old else new end;
  select audited into a from public.collection_acl where collection = row_.collection;
  if coalesce(a, true) then
    perform app.write_audit(row_.institution_id, tg_op, row_.collection, row_.id,
      case when tg_op = 'UPDATE' then jsonb_build_object('version', new.version)
           when tg_op = 'DELETE' then jsonb_build_object('deleted', old.data) else null end);
  end if;
  return null;
end $$;

-- ---------- Exportar ----------
create or replace function public.school_backup_export() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.current_institution();
  v_name text; v_records jsonb; v_docs jsonb; v_cfg jsonb; v_req jsonb;
  v_pay jsonb; v_fisc jsonb; v_series jsonb; v_counts jsonb;
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola pode descarregar backups' using errcode = '42501';
  end if;

  select name into v_name from public.institutions where id = inst;

  select coalesce(jsonb_agg(jsonb_build_object(
           'collection', r.collection, 'id', r.id, 'academic_year', r.academic_year, 'ord', r.ord,
           'version', r.version, 'created_at', r.created_at, 'updated_at', r.updated_at, 'data', r.data)
         order by r.collection, r.id), '[]'::jsonb)
    into v_records from public.records r where r.institution_id = inst;

  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'updated_at', d.updated_at, 'data', d.data)
         order by d.key), '[]'::jsonb)
    into v_docs from public.institution_docs d where d.institution_id = inst;

  select c.data into v_cfg from public.public_admission_config c where c.institution_id = inst;

  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'created_at', q.created_at, 'data', q.data)
         order by q.created_at, q.id), '[]'::jsonb)
    into v_req from public.public_admission_requests q where q.institution_id = inst;

  -- só referência (nunca restaurado)
  select coalesce(jsonb_agg(to_jsonb(p) - 'institution_id' order by p.paid_at, p.id), '[]'::jsonb)
    into v_pay from public.payments p where p.institution_id = inst;
  select coalesce(jsonb_agg(to_jsonb(f) - 'institution_id' order by f.doc_type, f.series, f.number), '[]'::jsonb)
    into v_fisc from public.fiscal_documents f where f.institution_id = inst;
  select coalesce(jsonb_agg(to_jsonb(s) - 'institution_id' order by s.series, s.doc_type), '[]'::jsonb)
    into v_series from public.fiscal_series s where s.institution_id = inst;

  v_counts := jsonb_build_object(
    'records', jsonb_array_length(v_records),
    'docs', jsonb_array_length(v_docs),
    'publicAdmissionRequests', jsonb_array_length(v_req),
    'payments', jsonb_array_length(v_pay),
    'fiscalDocuments', jsonb_array_length(v_fisc));

  perform app.write_audit(inst, 'RPC:school_backup_export', 'school', inst, v_counts);

  return jsonb_build_object(
    'format', 'bandmed-school-backup',
    'formatVersion', 1,
    'institutionId', inst,
    'schoolName', v_name,
    'exportedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'counts', v_counts,
    'records', v_records,
    'docs', v_docs,
    'publicAdmissionConfig', v_cfg,
    'publicAdmissionRequests', v_req,
    'archive', jsonb_build_object('payments', v_pay, 'fiscalDocuments', v_fisc, 'fiscalSeries', v_series));
end $$;

-- ---------- Restaurar ----------
create or replace function public.school_backup_restore(p_payload jsonb, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.current_institution();
  v_total int; v_dups int; bad text;
  n_known int := 0; n_rec int := 0; n_docs int := 0; n_req int := 0;
  n_inv_src int := 0; n_inv_new int := 0;
begin
  -- 1) Quem pode
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola pode restaurar backups' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'RESTAURAR' then
    raise exception 'Confirmação em falta: escreva RESTAURAR' using errcode = '22023';
  end if;

  -- 2) Validação ANTES de tocar em qualquer coisa
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'format' is distinct from 'bandmed-school-backup' then
    raise exception 'invalid-backup: formato desconhecido' using errcode = '22023';
  end if;
  if p_payload ->> 'formatVersion' is distinct from '1' then
    raise exception 'invalid-backup: versão do formato não suportada' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'records') is distinct from 'array'
     or jsonb_typeof(p_payload -> 'docs') is distinct from 'array' then
    raise exception 'invalid-backup: faltam as secções de dados' using errcode = '22023';
  end if;
  if p_payload -> 'publicAdmissionRequests' is not null
     and jsonb_typeof(p_payload -> 'publicAdmissionRequests') not in ('array', 'null') then
    raise exception 'invalid-backup: pré-matrículas inválidas' using errcode = '22023';
  end if;
  if p_payload -> 'publicAdmissionConfig' is not null
     and jsonb_typeof(p_payload -> 'publicAdmissionConfig') not in ('object', 'null') then
    raise exception 'invalid-backup: configuração de pré-matrícula inválida' using errcode = '22023';
  end if;
  if p_payload ->> 'institutionId' is distinct from inst then
    raise exception 'wrong-school: este backup pertence a outra escola' using errcode = '42501';
  end if;

  if exists (select 1 from jsonb_array_elements(p_payload -> 'records') r
             where jsonb_typeof(r) <> 'object' or coalesce(r ->> 'collection', '') = '' or coalesce(r ->> 'id', '') = ''
                or jsonb_typeof(r -> 'data') is distinct from 'object') then
    raise exception 'invalid-backup: registo sem colecção, id ou dados' using errcode = '22023';
  end if;
  select count(*) into v_total from jsonb_array_elements(p_payload -> 'records');
  select v_total - count(distinct (r ->> 'collection') || chr(1) || (r ->> 'id')) into v_dups
    from jsonb_array_elements(p_payload -> 'records') r;
  if v_dups > 0 then
    raise exception 'invalid-backup: registos repetidos (%)', v_dups using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_payload -> 'docs') d
             where jsonb_typeof(d) <> 'object' or d ->> 'key' is null or d -> 'data' is null) then
    raise exception 'invalid-backup: documento sem chave ou dados' using errcode = '22023';
  end if;
  select string_agg(distinct d ->> 'key', ', ') into bad
    from jsonb_array_elements(p_payload -> 'docs') d
   where (d ->> 'key') not in ('settings', 'events', 'auditLogs', 'miniPautasStore', 'pauta', 'attendance')
      or ((d ->> 'key') in ('settings', 'miniPautasStore') and jsonb_typeof(d -> 'data') <> 'object')
      or ((d ->> 'key') in ('events', 'auditLogs', 'pauta', 'attendance') and jsonb_typeof(d -> 'data') <> 'array');
  if bad is not null then
    raise exception 'invalid-backup: documentos inválidos (%)', bad using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_payload -> 'docs')) <>
     (select count(distinct d ->> 'key') from jsonb_array_elements(p_payload -> 'docs') d) then
    raise exception 'invalid-backup: documentos repetidos' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload -> 'publicAdmissionRequests') = 'array' then
    if exists (select 1 from jsonb_array_elements(p_payload -> 'publicAdmissionRequests') q
               where jsonb_typeof(q) <> 'object' or coalesce(q ->> 'id', '') = ''
                  or jsonb_typeof(q -> 'data') is distinct from 'object') then
      raise exception 'invalid-backup: pré-matrícula sem id ou dados' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_payload -> 'publicAdmissionRequests')) <>
       (select count(distinct q ->> 'id') from jsonb_array_elements(p_payload -> 'publicAdmissionRequests') q) then
      raise exception 'invalid-backup: pré-matrículas repetidas' using errcode = '22023';
    end if;
  end if;

  -- 3) Uma escola de cada vez; auditoria resumida (uma linha, não uma por registo)
  if not pg_try_advisory_xact_lock(hashtext('restore:' || inst)) then
    raise exception 'busy: já há um restauro a decorrer nesta escola' using errcode = '55P03';
  end if;
  perform set_config('app.restoring', 'on', true);          -- só nesta transacção

  -- 4) Substituir o estado editável (facturas ficam: ver cabeçalho)
  delete from public.records               where institution_id = inst and collection <> 'invoices';
  delete from public.institution_docs      where institution_id = inst;
  delete from public.public_admission_requests where institution_id = inst;

  -- registos de módulos que esta versão da app já não conhece (backup de outra versão): ignorados e contados
  select count(*) into n_known from jsonb_array_elements(p_payload -> 'records') r
   where exists (select 1 from public.collection_acl c where c.collection = r ->> 'collection');

  -- 4a) homologações (só entram com a marca "homologate")
  perform set_config('app.rpc', 'homologate', true);
  insert into public.records (institution_id, collection, id, academic_year, ord, data, version, created_at, updated_at)
  select inst, r ->> 'collection', r ->> 'id', nullif(r ->> 'academic_year', ''), nullif(r ->> 'ord', '')::double precision,
         r -> 'data', coalesce(nullif(r ->> 'version', '')::int, 1),
         coalesce(nullif(r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(r ->> 'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(p_payload -> 'records') r
   where r ->> 'collection' = 'homologations'
     and exists (select 1 from public.collection_acl c where c.collection = 'homologations');
  get diagnostics n_rec = row_count;

  -- 4b) todos os outros registos (menos facturas)
  perform set_config('app.rpc', 'restore', true);
  insert into public.records (institution_id, collection, id, academic_year, ord, data, version, created_at, updated_at)
  select inst, r ->> 'collection', r ->> 'id', nullif(r ->> 'academic_year', ''), nullif(r ->> 'ord', '')::double precision,
         r -> 'data', coalesce(nullif(r ->> 'version', '')::int, 1),
         coalesce(nullif(r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(r ->> 'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(p_payload -> 'records') r
   where r ->> 'collection' not in ('homologations', 'invoices')
     and exists (select 1 from public.collection_acl c where c.collection = r ->> 'collection');
  get diagnostics n_inv_src = row_count;       -- (reutilizado como contador temporário)
  n_rec := n_rec + n_inv_src;

  -- 4c) facturas: só as que faltam; o estado vem do razão de pagamentos (que nunca se restaura)
  perform set_config('app.rpc', 'payment', true);
  select count(*) into n_inv_src from jsonb_array_elements(p_payload -> 'records') r where r ->> 'collection' = 'invoices';
  with src as (
    select r from jsonb_array_elements(p_payload -> 'records') r where r ->> 'collection' = 'invoices'
  ), paid as (
    select invoice_id, sum(amount_kz) as total from public.payments where institution_id = inst group by invoice_id
  ), ins as (
    insert into public.records (institution_id, collection, id, academic_year, ord, data, version, created_at, updated_at)
    select inst, 'invoices', s.r ->> 'id', nullif(s.r ->> 'academic_year', ''), nullif(s.r ->> 'ord', '')::double precision,
           case
             when p.total is not null then
               (s.r -> 'data') || jsonb_build_object('totalPaidKz', p.total,
                 'status', case when p.total >= (case when jsonb_typeof(s.r -> 'data' -> 'totalAmountKz') = 'number'
                                                      then (s.r -> 'data' ->> 'totalAmountKz')::numeric else 0 end)
                                 and (case when jsonb_typeof(s.r -> 'data' -> 'totalAmountKz') = 'number'
                                           then (s.r -> 'data' ->> 'totalAmountKz')::numeric else 0 end) > 0
                                then 'pago' else coalesce(nullif(s.r -> 'data' ->> 'status', 'pago'), 'pendente') end)
             when s.r -> 'data' ->> 'status' = 'pago' then   -- dizia "pago" mas não há pagamento no razão
               ((s.r -> 'data') - 'paymentDate' - 'totalPaidKz') || jsonb_build_object('status', 'pendente')
             else s.r -> 'data'
           end,
           coalesce(nullif(s.r ->> 'version', '')::int, 1),
           coalesce(nullif(s.r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(s.r ->> 'updated_at', '')::timestamptz, now())
      from src s left join paid p on p.invoice_id = s.r ->> 'id'
     where exists (select 1 from public.collection_acl c where c.collection = 'invoices')
    on conflict (institution_id, collection, id) do nothing
    returning 1
  ) select count(*) into n_inv_new from ins;

  -- 4d) documentos da escola
  insert into public.institution_docs (institution_id, key, data, updated_at)
  select inst, d ->> 'key', d -> 'data', coalesce(nullif(d ->> 'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(p_payload -> 'docs') d;
  get diagnostics n_docs = row_count;

  -- 4e) pré-matrícula online
  if jsonb_typeof(p_payload -> 'publicAdmissionConfig') = 'object' then
    insert into public.public_admission_config (institution_id, data) values (inst, p_payload -> 'publicAdmissionConfig')
    on conflict (institution_id) do update set data = excluded.data, updated_at = now();
  end if;
  if jsonb_typeof(p_payload -> 'publicAdmissionRequests') = 'array' then
    insert into public.public_admission_requests (institution_id, id, data, created_at)
    select inst, q ->> 'id', q -> 'data', coalesce(nullif(q ->> 'created_at', '')::timestamptz, now())
      from jsonb_array_elements(p_payload -> 'publicAdmissionRequests') q;
    get diagnostics n_req = row_count;
  end if;

  perform set_config('app.rpc', '', true);

  -- 5) Auditoria: um evento resumo, na mesma cadeia de hash
  perform app.write_audit(inst, 'RPC:school_backup_restore', 'school', inst,
    jsonb_build_object('backupExportedAt', p_payload ->> 'exportedAt', 'records', n_rec,
                       'invoicesRecreated', n_inv_new, 'invoicesKept', n_inv_src - n_inv_new,
                       'docs', n_docs, 'publicAdmissionRequests', n_req));

  return jsonb_build_object(
    'records', n_rec,
    'recordsIgnored', (v_total - n_known),
    'invoicesRecreated', n_inv_new,
    'invoicesKept', n_inv_src - n_inv_new,
    'docs', n_docs,
    'publicAdmissionRequests', n_req,
    'backupExportedAt', p_payload ->> 'exportedAt');
end $$;

-- ---------- Só o administrador autenticado (a função volta a verificar o papel) ----------
revoke all on function public.school_backup_export() from public, anon;
revoke all on function public.school_backup_restore(jsonb, text) from public, anon;
grant execute on function public.school_backup_export() to authenticated;
grant execute on function public.school_backup_restore(jsonb, text) to authenticated;

-- O PostgREST (API do Supabase) só vê funções novas depois de recarregar a cache.
-- Sem isto, a app continua a receber 404 mesmo com a migração aplicada.
notify pgrst, 'reload schema';
