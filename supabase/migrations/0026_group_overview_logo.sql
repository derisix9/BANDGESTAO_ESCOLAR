-- 0026 — Painel «Escolher escola»: o resumo do grupo passa a incluir o logótipo de cada escola
-- (settings.logoUrl, só https ou imagem pequena em base64). Substitui my_group_overview da 0025.
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
      'logoUrl', (select case when length(d.data ->> 'logoUrl') <= 300000
                               and (d.data ->> 'logoUrl') ~* '^(https://|data:image/(png|jpeg|webp);base64,)'
                         then d.data ->> 'logoUrl' end
                  from public.institution_docs d where d.institution_id = rec.id and d.key = 'settings'),
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
