-- Testes do bloqueio de login no servidor (0042). Corre depois das migrações: psql -f supabase/tests/login_lockout.test.sql
\set ON_ERROR_STOP on
create schema if not exists tstl;
grant usage on schema tstl to anon, authenticated;
create table public._resl(name text, ok boolean);
grant all on public._resl to anon, authenticated;
\o /dev/null
create or replace function tstl.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;
create or replace function tstl.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resl values (name, false);
exception when others then insert into _resl values (name, true); end; end $$;
create or replace function tstl.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resl values (name, true);
exception when others then insert into _resl values (name || ' ['||sqlerrm||']', false); end; end $$;
create or replace function tstl.expect_eq(name text, stmt text, want text) returns void language plpgsql as $$
declare g text; begin execute stmt into g; insert into _resl values (name || ' (got '||coalesce(g,'null')||')', g is not distinct from want); end $$;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000010a1','admin@a.ao'),('00000000-0000-0000-0000-0000000010a2','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000010b1','admin@b.ao');
insert into institutions(id,name) values ('esc_a','Escola A'),('esc_b','Escola B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000010a1','esc_a','admin','Admin A','admin@a.ao'),
 ('00000000-0000-0000-0000-0000000010a2','esc_a','professor','Prof A','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000010b1','esc_b','admin','Admin B','admin@b.ao');

-- 1) 4 falhas: ainda continua; 5.ª falha: rejeita e bloqueia
select tstl.expect_eq('falha 1 continua', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}')->>'decision'$$, 'continue');
select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}');
select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}');
select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}');
select tstl.expect_eq('5.ª falha rejeita', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}')->>'decision'$$, 'reject');
-- 2) Com bloqueio activo, a palavra-passe CERTA também é rejeitada
select tstl.expect_eq('bloqueado rejeita mesmo com palavra-passe certa', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":true}')->>'decision'$$, 'reject');
-- 3) Outro utilizador não é afectado
select tstl.expect_eq('outro utilizador continua', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010b1","valid":true}')->>'decision'$$, 'continue');
-- 4) Bloqueio expirado + palavra-passe certa → entra e zera o contador
update public.login_attempts set locked_until = now() - interval '1 minute' where user_id='00000000-0000-0000-0000-0000000010a2';
select tstl.expect_eq('bloqueio expirado deixa entrar', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":true}')->>'decision'$$, 'continue');
-- 5) Auditoria registou o bloqueio
select tstl.expect_eq('auditoria registou o bloqueio', $$select count(*)::text from audit_log where action='LOGIN_BLOQUEADO' and institution_id='esc_a'$$, '1');
-- 6) Reincidência: 2.º bloqueio dura mais (≥ 30 min)
select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":false}') from generate_series(1,5);
select tstl.expect_eq('reincidente fica bloqueado > 25 min', $$select (locked_until > now() + interval '25 minutes')::text from public.login_attempts where user_id='00000000-0000-0000-0000-0000000010a2'$$, 'true');

-- 7) Permissões: o cliente não lê a tabela nem chama o hook
set role authenticated;
select tstl.as_user('00000000-0000-0000-0000-0000000010a1');
select tstl.expect_fail('cliente não lê login_attempts', $$select * from public.login_attempts$$);
select tstl.expect_fail('cliente não chama o hook', $$select public.hook_password_verification_attempt('{"user_id":"00000000-0000-0000-0000-0000000010a2","valid":true}')$$);
-- 8) Desbloqueio
select tstl.expect_eq('admin vê 1 utilizador bloqueado', $$select count(*)::text from public.locked_users()$$, '1');
select tstl.expect_ok('admin desbloqueia utilizador da sua escola', $$select public.admin_unlock_user('00000000-0000-0000-0000-0000000010a2')$$);
select tstl.expect_eq('já ninguém bloqueado', $$select count(*)::text from public.locked_users()$$, '0');
select tstl.expect_fail('admin não desbloqueia utilizador de outra escola', $$select public.admin_unlock_user('00000000-0000-0000-0000-0000000010b1')$$);
select tstl.as_user('00000000-0000-0000-0000-0000000010a2');
select tstl.expect_fail('professor não desbloqueia', $$select public.admin_unlock_user('00000000-0000-0000-0000-0000000010a2')$$);

reset role;
\o
select name as "FALHOU" from _resl where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resl;
drop table public._resl; drop schema tstl cascade;
