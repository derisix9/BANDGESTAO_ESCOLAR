-- Testes de palavra-passe temporária e validade no servidor (0045). psql -f supabase/tests/password_policy.test.sql
\set ON_ERROR_STOP on
create schema if not exists tstpw;
grant usage on schema tstpw to anon, authenticated;
create table public._respw(name text, ok boolean);
grant all on public._respw to anon, authenticated;
\o /dev/null
create or replace function tstpw.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); perform set_config('request.headers','',false); end $$;
create or replace function tstpw.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _respw values (name, false);
exception when others then insert into _respw values (name, true); end; end $$;
create or replace function tstpw.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _respw values (name, true);
exception when others then insert into _respw values (name || ' ['||sqlerrm||']', false); end; end $$;
create or replace function tstpw.expect_eq(name text, stmt text, want text) returns void language plpgsql as $$
declare g text; begin execute stmt into g; insert into _respw values (name || ' (got '||coalesce(g,'null')||')', g is not distinct from want); end $$;

-- O stub local de auth.users não tem encrypted_password: acrescenta-o e liga o trigger (no Supabase real a migração já o ligou).
alter table auth.users add column if not exists encrypted_password text;
drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row execute function app.on_password_changed();

insert into auth.users(id,email,encrypted_password) values
 ('00000000-0000-0000-0000-0000000030a1','admin@a.ao','h1'),('00000000-0000-0000-0000-0000000030a2','prof@a.ao','h2'),
 ('00000000-0000-0000-0000-0000000030a3','aluno@a.ao','h3'),('00000000-0000-0000-0000-0000000030b1','admin@b.ao','h4');
insert into institutions(id,name) values ('esc_a','Escola A'),('esc_b','Escola B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000030a1','esc_a','admin','Admin A','admin@a.ao'),
 ('00000000-0000-0000-0000-0000000030a2','esc_a','professor','Prof A','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000030a3','esc_a','aluno','Aluno A','aluno@a.ao'),
 ('00000000-0000-0000-0000-0000000030b1','esc_b','admin','Admin B','admin@b.ao');
insert into records(institution_id,collection,id,data) values ('esc_a','students','a1','{"id":"a1"}'),('esc_b','students','b1','{"id":"b1"}');

-- 1) Conta nova com palavra-passe temporária: a RLS recusa tudo até trocar
update profiles set must_change_password = true where id = '00000000-0000-0000-0000-0000000030a2';
set role authenticated;
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_eq('temporária: não vê dados', $$select count(*)::text from records where collection='students'$$, '0');
select tstpw.expect_fail('temporária: não escreve', $$insert into records(institution_id,collection,id,data) values ('esc_a','students','x1','{"id":"x1"}')$$);
select tstpw.expect_eq('password_status: must_change', $$select public.password_status()->>'must_change'$$, 'true');
select tstpw.expect_eq('ainda lê o próprio perfil (para mostrar o ecrã de troca)', $$select count(*)::text from profiles where id = auth.uid()$$, '1');
-- 2) O utilizador não consegue limpar a marca sozinho
select tstpw.expect_fail('não limpa must_change_password por UPDATE', $$update profiles set must_change_password = false where id = auth.uid()$$);
select tstpw.expect_fail('não forja password_changed_at', $$update profiles set password_changed_at = now() where id = auth.uid()$$);
-- 3) Troca real da palavra-passe (o Auth altera encrypted_password) → trigger limpa a marca
reset role;
select tstpw.as_user(null);   -- como o Auth/servidor: sem utilizador
update auth.users set encrypted_password = 'novo-hash' where id = '00000000-0000-0000-0000-0000000030a2';
set role authenticated;
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_eq('depois de trocar: vê dados', $$select count(*)::text from records where collection='students'$$, '1');
reset role;
select tstpw.as_user(null);   -- como o Auth/servidor: sem utilizador
select tstpw.expect_eq('trigger gravou password_changed_at agora', $$select (password_changed_at > now() - interval '1 minute')::text from profiles where id='00000000-0000-0000-0000-0000000030a2'$$, 'true');
-- mesmo hash não conta como troca
update profiles set must_change_password = true where id = '00000000-0000-0000-0000-0000000030a2';
update auth.users set encrypted_password = 'novo-hash' where id = '00000000-0000-0000-0000-0000000030a2';
select tstpw.expect_eq('hash igual não limpa a marca', $$select must_change_password::text from profiles where id='00000000-0000-0000-0000-0000000030a2'$$, 'true');
update profiles set must_change_password = false where id = '00000000-0000-0000-0000-0000000030a2';

-- 4) Validade (apenas administrador define; 0 ou 30..365)
set role authenticated;
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_fail('professor não define a validade', $$select public.set_password_policy(90)$$);
select tstpw.as_user('00000000-0000-0000-0000-0000000030a1');
select tstpw.expect_fail('validade de 5 dias recusada', $$select public.set_password_policy(5)$$);
select tstpw.expect_fail('validade de 400 dias recusada', $$select public.set_password_policy(400)$$);
select tstpw.expect_ok('admin define 90 dias', $$select public.set_password_policy(90)$$);
-- palavra-passe de 100 dias atrás: expirada (professor); aluno e o próprio admin recente não
reset role;
select tstpw.as_user(null);   -- como o Auth/servidor: sem utilizador
update profiles set password_changed_at = now() - interval '100 days' where id in ('00000000-0000-0000-0000-0000000030a2','00000000-0000-0000-0000-0000000030a3');
set role authenticated;
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_eq('professor com palavra-passe de 100 dias: bloqueado', $$select count(*)::text from records where collection='students'$$, '0');
select tstpw.expect_eq('password_status: expired', $$select public.password_status()->>'expired'$$, 'true');
select tstpw.as_user('00000000-0000-0000-0000-0000000030a3');
select tstpw.expect_eq('aluno nunca expira por idade', $$select count(*)::text from records where collection='students'$$, '1');
select tstpw.as_user('00000000-0000-0000-0000-0000000030a1');
select tstpw.expect_eq('admin com palavra-passe recente: vê dados', $$select count(*)::text from records where collection='students'$$, '1');
select tstpw.expect_eq('days_left coerente (≈ 90)', $$select (((public.password_status()->>'days_left')::int) between 88 and 90)::text$$, 'true');
-- isolamento
select tstpw.as_user('00000000-0000-0000-0000-0000000030b1');
select tstpw.expect_eq('escola B sem política: não é afectada', $$select count(*)::text from records where collection='students'$$, '1');
-- desligar
select tstpw.as_user('00000000-0000-0000-0000-0000000030a1');
select tstpw.expect_ok('admin desliga a validade (0)', $$select public.set_password_policy(0)$$);
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_eq('sem validade: professor volta a ver dados', $$select count(*)::text from records where collection='students'$$, '1');

-- 5) Obrigar a trocar
select tstpw.as_user('00000000-0000-0000-0000-0000000030a1');
select tstpw.expect_fail('admin não se força a si próprio por esta via', $$select public.admin_force_password_change('00000000-0000-0000-0000-0000000030a1')$$);
select tstpw.expect_fail('não força utilizador de outra escola', $$select public.admin_force_password_change('00000000-0000-0000-0000-0000000030b1')$$);
select tstpw.expect_ok('admin força troca ao professor', $$select public.admin_force_password_change('00000000-0000-0000-0000-0000000030a2')$$);
select tstpw.as_user('00000000-0000-0000-0000-0000000030a2');
select tstpw.expect_eq('professor forçado: bloqueado até trocar', $$select count(*)::text from records where collection='students'$$, '0');
select tstpw.expect_fail('professor não força ninguém', $$select public.admin_force_password_change('00000000-0000-0000-0000-0000000030a3')$$);

-- 6) Edge Functions (service_role)
reset role;
select tstpw.as_user(null);   -- como o Auth/servidor: sem utilizador
select tstpw.expect_eq('edge: professor forçado recusado', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000030a2', '1.2.3.4')::text$$, 'false');
select tstpw.expect_eq('edge: admin aceite', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000030a1', '1.2.3.4')::text$$, 'true');
-- 7) Auditoria
select tstpw.expect_eq('auditoria das 3 acções', $$select count(*)::text from audit_log where action in ('RPC:set_password_policy','RPC:admin_force_password_change')$$, '3');

\o
select name as "FALHOU" from _respw where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _respw;
drop table public._respw; drop schema tstpw cascade;
