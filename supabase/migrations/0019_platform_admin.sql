-- =====================================================================
-- 0019: ADMIN MASTER DA PLATAFORMA (super admin BandMed)
--
-- O que esta migração cria:
--   1. Criação ÚNICA do super administrador: platform_claim_admin() só
--      funciona UMA vez (enquanto platform_admins estiver vazia) e só para
--      um utilizador que NÃO pertence a nenhuma escola. Depois disso,
--      novos admins só entram por SQL/service_role.
--   2. Tabelas comerciais da plataforma: planos de subscrição, pagamentos,
--      tickets de suporte e registo de auditoria da plataforma.
--   3. Ativação por escola: subsistemas (módulos do menu) e secções,
--      guardadas em school_feature_overrides e aplicadas no SERVIDOR
--      (RLS/can_access) — a escola não consegue contornar pela app.
--   4. Suspensão real da conta da escola: institutions.status passa a
--      bloquear o acesso em app.current_institution().
--   5. RPCs de gestão usadas pela app Admin Master.
--
-- Pré-requisito: migrações 0001–0018 aplicadas (usa app.is_platform_admin,
-- app.wipe_school_data, institutions.plan_status/trial_ends_at/paid_until).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Coluna extra: plano comercial da escola
-- ---------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  cycle        text not null default 'Mensal' check (cycle in ('Mensal','Trimestral','Semestral','Anual')),
  price_kz     numeric(14,2) not null default 0,
  max_students integer,
  max_users    integer,
  storage_gb   integer,
  trial_days   integer not null default 30,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.subscription_plans enable row level security;

alter table public.institutions
  add column if not exists plan_id uuid references public.subscription_plans(id) on delete set null,
  add column if not exists admin_notes text;

-- ---------------------------------------------------------------------
-- 1. Pagamentos de subscrição (receita da plataforma)
-- ---------------------------------------------------------------------
create table if not exists public.platform_payments (
  id             uuid primary key default gen_random_uuid(),
  institution_id text not null references public.institutions(id) on delete cascade,
  plan_id        uuid references public.subscription_plans(id) on delete set null,
  description    text not null,
  amount_kz      numeric(14,2) not null,
  method         text not null default 'Transferência',
  status         text not null default 'pendente' check (status in ('pago','pendente','anulado')),
  paid_at        timestamptz,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
alter table public.platform_payments enable row level security;
create index if not exists platform_payments_inst_idx on public.platform_payments (institution_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Tickets de suporte (gestão pela equipa BandMed)
-- ---------------------------------------------------------------------
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  institution_id text references public.institutions(id) on delete cascade,
  subject        text not null,
  message        text,
  priority       text not null default 'media' check (priority in ('baixa','media','alta')),
  status         text not null default 'aberto' check (status in ('aberto','em_curso','fechado')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.support_tickets enable row level security;

-- ---------------------------------------------------------------------
-- 3. Auditoria da plataforma (quem fez o quê no Admin Master)
-- ---------------------------------------------------------------------
create table if not exists public.platform_audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid references auth.users(id),
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.platform_audit_log enable row level security;

-- ---------------------------------------------------------------------
-- 4. Ativação por escola: subsistemas (módulos) e secções bloqueadas.
--    Formato: {"tesouraria": true} em blocked_modules,
--             {"propinas": true, "pautas": true} em blocked_sections.
--    Ausência da chave = permitido. A chave "geral"/"dashboard" não pode
--    ser bloqueada (a escola precisa sempre do painel e das configurações
--    mínimas para regularizar a conta).
-- ---------------------------------------------------------------------
create table if not exists public.school_feature_overrides (
  institution_id  text primary key references public.institutions(id) on delete cascade,
  blocked_modules  jsonb not null default '{}'::jsonb,
  blocked_sections jsonb not null default '{}'::jsonb,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);
alter table public.school_feature_overrides enable row level security;

-- ---------------------------------------------------------------------
-- 5. RLS: tudo fechado exceto para super administradores da plataforma
-- ---------------------------------------------------------------------
create policy plans_admin on public.subscription_plans for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy pay_admin on public.platform_payments for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy tickets_admin on public.support_tickets for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy paudit_read on public.platform_audit_log for select to authenticated
  using (app.is_platform_admin());
create policy features_admin on public.school_feature_overrides for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

grant select, insert, update, delete on public.subscription_plans to authenticated;
grant select, insert, update, delete on public.platform_payments to authenticated;
grant select, insert, update, delete on public.support_tickets to authenticated;
grant select on public.platform_audit_log to authenticated;
grant select, insert, update, delete on public.school_feature_overrides to authenticated;

-- Super admin também precisa de LER todas as escolas para gerir (select já
-- existe em 0001 via app.is_platform_admin()). Escrita na linha da escola
-- (plano, estado, notas) fica garantida aqui:
drop policy if exists inst_update_platform on public.institutions;
create policy inst_update_platform on public.institutions for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
drop policy if exists inst_delete_platform on public.institutions;
create policy inst_delete_platform on public.institutions for delete to authenticated
  using (app.is_platform_admin());
-- Perfis de qualquer escola: o super admin lê (0001) e pode ativar/desativar.
drop policy if exists profiles_update_platform on public.profiles;
create policy profiles_update_platform on public.profiles for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- O super admin NÃO tem perfil de escola: o guard de 0001 (guard_profile_update)
-- levanta exceções para updates feitos por quem não é admin da escola.
-- Ajuste: super admin da plataforma pode alterar `active` (bloquear gestores),
-- mas nunca mudar papel nem escola de ninguém.
create or replace function app.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare caller_role text := app.current_role();
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.institution_id is distinct from old.institution_id then
    raise exception 'institution_id é imutável' using errcode = '42501';
  end if;
  if app.is_platform_admin() then
    if new.role is distinct from old.role then
      raise exception 'A plataforma não altera papéis dentro da escola' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
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

-- ---------------------------------------------------------------------
-- 6. CRIAÇÃO ÚNICA DO SUPER ADMINISTRADOR
--    - Só funciona enquanto platform_admins estiver VAZIA (uma única vez).
--    - O chamador tem de estar autenticado e NÃO pode pertencer a nenhuma
--      escola (sem linha em profiles) — o super admin é da plataforma.
-- ---------------------------------------------------------------------
create or replace function public.platform_admin_slot_open() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from public.platform_admins)
$$;
revoke all on function public.platform_admin_slot_open() from public, anon;
grant execute on function public.platform_admin_slot_open() to authenticated;

create or replace function public.platform_claim_admin() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins) then
    raise exception 'Já existe um super administrador. A criação única foi utilizada.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Esta conta pertence a uma escola. Crie uma conta separada para a plataforma.' using errcode = '42501';
  end if;
  insert into public.platform_admins (user_id) values (auth.uid());
  insert into public.platform_audit_log (actor, actor_email, action, target_type, target_id, details)
    values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'platform_admin_claimed', 'platform', null,
            jsonb_build_object('note', 'Criação única do super administrador'));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.platform_claim_admin() from public, anon;
grant execute on function public.platform_claim_admin() to authenticated;

-- O chamador é super admin? (porta de entrada da app Admin Master)
create or replace function public.platform_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_platform_admin()
$$;
revoke all on function public.platform_is_admin() from public, anon;
grant execute on function public.platform_is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Auditoria: registo escrito pela app Admin Master
-- ---------------------------------------------------------------------
create or replace function public.platform_log(p_action text, p_target_type text default null,
                                               p_target_id text default null, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  insert into public.platform_audit_log (actor, actor_email, action, target_type, target_id, details)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), left(coalesce(p_action, '?'), 200),
          left(coalesce(p_target_type, ''), 60), left(coalesce(p_target_id, ''), 120),
          coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.platform_log(text, text, text, jsonb) from public, anon;
grant execute on function public.platform_log(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. SUSPENSÃO REAL: a escola 'suspended'/'archived' perde todo o acesso
--    (app.current_institution devolve NULL → nenhuma política RLS passa).
--    O perfil do próprio continua legível para a app mostrar o aviso.
-- ---------------------------------------------------------------------
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.institution_id
  from public.profiles p
  join public.institutions i on i.id = p.institution_id
  where p.id = auth.uid() and p.active and i.status = 'active'
        and app.plan_active(p.institution_id)
$$;

-- ---------------------------------------------------------------------
-- 9. BLOQUEIO DE SECÇÕES NO SERVIDOR (can_access)
--    Uma colecção fica inacessível se QUALQUER secção a que pertence estiver
--    bloqueada pela plataforma para aquela escola. (Bloquear um subsistema
--    na app Admin Master escreve todas as suas secções como bloqueadas.)
-- ---------------------------------------------------------------------
create or replace function app.section_blocked(p_inst text, p_section text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (f.blocked_sections ->> p_section)::boolean
    from public.school_feature_overrides f
    where f.institution_id = p_inst
  ), false)
$$;

create or replace function app.can_access(p_collection text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.collection_acl c on c.collection = p_collection
    where p.id = auth.uid() and p.active
      and (p_kind = 'read' or not c.server_only)
      -- Bloqueio da plataforma: nenhuma secção da colecção pode estar bloqueada.
      and not exists (
            select 1 from unnest(c.sections) s
            where app.section_blocked(p.institution_id, s)
          )
      and ( p.role = 'admin'
        or case
             when exists (select 1 from public.user_access ua
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and exists (select 1 from unnest(c.sections) s where ua.sections ? s))
             then exists (select 1 from public.user_access ua, unnest(c.sections) s
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and ua.sections -> s ->> 'enabled' = 'true'
                            and (p_kind = 'read' or ua.sections -> s ->> 'mode' = 'write'))
             else (p_kind = 'read'  and p.role = any (c.read_roles))
               or (p_kind = 'write' and p.role = any (c.write_roles))
           end )
  )
$$;

-- ---------------------------------------------------------------------
-- 10. A app da ESCOLA lê os seus bloqueios para esconder o menu
-- ---------------------------------------------------------------------
create or replace function public.my_feature_overrides() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_build_object('blockedModules', f.blocked_modules, 'blockedSections', f.blocked_sections)
    from public.school_feature_overrides f
    where f.institution_id = (select institution_id from public.profiles where id = auth.uid() and active)
  ), '{"blockedModules":{},"blockedSections":{}}'::jsonb)
$$;
revoke all on function public.my_feature_overrides() from public, anon;
grant execute on function public.my_feature_overrides() to authenticated;

-- ---------------------------------------------------------------------
-- 11. RPCs de gestão (Admin Master)
-- ---------------------------------------------------------------------

-- Lista de escolas com estado efetivo, contagem de utilizadores e gestor.
create or replace function public.platform_schools()
returns table (
  id text, name text, nif text, status text, plan_status text,
  trial_ends_at timestamptz, paid_until timestamptz, plan_id uuid,
  created_at timestamptz, users_count bigint, students_count bigint,
  admin_name text, admin_email text, plan_name text,
  effective_state text, days_left integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.name, i.nif, i.status, i.plan_status, i.trial_ends_at, i.paid_until, i.plan_id,
         i.created_at,
         (select count(*) from public.profiles pr where pr.institution_id = i.id) as users_count,
         coalesce((select count(*) from public.records r
                   where r.institution_id = i.id and r.collection = 'students'), 0) as students_count,
         (select pr.name from public.profiles pr
          where pr.institution_id = i.id and pr.role = 'admin' order by pr.created_at limit 1) as admin_name,
         (select pr.email from public.profiles pr
          where pr.institution_id = i.id and pr.role = 'admin' order by pr.created_at limit 1) as admin_email,
         sp.name as plan_name,
         case
           when i.status = 'suspended' then 'suspensa'
           when i.status = 'archived'  then 'arquivada'
           when i.plan_status = 'trial' and i.trial_ends_at > now() then 'experimental'
           when app.plan_active(i.id) then 'ativa'
           else 'pendente'
         end as effective_state,
         case
           when i.plan_status = 'trial'
             then greatest(0, ceil(extract(epoch from (i.trial_ends_at - now())) / 86400)::int)
           when i.plan_status = 'pago' and i.paid_until is not null
             then ceil(extract(epoch from (i.paid_until - now())) / 86400)::int
         end as days_left
  from public.institutions i
  left join public.subscription_plans sp on sp.id = i.plan_id
  where app.is_platform_admin()
  order by i.created_at desc
$$;
revoke all on function public.platform_schools() from public, anon;
grant execute on function public.platform_schools() to authenticated;

-- KPIs do dashboard.
create or replace function public.platform_overview() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select i.id, i.status, i.plan_status, i.trial_ends_at, i.paid_until, i.created_at, i.plan_id,
           app.plan_active(i.id) as active
    from public.institutions i
    where app.is_platform_admin()
  )
  select jsonb_build_object(
    'schoolsTotal',  (select count(*) from s),
    'schoolsActive', (select count(*) from s where status = 'active' and active),
    'schoolsTrial',  (select count(*) from s where status = 'active' and plan_status = 'trial' and trial_ends_at > now()),
    'schoolsPending',(select count(*) from s where status = 'active' and not active),
    'schoolsSuspended', (select count(*) from s where status = 'suspended'),
    'usersTotal',    (select count(*) from public.profiles),
    'revenueKz',     coalesce((select sum(amount_kz) from public.platform_payments where status = 'pago'), 0),
    'pendingKz',     coalesce((select sum(amount_kz) from public.platform_payments where status = 'pendente'), 0),
    'expiring15',    (select count(*) from s where status = 'active' and active and (
                        (plan_status = 'trial' and trial_ends_at <= now() + interval '15 days') or
                        (plan_status = 'pago' and paid_until is not null and paid_until <= now() + interval '15 days'))),
    'openTickets',   (select count(*) from public.support_tickets where status <> 'fechado'),
    'growth',        coalesce((select jsonb_agg(jsonb_build_object('month', m, 'total', c) order by m)
                        from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as m, count(*) as c
                              from s group by 1) g), '[]'::jsonb)
  )
$$;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- Ficha da escola: utilizadores, bloqueios e pagamentos.
create or replace function public.platform_school_detail(p_inst text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'school', (select to_jsonb(i) || jsonb_build_object('planName', sp.name)
               from public.institutions i
               left join public.subscription_plans sp on sp.id = i.plan_id
               where i.id = p_inst),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', pr.id, 'name', pr.name, 'email', pr.email, 'role', pr.role,
                 'active', pr.active, 'createdAt', pr.created_at) order by pr.created_at)
               from public.profiles pr where pr.institution_id = p_inst), '[]'::jsonb),
    'counts', (select jsonb_object_agg(collection, n) from (
                 select collection, count(*) as n from public.records
                 where institution_id = p_inst group by collection) c),
    'features', coalesce((select jsonb_build_object('blockedModules', f.blocked_modules,
                                                    'blockedSections', f.blocked_sections)
               from public.school_feature_overrides f where f.institution_id = p_inst),
               '{"blockedModules":{},"blockedSections":{}}'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(pp) || jsonb_build_object('planName', sp.name)
                            order by pp.created_at desc)
               from public.platform_payments pp
               left join public.subscription_plans sp on sp.id = pp.plan_id
               where pp.institution_id = p_inst), '[]'::jsonb)
  );
end $$;
revoke all on function public.platform_school_detail(text) from public, anon;
grant execute on function public.platform_school_detail(text) to authenticated;

-- Ativar / suspender / arquivar uma escola.
create or replace function public.platform_set_school_status(p_inst text, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  if p_status not in ('active','suspended','archived') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  update public.institutions set status = p_status where id = p_inst returning name into nm;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  perform public.platform_log('school_status', 'school', p_inst,
        jsonb_build_object('name', nm, 'status', p_status));
end $$;
revoke all on function public.platform_set_school_status(text, text) from public, anon;
grant execute on function public.platform_set_school_status(text, text) to authenticated;

-- Plano da escola: estado comercial + datas + plano contratado.
create or replace function public.platform_set_plan(p_inst text, p_plan_status text,
                                                    p_trial_ends_at timestamptz default null,
                                                    p_paid_until timestamptz default null,
                                                    p_plan_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  if p_plan_status not in ('trial','pago','pendente') then
    raise exception 'Estado de plano inválido' using errcode = '22023';
  end if;
  update public.institutions
  set plan_status = p_plan_status,
      trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
      paid_until = p_paid_until,
      plan_id = coalesce(p_plan_id, plan_id)
  where id = p_inst returning name into nm;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  perform public.platform_log('school_plan', 'school', p_inst, jsonb_build_object(
        'name', nm, 'planStatus', p_plan_status, 'trialEndsAt', p_trial_ends_at,
        'paidUntil', p_paid_until, 'planId', p_plan_id));
end $$;
revoke all on function public.platform_set_plan(text, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.platform_set_plan(text, text, timestamptz, timestamptz, uuid) to authenticated;

-- Ativação de subsistemas e secções (substitui o mapa completo).
create or replace function public.platform_set_features(p_inst text, p_blocked_modules jsonb,
                                                        p_blocked_sections jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  select name into nm from public.institutions where id = p_inst;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  insert into public.school_feature_overrides (institution_id, blocked_modules, blocked_sections, updated_by, updated_at)
  values (p_inst,
          coalesce(p_blocked_modules, '{}'::jsonb) - 'geral' - 'configuracoes',
          coalesce(p_blocked_sections, '{}'::jsonb) - 'dashboard',
          auth.uid(), now())
  on conflict (institution_id) do update
  set blocked_modules = excluded.blocked_modules,
      blocked_sections = excluded.blocked_sections,
      updated_by = excluded.updated_by,
      updated_at = now();
  perform public.platform_log('school_features', 'school', p_inst, jsonb_build_object(
        'name', nm, 'blockedModules', p_blocked_modules, 'blockedSections', p_blocked_sections));
end $$;
revoke all on function public.platform_set_features(text, jsonb, jsonb) from public, anon;
grant execute on function public.platform_set_features(text, jsonb, jsonb) to authenticated;

-- Ativar/desativar um utilizador de uma escola (ex.: bloquear o gestor).
create or replace function public.platform_set_user_active(p_uid uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text; inst text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  update public.profiles set active = p_active where id = p_uid returning name, institution_id into nm, inst;
  if nm is null then raise exception 'Utilizador não encontrado' using errcode = '22023'; end if;
  perform public.platform_log('user_active', 'user', p_uid::text,
        jsonb_build_object('name', nm, 'institution', inst, 'active', p_active));
end $$;
revoke all on function public.platform_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.platform_set_user_active(uuid, boolean) to authenticated;

-- Registar pagamento e (opcional) renovar o plano num só gesto.
create or replace function public.platform_record_payment(p_inst text, p_amount numeric, p_method text,
                                                          p_description text, p_plan_id uuid default null,
                                                          p_mark_paid boolean default true,
                                                          p_extend_days integer default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid; nm text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  select name into nm from public.institutions where id = p_inst;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  insert into public.platform_payments (institution_id, plan_id, description, amount_kz, method,
                                        status, paid_at, created_by)
  values (p_inst, p_plan_id, left(coalesce(p_description, 'Subscrição'), 300), p_amount,
          left(coalesce(p_method, 'Transferência'), 60),
          case when p_mark_paid then 'pago' else 'pendente' end,
          case when p_mark_paid then now() end, auth.uid())
  returning id into pid;
  if p_mark_paid and p_extend_days is not null and p_extend_days > 0 then
    update public.institutions
    set plan_status = 'pago',
        paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => p_extend_days)
    where id = p_inst;
  end if;
  perform public.platform_log('payment_recorded', 'school', p_inst, jsonb_build_object(
        'name', nm, 'amountKz', p_amount, 'method', p_method, 'paid', p_mark_paid,
        'extendDays', p_extend_days, 'paymentId', pid));
  return pid;
end $$;
revoke all on function public.platform_record_payment(text, numeric, text, text, uuid, boolean, integer) from public, anon;
grant execute on function public.platform_record_payment(text, numeric, text, text, uuid, boolean, integer) to authenticated;

-- ELIMINAR a conta da escola (zona de perigo do Admin Master).
-- Apaga TODOS os dados da escola, os perfis e a escola. As contas de
-- autenticação órfãs são removidas pela Edge Function `platform-admin`.
-- Exige escrever o nome exato da escola.
create or replace function public.platform_delete_school(p_inst text, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text; nprof int; wipe jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  select name into nm from public.institutions where id = p_inst;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> nm then
    raise exception 'Confirmação inválida: escreva o nome exato da escola (%).', nm using errcode = '42501';
  end if;

  -- 1) Apaga os dados editáveis (migração 0015/0016: wipe em transação própria).
  if to_regprocedure('app.wipe_school_data(text)') is not null then
    wipe := app.wipe_school_data(p_inst);
  end if;

  -- 2) Perfis, acessos, documentos e sobras com cascade direto.
  delete from public.user_access where institution_id = p_inst;
  delete from public.profiles where institution_id = p_inst;
  get diagnostics nprof = row_count;
  delete from public.school_feature_overrides where institution_id = p_inst;
  delete from public.institution_docs where institution_id = p_inst;
  delete from public.platform_payments where institution_id = p_inst;
  delete from public.support_tickets where institution_id = p_inst;

  -- 3) A própria escola.
  delete from public.institutions where id = p_inst;

  perform public.platform_log('school_deleted', 'school', p_inst,
        jsonb_build_object('name', nm, 'profilesRemoved', nprof, 'wipe', wipe));
  return jsonb_build_object('ok', true, 'name', nm, 'profilesRemoved', nprof);
end $$;
revoke all on function public.platform_delete_school(text, text) from public, anon;
grant execute on function public.platform_delete_school(text, text) to authenticated;

-- Lista de gestores (admins de escola) para a vista "Gestores".
create or replace function public.platform_managers()
returns table (id uuid, name text, email text, active boolean, created_at timestamptz,
               institution_id text, school_name text, school_status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select pr.id, pr.name, pr.email, pr.active, pr.created_at,
         pr.institution_id, i.name as school_name, i.status as school_status
  from public.profiles pr
  join public.institutions i on i.id = pr.institution_id
  where pr.role = 'admin' and app.is_platform_admin()
  order by pr.created_at desc
$$;
revoke all on function public.platform_managers() from public, anon;
grant execute on function public.platform_managers() to authenticated;

-- ---------------------------------------------------------------------
-- 12. Planos iniciais (comerciais da plataforma) — ajuste os preços.
-- ---------------------------------------------------------------------
insert into public.subscription_plans (name, cycle, price_kz, max_students, max_users, storage_gb, trial_days)
select * from (values
  ('Essencial',    'Mensal',     45000::numeric, 300,   10,  2,   15),
  ('Profissional', 'Mensal',     85000::numeric, 800,   25,  10,  30),
  ('Premium',      'Trimestral', 230000::numeric, 2000, 60,  50,  30),
  ('Ilimitado',    'Anual',      790000::numeric, null::integer, null::integer, 500, 30)
) as v(name, cycle, price_kz, max_students, max_users, storage_gb, trial_days)
where not exists (select 1 from public.subscription_plans);

-- =====================================================================
-- PÓS-INSTALAÇÃO (uma única vez):
--   1. Aplique:  supabase db push   (ou cole este ficheiro no SQL Editor)
--   2. Publique a função:  supabase functions deploy platform-admin
--   3. Abra a app Admin Master, entre com o utilizador que criou em
--      Authentication e clique em "Ativar Super Admin" (criação única).
-- =====================================================================
