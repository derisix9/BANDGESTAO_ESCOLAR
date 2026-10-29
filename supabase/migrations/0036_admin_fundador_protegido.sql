-- 0036 — Administrador FUNDADOR protegido.
--
-- O primeiro administrador criado no registo da instituição (o "fundador") não pode ser eliminado,
-- despromovido, desactivado por outro administrador, nem passar a outro perfil. A única forma de o
-- fundador desaparecer é a escola ser eliminada do sistema (platform_delete_school).
-- A trava vive na base de dados: vale para o cliente, para a Edge Function delete-user (service_role)
-- e para qualquer acesso directo. Idempotente.

alter table public.profiles add column if not exists is_founder boolean not null default false;

-- Dados existentes: o administrador mais antigo de cada escola passa a ser o fundador.
update public.profiles p
   set is_founder = true
  from (select distinct on (institution_id) id
          from public.profiles
         where role = 'admin'
         order by institution_id, created_at asc, id asc) f
 where p.id = f.id
   and not exists (select 1 from public.profiles x where x.institution_id = p.institution_id and x.is_founder);

-- No máximo um fundador por escola.
create unique index if not exists profiles_one_founder_per_inst
  on public.profiles (institution_id) where is_founder;

-- ELIMINAR: só permitido durante a eliminação da própria escola (flag local à transacção).
create or replace function app.guard_founder_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_founder
     and coalesce(current_setting('app.deleting_school', true), '') is distinct from old.institution_id then
    raise exception 'Não é possível eliminar o administrador fundador da instituição. Só é possível eliminando a escola do sistema.'
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists profiles_founder_delete on public.profiles;
create trigger profiles_founder_delete before delete on public.profiles
  for each row execute function app.guard_founder_delete();

-- ALTERAR: o fundador mantém o perfil de administrador e a conta activa; ninguém (via cliente) mexe em is_founder.
create or replace function app.guard_founder_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;                                    -- service_role / ligação directa (servidor)
  end if;
  if new.is_founder is distinct from old.is_founder then
    raise exception 'A marca de administrador fundador não pode ser alterada' using errcode = '42501';
  end if;
  if old.is_founder then
    if new.role is distinct from old.role then
      raise exception 'O administrador fundador não pode mudar de perfil' using errcode = '42501';
    end if;
    if new.active is distinct from old.active and new.active = false and not app.is_platform_admin() then
      raise exception 'O administrador fundador não pode ser desativado' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_founder_update on public.profiles;
create trigger profiles_founder_update before update on public.profiles
  for each row execute function app.guard_founder_update();

-- Eliminação da escola (Admin Master): igual à 0019, mas liberta a trava do fundador nesta transacção.
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

  -- Liberta a trava do fundador (válida só até ao fim desta transacção).
  perform set_config('app.deleting_school', p_inst, true);

  if to_regprocedure('app.wipe_school_data(text)') is not null then
    wipe := app.wipe_school_data(p_inst);
  end if;

  delete from public.user_access where institution_id = p_inst;
  delete from public.profiles where institution_id = p_inst;
  get diagnostics nprof = row_count;
  delete from public.school_feature_overrides where institution_id = p_inst;
  delete from public.institution_docs where institution_id = p_inst;
  delete from public.platform_payments where institution_id = p_inst;
  delete from public.support_tickets where institution_id = p_inst;

  delete from public.institutions where id = p_inst;

  perform public.platform_log('school_deleted', 'school', p_inst,
        jsonb_build_object('name', nm, 'profilesRemoved', nprof, 'wipe', wipe));
  return jsonb_build_object('ok', true, 'name', nm, 'profilesRemoved', nprof);
end $$;
revoke all on function public.platform_delete_school(text, text) from public, anon;
grant execute on function public.platform_delete_school(text, text) to authenticated;
