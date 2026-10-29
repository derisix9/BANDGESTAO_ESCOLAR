-- =====================================================================
-- 0013: registo livre + 30 dias de teste + bloqueio até pagar
--   plan_status: 'trial' (30 dias) | 'pago' | 'pendente' (bloqueada até pagar)
-- Acesso permitido = plan_status 'pago'  OU  ('trial' E trial_ends_at > agora).
-- O bloqueio é feito na BASE DE DADOS (app.current_institution() devolve NULL),
-- por isso não se contorna pela app. Só a plataforma (SQL Editor / service_role) altera o plano.
-- =====================================================================

alter table public.institutions
  add column if not exists plan_status   text not null default 'trial'
    check (plan_status in ('trial','pago','pendente')),
  add column if not exists trial_ends_at timestamptz not null default (now() + interval '30 days');

-- Escolas que já existiam não são bloqueadas: ficam como 'pago'.
update public.institutions set plan_status = 'pago' where plan_status = 'trial' and created_at < now() - interval '1 minute';

-- Plano em vigor?
create or replace function app.plan_active(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select i.plan_status = 'pago' or (i.plan_status = 'trial' and i.trial_ends_at > now())
    from public.institutions i where i.id = p_inst
  ), false)
$$;

-- Escola bloqueada → nenhuma política RLS deixa passar (institution_id = NULL nunca é verdadeiro).
-- O perfil do próprio continua legível (profiles_select: id = auth.uid()), para a app mostrar o aviso.
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.institution_id from public.profiles p
  where p.id = auth.uid() and p.active and app.plan_active(p.institution_id)
$$;

-- Só a plataforma muda o plano (a escola tem UPDATE na sua linha, mas não nestes campos).
create or replace function app.guard_institution_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.plan_status is distinct from old.plan_status or new.trial_ends_at is distinct from old.trial_ends_at) then
    raise exception 'Só a equipa BandMed altera o plano' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists institutions_plan_guard on public.institutions;
create trigger institutions_plan_guard before update on public.institutions
  for each row execute function app.guard_institution_plan();

-- Estado do plano da escola de quem chama (funciona mesmo com a escola bloqueada).
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'status', case when i.plan_status = 'trial' and i.trial_ends_at <= now() then 'pendente' else i.plan_status end,
    'active', app.plan_active(i.id),
    'trialEndsAt', i.trial_ends_at,
    'daysLeft', case when i.plan_status = 'trial' then greatest(0, ceil(extract(epoch from (i.trial_ends_at - now())) / 86400)::int) else null end,
    'schoolName', i.name)
  from public.profiles p join public.institutions i on i.id = p.institution_id
  where p.id = auth.uid()
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Passa a 'pendente' as escolas cujo teste acabou (a base de dados já bloqueia sem isto; serve para o estado ficar correcto).
create or replace function app.job_expire_trials() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update public.institutions set plan_status = 'pendente' where plan_status = 'trial' and trial_ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.job_expire_trials() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobname) from cron.job where jobname = 'bm_expire_trials';
    perform cron.schedule('bm_expire_trials', '5 0 * * *', 'select app.job_expire_trials()');
  else
    raise notice 'pg_cron indisponível: o estado "pendente" é calculado na leitura, mas não gravado.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Uso (SQL Editor do Supabase):
--   Marcar como paga:      update public.institutions set plan_status = 'pago' where id = 'inst_xxx';
--   Voltar a pendente:     update public.institutions set plan_status = 'pendente' where id = 'inst_xxx';
--   Dar mais dias de teste: update public.institutions set plan_status = 'trial', trial_ends_at = now() + interval '15 days' where id = 'inst_xxx';
-- ---------------------------------------------------------------------
