-- Testes de segurança das regras. Corra: psql -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql
\set ON_ERROR_STOP on
create schema tst;
grant usage on schema tst to anon, authenticated;
create table public._res(name text, ok boolean);
grant all on public._res to anon, authenticated;
\o /dev/null
create or replace function tst.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;

-- ---------- dados de base (como superutilizador/servidor) ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@a.ao'),('00000000-0000-0000-0000-0000000000a2','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000000a3','aluno@a.ao'),('00000000-0000-0000-0000-0000000000a4','fin@a.ao'),
 ('00000000-0000-0000-0000-0000000000b1','admin@b.ao'),('00000000-0000-0000-0000-0000000000c1','intruso@x.ao');
insert into institutions(id,name,nif) values ('esc_a','Escola A','5000000001'),('esc_b','Escola B',null);
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000000a1','esc_a','admin','Admin A','admin@a.ao'),
 ('00000000-0000-0000-0000-0000000000a2','esc_a','professor','Prof A','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000000a3','esc_a','aluno','Aluno A','aluno@a.ao'),
 ('00000000-0000-0000-0000-0000000000a4','esc_a','financeiro','Fin A','fin@a.ao'),
 ('00000000-0000-0000-0000-0000000000b1','esc_b','admin','Admin B','admin@b.ao');
insert into records(institution_id,collection,id,data) values
 ('esc_a','students','s1','{"id":"s1","name":"Ana","grades":{},"address":"Rua 1"}'),
 ('esc_b','students','s9','{"id":"s9","name":"Outro"}'),
 ('esc_a','invoices','f1','{"id":"f1","totalAmountKz":1000,"status":"pendente"}');

-- helper: tenta executar e regista se foi bloqueado (esperado) ou permitido
create or replace function tst.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _res values (name, false);
  exception when others then insert into _res values (name, true); end;
end $$;
create or replace function tst.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _res values (name, true);
  exception when others then insert into _res values (name || ' ['||sqlerrm||']', false); end;
end $$;
create or replace function tst.expect_count(name text, stmt text, n int) returns void language plpgsql as $$
declare c int; begin execute stmt into c; insert into _res values (name || ' (got '||c||')', c = n); end $$;


set role authenticated;

-- 1) O buraco crítico: utilizador autenticado sem perfil tenta tornar-se admin de uma escola
select tst.as_user('00000000-0000-0000-0000-0000000000c1');
select tst.expect_fail('intruso NÃO cria perfil admin',
  $$insert into profiles(id,institution_id,role,name,email) values ('00000000-0000-0000-0000-0000000000c1','esc_a','admin','x','x@x')$$);
select tst.expect_count('intruso não vê alunos de nenhuma escola', $$select count(*) from records$$, 0);
select tst.expect_count('intruso não vê escolas', $$select count(*) from institutions$$, 0);

-- 2) Isolamento entre escolas
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_count('admin B só vê a sua escola', $$select count(*) from records where collection='students'$$, 1);
select tst.expect_fail('admin B não escreve na escola A',
  $$insert into records(institution_id,collection,id,data) values ('esc_a','students','x','{"id":"x"}')$$);

-- 3) Aluno malicioso
select tst.as_user('00000000-0000-0000-0000-0000000000a3');
select tst.expect_count('aluno não lê a colecção students', $$select count(*) from records where collection='students'$$, 0);
select tst.expect_fail('aluno não promove o próprio papel',
  $$update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000a3'$$);
select tst.expect_count('aluno não vê auditoria', $$select count(*) from audit_log$$, 0);
select tst.expect_fail('aluno não escreve auditoria',
  $$insert into audit_log(institution_id,action,entity,hash) values ('esc_a','x','y','z')$$);

-- 4) Professor: só campos permitidos
select tst.as_user('00000000-0000-0000-0000-0000000000a2');
select tst.expect_ok('professor altera notas',
  $$update records set data = data || '{"grades":{"mat":15}}' where collection='students' and id='s1'$$);
select tst.expect_fail('professor NÃO altera a morada do aluno',
  $$update records set data = data || '{"address":"outra"}' where collection='students' and id='s1'$$);
select tst.expect_ok('professor tenta apagar aluno (RLS filtra, 0 linhas)', $$delete from records where collection='students' and id='s1'$$);
select tst.expect_count('o aluno continua a existir após a tentativa', $$select count(*) from records where collection='students' and id='s1'$$, 1);
select tst.expect_fail('professor não homologa', $$select homologate_pauta('{"id":"h1","academicYear":"2026"}')$$);

-- 5) Pagamentos e facturas
select tst.as_user('00000000-0000-0000-0000-0000000000a4');
select tst.expect_fail('financeiro NÃO marca "pago" à mão',
  $$update records set data = data || '{"status":"pago"}' where collection='invoices' and id='f1'$$);
select tst.expect_ok('financeiro regista pagamento por RPC', $$select register_payment('f1',1000,'numerario','R1','k1')$$);
select tst.expect_ok('repetir o mesmo pedido não duplica', $$select register_payment('f1',1000,'numerario','R1','k1')$$);
select tst.expect_count('só 1 pagamento gravado', $$select count(*) from payments$$, 1);
select tst.expect_fail('pagamento imutável', $$update payments set amount_kz = 1$$);
select tst.expect_fail('financeiro não apaga pagamentos', $$delete from payments$$);

-- 6) Documentos fiscais
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_ok('admin emite FT n.º 1', $$select issue_fiscal_document('FT','FT2026','Cliente','500','[]',1000,0)$$);
select tst.expect_ok('admin emite FT n.º 2', $$select issue_fiscal_document('FT','FT2026','Cliente','500','[]',2000,0)$$);
select tst.expect_count('numeração sequencial 1,2', $$select count(*) from fiscal_documents where number in (1,2)$$, 2);
select tst.expect_fail('documento fiscal imutável', $$update fiscal_documents set total_kz = 1$$);
select tst.expect_fail('documento fiscal não se apaga', $$delete from fiscal_documents$$);
select tst.expect_fail('anular sem motivo falha', $$update fiscal_documents set status='A' where number=1$$);
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_fail('escola sem NIF não emite documento fiscal', $$select issue_fiscal_document('FT','FT2026','C','1','[]',1,0)$$);

-- 7) Homologação (director/admin) e auditoria
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_ok('admin homologa por RPC', $$select homologate_pauta('{"id":"h1","academicYear":"2026"}')$$);
select tst.expect_fail('ninguém escreve homologação directamente',
  $$insert into records(institution_id,collection,id,data) values ('esc_a','homologations','h2','{"id":"h2"}')$$);
select tst.expect_ok('admin lê auditoria', $$select count(*) from audit_log$$);
select tst.expect_fail('admin não adultera auditoria', $$update audit_log set action='x'$$);
set timezone = 'Asia/Tokyo';
select tst.expect_count('cadeia de auditoria íntegra (mesmo noutro fuso)', $$select count(*) from (select app.verify_audit_chain('esc_a') as bad) q where bad is null$$, 1);
set timezone = 'UTC';

-- 8) Conflito de versão
select tst.expect_ok('admin edita aluno (versão 2)', $$update records set data = data || '{"name":"Ana M"}', version = (select version from records where collection='students' and id='s1') where collection='students' and id='s1' and institution_id='esc_a'$$);
select tst.expect_fail('escrita com versão antiga é recusada',
  $$update records set data = data || '{"name":"Ana Z"}', version = 1 where collection='students' and id='s1' and institution_id='esc_a'$$);

-- 8b) Fluxo da app (0007/0008): ordem decimal, remendo de campos e filtros do servidor
select tst.expect_ok('admin insere registo com ord decimal (2.5)', $$insert into records(institution_id,collection,id,academic_year,ord,data) values ('esc_a','students','s2','2025/2026',2.5,'{"id":"s2","name":"Rui","classId":"c1","status":"active"}')$$);
select tst.expect_count('filtro por turma no servidor', $$select count(*) from records where institution_id='esc_a' and collection='students' and data->>'classId'='c1'$$, 1);
select tst.expect_count('pesquisa por nome no servidor', $$select count(*) from records where institution_id='esc_a' and collection='students' and data->>'name' ilike '%ui%'$$, 1);
select tst.as_user('00000000-0000-0000-0000-0000000000a2');
select tst.expect_ok('professor grava só notas (campo permitido) mantendo o resto', $$update records set data = data || '{"grades":{"m":14}}', version = (select version from records where collection='students' and id='s2') where collection='students' and id='s2' and institution_id='esc_a'$$);
select tst.expect_fail('professor não altera o nome', $$update records set data = data || '{"name":"Hack"}', version = (select version from records where collection='students' and id='s2') where collection='students' and id='s2' and institution_id='esc_a'$$);
delete from records where collection='students' and id='s2' and institution_id='esc_a';   -- a RLS filtra: 0 linhas, sem erro
select tst.expect_count('professor não apaga alunos (continua lá)', $$select count(*) from records where collection='students' and id='s2' and institution_id='esc_a'$$, 1);
select tst.as_user('00000000-0000-0000-0000-0000000000a1');

-- 9) QR público
reset role;
alter table audit_log disable trigger audit_immutable;
update audit_log set detail = '{"forjado":true}' where seq = (select min(seq) from audit_log where institution_id='esc_a' and detail is not null);
alter table audit_log enable trigger audit_immutable;
insert into _res select 'adulteração da auditoria é detectada', app.verify_audit_chain('esc_a') is not null;
set role anon;
select tst.as_user(null);
select tst.expect_fail('anónimo não lê tokens', $$select * from public_tokens$$);
select tst.expect_ok('anónimo consulta token inválido', $$select verify_public_token('nao-existe')$$);
-- 10) QR públicos seguros (0010): publicação, isolamento entre escolas, revogação, validade
reset role;
set role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_ok('admin publica token', $$select publish_public_token('abcde12345','student_card','s:s1','{"v":2,"name":"Ana"}')$$);
select tst.expect_ok('admin republica (actualiza)', $$select publish_public_token('abcde12345','student_card','s:s1','{"v":2,"name":"Ana M"}')$$);
select tst.expect_fail('token inválido é recusado', $$select publish_public_token('ABC','student_card','s:s1','{}')$$);
select tst.expect_fail('tipo inválido é recusado', $$select publish_public_token('fghij12345','xpto','s:s1','{}')$$);
select tst.as_user('00000000-0000-0000-0000-0000000000a2');
select tst.expect_fail('professor não publica', $$select publish_public_token('zzzzz99999','student_card','s:s1','{}')$$);
select tst.as_user('00000000-0000-0000-0000-0000000000b1');
select tst.expect_fail('outra escola não sobrescreve o token', $$select publish_public_token('abcde12345','student_card','s:s1','{"name":"Hack"}')$$);
select tst.expect_count('outra escola não revoga por assunto alheio (0 linhas, sem efeito)', $$select revoke_public_subject('s:s1')$$, 0);
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count('conteúdo não foi adulterado por outra escola', $$select count(*) from public_tokens where token='abcde12345' and payload->>'name'='Ana M'$$, 1);
reset role;
set role anon;
select tst.as_user(null);
select tst.expect_fail('anónimo não lê public_tokens', $$select * from public_tokens$$);
select tst.expect_fail('anónimo não publica', $$select publish_public_token('qqqqq11111','student_card','s:s1','{}')$$);
select tst.expect_count('anónimo verifica token válido', $$select count(*) from (select verify_public_token('abcde12345') as j) q where (j->>'valid')::boolean$$, 1);
select tst.expect_count('token inexistente é inválido', $$select count(*) from (select verify_public_token('0000000000') as j) q where not (j->>'valid')::boolean$$, 1);
reset role;
set role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_count('admin revoga o assunto', $$select revoke_public_subject('s:s1')$$, 1);
select tst.expect_count('republicar token revogado devolve revoked (não ressuscita)', $$select count(*) from (select publish_public_token('abcde12345','student_card','s:s1','{"v":2}') as r) q where r = 'revoked'$$, 1);
reset role;
set role anon;
select tst.as_user(null);
select tst.expect_count('token revogado é inválido', $$select count(*) from (select verify_public_token('abcde12345') as j) q where not (j->>'valid')::boolean$$, 1);
reset role;
set role authenticated;
select tst.as_user('00000000-0000-0000-0000-0000000000a1');
select tst.expect_ok('admin reemite explicitamente', $$select publish_public_token('abcde12345','student_card','s:s1','{"v":2}', 365, true)$$);
reset role;
update public_tokens set expires_at = now() - interval '1 day' where token = 'abcde12345';
set role anon;
select tst.as_user(null);
select tst.expect_count('token expirado é inválido', $$select count(*) from (select verify_public_token('abcde12345') as j) q where not (j->>'valid')::boolean$$, 1);
reset role;
\o
select name as "FALHOU" from _res where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _res;
drop table public._res; drop schema tst cascade;
