-- 0046 — Registo de escolas pelo Supabase Auth NATIVO (substitui o passo 6 / migração 0044).
--
-- Fluxo:  signUp() no cliente (com captcha do Auth)  →  e-mail "Confirm signup" enviado pelo próprio Supabase
--         →  a pessoa abre o link  →  a app chama public.complete_registration(), que SÓ com o e-mail confirmado
--         cria a escola e o administrador  →  a app mostra a caixa verde "escola criada" e leva ao início de sessão.
-- Sem Edge Functions, sem tabela de pedidos pendentes, sem serviço de e-mail próprio. Os dados da escola viajam em
-- auth.users.raw_user_meta_data (a palavra-passe fica só no hash do Auth).
-- Pré-requisitos no painel: Authentication → Providers → Email → "Confirm email" LIGADO e registo ("Allow new users to sign up") LIGADO.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Limpeza do desenho anterior (pedidos pendentes + cron). Nada disto é preciso agora.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-registrations') where exists (select 1 from cron.job where jobname = 'purge-expired-registrations');
  end if;
exception when others then
  raise notice 'pg_cron: nada a desagendar (%).', sqlerrm;
end $$;
drop function if exists public.purge_expired_registrations();
drop table if exists public.pending_registrations;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) E-mails temporários (Yopmail, 10minutemail...) são recusados ANTES de a conta ser criada.
--    O Auth devolve "Database error saving new user"; a app traduz isso para uma mensagem clara.
--    A lista é uma tabela: para bloquear mais um domínio basta  insert into public.disposable_email_domains values ('x.com');
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.disposable_email_domains (domain text primary key check (domain = lower(domain)));
alter table public.disposable_email_domains enable row level security;     -- sem políticas: só o servidor lê
revoke all on public.disposable_email_domains from anon, authenticated;

insert into public.disposable_email_domains (domain) values
  ('yopmail.com'), ('yopmail.fr'), ('10minutemail.com'), ('10minutemail.net'), ('tempmail.com'), ('temp-mail.org'),
  ('mailinator.com'), ('sharklasers.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'),
  ('grr.la'), ('getnada.com'), ('trashmail.com'), ('throwawaymail.com'), ('dispostable.com'), ('maildrop.cc'),
  ('fakeinbox.com'), ('mailnesia.com'), ('mintemail.com'), ('tempr.email'), ('discard.email'), ('spamgourmet.com'),
  ('mohmal.com'), ('emailondeck.com'), ('burnermail.io'), ('tempail.com'), ('moakt.com'), ('mytemp.email')
on conflict do nothing;

create or replace function public.check_disposable_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := lower(split_part(coalesce(new.email, ''), '@', 2));
begin
  -- o domínio exato ou qualquer subdomínio dele (x.yopmail.com)
  if d <> '' and exists (select 1 from public.disposable_email_domains b where d = b.domain or d like '%.' || b.domain) then
    raise exception 'Registo recusado: e-mails temporários não são permitidos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.check_disposable_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_check on auth.users;
create trigger on_auth_user_created_check before insert on auth.users
  for each row execute function public.check_disposable_email();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Criação da escola DEPOIS de confirmar o e-mail. Idempotente: repetir a chamada não duplica nada.
--    Devolve: { done, created, institutionId, schoolName, nif, adminName, username, email, settings }  ou null se não há registo pendente.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.complete_registration() returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  uid     uuid := auth.uid();
  u       record;
  m       jsonb;
  inst    text;
  slug    text;
  sname   text;
  aname   text;
  tver    text;
  tat     timestamptz;
  hdr     jsonb;
  v_ip    text;
  v_ua    text;
begin
  if uid is null then raise exception 'Sem sessão' using errcode = '28000'; end if;
  select id, email, email_confirmed_at, raw_user_meta_data into u from auth.users where id = uid;
  if not found then raise exception 'Sem sessão' using errcode = '28000'; end if;
  if u.email_confirmed_at is null then
    raise exception 'Confirme primeiro o e-mail pelo link que enviámos.' using errcode = '42501';
  end if;

  select institution_id into inst from public.profiles where id = uid;
  if found then return jsonb_build_object('done', true, 'created', false, 'institutionId', inst); end if;

  m := coalesce(u.raw_user_meta_data, '{}'::jsonb);
  if m ->> 'registration' is distinct from 'school' then return null; end if;     -- esta conta não veio do registo de escolas

  sname := btrim(coalesce(m ->> 'school_name', ''));
  aname := btrim(coalesce(m ->> 'admin_name', ''));
  tver  := coalesce(m ->> 'terms_version', '');
  if char_length(sname) not between 3 and 200 then raise exception 'Nome da escola inválido.' using errcode = '22023'; end if;
  if char_length(aname) not between 2 and 200 then raise exception 'Nome do administrador inválido.' using errcode = '22023'; end if;
  if tver !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$' then raise exception 'Versão dos termos inválida.' using errcode = '22023'; end if;
  begin tat := (m ->> 'terms_accepted_at')::timestamptz; exception when others then tat := null; end;
  if tat is null or tat > now() then tat := now(); end if;

  slug := 'inst_' || left(trim(both '_' from regexp_replace(
            translate(lower(sname), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', '_', 'g')), 40)
          || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  begin hdr := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb); exception when others then hdr := '{}'::jsonb; end;
  v_ip := nullif(btrim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-forwarded-for', ''), ',', 1)), '');
  v_ua := left(hdr ->> 'user-agent', 300);

  insert into public.institutions (id, name, nif, plan_status, trial_ends_at, terms_version, terms_accepted_at)
  values (slug, sname, nullif(btrim(coalesce(m ->> 'nif', '')), ''), 'trial', now() + interval '30 days', tver, tat);

  insert into public.profiles (id, institution_id, role, is_founder, name, email, data)
  values (uid, slug, 'admin', true, aname, u.email,
          jsonb_build_object('roleTitle', 'Administrador Geral')
          || case when coalesce(m ->> 'username', '') <> '' then jsonb_build_object('username', left(m ->> 'username', 60)) else '{}'::jsonb end);

  insert into public.institution_terms_acceptances (institution_id, user_id, version, accepted_at, ip, user_agent)
  values (slug, uid, tver, tat, v_ip, v_ua);

  -- Os dados do registo já não são precisos na conta.
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'registration' - 'school_name' - 'nif' - 'admin_name'
                                              - 'username' - 'terms_version' - 'terms_accepted_at' - 'settings'
   where id = uid;

  return jsonb_build_object('done', true, 'created', true, 'institutionId', slug, 'schoolName', sname,
    'nif', nullif(btrim(coalesce(m ->> 'nif', '')), ''), 'adminName', aname, 'username', nullif(m ->> 'username', ''),
    'email', u.email, 'settings', coalesce(m -> 'settings', '{}'::jsonb));
end $$;
revoke all on function public.complete_registration() from public, anon;
grant execute on function public.complete_registration() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4) Limpeza opcional: contas de registo de escola nunca confirmadas (o Supabase não as apaga sozinho).
--    Agendada de hora a hora só se o pg_cron existir; senão corra à mão:  select public.purge_unconfirmed_signups(7);
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.purge_unconfirmed_signups(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n integer;
begin
  with gone as (
    delete from auth.users u
     where u.email_confirmed_at is null
       and u.raw_user_meta_data ->> 'registration' = 'school'
       and u.created_at < now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
       and not exists (select 1 from public.profiles p where p.id = u.id)
    returning u.id)
  select count(*) into n from gone;
  return coalesce(n, 0);
end $$;
revoke all on function public.purge_unconfirmed_signups(integer) from public, anon, authenticated;
grant execute on function public.purge_unconfirmed_signups(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-unconfirmed-signups') where exists (select 1 from cron.job where jobname = 'purge-unconfirmed-signups');
    perform cron.schedule('purge-unconfirmed-signups', '23 3 * * *', 'select public.purge_unconfirmed_signups(7)');
  end if;
exception when others then
  raise notice 'pg_cron não configurado: agende public.purge_unconfirmed_signups() manualmente (%).', sqlerrm;
end $$;
