-- =====================================================================
-- 0039 — Notificações POR ESCOLA: push grátis (Web Push/VAPID), SMS por fornecedor à escolha, WhatsApp só com modelo
--
-- Cada escola liga os SEUS serviços em Configurações → Integrações → Notificações, como já faz com a cópia na nuvem (0018)
-- e com os pagamentos (0038):
--   • push      chaves VAPID da escola (a privada fica cifrada no servidor);
--   • sms       Twilio, Infobip ou um agregador local por API HTTP genérica;
--   • whatsapp  Twilio ou Meta WhatsApp Cloud API, SEMPRE com modelo (template) aprovado.
--
-- Regras de uso dos canais (aplicadas no servidor, não só no ecrã):
--   • push serve para avisos normais (grátis);
--   • SMS só para avisos CRÍTICOS (categoria 'critico', ex.: propina em atraso), se a escola deixar "só crítico" ligado (omissão);
--   • WhatsApp só com modelo aprovado pela Meta.
--
-- Segurança (mesmo padrão de 0018/0038):
--   • credenciais cifradas pela Edge Function (AES-256-GCM, chave fora da BD) e NUNCA devolvidas ao navegador;
--   • estas tabelas não têm acesso para anon/authenticated; o administrador lê o estado por notification_gateway_status();
--   • as escolas com fornecedor próprio ligado deixam de ser servidas pelo worker global (server/notify.ts), sem duplicar envios.
-- Seguro de correr mais do que uma vez. Requer 0011 (fila), 0003/0009 (auditoria), 0023.
-- =====================================================================

-- ---------- Tabelas ----------
create table if not exists public.notification_gateways (
  institution_id  text not null references public.institutions(id) on delete cascade,
  channel         text not null check (channel in ('sms', 'whatsapp', 'push')),
  provider        text not null,
  enabled         boolean not null default false,
  config          jsonb not null default '{}'::jsonb,        -- só campos NÃO secretos (remetente, modelo, endereço, chave pública VAPID…)
  secret_enc      text,                                      -- cifrado pela Edge Function
  critical_only   boolean not null default true,             -- só no SMS: apenas avisos críticos
  last_test_at    timestamptz, last_test_ok boolean, last_test_error text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (institution_id, channel),
  constraint notification_gateways_provider_ok check (
       (channel = 'sms'      and provider in ('twilio', 'infobip', 'http'))
    or (channel = 'whatsapp' and provider in ('twilio', 'meta_cloud'))
    or (channel = 'push'     and provider = 'webpush'))
);

create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  institution_id  text not null references public.institutions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  endpoint        text not null unique,                       -- um aparelho/navegador = um endereço
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_ok_at      timestamptz,
  fail_count      int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (institution_id, user_id);

alter table public.notification_gateways enable row level security;     -- sem políticas: só service_role
alter table public.push_subscriptions    enable row level security;
revoke all on public.notification_gateways, public.push_subscriptions from anon, authenticated;

-- A fila ganha a categoria do aviso (decide se o SMS é permitido).
alter table public.notification_queue add column if not exists category text not null default 'normal';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notification_queue_category_ok') then
    alter table public.notification_queue add constraint notification_queue_category_ok check (category in ('normal', 'critico'));
  end if;
end $$;

-- ---------- O worker global (server/notify.ts) não serve as escolas que ligaram o SEU fornecedor ----------
create or replace function public.claim_notifications(p_limit int default 50)
returns setof public.notification_queue
language sql security definer set search_path = public, pg_temp as $$
  update public.notification_queue q
     set status = 'sending', attempts = q.attempts + 1
   where q.id in (select n.id from public.notification_queue n
                   where n.status = 'pending' and n.next_attempt_at <= now()
                     and not exists (select 1 from public.notification_gateways g
                                      where g.institution_id = n.institution_id and g.channel = n.channel
                                        and g.enabled and g.secret_enc is not null)
                   order by n.next_attempt_at
                   for update skip locked
                   limit least(greatest(p_limit,1), 200))
  returning q.*;
$$;

-- ---------- Leitura para a aplicação ----------
-- Qualquer utilizador da escola: que canais estão ligados (decide o que mostra) e a chave PÚBLICA do push.
create or replace function public.notification_channels_enabled() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sms',           coalesce(bool_or(g.enabled and g.secret_enc is not null) filter (where g.channel = 'sms'), false),
    'whatsapp',      coalesce(bool_or(g.enabled and g.secret_enc is not null) filter (where g.channel = 'whatsapp'), false),
    'push',          coalesce(bool_or(g.enabled and g.secret_enc is not null) filter (where g.channel = 'push'), false),
    'smsCriticalOnly', coalesce(bool_or(g.critical_only) filter (where g.channel = 'sms'), true),
    'pushPublicKey', max(g.config ->> 'publicKey') filter (where g.channel = 'push' and g.enabled and g.secret_enc is not null))
  from public.notification_gateways g
  where g.institution_id = app.current_institution()
$$;
revoke all on function public.notification_channels_enabled() from public, anon;
grant execute on function public.notification_channels_enabled() to authenticated;

-- Quem pode enviar avisos: a mesma permissão da colecção smsWhatsappNotifications (escrita).
create or replace function public.notification_can_send() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_institution() is not null and app.can_access('smsWhatsappNotifications', 'write'), false)
$$;
revoke all on function public.notification_can_send() from public, anon;
grant execute on function public.notification_can_send() to authenticated;

-- Só o administrador: configuração (sem segredos), contagens e aparelhos com push.
create or replace function public.notification_gateway_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); chans jsonb; cnt jsonb; devices int; users int;
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola vê as notificações' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(g.channel, jsonb_build_object(
           'provider', g.provider, 'enabled', g.enabled, 'config', g.config, 'hasSecret', g.secret_enc is not null,
           'criticalOnly', g.critical_only,
           'lastTestAt', g.last_test_at, 'lastTestOk', g.last_test_ok, 'lastTestError', g.last_test_error)), '{}'::jsonb)
    into chans from public.notification_gateways g where g.institution_id = inst;
  select jsonb_build_object(
           'enviadas7d',  count(*) filter (where status = 'sent'    and created_at > now() - interval '7 days'),
           'falhadas7d',  count(*) filter (where status = 'failed'  and created_at > now() - interval '7 days'),
           'naFila',      count(*) filter (where status in ('pending', 'sending')),
           'ultimoErro',  (select q.last_error from public.notification_queue q
                            where q.institution_id = inst and q.last_error is not null order by q.created_at desc limit 1))
    into cnt from public.notification_queue where institution_id = inst;
  select count(*), count(distinct user_id) into devices, users from public.push_subscriptions where institution_id = inst;
  return jsonb_build_object('institutionId', inst, 'channels', chans, 'counts', coalesce(cnt, '{}'::jsonb),
                            'pushDevices', devices, 'pushUsers', users);
end $$;
revoke all on function public.notification_gateway_status() from public, anon;
grant execute on function public.notification_gateway_status() to authenticated;

-- ---------- Só service_role ----------

-- Worker por escola: reserva um lote das escolas com fornecedor próprio ligado e devolve a configuração de cada uma.
create or replace function public.notification_claim_school(p_limit int default 50)
returns table (id uuid, institution_id text, channel text, to_phone text, body text, category text, attempts int,
               provider text, config jsonb, secret_enc text, critical_only boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select q.id from public.notification_queue q
      join public.notification_gateways g on g.institution_id = q.institution_id and g.channel = q.channel
                                         and g.enabled and g.secret_enc is not null
     where q.status = 'pending' and q.next_attempt_at <= now()
     order by q.next_attempt_at
       for update of q skip locked
     limit least(greatest(p_limit, 1), 200)
  ), upd as (
    update public.notification_queue q set status = 'sending', attempts = q.attempts + 1
      from picked where q.id = picked.id
    returning q.*
  )
  select u.id, u.institution_id, u.channel, u.to_phone, u.body, u.category, u.attempts,
         g.provider, g.config, g.secret_enc, g.critical_only
    from upd u
    join public.notification_gateways g on g.institution_id = u.institution_id and g.channel = u.channel;
end $$;

-- Falha definitiva (número inválido, SMS não permitido para este tipo de aviso…): não repete.
create or replace function public.notification_skip(p_id uuid, p_reason text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notification_queue
     set status = 'failed', last_error = left(p_reason, 500)
   where id = p_id and status = 'sending'
$$;

-- Quem recebe um push. p_kind: 'todos' | 'professores' | 'funcionarios' | 'alunos' (ids = alunos: o próprio aluno e os seus
-- encarregados) | 'utilizadores' (ids = ids de utilizador). Só contas activas DESTA escola.
create or replace function public.notification_push_targets(p_inst text, p_kind text, p_ids text[] default '{}')
returns table (id uuid, user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id and p.institution_id = p_inst and p.active
   where s.institution_id = p_inst
     and case p_kind
           when 'todos'        then true
           when 'professores'  then p.role = 'professor'
           when 'funcionarios' then p.role in ('admin', 'director', 'secretaria', 'financeiro', 'funcionario')
           when 'utilizadores' then p.id::text = any (coalesce(p_ids, '{}'))
           when 'alunos'       then
             p.linked_student_id = any (coalesce(p_ids, '{}'))
             or (p.role = 'encarregado' and exists (
                   select 1 from public.user_projections up
                    where up.institution_id = p_inst and up.user_id = p.id
                      and jsonb_typeof(up.data -> 'students') = 'array'
                      and exists (select 1 from jsonb_array_elements(up.data -> 'students') e where e ->> 'id' = any (coalesce(p_ids, '{}')))))
           else false
         end
$$;

-- Estado de uma escola para o worker: a configuração de um canal (devolve nada se não estiver ligado).
create or replace function public.notification_gateway_get(p_inst text, p_channel text)
returns table (provider text, config jsonb, secret_enc text, critical_only boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.provider, g.config, g.secret_enc, g.critical_only
    from public.notification_gateways g
   where g.institution_id = p_inst and g.channel = p_channel and g.enabled and g.secret_enc is not null
$$;

revoke all on function public.notification_claim_school(int), public.notification_skip(uuid, text),
  public.notification_push_targets(text, text, text[]), public.notification_gateway_get(text, text)
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notification_claim_school(int), public.notification_skip(uuid, text),
      public.notification_push_targets(text, text, text[]), public.notification_gateway_get(text, text) to service_role;
    grant select, insert, update, delete on public.notification_gateways, public.push_subscriptions to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
