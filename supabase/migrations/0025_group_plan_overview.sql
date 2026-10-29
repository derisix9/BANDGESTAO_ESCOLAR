-- =====================================================================
-- 0025: PLANO ÚNICO DO GRUPO (escola mãe + filiais) E PAINEL AGREGADO
--
-- Regras novas
--   • O plano é UM SÓ, o da escola mãe. Alunos, utilizadores e armazenamento
--     das filiais SOMAM-SE aos da mãe: com 250 alunos na mãe e 100 numa filial,
--     o plano mostra 350 e o limite é aplicado sobre esse total.
--   • O limite (alunos / utilizadores / armazenamento) é o do plano da mãe e é
--     imposto no servidor sobre o consumo do grupo inteiro.
--   • my_subscription() devolve o consumo do grupo + o detalhe por escola.
--   • my_schools() passa a contar como o plano conta (alunos ativos, equipa).
--   • my_group_overview(): números do painel de escolha de escola (os mesmos
--     cartões do Dashboard, por escola, para o cliente somar/filtrar).
--   • platform_school_detail() e platform_schools() passam a trazer o consumo
--     do grupo para o Admin Master.
--
-- Pré-requisito: 0001–0024.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Auxiliares do grupo
-- ---------------------------------------------------------------------
-- Escola mãe do grupo a que pertence p_inst (a própria, se já for mãe/independente).
create or replace function app.group_root(p_inst text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(i.parent_id, i.id) from public.institutions i where i.id = p_inst
$$;

-- Converte um valor JSON (número ou texto numérico) em numeric, sem nunca falhar.
create or replace function app.jnum(v jsonb) returns numeric
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(v)
           when 'number' then (v #>> '{}')::numeric
           when 'string' then case when (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v #>> '{}')::numeric else 0 end
           else 0
         end
$$;

-- ---------------------------------------------------------------------
-- 2. O limite vem SEMPRE do plano da escola mãe
-- ---------------------------------------------------------------------
create or replace function app.plan_limit(p_inst text, p_what text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_what
           when 'students' then sp.max_students::bigint
           when 'users'    then sp.max_users::bigint
           when 'storage'  then sp.storage_gb::bigint * 1073741824
         end
  from public.institutions i
  join public.institutions r on r.id = coalesce(i.parent_id, i.id)
  join public.subscription_plans sp on sp.id = r.plan_id
  where i.id = p_inst
$$;

-- ---------------------------------------------------------------------
-- 3. Consumo do GRUPO (mãe + filiais)
-- ---------------------------------------------------------------------
create or replace function app.group_student_count(p_inst text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(app.school_student_count(i.id)), 0)::int
  from public.institutions i
  where coalesce(i.parent_id, i.id) = app.group_root(p_inst)
$$;

create or replace function app.group_user_count(p_inst text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(app.school_user_count(i.id)), 0)::int
  from public.institutions i
  where coalesce(i.parent_id, i.id) = app.group_root(p_inst)
$$;

create or replace function app.group_usage_total(p_inst text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r record; t bigint := 0;
begin
  for r in select i.id from public.institutions i where coalesce(i.parent_id, i.id) = app.group_root(p_inst) loop
    t := t + coalesce(app.usage_total(r.id), 0);
  end loop;
  return t;
end $$;
revoke all on function app.group_usage_total(text) from public, anon, authenticated;

-- Armazenamento cheio = o GRUPO inteiro atingiu o limite do plano da mãe.
create or replace function app.storage_full(p_inst text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lim bigint := app.plan_limit(p_inst, 'storage');
begin
  if lim is null then return false; end if;
  return app.group_usage_total(p_inst) >= lim;
end $$;
revoke all on function app.storage_full(text) from public, anon;
grant execute on function app.storage_full(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Gatilhos: limites aplicados sobre o total do grupo
-- ---------------------------------------------------------------------
create or replace function app.enforce_records_limits() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare grow bigint; lim bigint;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;

  if tg_op = 'UPDATE' then
    grow := pg_column_size(new.data) - pg_column_size(old.data);
  else
    grow := pg_column_size(new.data);
  end if;

  if grow > 0 and app.storage_full(new.institution_id) then
    raise exception 'LIMITE_PLANO:armazenamento — O armazenamento do plano (partilhado pela escola mãe e filiais) está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
      using errcode = '53400';
  end if;

  if tg_op = 'INSERT' and new.collection = 'students'
     and coalesce(new.data ->> 'status', '') <> 'transferred' then
    lim := app.plan_limit(new.institution_id, 'students');
    if lim is not null and app.group_student_count(new.institution_id) >= lim then
      raise exception 'LIMITE_PLANO:alunos — O plano permite % alunos no total (escola mãe + filiais) e já foram atingidos. Peça um plano maior para cadastrar mais.', lim
        using errcode = '53400';
    end if;
  end if;
  return new;
end $$;

create or replace function app.enforce_docs_limits() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare grow bigint;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;
  grow := case when tg_op = 'UPDATE' then pg_column_size(new.data) - pg_column_size(old.data)
               else pg_column_size(new.data) end;
  if grow > 0 and app.storage_full(new.institution_id) then
    raise exception 'LIMITE_PLANO:armazenamento — O armazenamento do plano (partilhado pela escola mãe e filiais) está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
      using errcode = '53400';
  end if;
  return new;
end $$;

create or replace function app.enforce_users_limit() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lim bigint;
begin
  if new.role in ('aluno','encarregado') or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  if app.is_platform_admin() then return new; end if;
  lim := app.plan_limit(new.institution_id, 'users');
  if lim is not null and app.group_user_count(new.institution_id) >= lim then
    raise exception 'LIMITE_PLANO:utilizadores — O plano permite % utilizadores no total (escola mãe + filiais) e já foram atingidos. Desative um utilizador ou peça um plano maior.', lim
      using errcode = '53400';
  end if;
  return new;
end $$;

-- Eliminar numa filial também liberta espaço do grupo: invalida a medição de toda a família.
create or replace function app.invalidate_usage() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.school_usage set measured_at = 'epoch'
  where institution_id in (select i.id from public.institutions i
                           where coalesce(i.parent_id, i.id) = app.group_root(old.institution_id))
    and measured_at <> 'epoch';
  return old;
end $$;

-- ---------------------------------------------------------------------
-- 5. my_schools(): contagens iguais às do plano
-- ---------------------------------------------------------------------
create or replace function public.my_schools() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select p.id, p.role, p.institution_id from public.profiles p where p.id = auth.uid() and p.active)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'name', i.name, 'nif', i.nif, 'status', i.status,
           'isMother', i.parent_id is null, 'parentId', i.parent_id,
           'isCurrent', i.id = app.active_institution_id(),
           'studentsCount', app.school_student_count(i.id),
           'usersCount', app.school_user_count(i.id)
         ) order by (i.parent_id is not null), i.name), '[]'::jsonb)
  from me
  join public.institutions i
    on i.id = me.institution_id or (me.role = 'admin' and i.parent_id = me.institution_id)
$$;
revoke all on function public.my_schools() from public, anon;
grant execute on function public.my_schools() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Painel de escolha de escola: números por escola (o cliente soma/filtra)
-- ---------------------------------------------------------------------
create or replace function public.my_group_overview() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare me public.profiles; root public.institutions; sp public.subscription_plans;
        res jsonb; rec record; schools jsonb := '[]'::jsonb; one jsonb;
        t_st int := 0; t_us int := 0; t_by bigint := 0; db bigint; fl bigint; used bigint;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null or me.role <> 'admin' then
    raise exception 'Só o administrador vê o painel do grupo' using errcode = '42501';
  end if;
  select * into root from public.institutions where id = app.group_root(me.institution_id);
  select * into sp from public.subscription_plans where id = root.plan_id;

  for rec in
    select i.* from public.institutions i
    where coalesce(i.parent_id, i.id) = root.id
    order by (i.parent_id is not null), i.name
  loop
    perform app.measure_usage(rec.id);
    select u.db_bytes, u.files_bytes into db, fl from public.school_usage u where u.institution_id = rec.id;
    used := coalesce(db, 0) + coalesce(fl, 0);

    select jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'nif', rec.nif, 'status', rec.status,
      'isMother', rec.parent_id is null,
      'students', (
        select jsonb_build_object(
          'total', count(*),
          'regular', count(*) filter (where coalesce(r.data ->> 'financialStatus', '') <> 'debito'),
          'debt', count(*) filter (where r.data ->> 'financialStatus' = 'debito'),
          'attendanceSum', coalesce(sum(case when jsonb_typeof(r.data -> 'attendanceRate') = 'number'
                                             then (r.data ->> 'attendanceRate')::numeric else 100 end), 0),
          'absences', coalesce(sum(app.jnum(r.data -> 'unexcusedAbsences')), 0))
        from public.records r where r.institution_id = rec.id and r.collection = 'students'),
      'teachers', (select count(*) from public.records r where r.institution_id = rec.id and r.collection = 'teachers'),
      'departments', (select coalesce(array_agg(distinct nullif(r.data ->> 'department', '')) filter (where nullif(r.data ->> 'department', '') is not null), '{}')
                      from public.records r where r.institution_id = rec.id and r.collection = 'teachers'),
      'classes', (select count(*) from public.records r where r.institution_id = rec.id and r.collection = 'classes'),
      'invoices', (
        select jsonb_build_object(
          'invoiced', coalesce(sum(app.jnum(r.data -> 'totalAmountKz')), 0),
          'collected', coalesce(sum(app.jnum(r.data -> 'totalAmountKz')) filter (where r.data ->> 'status' = 'pago'), 0),
          'pending', count(*) filter (where r.data ->> 'status' in ('pendente', 'atraso')),
          'entradas', coalesce(sum(case when r.data ? 'totalPaidKz' then app.jnum(r.data -> 'totalPaidKz')
                                        else app.jnum(r.data -> 'totalAmountKz') end)
                               filter (where r.data ->> 'status' = 'pago' and nullif(r.data ->> 'paymentDate', '') is not null), 0))
        from public.records r where r.institution_id = rec.id and r.collection = 'invoices'),
      'expenses', (
        select jsonb_build_object(
          'paid', coalesce(sum(app.jnum(r.data -> 'amount')) filter (where nullif(r.data ->> 'paidDate', '') is not null), 0),
          'paidCount', count(*) filter (where nullif(r.data ->> 'paidDate', '') is not null),
          'payables', coalesce(sum(app.jnum(r.data -> 'amount')) filter (where nullif(r.data ->> 'paidDate', '') is null), 0))
        from public.records r where r.institution_id = rec.id and r.collection = 'expenses'),
      'payroll', (
        select jsonb_build_object(
          'paid', coalesce(sum(app.jnum(r.data -> 'netSalaryKz')) filter (where r.data ->> 'status' = 'pago' and app.jnum(r.data -> 'netSalaryKz') > 0), 0),
          'paidCount', count(*) filter (where r.data ->> 'status' = 'pago' and app.jnum(r.data -> 'netSalaryKz') > 0))
        from public.records r where r.institution_id = rec.id and r.collection = 'payrollRecords'),
      'assets', (
        select jsonb_build_object(
          'value', coalesce(sum(app.jnum(r.data -> 'acquisitionValueKz')) filter (where app.jnum(r.data -> 'acquisitionValueKz') > 0), 0),
          'count', count(*) filter (where app.jnum(r.data -> 'acquisitionValueKz') > 0))
        from public.records r where r.institution_id = rec.id and r.collection = 'assets'),
      'usage', jsonb_build_object(
        'students', app.school_student_count(rec.id),
        'users', app.school_user_count(rec.id),
        'storageBytes', used)
    ) into one;

    schools := schools || jsonb_build_array(one);
    t_st := t_st + app.school_student_count(rec.id);
    t_us := t_us + app.school_user_count(rec.id);
    t_by := t_by + used;
  end loop;

  return jsonb_build_object(
    'rootId', root.id,
    'planName', sp.name,
    'limits', jsonb_build_object('students', app.plan_limit(root.id, 'students'),
                                 'users', app.plan_limit(root.id, 'users'),
                                 'storageBytes', app.plan_limit(root.id, 'storage')),
    'usage', jsonb_build_object('students', t_st, 'users', t_us, 'storageBytes', t_by),
    'schools', schools,
    'serverTime', now());
end $$;
revoke all on function public.my_group_overview() from public, anon;
grant execute on function public.my_group_overview() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Plano e Subscrição (escola): consumo do grupo + detalhe por escola
-- ---------------------------------------------------------------------
create or replace function public.my_subscription() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles; i public.institutions; sp public.subscription_plans;
        st int; us int; used bigint := 0; db bigint := 0; fl bigint := 0;
        l_st bigint; l_us bigint; l_sto bigint; phase text; expires timestamptz;
        rec record; u_db bigint; u_fl bigint; breakdown jsonb := '[]'::jsonb;
begin
  select * into p from public.profiles where id = auth.uid() and active;
  if p.id is null or p.role not in ('admin','director') then return null; end if;
  -- O plano é o da escola mãe (a filial usa o mesmo).
  select * into i from public.institutions where id = app.group_root(p.institution_id);
  select * into sp from public.subscription_plans where id = i.plan_id;

  for rec in
    select x.id, x.name, x.parent_id from public.institutions x
    where coalesce(x.parent_id, x.id) = i.id
    order by (x.parent_id is not null), x.name
  loop
    perform app.measure_usage(rec.id);
    select u.db_bytes, u.files_bytes into u_db, u_fl from public.school_usage u where u.institution_id = rec.id;
    db := db + coalesce(u_db, 0); fl := fl + coalesce(u_fl, 0);
    breakdown := breakdown || jsonb_build_array(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'isMother', rec.parent_id is null,
      'students', app.school_student_count(rec.id), 'users', app.school_user_count(rec.id),
      'storageBytes', coalesce(u_db, 0) + coalesce(u_fl, 0)));
  end loop;
  used := db + fl;
  st := app.group_student_count(i.id);
  us := app.group_user_count(i.id);
  l_st := app.plan_limit(i.id, 'students');
  l_us := app.plan_limit(i.id, 'users');
  l_sto := app.plan_limit(i.id, 'storage');

  phase := case
    when app.plan_paid_active(i.id) then i.plan_status
    when app.in_grace(i.id)         then 'tolerancia'
    else 'expirada' end;
  expires := case phase
    when 'trial' then i.trial_ends_at
    when 'pago'  then i.paid_until
    when 'tolerancia' then i.grace_until
    else coalesce(i.paid_until, i.trial_ends_at) end;

  return jsonb_build_object(
    'schoolName', i.name,
    'phase', phase,
    'active', app.plan_active(i.id),
    'activatedAt', i.plan_activated_at,
    'createdAt', i.created_at,
    'trialEndsAt', i.trial_ends_at,
    'paidUntil', i.paid_until,
    'expiresAt', expires,
    'planEndedAt', case when i.plan_status = 'pago' then i.paid_until else i.trial_ends_at end,
    'graceUntil', case when app.in_grace(i.id) then i.grace_until end,
    'graceNote', case when app.in_grace(i.id) then i.grace_note end,
    'plan', case when sp.id is null then null else jsonb_build_object(
              'name', sp.name, 'cycle', sp.cycle, 'priceKz', sp.price_kz, 'trialDays', sp.trial_days) end,
    'limits', jsonb_build_object('students', l_st, 'users', l_us, 'storageBytes', l_sto),
    'usage',  jsonb_build_object('students', st, 'users', us, 'storageBytes', used,
                                 'dbBytes', db, 'filesBytes', fl),
    'breakdown', breakdown,
    'blocked', jsonb_build_object(
      'students', l_st is not null and st >= l_st,
      'users',    l_us is not null and us >= l_us,
      'storage',  l_sto is not null and used >= l_sto),
    'serverTime', now());
end $$;
revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Admin Master: consumo do grupo na ficha e na lista
-- ---------------------------------------------------------------------
create or replace function public.platform_school_detail(p_inst text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare db bigint := 0; fl bigint := 0; u_db bigint; u_fl bigint; root text; rec record; breakdown jsonb := '[]'::jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  root := app.group_root(p_inst);
  for rec in
    select x.id, x.name, x.parent_id from public.institutions x
    where coalesce(x.parent_id, x.id) = root order by (x.parent_id is not null), x.name
  loop
    perform app.measure_usage(rec.id);
    select u.db_bytes, u.files_bytes into u_db, u_fl from public.school_usage u where u.institution_id = rec.id;
    db := db + coalesce(u_db, 0); fl := fl + coalesce(u_fl, 0);
    breakdown := breakdown || jsonb_build_array(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'isMother', rec.parent_id is null,
      'students', app.school_student_count(rec.id), 'users', app.school_user_count(rec.id),
      'storageBytes', coalesce(u_db, 0) + coalesce(u_fl, 0)));
  end loop;
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
               where pp.institution_id = p_inst), '[]'::jsonb),
    'usage', jsonb_build_object(
      'students', app.group_student_count(p_inst), 'users', app.group_user_count(p_inst),
      'storageBytes', db + fl, 'dbBytes', db, 'filesBytes', fl),
    'limits', jsonb_build_object(
      'students', app.plan_limit(p_inst, 'students'), 'users', app.plan_limit(p_inst, 'users'),
      'storageBytes', app.plan_limit(p_inst, 'storage')),
    'isGroup', jsonb_array_length(breakdown) > 1,
    'breakdown', breakdown
  );
end $$;
revoke all on function public.platform_school_detail(text) from public, anon;
grant execute on function public.platform_school_detail(text) to authenticated;

-- Lista de escolas: acrescenta o total do GRUPO (para a escola mãe) sem mexer nas colunas existentes.
create or replace function public.platform_group_usage()
returns table (root_id text, students bigint, users bigint, storage_bytes bigint, schools bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(i.parent_id, i.id) as root_id,
         sum(app.school_student_count(i.id))::bigint,
         sum(app.school_user_count(i.id))::bigint,
         coalesce(sum((select u.db_bytes + u.files_bytes from public.school_usage u where u.institution_id = i.id)), 0)::bigint,
         count(*)::bigint
  from public.institutions i
  where app.is_platform_admin()
  group by coalesce(i.parent_id, i.id)
$$;
revoke all on function public.platform_group_usage() from public, anon;
grant execute on function public.platform_group_usage() to authenticated;
