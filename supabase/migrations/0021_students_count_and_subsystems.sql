-- =====================================================================
-- 0021: CONTAS DE ALUNOS CONTAM NO LIMITE + SUBSISTEMAS DE ENSINO (ADMIN MASTER)
-- =====================================================================
--   1. Limite de utilizadores: as contas de ALUNOS do portal passam a contar.
--      Só as contas de ENCARREGADOS continuam fora da contagem.
--   2. Subsistemas de ENSINO (pre_escolar, primario, secundario_1,
--      secundario_2, superior): o Admin Master liga/desliga por escola.
--      Desligado = a escola não o vê em Configurações → Instituição.
-- =====================================================================

-- 1. Contagem e gatilho -------------------------------------------------
create or replace function app.school_user_count(p_inst text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.profiles p
  where p.institution_id = p_inst and p.active and p.role <> 'encarregado'
$$;

create or replace function app.enforce_users_limit() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lim bigint;
begin
  if new.role = 'encarregado' or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active and old.role <> 'encarregado' then return new; end if;  -- já contava
  if app.is_platform_admin() then return new; end if;
  lim := app.plan_limit(new.institution_id, 'users');
  if lim is not null and app.school_user_count(new.institution_id) >= lim then
    raise exception 'LIMITE_PLANO:utilizadores — O plano permite % utilizadores e já foram atingidos. Desative um utilizador ou peça um plano maior.', lim
      using errcode = '53400';
  end if;
  return new;
end $$;

-- 2. Subsistemas de ensino desligados pelo Admin Master -----------------
alter table public.school_feature_overrides
  add column if not exists blocked_subsystems jsonb not null default '{}'::jsonb;   -- {"superior": true}

-- A app da escola lê os bloqueios (agora com subsistemas de ensino).
create or replace function public.my_feature_overrides() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_build_object('blockedModules', f.blocked_modules, 'blockedSections', f.blocked_sections,
                              'blockedSubsystems', f.blocked_subsystems)
    from public.school_feature_overrides f
    where f.institution_id = (select institution_id from public.profiles where id = auth.uid() and active)
  ), '{"blockedModules":{},"blockedSections":{},"blockedSubsystems":{}}'::jsonb)
$$;
revoke all on function public.my_feature_overrides() from public, anon;
grant execute on function public.my_feature_overrides() to authenticated;

-- Admin Master: lê os subsistemas de ensino desligados de uma escola.
create or replace function public.platform_get_subsystems(p_inst text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  return coalesce((select f.blocked_subsystems from public.school_feature_overrides f
                   where f.institution_id = p_inst), '{}'::jsonb);
end $$;
revoke all on function public.platform_get_subsystems(text) from public, anon;
grant execute on function public.platform_get_subsystems(text) to authenticated;

-- Admin Master: substitui o mapa de subsistemas de ensino desligados (não mexe em módulos/secções).
create or replace function public.platform_set_subsystems(p_inst text, p_blocked jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text; b jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  select name into nm from public.institutions where id = p_inst;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  -- só ids válidos, só valores true
  select coalesce(jsonb_object_agg(k, true), '{}'::jsonb) into b
    from jsonb_each(coalesce(p_blocked, '{}'::jsonb)) e(k, v)
    where v = 'true'::jsonb
      and k in ('pre_escolar', 'primario', 'secundario_1', 'secundario_2', 'superior');
  insert into public.school_feature_overrides (institution_id, blocked_subsystems, updated_by, updated_at)
  values (p_inst, b, auth.uid(), now())
  on conflict (institution_id) do update
    set blocked_subsystems = excluded.blocked_subsystems,
        updated_by = excluded.updated_by, updated_at = now();
  perform public.platform_log('school_subsystems', 'school', p_inst,
        jsonb_build_object('name', nm, 'blockedSubsystems', b));
end $$;
revoke all on function public.platform_set_subsystems(text, jsonb) from public, anon;
grant execute on function public.platform_set_subsystems(text, jsonb) to authenticated;
