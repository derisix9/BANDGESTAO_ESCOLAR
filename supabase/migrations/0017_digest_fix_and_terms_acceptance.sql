-- =====================================================================
-- 0017 — (1) Corrige "function digest(text, unknown) does not exist" ao descarregar o backup antes de eliminar
--        (2) Guarda a versão e a data de aceitação dos Termos e da Política de Privacidade, por escola
--
-- (1) CAUSA: school_delete_prepare/execute registam auditoria com public.write_audit_event_service (0009), cuja
--     search_path não incluía o schema `extensions` — no Supabase é lá que vive o pgcrypto (digest). Mesma falha da 0006.
-- (2) O registo da escola (Edge Function register-institution) grava a aceitação; fica na escola e num histórico só de
--     acrescentar. A escola não consegue alterar nem apagar estes campos.
-- Seguro de correr mais do que uma vez.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
alter function public.write_audit_event_service(text, uuid, text, text, text, jsonb) set search_path = public, extensions, pg_temp;

-- ---------- Aceitação dos termos ----------
alter table public.institutions
  add column if not exists terms_version     text,
  add column if not exists terms_accepted_at timestamptz;

create table if not exists public.institution_terms_acceptances (
  id             uuid primary key default gen_random_uuid(),
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  version        text not null check (version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'),
  accepted_at    timestamptz not null default now(),
  ip             text,
  user_agent     text
);
create index if not exists institution_terms_acceptances_inst on public.institution_terms_acceptances(institution_id, accepted_at desc);
alter table public.institution_terms_acceptances enable row level security;   -- sem políticas: só service_role / funções
revoke all on public.institution_terms_acceptances from anon, authenticated;

-- Só a plataforma mexe no plano e na aceitação (a escola tem UPDATE na sua linha, mas não nestes campos).
create or replace function app.guard_institution_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.plan_status is distinct from old.plan_status
          or new.trial_ends_at is distinct from old.trial_ends_at
          or new.paid_until is distinct from old.paid_until) then
    raise exception 'Só a equipa BandMed altera o plano' using errcode = '42501';
  end if;
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.terms_version is distinct from old.terms_version
          or new.terms_accepted_at is distinct from old.terms_accepted_at) then
    raise exception 'A aceitação dos termos só pode ser registada no registo da escola' using errcode = '42501';
  end if;
  return new;
end $$;

-- O administrador consulta a aceitação da sua escola.
create or replace function public.my_terms_acceptance() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('version', i.terms_version, 'acceptedAt', i.terms_accepted_at)
  from public.profiles p join public.institutions i on i.id = p.institution_id
  where p.id = auth.uid() and p.role = 'admin'
$$;
revoke all on function public.my_terms_acceptance() from public, anon;
grant execute on function public.my_terms_acceptance() to authenticated;

notify pgrst, 'reload schema';
