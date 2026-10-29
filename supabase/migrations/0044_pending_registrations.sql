-- Passo 6: registo de escolas com verificação de e-mail.
-- Ao registar-se, a pessoa só fica com uma conta de acesso POR CONFIRMAR (auth.users sem e-mail confirmado) e uma linha aqui.
-- A escola e o administrador (institutions/profiles) só são criados quando o link do e-mail é aberto (função complete-registration).
-- Sem confirmação em 48 horas, tudo é apagado (purge_expired_registrations).

create table if not exists public.pending_registrations (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  school_name        text not null check (char_length(school_name) between 3 and 200),
  nif                text,
  admin_name         text not null,
  username           text,
  settings           jsonb not null default '{}'::jsonb,
  terms_version      text not null check (terms_version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'),
  terms_accepted_at  timestamptz not null default now(),
  ip                 text,
  user_agent         text,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default (now() + interval '48 hours')
);
create index if not exists pending_registrations_email on public.pending_registrations (lower(email));
create index if not exists pending_registrations_ip on public.pending_registrations (ip, created_at desc);

alter table public.pending_registrations enable row level security;   -- sem políticas: só service_role / funções
revoke all on public.pending_registrations from anon, authenticated;

-- Apaga registos não confirmados e expirados, e a conta de acesso por confirmar (o ON DELETE CASCADE limpa a linha).
create or replace function public.purge_expired_registrations() returns integer
language plpgsql security definer set search_path = public, auth as $$
declare n integer;
begin
  with gone as (
    delete from auth.users u
     using public.pending_registrations p
     where p.user_id = u.id and p.expires_at < now() and u.email_confirmed_at is null
    returning u.id)
  select count(*) into n from gone;
  -- linhas órfãs (conta já confirmada ou apagada)
  delete from public.pending_registrations p
   where p.expires_at < now() - interval '7 days';
  return coalesce(n, 0);
end $$;
revoke all on function public.purge_expired_registrations() from public, anon, authenticated;
grant execute on function public.purge_expired_registrations() to service_role;

-- Limpeza automática de hora a hora, se a extensão pg_cron existir (no Supabase Cloud: Database → Extensions → pg_cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-registrations') where exists (select 1 from cron.job where jobname = 'purge-expired-registrations');
    perform cron.schedule('purge-expired-registrations', '17 * * * *', 'select public.purge_expired_registrations()');
  end if;
exception when others then
  raise notice 'pg_cron não configurado: agende public.purge_expired_registrations() manualmente (%).', sqlerrm;
end $$;
