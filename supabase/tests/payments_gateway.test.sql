-- Testes dos pagamentos automáticos por referência (0038). Corre depois das migrações (ver scripts/test-db.sh).
-- Cobre: reserva/commit da referência, pagamento certo, repetição (idempotência), pagamento duplicado, parcial,
-- referência desconhecida, isolamento entre escolas, permissões (RLS/grants), expiração, cancelamento e reposição.
\set ON_ERROR_STOP on
create schema bt;
create table public._bres(name text, ok boolean);
grant usage on schema bt to anon, authenticated, service_role;
grant all on public._bres to anon, authenticated, service_role;
\o /dev/null

create or replace function bt.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _bres values (name, false);
  exception when others then insert into _bres values (name, true); end;
end $$;
create or replace function bt.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _bres values (name, true);
  exception when others then insert into _bres values (name || ' ['||sqlerrm||']', false); end;
end $$;
create or replace function bt.check(name text, cond boolean) returns void language plpgsql as $$
begin insert into _bres values (name, coalesce(cond, false)); end $$;
create or replace function bt.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); end $$;
create table bt.out(k text primary key, v jsonb);
grant all on bt.out to authenticated, service_role;

-- ---------- dados: duas escolas ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000f001','admin@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f002','prof@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f003','enc@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f0b1','admin@pg-b.ao'),
 ('00000000-0000-0000-0000-00000000f0c1','semperfil@x.ao');
insert into institutions(id,name) values ('pg_a','Escola PG A'),('pg_b','Escola PG B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-00000000f001','pg_a','admin','Admin A','admin@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f002','pg_a','professor','Prof A','prof@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f003','pg_a','encarregado','Enc A','enc@pg-a.ao'),
 ('00000000-0000-0000-0000-00000000f0b1','pg_b','admin','Admin B','admin@pg-b.ao');
insert into payment_gateways(institution_id, provider, enabled, sandbox, entity, secret_enc) values
 ('pg_a','proxypay',true,true,'00411','SEGREDO-CIFRADO-A'),
 ('pg_b','proxypay',true,true,'00412','SEGREDO-CIFRADO-B');
insert into records(institution_id,collection,id,ord,data) values
 ('pg_a','students','s1',1,'{"id":"s1","name":"Ana","financialStatus":"debito"}'),
 ('pg_a','invoices','inv1',1,'{"id":"inv1","invoiceNumber":"FT 2026/1","studentId":"s1","status":"atraso","totalAmountKz":5000}'),
 ('pg_a','invoices','inv2',2,'{"id":"inv2","invoiceNumber":"FT 2026/2","studentId":"s2","status":"pendente","totalAmountKz":3000}'),
 ('pg_a','invoices','inv3',3,'{"id":"inv3","invoiceNumber":"FT 2026/3","studentId":"s2","status":"pendente","totalAmountKz":700}'),
 ('pg_a','invoices','inv4',4,'{"id":"inv4","invoiceNumber":"FT 2026/4","studentId":"s2","status":"pendente","totalAmountKz":900}'),
 ('pg_a','invoices','inv5',5,'{"id":"inv5","invoiceNumber":"FT 2026/5","studentId":"s2","status":"pendente","totalAmountKz":400}'),
 ('pg_a','invoices','inv6',6,'{"id":"inv6","invoiceNumber":"FT 2026/6","studentId":"s2","status":"pago","totalAmountKz":100,"totalPaidKz":100}'),
 ('pg_b','invoices','invb',1,'{"id":"invb","invoiceNumber":"FT B/1","studentId":"sb","status":"pendente","totalAmountKz":5000}');
insert into user_projections(institution_id,user_id,data) values
 ('pg_a','00000000-0000-0000-0000-00000000f003','{"role":"encarregado","invoices":[{"id":"inv1","status":"atraso","totalAmountKz":5000}]}');

-- ---------- 1. gerar a referência de uma factura ----------
select bt.as_user('');
insert into bt.out select 'r1', public.payment_reference_reserve('pg_a','inv1',null);
select bt.check('reserva: nova, com o valor calculado no servidor', (select v->>'state' = 'nova' and (v->>'amount')::numeric = 5000 and v->>'entity' = '00411' from bt.out where k='r1'));
insert into bt.out select 'r1b', public.payment_reference_reserve('pg_a','inv1',null);
select bt.check('segundo clique enquanto gera: espera (a_gerar), sem referência duplicada', (select v->>'state' = 'a_gerar' from bt.out where k='r1b'));
select bt.check('só uma referência activa por factura', (select count(*) = 1 from payment_references where institution_id='pg_a' and invoice_id='inv1' and status='ativa'));
insert into bt.out select 'c1', public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r1'), '000475545250');
select bt.check('commit: referência canónica e formatada como no ATM', (select v->>'reference' = '475 545 250' from bt.out where k='c1')
  and (select reference_id = '475545250' from payment_references where invoice_id='inv1' and institution_id='pg_a'));
select bt.check('factura recebeu entidade, referência, validade e valor', (select data->>'multicaixaRef' = '475 545 250' and data->>'multicaixaEntity' = '00411'
  and data ? 'multicaixaExpires' and (data->>'multicaixaAmountKz')::numeric = 5000 from records where institution_id='pg_a' and collection='invoices' and id='inv1'));
select bt.check('a cópia do encarregado (projecção) também recebeu a referência', (select data->'invoices'->0->>'multicaixaRef' = '475 545 250' from user_projections where institution_id='pg_a' and user_id='00000000-0000-0000-0000-00000000f003'));
insert into bt.out select 'r1c', public.payment_reference_reserve('pg_a','inv1',null);
select bt.check('pedir de novo devolve a MESMA referência', (select v->>'state' = 'existente' and v->>'reference' = '475 545 250' from bt.out where k='r1c'));
select bt.expect_fail('factura de outra escola não é encontrada', $$select public.payment_reference_reserve('pg_a','invb',null)$$);
select bt.expect_fail('factura já paga não tem referência', $$select public.payment_reference_reserve('pg_a','inv6',null)$$);
select bt.expect_fail('factura inexistente', $$select public.payment_reference_reserve('pg_a','nao-existe',null)$$);

-- ---------- 2. o pagamento chega ----------
insert into bt.out select 'p1', public.payment_apply_event('pg_a','proxypay','evt-1','475545250', 5000, now(), '{"id":1}');
select bt.check('pagamento certo: aplicado e factura paga', (select v->>'outcome' = 'aplicado' and v->>'status' = 'pago' from bt.out where k='p1')
  and (select data->>'status' = 'pago' and (data->>'totalPaidKz')::numeric = 5000 from records where institution_id='pg_a' and id='inv1'));
select bt.check('recibo gerado e método Multicaixa', (select data->>'receiptNumber' like 'RC %/MC%' and data->>'method' = 'multicaixa' and data->>'transactionNumber' = 'evt-1' from records where institution_id='pg_a' and id='inv1'));
select bt.check('pagamento no razão sem utilizador (registado pelo servidor)', (select count(*) = 1 and bool_and(registered_by is null) and bool_and(method = 'multicaixa') from payments where institution_id='pg_a' and invoice_id='inv1'));
select bt.check('referência passou a paga', (select status = 'paga' and paid_at is not null from payment_references where institution_id='pg_a' and invoice_id='inv1'));
select bt.check('o aluno deixou de estar em dívida', (select data->>'financialStatus' = 'regular' from records where institution_id='pg_a' and collection='students' and id='s1'));
select bt.check('a projecção do encarregado mostra a factura paga', (select data->'invoices'->0->>'status' = 'pago' from user_projections where institution_id='pg_a' and user_id='00000000-0000-0000-0000-00000000f003'));
select bt.check('pagamento auditado', (select count(*) = 1 from audit_log where institution_id='pg_a' and action='RPC:payment_by_reference' and entity_id='inv1'));

-- ---------- 3. repetições e duplicados ----------
insert into bt.out select 'p1r', public.payment_apply_event('pg_a','proxypay','evt-1','475545250', 5000, now(), '{"id":1}');
select bt.check('o MESMO aviso repetido: duplicado, nada é pago duas vezes', (select v->>'outcome' = 'duplicado' from bt.out where k='p1r')
  and (select count(*) = 1 from payments where institution_id='pg_a' and invoice_id='inv1'));
insert into bt.out select 'p1d', public.payment_apply_event('pg_a','proxypay','evt-2','475545250', 5000, now(), '{"id":2}');
select bt.check('outro pagamento da mesma referência já paga: marcado para rever (ja_paga)', (select v->>'outcome' = 'ja_paga' from bt.out where k='p1d')
  and (select outcome = 'ja_paga' from payment_events where institution_id='pg_a' and event_key='evt-2'));
select bt.expect_fail('valor zero é recusado', $$select public.payment_apply_event('pg_a','proxypay','evt-x','475545250', 0, now(), '{}')$$);
select bt.expect_fail('aviso sem identificador é recusado', $$select public.payment_apply_event('pg_a','proxypay','','475545250', 10, now(), '{}')$$);

-- ---------- 4. referência desconhecida e isolamento entre escolas ----------
insert into bt.out select 'u1', public.payment_apply_event('pg_a','proxypay','evt-3','999888777', 100, now(), '{}');
select bt.check('referência desconhecida: sem_referencia (fica registada para rever)', (select v->>'outcome' = 'sem_referencia' from bt.out where k='u1'));
insert into bt.out select 'iso', public.payment_apply_event('pg_b','proxypay','evt-4','475545250', 5000, now(), '{}');
select bt.check('a referência da escola A não paga nada na escola B', (select v->>'outcome' = 'sem_referencia' from bt.out where k='iso')
  and (select count(*) = 0 from payments where institution_id='pg_b')
  and (select data->>'status' = 'pendente' from records where institution_id='pg_b' and id='invb'));
select bt.check('a mesma chave de evento em escolas diferentes não colide', (select count(*) = 2 from payment_events where event_key in ('evt-4','evt-3')));

-- ---------- 5. pagamento parcial ----------
insert into bt.out select 'r2', public.payment_reference_reserve('pg_a','inv2',null);
select public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r2'), '111222333');
insert into bt.out select 'p2a', public.payment_apply_event('pg_a','proxypay','evt-5','111222333', 1000, now(), '{}');
select bt.check('pagou menos: valor_diferente e a factura continua por pagar', (select v->>'outcome' = 'valor_diferente' and v->>'status' = 'pendente' from bt.out where k='p2a')
  and (select (data->>'totalPaidKz')::numeric = 1000 and data->>'status' = 'pendente' from records where institution_id='pg_a' and id='inv2'));
insert into bt.out select 'p2b', public.payment_apply_event('pg_a','proxypay','evt-6','111222333', 2000, now(), '{}');
select bt.check('completou o valor: a factura fica paga', (select v->>'status' = 'pago' from bt.out where k='p2b')
  and (select (data->>'totalPaidKz')::numeric = 3000 and data->>'status' = 'pago' from records where institution_id='pg_a' and id='inv2'));

-- ---------- 6. valor da factura mudou: a referência antiga deixa de servir ----------
insert into bt.out select 'r3', public.payment_reference_reserve('pg_a','inv3',null);
select public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r3'), '222333444');
select bt.as_user('');
update records set data = data || '{"totalAmountKz":900}' where institution_id='pg_a' and collection='invoices' and id='inv3';
insert into bt.out select 'r3b', public.payment_reference_reserve('pg_a','inv3',null);
select bt.check('valor mudou: nova reserva e a antiga é cancelada (devolvida para apagar no fornecedor)', (select v->>'state' = 'nova' and v->>'stale_reference' = '222333444' and (v->>'amount')::numeric = 900 from bt.out where k='r3b')
  and (select status = 'cancelada' from payment_references where institution_id='pg_a' and reference_id='222333444'));

-- ---------- 7. abortar, cancelar, repor, expirar ----------
insert into bt.out select 'r4', public.payment_reference_reserve('pg_a','inv4',null);
select public.payment_reference_abort((select (v->>'id')::uuid from bt.out where k='r4'));
select bt.check('falha do fornecedor: a reserva é libertada', (select count(*) = 0 from payment_references where institution_id='pg_a' and invoice_id='inv4'));
insert into bt.out select 'r4b', public.payment_reference_reserve('pg_a','inv4',null);
select bt.check('e pode tentar de novo', (select v->>'state' = 'nova' from bt.out where k='r4b'));
select public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r4b'), '333444555');
insert into bt.out select 'x4', public.payment_reference_cancel('pg_a','inv4',null);
select bt.check('cancelar: devolve a referência e limpa a factura', (select v->>'reference_id' = '333444555' from bt.out where k='x4')
  and (select not (data ? 'multicaixaRef') and not (data ? 'multicaixaEntity') from records where institution_id='pg_a' and id='inv4')
  and (select status = 'cancelada' from payment_references where institution_id='pg_a' and invoice_id='inv4'));
select bt.check('cancelar sem referência activa não faz nada', (select public.payment_reference_cancel('pg_a','inv4',null) is null));

insert into bt.out select 'r5', public.payment_reference_reserve('pg_a','inv5',null);
select public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r5'), '444555666');
update payment_references set expires_on = (now() at time zone 'Africa/Luanda')::date - 3 where institution_id='pg_a' and invoice_id='inv5';
select bt.check('expirar: referências vencidas saem da factura', (select public.payment_expire_due() >= 1)
  and (select status = 'expirada' from payment_references where institution_id='pg_a' and invoice_id='inv5')
  and (select not (data ? 'multicaixaRef') from records where institution_id='pg_a' and id='inv5'));
insert into bt.out select 'r5b', public.payment_reference_reserve('pg_a','inv5',null);
select bt.check('depois de expirar, a factura pode pedir outra referência', (select v->>'state' = 'nova' from bt.out where k='r5b'));
select public.payment_reference_commit((select (v->>'id')::uuid from bt.out where k='r5b'), '555666777');
select bt.check('repor (mudança de ambiente/entidade): cancela as activas e limpa as facturas', (select public.payment_references_reset('pg_a','teste') >= 1)
  and (select count(*) = 0 from payment_references where institution_id='pg_a' and status='ativa')
  and (select not (data ? 'multicaixaRef') from records where institution_id='pg_a' and id='inv5'));

-- ---------- 8. fornecedor desligado ou escola suspensa ----------
update payment_gateways set enabled = false where institution_id = 'pg_a';
select bt.expect_fail('com o fornecedor desligado não se geram referências', $$select public.payment_reference_reserve('pg_a','inv5',null)$$);
update payment_gateways set enabled = true where institution_id = 'pg_a';
update institutions set status = 'suspended' where id = 'pg_a';
select bt.expect_fail('escola suspensa não gera referências', $$select public.payment_reference_reserve('pg_a','inv5',null)$$);
update institutions set status = 'active' where id = 'pg_a';

-- ---------- 9. escolha da escola pela entidade; quem pode pagar o quê ----------
select bt.check('entidade inequívoca: a escola certa', (select public.payment_gateway_by_entity('proxypay','00411') = 'pg_a'));
update payment_gateways set entity = '00411' where institution_id = 'pg_b';
select bt.check('entidade partilhada por duas escolas: ambígua, devolve nada', (select public.payment_gateway_by_entity('proxypay','00411') is null));
update payment_gateways set entity = '00412' where institution_id = 'pg_b';
select bt.check('encarregado só pode pagar facturas da sua projecção', (select public.payment_portal_can_pay('pg_a','00000000-0000-0000-0000-00000000f003','inv1'))
  and not (select public.payment_portal_can_pay('pg_a','00000000-0000-0000-0000-00000000f003','inv2'))
  and not (select public.payment_portal_can_pay('pg_b','00000000-0000-0000-0000-00000000f003','inv1'))
  and not (select public.payment_portal_can_pay('pg_a','00000000-0000-0000-0000-00000000f002','inv1')));

-- ---------- 10. consulta periódica: reserva sem duplicar ----------
select bt.check('consulta periódica reserva as escolas ligadas', (select count(*) = 2 from public.payment_sync_claim_due(10)));
select bt.check('e não as reserva outra vez de seguida', (select count(*) = 0 from public.payment_sync_claim_due(10)));
select bt.check('"sincronizar agora" recusa se há uma consulta em curso', (select count(*) = 0 from public.payment_sync_claim_one('pg_a')));
select public.payment_sync_finish('pg_a', false, 'fornecedor em baixo');
select bt.check('o resultado fica registado', (select last_sync_ok = false and last_sync_error = 'fornecedor em baixo' and syncing_since is null from payment_gateways where institution_id='pg_a'));

-- ---------- 11. permissões ----------
select bt.as_user('00000000-0000-0000-0000-00000000f001');
set role authenticated;
insert into bt.out select 'st_a', public.payment_gateway_status();
select bt.expect_fail('o administrador NÃO lê as tabelas directamente', $$select * from public.payment_gateways$$);
select bt.expect_fail('o administrador NÃO lê os avisos directamente', $$select * from public.payment_events$$);
select bt.expect_fail('o administrador NÃO aplica pagamentos à mão', $$select public.payment_apply_event('pg_a','proxypay','evt-hack','475545250', 5000, now(), '{}')$$);
select bt.expect_fail('o administrador NÃO reserva referências à mão', $$select public.payment_reference_reserve('pg_a','inv5',null)$$);
reset role;
select bt.check('estado do administrador: configurado, com chave, sem a mostrar', (select (v->>'configured')::boolean and (v->>'hasSecret')::boolean and v->>'entity' = '00411' and v->>'institutionId' = 'pg_a'
  and v::text not like '%SEGREDO-CIFRADO%' from bt.out where k='st_a'));
select bt.check('estado traz contagens e últimos avisos', (select (v #>> '{counts,pagas}')::int >= 2 and jsonb_array_length(v->'events') >= 3 and (v #>> '{counts,paraRever}')::int >= 2 from bt.out where k='st_a'));

select bt.as_user('00000000-0000-0000-0000-00000000f002');
set role authenticated;
select bt.expect_fail('o professor não vê o estado dos pagamentos', $$select public.payment_gateway_status()$$);
insert into bt.out select 'en_prof', to_jsonb(public.payment_gateway_enabled());
reset role;
select bt.check('qualquer utilizador da escola sabe se os pagamentos estão activos', (select (v #>> '{}')::boolean from bt.out where k='en_prof'));

select bt.as_user('00000000-0000-0000-0000-00000000f0b1');
set role authenticated;
insert into bt.out select 'st_b', public.payment_gateway_status();
reset role;
select bt.check('o administrador da escola B só vê a escola B', (select v->>'institutionId' = 'pg_b' and v->>'entity' = '00412' and v::text not like '%475%' and v::text not like '%FT 2026%' from bt.out where k='st_b'));

select bt.as_user('00000000-0000-0000-0000-00000000f0c1');
set role authenticated;
insert into bt.out select 'en_nobody', to_jsonb(public.payment_gateway_enabled());
reset role;
select bt.check('utilizador sem perfil: pagamentos "inactivos"', (select not (v #>> '{}')::boolean from bt.out where k='en_nobody'));

select bt.as_user('');
set role anon;
select bt.expect_fail('anónimo não vê se há pagamentos', $$select public.payment_gateway_enabled()$$);
select bt.expect_fail('anónimo não vê o estado', $$select public.payment_gateway_status()$$);
select bt.expect_fail('anónimo não aplica pagamentos', $$select public.payment_apply_event('pg_a','proxypay','evt-anon','475545250', 5000, now(), '{}')$$);
reset role;

-- ---------- 12. a factura paga não volta atrás à mão ----------
select bt.as_user('00000000-0000-0000-0000-00000000f001');
set role authenticated;
select bt.expect_fail('ninguém marca "pago" à mão (continua a só poder ser pelo servidor)', $$update public.records set data = data || '{"status":"pago"}' where institution_id='pg_a' and collection='invoices' and id='inv5'$$);
reset role;

\o
select name as "FALHOU" from _bres where not ok;
select count(*) filter (where ok) as pagamentos_passou, count(*) filter (where not ok) as pagamentos_falhou from _bres;
drop table public._bres; drop schema bt cascade;
