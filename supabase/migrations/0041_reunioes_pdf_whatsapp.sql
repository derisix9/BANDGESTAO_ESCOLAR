-- =====================================================================
-- 0041 — Reuniões: agenda/acta em PDF enviada por SMS (link) e WhatsApp (ficheiro directo)
-- 1) A fila de notificações ganha o anexo (PDF) das mensagens de WhatsApp: endereço público da função
--    `meeting-file` + nome do ficheiro. SMS nunca leva anexo (só o link no texto).
-- 2) notification_claim_school passa a devolver esses dois campos ao worker por escola.
--    (claim_notifications devolve q.*, por isso o worker global já os recebe.)
-- Seguro de correr mais do que uma vez.
-- =====================================================================
alter table public.notification_queue add column if not exists attachment_url  text;
alter table public.notification_queue add column if not exists attachment_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notification_queue_attachment_ok') then
    alter table public.notification_queue add constraint notification_queue_attachment_ok
      check ((attachment_url is null or length(attachment_url) <= 400) and (attachment_name is null or length(attachment_name) <= 120));
  end if;
end $$;

drop function if exists public.notification_claim_school(int);
create function public.notification_claim_school(p_limit int default 50)
returns table (id uuid, institution_id text, channel text, to_phone text, body text, category text, attempts int,
               provider text, config jsonb, secret_enc text, critical_only boolean,
               attachment_url text, attachment_name text)
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
         g.provider, g.config, g.secret_enc, g.critical_only, u.attachment_url, u.attachment_name
    from upd u
    join public.notification_gateways g on g.institution_id = u.institution_id and g.channel = u.channel;
end $$;
revoke all on function public.notification_claim_school(int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notification_claim_school(int) to service_role;
  end if;
end $$;
