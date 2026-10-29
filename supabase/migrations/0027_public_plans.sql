-- 0027 — Página principal pública: leitura dos planos ativos SEM login.
-- A tabela subscription_plans continua fechada (RLS só para super administradores);
-- esta função devolve apenas os campos comerciais dos planos ativos.
create or replace function public.public_plans() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'name', name,
           'cycle', cycle,
           'priceKz', price_kz,
           'maxStudents', max_students,
           'maxUsers', max_users,
           'storageGb', storage_gb,
           'trialDays', trial_days,
           'description', description
         ) order by price_kz, name), '[]'::jsonb)
  from public.subscription_plans
  where active;
$$;
revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated;
