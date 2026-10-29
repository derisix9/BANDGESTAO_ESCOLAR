-- =====================================================================
-- BandMed / EduGest — 0001: núcleo multi-escola
-- Uma única base de dados, `institution_id` em todas as tabelas, RLS ligada.
-- Ninguém se torna administrador por si próprio: perfis só são criados
-- pelo servidor (Edge Function com service_role). O registo aberto de
-- utilizadores deve estar DESLIGADO em Auth > Providers (ver config.toml).
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists app;

-- ---------- Escolas ----------
create table public.institutions (
  id            text primary key check (id ~ '^[a-z0-9_]{3,64}$'),
  name          text not null,
  nif           text,                       -- NUNCA há NIF por defeito
  status        text not null default 'active' check (status in ('active','suspended','archived')),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------- Perfis (1:1 com auth.users) ----------
create table public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  institution_id         text not null references public.institutions(id) on delete restrict,
  role                   text not null check (role in
                           ('admin','director','secretaria','professor','financeiro','funcionario','aluno','encarregado')),
  name                   text not null,
  email                  text not null,
  phone                  text,
  active                 boolean not null default true,
  linked_student_id      text,
  linked_teacher_id      text,
  linked_funcionario_id  text,
  data                   jsonb not null default '{}'::jsonb,   -- campos de apresentação (avatar, etc.)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index profiles_inst_role_idx on public.profiles (institution_id, role);

-- Super-administradores da PLATAFORMA (equipa BandMed). Separado dos perfis das escolas:
-- nenhuma escola é "super-inquilino".
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Acesso personalizado por utilizador (substitui `access_control` do Firebase).
-- sections = {"propinas": {"enabled": true, "mode": "write"}, ...}
create table public.user_access (
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  sections       jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (institution_id, user_id)
);

-- ---------- Funções auxiliares (security definer → evitam recursão de RLS) ----------
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select institution_id from public.profiles where id = auth.uid() and active
$$;

create or replace function app.current_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function app.is_staff_manager() returns boolean   -- admin/director/secretaria/financeiro
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_role() in ('admin','director','secretaria','financeiro'), false)
$$;

-- ---------- RLS: instituições ----------
alter table public.institutions   enable row level security;
alter table public.profiles       enable row level security;
alter table public.platform_admins enable row level security;
alter table public.user_access    enable row level security;

create policy inst_select on public.institutions for select to authenticated
  using (id = app.current_institution() or app.is_platform_admin());
create policy inst_update_admin on public.institutions for update to authenticated
  using (id = app.current_institution() and app.current_role() = 'admin')
  with check (id = app.current_institution());
-- INSERT/DELETE de escolas: só service_role (Edge Function `register-institution`).

-- ---------- RLS: perfis ----------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (institution_id = app.current_institution()
        and app.current_role() in ('admin','director','secretaria','professor','financeiro'))
    or app.is_platform_admin()
  );
-- SEM política de INSERT: ninguém cria perfis pelo cliente (corrige o buraco "auto-promoção a admin").
-- UPDATE: o próprio só altera campos de apresentação (trigger abaixo); o admin gere a sua escola.
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (institution_id = app.current_institution() and app.current_role() = 'admin')
  with check (institution_id = app.current_institution());
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (institution_id = app.current_institution() and app.current_role() = 'admin' and id <> auth.uid());

-- Trava de escalada de privilégios: nem o próprio nem outro admin altera escola/papel de forma ilícita.
create or replace function app.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare caller_role text := app.current_role();
begin
  if auth.uid() is null then
    return new;                                    -- service_role / ligação directa (servidor)
  end if;
  if new.institution_id is distinct from old.institution_id then
    raise exception 'institution_id é imutável' using errcode = '42501';
  end if;
  if new.id = auth.uid() and caller_role is distinct from 'admin' then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.linked_student_id is distinct from old.linked_student_id
       or new.linked_teacher_id is distinct from old.linked_teacher_id
       or new.linked_funcionario_id is distinct from old.linked_funcionario_id then
      raise exception 'Sem permissão para alterar papel, estado ou ligações' using errcode = '42501';
    end if;
  end if;
  if new.id = auth.uid() and caller_role = 'admin'
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'Um administrador não pode alterar o seu próprio papel/estado' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- ---------- RLS: acesso personalizado ----------
create policy ua_select on public.user_access for select to authenticated
  using (user_id = auth.uid()
         or (institution_id = app.current_institution() and app.current_role() = 'admin'));
create policy ua_write_admin on public.user_access for all to authenticated
  using (institution_id = app.current_institution() and app.current_role() = 'admin')
  with check (institution_id = app.current_institution() and app.current_role() = 'admin');

-- platform_admins: sem políticas → inacessível ao cliente (só service_role).

-- Permissões base. O que não tem política fica fechado.
revoke all on all tables in schema public from anon;
grant usage on schema app to authenticated;
grant select, update, delete on public.profiles to authenticated;
grant select, update on public.institutions to authenticated;
grant select, insert, update, delete on public.user_access to authenticated;
