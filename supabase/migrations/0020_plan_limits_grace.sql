-- =====================================================================
-- 0020: TOLERÂNCIA, LIMITES DO PLANO E SUPORTE VISÍVEL À ESCOLA
--
-- O que esta migração acrescenta (tudo aplicado no SERVIDOR/RLS, não na app):
--   1. TOLERÂNCIA (novo): o Admin Master pode dar X dias a uma escola cujo
--      teste ou plano expirou (ou que ainda não pagou). Enquanto a tolerância
--      durar, o acesso mantém-se; quando acabar, a escola bloqueia sozinha.
--   2. LIMITES DO PLANO: alunos, utilizadores e armazenamento vêm do plano
--      contratado (subscription_plans). Ao atingir:
--        - alunos        → não aceita novos alunos
--        - utilizadores  → não cria nem reativa utilizadores
--        - armazenamento → a base de dados deixa de aceitar INSERT e UPDATE
--                          que façam crescer os dados (e uploads de ficheiros).
--                          ELIMINAR continua sempre permitido: ao libertar
--                          espaço, a escrita volta sozinha.
--      Plano sem limite definido (campo vazio) = ilimitado. Escola sem plano
--      atribuído = sem limites.
--   3. DATA DE ATIVAÇÃO do plano (plan_activated_at) para a contagem de tempo.
--   4. SUPORTE: a escola vê os pedidos que o Admin Master lhe registou,
--      responde e pode abrir pedidos novos (RPCs my_support_tickets & co).
--   5. A escola lê o seu plano/uso/limites com my_subscription().
--
-- Pré-requisito: 0013, 0014 e 0019_platform_admin aplicadas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------
alter table public.institutions
  add column if not exists grace_until       timestamptz,
  add column if not exists grace_note        text,
  add column if not exists grace_granted_at  timestamptz,
  add column if not exists plan_activated_at timestamptz;

update public.institutions set plan_activated_at = created_at where plan_activated_at is null;
alter table public.institutions alter column plan_activated_at set default now();

alter table public.support_tickets
  add column if not exists origin         text not null default 'plataforma' check (origin in ('plataforma','escola')),
  add column if not exists replies        jsonb not null default '[]'::jsonb,
  add column if not exists school_seen_at timestamptz;

-- Medição de uso por escola (cache de 60 s; só funções security definer a tocam).
create table if not exists public.school_usage (
  institution_id text primary key references public.institutions(id) on delete cascade,
  db_bytes       bigint not null default 0,
  files_bytes    bigint not null default 0,
  measured_at    timestamptz not null default 'epoch'
);
alter table public.school_usage enable row level security;   -- sem políticas: ninguém lê direto

-- ---------------------------------------------------------------------
-- 2. A escola não mexe no seu próprio plano, tolerância, notas nem datas
-- ---------------------------------------------------------------------
create or replace function app.guard_institution_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.plan_status        is distinct from old.plan_status
          or new.trial_ends_at   is distinct from old.trial_ends_at
          or new.paid_until      is distinct from old.paid_until
          or new.plan_id         is distinct from old.plan_id
          or new.grace_until     is distinct from old.grace_until
          or new.grace_note      is distinct from old.grace_note
          or new.grace_granted_at is distinct from old.grace_granted_at
          or new.plan_activated_at is distinct from old.plan_activated_at
          or new.admin_notes     is distinct from old.admin_notes) then
    raise exception 'Só a equipa BandMed altera o plano' using errcode = '42501';
  end if;
  -- (mantido da migração 0017) a aceitação dos termos só se regista no registo da escola
  if auth.uid() is not null and not app.is_platform_admin()
     and (new.terms_version is distinct from old.terms_version
          or new.terms_accepted_at is distinct from old.terms_accepted_at) then
    raise exception 'A aceitação dos termos só pode ser registada no registo da escola' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Plano em vigor = pago/teste válidos  OU  tolerância ainda a decorrer
-- ---------------------------------------------------------------------
-- Pago ou teste válidos, SEM contar a tolerância (usado para distinguir estados).
create or replace function app.plan_paid_active(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (i.plan_status = 'pago' and (i.paid_until is null or i.paid_until > now()))
        or (i.plan_status = 'trial' and i.trial_ends_at > now())
    from public.institutions i where i.id = p_inst
  ), false)
$$;

create or replace function app.in_grace(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select i.grace_until is not null and i.grace_until > now()
                   from public.institutions i where i.id = p_inst), false)
$$;

-- É esta função que a base de dados usa para bloquear (app.current_institution → RLS).
create or replace function app.plan_active(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.plan_paid_active(p_inst) or app.in_grace(p_inst)
$$;

-- ---------------------------------------------------------------------
-- 4. Limites e medição de uso
-- ---------------------------------------------------------------------
-- Limite do plano: NULL = ilimitado (ou escola sem plano atribuído).
create or replace function app.plan_limit(p_inst text, p_what text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_what
           when 'students' then sp.max_students::bigint
           when 'users'    then sp.max_users::bigint
           when 'storage'  then sp.storage_gb::bigint * 1073741824
         end
  from public.institutions i
  join public.subscription_plans sp on sp.id = i.plan_id
  where i.id = p_inst
$$;

-- Alunos ativos (transferidos e inativos não contam para o limite).
create or replace function app.school_student_count(p_inst text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.records r
  where r.institution_id = p_inst and r.collection = 'students'
    and coalesce(r.data ->> 'status', '') <> 'transferred'
    and coalesce(r.data ->> 'studentSituation', '') <> 'Inactivo'
$$;

-- Utilizadores da equipa (contas ativas; alunos e encarregados do portal não contam).
create or replace function app.school_user_count(p_inst text) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.profiles p
  where p.institution_id = p_inst and p.active and p.role not in ('aluno','encarregado')
$$;

-- Recalcula o armazenamento da escola: dados na base + ficheiros no Storage.
create or replace function app.measure_usage(p_inst text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare db bigint := 0; files bigint := 0;
begin
  select coalesce(sum(pg_column_size(r.data) + 64), 0) into db
  from public.records r where r.institution_id = p_inst;
  db := db + coalesce((select sum(pg_column_size(d.data)) from public.institution_docs d
                       where d.institution_id = p_inst), 0);
  db := db + coalesce((select sum(pg_column_size(a.detail) + 160) from public.audit_log a
                       where a.institution_id = p_inst), 0);
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum((metadata ->> 'size')::bigint), 0)
               from storage.objects
               where bucket_id = 'school-files' and (storage.foldername(name))[1] = $1$q$
      into files using p_inst;
  end if;
  insert into public.school_usage (institution_id, db_bytes, files_bytes, measured_at)
  values (p_inst, db, files, now())
  on conflict (institution_id) do update
    set db_bytes = excluded.db_bytes, files_bytes = excluded.files_bytes, measured_at = excluded.measured_at;
end $$;
revoke all on function app.measure_usage(text) from public, anon, authenticated;

-- Armazenamento usado (bytes). Usa a medição em cache; remede se tiver > 60 s.
create or replace function app.usage_total(p_inst text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.school_usage;
begin
  select * into u from public.school_usage where institution_id = p_inst;
  if not found or u.measured_at < now() - interval '60 seconds' then
    perform app.measure_usage(p_inst);
    select * into u from public.school_usage where institution_id = p_inst;
  end if;
  return u.db_bytes + u.files_bytes;
end $$;
revoke all on function app.usage_total(text) from public, anon, authenticated;

create or replace function app.storage_full(p_inst text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lim bigint := app.plan_limit(p_inst, 'storage');
begin
  if lim is null then return false; end if;
  return app.usage_total(p_inst) >= lim;
end $$;
revoke all on function app.storage_full(text) from public, anon;
grant execute on function app.storage_full(text) to authenticated;   -- usada nas políticas do Storage

-- ---------------------------------------------------------------------
-- 5. Triggers que aplicam os limites
--    (mensagens começam por LIMITE_PLANO:<tipo> para a app as reconhecer)
-- ---------------------------------------------------------------------
create or replace function app.enforce_records_limits() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare grow bigint; lim bigint;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;  -- servidor / equipa BandMed

  if tg_op = 'UPDATE' then
    grow := pg_column_size(new.data) - pg_column_size(old.data);
  else
    grow := pg_column_size(new.data);
  end if;

  -- Armazenamento cheio: só passa o que NÃO faz crescer os dados (ex.: editar para encolher).
  if grow > 0 and app.storage_full(new.institution_id) then
    raise exception 'LIMITE_PLANO:armazenamento — O armazenamento do plano está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
      using errcode = '53400';
  end if;

  -- Limite de alunos (só novos alunos).
  if tg_op = 'INSERT' and new.collection = 'students'
     and coalesce(new.data ->> 'status', '') <> 'transferred' then
    lim := app.plan_limit(new.institution_id, 'students');
    if lim is not null and app.school_student_count(new.institution_id) >= lim then
      raise exception 'LIMITE_PLANO:alunos — O plano permite %  alunos e já foram atingidos. Peça um plano maior para cadastrar mais.', lim
        using errcode = '53400';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists records_plan_limits on public.records;
create trigger records_plan_limits before insert or update on public.records
  for each row execute function app.enforce_records_limits();

create or replace function app.enforce_docs_limits() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare grow bigint;
begin
  if auth.uid() is null or app.is_platform_admin() then return new; end if;
  grow := case when tg_op = 'UPDATE' then pg_column_size(new.data) - pg_column_size(old.data)
               else pg_column_size(new.data) end;
  if grow > 0 and app.storage_full(new.institution_id) then
    raise exception 'LIMITE_PLANO:armazenamento — O armazenamento do plano está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
      using errcode = '53400';
  end if;
  return new;
end $$;
drop trigger if exists institution_docs_plan_limits on public.institution_docs;
create trigger institution_docs_plan_limits before insert or update on public.institution_docs
  for each row execute function app.enforce_docs_limits();

-- Utilizadores: criar (inclui a Edge Function create-user, que usa service_role) e reativar.
create or replace function app.enforce_users_limit() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare lim bigint;
begin
  if new.role in ('aluno','encarregado') or not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;    -- já contava
  if app.is_platform_admin() then return new; end if;
  lim := app.plan_limit(new.institution_id, 'users');
  if lim is not null and app.school_user_count(new.institution_id) >= lim then
    raise exception 'LIMITE_PLANO:utilizadores — O plano permite % utilizadores e já foram atingidos. Desative um utilizador ou peça um plano maior.', lim
      using errcode = '53400';
  end if;
  return new;
end $$;
drop trigger if exists profiles_plan_limits on public.profiles;
create trigger profiles_plan_limits before insert or update of active, role on public.profiles
  for each row execute function app.enforce_users_limit();

-- Eliminar liberta espaço: a próxima escrita volta a medir.
create or replace function app.invalidate_usage() returns trigger
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update public.school_usage set measured_at = 'epoch'
  where institution_id = old.institution_id and measured_at <> 'epoch';
  return old;
end $$;
drop trigger if exists records_usage_invalidate on public.records;
create trigger records_usage_invalidate after delete on public.records
  for each row execute function app.invalidate_usage();
drop trigger if exists docs_usage_invalidate on public.institution_docs;
create trigger docs_usage_invalidate after delete on public.institution_docs
  for each row execute function app.invalidate_usage();

-- Uploads de ficheiros também param quando o armazenamento enche (apagar continua livre).
do $$ begin
  if to_regnamespace('storage') is not null and to_regclass('storage.objects') is not null then
    drop policy if exists school_files_insert on storage.objects;
    create policy school_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'school-files'
                  and (storage.foldername(name))[1] = app.current_institution()
                  and app.can_access((storage.foldername(name))[2], 'write')
                  and not app.storage_full((storage.foldername(name))[1]));
    -- apagar um ficheiro também liberta espaço já na próxima medição (≤ 60 s).
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. A escola lê o seu estado de plano (funciona com tolerância)
-- ---------------------------------------------------------------------
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'status', case when (i.plan_status = 'trial' and i.trial_ends_at <= now())
                     or (i.plan_status = 'pago' and i.paid_until is not null and i.paid_until <= now())
                   then 'pendente' else i.plan_status end,
    'active', app.plan_active(i.id),
    'trialEndsAt', i.trial_ends_at,
    'daysLeft', case when i.plan_status = 'trial' then greatest(0, ceil(extract(epoch from (i.trial_ends_at - now())) / 86400)::int) else null end,
    'paidUntil', i.paid_until,
    'paidDaysLeft', case when i.plan_status = 'pago' and i.paid_until is not null
                         then greatest(0, ceil(extract(epoch from (i.paid_until - now())) / 86400)::int) else null end,
    'inGrace', (app.in_grace(i.id) and not app.plan_paid_active(i.id)),
    'graceUntil', case when app.in_grace(i.id) then i.grace_until end,
    'graceDaysLeft', case when app.in_grace(i.id)
                          then greatest(0, ceil(extract(epoch from (i.grace_until - now())) / 86400)::int) end,
    'schoolName', i.name)
  from public.profiles p join public.institutions i on i.id = p.institution_id
  where p.id = auth.uid()
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Painel "Plano e Subscrição" da escola: plano, datas, benefícios e uso.
create or replace function public.my_subscription() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles; i public.institutions; sp public.subscription_plans;
        st int; us int; used bigint; db bigint; fl bigint;
        l_st bigint; l_us bigint; l_sto bigint; phase text; expires timestamptz;
begin
  select * into p from public.profiles where id = auth.uid() and active;
  if p.id is null or p.role not in ('admin','director') then return null; end if;
  select * into i from public.institutions where id = p.institution_id;
  select * into sp from public.subscription_plans where id = i.plan_id;

  perform app.measure_usage(i.id);
  select u.db_bytes, u.files_bytes into db, fl from public.school_usage u where u.institution_id = i.id;
  used := coalesce(db, 0) + coalesce(fl, 0);
  st := app.school_student_count(i.id);
  us := app.school_user_count(i.id);
  l_st := app.plan_limit(i.id, 'students');
  l_us := app.plan_limit(i.id, 'users');
  l_sto := app.plan_limit(i.id, 'storage');

  phase := case
    when app.plan_paid_active(i.id) then i.plan_status                 -- 'trial' | 'pago'
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
                                 'dbBytes', coalesce(db, 0), 'filesBytes', coalesce(fl, 0)),
    'blocked', jsonb_build_object(
      'students', l_st is not null and st >= l_st,
      'users',    l_us is not null and us >= l_us,
      'storage',  l_sto is not null and used >= l_sto),
    'serverTime', now());
end $$;
revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- Qualquer utilizador ativo pode saber se o armazenamento da sua escola está cheio
-- (a política do Storage recusa o upload sem devolver a mensagem do plano).
create or replace function public.my_storage_full() returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare inst text;
begin
  select p.institution_id into inst from public.profiles p where p.id = auth.uid() and p.active;
  if inst is null then return false; end if;
  return app.storage_full(inst);
end $$;
revoke all on function public.my_storage_full() from public, anon;
grant execute on function public.my_storage_full() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Suporte: a escola vê, responde e abre pedidos
-- ---------------------------------------------------------------------
create or replace function app.support_caller() returns public.profiles
language sql stable security definer set search_path = public, pg_temp as $$
  select p.* from public.profiles p
  where p.id = auth.uid() and p.active and p.role in ('admin','director')
$$;

create or replace function public.my_support_tickets() returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles := app.support_caller();
begin
  if p.id is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'message', t.message, 'priority', t.priority,
             'status', t.status, 'origin', t.origin, 'replies', t.replies,
             'createdAt', t.created_at, 'updatedAt', t.updated_at,
             'unread', (t.school_seen_at is null or t.school_seen_at < t.updated_at))
           order by t.updated_at desc)
    from public.support_tickets t where t.institution_id = p.institution_id), '[]'::jsonb);
end $$;
revoke all on function public.my_support_tickets() from public, anon;
grant execute on function public.my_support_tickets() to authenticated;

create or replace function public.my_ticket_seen(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles := app.support_caller();
begin
  if p.id is null then return; end if;
  update public.support_tickets set school_seen_at = now()
  where id = p_id and institution_id = p.institution_id;
end $$;
revoke all on function public.my_ticket_seen(uuid) from public, anon;
grant execute on function public.my_ticket_seen(uuid) to authenticated;

create or replace function public.my_ticket_reply(p_id uuid, p_text text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles := app.support_caller(); ts timestamptz := now(); n int;
begin
  if p.id is null then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if btrim(coalesce(p_text, '')) = '' or length(p_text) > 4000 then
    raise exception 'Escreva a resposta (até 4000 caracteres).' using errcode = '22023';
  end if;
  update public.support_tickets
  set replies = replies || jsonb_build_array(jsonb_build_object(
        'by', 'escola', 'name', p.name, 'at', ts, 'text', btrim(p_text))),
      status = case when status = 'fechado' then 'aberto' else status end,
      updated_at = ts, school_seen_at = ts
  where id = p_id and institution_id = p.institution_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
end $$;
revoke all on function public.my_ticket_reply(uuid, text) from public, anon;
grant execute on function public.my_ticket_reply(uuid, text) to authenticated;

create or replace function public.my_ticket_create(p_subject text, p_message text, p_priority text default 'media') returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.profiles := app.support_caller(); ts timestamptz := now(); tid uuid;
begin
  if p.id is null then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if btrim(coalesce(p_subject, '')) = '' or length(p_subject) > 200 then
    raise exception 'Indique o assunto (até 200 caracteres).' using errcode = '22023';
  end if;
  if p_priority not in ('baixa','media','alta') then p_priority := 'media'; end if;
  insert into public.support_tickets (institution_id, subject, message, priority, status, origin,
                                      created_by, created_at, updated_at, school_seen_at)
  values (p.institution_id, btrim(p_subject), left(coalesce(p_message, ''), 4000), p_priority, 'aberto',
          'escola', auth.uid(), ts, ts, ts)
  returning id into tid;
  return tid;
end $$;
revoke all on function public.my_ticket_create(text, text, text) from public, anon;
grant execute on function public.my_ticket_create(text, text, text) to authenticated;

-- Resposta da equipa BandMed (Admin Master).
create or replace function public.platform_ticket_reply(p_id uuid, p_text text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ts timestamptz := now(); n int;
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa BandMed' using errcode = '42501'; end if;
  if btrim(coalesce(p_text, '')) = '' or length(p_text) > 4000 then
    raise exception 'Escreva a resposta (até 4000 caracteres).' using errcode = '22023';
  end if;
  update public.support_tickets
  set replies = replies || jsonb_build_array(jsonb_build_object(
        'by', 'plataforma', 'name', 'Equipa BandMed', 'at', ts, 'text', btrim(p_text))),
      status = case when status = 'aberto' then 'em_curso' else status end,
      updated_at = ts
  where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Pedido não encontrado' using errcode = '22023'; end if;
  perform public.platform_log('ticket_reply', 'ticket', p_id::text, '{}'::jsonb);
end $$;
revoke all on function public.platform_ticket_reply(uuid, text) from public, anon;
grant execute on function public.platform_ticket_reply(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Admin Master: tolerância
-- ---------------------------------------------------------------------
-- p_days > 0 → tolerância até agora + p_days;  p_days = 0 → retira a tolerância.
create or replace function public.platform_set_grace(p_inst text, p_days integer, p_note text default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare nm text; until_ts timestamptz;
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa BandMed' using errcode = '42501'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'A tolerância tem de ser entre 0 e 365 dias.' using errcode = '22023';
  end if;
  until_ts := case when p_days > 0 then now() + make_interval(days => p_days) end;
  update public.institutions
  set grace_until = until_ts,
      grace_note = case when p_days > 0 then left(nullif(btrim(coalesce(p_note, '')), ''), 500) end,
      grace_granted_at = case when p_days > 0 then now() end
  where id = p_inst returning name into nm;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  perform public.platform_log(case when p_days > 0 then 'grace_granted' else 'grace_revoked' end,
        'school', p_inst, jsonb_build_object('name', nm, 'days', p_days, 'until', until_ts, 'note', p_note));
end $$;
revoke all on function public.platform_set_grace(text, integer, text) from public, anon;
grant execute on function public.platform_set_grace(text, integer, text) to authenticated;

-- Plano da escola: agora regista a data de ativação e limpa a tolerância se o plano ficou válido.
create or replace function public.platform_set_plan(p_inst text, p_plan_status text,
                                                    p_trial_ends_at timestamptz default null,
                                                    p_paid_until timestamptz default null,
                                                    p_plan_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa BandMed' using errcode = '42501'; end if;
  if p_plan_status not in ('trial','pago','pendente') then
    raise exception 'Estado de plano inválido' using errcode = '22023';
  end if;
  update public.institutions
  set plan_activated_at = case when p_plan_status = 'pago' and plan_status is distinct from 'pago'
                               then now() else plan_activated_at end,
      grace_until = case
        when (p_plan_status = 'pago' and (p_paid_until is null or p_paid_until > now()))
          or (p_plan_status = 'trial' and coalesce(p_trial_ends_at, trial_ends_at) > now())
        then null else grace_until end,
      plan_status = p_plan_status,
      trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
      paid_until = p_paid_until,
      plan_id = coalesce(p_plan_id, plan_id)
  where id = p_inst returning name into nm;
  if nm is null then raise exception 'Escola não encontrada' using errcode = '22023'; end if;
  perform public.platform_log('school_plan', 'school', p_inst, jsonb_build_object(
        'name', nm, 'planStatus', p_plan_status, 'trialEndsAt', p_trial_ends_at,
        'paidUntil', p_paid_until, 'planId', p_plan_id));
end $$;

-- Pagamento + renovação: reinicia a data de ativação e termina a tolerância.
create or replace function public.platform_record_payment(p_inst text, p_amount numeric, p_method text,
                                                          p_description text, p_plan_id uuid default null,
                                                          p_mark_paid boolean default true,
                                                          p_extend_days integer default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid; nm text;
begin
  if not app.is_platform_admin() then raise exception 'Só a equipa BandMed' using errcode = '42501'; end if;
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
    set plan_activated_at = case when plan_status = 'pago' and (paid_until is null or paid_until > now())
                                 then plan_activated_at else now() end,
        plan_status = 'pago',
        paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => p_extend_days),
        plan_id = coalesce(p_plan_id, plan_id),
        grace_until = null
    where id = p_inst;
  end if;
  perform public.platform_log('payment_recorded', 'school', p_inst, jsonb_build_object(
        'name', nm, 'amountKz', p_amount, 'method', p_method, 'paid', p_mark_paid,
        'extendDays', p_extend_days, 'paymentId', pid));
  return pid;
end $$;

-- ---------------------------------------------------------------------
-- 9. Lista de escolas (agora com tolerância e uso) e ficha da escola
-- ---------------------------------------------------------------------
drop function if exists public.platform_schools();
create or replace function public.platform_schools()
returns table (
  id text, name text, nif text, status text, plan_status text,
  trial_ends_at timestamptz, paid_until timestamptz, plan_id uuid,
  created_at timestamptz, users_count bigint, students_count bigint,
  admin_name text, admin_email text, plan_name text,
  effective_state text, days_left integer,
  grace_until timestamptz, grace_days_left integer, plan_activated_at timestamptz,
  max_students integer, max_users integer, storage_gb integer, storage_used_bytes bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.name, i.nif, i.status, i.plan_status, i.trial_ends_at, i.paid_until, i.plan_id,
         i.created_at,
         (select count(*) from public.profiles pr where pr.institution_id = i.id) as users_count,
         app.school_student_count(i.id)::bigint as students_count,
         (select pr.name from public.profiles pr
          where pr.institution_id = i.id and pr.role = 'admin' order by pr.created_at limit 1) as admin_name,
         (select pr.email from public.profiles pr
          where pr.institution_id = i.id and pr.role = 'admin' order by pr.created_at limit 1) as admin_email,
         sp.name as plan_name,
         case
           when i.status = 'suspended' then 'suspensa'
           when i.status = 'archived'  then 'arquivada'
           when i.plan_status = 'trial' and i.trial_ends_at > now() then 'experimental'
           when app.plan_paid_active(i.id) then 'ativa'
           when app.in_grace(i.id) then 'tolerancia'
           else 'pendente'
         end as effective_state,
         case
           when i.plan_status = 'trial'
             then greatest(0, ceil(extract(epoch from (i.trial_ends_at - now())) / 86400)::int)
           when i.plan_status = 'pago' and i.paid_until is not null
             then ceil(extract(epoch from (i.paid_until - now())) / 86400)::int
         end as days_left,
         case when app.in_grace(i.id) then i.grace_until end as grace_until,
         case when app.in_grace(i.id)
              then greatest(0, ceil(extract(epoch from (i.grace_until - now())) / 86400)::int) end as grace_days_left,
         i.plan_activated_at,
         sp.max_students, sp.max_users, sp.storage_gb,
         (select u.db_bytes + u.files_bytes from public.school_usage u where u.institution_id = i.id) as storage_used_bytes
  from public.institutions i
  left join public.subscription_plans sp on sp.id = i.plan_id
  where app.is_platform_admin()
  order by i.created_at desc
$$;
revoke all on function public.platform_schools() from public, anon;
grant execute on function public.platform_schools() to authenticated;

create or replace function public.platform_school_detail(p_inst text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare db bigint; fl bigint;
begin
  if not app.is_platform_admin() then
    raise exception 'Só a equipa BandMed' using errcode = '42501';
  end if;
  perform app.measure_usage(p_inst);
  select u.db_bytes, u.files_bytes into db, fl from public.school_usage u where u.institution_id = p_inst;
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
      'students', app.school_student_count(p_inst), 'users', app.school_user_count(p_inst),
      'storageBytes', coalesce(db, 0) + coalesce(fl, 0), 'dbBytes', coalesce(db, 0), 'filesBytes', coalesce(fl, 0)),
    'limits', jsonb_build_object(
      'students', app.plan_limit(p_inst, 'students'), 'users', app.plan_limit(p_inst, 'users'),
      'storageBytes', app.plan_limit(p_inst, 'storage'))
  );
end $$;
revoke all on function public.platform_school_detail(text) from public, anon;
grant execute on function public.platform_school_detail(text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. KPIs do dashboard: escolas em tolerância e tolerâncias a terminar
-- ---------------------------------------------------------------------
create or replace function public.platform_overview() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select i.id, i.status, i.plan_status, i.trial_ends_at, i.paid_until, i.created_at, i.plan_id,
           i.grace_until,
           app.plan_active(i.id)      as active,
           app.plan_paid_active(i.id) as paid_active,
           app.in_grace(i.id)         as in_grace
    from public.institutions i
    where app.is_platform_admin()
  )
  select jsonb_build_object(
    'schoolsTotal',  (select count(*) from s),
    'schoolsActive', (select count(*) from s where status = 'active' and active),
    'schoolsTrial',  (select count(*) from s where status = 'active' and plan_status = 'trial' and trial_ends_at > now()),
    'schoolsPending',(select count(*) from s where status = 'active' and not active),
    'schoolsGrace',  (select count(*) from s where status = 'active' and in_grace and not paid_active),
    'schoolsSuspended', (select count(*) from s where status = 'suspended'),
    'usersTotal',    (select count(*) from public.profiles),
    'revenueKz',     coalesce((select sum(amount_kz) from public.platform_payments where status = 'pago'), 0),
    'pendingKz',     coalesce((select sum(amount_kz) from public.platform_payments where status = 'pendente'), 0),
    'expiring15',    (select count(*) from s where status = 'active' and (
                        (paid_active and plan_status = 'trial' and trial_ends_at <= now() + interval '15 days') or
                        (paid_active and plan_status = 'pago' and paid_until is not null and paid_until <= now() + interval '15 days') or
                        (in_grace and not paid_active and grace_until <= now() + interval '15 days'))),
    'openTickets',   (select count(*) from public.support_tickets where status <> 'fechado'),
    'growth',        coalesce((select jsonb_agg(jsonb_build_object('month', m, 'total', c) order by m)
                        from (select to_char(date_trunc('month', created_at), 'YYYY-MM') as m, count(*) as c
                              from s group by 1) g), '[]'::jsonb)
  )
$$;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- =====================================================================
-- NOTAS
--  * Limite de armazenamento: a medição é refeita no máximo de 60 em 60 s
--    (e logo a seguir a qualquer eliminação). Escritas em massa dentro da
--    mesma transação podem ultrapassar o limite por uma pequena margem.
--  * A equipa BandMed e o servidor (service_role) nunca são bloqueados pelos
--    limites de armazenamento/alunos; o limite de utilizadores também se
--    aplica à Edge Function create-user (service_role).
--  * Pagamentos (payments), auditoria e faturação fiscal não são travados:
--    são livros imutáveis e nunca devem falhar por falta de espaço.
-- =====================================================================
