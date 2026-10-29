-- =====================================================================
-- 0003: auditoria infalsificável + pagamentos + documentos fiscais
-- Tudo é escrito POR TRIGGERS/RPC no servidor. O cliente não consegue inserir,
-- alterar nem apagar auditoria, pagamentos ou documentos fiscais emitidos.
-- =====================================================================

-- ---------- Auditoria com cadeia de hash por escola ----------
create table public.audit_log (
  seq            bigint generated always as identity primary key,
  institution_id text not null,
  at             timestamptz not null default now(),
  actor_id       uuid,
  actor_role     text,
  action         text not null,            -- INSERT | UPDATE | DELETE | RPC:<nome>
  entity         text not null,            -- colecção ou tabela
  entity_id      text,
  detail         jsonb,
  prev_hash      text,
  hash           text not null
);
create index audit_inst_at_idx on public.audit_log (institution_id, at desc);
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated
  using (institution_id = app.current_institution() and app.current_role() in ('admin','director'));
grant select on public.audit_log to authenticated;
-- sem INSERT/UPDATE/DELETE para o cliente

create or replace function app.write_audit(p_inst text, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare prev text; h text; ts timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('audit:' || p_inst));   -- serializa a cadeia por escola
  select hash into prev from public.audit_log where institution_id = p_inst order by seq desc limit 1;
  h := encode(digest(coalesce(prev,'') || p_inst || to_char(ts at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || coalesce(auth.uid()::text,'') ||
                     p_action || p_entity || coalesce(p_entity_id,'') || coalesce(p_detail::text,''), 'sha256'), 'hex');
  insert into public.audit_log(institution_id, at, actor_id, actor_role, action, entity, entity_id, detail, prev_hash, hash)
  values (p_inst, ts, auth.uid(), app.current_role(), p_action, p_entity, p_entity_id, p_detail, prev, h);
end $$;

-- Verificação da cadeia (devolve a 1.ª linha adulterada, ou null se íntegra)
create or replace function app.verify_audit_chain(p_inst text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; prev text := null; h text;
begin
  if app.current_role() not in ('admin','director') and not app.is_platform_admin() and auth.uid() is not null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  for r in select * from public.audit_log where institution_id = p_inst order by seq loop
    h := encode(digest(coalesce(prev,'') || r.institution_id || to_char(r.at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || coalesce(r.actor_id::text,'') ||
                       r.action || r.entity || coalesce(r.entity_id,'') || coalesce(r.detail::text,''), 'sha256'), 'hex');
    if r.prev_hash is distinct from prev or r.hash <> h then return r.seq; end if;
    prev := r.hash;
  end loop;
  return null;
end $$;

-- Auditoria automática de `records` (só alterações; o dado completo fica na própria linha)
create or replace function app.audit_records() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare a boolean; row_ record;
begin
  row_ := case when tg_op = 'DELETE' then old else new end;
  select audited into a from public.collection_acl where collection = row_.collection;
  if coalesce(a, true) then
    perform app.write_audit(row_.institution_id, tg_op, row_.collection, row_.id,
      case when tg_op = 'UPDATE' then jsonb_build_object('version', new.version)
           when tg_op = 'DELETE' then jsonb_build_object('deleted', old.data) else null end);
  end if;
  return null;
end $$;
create trigger records_audit after insert or update or delete on public.records
  for each row execute function app.audit_records();

-- ---------- Pagamentos (razão só de acréscimo) ----------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  institution_id  text not null references public.institutions(id),
  invoice_id      text not null,
  amount_kz       numeric(14,2) not null check (amount_kz > 0),
  method          text not null check (method in ('numerario','multicaixa','tpa','transferencia','mcx','debito')),
  reference       text,
  idempotency_key text not null,
  paid_at         timestamptz not null default now(),
  registered_by   uuid not null references auth.users(id),
  unique (institution_id, idempotency_key)        -- repetir o pedido não duplica o pagamento
);
create index payments_invoice_idx on public.payments (institution_id, invoice_id);
alter table public.payments enable row level security;
create policy pay_read on public.payments for select to authenticated
  using (institution_id = app.current_institution() and app.can_access('invoices','read'));
grant select on public.payments to authenticated;

create or replace function app.block_mutation() returns trigger language plpgsql as $$
begin raise exception 'Registo imutável: % não permitido em %', tg_op, tg_table_name using errcode = '42501'; end $$;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function app.block_mutation();
create trigger audit_immutable before update or delete on public.audit_log
  for each row execute function app.block_mutation();

-- Regista pagamento e actualiza a factura (que vive em records.collection='invoices')
create or replace function public.register_payment(
  p_invoice_id text, p_amount_kz numeric, p_method text, p_reference text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); inv public.records; total numeric; paid numeric; new_status text;
begin
  if inst is null or not app.can_access('invoices','write') then
    raise exception 'Sem permissão para registar pagamentos' using errcode = '42501';
  end if;
  perform set_config('app.rpc', 'payment', true);
  select * into inv from public.records
   where institution_id = inst and collection = 'invoices' and id = p_invoice_id for update;
  if not found then raise exception 'Factura não encontrada'; end if;

  insert into public.payments(institution_id, invoice_id, amount_kz, method, reference, idempotency_key, registered_by)
  values (inst, p_invoice_id, p_amount_kz, p_method, p_reference, p_idempotency_key, auth.uid())
  on conflict (institution_id, idempotency_key) do nothing;

  total := coalesce((inv.data ->> 'totalAmountKz')::numeric, 0);
  select coalesce(sum(amount_kz), 0) into paid from public.payments where institution_id = inst and invoice_id = p_invoice_id;
  new_status := case when paid >= total and total > 0 then 'pago' else coalesce(inv.data ->> 'status', 'pendente') end;

  update public.records
     set data = data || jsonb_build_object('status', new_status, 'totalPaidKz', paid,
                                           'paymentDate', to_char(now(), 'YYYY-MM-DD'), 'method', p_method),
         version = version
   where institution_id = inst and collection = 'invoices' and id = p_invoice_id;

  perform app.write_audit(inst, 'RPC:register_payment', 'invoices', p_invoice_id,
          jsonb_build_object('amount', p_amount_kz, 'method', p_method, 'paid_total', paid));
  return jsonb_build_object('invoice_id', p_invoice_id, 'paid_total', paid, 'status', new_status);
end $$;
revoke all on function public.register_payment(text,numeric,text,text,text) from public, anon;
grant execute on function public.register_payment(text,numeric,text,text,text) to authenticated;

-- ---------- Documentos fiscais (numeração sequencial + cadeia de hash) ----------
-- ATENÇÃO: isto prepara a estrutura (série, número sequencial, hash encadeado, imutabilidade).
-- NÃO substitui a certificação AGT: a assinatura RSA com chave privada e o processo de
-- certificação do software são passos legais/externos. Sem eles, os documentos continuam
-- a ser "documento interno" e NÃO fiscais. A coluna `signature` fica vazia até lá.
create table public.fiscal_series (
  institution_id text not null references public.institutions(id),
  series         text not null,                         -- ex.: 'FT2026'
  doc_type       text not null check (doc_type in ('FT','FR','RG','NC','ND')),
  last_number    integer not null default 0,
  last_hash      text,
  primary key (institution_id, series, doc_type)
);
create table public.fiscal_documents (
  institution_id text not null references public.institutions(id),
  doc_type       text not null,
  series         text not null,
  number         integer not null,
  doc_no         text generated always as (doc_type || ' ' || series || '/' || number) stored,
  issued_at      timestamptz not null default now(),
  customer_name  text not null,
  customer_nif   text,
  lines          jsonb not null,
  net_kz         numeric(14,2) not null,
  tax_kz         numeric(14,2) not null default 0,
  total_kz       numeric(14,2) not null,
  source_invoice_id text,
  prev_hash      text,
  hash           text not null,
  signature      text,                                  -- preencher com software certificado AGT
  status         text not null default 'N' check (status in ('N','A')),  -- N normal, A anulado
  cancel_reason  text,
  issued_by      uuid not null references auth.users(id),
  primary key (institution_id, doc_type, series, number)
);
alter table public.fiscal_series    enable row level security;
alter table public.fiscal_documents enable row level security;
create policy fd_read on public.fiscal_documents for select to authenticated
  using (institution_id = app.current_institution() and app.can_access('invoices','read'));
create policy fs_read on public.fiscal_series for select to authenticated
  using (institution_id = app.current_institution() and app.can_access('invoices','read'));
grant select on public.fiscal_documents, public.fiscal_series to authenticated;

create or replace function app.fiscal_docs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Documento fiscal não pode ser apagado' using errcode = '42501'; end if;
  if (to_jsonb(new) - 'status' - 'cancel_reason') is distinct from (to_jsonb(old) - 'status' - 'cancel_reason') then
    raise exception 'Documento fiscal emitido é imutável (só se pode anular)' using errcode = '42501';
  end if;
  if new.status = 'A' and coalesce(new.cancel_reason,'') = '' then
    raise exception 'Anulação exige motivo' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger fiscal_docs_guard before update or delete on public.fiscal_documents
  for each row execute function app.fiscal_docs_guard();

create or replace function public.issue_fiscal_document(
  p_doc_type text, p_series text, p_customer_name text, p_customer_nif text,
  p_lines jsonb, p_net numeric, p_tax numeric, p_source_invoice text default null
) returns public.fiscal_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); s public.fiscal_series; n int; h text; ts timestamptz := now(); d public.fiscal_documents;
begin
  if inst is null or not app.can_access('invoices','write') then
    raise exception 'Sem permissão para emitir documentos' using errcode = '42501';
  end if;
  if (select nif from public.institutions where id = inst) is null then
    raise exception 'Configure o NIF da escola antes de emitir documentos fiscais' using errcode = '23514';
  end if;
  insert into public.fiscal_series(institution_id, series, doc_type) values (inst, p_series, p_doc_type)
    on conflict do nothing;
  select * into s from public.fiscal_series
   where institution_id = inst and series = p_series and doc_type = p_doc_type for update;
  n := s.last_number + 1;
  h := encode(digest(coalesce(s.last_hash,'') || to_char(ts,'YYYY-MM-DD"T"HH24:MI:SS') ||
         p_doc_type || ' ' || p_series || '/' || n || (p_net + p_tax)::text, 'sha256'), 'hex');
  insert into public.fiscal_documents(institution_id, doc_type, series, number, issued_at, customer_name, customer_nif,
        lines, net_kz, tax_kz, total_kz, source_invoice_id, prev_hash, hash, issued_by)
  values (inst, p_doc_type, p_series, n, ts, p_customer_name, p_customer_nif, p_lines, p_net, p_tax, p_net + p_tax,
          p_source_invoice, s.last_hash, h, auth.uid())
  returning * into d;
  update public.fiscal_series set last_number = n, last_hash = h
   where institution_id = inst and series = p_series and doc_type = p_doc_type;
  perform app.write_audit(inst, 'RPC:issue_fiscal_document', 'fiscal_documents', d.doc_no, jsonb_build_object('total', d.total_kz));
  return d;
end $$;
revoke all on function public.issue_fiscal_document(text,text,text,text,jsonb,numeric,numeric,text) from public, anon;
grant execute on function public.issue_fiscal_document(text,text,text,text,jsonb,numeric,numeric,text) to authenticated;

-- ---------- Homologação de pautas (só admin/director; congela as notas) ----------
create or replace function public.homologate_pauta(p_homologation jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); hid text := p_homologation ->> 'id';
begin
  if inst is null or app.current_role() not in ('admin','director') then
    raise exception 'Só administração ou direcção homologa pautas' using errcode = '42501';
  end if;
  perform set_config('app.rpc', 'homologate', true);
  insert into public.records(institution_id, collection, id, academic_year, data, created_by, updated_by)
  values (inst, 'homologations', hid, p_homologation ->> 'academicYear',
          p_homologation || jsonb_build_object('signedByUserId', auth.uid()::text,
                                               'signedByRole', app.current_role(),
                                               'signedAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          auth.uid(), auth.uid());
  perform app.write_audit(inst, 'RPC:homologate_pauta', 'homologations', hid, null);
  return jsonb_build_object('ok', true, 'id', hid);
end $$;
revoke all on function public.homologate_pauta(jsonb) from public, anon;
grant execute on function public.homologate_pauta(jsonb) to authenticated;

-- Auditoria escrita pelas Edge Functions (service_role; auth.uid() é nulo ali, por isso o actor vai por parâmetro)
create or replace function public.write_audit_service(p_inst text, p_actor uuid, p_entity_id text, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare prev text; h text; ts timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('audit:' || p_inst));
  select hash into prev from public.audit_log where institution_id = p_inst order by seq desc limit 1;
  h := encode(digest(coalesce(prev,'') || p_inst || to_char(ts at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || coalesce(p_actor::text,'') ||
                     'RPC:create_user' || 'profiles' || coalesce(p_entity_id,'') || coalesce(jsonb_build_object('role', p_role)::text,''), 'sha256'), 'hex');
  insert into public.audit_log(institution_id, at, actor_id, actor_role, action, entity, entity_id, detail, prev_hash, hash)
  values (p_inst, ts, p_actor, 'admin', 'RPC:create_user', 'profiles', p_entity_id, jsonb_build_object('role', p_role), prev, h);
end $$;
revoke all on function public.write_audit_service(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.write_audit_service(text,uuid,text,text) to service_role;
