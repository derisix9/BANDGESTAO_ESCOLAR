-- 0047 — Monitorização de erros do cliente (browser) e falhas de sincronização.
--
-- O navegador chama public.report_client_error(jsonb) quando há um erro não tratado, uma falha de renderização
-- (ErrorBoundary) ou falhas repetidas de sincronização. O servidor:
--   • deduz a escola e o utilizador do JWT (o cliente NÃO os indica);
--   • trunca tudo (mensagem, stack, URL), para ninguém encher a tabela com lixo;
--   • agrupa por "impressão digital": o mesmo erro, na mesma escola, na mesma hora, é UMA linha com contador;
--   • limita o nº de erros distintos por escola e por hora (anti-inundação);
--   • apaga o que tem mais de 30 dias.
-- Só administradores da plataforma (public.platform_admins) leem. Nenhuma escola vê erros de outra, nem os seus.

create table if not exists public.client_errors (
  id            bigint generated always as identity primary key,
  institution_id text,
  user_id       uuid,
  role          text,
  kind          text not null check (kind in ('error','unhandledrejection','react','sync','other')),
  message       text not null,
  stack         text,
  url           text,
  user_agent    text,
  app_version   text,
  fingerprint   text not null,
  occurrences   integer not null default 1,
  context       jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists client_errors_last_seen_idx on public.client_errors (last_seen_at desc);
create index if not exists client_errors_fp_idx on public.client_errors (fingerprint, institution_id, last_seen_at desc);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
-- Só administradores da plataforma leem (e apagam). Ninguém escreve directamente: só a função abaixo.
drop policy if exists client_errors_platform_read on public.client_errors;
create policy client_errors_platform_read on public.client_errors for select to authenticated
  using (app.is_platform_admin());
grant select on public.client_errors to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Entrada: um erro por chamada. Nunca lança erro ao cliente (um relatório de erros não pode causar mais erros).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.report_client_error(p jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inst  text;
  v_role  text;
  v_kind  text := coalesce(nullif(p ->> 'kind', ''), 'other');
  v_msg   text := left(coalesce(p ->> 'message', ''), 500);
  v_stack text := left(p ->> 'stack', 4000);
  v_url   text := left(p ->> 'url', 300);
  v_ua    text := left(p ->> 'userAgent', 300);
  v_ver   text := left(p ->> 'appVersion', 40);
  v_ctx   jsonb := '{}'::jsonb;
  v_fp    text := left(coalesce(nullif(p ->> 'fingerprint', ''), md5(v_msg)), 64);
  v_id    bigint;
  v_recent integer;
begin
  if auth.uid() is null or v_msg = '' then return false; end if;
  if v_kind not in ('error','unhandledrejection','react','sync','other') then v_kind := 'other'; end if;
  if jsonb_typeof(p -> 'context') = 'object' and length((p -> 'context')::text) <= 2000 then v_ctx := p -> 'context'; end if;

  v_inst := app.current_institution();
  v_role := app.current_role();

  -- Mesmo erro, mesma escola, na última hora: só soma ao contador.
  select id into v_id from public.client_errors
   where fingerprint = v_fp and institution_id is not distinct from v_inst
     and last_seen_at > now() - interval '1 hour'
   order by last_seen_at desc limit 1;
  if v_id is not null then
    update public.client_errors set occurrences = occurrences + 1, last_seen_at = now() where id = v_id;
    return true;
  end if;

  -- Anti-inundação: no máximo 100 erros distintos por escola e por hora.
  select count(*) into v_recent from public.client_errors
   where institution_id is not distinct from v_inst and first_seen_at > now() - interval '1 hour';
  if v_recent >= 100 then return false; end if;

  insert into public.client_errors (institution_id, user_id, role, kind, message, stack, url, user_agent, app_version, fingerprint, context)
  values (v_inst, auth.uid(), v_role, v_kind, v_msg, v_stack, v_url, v_ua, v_ver, v_fp, v_ctx);

  -- Limpeza oportunista (1 em 50 chamadas): fora de 30 dias já não interessa.
  if random() < 0.02 then delete from public.client_errors where last_seen_at < now() - interval '30 days'; end if;
  return true;
exception when others then
  return false;
end $$;

revoke all on function public.report_client_error(jsonb) from public, anon;
grant execute on function public.report_client_error(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Resumo para a equipa da plataforma: os erros mais frequentes e as escolas mais afectadas.
-- Uso:  select * from public.platform_client_errors_summary(24);   -- últimas 24 horas
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.platform_client_errors_summary(p_hours integer default 24)
returns table (
  kind text, message text, fingerprint text, total_occurrences bigint, schools bigint, users bigint,
  app_versions text[], first_seen timestamptz, last_seen timestamptz, sample_url text, sample_stack text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select e.kind, min(e.message), e.fingerprint, sum(e.occurrences)::bigint,
         count(distinct e.institution_id), count(distinct e.user_id),
         array_remove(array_agg(distinct e.app_version), null),
         min(e.first_seen_at), max(e.last_seen_at),
         (array_agg(e.url order by e.last_seen_at desc))[1],
         (array_agg(e.stack order by e.last_seen_at desc))[1]
    from public.client_errors e
   where e.last_seen_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 30)))
   group by e.kind, e.fingerprint
   order by sum(e.occurrences) desc
   limit 100;
end $$;

revoke all on function public.platform_client_errors_summary(integer) from public, anon;
grant execute on function public.platform_client_errors_summary(integer) to authenticated;

-- Purga manual/agendada (service_role): select public.purge_client_errors(30);
create or replace function public.purge_client_errors(p_days integer default 30) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.client_errors where last_seen_at < now() - make_interval(days => greatest(1, coalesce(p_days, 30)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_client_errors(integer) from public, anon, authenticated;
grant execute on function public.purge_client_errors(integer) to service_role;
