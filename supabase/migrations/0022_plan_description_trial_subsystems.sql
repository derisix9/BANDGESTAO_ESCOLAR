-- =====================================================================
-- 0022: DESCRIÇÃO NOS PLANOS + TESTE SÓ COM PRIMÁRIO E I CICLO
-- =====================================================================
--   1. subscription_plans.description: texto livre com informações
--      adicionais do plano (criado/editado no Admin Master).
--   2. Enquanto a escola está em TESTE (plan_status = 'trial') só ficam
--      ativos os subsistemas de ensino Primário e I Ciclo. Pré-Escolar,
--      II Ciclo/Médio e Superior ficam bloqueados automaticamente; ao
--      passar a plano pago voltam a valer só os bloqueios do Admin Master.
-- =====================================================================

alter table public.subscription_plans
  add column if not exists description text;

create or replace function public.my_feature_overrides() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select p.institution_id, i.plan_status
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
    where p.id = auth.uid() and p.active
  )
  select jsonb_build_object(
    'blockedModules',  coalesce(f.blocked_modules,  '{}'::jsonb),
    'blockedSections', coalesce(f.blocked_sections, '{}'::jsonb),
    'blockedSubsystems',
       coalesce(f.blocked_subsystems, '{}'::jsonb)
       || case when me.plan_status = 'trial'
               then '{"pre_escolar":true,"secundario_2":true,"superior":true}'::jsonb
               else '{}'::jsonb end
  )
  from me
  left join public.school_feature_overrides f on f.institution_id = me.institution_id
$$;
revoke all on function public.my_feature_overrides() from public, anon;
grant execute on function public.my_feature_overrides() to authenticated;
