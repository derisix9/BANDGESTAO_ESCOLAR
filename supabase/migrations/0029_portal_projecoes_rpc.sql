-- =====================================================================
-- 0029: portal do aluno / encarregado — notas, faltas e envio do boletim
--
-- Problema: aluno e encarregado só leem `user_projections` (a sua cópia filtrada),
-- e essa tabela só é escrita por admin/director/secretaria/financeiro.
--   1) Notas e assiduidade lançadas por um PROFESSOR gravam em `records`, mas a
--      projecção do aluno/encarregado não era actualizada -> o portal ficava vazio.
--   2) O aluno não pode escrever em `records` (students) nem na projecção do
--      encarregado -> "Enviar boletim" nunca chegava ao encarregado.
-- Solução: duas funções SECURITY DEFINER com validação de perfil e de âmbito.
-- Seguro de correr mais do que uma vez.
-- =====================================================================

-- ---------- 1) Professor/gestão: refrescar as projecções afectadas ----------
-- Copia para as projecções a versão actual (em `records`) dos alunos indicados e
-- as folhas de assiduidade das turmas indicadas. Só toca em projecções que
-- contenham esses alunos ou essas turmas.
create or replace function public.refresh_portal_projections(p_student_ids text[], p_class_ids text[])
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
  if cardinality(p_student_ids) = 0 and cardinality(p_class_ids) = 0 then
    return 0;
  end if;

  with target as (
    select up.user_id, up.data
    from public.user_projections up
    where up.institution_id = v_inst
      and up.data ->> 'role' in ('aluno','encarregado')
      and (
        exists (select 1 from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s
                where s ->> 'id' = any (p_student_ids))
        or exists (select 1 from jsonb_array_elements(coalesce(up.data -> 'classes', '[]'::jsonb)) c
                   where c ->> 'id' = any (p_class_ids))
      )
  ),
  fresh as (
    select t.user_id,
      -- alunos: versão actual de `records`; se não existir, mantém a da projecção
      (select coalesce(jsonb_agg(coalesce(r.data, s.e) order by s.ord), '[]'::jsonb)
         from jsonb_array_elements(coalesce(t.data -> 'students', '[]'::jsonb)) with ordinality as s(e, ord)
         left join public.records r
           on r.institution_id = v_inst and r.collection = 'students' and r.id = s.e ->> 'id') as students,
      -- assiduidade: folhas das turmas desta projecção
      (select coalesce(jsonb_agg(r.data), '[]'::jsonb)
         from public.records r
        where r.institution_id = v_inst and r.collection = 'attendanceSheets'
          and r.data ->> 'classId' in (
                select c ->> 'id' from jsonb_array_elements(coalesce(t.data -> 'classes', '[]'::jsonb)) c)) as sheets
    from target t
  )
  update public.user_projections up
     set data = up.data || jsonb_build_object('students', f.students, 'attendanceSheets', f.sheets, 'updatedAt', to_jsonb(now())),
         updated_at = now()
    from fresh f
   where up.institution_id = v_inst and up.user_id = f.user_id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.refresh_portal_projections(text[], text[]) from public;
grant execute on function public.refresh_portal_projections(text[], text[]) to authenticated;

-- ---------- 2) Aluno: enviar o boletim ao encarregado ----------
-- Valida que o aluno é o titular da projecção que o contém, marca o registo do aluno
-- e propaga a marca à projecção do próprio e às dos encarregados desse aluno.
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

  -- o aluno só pode enviar o boletim que consta da SUA projecção
  if not exists (
    select 1 from public.user_projections up
     where up.institution_id = v_inst and up.user_id = auth.uid()
       and exists (select 1 from jsonb_array_elements(coalesce(up.data -> 'students', '[]'::jsonb)) s
                   where s ->> 'id' = p_student_id)
  ) then
    raise exception 'aluno não associado a esta conta' using errcode = '42501';
  end if;

  update public.records
     set data = data || v_patch, updated_at = v_now, version = version + 1
   where institution_id = v_inst and collection = 'students' and id = p_student_id;

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
