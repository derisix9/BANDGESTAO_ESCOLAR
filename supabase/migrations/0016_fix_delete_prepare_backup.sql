-- =====================================================================
-- 0016 — Corrige "Falta a migração 0012 (app.export_school): sem backup não se elimina"
--
-- CAUSA: a 0015 (school_delete_prepare) exigia a função app.export_school(text) da versão ANTIGA da 0012.
--   A 0012 actual APAGA essa função (drop function if exists app.export_school) e passa a oferecer apenas
--   public.school_backup_export(). Resultado: com a 0012 aplicada, a 0015 nunca encontrava o exportador.
--
-- CORRECÇÃO: um exportador interno próprio (app.school_backup_build(p_inst)) que a 0015 passa a usar.
--   • Não depende de app.export_school, por isso reaplicar a 0012 já não estraga a eliminação.
--   • Devolve o MESMO formato do backup normal (bandmed-school-backup v1, restaurável em
--     Configurações → Segurança & Backups) e, a mais, `userAccess` — as permissões por utilizador,
--     que a eliminação apaga e o backup normal não leva.
--   • school_delete_prepare mantém as mesmas regras (admin + nome + frase verificados no servidor,
--     bilhete de uso único de 15 min); só deixa de exigir app.export_school.
--
-- Seguro de correr mais do que uma vez.
-- =====================================================================

create or replace function app.school_backup_build(p_inst text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_name text; v_records jsonb; v_docs jsonb; v_cfg jsonb; v_req jsonb; v_access jsonb;
  v_pay jsonb; v_fisc jsonb; v_series jsonb; v_counts jsonb;
begin
  select name into v_name from public.institutions where id = p_inst;
  if not found then raise exception 'Escola não encontrada' using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'collection', r.collection, 'id', r.id, 'academic_year', r.academic_year, 'ord', r.ord,
           'version', r.version, 'created_at', r.created_at, 'updated_at', r.updated_at, 'data', r.data)
         order by r.collection, r.id), '[]'::jsonb)
    into v_records from public.records r where r.institution_id = p_inst;

  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'updated_at', d.updated_at, 'data', d.data)
         order by d.key), '[]'::jsonb)
    into v_docs from public.institution_docs d where d.institution_id = p_inst;

  select c.data into v_cfg from public.public_admission_config c where c.institution_id = p_inst;

  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'created_at', q.created_at, 'data', q.data)
         order by q.created_at, q.id), '[]'::jsonb)
    into v_req from public.public_admission_requests q where q.institution_id = p_inst;

  -- permissões por utilizador (a eliminação apaga-as; vão no ficheiro para se poderem consultar/repor)
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'updated_at', a.updated_at, 'sections', a.sections)
         order by a.user_id), '[]'::jsonb)
    into v_access from public.user_access a where a.institution_id = p_inst;

  -- só referência (nunca apagado nem restaurado)
  select coalesce(jsonb_agg(to_jsonb(p) - 'institution_id' order by p.paid_at, p.id), '[]'::jsonb)
    into v_pay from public.payments p where p.institution_id = p_inst;
  select coalesce(jsonb_agg(to_jsonb(f) - 'institution_id' order by f.doc_type, f.series, f.number), '[]'::jsonb)
    into v_fisc from public.fiscal_documents f where f.institution_id = p_inst;
  select coalesce(jsonb_agg(to_jsonb(s) - 'institution_id' order by s.series, s.doc_type), '[]'::jsonb)
    into v_series from public.fiscal_series s where s.institution_id = p_inst;

  v_counts := jsonb_build_object(
    'records', jsonb_array_length(v_records),
    'docs', jsonb_array_length(v_docs),
    'publicAdmissionRequests', jsonb_array_length(v_req),
    'userAccess', jsonb_array_length(v_access),
    'payments', jsonb_array_length(v_pay),
    'fiscalDocuments', jsonb_array_length(v_fisc));

  return jsonb_build_object(
    'format', 'bandmed-school-backup',
    'formatVersion', 1,
    'institutionId', p_inst,
    'schoolName', v_name,
    'exportedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'counts', v_counts,
    'records', v_records,
    'docs', v_docs,
    'publicAdmissionConfig', v_cfg,
    'publicAdmissionRequests', v_req,
    'userAccess', v_access,
    'archive', jsonb_build_object('payments', v_pay, 'fiscalDocuments', v_fisc, 'fiscalSeries', v_series));
end $$;
revoke all on function app.school_backup_build(text) from public, anon, authenticated;

-- Passo 2 da eliminação: entrega o backup e o bilhete (já sem depender de app.export_school).
create or replace function public.school_delete_prepare(p_name text, p_phrase text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb := app.school_delete_check(auth.uid(), p_name, p_phrase); inst text; t uuid; bk jsonb;
begin
  if not ((c ->> 'adminOk')::boolean and (c ->> 'schoolOk')::boolean and (c ->> 'nameOk')::boolean and (c ->> 'phraseOk')::boolean) then
    raise exception 'Confirmação inválida: só o administrador, com o nome da escola e a frase correctos' using errcode = '42501';
  end if;
  inst := c ->> 'institutionId';
  bk := app.school_backup_build(inst);
  update public.school_delete_tickets set used_at = now() where user_id = auth.uid() and used_at is null;   -- um bilhete de cada vez
  insert into public.school_delete_tickets(institution_id, user_id) values (inst, auth.uid()) returning id into t;
  perform public.write_audit_event_service(inst, auth.uid(), 'RPC:school_delete_prepared', 'school', inst, bk -> 'counts');
  return jsonb_build_object('ticket', t, 'backup', bk);
end $$;

revoke all on function public.school_delete_prepare(text, text) from public, anon;
grant execute on function public.school_delete_prepare(text, text) to authenticated;

notify pgrst, 'reload schema';
