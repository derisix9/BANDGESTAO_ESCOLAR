-- =====================================================================
-- 0014: data de fim do plano pago (paid_until)
--   plano activo = ('pago' E (paid_until nulo OU paid_until > agora))  OU  ('trial' E trial_ends_at > agora)
--   paid_until NULO = pago sem fim (como antes). Quando passa a data, a escola fica 'pendente' sozinha.
-- =====================================================================
alter table public.institutions add column if not exists paid_until timestamptz;

create or replace function app.plan_active(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (i.plan_status = 'pago' and (i.paid_until is null or i.paid_until > now()))
        or (i.plan_status = 'trial' and i.trial_ends_at > now())
    from public.institutions i where i.id = p_inst
  ), false)
$$;

create or replace function app.guard_institution_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.plan_status is distinct from old.plan_status
          or new.trial_ends_at is distinct from old.trial_ends_at
          or new.paid_until is distinct from old.paid_until) then
    raise exception 'Só a equipa BandMed altera o plano' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'status', case when (i.plan_status = 'trial' and i.trial_ends_at <= now())
                     or (i.plan_status = 'pago' and i.paid_until is not null and i.paid_until <= now())
                   then 'pendente' else i.plan_status end,
    'active', app.plan_active(i.id),
    'trialEndsAt', i.trial_ends_at,
    'daysLeft', case when i.plan_status = 'trial' then greatest(0, ceil(extract(epoch from (i.trial_ends_at - now())) / 86400)::int) else null end,
    'paidUntil', i.paid_until,
    'paidDaysLeft', case when i.plan_status = 'pago' and i.paid_until is not null
                         then greatest(0, ceil(extract(epoch from (i.paid_until - now())) / 86400)::int) else null end,
    'schoolName', i.name)
  from public.profiles p join public.institutions i on i.id = p.institution_id
  where p.id = auth.uid()
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

create or replace function app.job_expire_trials() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; m int;
begin
  update public.institutions set plan_status = 'pendente' where plan_status = 'trial' and trial_ends_at <= now();
  get diagnostics n = row_count;
  update public.institutions set plan_status = 'pendente' where plan_status = 'pago' and paid_until is not null and paid_until <= now();
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function app.job_expire_trials() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Uso (SQL Editor):
--   Pagou 1 ano:   update public.institutions set plan_status = 'pago', paid_until = now() + interval '1 year' where id = 'inst_xxx';
--   Pagou 1 mês:   update public.institutions set plan_status = 'pago', paid_until = now() + interval '1 month' where id = 'inst_xxx';
--   Renovar (soma ao fim actual): update public.institutions set plan_status = 'pago',
--       paid_until = greatest(coalesce(paid_until, now()), now()) + interval '1 year' where id = 'inst_xxx';
--   Pago sem fim:  update public.institutions set plan_status = 'pago', paid_until = null where id = 'inst_xxx';
-- ---------------------------------------------------------------------
