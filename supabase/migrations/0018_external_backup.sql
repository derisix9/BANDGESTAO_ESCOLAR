-- =====================================================================
-- 0018 — Cópia de segurança DIÁRIA e agendada para a nuvem DA ESCOLA (Google Drive, Backblaze B2, Wasabi, R2, S3…)
-- Cada escola liga a SUA conta. Só os dados daquela escola são copiados (app.school_backup_build(escola), migração 0016).
-- Quem trabalha é a Edge Function `school-backups` (agendador de 15 em 15 min; ver docs/BACKUP_EXTERNO.md).
-- Segurança: credenciais cifradas pela função (chave BACKUP_SECRETS_KEY fora da BD); estas tabelas não têm acesso para
-- anon/authenticated; o administrador lê o estado por public.school_backup_destination_status() (sem segredos).
-- =====================================================================

create table if not exists public.school_backup_destinations (
  institution_id    text primary key references public.institutions(id) on delete cascade,
  provider          text not null check (provider in ('s3', 'gdrive')),
  enabled           boolean not null default false,
  run_hour          int  not null default 23 check (run_hour between 0 and 23),               -- hora de Angola (WAT)
  retention_days    int  not null default 30 check (retention_days = 0 or retention_days between 7 and 3650), -- 0 = nunca apagar
  config            jsonb not null default '{}'::jsonb,   -- NÃO secreto: endpoint, região, bucket, pasta; conta Google, id da pasta
  secret_enc        text,                                 -- cifrado pela Edge Function
  last_attempt_at   timestamptz,
  last_success_at   timestamptz,
  last_scheduled_on date,                                 -- dia (WAT) do último backup AGENDADO bem sucedido
  last_status       text check (last_status in ('ok', 'error')),
  last_error        text,
  last_file         text,
  last_size         bigint,
  attempts_day      date,
  attempts_today    int not null default 0,
  running_since     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.school_backup_runs (
  id              bigint generated always as identity primary key,
  institution_id  text not null references public.institutions(id) on delete cascade,
  at              timestamptz not null default now(),
  trigger         text not null check (trigger in ('agendado', 'manual', 'teste')),
  ok              boolean not null,
  provider        text,
  file            text,
  size            bigint,
  error           text
);
create index if not exists school_backup_runs_idx on public.school_backup_runs (institution_id, at desc);

alter table public.school_backup_destinations enable row level security;   -- sem políticas: só service_role
alter table public.school_backup_runs         enable row level security;
revoke all on public.school_backup_destinations, public.school_backup_runs from anon, authenticated;

create or replace function public.school_backup_destination_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); d record; runs jsonb;
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola vê a cópia para a nuvem' using errcode = '42501';
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

-- ---------- Só service_role ----------
create or replace function public.school_backup_export_service(p_inst text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_inst is null or not exists (select 1 from public.institutions where id = p_inst) then
    raise exception 'Escola inexistente' using errcode = '22023';
  end if;
  return app.school_backup_build(p_inst);
end $$;

-- Reserva as escolas com backup DEVIDO (hora de Angola): activas, ligadas, com credenciais, sem backup agendado hoje,
-- no máximo 4 tentativas/dia espaçadas 55 min, sem outra execução em curso. SKIP LOCKED: dois agendadores nunca duplicam.
create or replace function public.backup_claim_due(p_limit int default 3)
returns table (inst text, prov text, cfg jsonb, secret text, keep_days int, school text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  local_now timestamp := now() at time zone 'Africa/Luanda';
  today date := (now() at time zone 'Africa/Luanda')::date;
begin
  return query
  with due as (
    select d.institution_id as iid
      from public.school_backup_destinations d
      join public.institutions i on i.id = d.institution_id
     where d.enabled and d.secret_enc is not null and i.status = 'active'
       and extract(hour from local_now)::int >= d.run_hour
       and coalesce(d.last_scheduled_on, date '1970-01-01') < today
       and (case when d.attempts_day = today then d.attempts_today else 0 end) < 4
       and (d.last_attempt_at is null or d.last_attempt_at < now() - interval '55 minutes')
       and (d.running_since is null or d.running_since < now() - interval '30 minutes')
     order by d.last_scheduled_on nulls first, d.institution_id
       for update of d skip locked
     limit least(greatest(p_limit, 1), 20)
  ), upd as (
    update public.school_backup_destinations d
       set running_since = now(), last_attempt_at = now(), updated_at = now(),
           attempts_today = (case when d.attempts_day = today then d.attempts_today else 0 end) + 1,
           attempts_day = today
      from due where d.institution_id = due.iid
    returning d.institution_id, d.provider, d.config, d.secret_enc, d.retention_days
  )
  select u.institution_id, u.provider, u.config, u.secret_enc, u.retention_days, i.name
    from upd u join public.institutions i on i.id = u.institution_id;
end $$;

-- "Fazer backup agora" / "Testar": ignora a hora; recusa se já estiver a correr ou houve tentativa há < 1 min.
create or replace function public.backup_claim_one(p_inst text)
returns table (inst text, prov text, cfg jsonb, secret text, keep_days int, school text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with one as (
    select d.institution_id as iid from public.school_backup_destinations d
     where d.institution_id = p_inst and d.secret_enc is not null
       and (d.running_since is null or d.running_since < now() - interval '30 minutes')
       and (d.last_attempt_at is null or d.last_attempt_at < now() - interval '1 minute')
       for update skip locked
  ), upd as (
    update public.school_backup_destinations d set running_since = now(), last_attempt_at = now(), updated_at = now()
      from one where d.institution_id = one.iid
    returning d.institution_id, d.provider, d.config, d.secret_enc, d.retention_days
  )
  select u.institution_id, u.provider, u.config, u.secret_enc, u.retention_days, i.name
    from upd u join public.institutions i on i.id = u.institution_id;
end $$;

-- Resultado: actualiza o estado, regista no histórico (últimas 60) e na auditoria. 'teste' não conta como backup do dia.
create or replace function public.backup_finish(p_inst text, p_trigger text, p_ok boolean, p_provider text, p_file text, p_size bigint, p_error text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare today date := (now() at time zone 'Africa/Luanda')::date;
begin
  if p_trigger not in ('agendado', 'manual', 'teste') then raise exception 'trigger inválido'; end if;
  update public.school_backup_destinations d set
      running_since = null, updated_at = now(),
      last_status = case when p_ok then 'ok' else 'error' end,
      last_error = case when p_ok then null else left(p_error, 500) end,
      last_success_at = case when p_ok and p_trigger <> 'teste' then now() else d.last_success_at end,
      last_scheduled_on = case when p_ok and p_trigger = 'agendado' then today else d.last_scheduled_on end,
      last_file = case when p_ok and p_trigger <> 'teste' then p_file else d.last_file end,
      last_size = case when p_ok and p_trigger <> 'teste' then p_size else d.last_size end
    where d.institution_id = p_inst;
  insert into public.school_backup_runs (institution_id, trigger, ok, provider, file, size, error)
    values (p_inst, p_trigger, p_ok, p_provider, p_file, p_size, left(p_error, 500));
  delete from public.school_backup_runs r where r.institution_id = p_inst
    and r.id not in (select id from public.school_backup_runs where institution_id = p_inst order by at desc, id desc limit 60);
  perform app.write_audit(p_inst, 'RPC:school_backup_external', 'school', p_inst,
    jsonb_build_object('trigger', p_trigger, 'ok', p_ok, 'provider', p_provider, 'file', p_file, 'size', p_size, 'error', left(p_error, 200)));
end $$;

revoke all on function public.school_backup_export_service(text), public.backup_claim_due(int), public.backup_claim_one(text),
  public.backup_finish(text, text, boolean, text, text, bigint, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.school_backup_export_service(text), public.backup_claim_due(int), public.backup_claim_one(text),
      public.backup_finish(text, text, boolean, text, text, bigint, text) to service_role;
    grant select, insert, update, delete on public.school_backup_destinations, public.school_backup_runs to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
