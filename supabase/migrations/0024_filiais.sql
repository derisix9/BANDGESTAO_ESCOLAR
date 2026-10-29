-- =====================================================================
-- 0024: GESTÃO DE FILIAIS (escola mãe + filiais)
--
-- Modelo
--   • institutions.parent_id: uma filial aponta para a escola mãe (um só nível:
--     uma filial não tem filiais). Imutável depois de criada.
--   • O administrador da escola mãe é ÚNICO (profiles.institution_id = mãe).
--     Ele pode "entrar" na mãe e em qualquer filial: profiles.active_institution_id
--     guarda a escola em que está a trabalhar (NULL = a própria mãe).
--   • app.current_institution() passa a devolver a escola ATIVA. Como todas as
--     políticas RLS já usam esta função, cada filial continua com os dados
--     isolados: quem está numa escola só vê/grava nessa escola.
--   • Só o Admin Master (plataforma) cria filiais (platform_create_branch).
--     A filial herda o plano da mãe (sincronizado por trigger).
--   • Só o administrador pode trocar de escola, e só entre a mãe e as suas filiais.
--
-- Pré-requisito: 0001–0023.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------
alter table public.institutions
  add column if not exists parent_id text references public.institutions(id) on delete restrict;
create index if not exists institutions_parent_idx on public.institutions (parent_id) where parent_id is not null;

do $$ begin
  alter table public.institutions add constraint institutions_parent_not_self check (parent_id is null or parent_id <> id);
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists active_institution_id text references public.institutions(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Regras da hierarquia (um nível, imutável)
-- ---------------------------------------------------------------------
create or replace function app.guard_institution_parent() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    raise exception 'A escola mãe de uma filial não pode ser alterada' using errcode = '42501';
  end if;
  if new.parent_id is not null then
    if not exists (select 1 from public.institutions m where m.id = new.parent_id and m.parent_id is null) then
      raise exception 'A escola mãe não existe ou é ela própria uma filial' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists institutions_parent_guard on public.institutions;
create trigger institutions_parent_guard before insert or update of parent_id on public.institutions
  for each row execute function app.guard_institution_parent();

-- A filial segue o plano da mãe (plano, teste, pagamento, tolerância).
create or replace function app.sync_branch_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.institutions b set
    plan_id = new.plan_id, plan_status = new.plan_status, trial_ends_at = new.trial_ends_at,
    paid_until = new.paid_until, grace_until = new.grace_until, grace_note = new.grace_note,
    grace_granted_at = new.grace_granted_at, plan_activated_at = new.plan_activated_at
  where b.parent_id = new.id;
  return null;
end $$;
drop trigger if exists institutions_sync_branch_plan on public.institutions;
create trigger institutions_sync_branch_plan
  after update of plan_id, plan_status, trial_ends_at, paid_until, grace_until, grace_note, grace_granted_at, plan_activated_at
  on public.institutions
  for each row when (new.parent_id is null) execute function app.sync_branch_plan();

-- ---------------------------------------------------------------------
-- 3. Escola ativa
-- ---------------------------------------------------------------------
-- Escola em que o utilizador está a trabalhar (sem verificar estado/plano).
-- Só um ADMIN pode estar numa filial da sua própria escola mãe; qualquer outra
-- combinação cai de volta na escola do perfil.
create or replace function app.active_institution_of(p_uid uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when p.role = 'admin'
                and p.active_institution_id is not null
                and p.active_institution_id <> p.institution_id
                and exists (select 1 from public.institutions c
                            where c.id = p.active_institution_id and c.parent_id = p.institution_id)
           then p.active_institution_id
           else p.institution_id
         end
  from public.profiles p
  where p.id = p_uid and p.active
$$;

create or replace function app.active_institution_id() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select app.active_institution_of(auth.uid())
$$;

-- Base de todas as políticas RLS: a escola ativa, desde que ela (e a mãe, se for
-- filial) esteja ativa e o plano da mãe/escola em vigor.
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id
  from public.institutions i
  left join public.institutions m on m.id = i.parent_id
  where i.id = app.active_institution_id()
    and i.status = 'active'
    and (m.id is null or m.status = 'active')
    and app.plan_active(coalesce(i.parent_id, i.id))
$$;

-- ---------------------------------------------------------------------
-- 4. Perfis: só o próprio admin muda de escola ativa, e só dentro do seu grupo
-- ---------------------------------------------------------------------
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
  if new.active_institution_id is distinct from old.active_institution_id and not app.is_platform_admin() then
    if new.id <> auth.uid() or new.role <> 'admin' then
      raise exception 'Só o administrador pode trocar de escola' using errcode = '42501';
    end if;
    if new.active_institution_id is not null and new.active_institution_id <> new.institution_id
       and not exists (select 1 from public.institutions c
                       where c.id = new.active_institution_id and c.parent_id = new.institution_id) then
      raise exception 'Escola fora do seu grupo' using errcode = '42501';
    end if;
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
-- 5. Permissões por colecção: bloqueios da plataforma da escola ATIVA
--    (igual a 0019, só muda a escola usada em section_blocked)
-- ---------------------------------------------------------------------
create or replace function app.can_access(p_collection text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.collection_acl c on c.collection = p_collection
    where p.id = auth.uid() and p.active
      and (p_kind = 'read' or not c.server_only)
      and not exists (
            select 1 from unnest(c.sections) s
            where app.section_blocked(app.active_institution_of(p.id), s)
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

-- A app lê os bloqueios da escola ativa (igual a 0022, escola ativa em vez da do perfil).
create or replace function public.my_feature_overrides() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select i.id as institution_id, coalesce(m.plan_status, i.plan_status) as plan_status
    from public.institutions i
    left join public.institutions m on m.id = i.parent_id
    where i.id = app.active_institution_id()
  )
  select jsonb_build_object(
    'blockedModules',  coalesce(f.blocked_modules,  '{}'::jsonb),
    'blockedSections', coalesce(f.blocked_sections, '{}'::jsonb),
    'blockedSubsystems',
       coalesce(f.blocked_subsystems, '{}'::jsonb)
       || case when me.plan_status = 'trial'
               then '{"pre_escolar":true,"secundario_2":true,"superior":true}'::jsonb
               else '{}'::jsonb end
  )
  from me
  left join public.school_feature_overrides f on f.institution_id = me.institution_id
$$;
revoke all on function public.my_feature_overrides() from public, anon;
grant execute on function public.my_feature_overrides() to authenticated;

create or replace function public.my_storage_full() returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare inst text;
begin
  inst := app.active_institution_id();
  if inst is null then return false; end if;
  return app.storage_full(inst);
end $$;
revoke all on function public.my_storage_full() from public, anon;
grant execute on function public.my_storage_full() to authenticated;

-- ---------------------------------------------------------------------
-- 6. RPCs da escola: listar e trocar de escola
-- ---------------------------------------------------------------------
-- Escolas a que o utilizador tem acesso. Admin: mãe + filiais. Outros: só a sua.
create or replace function public.my_schools() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select p.id, p.role, p.institution_id from public.profiles p where p.id = auth.uid() and p.active)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'name', i.name, 'nif', i.nif, 'status', i.status,
           'isMother', i.parent_id is null, 'parentId', i.parent_id,
           'isCurrent', i.id = app.active_institution_id(),
           'studentsCount', (select count(*) from public.records r where r.institution_id = i.id and r.collection = 'students'),
           'usersCount', (select count(*) from public.profiles pr where pr.institution_id = i.id and pr.active)
         ) order by (i.parent_id is not null), i.name), '[]'::jsonb)
  from me
  join public.institutions i
    on i.id = me.institution_id or (me.role = 'admin' and i.parent_id = me.institution_id)
$$;
revoke all on function public.my_schools() from public, anon;
grant execute on function public.my_schools() to authenticated;

-- Muda a escola ativa do administrador (mãe ↔ filial). Valida tudo no servidor.
create or replace function public.switch_institution(p_inst text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null then raise exception 'Sessão inválida' using errcode = '42501'; end if;
  if me.role <> 'admin' then raise exception 'Só o administrador pode trocar de escola' using errcode = '42501'; end if;
  if p_inst is distinct from me.institution_id
     and not exists (select 1 from public.institutions c where c.id = p_inst and c.parent_id = me.institution_id) then
    raise exception 'Escola fora do seu grupo' using errcode = '42501';
  end if;
  if not exists (select 1 from public.institutions where id = p_inst and status = 'active') then
    raise exception 'Esta escola não está ativa' using errcode = '42501';
  end if;
  update public.profiles
     set active_institution_id = case when p_inst = me.institution_id then null else p_inst end
   where id = me.id;
  return jsonb_build_object('ok', true, 'institutionId', p_inst);
end $$;
revoke all on function public.switch_institution(text) from public, anon;
grant execute on function public.switch_institution(text) to authenticated;

-- Para as Edge Functions (service_role): escola em que o utilizador está a trabalhar.
create or replace function public.resolve_institution(p_uid uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select app.active_institution_of(p_uid)
$$;
revoke all on function public.resolve_institution(uuid) from public, anon, authenticated;
grant execute on function public.resolve_institution(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 7. Admin Master: criar e listar filiais
-- ---------------------------------------------------------------------
create or replace function public.platform_create_branch(p_parent text, p_name text, p_nif text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare m public.institutions; nm text := btrim(coalesce(p_name, '')); slug text; base text;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  select * into m from public.institutions where id = p_parent;
  if m.id is null then raise exception 'Escola mãe não encontrada' using errcode = '22023'; end if;
  if m.parent_id is not null then raise exception 'Uma filial não pode ter filiais' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where institution_id = m.id and role = 'admin' and active) then
    raise exception 'A escola mãe ainda não tem um administrador ativo' using errcode = '22023';
  end if;
  if length(nm) < 3 or length(nm) > 200 then
    raise exception 'Nome da filial obrigatório (3 a 200 caracteres)' using errcode = '22023';
  end if;

  base := btrim(regexp_replace(
            translate(lower(nm), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
            '[^a-z0-9]+', '_', 'g'), '_');
  slug := 'inst_' || left(base, 40) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.institutions (id, name, nif, parent_id, status, plan_id, plan_status, trial_ends_at, paid_until,
                                   grace_until, grace_note, grace_granted_at, plan_activated_at,
                                   terms_version, terms_accepted_at)
  values (slug, nm, nullif(btrim(coalesce(p_nif, '')), ''), m.id, 'active', m.plan_id, m.plan_status, m.trial_ends_at,
          m.paid_until, m.grace_until, m.grace_note, m.grace_granted_at, m.plan_activated_at,
          m.terms_version, m.terms_accepted_at);

  -- Definições mínimas próprias (nada é copiado da mãe: segredos e políticas são por escola).
  insert into public.institution_docs (institution_id, key, data)
  values (slug, 'settings', jsonb_build_object('schoolName', nm, 'institutionId', slug,
                                               'parentInstitutionId', m.id, 'isBranch', true,
                                               'nif', nullif(btrim(coalesce(p_nif, '')), '')));

  -- Parte com os mesmos bloqueios/modos da mãe; o Admin Master ajusta depois por filial.
  insert into public.school_feature_overrides (institution_id, blocked_modules, blocked_sections, blocked_subsystems, updated_by)
    select slug, f.blocked_modules, f.blocked_sections, f.blocked_subsystems, auth.uid()
    from public.school_feature_overrides f where f.institution_id = m.id;
  insert into public.school_feature_modes (institution_id, feature_key, mode, updated_by)
    select slug, f.feature_key, f.mode, auth.uid()
    from public.school_feature_modes f where f.institution_id = m.id
    on conflict (institution_id, feature_key) do nothing;

  insert into public.platform_audit_log (actor, actor_email, action, target_type, target_id, details)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'branch_created', 'school', slug,
          jsonb_build_object('parent', m.id, 'name', nm));
  return jsonb_build_object('id', slug, 'name', nm, 'parentId', m.id);
end $$;
revoke all on function public.platform_create_branch(text, text, text) from public, anon;
grant execute on function public.platform_create_branch(text, text, text) to authenticated;

-- Ligações mãe → filial (a app Admin Master junta isto à lista de escolas).
create or replace function public.platform_branch_links() returns table (id text, parent_id text)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.parent_id from public.institutions i
  where app.is_platform_admin() and i.parent_id is not null
$$;
revoke all on function public.platform_branch_links() from public, anon;
grant execute on function public.platform_branch_links() to authenticated;

-- Eliminar uma escola mãe que ainda tem filiais não é permitido (elimine primeiro as filiais).
create or replace function app.guard_institution_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.institutions where parent_id = old.id) then
    raise exception 'Esta escola tem filiais. Elimine primeiro as filiais.' using errcode = '23503';
  end if;
  return old;
end $$;
drop trigger if exists institutions_delete_guard on public.institutions;
create trigger institutions_delete_guard before delete on public.institutions
  for each row execute function app.guard_institution_delete();
