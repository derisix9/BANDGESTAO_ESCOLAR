-- =====================================================================
-- 0034 — Restauro: APLICAR em lotes pequenos (sem timeout, seguro de repetir)
--
-- Problema que sobrava depois da 0033: o envio já ia em lotes, mas `school_restore_apply` substituía a tabela
-- INTEIRA num só pedido (ex.: 4 400 sumários de aulas, 868 alunos com fotos). Em escolas grandes esse pedido
-- demora, o gateway responde "upstream request timeout" e o cliente repete um pedido que ainda corre no
-- servidor (→ "já há um restauro a decorrer").
--
-- Solução: o passo de aplicar passa a ter 3 chamadas curtas por tabela:
--
--   school_restore_prepare(sessão, kind, colecção)          → valida e apaga SÓ o que não vem no ficheiro
--   school_restore_apply_batch(sessão, kind, colecção, seq) → aplica UM lote preparado (apaga os mesmos ids e insere)
--   school_restore_complete(sessão, kind, colecção)         → limpa a preparação desta tabela
--
-- Todas são IDEMPOTENTES: se o gateway cortar a resposta, o cliente repete o mesmo pedido e o resultado é igual.
-- Em vez de `pg_try_advisory_xact_lock` (que dava "busy" numa repetição), usam o bloqueio que ESPERA:
-- a repetição fica atrás do pedido original e termina bem.
-- A `school_restore_apply` da 0033 continua a existir (a app usa-a só se esta migração não estiver aplicada).
-- Seguro de correr mais do que uma vez.
-- =====================================================================

-- ---------- Preparar: validar e remover o que não vem no ficheiro ----------
create or replace function public.school_restore_prepare(p_session uuid, p_kind text, p_collection text default '')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.backup_admin();
  v_coll text := case when p_kind = 'records' then coalesce(p_collection, '') else '' end;
  v_batches int; v_total int; v_distinct int; v_deleted int := 0; v_mode text := 'upsert';
begin
  if p_kind not in ('records', 'docs', 'requests', 'config') then
    raise exception 'invalid-backup: tipo desconhecido (%)', p_kind using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('restore:' || inst));

  select count(*) into v_batches from public.restore_staging
   where institution_id = inst and session_id = p_session and kind = p_kind and collection = v_coll;
  if v_batches = 0 then
    raise exception 'nothing-staged: nada preparado para esta tabela (sessão expirada ou já aplicada)' using errcode = '22023';
  end if;

  select count(*),
         count(distinct case p_kind when 'records' then r ->> 'id' when 'docs' then r ->> 'key' when 'requests' then r ->> 'id' else r::text end)
    into v_total, v_distinct
    from public.restore_staging s, jsonb_array_elements(s.items) r
   where s.institution_id = inst and s.session_id = p_session and s.kind = p_kind and s.collection = v_coll;
  if v_total <> v_distinct then
    raise exception 'invalid-backup: registos repetidos (%)', v_total - v_distinct using errcode = '22023';
  end if;

  perform set_config('app.restoring', 'on', true);

  if p_kind = 'records' then
    if not exists (select 1 from public.collection_acl c where c.collection = v_coll) then
      v_mode := 'ignored';                                   -- módulo que esta versão da app não conhece
    elsif v_coll = 'invoices' then
      v_mode := 'invoices';                                  -- facturas: nunca se apagam; só se recriam as que faltam
    else
      perform set_config('app.rpc', case when v_coll = 'homologations' then 'homologate' else 'restore' end, true);
      with keep as materialized (
        select distinct r ->> 'id' as id
          from public.restore_staging s, jsonb_array_elements(s.items) r
         where s.institution_id = inst and s.session_id = p_session and s.kind = 'records' and s.collection = v_coll
      )
      delete from public.records x
       where x.institution_id = inst and x.collection = v_coll
         and not exists (select 1 from keep k where k.id = x.id);
      get diagnostics v_deleted = row_count;
    end if;
  elsif p_kind = 'docs' then
    delete from public.institution_docs d
     where d.institution_id = inst
       and d.key not in (select distinct r ->> 'key' from public.restore_staging s, jsonb_array_elements(s.items) r
                          where s.institution_id = inst and s.session_id = p_session and s.kind = 'docs');
    get diagnostics v_deleted = row_count;
  elsif p_kind = 'requests' then
    delete from public.public_admission_requests q
     where q.institution_id = inst
       and q.id not in (select distinct r ->> 'id' from public.restore_staging s, jsonb_array_elements(s.items) r
                         where s.institution_id = inst and s.session_id = p_session and s.kind = 'requests');
    get diagnostics v_deleted = row_count;
  end if;

  perform set_config('app.rpc', '', true);
  return jsonb_build_object('kind', p_kind, 'collection', v_coll, 'mode', v_mode, 'batches', v_batches, 'total', v_total, 'deleted', v_deleted);
end $$;

-- ---------- Aplicar UM lote preparado (idempotente) ----------
create or replace function public.school_restore_apply_batch(p_session uuid, p_kind text, p_collection text, p_seq int)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.backup_admin();
  v_coll text := case when p_kind = 'records' then coalesce(p_collection, '') else '' end;
  v_items jsonb; v_total int; n int := 0; n_ignored int := 0; n_inv_new int := 0;
begin
  if p_kind not in ('records', 'docs', 'requests', 'config') then
    raise exception 'invalid-backup: tipo desconhecido (%)', p_kind using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('restore:' || inst));

  select s.items into v_items from public.restore_staging s
   where s.institution_id = inst and s.session_id = p_session and s.kind = p_kind and s.collection = v_coll and s.seq = p_seq;
  if v_items is null then
    raise exception 'nothing-staged: lote % não encontrado (sessão expirada ou já aplicada)', p_seq using errcode = '22023';
  end if;
  v_total := jsonb_array_length(v_items);

  perform set_config('app.restoring', 'on', true);

  if p_kind = 'records' then
    if not exists (select 1 from public.collection_acl c where c.collection = v_coll) then
      n_ignored := v_total;
    elsif v_coll = 'invoices' then
      perform set_config('app.rpc', 'payment', true);
      with src as (select r from jsonb_array_elements(v_items) r),
      paid as (select invoice_id, sum(amount_kz) as total from public.payments where institution_id = inst group by invoice_id),
      ins as (
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
      -- apaga os mesmos ids e insere (igual ao restauro antigo, mas só para este lote → repetir é seguro)
      delete from public.records x
       where x.institution_id = inst and x.collection = v_coll
         and x.id in (select r ->> 'id' from jsonb_array_elements(v_items) r);
      insert into public.records (institution_id, collection, id, academic_year, ord, data, version, created_at, updated_at)
      select inst, v_coll, r ->> 'id', nullif(r ->> 'academic_year', ''), nullif(r ->> 'ord', '')::double precision,
             r -> 'data', coalesce(nullif(r ->> 'version', '')::int, 1),
             coalesce(nullif(r ->> 'created_at', '')::timestamptz, now()), coalesce(nullif(r ->> 'updated_at', '')::timestamptz, now())
        from jsonb_array_elements(v_items) r;
      get diagnostics n = row_count;
    end if;

  elsif p_kind = 'docs' then
    delete from public.institution_docs d where d.institution_id = inst and d.key in (select r ->> 'key' from jsonb_array_elements(v_items) r);
    insert into public.institution_docs (institution_id, key, data, updated_at)
    select inst, d ->> 'key', d -> 'data', coalesce(nullif(d ->> 'updated_at', '')::timestamptz, now())
      from jsonb_array_elements(v_items) d;
    get diagnostics n = row_count;

  elsif p_kind = 'requests' then
    delete from public.public_admission_requests q where q.institution_id = inst and q.id in (select r ->> 'id' from jsonb_array_elements(v_items) r);
    insert into public.public_admission_requests (institution_id, id, data, created_at)
    select inst, q ->> 'id', q -> 'data', coalesce(nullif(q ->> 'created_at', '')::timestamptz, now())
      from jsonb_array_elements(v_items) q;
    get diagnostics n = row_count;

  else  -- config
    insert into public.public_admission_config (institution_id, data)
    select inst, c from jsonb_array_elements(v_items) c limit 1
    on conflict (institution_id) do update set data = excluded.data, updated_at = now();
    get diagnostics n = row_count;
  end if;

  perform set_config('app.rpc', '', true);
  return jsonb_build_object('seq', p_seq, 'applied', n, 'ignored', n_ignored, 'invoicesRecreated', n_inv_new,
                            'invoicesKept', case when p_kind = 'records' and v_coll = 'invoices' then greatest(v_total - n_inv_new, 0) else 0 end);
end $$;

-- ---------- Concluir uma tabela: limpar a preparação ----------
create or replace function public.school_restore_complete(p_session uuid, p_kind text, p_collection text default '')
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inst text := app.backup_admin();
  v_coll text := case when p_kind = 'records' then coalesce(p_collection, '') else '' end;
begin
  delete from public.restore_staging
   where institution_id = inst and session_id = p_session and kind = p_kind and collection = v_coll;
end $$;

revoke all on function public.school_restore_prepare(uuid, text, text) from public, anon;
revoke all on function public.school_restore_apply_batch(uuid, text, text, int) from public, anon;
revoke all on function public.school_restore_complete(uuid, text, text) from public, anon;
grant execute on function public.school_restore_prepare(uuid, text, text) to authenticated;
grant execute on function public.school_restore_apply_batch(uuid, text, text, int) to authenticated;
grant execute on function public.school_restore_complete(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
