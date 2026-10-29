-- =====================================================================
-- 0030: corrige o envio do boletim (403) e alarga a actualização do portal
--  - guard_record_write passa a aceitar a escrita feita pela função student_send_boletim
--  - student_send_boletim marca app.rpc = 'boletim'
--  - refresh_portal_projections também refresca trabalhos, materiais, reuniões e avaliações descritivas
-- Seguro de correr mais do que uma vez.
-- =====================================================================

create or replace function app.guard_record_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r text := app.current_role();
  rpc text := coalesce(current_setting('app.rpc', true), '');
  allowed jsonb; owner_field text; k text;
begin
  if auth.uid() is null then return new; end if;      -- servidor (service_role)

  -- Homologações só pela função homologate_pauta
  if new.collection = 'homologations' and rpc <> 'homologate' then
    raise exception 'Use homologate_pauta' using errcode = '42501';
  end if;

  -- Estado de pagamento só muda pela função register_payment (impede marcar "pago" à mão)
  if new.collection = 'invoices' and rpc <> 'payment' then
    if tg_op = 'INSERT' and new.data ->> 'status' = 'pago' then
      raise exception 'Pagamentos só se registam pela função register_payment' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
       and (   new.data ->> 'status'      is distinct from old.data ->> 'status'
            or new.data ->> 'totalPaidKz' is distinct from old.data ->> 'totalPaidKz'
            or new.data ->> 'paymentDate' is distinct from old.data ->> 'paymentDate')
       and (old.data ->> 'status' = 'pago' or new.data ->> 'status' = 'pago') then
      raise exception 'Pagamentos só se registam pela função register_payment' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.updated_by := auth.uid();
    return new;
  end if;

  -- UPDATE
  if new.institution_id <> old.institution_id or new.collection <> old.collection or new.id <> old.id then
    raise exception 'Chave do registo é imutável' using errcode = '42501';
  end if;

  -- Envio do boletim pelo aluno (função student_send_boletim): só toca nos campos do boletim.
  if rpc = 'boletim' and old.collection = 'students' then
    new.updated_by := auth.uid(); new.updated_at := now();
    return new;
  end if;

  if not app.can_access(old.collection, 'write') then
    select c.field_writes -> r, c.owner_write ->> r into allowed, owner_field
      from public.collection_acl c where c.collection = old.collection;
    if owner_field is not null then
      if old.data ->> owner_field is distinct from auth.uid()::text
         or new.data ->> owner_field is distinct from auth.uid()::text then
        raise exception 'Só pode alterar registos seus' using errcode = '42501';
      end if;
    elsif allowed is not null then
      for k in select jsonb_object_keys(new.data) loop
        if (old.data -> k) is distinct from (new.data -> k) and not (allowed ? k) then
          raise exception 'Perfil % não pode alterar o campo "%"', r, k using errcode = '42501';
        end if;
      end loop;
      for k in select jsonb_object_keys(old.data) loop
        if not (new.data ? k) and not (allowed ? k) then
          raise exception 'Perfil % não pode remover o campo "%"', r, k using errcode = '42501';
        end if;
      end loop;
    else
      raise exception 'Sem permissão de escrita' using errcode = '42501';
    end if;
  end if;

  -- Bloqueio optimista: o cliente envia a versão que leu. Se outro utilizador gravou
  -- entretanto, falha em vez de sobrepor ("última escrita ganha").
  -- Chamadas de RPC do servidor (app.rpc definido) mantêm a versão.
  if rpc = '' and new.version is distinct from old.version then
    raise exception 'Conflito de versão: o registo foi alterado por outro utilizador' using errcode = '40001';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;;


create or replace function public.student_send_boletim(p_student_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inst text := app.current_institution();
  v_role text := app.current_role();
  v_now  timestamptz := now();
  v_patch jsonb := jsonb_build_object('boletimEnviadoAoEncarregado', true, 'boletimEnviadoEm', to_jsonb(v_now));
begin
  if v_inst is null or v_role <> 'aluno' then
    raise exception 'só o aluno pode enviar o seu boletim' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_projections up
     where up.institution_id = v_inst and up.user_id = auth.uid()
       and exists (select 1 from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s
                   where s ->> 'id' = p_student_id)
  ) then
    raise exception 'aluno não associado a esta conta' using errcode = '42501';
  end if;

  perform set_config('app.rpc', 'boletim', true);
  update public.records
     set data = data || v_patch, version = version + 1
   where institution_id = v_inst and collection = 'students' and id = p_student_id;
  perform set_config('app.rpc', '', true);

  update public.user_projections up
     set data = jsonb_set(
           up.data, '{students}',
           (select coalesce(jsonb_agg(case when s ->> 'id' = p_student_id then s || v_patch else s end), '[]'::jsonb)
              from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s)),
         updated_at = v_now
   where up.institution_id = v_inst
     and up.data ->> 'role' in ('aluno','encarregado')
     and exists (select 1 from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s
                 where s ->> 'id' = p_student_id);
  return true;
end $$;
revoke all on function public.student_send_boletim(text) from public;
grant execute on function public.student_send_boletim(text) to authenticated;

-- ---------- refresco alargado das projecções ----------
drop function if exists public.refresh_portal_projections(text[], text[]);
create or replace function public.refresh_portal_projections(p_student_ids text[], p_class_ids text[], p_extras boolean default false)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inst text := app.current_institution();
  v_role text := app.current_role();
  v_n integer := 0;
begin
  if v_inst is null or v_role not in ('admin','director','secretaria','financeiro','professor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  p_student_ids := coalesce(p_student_ids, '{}');
  p_class_ids   := coalesce(p_class_ids, '{}');
  if cardinality(p_student_ids) = 0 and cardinality(p_class_ids) = 0 and not coalesce(p_extras, false) then
    return 0;
  end if;

  with target as (
    select up.user_id, up.data,
           array(select s ->> 'id' from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s) as sids,
           array(select c ->> 'id' from jsonb_array_elements(coalesce(up.data -> 'classes', '[]'::jsonb)) c) as cids
    from public.user_projections up
    where up.institution_id = v_inst
      and up.data ->> 'role' in ('aluno','encarregado')
  ),
  scoped as (
    select * from target t
    where coalesce(p_extras, false) or t.sids && p_student_ids or t.cids && p_class_ids
  ),
  fresh as (
    select t.user_id,
      (select coalesce(jsonb_agg(coalesce(r.data, s.e) order by s.ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(t.data -> 'students', '[]'::jsonb)) with ordinality as s(e, ord)
         left join public.records r
           on r.institution_id = v_inst and r.collection = 'students' and r.id = s.e ->> 'id') as students,
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb) from public.records r
        where r.institution_id = v_inst and r.collection = 'attendanceSheets'
          and r.data ->> 'classId' = any (t.cids)) as sheets,
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb) from public.records r
        where r.institution_id = v_inst and r.collection = 'assignments'
          and r.data ->> 'status' is distinct from 'rascunho'
          and r.data ->> 'classId' = any (t.cids)) as assignments,
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb) from public.records r
        where r.institution_id = v_inst and r.collection = 'assignmentSubmissions'
          and r.data ->> 'studentId' = any (t.sids)
          and r.data ->> 'assignmentId' in (
                select a.id from public.records a
                 where a.institution_id = v_inst and a.collection = 'assignments'
                   and a.data ->> 'status' is distinct from 'rascunho'
                   and a.data ->> 'classId' = any (t.cids))) as submissions,
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb) from public.records r
        where r.institution_id = v_inst and r.collection = 'teachingMaterials'
          and r.data ->> 'visibleToStudents' = 'true'
          and r.data ->> 'classId' = any (t.cids)) as materials,
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb) from public.records r
        where r.institution_id = v_inst and r.collection = 'descriptiveAssessments'
          and r.data ->> 'status' = 'publicado'
          and r.data ->> 'studentId' = any (t.sids)) as descriptive,
      (select coalesce(jsonb_agg(
                r.data || jsonb_build_object('participants',
                  (select coalesce(jsonb_agg(p), '[]'::jsonb)
                     from jsonb_array_elements(coalesce(r.data -> 'participants', '[]'::jsonb)) p
                    where p ->> 'studentId' = any (t.sids)))), '[]'::jsonb)
         from public.records r
        where r.institution_id = v_inst and r.collection = 'parentTeacherMeetings'
          and r.data ->> 'status' is distinct from 'cancelada'
          and ( exists (select 1 from jsonb_array_elements(coalesce(r.data -> 'participants', '[]'::jsonb)) p
                         where p ->> 'studentId' = any (t.sids))
                or (r.data ->> 'type' = 'coletiva' and r.data ->> 'classId' = any (t.cids)))) as meetings
    from scoped t
  )
  update public.user_projections up
     set data = up.data || jsonb_build_object(
           'students', f.students, 'attendanceSheets', f.sheets,
           'assignments', f.assignments, 'assignmentSubmissions', f.submissions,
           'teachingMaterials', f.materials, 'descriptiveAssessments', f.descriptive,
           'parentTeacherMeetings', f.meetings, 'updatedAt', to_jsonb(now())),
         updated_at = now()
    from fresh f
   where up.institution_id = v_inst and up.user_id = f.user_id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.refresh_portal_projections(text[], text[], boolean) from public;
grant execute on function public.refresh_portal_projections(text[], text[], boolean) to authenticated;
