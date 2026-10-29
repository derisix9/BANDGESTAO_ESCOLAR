-- =====================================================================
-- 0038 — Pagamentos AUTOMÁTICOS por referência Multicaixa (ATM, Multicaixa Express, homebanking)
--
-- Cada escola liga o SEU fornecedor (hoje: ProxyPay) com a SUA chave de API, em Configurações → Integrações.
-- O servidor (Edge Functions `payments` e `payments-webhook`) pede ao fornecedor uma referência por factura,
-- grava-a na factura (multicaixaEntity / multicaixaRef) e, quando o encarregado paga, o fornecedor avisa o
-- servidor e a factura fica paga sozinha, com recibo, pagamento no razão (`payments`) e auditoria.
--
-- Segurança (mesmo padrão da cópia na nuvem, 0018):
--   • a chave de API fica cifrada pela Edge Function (AES-256-GCM, chave fora da BD) e NUNCA volta ao navegador;
--   • estas tabelas não têm acesso para anon/authenticated; o administrador lê o estado por
--     public.payment_gateway_status() (sem segredos);
--   • o estado "pago" só muda aqui dentro (app.rpc = 'payment'), como em register_payment (0003);
--   • idempotente: o mesmo aviso repetido não paga duas vezes (payment_events + payments.idempotency_key).
-- Seguro de correr mais do que uma vez. Requer 0003, 0009 (write_audit), 0023 e 0029 (user_projections).
-- =====================================================================

-- O pagamento automático não tem um utilizador a registá-lo: quem regista é o servidor.
alter table public.payments alter column registered_by drop not null;

create sequence if not exists public.payment_receipt_seq;

-- ---------- Ajudantes ----------
create or replace function app.pay_num(p text) returns numeric
language sql immutable as $$
  select case when p ~ '^-?[0-9]+(\.[0-9]+)?$' then p::numeric else 0 end
$$;

-- 9 dígitos agrupados de 3 em 3, como o ATM mostra: 475545250 -> "475 545 250"
create or replace function app.pay_format_ref(p text) returns text
language sql immutable as $$
  select case when length(p) > 9 then p
              else substr(lpad(p, 9, '0'), 1, 3) || ' ' || substr(lpad(p, 9, '0'), 4, 3) || ' ' || substr(lpad(p, 9, '0'), 7, 3) end
$$;

-- Altera campos de UMA factura (registo + cópias nas projecções do aluno/encarregado) como o servidor.
-- Corre com app.rpc = 'payment' (única forma permitida de mexer no estado de pagamento) e sobe a versão.
create or replace function app.pay_patch_invoice(p_inst text, p_invoice_id text, p_patch jsonb, p_remove text[] default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.rpc', 'payment', true);
  update public.records
     set data = (data - coalesce(p_remove, '{}'::text[])) || coalesce(p_patch, '{}'::jsonb),
         version = version + 1, updated_at = now()
   where institution_id = p_inst and collection = 'invoices' and id = p_invoice_id;
  perform set_config('app.rpc', '', true);

  update public.user_projections up
     set data = jsonb_set(up.data, '{invoices}',
           (select coalesce(jsonb_agg(case when e.v ->> 'id' = p_invoice_id
                                           then (e.v - coalesce(p_remove, '{}'::text[])) || coalesce(p_patch, '{}'::jsonb)
                                           else e.v end order by e.ord), '[]'::jsonb)
              from jsonb_array_elements(up.data -> 'invoices') with ordinality as e(v, ord))),
         updated_at = now()
   where up.institution_id = p_inst
     and jsonb_typeof(up.data -> 'invoices') = 'array'
     and exists (select 1 from jsonb_array_elements(up.data -> 'invoices') x where x ->> 'id' = p_invoice_id);
end $$;
revoke all on function app.pay_patch_invoice(text, text, jsonb, text[]) from public, anon, authenticated;

-- ---------- Tabelas ----------
create table if not exists public.payment_gateways (
  institution_id   text primary key references public.institutions(id) on delete cascade,
  provider         text not null check (provider in ('proxypay')),
  enabled          boolean not null default false,
  sandbox          boolean not null default true,                       -- começa SEMPRE em teste
  entity           text not null check (entity ~ '^[0-9]{5}$'),         -- entidade Multicaixa (5 dígitos)
  validity_days    int  not null default 30 check (validity_days between 7 and 365),
  secret_enc       text,                                                -- cifrado pela Edge Function
  last_test_at     timestamptz, last_test_ok boolean, last_test_error text,
  last_sync_at     timestamptz, last_sync_ok boolean, last_sync_error text,
  syncing_since    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.payment_references (
  id              uuid primary key default gen_random_uuid(),
  institution_id  text not null references public.institutions(id) on delete cascade,
  invoice_id      text not null,
  provider        text not null,
  entity          text not null,
  reference_id    text,                                                 -- só dígitos, sem zeros à esquerda; null enquanto é gerada
  amount_kz       numeric(14,2) not null check (amount_kz > 0),
  expires_on      date not null,
  sandbox         boolean not null default false,
  status          text not null default 'ativa' check (status in ('ativa', 'paga', 'expirada', 'cancelada')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
-- No máximo UMA referência activa por factura (corrida entre dois cliques = o segundo espera).
create unique index if not exists payment_references_one_active on public.payment_references (institution_id, invoice_id) where status = 'ativa';
create unique index if not exists payment_references_ref on public.payment_references (institution_id, provider, sandbox, reference_id) where reference_id is not null;
create index if not exists payment_references_invoice_idx on public.payment_references (institution_id, invoice_id, created_at desc);

create table if not exists public.payment_events (
  id              bigint generated always as identity primary key,
  institution_id  text not null references public.institutions(id) on delete cascade,
  provider        text not null,
  event_key       text not null,                                        -- id do pagamento no fornecedor
  received_at     timestamptz not null default now(),
  reference_id    text,
  invoice_id      text,
  amount_kz       numeric(14,2),
  outcome         text not null default 'recebido'
                  check (outcome in ('recebido', 'aplicado', 'valor_diferente', 'ja_paga', 'sem_referencia', 'erro')),
  detail          text,
  payload         jsonb,                                                -- aviso bruto do fornecedor (auditoria)
  unique (institution_id, provider, event_key)
);
create index if not exists payment_events_idx on public.payment_events (institution_id, received_at desc);

alter table public.payment_gateways   enable row level security;         -- sem políticas: só service_role
alter table public.payment_references enable row level security;
alter table public.payment_events     enable row level security;
revoke all on public.payment_gateways, public.payment_references, public.payment_events from anon, authenticated;

-- ---------- Leitura para a aplicação ----------
-- Qualquer utilizador da escola: "os pagamentos por referência estão activos?" (decide se mostra o botão Pagar)
create or replace function public.payment_gateway_enabled() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select g.enabled and g.secret_enc is not null
                     from public.payment_gateways g where g.institution_id = app.current_institution()), false)
$$;
revoke all on function public.payment_gateway_enabled() from public, anon;
grant execute on function public.payment_gateway_enabled() to authenticated;

-- Só o administrador: configuração (sem segredos), contagens e últimos avisos.
create or replace function public.payment_gateway_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); g record; evs jsonb; cnt jsonb;
begin
  if inst is null or app.current_role() is distinct from 'admin' then
    raise exception 'Só o administrador da escola vê os pagamentos por referência' using errcode = '42501';
  end if;
  select * into g from public.payment_gateways where institution_id = inst;
  select coalesce(jsonb_agg(jsonb_build_object('at', e.received_at, 'outcome', e.outcome, 'reference', e.reference_id,
                                               'invoiceId', e.invoice_id, 'amountKz', e.amount_kz, 'detail', e.detail)
                            order by e.received_at desc), '[]'::jsonb)
    into evs from (select * from public.payment_events where institution_id = inst order by received_at desc limit 15) e;
  select jsonb_build_object(
           'ativas',    count(*) filter (where status = 'ativa' and reference_id is not null),
           'pagas',     count(*) filter (where status = 'paga'),
           'expiradas', count(*) filter (where status = 'expirada'),
           'paraRever', (select count(*) from public.payment_events pe
                          where pe.institution_id = inst and pe.outcome in ('valor_diferente', 'ja_paga', 'sem_referencia', 'erro')
                            and pe.received_at > now() - interval '90 days'))
    into cnt from public.payment_references where institution_id = inst;
  return jsonb_build_object(
    'institutionId', inst,
    'configured', g.institution_id is not null, 'provider', g.provider, 'enabled', coalesce(g.enabled, false),
    'sandbox', coalesce(g.sandbox, true), 'entity', g.entity, 'validityDays', coalesce(g.validity_days, 30),
    'hasSecret', g.secret_enc is not null,
    'lastTestAt', g.last_test_at, 'lastTestOk', g.last_test_ok, 'lastTestError', g.last_test_error,
    'lastSyncAt', g.last_sync_at, 'lastSyncOk', g.last_sync_ok, 'lastSyncError', g.last_sync_error,
    'counts', coalesce(cnt, '{}'::jsonb), 'events', evs);
end $$;
revoke all on function public.payment_gateway_status() from public, anon;
grant execute on function public.payment_gateway_status() to authenticated;

-- ---------- Só service_role ----------

-- Quem pode pedir referência de UMA factura: o aluno/encarregado só das facturas que a sua projecção contém.
create or replace function public.payment_portal_can_pay(p_inst text, p_uid uuid, p_invoice_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_projections up
     where up.institution_id = p_inst and up.user_id = p_uid
       and jsonb_typeof(up.data -> 'invoices') = 'array'
       and exists (select 1 from jsonb_array_elements(up.data -> 'invoices') e where e ->> 'id' = p_invoice_id))
$$;

-- Escola a quem pertence uma entidade (para um webhook sem ?school=): só se for inequívoco.
create or replace function public.payment_gateway_by_entity(p_provider text, p_entity text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when count(*) = 1 then min(institution_id) else null end
    from public.payment_gateways
   where provider = p_provider and entity = p_entity and secret_enc is not null
$$;

-- Cancela as referências activas (mudou de ambiente/entidade/fornecedor, ou desligou) e limpa-as das facturas.
create or replace function public.payment_references_reset(p_inst text, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select invoice_id from public.payment_references where institution_id = p_inst and status = 'ativa' loop
    perform app.pay_patch_invoice(p_inst, r.invoice_id, '{}'::jsonb,
            array['multicaixaEntity', 'multicaixaRef', 'multicaixaExpires', 'multicaixaAmountKz']);
    n := n + 1;
  end loop;
  update public.payment_references set status = 'cancelada' where institution_id = p_inst and status = 'ativa';
  if n > 0 then
    perform app.write_audit(p_inst, 'RPC:payment_references_reset', 'school', p_inst, jsonb_build_object('cancelled', n, 'reason', left(p_reason, 120)));
  end if;
  return n;
end $$;

-- Passo 1 de "gerar referência": valida a factura, devolve a referência existente (se ainda serve) ou RESERVA uma nova.
-- O valor é SEMPRE calculado aqui (total − já pago), nunca vem do pedido.
create or replace function public.payment_reference_reserve(p_inst text, p_invoice_id text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  gw public.payment_gateways; inv public.records; cur public.payment_references;
  due numeric; st text; stale text := null; new_id uuid; exp date;
  today date := (now() at time zone 'Africa/Luanda')::date;
begin
  select * into gw from public.payment_gateways where institution_id = p_inst;
  if not found or not gw.enabled or gw.secret_enc is null then
    raise exception 'Os pagamentos por referência não estão activos nesta escola' using errcode = '22023';
  end if;
  if not exists (select 1 from public.institutions where id = p_inst and status = 'active') then
    raise exception 'Escola inactiva' using errcode = '22023';
  end if;

  select * into inv from public.records
   where institution_id = p_inst and collection = 'invoices' and id = p_invoice_id for update;
  if not found then raise exception 'Factura não encontrada' using errcode = '22023'; end if;
  st := coalesce(inv.data ->> 'status', 'pendente');
  if st in ('pago', 'isento') then raise exception 'Esta factura já está liquidada' using errcode = '22023'; end if;
  due := round(app.pay_num(inv.data ->> 'totalAmountKz') - app.pay_num(inv.data ->> 'totalPaidKz'), 2);
  if due < 0.01 then raise exception 'Esta factura não tem valor em dívida' using errcode = '22023'; end if;

  update public.payment_references set status = 'expirada'
   where institution_id = p_inst and invoice_id = p_invoice_id and status = 'ativa' and expires_on < today;
  delete from public.payment_references                    -- reservas que ficaram a meio (falha do servidor)
   where institution_id = p_inst and invoice_id = p_invoice_id and status = 'ativa'
     and reference_id is null and created_at < now() - interval '5 minutes';

  select * into cur from public.payment_references
   where institution_id = p_inst and invoice_id = p_invoice_id and status = 'ativa';
  if found then
    if cur.reference_id is null then
      return jsonb_build_object('state', 'a_gerar');
    end if;
    if cur.entity = gw.entity and cur.sandbox = gw.sandbox and abs(cur.amount_kz - due) < 0.01 then
      return jsonb_build_object('state', 'existente', 'reference', app.pay_format_ref(cur.reference_id), 'entity', cur.entity,
                                'amount', cur.amount_kz, 'expires_on', cur.expires_on);
    end if;
    stale := cur.reference_id;                              -- valor/entidade mudou: a antiga deixa de servir
    update public.payment_references set status = 'cancelada' where id = cur.id;
  end if;

  exp := today + gw.validity_days;
  begin
    insert into public.payment_references (institution_id, invoice_id, provider, entity, amount_kz, expires_on, sandbox, created_by)
    values (p_inst, p_invoice_id, gw.provider, gw.entity, due, exp, gw.sandbox, p_user)
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('state', 'a_gerar');
  end;
  return jsonb_build_object('state', 'nova', 'id', new_id, 'amount', due, 'expires_on', exp, 'entity', gw.entity,
                            'sandbox', gw.sandbox, 'provider', gw.provider,
                            'invoice_number', inv.data ->> 'invoiceNumber', 'stale_reference', stale);
end $$;

-- Passo 2 (o fornecedor criou a referência): grava-a na reserva e na factura (e nas projecções do portal).
create or replace function public.payment_reference_commit(p_id uuid, p_reference_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ref public.payment_references; shown text; norm text;
begin
  norm := regexp_replace(coalesce(p_reference_id, ''), '^0+', '');
  if norm !~ '^[0-9]{1,12}$' then raise exception 'Referência inválida devolvida pelo fornecedor' using errcode = '22023'; end if;
  select * into ref from public.payment_references where id = p_id and status = 'ativa' and reference_id is null for update;
  if not found then raise exception 'A reserva da referência já não existe' using errcode = '22023'; end if;
  update public.payment_references set reference_id = norm where id = p_id;
  shown := app.pay_format_ref(norm);
  perform app.pay_patch_invoice(ref.institution_id, ref.invoice_id,
    jsonb_build_object('multicaixaEntity', ref.entity, 'multicaixaRef', shown,
                       'multicaixaExpires', to_char(ref.expires_on, 'YYYY-MM-DD'), 'multicaixaAmountKz', ref.amount_kz));
  perform app.write_audit(ref.institution_id, 'RPC:payment_reference_created', 'invoices', ref.invoice_id,
    jsonb_build_object('reference', shown, 'entity', ref.entity, 'amount', ref.amount_kz, 'expires_on', ref.expires_on,
                       'sandbox', ref.sandbox, 'by', ref.created_by));
  return jsonb_build_object('reference', shown, 'entity', ref.entity, 'amount', ref.amount_kz, 'expires_on', ref.expires_on);
end $$;

-- O fornecedor falhou: liberta a reserva para tentar de novo.
create or replace function public.payment_reference_abort(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.payment_references where id = p_id and status = 'ativa' and reference_id is null
$$;

-- Cancela a referência activa de uma factura. Devolve o id para o servidor a apagar também no fornecedor.
create or replace function public.payment_reference_cancel(p_inst text, p_invoice_id text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare ref public.payment_references;
begin
  select * into ref from public.payment_references
   where institution_id = p_inst and invoice_id = p_invoice_id and status = 'ativa' for update;
  if not found then return null; end if;
  update public.payment_references set status = 'cancelada' where id = ref.id;
  perform app.pay_patch_invoice(p_inst, p_invoice_id, '{}'::jsonb,
          array['multicaixaEntity', 'multicaixaRef', 'multicaixaExpires', 'multicaixaAmountKz']);
  perform app.write_audit(p_inst, 'RPC:payment_reference_cancelled', 'invoices', p_invoice_id,
          jsonb_build_object('reference', ref.reference_id, 'by', p_user));
  return jsonb_build_object('reference_id', ref.reference_id, 'sandbox', ref.sandbox);
end $$;

-- Referências vencidas: passam a "expirada" e deixam de aparecer na factura (que pode pedir uma nova).
create or replace function public.payment_expire_due() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; today date := (now() at time zone 'Africa/Luanda')::date;
begin
  delete from public.payment_references where status = 'ativa' and reference_id is null and created_at < now() - interval '10 minutes';
  for r in
    with u as (update public.payment_references set status = 'expirada'
                where status = 'ativa' and reference_id is not null and expires_on < today
            returning institution_id, invoice_id)
    select * from u
  loop
    perform app.pay_patch_invoice(r.institution_id, r.invoice_id, '{}'::jsonb,
            array['multicaixaEntity', 'multicaixaRef', 'multicaixaExpires', 'multicaixaAmountKz']);
    n := n + 1;
  end loop;
  return n;
end $$;

-- O CORAÇÃO: um pagamento confirmado pelo fornecedor (webhook ou consulta periódica).
-- Devolve { outcome: aplicado | valor_diferente | ja_paga | sem_referencia | duplicado, invoice_id, status }.
--   aplicado         valor certo
--   valor_diferente  pagou valor diferente do pedido (o dinheiro entrou: fica registado; a secretaria revê)
--   ja_paga          a factura já estava paga: possível pagamento em duplicado (rever/reembolsar)
--   sem_referencia   referência desconhecida desta escola, ou factura apagada (rever à mão)
--   duplicado        o mesmo aviso repetido: ignorado, nada é pago duas vezes
create or replace function public.payment_apply_event(
  p_inst text, p_provider text, p_event_key text, p_reference text, p_amount numeric, p_paid_at timestamptz, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ev_id bigint; ref public.payment_references; inv public.records;
  total numeric; paid numeric; new_status text; v_outcome text; was_paid boolean; norm text;
  pay_date text; patch jsonb; student_id text; v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Valor do pagamento inválido' using errcode = '22023'; end if;
  if coalesce(p_event_key, '') = '' then raise exception 'Aviso sem identificador' using errcode = '22023'; end if;
  norm := regexp_replace(coalesce(p_reference, ''), '[^0-9]', '', 'g');
  norm := regexp_replace(norm, '^0+', '');

  insert into public.payment_events (institution_id, provider, event_key, reference_id, amount_kz, payload)
  values (p_inst, p_provider, p_event_key, nullif(norm, ''), p_amount, p_payload)
  on conflict (institution_id, provider, event_key) do update set payload = excluded.payload
    where public.payment_events.outcome in ('recebido', 'erro')          -- reprocessa só o que ainda não foi aplicado
  returning id into ev_id;
  if ev_id is null then return jsonb_build_object('outcome', 'duplicado'); end if;

  select * into ref from public.payment_references
   where institution_id = p_inst and provider = p_provider and reference_id = norm
   order by created_at desc limit 1;
  if not found then
    update public.payment_events set outcome = 'sem_referencia', detail = 'Referência desconhecida desta escola' where id = ev_id;
    perform app.write_audit(p_inst, 'RPC:payment_unmatched', 'school', p_inst,
            jsonb_build_object('provider', p_provider, 'event', p_event_key, 'reference', norm, 'amount', p_amount));
    return jsonb_build_object('outcome', 'sem_referencia');
  end if;

  select * into inv from public.records
   where institution_id = p_inst and collection = 'invoices' and id = ref.invoice_id for update;
  if not found then
    update public.payment_events set outcome = 'sem_referencia', invoice_id = ref.invoice_id, detail = 'A factura já não existe' where id = ev_id;
    return jsonb_build_object('outcome', 'sem_referencia', 'invoice_id', ref.invoice_id);
  end if;

  was_paid := coalesce(inv.data ->> 'status', '') = 'pago';
  insert into public.payments (institution_id, invoice_id, amount_kz, method, reference, idempotency_key, registered_by, paid_at)
  values (p_inst, ref.invoice_id, p_amount, 'multicaixa', app.pay_format_ref(norm), 'pay:' || p_provider || ':' || p_event_key, null, v_paid_at)
  on conflict (institution_id, idempotency_key) do nothing;

  total := app.pay_num(inv.data ->> 'totalAmountKz');
  select coalesce(sum(amount_kz), 0) into paid from public.payments where institution_id = p_inst and invoice_id = ref.invoice_id;
  new_status := case when total > 0 and paid >= total - 0.009 then 'pago' else coalesce(inv.data ->> 'status', 'pendente') end;
  pay_date := to_char(v_paid_at at time zone 'Africa/Luanda', 'YYYY-MM-DD');

  patch := jsonb_build_object('status', new_status, 'totalPaidKz', paid, 'paymentDate', pay_date,
                              'method', 'multicaixa', 'methodLabel', 'Referência Multicaixa (pagamento automático)',
                              'transactionNumber', p_event_key);
  if new_status = 'pago' and coalesce(inv.data ->> 'receiptNumber', '') = '' then
    patch := patch || jsonb_build_object('receiptNumber',
             'RC ' || to_char(v_paid_at at time zone 'Africa/Luanda', 'YYYY') || '/MC' || lpad(nextval('public.payment_receipt_seq')::text, 6, '0'),
             'receiptGeneratedAt', pay_date);
  end if;
  perform app.pay_patch_invoice(p_inst, ref.invoice_id, patch,
          case when new_status = 'pago' then array['multicaixaExpires'] else '{}'::text[] end);

  if new_status = 'pago' then
    update public.payment_references set status = 'paga', paid_at = coalesce(public.payment_references.paid_at, v_paid_at) where id = ref.id;
    -- o aluno deixa de aparecer em dívida se não tiver mais nenhuma factura em atraso
    student_id := inv.data ->> 'studentId';
    if student_id is not null and not exists (
         select 1 from public.records r
          where r.institution_id = p_inst and r.collection = 'invoices' and r.id <> ref.invoice_id
            and r.data ->> 'studentId' = student_id and r.data ->> 'status' = 'atraso') then
      update public.records
         set data = data || '{"financialStatus":"regular"}'::jsonb, version = version + 1, updated_at = now()
       where institution_id = p_inst and collection = 'students' and id = student_id
         and data ->> 'financialStatus' = 'debito';
    end if;
  end if;

  v_outcome := case when was_paid then 'ja_paga'
                    when abs(p_amount - ref.amount_kz) > 0.009 then 'valor_diferente'
                    else 'aplicado' end;
  update public.payment_events
     set outcome = v_outcome, invoice_id = ref.invoice_id,
         detail = case v_outcome
                    when 'ja_paga' then 'A factura já estava paga: possível pagamento em duplicado (rever/reembolsar)'
                    when 'valor_diferente' then format('Pedido %s Kz, pago %s Kz', ref.amount_kz, p_amount)
                    else null end
   where id = ev_id;
  perform app.write_audit(p_inst, 'RPC:payment_by_reference', 'invoices', ref.invoice_id,
          jsonb_build_object('provider', p_provider, 'event', p_event_key, 'reference', norm, 'amount', p_amount,
                             'paid_total', paid, 'status', new_status, 'outcome', v_outcome));
  return jsonb_build_object('outcome', v_outcome, 'invoice_id', ref.invoice_id, 'status', new_status);
end $$;

-- Falhou a meio (a transacção anterior foi desfeita): fica o rasto do erro e o fornecedor repete mais tarde.
create or replace function public.payment_event_fail(p_inst text, p_provider text, p_event_key text, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.payment_events (institution_id, provider, event_key, outcome, detail)
  values (p_inst, p_provider, p_event_key, 'erro', left(p_error, 300))
  on conflict (institution_id, provider, event_key) do update set outcome = 'erro', detail = left(p_error, 300)
   where public.payment_events.outcome in ('recebido', 'erro')
$$;

-- Consulta periódica (rede de segurança do webhook): reserva as escolas ligadas que não sincronizam há ≥ 4 min.
create or replace function public.payment_sync_claim_due(p_limit int default 5)
returns table (inst text, prov text, sandbox boolean, secret text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select g.institution_id as iid
      from public.payment_gateways g
      join public.institutions i on i.id = g.institution_id
     where g.enabled and g.secret_enc is not null and i.status = 'active'
       and (g.last_sync_at is null or g.last_sync_at < now() - interval '4 minutes')
       and (g.syncing_since is null or g.syncing_since < now() - interval '10 minutes')
     order by g.last_sync_at nulls first
       for update of g skip locked
     limit least(greatest(p_limit, 1), 20)
  ), upd as (
    update public.payment_gateways g set syncing_since = now(), last_sync_at = now()
      from due where g.institution_id = due.iid
    returning g.institution_id, g.provider, g.sandbox, g.secret_enc
  )
  select u.institution_id, u.provider, u.sandbox, u.secret_enc from upd u;
end $$;

-- "Sincronizar agora" do administrador: reserva uma escola (recusa se já há uma consulta em curso há < 1 min).
create or replace function public.payment_sync_claim_one(p_inst text)
returns table (inst text, prov text, sandbox boolean, secret text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with one as (
    select g.institution_id as iid from public.payment_gateways g
     where g.institution_id = p_inst and g.secret_enc is not null
       and (g.syncing_since is null or g.syncing_since < now() - interval '1 minute')
       for update skip locked
  ), upd as (
    update public.payment_gateways g set syncing_since = now(), last_sync_at = now()
      from one where g.institution_id = one.iid
    returning g.institution_id, g.provider, g.sandbox, g.secret_enc
  )
  select u.institution_id, u.provider, u.sandbox, u.secret_enc from upd u;
end $$;

create or replace function public.payment_sync_finish(p_inst text, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.payment_gateways
     set syncing_since = null, last_sync_ok = p_ok, last_sync_error = case when p_ok then null else left(p_error, 300) end
   where institution_id = p_inst
$$;

revoke all on function public.payment_portal_can_pay(text, uuid, text), public.payment_gateway_by_entity(text, text),
  public.payment_references_reset(text, text), public.payment_reference_reserve(text, text, uuid),
  public.payment_reference_commit(uuid, text), public.payment_reference_abort(uuid),
  public.payment_reference_cancel(text, text, uuid), public.payment_expire_due(),
  public.payment_apply_event(text, text, text, text, numeric, timestamptz, jsonb),
  public.payment_event_fail(text, text, text, text), public.payment_sync_claim_due(int),
  public.payment_sync_claim_one(text), public.payment_sync_finish(text, boolean, text)
  from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.payment_portal_can_pay(text, uuid, text), public.payment_gateway_by_entity(text, text),
      public.payment_references_reset(text, text), public.payment_reference_reserve(text, text, uuid),
      public.payment_reference_commit(uuid, text), public.payment_reference_abort(uuid),
      public.payment_reference_cancel(text, text, uuid), public.payment_expire_due(),
      public.payment_apply_event(text, text, text, text, numeric, timestamptz, jsonb),
      public.payment_event_fail(text, text, text, text), public.payment_sync_claim_due(int),
      public.payment_sync_claim_one(text), public.payment_sync_finish(text, boolean, text) to service_role;
    grant select, insert, update, delete on public.payment_gateways, public.payment_references, public.payment_events to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
