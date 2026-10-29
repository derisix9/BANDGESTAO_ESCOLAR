-- =====================================================================
-- 0033 — Backup e restauro EM LOTES (com progresso por tabela)
--
-- Problema: school_backup_restore / school_backup_export enviam e recebem a escola INTEIRA numa só
-- chamada HTTP. Em escolas grandes (20 mil+ registos, com fotos e anexos) o gateway do Supabase
-- responde "upstream request timeout" e o restauro falha.
--
-- Solução: a app divide o trabalho em pedidos pequenos e mostra uma barra de progresso por tabela.
--
--   Exportar (ficheiro de backup / ponto de segurança)
--     school_backup_meta()                                  → totais por colecção
--     school_backup_page(kind, collection, offset, limit)   → uma página de linhas
--
--   Restaurar (só as tabelas escolhidas)
--     school_restore_begin('RESTAURAR')                     → abre uma sessão (limpa preparações antigas)
--     school_restore_stage(sessão, kind, colecção, seq, [])  → guarda um lote numa área de preparação
--     school_restore_apply(sessão, kind, colecção)          → substitui UMA tabela com o que foi preparado
--     school_restore_finish(sessão, resumo)                 → auditoria (um evento) e limpeza
--
-- Nada do que está vivo é tocado até ao `apply`; se o envio falhar a meio, a escola fica como estava.
-- Cada `apply` é uma transacção só dessa tabela. As funções antigas (0012) continuam a existir.
-- Seguro de correr mais do que uma vez.
-- =====================================================================

create table if not exists public.restore_staging (
  institution_id text        not null,
  session_id     uuid        not null,
  kind           text        not null,
  collection     text        not null default '',
  seq            int         not null,
  items          jsonb       not null,
  created_at     timestamptz not null default now(),
  primary key (institution_id, session_id, kind, collection, seq)
);
alter table public.restore_staging enable row level security;
revoke all on public.restore_staging from public, anon, authenticated;

-- Só o administrador da escola; devolve a escola dele (nunca vem do pedido).
create or replace function app.backup_admin() returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution();
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola pode usar backups' using errcode = '42501';
  end if;
  return inst;
end $$;

-- ---------- Exportar: totais ----------
create or replace function public.school_backup_meta() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.backup_admin(); v_name text; v_cols jsonb;
begin
  select name into v_name from public.institutions where id = inst;
  select coalesce(jsonb_agg(jsonb_build_object('collection', x.collection, 'n', x.n) order by x.collection), '[]'::jsonb)
    into v_cols from (select collection, count(*) as n from public.records where institution_id = inst group by collection) x;
  perform app.write_audit(inst, 'RPC:school_backup_export', 'school', inst, jsonb_build_object('chunked', true));
  return jsonb_build_object(
    'institutionId', inst,
    'schoolName', v_name,
    'exportedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'collections', v_cols,
    'docs', (select count(*) from public.institution_docs where institution_id = inst),
    'publicAdmissionRequests', (select count(*) from public.public_admission_requests where institution_id = inst),
    'payments', (select count(*) from public.payments where institution_id = inst),
    'fiscalDocuments', (select count(*) from public.fiscal_documents where institution_id = inst),
    'fiscalSeries', (select count(*) from public.fiscal_series where institution_id = inst));
end $$;

-- ---------- Exportar: uma página ----------
create or replace function public.school_backup_page(p_kind text, p_collection text default '', p_offset int default 0, p_limit int default 200)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.backup_admin(); v_lim int := least(greatest(coalesce(p_limit, 200), 1), 1000); v_off int := greatest(coalesce(p_offset, 0), 0); res jsonb;
begin
  if p_kind = 'records' then
    select coalesce(jsonb_agg(s.x order by s.k), '[]'::jsonb) into res from (
      select r.id as k, jsonb_build_object('collection', r.collection, 'id', r.id, 'academic_year', r.academic_year, 'ord', r.ord,
             'version', r.version, 'created_at', r.created_at, 'updated_at', r.updated_at, 'data', r.data) as x
        from public.records r where r.institution_id = inst and r.collection = p_collection
       order by r.id offset v_off limit v_lim) s;
  elsif p_kind = 'docs' then
    select coalesce(jsonb_agg(s.x order by s.k), '[]'::jsonb) into res from (
      select d.key as k, jsonb_build_object('key', d.key, 'updated_at', d.updated_at, 'data', d.data) as x
        from public.institution_docs d where d.institution_id = inst order by d.key offset v_off limit v_lim) s;
  elsif p_kind = 'requests' then
    select coalesce(jsonb_agg(s.x order by s.k1, s.k2), '[]'::jsonb) into res from (
      select q.created_at as k1, q.id as k2, jsonb_build_object('id', q.id, 'created_at', q.created_at, 'data', q.data) as x
        from public.public_admission_requests q where q.institution_id = inst order by q.created_at, q.id offset v_off limit v_lim) s;
  elsif p_kind = 'config' then
    select coalesce(jsonb_agg(c.data), '[]'::jsonb) into res from public.public_admission_config c where c.institution_id = inst;
  elsif p_kind = 'payments' then
    select coalesce(jsonb_agg(s.x order by s.k1, s.k2), '[]'::jsonb) into res from (
      select p.paid_at as k1, p.id as k2, to_jsonb(p) - 'institution_id' as x
        from public.payments p where p.institution_id = inst order by p.paid_at, p.id offset v_off limit v_lim) s;
  elsif p_kind = 'fiscalDocuments' then
    select coalesce(jsonb_agg(s.x order by s.k1, s.k2, s.k3), '[]'::jsonb) into res from (
      select f.doc_type as k1, f.series as k2, f.number as k3, to_jsonb(f) - 'institution_id' as x
        from public.fiscal_documents f where f.institution_id = inst order by f.doc_type, f.series, f.number offset v_off limit v_lim) s;
  elsif p_kind = 'fiscalSeries' then
    select coalesce(jsonb_agg(s.x order by s.k1, s.k2), '[]'::jsonb) into res from (
      select f.series as k1, f.doc_type as k2, to_jsonb(f) - 'institution_id' as x
        from public.fiscal_series f where f.institution_id = inst order by f.series, f.doc_type offset v_off limit v_lim) s;
  else
    raise exception 'invalid-backup: tipo desconhecido (%)', p_kind using errcode = '22023';
  end if;
  return res;
end $$;

-- ---------- Restaurar: abrir sessão ----------
create or replace function public.school_restore_begin(p_confirm text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.backup_admin();
begin
  if p_confirm is distinct from 'RESTAURAR' then
    raise exception 'Confirmação em falta: escreva RESTAURAR' using errcode = '22023';
  end if;
  delete from public.restore_staging where institution_id = inst;
  return gen_random_uuid();
end $$;

-- ---------- Restaurar: preparar um lote (não toca nos dados vivos) ----------
create or replace function public.school_restore_stage(p_session uuid, p_kind text, p_collection text, p_seq int, p_items jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.backup_admin(); v_coll text := coalesce(p_collection, ''); bad text;
begin
  if p_session is null or p_seq is null or p_seq < 0 then
    raise exception 'invalid-backup: sessão ou lote inválido' using errcode = '22023';
  end if;
  if p_kind not in ('records', 'docs', 'requests', 'config') then
    raise exception 'invalid-backup: tipo desconhecido (%)', p_kind using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid-backup: o lote não é uma lista' using errcode = '22023';
  end if;
  if p_kind = 'records' and v_coll = '' then
    raise exception 'invalid-backup: colecção em falta' using errcode = '22023';
  end if;

  if p_kind = 'records' then
    if exists (select 1 from jsonb_array_elements(p_items) r
                where jsonb_typeof(r) <> 'object' or coalesce(r ->> 'id', '') = ''
                   or jsonb_typeof(r -> 'data') is distinct from 'object'
                   or coalesce(r ->> 'collection', '') <> v_coll) then
      raise exception 'invalid-backup: registo sem id, dados ou colecção' using errcode = '22023';
    end if;
  elsif p_kind = 'docs' then
    if exists (select 1 from jsonb_array_elements(p_items) d
                where jsonb_typeof(d) <> 'object' or d ->> 'key' is null or d -> 'data' is null) then
      raise exception 'invalid-backup: documento sem chave ou dados' using errcode = '22023';
    end if;
    select string_agg(distinct d ->> 'key', ', ') into bad
      from jsonb_array_elements(p_items) d
     where (d ->> 'key') not in ('settings', 'events', 'auditLogs', 'miniPautasStore', 'pauta', 'attendance')
        or ((d ->> 'key') in ('settings', 'miniPautasStore') and jsonb_typeof(d -> 'data') <> 'object')
        or ((d ->> 'key') in ('events', 'auditLogs', 'pauta', 'attendance') and jsonb_typeof(d -> 'data') <> 'array');
    if bad is not null then
      raise exception 'invalid-backup: documentos inválidos (%)', bad using errcode = '22023';
    end if;
  elsif p_kind = 'requests' then
    if exists (select 1 from jsonb_array_elements(p_items) q
                where jsonb_typeof(q) <> 'object' or coalesce(q ->> 'id', '') = ''
                   or jsonb_typeof(q -> 'data') is distinct from 'object') then
      raise exception 'invalid-backup: pré-matrícula sem id ou dados' using errcode = '22023';
    end if;
  else  -- config
    if jsonb_array_length(p_items) > 1 or exists (select 1 from jsonb_array_elements(p_items) c where jsonb_typeof(c) <> 'object') then
      raise exception 'invalid-backup: configuração de pré-matrícula inválida' using errcode = '22023';
    end if;
  end if;

  insert into public.restore_staging (institution_id, session_id, kind, collection, seq, items)
  values (inst, p_session, p_kind, case when p_kind = 'records' then v_coll else '' end, p_seq, p_items)
  on conflict (institution_id, session_id, kind, collection, seq) do update set items = excluded.items, created_at = now();
  return jsonb_array_length(p_items);
end $$;

-- ---------- Restaurar: substituir UMA tabela com o que foi preparado ----------
create or replace function public.school_restore_apply(p_session uuid, p_kind text, p_collection text default '')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.backup_admin();
  v_coll text := case when p_kind = 'records' then coalesce(p_collection, '') else '' end;
  v_batches int; v_total int; v_distinct int;
  n int := 0; n_ignored int := 0; n_inv_src int := 0; n_inv_new int := 0;
begin
  if p_kind not in ('records', 'docs', 'requests', 'config') then
    raise exception 'invalid-backup: tipo desconhecido (%)', p_kind using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('restore:' || inst)) then
    raise exception 'busy: já há um restauro a decorrer nesta escola' using errcode = '55P03';
  end if;

  select count(*) into v_batches from public.restore_staging
   where institution_id = inst and session_id = p_session and kind = p_kind and collection = v_coll;
  if v_batches = 0 then
    raise exception 'nothing-staged: nada preparado para esta tabela (sessão expirada ou já aplicada)' using errcode = '22023';
  end if;

  if p_kind = 'records' then
    select count(*), count(distinct r ->> 'id') into v_total, v_distinct
      from public.restore_staging s, jsonb_array_elements(s.items) r
     where s.institution_id = inst and s.session_id = p_session and s.kind = 'records' and s.collection = v_coll;
    if v_total <> v_distinct then
      raise exception 'invalid-backup: registos repetidos (%)', v_total - v_distinct using errcode = '22023';
    end if;
  end if;

  perform set_config('app.restoring', 'on', true);          -- só nesta transacção; sem um evento de auditoria por linha

  if p_kind = 'records' then
    if not exists (select 1 from public.collection_acl c where c.collection = v_coll) then
      n_ignored := v_total;                                 -- módulo que esta versão da app não conhece
    elsif v_coll = 'invoices' then
      -- facturas: só as que faltam; o estado vem do razão de pagamentos (que nunca se restaura)
      perform set_config('app.rpc', 'payment', true);
      n_inv_src := v_total;
      with src as (
        select r from public.restore_staging s, jsonb_array_elements(s.items) r
         where s.institution_id = inst and s.session_id = p_session and s.kind = 'records' and s.collection = 'invoices'
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
                 when s.r -> 'data' ->> 'status' = 'pago' then
                   ((s.r -> 'data') - 'paymentDate' - 'totalPaidKz') || jsonb_build_object('status', 'pendente')
                 else s.r -> 'data'
               end,
               coalesce(nullif(s.r ->> 'version', '')::int, 1),
               coalesce(nullif(s.r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(s.r ->> 'updated_at', '')::timestamptz, now())
          from src s left join paid p on p.invoice_id = s.r ->> 'id'
        on conflict (institution_id, collection, id) do nothing
        returning 1
      ) select count(*) into n_inv_new from ins;
      n := n_inv_new;
    else
      perform set_config('app.rpc', case when v_coll = 'homologations' then 'homologate' else 'restore' end, true);
      delete from public.records where institution_id = inst and collection = v_coll;
      insert into public.records (institution_id, collection, id, academic_year, ord, data, version, created_at, updated_at)
      select inst, v_coll, r ->> 'id', nullif(r ->> 'academic_year', ''), nullif(r ->> 'ord', '')::double precision,
             r -> 'data', coalesce(nullif(r ->> 'version', '')::int, 1),
             coalesce(nullif(r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(r ->> 'updated_at', '')::timestamptz, now())
        from public.restore_staging s, jsonb_array_elements(s.items) r
       where s.institution_id = inst and s.session_id = p_session and s.kind = 'records' and s.collection = v_coll;
      get diagnostics n = row_count;
    end if;

  elsif p_kind = 'docs' then
    if (select count(*) from public.restore_staging s, jsonb_array_elements(s.items) d
         where s.institution_id = inst and s.session_id = p_session and s.kind = 'docs')
       <> (select count(distinct d ->> 'key') from public.restore_staging s, jsonb_array_elements(s.items) d
            where s.institution_id = inst and s.session_id = p_session and s.kind = 'docs') then
      raise exception 'invalid-backup: documentos repetidos' using errcode = '22023';
    end if;
    delete from public.institution_docs where institution_id = inst;
    insert into public.institution_docs (institution_id, key, data, updated_at)
    select inst, d ->> 'key', d -> 'data', coalesce(nullif(d ->> 'updated_at', '')::timestamptz, now())
      from public.restore_staging s, jsonb_array_elements(s.items) d
     where s.institution_id = inst and s.session_id = p_session and s.kind = 'docs';
    get diagnostics n = row_count;

  elsif p_kind = 'requests' then
    if (select count(*) from public.restore_staging s, jsonb_array_elements(s.items) q
         where s.institution_id = inst and s.session_id = p_session and s.kind = 'requests')
       <> (select count(distinct q ->> 'id') from public.restore_staging s, jsonb_array_elements(s.items) q
            where s.institution_id = inst and s.session_id = p_session and s.kind = 'requests') then
      raise exception 'invalid-backup: pré-matrículas repetidas' using errcode = '22023';
    end if;
    delete from public.public_admission_requests where institution_id = inst;
    insert into public.public_admission_requests (institution_id, id, data, created_at)
    select inst, q ->> 'id', q -> 'data', coalesce(nullif(q ->> 'created_at', '')::timestamptz, now())
      from public.restore_staging s, jsonb_array_elements(s.items) q
     where s.institution_id = inst and s.session_id = p_session and s.kind = 'requests';
    get diagnostics n = row_count;

  else  -- config
    insert into public.public_admission_config (institution_id, data)
    select inst, c from public.restore_staging s, jsonb_array_elements(s.items) c
     where s.institution_id = inst and s.session_id = p_session and s.kind = 'config' limit 1
    on conflict (institution_id) do update set data = excluded.data, updated_at = now();
    get diagnostics n = row_count;
  end if;

  perform set_config('app.rpc', '', true);

  delete from public.restore_staging
   where institution_id = inst and session_id = p_session and kind = p_kind and collection = v_coll;

  return jsonb_build_object('kind', p_kind, 'collection', v_coll, 'applied', n, 'ignored', n_ignored,
                            'invoicesRecreated', n_inv_new, 'invoicesKept', greatest(n_inv_src - n_inv_new, 0));
end $$;

-- ---------- Restaurar: terminar (auditoria + limpeza) ----------
create or replace function public.school_restore_finish(p_session uuid, p_summary jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.backup_admin();
begin
  delete from public.restore_staging where institution_id = inst and session_id = p_session;
  perform app.write_audit(inst, 'RPC:school_backup_restore', 'school', inst,
    jsonb_build_object('chunked', true,
                       'tables', coalesce(p_summary -> 'tables', '[]'::jsonb),
                       'records', coalesce((p_summary ->> 'records')::int, 0),
                       'backupExportedAt', p_summary ->> 'backupExportedAt'));
end $$;

-- ---------- Só o administrador autenticado (as funções voltam a verificar o papel) ----------
revoke all on function public.school_backup_meta() from public, anon;
revoke all on function public.school_backup_page(text, text, int, int) from public, anon;
revoke all on function public.school_restore_begin(text) from public, anon;
revoke all on function public.school_restore_stage(uuid, text, text, int, jsonb) from public, anon;
revoke all on function public.school_restore_apply(uuid, text, text) from public, anon;
revoke all on function public.school_restore_finish(uuid, jsonb) from public, anon;
grant execute on function public.school_backup_meta() to authenticated;
grant execute on function public.school_backup_page(text, text, int, int) to authenticated;
grant execute on function public.school_restore_begin(text) to authenticated;
grant execute on function public.school_restore_stage(uuid, text, text, int, jsonb) to authenticated;
grant execute on function public.school_restore_apply(uuid, text, text) to authenticated;
grant execute on function public.school_restore_finish(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
