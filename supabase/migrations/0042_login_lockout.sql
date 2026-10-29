-- =====================================================================
-- 0042: bloqueio de login NO SERVIDOR (anti-força-bruta real)
-- O contador antigo vivia no localStorage e era contornável. Agora quem decide é o
-- "Password Verification Hook" do Supabase Auth (corre dentro do GoTrue: não há forma de
-- o contornar chamando /auth/v1/token directamente).
-- Activação: supabase/config.toml ([auth.hook.password_verification_attempt]) ou, no painel,
-- Authentication → Hooks → "Password verification attempt" → Postgres function
-- public.hook_password_verification_attempt. (Pode exigir plano Pro/Teams: confirme no painel.)
-- Regras: 5 falhas seguidas → bloqueio 15 min (mesmo com a palavra-passe certa durante o bloqueio).
-- =====================================================================
create table if not exists public.login_attempts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  failed_count   integer     not null default 0,
  last_failed_at timestamptz,
  locked_until   timestamptz,
  lock_count     integer     not null default 0,   -- nº de bloqueios (reincidentes ficam mais tempo)
  updated_at     timestamptz not null default now()
);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated, public;
-- sem políticas: o cliente nunca lê nem escreve; só o hook (security definer) e service_role.

create or replace function public.hook_password_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := nullif(event ->> 'user_id', '')::uuid;
  valid boolean := coalesce((event ->> 'valid')::boolean, false);
  max_fail constant integer := 5;
  base_lock constant interval := interval '15 minutes';
  rec public.login_attempts;
  mins integer;
  inst text;
begin
  if uid is null then return jsonb_build_object('decision', 'continue'); end if;

  insert into public.login_attempts(user_id) values (uid) on conflict (user_id) do nothing;
  select * into rec from public.login_attempts where user_id = uid for update;

  -- Já bloqueado: recusa SEMPRE (mesmo com a palavra-passe certa), sem somar mais falhas.
  if rec.locked_until is not null and rec.locked_until > now() then
    mins := greatest(1, ceil(extract(epoch from (rec.locked_until - now())) / 60)::integer);
    return jsonb_build_object('decision', 'reject',
      'message', format('Conta temporariamente bloqueada por tentativas falhadas. Tente novamente dentro de %s minuto(s).', mins));
  end if;

  if valid then
    update public.login_attempts set failed_count = 0, locked_until = null, updated_at = now() where user_id = uid;
    return jsonb_build_object('decision', 'continue');
  end if;

  -- Falha: as falhas antigas (> 1 h) deixam de contar.
  if rec.last_failed_at is null or rec.last_failed_at < now() - interval '1 hour' then rec.failed_count := 0; end if;
  rec.failed_count := rec.failed_count + 1;

  if rec.failed_count >= max_fail then
    -- reincidência: 15, 30, 60 min … (máx. 24 h)
    update public.login_attempts
       set failed_count = 0, last_failed_at = now(), lock_count = lock_count + 1, updated_at = now(),
           locked_until = now() + least(base_lock * power(2, least(lock_count, 7))::integer, interval '24 hours')
     where user_id = uid;
    begin
      select institution_id into inst from public.profiles where id = uid;
      if inst is not null then
        perform app.write_audit(inst, 'LOGIN_BLOQUEADO', 'auth', uid::text, jsonb_build_object('falhas', max_fail));
      end if;
    exception when others then null;   -- a auditoria nunca pode impedir o bloqueio
    end;
    return jsonb_build_object('decision', 'reject',
      'message', 'Conta temporariamente bloqueada por tentativas falhadas. Tente novamente dentro de 15 minuto(s).');
  end if;

  update public.login_attempts set failed_count = rec.failed_count, last_failed_at = now(), updated_at = now() where user_id = uid;
  return jsonb_build_object('decision', 'continue');
end $$;

-- Só o GoTrue (supabase_auth_admin) pode chamar o hook. No Postgres local de testes o papel não existe.
revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
    grant select, insert, update on public.login_attempts to supabase_auth_admin;
  end if;
end $$;

-- O administrador da escola desbloqueia um utilizador da SUA escola (ex.: professor que se enganou).
create or replace function public.admin_unlock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution();
begin
  if app.current_role() <> 'admin' and not app.is_platform_admin() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if not app.is_platform_admin()
     and not exists (select 1 from public.profiles where id = p_user and institution_id = inst) then
    raise exception 'Utilizador de outra escola' using errcode = '42501';
  end if;
  update public.login_attempts set failed_count = 0, locked_until = null, updated_at = now() where user_id = p_user;
  perform app.write_audit(coalesce(inst, (select institution_id from public.profiles where id = p_user)),
                          'RPC:admin_unlock_user', 'auth', p_user::text, null);
end $$;
revoke all on function public.admin_unlock_user(uuid) from public, anon;
grant execute on function public.admin_unlock_user(uuid) to authenticated;

-- Estado de bloqueio visível ao administrador da escola (para mostrar "bloqueado" na lista de utilizadores).
create or replace function public.locked_users() returns table(user_id uuid, locked_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id, a.locked_until from public.login_attempts a
  join public.profiles p on p.id = a.user_id
  where a.locked_until > now() and app.current_role() = 'admin' and p.institution_id = app.current_institution()
$$;
revoke all on function public.locked_users() from public, anon;
grant execute on function public.locked_users() to authenticated;
