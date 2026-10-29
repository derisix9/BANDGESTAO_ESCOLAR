-- =====================================================================
-- 0011: fila de SMS/WhatsApp com reenvio + tarefas agendadas (pg_cron)
-- A app só ENFILEIRA. Quem envia é o worker (server/notify.ts ou uma Edge Function)
-- com a chave service_role, usando claim_notifications / finish_notification.
-- =====================================================================
create table public.notification_queue (
  id              uuid primary key default gen_random_uuid(),
  institution_id  text not null references public.institutions(id) on delete cascade,
  channel         text not null check (channel in ('sms','whatsapp')),
  to_phone        text not null,                       -- E.164, ex.: +244923000000
  body            text not null check (length(body) between 1 and 1600),
  status          text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts        int  not null default 0,
  max_attempts    int  not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  provider_id     text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index notif_due_idx on public.notification_queue (next_attempt_at) where status = 'pending';
create index notif_inst_idx on public.notification_queue (institution_id, created_at desc);
alter table public.notification_queue enable row level security;

-- Quem pode ler/enfileirar segue a permissão da colecção smsWhatsappNotifications
create policy nq_read on public.notification_queue for select to authenticated
  using (institution_id = app.current_institution() and app.can_access('smsWhatsappNotifications','read'));
create policy nq_insert on public.notification_queue for insert to authenticated
  with check (institution_id = app.current_institution() and app.can_access('smsWhatsappNotifications','write')
              and status = 'pending' and attempts = 0 and sent_at is null and provider_id is null);
grant select, insert on public.notification_queue to authenticated;
-- sem UPDATE/DELETE para o cliente: o estado só muda pelo worker

create or replace function app.nq_defaults() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger nq_defaults before insert on public.notification_queue
  for each row execute function app.nq_defaults();

-- Worker: reserva um lote (SKIP LOCKED permite vários workers sem duplicar envios)
create or replace function public.claim_notifications(p_limit int default 50)
returns setof public.notification_queue
language sql security definer set search_path = public, pg_temp as $$
  update public.notification_queue q
     set status = 'sending', attempts = q.attempts + 1
   where q.id in (select id from public.notification_queue
                   where status = 'pending' and next_attempt_at <= now()
                   order by next_attempt_at
                   for update skip locked
                   limit least(greatest(p_limit,1), 200))
  returning q.*;
$$;

-- Worker: resultado do envio. Falha -> novo agendamento com recuo exponencial (2, 4, 8... minutos)
create or replace function public.finish_notification(p_id uuid, p_ok boolean, p_provider_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notification_queue q set
    status = case when p_ok then 'sent' when q.attempts >= q.max_attempts then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() else q.sent_at end,
    provider_id = coalesce(p_provider_id, q.provider_id),
    last_error = case when p_ok then null else left(p_error, 500) end,
    next_attempt_at = case when p_ok or q.attempts >= q.max_attempts then q.next_attempt_at
                           else now() + (power(2, q.attempts) * interval '1 minute') end
  where q.id = p_id and q.status = 'sending';
end $$;

revoke all on function public.claim_notifications(int), public.finish_notification(uuid,boolean,text,text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_notifications(int), public.finish_notification(uuid,boolean,text,text) to service_role;
  end if;
end $$;

-- ---------- Tarefas de manutenção (chamadas pelo pg_cron) ----------
-- Mensagens "a enviar" há mais de 10 min (worker caiu): voltam à fila
create or replace function app.job_requeue_stuck() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.notification_queue set status = 'pending', next_attempt_at = now()
   where status = 'sending' and next_attempt_at < now() - interval '10 minutes' and attempts < max_attempts;
  update public.notification_queue set status = 'failed', last_error = coalesce(last_error, 'worker interrompido')
   where status = 'sending' and next_attempt_at < now() - interval '10 minutes' and attempts >= max_attempts;
$$;

-- Apaga mensagens já tratadas há mais de 90 dias
create or replace function app.job_purge_notifications() returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.notification_queue where status in ('sent','failed') and created_at < now() - interval '90 days';
$$;

-- Facturas pendentes com vencimento ultrapassado passam a "atraso" (só datas ISO yyyy-mm-dd).
-- Corre como postgres (auth.uid() nulo), por isso o trigger de escrita deixa passar; pagamentos não são tocados.
create or replace function app.job_mark_overdue() returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  update public.records
     set data = data || jsonb_build_object('status', 'atraso', 'daysLate', (current_date - (data ->> 'dueDate')::date))
   where collection = 'invoices'
     and data ->> 'status' = 'pendente'
     and data ->> 'dueDate' ~ '^\d{4}-\d{2}-\d{2}$'
     and (data ->> 'dueDate')::date < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function app.job_requeue_stuck(), app.job_purge_notifications(), app.job_mark_overdue() from public, anon, authenticated;

-- Agendamento: só se o pg_cron estiver disponível (no Supabase: Database > Extensions > pg_cron).
-- Em Postgres local/CI sem pg_cron, esta parte é ignorada.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobname) from cron.job where jobname in ('bm_requeue_stuck','bm_purge_notifications','bm_mark_overdue');
    perform cron.schedule('bm_requeue_stuck',       '*/5 * * * *', 'select app.job_requeue_stuck()');
    perform cron.schedule('bm_purge_notifications', '30 3 * * *',  'select app.job_purge_notifications()');
    perform cron.schedule('bm_mark_overdue',        '10 0 * * *',  'select app.job_mark_overdue()');   -- 00:10 UTC
  else
    raise notice 'pg_cron indisponível: tarefas NÃO agendadas';
  end if;
end $$;
