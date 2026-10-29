-- Testes da eliminação de dados da escola (0015 + correcção 0016). Corre depois das migrações.
\set ON_ERROR_STOP on
create schema dt;
create table public._dres(name text, ok boolean);
grant usage on schema dt to anon, authenticated, service_role;
grant all on public._dres to anon, authenticated, service_role;
\o /dev/null

create or replace function dt.expect_fail_msg(name text, stmt text, frag text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _dres values (name, false);
  exception when others then insert into _dres values (name || ' ['||sqlerrm||']', position(frag in sqlerrm) > 0); end;
end $$;
create or replace function dt.check(name text, cond boolean) returns void language plpgsql as $$
begin insert into _dres values (name, coalesce(cond, false)); end $$;
create or replace function dt.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); end $$;
create table dt.snap(k text primary key, v jsonb);
grant all on dt.snap to authenticated;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000d0001','admin@dl-a.ao'),
 ('00000000-0000-0000-0000-0000000d0002','prof@dl-a.ao'),
 ('00000000-0000-0000-0000-0000000d00b1','admin@dl-b.ao');
insert into institutions(id,name) values ('dl_a','ESCOLA DL A'),('dl_b','ESCOLA DL B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000d0001','dl_a','admin','Admin A','admin@dl-a.ao'),
 ('00000000-0000-0000-0000-0000000d0002','dl_a','professor','Prof A','prof@dl-a.ao'),
 ('00000000-0000-0000-0000-0000000d00b1','dl_b','admin','Admin B','admin@dl-b.ao');
insert into records(institution_id,collection,id,ord,data) values
 ('dl_a','students','s1',1,'{"id":"s1","name":"Ana"}'),
 ('dl_a','students','s2',2,'{"id":"s2","name":"Bruno"}'),
 ('dl_b','students','s9',1,'{"id":"s9","name":"Outro"}');
insert into institution_docs(institution_id,key,data) values ('dl_a','settings','{"name":"A"}');
insert into user_access(institution_id,user_id,sections) values ('dl_a','00000000-0000-0000-0000-0000000d0002','{"alunos":"read"}');
insert into payments(institution_id,invoice_id,amount_kz,method,idempotency_key,registered_by)
 values ('dl_a','f1',1000,'numerario','dk1','00000000-0000-0000-0000-0000000d0001');

-- 1) o admin prepara: recebe bilhete + backup completo (sem depender de app.export_school)
select dt.check('app.export_school NÃO é necessária', to_regprocedure('app.export_school(text)') is null);
select dt.as_user('00000000-0000-0000-0000-0000000d0001');
set role authenticated;
insert into dt.snap select 'prep', public.school_delete_prepare('ESCOLA DL A', 'Eliminar banco de dados');
reset role;
select dt.check('prepare devolve bilhete', (select (v ->> 'ticket') is not null from dt.snap where k='prep'));
select dt.check('backup no formato bandmed-school-backup v1', (select v #>> '{backup,format}' = 'bandmed-school-backup' and v #>> '{backup,formatVersion}' = '1' and v #>> '{backup,institutionId}' = 'dl_a' from dt.snap where k='prep'));
select dt.check('backup tem os dados da escola (2 registos, 1 doc, 1 acesso, 1 pagamento)', (select (v #>> '{backup,counts,records}')::int = 2 and (v #>> '{backup,counts,docs}')::int = 1 and (v #>> '{backup,counts,userAccess}')::int = 1 and (v #>> '{backup,counts,payments}')::int = 1 from dt.snap where k='prep'));
select dt.check('backup não leva dados de outra escola', (select not (v::text like '%Outro%') and not (v::text like '%ESCOLA DL B%') from dt.snap where k='prep'));
select dt.check('prepare auditado', (select count(*) = 1 from audit_log where institution_id='dl_a' and action='RPC:school_delete_prepared'));

-- 2) quem não pode
select dt.as_user('00000000-0000-0000-0000-0000000d0002');
set role authenticated;
select dt.expect_fail_msg('professor não prepara', $$select public.school_delete_prepare('ESCOLA DL A','Eliminar banco de dados')$$, 'Confirmação inválida');
reset role;
select dt.as_user('00000000-0000-0000-0000-0000000d0001');
set role authenticated;
select dt.expect_fail_msg('nome errado', $$select public.school_delete_prepare('ESCOLA DL B','Eliminar banco de dados')$$, 'Confirmação inválida');
select dt.expect_fail_msg('frase errada', $$select public.school_delete_prepare('ESCOLA DL A','apagar')$$, 'Confirmação inválida');
reset role;
select dt.as_user('');
set role anon;
select dt.expect_fail_msg('anon não prepara', $$select public.school_delete_prepare('ESCOLA DL A','Eliminar banco de dados')$$, 'permission denied');
reset role;

-- 3) a eliminação (com o último bilhete, que é o que ficou activo)
select dt.as_user('00000000-0000-0000-0000-0000000d0001');
set role authenticated;
select dt.expect_fail_msg('bilhete inventado não apaga', $$select public.school_delete_execute(gen_random_uuid(),'ESCOLA DL A','Eliminar banco de dados')$$, 'Bilhete inválido');
insert into dt.snap select 'exec', public.school_delete_execute((select (v ->> 'ticket')::uuid from dt.snap where k='prep'), 'ESCOLA DL A', 'Eliminar banco de dados');
reset role;
select dt.as_user('');
select dt.check('registos e documentos da escola apagados', (select count(*) = 0 from records where institution_id='dl_a') and (select count(*) = 0 from institution_docs where institution_id='dl_a') and (select count(*) = 0 from user_access where institution_id='dl_a'));
select dt.check('outra escola intacta', (select count(*) = 1 from records where institution_id='dl_b'));
select dt.check('escola, contas e pagamentos ficam', (select count(*) = 1 from institutions where id='dl_a') and (select count(*) = 2 from profiles where institution_id='dl_a') and (select count(*) = 1 from payments where institution_id='dl_a'));
select dt.as_user('00000000-0000-0000-0000-0000000d0001');
set role authenticated;
select dt.expect_fail_msg('bilhete só serve uma vez', $$select public.school_delete_execute((select (v ->> 'ticket')::uuid from dt.snap where k='prep'),'ESCOLA DL A','Eliminar banco de dados')$$, 'Bilhete inválido');
reset role;

-- 4) aceitação dos termos (0017): gravada pelo servidor, a escola não a altera nem lê o histórico
select dt.as_user('');
insert into institution_terms_acceptances(institution_id, user_id, version) values ('dl_a','00000000-0000-0000-0000-0000000d0001','1.0');
update institutions set terms_version='1.0', terms_accepted_at=now() where id='dl_a';
select dt.as_user('00000000-0000-0000-0000-0000000d0001');
set role authenticated;
select dt.expect_fail_msg('admin da escola não altera a versão dos termos', $$update institutions set terms_version='9.9' where id='dl_a'$$, 'aceitação dos termos');
select dt.expect_fail_msg('admin da escola não lê o histórico directamente', $$select * from institution_terms_acceptances$$, 'permission denied');
insert into dt.snap select 'terms', public.my_terms_acceptance();
reset role;
select dt.check('my_terms_acceptance devolve versão 1.0 e data', (select v ->> 'version' = '1.0' and v ->> 'acceptedAt' is not null from dt.snap where k='terms'));
select dt.expect_fail_msg('versão inválida recusada', $$insert into institution_terms_acceptances(institution_id, version) values ('dl_a','abc')$$, 'check constraint');

\o
select name as "FALHOU" from _dres where not ok;
select count(*) filter (where ok) as delete_passou, count(*) filter (where not ok) as delete_falhou from _dres;
drop table public._dres; drop schema dt cascade;
