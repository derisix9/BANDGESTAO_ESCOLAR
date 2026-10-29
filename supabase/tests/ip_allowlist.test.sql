-- Testes da lista de IPs no servidor (0043). Corre depois das migrações: psql -f supabase/tests/ip_allowlist.test.sql
\set ON_ERROR_STOP on
create schema if not exists tstip;
grant usage on schema tstip to anon, authenticated;
create table public._resip(name text, ok boolean);
grant all on public._resip to anon, authenticated;
\o /dev/null
create or replace function tstip.as_user(u uuid, ip text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false);
  perform set_config('request.headers', case when ip is null then '' else json_build_object('cf-connecting-ip', ip)::text end, false);
end $$;
create or replace function tstip.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resip values (name, false);
exception when others then insert into _resip values (name, true); end; end $$;
create or replace function tstip.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resip values (name, true);
exception when others then insert into _resip values (name || ' ['||sqlerrm||']', false); end; end $$;
create or replace function tstip.expect_eq(name text, stmt text, want text) returns void language plpgsql as $$
declare g text; begin execute stmt into g; insert into _resip values (name || ' (got '||coalesce(g,'null')||')', g is not distinct from want); end $$;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000020a1','admin@a.ao'),('00000000-0000-0000-0000-0000000020a2','sec@a.ao'),
 ('00000000-0000-0000-0000-0000000020a3','prof@a.ao'),('00000000-0000-0000-0000-0000000020a4','aluno@a.ao'),
 ('00000000-0000-0000-0000-0000000020b1','admin@b.ao'),('00000000-0000-0000-0000-0000000020aa','plat@bandmed.ao');
insert into institutions(id,name) values ('esc_a','Escola A'),('esc_b','Escola B');
insert into institutions(id,name,parent_id) values ('esc_a1','Filial A1','esc_a');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000020a1','esc_a','admin','Admin A','admin@a.ao'),
 ('00000000-0000-0000-0000-0000000020a2','esc_a','secretaria','Sec A','sec@a.ao'),
 ('00000000-0000-0000-0000-0000000020a3','esc_a','professor','Prof A','prof@a.ao'),
 ('00000000-0000-0000-0000-0000000020a4','esc_a','aluno','Aluno A','aluno@a.ao'),
 ('00000000-0000-0000-0000-0000000020b1','esc_b','admin','Admin B','admin@b.ao');
insert into platform_admins(user_id) values ('00000000-0000-0000-0000-0000000020aa');
insert into records(institution_id,collection,id,data) values
 ('esc_a','students','a1','{"id":"a1","name":"Aluno A"}'),('esc_b','students','b1','{"id":"b1","name":"Aluno B"}');

-- 0) Funções puras: normalização e pertença
select tstip.expect_eq('normaliza CIDR com bits no host', $$select app.normalize_ip_entry('197.218.10.4/24')$$, '197.218.10.0/24');
select tstip.expect_eq('prefixo vira /24', $$select app.normalize_ip_entry('197.218.10.')$$, '197.218.10.0/24');
select tstip.expect_eq('prefixo vira /16', $$select app.normalize_ip_entry('197.218.')$$, '197.218.0.0/16');
select tstip.expect_eq('IP exacto', $$select app.normalize_ip_entry(' 197.218.10.4 ')$$, '197.218.10.4');
select tstip.expect_fail('lixo é recusado', $$select app.normalize_ip_entry('abc')$$);
select tstip.expect_fail('octeto > 255 recusado', $$select app.normalize_ip_entry('300.1.1.1')$$);
select tstip.expect_fail('intervalo invertido recusado', $$select app.normalize_ip_entry('10.0.0.9-10.0.0.1')$$);
select tstip.expect_eq('IP dentro do CIDR', $$select app.ip_in_ranges('197.218.10.77', array['197.218.10.0/24'])::text$$, 'true');
select tstip.expect_eq('IP fora do CIDR', $$select app.ip_in_ranges('197.218.11.77', array['197.218.10.0/24'])::text$$, 'false');
select tstip.expect_eq('IP dentro do intervalo', $$select app.ip_in_ranges('10.20.30.5', array['10.20.30.1-10.20.30.60'])::text$$, 'true');
select tstip.expect_eq('IP fora do intervalo', $$select app.ip_in_ranges('10.20.30.61', array['10.20.30.1-10.20.30.60'])::text$$, 'false');
select tstip.expect_eq('entrada corrompida nunca abre a porta', $$select app.ip_in_ranges('1.2.3.4', array['lixo','/','x-y'])::text$$, 'false');

-- 1) Sem lista: ninguém é restringido, mesmo sem IP
set role authenticated;
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', null);
select tstip.expect_eq('sem lista: secretaria vê dados sem IP', $$select count(*)::text from records where collection='students'$$, '1');

-- 2) Admin grava a lista a partir de um IP que está nela
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_fail('admin não se auto-bloqueia (IP fora da lista)', $$select public.set_ip_policy(array['10.0.0.0/8'])$$);
select tstip.expect_fail('lista inválida recusada', $$select public.set_ip_policy(array['197.218.10.0/24','abc'])$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', null);
select tstip.expect_fail('sem IP determinável não grava (fail-closed)', $$select public.set_ip_policy(array['197.218.10.0/24'])$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_ok('admin grava a lista a partir de IP dentro dela', $$select public.set_ip_policy(array['197.218.10.0/24'])$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '197.218.10.5');
select tstip.expect_fail('secretaria não grava a lista', $$select public.set_ip_policy(array['197.218.10.0/24'])$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_fail('admin não faz UPDATE directo da lista', $$update institutions set allowed_ip_ranges='{}' where id='esc_a'$$);

-- 3) Aplicação na RLS
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '197.218.10.99');
select tstip.expect_eq('secretaria dentro da lista vê dados', $$select count(*)::text from records where collection='students'$$, '1');
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '41.0.0.1');
select tstip.expect_eq('secretaria FORA da lista não vê nada', $$select count(*)::text from records where collection='students'$$, '0');
select tstip.expect_fail('secretaria FORA da lista não escreve', $$insert into records(institution_id,collection,id,data) values ('esc_a','students','x9','{"id":"x9"}')$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', null);
select tstip.expect_eq('secretaria sem IP determinável: recusada (fail-closed)', $$select count(*)::text from records where collection='students'$$, '0');
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '41.0.0.1, 197.218.10.5');
select tstip.expect_eq('valor forjado no cabeçalho não passa', $$select count(*)::text from records where collection='students'$$, '0');
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '41.0.0.1');
select tstip.expect_eq('admin FORA da lista também não vê', $$select count(*)::text from records where collection='students'$$, '0');
-- perfis fora do âmbito (por omissão: professor e aluno)
select tstip.as_user('00000000-0000-0000-0000-0000000020a3', '41.0.0.1');
select tstip.expect_eq('professor não é restringido por omissão', $$select count(*)::text from records where collection='students'$$, '1');
-- isolamento mantém-se
select tstip.as_user('00000000-0000-0000-0000-0000000020b1', '41.0.0.1');
select tstip.expect_eq('escola B não é afectada pela lista da A', $$select count(*)::text from records where collection='students'$$, '1');

-- 4) Estado para a app
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '41.0.0.1');
select tstip.expect_eq('ip_access_status: bloqueado', $$select (public.ip_access_status()->>'blocked')$$, 'true');
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '197.218.10.5');
select tstip.expect_eq('ip_access_status: permitido', $$select (public.ip_access_status()->>'blocked')$$, 'false');

-- 5) Perfis: admin pode incluir professor; nunca aluno/encarregado
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_fail('aluno não pode ser restringido', $$select public.set_ip_policy(array['197.218.10.0/24'], array['admin','aluno'])$$);
select tstip.expect_ok('professor pode ser incluído', $$select public.set_ip_policy(array['197.218.10.0/24'], array['director','secretaria','financeiro','professor'])$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a3', '41.0.0.1');
select tstip.expect_eq('professor incluído e fora da lista: bloqueado', $$select count(*)::text from records where collection='students'$$, '0');
select tstip.as_user('00000000-0000-0000-0000-0000000020a4', '41.0.0.1');
select tstip.expect_eq('aluno nunca é restringido (acesso à sua escola mantém-se resolvido)', $$select (public.ip_access_status()->>'blocked')$$, 'false');

-- 6) Filial herda a lista da mãe
reset role;
select tstip.expect_eq('filial herda a lista da mãe', $$select app.ip_check('00000000-0000-0000-0000-0000000020a2','esc_a1','41.0.0.1')::text$$, 'false');
select tstip.expect_eq('filial herda: IP dentro passa', $$select app.ip_check('00000000-0000-0000-0000-0000000020a2','esc_a1','197.218.10.9')::text$$, 'true');

-- 7) Edge Functions (service_role)
select tstip.expect_eq('edge_ip_allowed: dentro', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000020a2','197.218.10.7')::text$$, 'true');
select tstip.expect_eq('edge_ip_allowed: fora', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000020a2','41.0.0.1')::text$$, 'false');
select tstip.expect_eq('edge_ip_allowed: sem IP (fail-closed)', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000020a2',null)::text$$, 'false');
set role authenticated;
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_fail('cliente não chama edge_ip_allowed', $$select public.edge_ip_allowed('00000000-0000-0000-0000-0000000020a2','197.218.10.7')$$);

-- 8) Chave de emergência da plataforma
select tstip.as_user('00000000-0000-0000-0000-0000000020a1', '197.218.10.5');
select tstip.expect_fail('admin de escola não usa a chave de emergência', $$select public.platform_clear_ip_ranges('esc_a')$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020aa', '41.9.9.9');
select tstip.expect_ok('plataforma limpa a lista', $$select public.platform_clear_ip_ranges('esc_a')$$);
select tstip.as_user('00000000-0000-0000-0000-0000000020a2', '41.0.0.1');
select tstip.expect_eq('depois de limpa, a secretaria volta a entrar', $$select count(*)::text from records where collection='students'$$, '1');

reset role;
\o
select name as "FALHOU" from _resip where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resip;
drop table public._resip; drop schema tstip cascade;
