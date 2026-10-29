-- =====================================================================
-- 0045: palavra-passe temporária e validade, decididas NO SERVIDOR
-- Antes: o administrador criava a conta com uma palavra-passe escolhida por ele e nada obrigava a trocá-la; a validade
-- (90 dias) só existia no navegador e nunca chegava a funcionar (o campo passwordUpdatedAt nunca era gravado).
-- Agora:
--  • contas criadas pelo administrador entram com must_change_password = true: até definirem a sua palavra-passe a RLS
--    recusa todos os dados (a mudança de palavra-passe em si faz-se no Auth, que continua acessível);
--  • password_changed_at é gravado por um trigger em auth.users, por isso só muda quando a palavra-passe muda de facto
--    (o utilizador não o consegue forjar); a validade (institutions.password_max_age_days) é aplicada pela RLS;
--  • o administrador pode obrigar uma conta a trocar a palavra-passe (admin_force_password_change).
-- Alunos e encarregados nunca expiram por idade (só precisam de trocar a temporária).
-- =====================================================================
alter table public.profiles
  add column if not exists must_change_password boolean     not null default false,
  add column if not exists password_changed_at  timestamptz not null default now();
alter table public.institutions
  add column if not exists password_max_age_days integer not null default 0
  check (password_max_age_days = 0 or password_max_age_days between 30 and 365);

-- ---------- grava a mudança real da palavra-passe ----------
create or replace function app.on_password_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set password_changed_at = now(), must_change_password = false where id = new.id;
  end if;
  return new;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    drop trigger if exists on_auth_password_changed on auth.users;
    create trigger on_auth_password_changed after update of encrypted_password on auth.users
      for each row execute function app.on_password_changed();
  end if;
end $$;

-- ---------- o cliente não pode mexer nestes campos ----------
create or replace function app.guard_password_columns() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;                                   -- servidor (Edge Functions, trigger do Auth)
  if (new.must_change_password is distinct from old.must_change_password or new.password_changed_at is distinct from old.password_changed_at)
     and coalesce(current_setting('app.pw_rpc', true), '') <> '1' then
    raise exception 'Campos de palavra-passe só mudam pelo servidor' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_pw_guard on public.profiles;
create trigger profiles_pw_guard before update on public.profiles
  for each row execute function app.guard_password_columns();

-- ---------- critério: este utilizador pode usar os dados? ----------
create or replace function app.password_ok(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select not p.must_change_password
           and not (coalesce(m.password_max_age_days, i.password_max_age_days) > 0
                    and p.role not in ('aluno', 'encarregado')
                    and p.password_changed_at < now() - make_interval(days => coalesce(m.password_max_age_days, i.password_max_age_days)))
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
    left join public.institutions m on m.id = i.parent_id
    where p.id = p_uid and p.active
  ), true)        -- sem perfil (ex.: super admin da plataforma): este critério não se aplica
$$;
revoke all on function app.password_ok(uuid) from public, anon, authenticated;

-- ---------- ponto único de aplicação (junto do bloqueio de IP) ----------
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id
  from public.institutions i
  left join public.institutions m on m.id = i.parent_id
  where i.id = app.active_institution_id()
    and i.status = 'active'
    and (m.id is null or m.status = 'active')
    and app.plan_active(coalesce(i.parent_id, i.id))
    and (cardinality(coalesce(nullif(i.allowed_ip_ranges, '{}'), m.allowed_ip_ranges, '{}')) = 0 or app.ip_allowed(i.id))
    and app.password_ok(auth.uid())
$$;

-- Edge Functions: mesmo critério (IP + palavra-passe). O nome mantém-se para não mexer nas funções já publicadas.
create or replace function public.edge_ip_allowed(p_uid uuid, p_ip text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.ip_check(p_uid, coalesce(app.active_institution_of(p_uid), (select institution_id from public.profiles where id = p_uid)), p_ip)
         and app.password_ok(p_uid)
$$;
revoke all on function public.edge_ip_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public.edge_ip_allowed(uuid, text) to service_role;

-- ---------- a app pergunta o estado (não depende de current_institution, que já devolveria null) ----------
create or replace function public.password_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_build_object(
      'must_change', p.must_change_password,
      'max_age', coalesce(m.password_max_age_days, i.password_max_age_days),
      'changed_at', p.password_changed_at,
      'expired', (coalesce(m.password_max_age_days, i.password_max_age_days) > 0 and p.role not in ('aluno', 'encarregado')
                  and p.password_changed_at < now() - make_interval(days => coalesce(m.password_max_age_days, i.password_max_age_days))),
      'days_left', case when coalesce(m.password_max_age_days, i.password_max_age_days) > 0 and p.role not in ('aluno', 'encarregado')
                        then coalesce(m.password_max_age_days, i.password_max_age_days) - floor(extract(epoch from (now() - p.password_changed_at)) / 86400)::int
                        else null end)
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
    left join public.institutions m on m.id = i.parent_id
    where p.id = auth.uid() and p.active
  ), jsonb_build_object('must_change', false, 'expired', false, 'max_age', 0, 'days_left', null))
$$;
revoke all on function public.password_status() from public, anon;
grant execute on function public.password_status() to authenticated;

-- ---------- validade: só o administrador da escola (0 = nunca expira; senão 30 a 365 dias) ----------
create or replace function public.set_password_policy(p_days integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); root text;
begin
  if inst is null or app.current_role() <> 'admin' then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if p_days is null or not (p_days = 0 or p_days between 30 and 365) then
    raise exception 'Validade: 0 (nunca) ou entre 30 e 365 dias' using errcode = '22023';
  end if;
  select coalesce(parent_id, id) into root from public.institutions where id = inst;   -- a política é da escola mãe (filiais herdam)
  update public.institutions set password_max_age_days = p_days where id = root;
  perform app.write_audit(inst, 'RPC:set_password_policy', 'institutions', root, jsonb_build_object('dias', p_days));
end $$;
revoke all on function public.set_password_policy(integer) from public, anon;
grant execute on function public.set_password_policy(integer) to authenticated;

-- ---------- obrigar uma conta a trocar a palavra-passe no próximo acesso ----------
create or replace function public.admin_force_password_change(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution();
begin
  if inst is null or app.current_role() <> 'admin' then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Use a opção de alterar a sua própria palavra-passe' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user and institution_id = inst) then
    raise exception 'Utilizador de outra escola' using errcode = '42501';
  end if;
  perform set_config('app.pw_rpc', '1', true);
  update public.profiles set must_change_password = true where id = p_user;
  perform app.write_audit(inst, 'RPC:admin_force_password_change', 'profiles', p_user::text, null);
end $$;
revoke all on function public.admin_force_password_change(uuid) from public, anon;
grant execute on function public.admin_force_password_change(uuid) to authenticated;
