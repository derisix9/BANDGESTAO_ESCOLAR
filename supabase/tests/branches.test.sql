-- Testes das filiais (0024). Corre depois das migrações: psql -f supabase/tests/branches.test.sql
\set ON_ERROR_STOP on
create schema if not exists tstb;
grant usage on schema tstb to anon, authenticated;
create table public._resb(name text, ok boolean);
grant all on public._resb to anon, authenticated;
\o /dev/null
create or replace function tstb.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;
create or replace function tstb.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resb values (name, false);
exception when others then insert into _resb values (name, true); end; end $$;
create or replace function tstb.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resb values (name, true);
exception when others then insert into _resb values (name || ' ['||sqlerrm||']', false); end; end $$;
create or replace function tstb.expect_count(name text, stmt text, n int) returns void language plpgsql as $$
declare c int; begin execute stmt into c; insert into _resb values (name || ' (got '||c||')', c = n); end $$;

-- ---------- base: mãe M com admin, professor; filial F1 e F2; escola independente X ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000f001','admin@m.ao'),('00000000-0000-0000-0000-00000000f002','prof@m.ao'),
 ('00000000-0000-0000-0000-00000000f003','prof@f1.ao'),('00000000-0000-0000-0000-00000000f004','admin@x.ao'),
 ('00000000-0000-0000-0000-00000000f0aa','plataforma@bandmed.ao');
insert into institutions(id,name) values ('esc_mae','Escola Mãe'),('esc_x','Escola X'),('esc_y','Escola Y (sem admin)');
insert into institutions(id,name,parent_id) values ('esc_f1','Filial 1','esc_mae'),('esc_f2','Filial 2','esc_mae');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-00000000f001','esc_mae','admin','Admin Mãe','admin@m.ao'),
 ('00000000-0000-0000-0000-00000000f002','esc_mae','professor','Prof Mãe','prof@m.ao'),
 ('00000000-0000-0000-0000-00000000f003','esc_f1','professor','Prof F1','prof@f1.ao'),
 ('00000000-0000-0000-0000-00000000f004','esc_x','admin','Admin X','admin@x.ao');
insert into platform_admins(user_id) values ('00000000-0000-0000-0000-00000000f0aa');
insert into records(institution_id,collection,id,data) values
 ('esc_mae','students','m1','{"id":"m1","name":"Aluno Mãe"}'),
 ('esc_f1','students','f1a','{"id":"f1a","name":"Aluno F1 a"}'),
 ('esc_f1','students','f1b','{"id":"f1b","name":"Aluno F1 b"}'),
 ('esc_f2','students','f2a','{"id":"f2a","name":"Aluno F2"}'),
 ('esc_x','students','x1','{"id":"x1","name":"Aluno X"}');

set role authenticated;

-- 1) Admin da mãe começa na mãe: só vê os alunos da mãe
select tstb.as_user('00000000-0000-0000-0000-00000000f001');
select tstb.expect_count('admin mãe começa na mãe (1 aluno)', $$select count(*) from records where collection='students'$$, 1);
select tstb.expect_count('my_schools lista mãe + 2 filiais', $$select jsonb_array_length(public.my_schools())$$, 3);

-- 2) Troca para a filial 1: vê SÓ a filial 1 (isolamento) e escreve nela
select tstb.expect_ok('admin mãe entra na filial 1', $$select public.switch_institution('esc_f1')$$);
select tstb.expect_count('na filial 1 vê só os 2 alunos da filial 1', $$select count(*) from records where collection='students'$$, 2);
select tstb.expect_ok('na filial 1 grava na filial 1',
  $$insert into records(institution_id,collection,id,data) values ('esc_f1','students','f1c','{"id":"f1c"}')$$);
select tstb.expect_fail('na filial 1 não grava na mãe',
  $$insert into records(institution_id,collection,id,data) values ('esc_mae','students','zz','{"id":"zz"}')$$);
select tstb.expect_fail('na filial 1 não grava na filial 2',
  $$insert into records(institution_id,collection,id,data) values ('esc_f2','students','zz','{"id":"zz"}')$$);

-- 3) Filial 2 e regresso à mãe
select tstb.expect_ok('admin entra na filial 2', $$select public.switch_institution('esc_f2')$$);
select tstb.expect_count('na filial 2 vê só 1 aluno', $$select count(*) from records where collection='students'$$, 1);
select tstb.expect_ok('admin volta à mãe', $$select public.switch_institution('esc_mae')$$);
select tstb.expect_count('de volta à mãe vê 1 aluno', $$select count(*) from records where collection='students'$$, 1);

-- 4) Limites da troca
select tstb.expect_fail('admin mãe não entra numa escola alheia', $$select public.switch_institution('esc_x')$$);
select tstb.expect_fail('admin mãe não define escola ativa alheia por UPDATE direto',
  $$update profiles set active_institution_id='esc_x' where id='00000000-0000-0000-0000-00000000f001'$$);
select tstb.as_user('00000000-0000-0000-0000-00000000f002');
select tstb.expect_fail('professor não troca de escola', $$select public.switch_institution('esc_f1')$$);
select tstb.expect_fail('professor não define escola ativa por UPDATE direto',
  $$update profiles set active_institution_id='esc_f1' where id='00000000-0000-0000-0000-00000000f002'$$);
select tstb.expect_count('professor tem uma única escola em my_schools', $$select jsonb_array_length(public.my_schools())$$, 1);
select tstb.as_user('00000000-0000-0000-0000-00000000f004');
select tstb.expect_fail('admin X não entra na filial da mãe', $$select public.switch_institution('esc_f1')$$);
select tstb.expect_count('admin X só vê a sua escola', $$select count(*) from records where collection='students'$$, 1);

-- 5) Hierarquia: imutável, um só nível, escola não altera a sua mãe
select tstb.as_user('00000000-0000-0000-0000-00000000f001');
select tstb.expect_fail('admin não altera parent_id da filial', $$update institutions set parent_id=null where id='esc_f1'$$);
reset role;
select tstb.as_user(null);
select tstb.expect_fail('filial de filial é recusada', $$insert into institutions(id,name,parent_id) values ('esc_neta','Neta','esc_f1')$$);
select tstb.expect_fail('mãe com filiais não pode ser eliminada', $$delete from institutions where id='esc_mae'$$);

-- 6) Plano da mãe governa as filiais (e a sincronização)
select tstb.as_user(null);
update institutions set plan_status='pago', paid_until=now()+interval '30 days' where id='esc_mae';
select tstb.expect_count('plano da mãe propagado à filial', $$select count(*) from institutions where id='esc_f1' and plan_status='pago' and paid_until is not null$$, 1);
set role authenticated;
select tstb.as_user('00000000-0000-0000-0000-00000000f001');
select tstb.expect_ok('admin entra na filial 1 (plano ativo)', $$select public.switch_institution('esc_f1')$$);
reset role;
select tstb.as_user(null);
update institutions set status='suspended' where id='esc_mae';
set role authenticated;
select tstb.expect_count('mãe suspensa bloqueia também a filial', $$select count(*) from records where collection='students'$$, 0);
reset role;
select tstb.as_user(null);
update institutions set status='active' where id='esc_mae';

-- 7) Criação de filiais: só a plataforma
set role authenticated;
select tstb.as_user('00000000-0000-0000-0000-00000000f001');
select tstb.expect_fail('admin de escola não cria filiais', $$select public.platform_create_branch('esc_mae','Filial Nova')$$);
select tstb.as_user('00000000-0000-0000-0000-00000000f0aa');
select tstb.expect_ok('plataforma cria filial', $$select public.platform_create_branch('esc_mae','Filial Nova do Kilamba','5001234567')$$);
select tstb.expect_fail('plataforma não cria filial de filial', $$select public.platform_create_branch('esc_f1','Neta')$$);
select tstb.expect_fail('plataforma não cria filial sem escola mãe válida', $$select public.platform_create_branch('nao_existe','Filial Fantasma')$$);
select tstb.expect_fail('plataforma não cria filial sem admin ativo na mãe', $$select public.platform_create_branch('esc_y','Filial de Y')$$);
select tstb.expect_count('nova filial herda o plano da mãe', $$select count(*) from institutions where name='Filial Nova do Kilamba' and parent_id='esc_mae' and plan_status='pago'$$, 1);
select tstb.expect_count('nova filial tem settings próprios', $$select count(*) from institution_docs d join institutions i on i.id=d.institution_id where i.name='Filial Nova do Kilamba' and d.key='settings'$$, 1);
select tstb.expect_count('platform_branch_links devolve as 3 filiais', $$select count(*) from public.platform_branch_links()$$, 3);

reset role;
\o
select name as "FALHOU" from _resb where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resb;
drop table public._resb; drop schema tstb cascade;
