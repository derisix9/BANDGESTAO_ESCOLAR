-- =====================================================================
-- 0032: ESTADO DO PLANO LEGÍVEL POR QUALQUER FUNCIONÁRIO ATIVO
-- A app consulta isto ANTES de cadastrar (aluno, utilizador, ...) para recusar logo,
-- sem gravar localmente um registo que o servidor iria rejeitar (migrações 0020/0025).
-- my_subscription() só serve admin/director; esta serve toda a equipa (secretaria, etc.).
-- Mesmas regras que os gatilhos: limites do plano da escola mãe, consumo do GRUPO (mãe + filiais).
-- NULL = ilimitado. Pré-requisito: 0025.
-- =====================================================================
create or replace function public.my_plan_status() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare inst text; l_st bigint; l_us bigint; l_sto bigint; st int; us int; used bigint;
begin
  select p.institution_id into inst from public.profiles p where p.id = auth.uid() and p.active;
  if inst is null then return null; end if;
  l_st := app.plan_limit(inst, 'students');
  l_us := app.plan_limit(inst, 'users');
  l_sto := app.plan_limit(inst, 'storage');
  st := case when l_st is null then 0 else app.group_student_count(inst) end;
  us := case when l_us is null then 0 else app.group_user_count(inst) end;
  used := case when l_sto is null then 0 else app.group_usage_total(inst) end;
  return jsonb_build_object(
    'limits', jsonb_build_object('students', l_st, 'users', l_us, 'storageBytes', l_sto),
    'usage',  jsonb_build_object('students', st, 'users', us, 'storageBytes', used),
    'blocked', jsonb_build_object(
      'students', l_st is not null and st >= l_st,
      'users',    l_us is not null and us >= l_us,
      'storage',  l_sto is not null and used >= l_sto));
end $$;
revoke all on function public.my_plan_status() from public, anon;
grant execute on function public.my_plan_status() to authenticated;
notify pgrst, 'reload schema';
