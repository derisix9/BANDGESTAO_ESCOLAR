-- Testes das notificações por escola (0039). Corre depois das migrações (ver scripts/test-db.sh).
-- Cobre: restrições da configuração, isolamento entre escolas, permissões (RLS/grants), categoria na fila,
-- o worker global a não roubar as escolas com fornecedor próprio, o worker por escola, e quem recebe cada push.
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
 ('00000000-0000-0000-0000-0000000000a1','admin@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a2','sec@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a3','prof@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a4','enc@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a5','aluno@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a6','inactivo@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000a7','enc2@nt-a.ao'),
 ('00000000-0000-0000-0000-0000000000b1','admin@nt-b.ao'),
 ('00000000-0000-0000-0000-0000000000b2','prof@nt-b.ao'),
 ('00000000-0000-0000-0000-0000000000c1','semperfil@x.ao');
insert into institutions(id,name) values ('nt_a','Escola NT A'),('nt_b','Escola NT B');
insert into profiles(id,institution_id,role,name,email,active,linked_student_id) values
 ('00000000-0000-0000-0000-0000000000a1','nt_a','admin','Admin A','admin@nt-a.ao',true,null),
 ('00000000-0000-0000-0000-0000000000a2','nt_a','secretaria','Sec A','sec@nt-a.ao',true,null),
 ('00000000-0000-0000-0000-0000000000a3','nt_a','professor','Prof A','prof@nt-a.ao',true,null),
 ('00000000-0000-0000-0000-0000000000a4','nt_a','encarregado','Enc A (aluno s1)','enc@nt-a.ao',true,null),
 ('00000000-0000-0000-0000-0000000000a5','nt_a','aluno','Aluno s1','aluno@nt-a.ao',true,'s1'),
 ('00000000-0000-0000-0000-0000000000a6','nt_a','professor','Prof inactivo','inactivo@nt-a.ao',false,null),
 ('00000000-0000-0000-0000-0000000000a7','nt_a','encarregado','Enc A (aluno s2)','enc2@nt-a.ao',true,null),
 ('00000000-0000-0000-0000-0000000000b1','nt_b','admin','Admin B','admin@nt-b.ao',true,null),
 ('00000000-0000-0000-0000-0000000000b2','nt_b','professor','Prof B','prof@nt-b.ao',true,null);
insert into user_projections(institution_id,user_id,data) values
 ('nt_a','00000000-0000-0000-0000-0000000000a4','{"role":"encarregado","students":[{"id":"s1"}]}'),
 ('nt_a','00000000-0000-0000-0000-0000000000a7','{"role":"encarregado","students":[{"id":"s2"}]}');

-- A: SMS (Twilio) + push ligados; WhatsApp configurado mas DESLIGADO.  B: só push.
insert into notification_gateways(institution_id, channel, provider, enabled, config, secret_enc, critical_only) values
 ('nt_a','sms','twilio',true,'{"from":"BANDMED"}','SEGREDO-SMS-A',true),
 ('nt_a','push','webpush',true,'{"publicKey":"BPUBLICA-A","subject":"mailto:a@nt-a.ao"}','SEGREDO-PUSH-A',true),
 ('nt_a','whatsapp','meta_cloud',false,'{"templateName":"aviso"}','SEGREDO-WA-A',true),
 ('nt_b','push','webpush',true,'{"publicKey":"BPUBLICA-B"}','SEGREDO-PUSH-B',true);

-- ---------- 1. restrições da configuração ----------
select bt.expect_fail('SMS não aceita o fornecedor da Meta', $$insert into notification_gateways(institution_id,channel,provider) values ('nt_b','sms','meta_cloud')$$);
select bt.expect_fail('push só aceita webpush', $$insert into notification_gateways(institution_id,channel,provider) values ('nt_b','push','twilio')$$);
select bt.expect_fail('WhatsApp não aceita fornecedor de SMS local', $$insert into notification_gateways(institution_id,channel,provider) values ('nt_b','whatsapp','http')$$);
select bt.expect_fail('canal desconhecido', $$insert into notification_gateways(institution_id,channel,provider) values ('nt_b','telegram','twilio')$$);
select bt.expect_ok('SMS por API HTTP genérica (agregador local) é aceite', $$insert into notification_gateways(institution_id,channel,provider,enabled,config,secret_enc) values ('nt_b','sms','http',false,'{"url":"https://sms.exemplo.ao/api"}','SEGREDO-SMS-B')$$);
select bt.expect_fail('uma escola não tem dois fornecedores no mesmo canal', $$insert into notification_gateways(institution_id,channel,provider) values ('nt_b','sms','twilio')$$);
select bt.expect_fail('categoria de aviso inválida', $$insert into notification_queue(institution_id,channel,to_phone,body,category) values ('nt_a','sms','+244923000001','x','urgentissimo')$$);

-- ---------- 2. quem vê o quê ----------
select bt.as_user('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
insert into bt.out select 'st_a', public.notification_gateway_status();
select bt.expect_fail('o administrador NÃO lê a tabela de configuração directamente', $$select * from public.notification_gateways$$);
select bt.expect_fail('o administrador NÃO lê as subscrições directamente', $$select * from public.push_subscriptions$$);
select bt.expect_fail('o administrador NÃO escreve a configuração à mão', $$update public.notification_gateways set enabled = false$$);
select bt.expect_fail('o administrador NÃO reserva a fila por escola', $$select * from public.notification_claim_school(10)$$);
select bt.expect_fail('o administrador NÃO lista alvos de push', $$select * from public.notification_push_targets('nt_a','todos','{}')$$);
select bt.expect_fail('o administrador NÃO lê a configuração de um canal', $$select * from public.notification_gateway_get('nt_a','sms')$$);
select bt.expect_fail('o administrador NÃO dá falha definitiva a uma mensagem', $$select public.notification_skip(gen_random_uuid(),'x')$$);
reset role;
select bt.check('estado do administrador A: três canais, sem segredos', (select jsonb_object_keys_count > 0 from (select count(*) as jsonb_object_keys_count from bt.out, jsonb_object_keys(v->'channels') where k='st_a') z)
  and (select v #>> '{channels,sms,provider}' = 'twilio' and (v #>> '{channels,sms,hasSecret}')::boolean and (v #>> '{channels,sms,criticalOnly}')::boolean
       and v #>> '{channels,whatsapp,enabled}' = 'false' and v #>> '{channels,push,config,publicKey}' = 'BPUBLICA-A'
       and v::text not like '%SEGREDO%' from bt.out where k='st_a'));

select bt.as_user('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
insert into bt.out select 'st_b', public.notification_gateway_status();
reset role;
select bt.check('o administrador da escola B só vê a escola B', (select v->>'institutionId' = 'nt_b' and v #>> '{channels,sms,provider}' = 'http'
  and v #>> '{channels,push,config,publicKey}' = 'BPUBLICA-B' and v::text not like '%BPUBLICA-A%' and v::text not like '%BANDMED%' and v::text not like '%SEGREDO%' from bt.out where k='st_b'));

select bt.as_user('00000000-0000-0000-0000-0000000000a3');
set role authenticated;
select bt.expect_fail('o professor não vê o estado das notificações', $$select public.notification_gateway_status()$$);
insert into bt.out select 'en_prof', public.notification_channels_enabled();
insert into bt.out select 'can_prof', to_jsonb(public.notification_can_send());
reset role;
select bt.check('qualquer utilizador da escola vê que canais há e a chave PÚBLICA do push', (select (v->>'sms')::boolean and (v->>'push')::boolean and not (v->>'whatsapp')::boolean
  and (v->>'smsCriticalOnly')::boolean and v->>'pushPublicKey' = 'BPUBLICA-A' from bt.out where k='en_prof'));
select bt.check('o professor não pode enviar avisos', (select not (v #>> '{}')::boolean from bt.out where k='can_prof'));

select bt.as_user('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
insert into bt.out select 'can_sec', to_jsonb(public.notification_can_send());
reset role;
select bt.check('a secretaria pode enviar avisos', (select (v #>> '{}')::boolean from bt.out where k='can_sec'));

select bt.as_user('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into bt.out select 'en_nobody', public.notification_channels_enabled();
insert into bt.out select 'can_nobody', to_jsonb(public.notification_can_send());
reset role;
select bt.check('utilizador sem perfil: nada activo, nada a enviar', (select not (a.v->>'sms')::boolean and not (a.v->>'push')::boolean and a.v->>'pushPublicKey' is null and not (b.v #>> '{}')::boolean
  from bt.out a, bt.out b where a.k='en_nobody' and b.k='can_nobody'));

select bt.as_user('');
set role anon;
select bt.expect_fail('anónimo não vê os canais', $$select public.notification_channels_enabled()$$);
select bt.expect_fail('anónimo não vê o estado', $$select public.notification_gateway_status()$$);
select bt.expect_fail('anónimo não pode enviar', $$select public.notification_can_send()$$);
reset role;

-- ---------- 3. a fila: categoria e RLS ----------
select bt.as_user('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select bt.expect_ok('a secretaria enfileira um SMS normal (a categoria é decidida pelo servidor, não pela RLS)', $$insert into public.notification_queue(institution_id,channel,to_phone,body) values ('nt_a','sms','+244923000001','aviso normal')$$);
select bt.expect_ok('a secretaria enfileira um SMS crítico', $$insert into public.notification_queue(institution_id,channel,to_phone,body,category) values ('nt_a','sms','+244923000002','propina em atraso','critico')$$);
select bt.expect_ok('e um WhatsApp', $$insert into public.notification_queue(institution_id,channel,to_phone,body) values ('nt_a','whatsapp','+244923000003','modelo')$$);
select bt.expect_fail('não enfileira para outra escola', $$insert into public.notification_queue(institution_id,channel,to_phone,body) values ('nt_b','sms','+244923000009','x')$$);
select bt.expect_fail('não marca como enviada à mão', $$insert into public.notification_queue(institution_id,channel,to_phone,body,status) values ('nt_a','sms','+244923000009','x','sent')$$);
reset role;
select bt.as_user('00000000-0000-0000-0000-0000000000a3');
set role authenticated;
select bt.expect_fail('o professor não enfileira', $$insert into public.notification_queue(institution_id,channel,to_phone,body) values ('nt_a','sms','+244923000009','x')$$);
reset role;
select bt.as_user('00000000-0000-0000-0000-0000000000b1');
insert into notification_queue(institution_id,channel,to_phone,body) values ('nt_b','sms','+244923000100','da escola B, sem fornecedor SMS ligado');

-- ---------- 4. o worker global não rouba as escolas com fornecedor próprio ----------
insert into bt.out select 'legacy', coalesce(jsonb_agg(jsonb_build_object('inst', institution_id, 'ch', channel)), '[]'::jsonb) from public.claim_notifications(50);
select bt.check('worker global: só leva a escola B (A tem SMS e WhatsApp… o WhatsApp de A está desligado, por isso também vai)',
  (select count(*) filter (where e->>'inst' = 'nt_b' and e->>'ch' = 'sms') = 1
      and count(*) filter (where e->>'inst' = 'nt_a' and e->>'ch' = 'sms') = 0
      and count(*) filter (where e->>'inst' = 'nt_a' and e->>'ch' = 'whatsapp') = 1
   from bt.out, jsonb_array_elements(v) e where k='legacy'));

-- ---------- 5. o worker por escola ----------
insert into bt.out select 'mine', coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.notification_claim_school(50) c;
select bt.check('worker por escola: só os SMS da escola A, com a configuração e o segredo dela',
  (select jsonb_array_length(v) = 2
      and not exists (select 1 from jsonb_array_elements(v) e where e->>'institution_id' <> 'nt_a' or e->>'channel' <> 'sms' or e->>'provider' <> 'twilio' or e->>'secret_enc' <> 'SEGREDO-SMS-A')
      and exists (select 1 from jsonb_array_elements(v) e where e->>'category' = 'critico' and e->>'to_phone' = '+244923000002')
      and exists (select 1 from jsonb_array_elements(v) e where e->>'category' = 'normal'  and e->>'to_phone' = '+244923000001')
   from bt.out where k='mine'));
select bt.check('as mensagens reservadas ficam "a enviar" com 1 tentativa', (select count(*) = 2 from notification_queue where institution_id='nt_a' and channel='sms' and status='sending' and attempts = 1));
select bt.check('e não são reservadas outra vez', (select count(*) = 0 from public.notification_claim_school(50)));

select public.notification_skip((select id from notification_queue where to_phone='+244923000001'), 'SMS desligado para avisos normais');
select bt.check('falha definitiva: fica "failed" com o motivo, sem repetir', (select status = 'failed' and last_error like 'SMS desligado%' from notification_queue where to_phone='+244923000001'));
select public.finish_notification((select id from notification_queue where to_phone='+244923000002'), true, 'SM123', null);
select bt.check('envio bem sucedido fica "sent" com o id do fornecedor', (select status = 'sent' and provider_id = 'SM123' and sent_at is not null from notification_queue where to_phone='+244923000002'));
select bt.check('o skip não mexe numa mensagem que já não está "a enviar"', (select public.notification_skip((select id from notification_queue where to_phone='+244923000002'), 'x') is null)
  and (select status = 'sent' from notification_queue where to_phone='+244923000002'));

-- Falha temporária: volta à fila com recuo; a desligada (WhatsApp A) passa a ser servida quando ligar.
update notification_gateways set enabled = true where institution_id='nt_a' and channel='whatsapp';
update notification_queue set status='pending', next_attempt_at = now() where channel='whatsapp' and institution_id='nt_a';
insert into bt.out select 'mine2', coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.notification_claim_school(50) c;
select bt.check('ligar o WhatsApp da escola passa a servi-lo pelo worker por escola', (select jsonb_array_length(v) = 1 and v #>> '{0,provider}' = 'meta_cloud' from bt.out where k='mine2'));
select public.finish_notification((select id from notification_queue where channel='whatsapp' and institution_id='nt_a'), false, null, 'Meta 131026: número sem WhatsApp');
select bt.check('falha temporária: volta à fila com recuo', (select status = 'pending' and attempts = 2 and next_attempt_at > now() + interval '3 minutes' and last_error like 'Meta 131026%' from notification_queue where channel='whatsapp' and institution_id='nt_a'));

-- Desligar o fornecedor devolve a escola ao worker global
update notification_gateways set enabled = false where institution_id='nt_a' and channel='sms';
insert into notification_queue(institution_id,channel,to_phone,body) values ('nt_a','sms','+244923000555','depois de desligar');
insert into bt.out select 'legacy2', coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.claim_notifications(50) c;
select bt.check('fornecedor desligado: a mensagem volta a ser servida pelo worker global', (select exists (select 1 from jsonb_array_elements(v) e where e->>'to_phone' = '+244923000555') from bt.out where k='legacy2'));
select bt.check('e o worker por escola já não a vê', (select count(*) = 0 from public.notification_claim_school(50)));
update notification_gateways set enabled = true where institution_id='nt_a' and channel='sms';

-- ---------- 6. a quem chega o push ----------
insert into push_subscriptions(institution_id,user_id,endpoint,p256dh,auth) values
 ('nt_a','00000000-0000-0000-0000-0000000000a1','https://fcm.googleapis.com/fcm/send/admin1','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a1','https://fcm.googleapis.com/fcm/send/admin2','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a2','https://fcm.googleapis.com/fcm/send/sec','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a3','https://fcm.googleapis.com/fcm/send/prof','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a4','https://fcm.googleapis.com/fcm/send/enc1','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a5','https://fcm.googleapis.com/fcm/send/aluno1','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a6','https://fcm.googleapis.com/fcm/send/inactivo','k','a'),
 ('nt_a','00000000-0000-0000-0000-0000000000a7','https://fcm.googleapis.com/fcm/send/enc2','k','a'),
 ('nt_b','00000000-0000-0000-0000-0000000000b2','https://fcm.googleapis.com/fcm/send/profB','k','a');
select bt.expect_fail('o mesmo endereço não se regista duas vezes', $$insert into push_subscriptions(institution_id,user_id,endpoint,p256dh,auth) values ('nt_a','00000000-0000-0000-0000-0000000000a3','https://fcm.googleapis.com/fcm/send/prof','k','a')$$);
create or replace function bt.targets(p_inst text, p_kind text, p_ids text[]) returns text[] language sql as $$
  select coalesce(array_agg(replace(endpoint, 'https://fcm.googleapis.com/fcm/send/', '') order by endpoint), '{}') from public.notification_push_targets(p_inst, p_kind, p_ids)
$$;
select bt.check('todos: só contas activas DESTA escola (6 aparelhos de 5 pessoas… sem o inactivo e sem a escola B)',
  bt.targets('nt_a','todos','{}') = array['admin1','admin2','aluno1','enc1','enc2','prof','sec']);
select bt.check('professores', bt.targets('nt_a','professores','{}') = array['prof']);
select bt.check('funcionários: direcção e secretaria', bt.targets('nt_a','funcionarios','{}') = array['admin1','admin2','sec']);
select bt.check('aluno s1: o próprio aluno e o seu encarregado, ninguém mais', bt.targets('nt_a','alunos',array['s1']) = array['aluno1','enc1']);
select bt.check('aluno s2: só o encarregado do s2', bt.targets('nt_a','alunos',array['s2']) = array['enc2']);
select bt.check('vários alunos juntam os destinatários', bt.targets('nt_a','alunos',array['s1','s2']) = array['aluno1','enc1','enc2']);
select bt.check('aluno sem conta: ninguém', bt.targets('nt_a','alunos',array['s99']) = '{}');
select bt.check('utilizadores indicados', bt.targets('nt_a','utilizadores',array['00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a5']) = array['aluno1','prof']);
select bt.check('um utilizador de OUTRA escola indicado por id não recebe', bt.targets('nt_a','utilizadores',array['00000000-0000-0000-0000-0000000000b2']) = '{}');
select bt.check('a escola B só atinge os seus', bt.targets('nt_b','todos','{}') = array['profB']);
select bt.check('tipo de público desconhecido: ninguém (nunca "todos" por engano)', bt.targets('nt_a','qualquer','{}') = '{}');
select bt.check('conta desactivada deixa de receber', (select not exists (select 1 from public.notification_push_targets('nt_a','todos','{}') where endpoint like '%inactivo')));

-- ---------- 7. configuração lida pelo worker ----------
select bt.check('gateway_get devolve a configuração de um canal ligado', (select count(*) = 1 and min(provider) = 'twilio' and min(secret_enc) = 'SEGREDO-SMS-A' and bool_and(critical_only) from public.notification_gateway_get('nt_a','sms')));
update notification_gateways set enabled = false where institution_id='nt_a' and channel='sms';
select bt.check('canal desligado: gateway_get não devolve nada', (select count(*) = 0 from public.notification_gateway_get('nt_a','sms')));
update notification_gateways set enabled = true, secret_enc = null where institution_id='nt_a' and channel='sms';
select bt.check('sem segredo: não conta como ligado', (select count(*) = 0 from public.notification_gateway_get('nt_a','sms'))
  and (select not (v->>'sms')::boolean from (select public.notification_channels_enabled() v) z, (select bt.as_user('00000000-0000-0000-0000-0000000000a3')) u));

-- ---------- 8. apagar a escola leva a configuração e as subscrições ----------
delete from profiles where institution_id = 'nt_b';   -- as contas saem antes da escola (profiles → on delete restrict)
delete from institutions where id = 'nt_b';
select bt.check('apagar a escola apaga a sua configuração e subscrições', (select count(*) = 0 from notification_gateways where institution_id='nt_b')
  and (select count(*) = 0 from push_subscriptions where institution_id='nt_b'));

\o
select name as "FALHOU" from _bres where not ok;
select count(*) filter (where ok) as notificacoes_passou, count(*) filter (where not ok) as notificacoes_falhou from _bres;
drop table public._bres; drop schema bt cascade;
