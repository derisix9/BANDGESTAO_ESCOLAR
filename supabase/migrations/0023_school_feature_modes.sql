-- =====================================================================
-- 0023 — Funcionalidades avançadas por escola (Admin Master)
-- =====================================================================
-- Duas áreas de "configuração avançada" passam a ser controladas, escola a
-- escola, pelo Super Admin (app Admin Master):
--
--     integracoes        Configurações → Integrações (EMIS, AGT, SMS, gateway…)
--     backup_automatico  Configurações → Segurança & BD → Cópia diária para a nuvem
--
-- Cada uma tem 3 modos:
--     oculto    a escola NÃO vê a área                              (omissão)
--     leitura   o admin da escola vê o que está configurado, sem gravar
--     gravacao  o admin da escola configura tudo, como o Admin Master
--
-- Omissão = 'oculto' (versão de teste vem desativada). Escolas que já estão
-- com plano PAGO no momento desta migração ficam em 'gravacao' para não
-- perderem nada do que já usam.
--
-- Pré-requisito: 0001–0022 (usa app.current_institution, app.is_platform_admin).
-- =====================================================================

create table if not exists public.school_feature_modes (
  institution_id text not null references public.institutions(id) on delete cascade,
  feature_key    text not null check (feature_key in ('integracoes','backup_automatico')),
  mode           text not null default 'oculto' check (mode in ('oculto','leitura','gravacao')),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, feature_key)
);
alter table public.school_feature_modes enable row level security;

-- Só o Super Admin escreve; a escola só pode ler as suas próprias linhas.
drop policy if exists feature_modes_admin on public.school_feature_modes;
create policy feature_modes_admin on public.school_feature_modes for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
drop policy if exists feature_modes_school_read on public.school_feature_modes;
create policy feature_modes_school_read on public.school_feature_modes for select to authenticated
  using (institution_id = app.current_institution());

revoke all on public.school_feature_modes from anon;
grant select, insert, update, delete on public.school_feature_modes to authenticated;

-- Modo efetivo de uma área (omissão 'oculto'). Usado pelo servidor (RLS/Edge Functions).
create or replace function app.feature_mode(p_inst text, p_key text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select mode from public.school_feature_modes where institution_id = p_inst and feature_key = p_key), 'oculto')
$$;

-- A escola lê os seus modos de uma só vez.
create or replace function public.my_feature_modes() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'integracoes',       app.feature_mode(app.current_institution(), 'integracoes'),
    'backup_automatico', app.feature_mode(app.current_institution(), 'backup_automatico'));
$$;
revoke all on function public.my_feature_modes() from public, anon;
grant execute on function public.my_feature_modes() to authenticated;

-- Super Admin: lê / define os modos de uma escola (com registo de auditoria).
create or replace function public.platform_get_feature_modes(p_inst text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa da plataforma' using errcode = '42501'; end if;
  return jsonb_build_object(
    'integracoes',       app.feature_mode(p_inst, 'integracoes'),
    'backup_automatico', app.feature_mode(p_inst, 'backup_automatico'));
end $$;
revoke all on function public.platform_get_feature_modes(text) from public, anon;
grant execute on function public.platform_get_feature_modes(text) to authenticated;

create or replace function public.platform_set_feature_mode(p_inst text, p_key text, p_mode text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa da plataforma' using errcode = '42501'; end if;
  if p_key not in ('integracoes','backup_automatico') then raise exception 'Área desconhecida: %', p_key; end if;
  if p_mode not in ('oculto','leitura','gravacao') then raise exception 'Modo inválido: %', p_mode; end if;
  select name into nm from public.institutions where id = p_inst;
  if nm is null then raise exception 'Escola não encontrada'; end if;
  insert into public.school_feature_modes (institution_id, feature_key, mode, updated_by, updated_at)
    values (p_inst, p_key, p_mode, auth.uid(), now())
  on conflict (institution_id, feature_key) do update set mode = excluded.mode, updated_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.platform_set_feature_mode(text, text, text) from public, anon;
grant execute on function public.platform_set_feature_mode(text, text, text) to authenticated;

-- Escolas que já pagam mantêm o acesso completo; trial/pendente ficam ocultas (omissão).
insert into public.school_feature_modes (institution_id, feature_key, mode)
select i.id, k.key, 'gravacao'
from public.institutions i cross join (values ('integracoes'), ('backup_automatico')) as k(key)
where i.plan_status = 'pago'
on conflict (institution_id, feature_key) do nothing;

-- Backup automático: a leitura do estado exige modo leitura/gravação (a escrita é
-- bloqueada na Edge Function school-backups, que exige 'gravacao').
create or replace function public.school_backup_destination_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); d record; runs jsonb;
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola vê a cópia para a nuvem' using errcode = '42501';
  end if;
  if app.feature_mode(inst, 'backup_automatico') = 'oculto' then
    raise exception 'A cópia diária para a nuvem não está disponível para esta escola' using errcode = '42501';
  end if;
  select * into d from public.school_backup_destinations where institution_id = inst;
  select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'trigger', r.trigger, 'ok', r.ok, 'file', r.file, 'size', r.size, 'error', r.error)
                            order by r.at desc), '[]'::jsonb)
    into runs from (select * from public.school_backup_runs where institution_id = inst order by at desc limit 10) r;
  return jsonb_build_object(
    'configured', d.institution_id is not null, 'provider', d.provider, 'enabled', coalesce(d.enabled, false),
    'runHour', coalesce(d.run_hour, 23), 'retentionDays', coalesce(d.retention_days, 30),
    'config', coalesce(d.config, '{}'::jsonb), 'hasSecret', d.secret_enc is not null,
    'running', coalesce(d.running_since > now() - interval '30 minutes', false),
    'lastAttemptAt', d.last_attempt_at, 'lastSuccessAt', d.last_success_at,
    'lastStatus', d.last_status, 'lastError', d.last_error, 'lastFile', d.last_file, 'lastSize', d.last_size,
    'runs', runs);
end $$;
revoke all on function public.school_backup_destination_status() from public, anon;
grant execute on function public.school_backup_destination_status() to authenticated;
