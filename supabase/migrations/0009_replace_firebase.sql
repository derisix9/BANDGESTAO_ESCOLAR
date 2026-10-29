-- =====================================================================
-- 0009 — Tudo o que ainda vivia no Firebase passa para o Supabase
--
--  Firebase (Realtime Database)                →  Supabase
--  institutions/{escola}  (documento da escola) →  institution_docs (uma linha por chave)
--  public_academic_years/{escola}               →  public_academic_years + RPC get_public_academic_years
--  public_admission_config/{escola}             →  public_admission_config + RPC get_public_admission_config
--  public_admission_requests/{escola}/{id}      →  public_admission_requests  (anónimo só escreve por RPC)
--  public_admission_status/{escola}/{chave}     →  public_admission_status    (anónimo só lê por RPC)
--  public_admission_complaints/{escola}/{id}    →  public_admission_complaints (idem)
--  institution_transfers/{destino}/{id}         →  institution_transfers
--  institutions_registry/index                  →  RPC list_institutions()  (a lista vem da tabela institutions)
--  users/{uid}, access_control, user_projections → profiles, user_access, user_projections (já existiam)
--  public_verify/{token}                        →  public_tokens (0004)
--
-- Regra de ouro: o anónimo NUNCA toca em tabelas; só chama funções (RPC) que validam tudo.
-- Seguro de correr mais do que uma vez.
-- =====================================================================

-- ---------- 0) Chave de acesso segura (espelha accessKey() em src/utils/userAccess.ts) ----------
-- O cliente grava as secções de acesso com chaves codificadas ('configuracoes/ano-letivo' → 'configuracoes~sano-letivo').
-- Sem esta tradução, a função can_access() nunca encontrava secções com '/' ou '.' no nome.
create or replace function app.access_key(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(p,
    '.', '~d'), '/', '~s'), '$', '~c'), '#', '~h'), '[', '~o'), ']', '~e')
$$;

create or replace function app.can_access(p_collection text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.collection_acl c on c.collection = p_collection
    where p.id = auth.uid() and p.active
      and (p_kind = 'read' or not c.server_only)
      and ( p.role = 'admin'
        or case
             when exists (select 1 from public.user_access ua
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and exists (select 1 from unnest(c.sections) s where ua.sections ? app.access_key(s)))
             then exists (select 1 from public.user_access ua, unnest(c.sections) s
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and ua.sections -> app.access_key(s) ->> 'enabled' = 'true'
                            and (p_kind = 'read' or ua.sections -> app.access_key(s) ->> 'mode' = 'write'))
             else (p_kind = 'read'  and p.role = any (c.read_roles))
               or (p_kind = 'write' and p.role = any (c.write_roles))
           end )
  )
$$;

-- Acesso personalizado a uma secção (ou a qualquer sub-secção, ex.: 'configuracoes' cobre 'configuracoes/ano-letivo')
create or replace function app.custom_section(p_section text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_access ua on ua.user_id = p.id and ua.institution_id = p.institution_id,
         jsonb_each(ua.sections) s(k, v)
    where p.id = auth.uid() and p.active
      and (s.k = app.access_key(p_section) or s.k like app.access_key(p_section) || '~s%')
      and s.v ->> 'enabled' = 'true'
      and (p_kind = 'read' or s.v ->> 'mode' = 'write')
  )
$$;

create or replace function app.touch_docs() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;

-- ---------- 1) Documento da escola (o que NÃO é colecção por registo) ----------
-- settings, events, auditLogs (feed de actividade), miniPautasStore, pauta, attendance.
create table if not exists public.institution_docs (
  institution_id text not null references public.institutions(id) on delete cascade,
  key            text not null,
  data           jsonb not null,
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, key),
  constraint institution_docs_key_ok check (key in ('settings','events','auditLogs','miniPautasStore','pauta','attendance')),
  constraint institution_docs_shape check (
    (key in ('settings','miniPautasStore') and jsonb_typeof(data) = 'object')
    or (key in ('events','auditLogs','pauta','attendance') and jsonb_typeof(data) = 'array')),
  constraint institution_docs_size check (pg_column_size(data) < 10000000)
);
alter table public.institution_docs enable row level security;

create or replace function app.can_doc(p_key text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(case p_key
    -- definições da escola: toda a gente da escola lê (nome, ano lectivo, logótipo); gestão escreve
    when 'settings' then
      p_kind = 'read'
      or app.current_role() in ('admin','director','secretaria','financeiro')
      or app.custom_section('configuracoes', 'write')
    when 'events' then
      p_kind = 'read'
      or app.current_role() in ('admin','director','secretaria')
      or app.custom_section('calendario', 'write')
    -- feed de actividade: só a equipa (a auditoria à prova de adulteração está em audit_log)
    when 'auditLogs' then
      app.current_role() in ('admin','director','secretaria','professor','financeiro','funcionario')
    -- pautas: mesmos perfis que a secção "pautas"
    when 'miniPautasStore' then
      app.current_role() in ('admin','director','secretaria','professor') or app.custom_section('pautas', p_kind)
    when 'pauta' then
      app.current_role() in ('admin','director','secretaria','professor') or app.custom_section('pautas', p_kind)
    when 'attendance' then
      app.current_role() in ('admin','director','secretaria','professor','funcionario')
      or app.custom_section('assiduidade', p_kind)
    else false end, false)
$$;

drop policy if exists idocs_select on public.institution_docs;
drop policy if exists idocs_insert on public.institution_docs;
drop policy if exists idocs_update on public.institution_docs;
create policy idocs_select on public.institution_docs for select to authenticated
  using (institution_id = app.current_institution() and app.can_doc(key, 'read'));
create policy idocs_insert on public.institution_docs for insert to authenticated
  with check (institution_id = app.current_institution() and app.can_doc(key, 'write'));
create policy idocs_update on public.institution_docs for update to authenticated
  using (institution_id = app.current_institution() and app.can_doc(key, 'write'))
  with check (institution_id = app.current_institution());
drop trigger if exists idocs_touch on public.institution_docs;
create trigger idocs_touch before insert or update on public.institution_docs
  for each row execute function app.touch_docs();
revoke all on public.institution_docs from anon, authenticated;
grant select, insert, update on public.institution_docs to authenticated;

-- ---------- 2) Anos lectivos públicos (selector do link de Pré-Matrícula) ----------
create table if not exists public.public_academic_years (
  institution_id text primary key references public.institutions(id) on delete cascade,
  current_year   text not null check (length(current_year) between 4 and 20),
  years          jsonb not null check (jsonb_typeof(years) = 'array' and jsonb_array_length(years) between 1 and 60),
  updated_at     timestamptz not null default now()
);
alter table public.public_academic_years enable row level security;
drop policy if exists pay_admin on public.public_academic_years;
create policy pay_admin on public.public_academic_years for all to authenticated
  using (institution_id = app.current_institution() and app.current_role() = 'admin')
  with check (institution_id = app.current_institution() and app.current_role() = 'admin');
revoke all on public.public_academic_years from anon, authenticated;
grant select, insert, update on public.public_academic_years to authenticated;

create or replace function public.get_public_academic_years(p_inst text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('current', current_year, 'years', years)
  from public.public_academic_years where institution_id = p_inst
$$;

-- ---------- 3) Pré-Matrícula online (link público, sem login) ----------
create table if not exists public.public_admission_config (
  institution_id text primary key references public.institutions(id) on delete cascade,
  data           jsonb not null default '{}'::jsonb check (pg_column_size(data) < 700000),   -- inclui o logótipo (data URL)
  updated_at     timestamptz not null default now()
);
create table if not exists public.public_admission_requests (
  institution_id text not null references public.institutions(id) on delete cascade,
  id             text not null check (length(id) between 1 and 80),
  data           jsonb not null check (pg_column_size(data) < 8000000),   -- anexos em base64 (limitados pela app)
  created_at     timestamptz not null default now(),
  primary key (institution_id, id)
);
create table if not exists public.public_admission_status (
  institution_id text not null references public.institutions(id) on delete cascade,
  key            text not null check (length(key) between 1 and 80),
  data           jsonb not null check (pg_column_size(data) < 200000),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, key)
);
create table if not exists public.public_admission_complaints (
  institution_id text not null references public.institutions(id) on delete cascade,
  id             text not null check (length(id) between 1 and 80),   -- = chave aleatória da candidatura (rk_…)
  data           jsonb not null check (pg_column_size(data) < 30000),
  created_at     timestamptz not null default now(),
  primary key (institution_id, id)
);
create index if not exists pad_req_created_idx on public.public_admission_requests (institution_id, created_at);

create or replace function app.is_admissions_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_role() in ('admin','director','secretaria'), false)
$$;

alter table public.public_admission_config     enable row level security;
alter table public.public_admission_requests   enable row level security;
alter table public.public_admission_status     enable row level security;
alter table public.public_admission_complaints enable row level security;

drop policy if exists pac_staff on public.public_admission_config;
create policy pac_staff on public.public_admission_config for all to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff())
  with check (institution_id = app.current_institution() and app.is_admissions_staff());
drop policy if exists par_read on public.public_admission_requests;
drop policy if exists par_delete on public.public_admission_requests;
create policy par_read on public.public_admission_requests for select to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff());
create policy par_delete on public.public_admission_requests for delete to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff());
drop policy if exists pas_staff on public.public_admission_status;
create policy pas_staff on public.public_admission_status for all to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff())
  with check (institution_id = app.current_institution() and app.is_admissions_staff());
drop policy if exists pacm_read on public.public_admission_complaints;
drop policy if exists pacm_update on public.public_admission_complaints;
drop policy if exists pacm_delete on public.public_admission_complaints;
create policy pacm_read on public.public_admission_complaints for select to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff());
create policy pacm_update on public.public_admission_complaints for update to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff())
  with check (institution_id = app.current_institution());
create policy pacm_delete on public.public_admission_complaints for delete to authenticated
  using (institution_id = app.current_institution() and app.is_admissions_staff());

revoke all on public.public_admission_config, public.public_admission_requests,
              public.public_admission_status, public.public_admission_complaints from anon, authenticated;
grant select, insert, update, delete on public.public_admission_config to authenticated;
grant select, delete on public.public_admission_requests to authenticated;
grant select, insert, update, delete on public.public_admission_status to authenticated;
grant select, update, delete on public.public_admission_complaints to authenticated;

-- Estado do link (activo / bloqueado / eliminado) — leitura pública mínima
create or replace function public.get_public_admission_config(p_inst text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select data from public.public_admission_config where institution_id = p_inst), '{}'::jsonb)
$$;

-- Submissão do candidato. O anónimo só consegue ACRESCENTAR (nunca sobrepõe estados/índices existentes).
create or replace function public.public_admission_submit(
  p_inst text, p_request jsonb, p_status_key text, p_status jsonb, p_index_keys text[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; rid text := p_request ->> 'id'; ix text; total bigint; recent bigint;
begin
  if not exists (select 1 from public.institutions where id = p_inst and status = 'active') then
    raise exception 'escola_inexistente' using errcode = 'P0001';
  end if;
  select data into cfg from public.public_admission_config where institution_id = p_inst;
  if coalesce((cfg ->> 'deleted')::boolean, false) then raise exception 'link_inactivo' using errcode = 'P0001'; end if;
  if coalesce((cfg ->> 'blocked')::boolean, false) then raise exception 'candidaturas_encerradas' using errcode = 'P0001'; end if;
  if rid is null or length(rid) > 80 or p_status_key is null or length(p_status_key) > 80
     or coalesce(array_length(p_index_keys, 1), 0) > 4 or jsonb_typeof(p_request) <> 'object' or jsonb_typeof(p_status) <> 'object' then
    raise exception 'pedido_invalido' using errcode = 'P0001';
  end if;
  -- travões simples contra enchentes (spam): por escola
  select count(*), count(*) filter (where created_at > now() - interval '10 minutes')
    into total, recent from public.public_admission_requests where institution_id = p_inst;
  if total >= 5000 then raise exception 'caixa_cheia' using errcode = 'P0001'; end if;
  if recent >= 150 then raise exception 'demasiados_pedidos' using errcode = 'P0001'; end if;

  insert into public.public_admission_requests(institution_id, id, data) values (p_inst, rid, p_request);
  insert into public.public_admission_status(institution_id, key, data) values (p_inst, p_status_key, p_status)
    on conflict (institution_id, key) do nothing;
  foreach ix in array coalesce(p_index_keys, '{}') loop
    if ix is not null and ix ~ '^ix_[0-9a-f]{40}$' then
      insert into public.public_admission_status(institution_id, key, data)
        values (p_inst, ix, jsonb_build_object('rk', p_status_key)) on conflict (institution_id, key) do nothing;
    end if;
  end loop;
end $$;

-- Consulta pública: chave de índice (hash de B.I./ref. + data de nascimento) → registo de estado
create or replace function public.public_admission_lookup(p_inst text, p_ix text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select s.data
  from public.public_admission_status i
  join public.public_admission_status s on s.institution_id = i.institution_id and s.key = i.data ->> 'rk'
  where i.institution_id = p_inst and i.key = p_ix and p_ix ~ '^ix_[0-9a-f]{40}$'
$$;

-- Reclamação: só de uma candidatura que existe, e uma por candidatura
create or replace function public.public_admission_complaint_submit(p_inst text, p_rk text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb;
begin
  select data into cfg from public.public_admission_config where institution_id = p_inst;
  if coalesce((cfg ->> 'deleted')::boolean, false) then raise exception 'link_inactivo' using errcode = 'P0001'; end if;
  if coalesce((cfg ->> 'complaintsBlocked')::boolean, false) then raise exception 'reclamacoes_encerradas' using errcode = 'P0001'; end if;
  if p_rk is null or jsonb_typeof(p_data) <> 'object'
     or not exists (select 1 from public.public_admission_status where institution_id = p_inst and key = p_rk) then
    raise exception 'pedido_invalido' using errcode = 'P0001';
  end if;
  insert into public.public_admission_complaints(institution_id, id, data) values (p_inst, p_rk, p_data);
exception when unique_violation then
  raise exception 'reclamacao_duplicada' using errcode = 'P0001';
end $$;

create or replace function public.public_admission_complaint_get(p_inst text, p_rk text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select data from public.public_admission_complaints where institution_id = p_inst and id = p_rk
$$;

-- ---------- 4) Transferências entre escolas ----------
create table if not exists public.institution_transfers (
  to_institution_id   text not null references public.institutions(id) on delete cascade,
  id                  text not null check (length(id) between 1 and 80),
  from_institution_id text not null references public.institutions(id) on delete cascade,
  status              text not null default 'pendente',
  data                jsonb not null check (pg_column_size(data) < 3000000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (to_institution_id, id)
);
alter table public.institution_transfers enable row level security;

create or replace function app.is_transfer_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_role() in ('admin','director','secretaria'), false)
$$;

drop policy if exists it_select on public.institution_transfers;
drop policy if exists it_insert on public.institution_transfers;
drop policy if exists it_update on public.institution_transfers;
create policy it_select on public.institution_transfers for select to authenticated
  using (app.is_transfer_staff() and (to_institution_id = app.current_institution() or from_institution_id = app.current_institution()));
create policy it_insert on public.institution_transfers for insert to authenticated
  with check (app.is_transfer_staff() and from_institution_id = app.current_institution() and to_institution_id <> from_institution_id);
create policy it_update on public.institution_transfers for update to authenticated
  using (app.is_transfer_staff() and (to_institution_id = app.current_institution()
         or (from_institution_id = app.current_institution() and status = 'pendente')))
  with check (app.is_transfer_staff());

create or replace function app.guard_transfer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare me text := app.current_institution();
        decision text[] := array['status','decidedBy','decidedAt','decisionNote','studentId'];
begin
  if auth.uid() is null then return new; end if;                 -- servidor
  if tg_op = 'INSERT' then
    -- o remetente nunca cria um pedido já "aceite"
    new.data := jsonb_set(new.data, '{status}', '"pendente"');
    new.status := 'pendente';
    return new;
  end if;
  if new.to_institution_id <> old.to_institution_id or new.from_institution_id <> old.from_institution_id or new.id <> old.id then
    raise exception 'Chave do pedido é imutável' using errcode = '42501';
  end if;
  if me = old.to_institution_id then
    -- o destino só regista a decisão; o conteúdo enviado pela origem não muda
    if (new.data - decision) is distinct from (old.data - decision) then
      raise exception 'O destino só pode registar a decisão' using errcode = '42501';
    end if;
    new.status := coalesce(new.data ->> 'status', old.status);
  else
    if old.status <> 'pendente' then raise exception 'Pedido já decidido' using errcode = '42501'; end if;
    new.data := jsonb_set(new.data, '{status}', '"pendente"');   -- reenvio
    new.status := 'pendente';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists it_guard on public.institution_transfers;
create trigger it_guard before insert or update on public.institution_transfers
  for each row execute function app.guard_transfer();
revoke all on public.institution_transfers from anon, authenticated;
grant select, insert, update on public.institution_transfers to authenticated;

-- ---------- 5) Lista de escolas (para escolher o destino de uma transferência) ----------
create or replace function public.list_institutions() returns table (id text, name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.name, i.created_at from public.institutions i
  where i.status = 'active' and app.current_institution() is not null
  order by i.name
$$;

-- ---------- 6) Permissões das funções (o anónimo só chama as públicas) ----------
revoke all on function public.get_public_academic_years(text) from public;
revoke all on function public.get_public_admission_config(text) from public;
revoke all on function public.public_admission_submit(text,jsonb,text,jsonb,text[]) from public;
revoke all on function public.public_admission_lookup(text,text) from public;
revoke all on function public.public_admission_complaint_submit(text,text,jsonb) from public;
revoke all on function public.public_admission_complaint_get(text,text) from public;
revoke all on function public.list_institutions() from public;
grant execute on function public.get_public_academic_years(text) to anon, authenticated;
grant execute on function public.get_public_admission_config(text) to anon, authenticated;
grant execute on function public.public_admission_submit(text,jsonb,text,jsonb,text[]) to anon, authenticated;
grant execute on function public.public_admission_lookup(text,text) to anon, authenticated;
grant execute on function public.public_admission_complaint_submit(text,text,jsonb) to anon, authenticated;
grant execute on function public.public_admission_complaint_get(text,text) to anon, authenticated;
grant execute on function public.list_institutions() to authenticated;

-- ---------- 6b) Auditoria de eventos feitos por Edge Functions (service_role) ----------
-- write_audit_service (0003) só sabe registar "create_user"; esta aceita qualquer acção (ex.: delete_user)
-- e mantém a MESMA cadeia de hash, por isso verify_audit_chain continua a validar tudo.
create or replace function public.write_audit_event_service(
  p_inst text, p_actor uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare prev text; h text; ts timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('audit:' || p_inst));
  select hash into prev from public.audit_log where institution_id = p_inst order by seq desc limit 1;
  h := encode(digest(coalesce(prev,'') || p_inst || to_char(ts at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || coalesce(p_actor::text,'') ||
                     p_action || p_entity || coalesce(p_entity_id,'') || coalesce(p_detail::text,''), 'sha256'), 'hex');
  insert into public.audit_log(institution_id, at, actor_id, actor_role, action, entity, entity_id, detail, prev_hash, hash)
  values (p_inst, ts, p_actor, 'admin', p_action, p_entity, p_entity_id, p_detail, prev, h);
end $$;
revoke all on function public.write_audit_event_service(text,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.write_audit_event_service(text,uuid,text,text,text,jsonb) to service_role;

-- ---------- 7) Tempo real: o que muda para um utilizador aparece nos outros ----------
do $$ begin alter publication supabase_realtime add table public.institution_docs;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.user_access;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.user_projections;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.institution_transfers;
exception when duplicate_object then null; when undefined_object then null; end $$;
