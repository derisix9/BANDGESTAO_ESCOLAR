-- Testes da monitorização de erros (0047). Corre depois das migrações: psql -f supabase/tests/client_errors.test.sql
\set ON_ERROR_STOP on
create schema if not exists tstc;
grant usage on schema tstc to anon, authenticated;
create table public._resl(name text, ok boolean);
grant all on public._resl to anon, authenticated;
\o /dev/null
create or replace function tstc.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;
create or replace function tstc.expect_fail(name text, stmt text) returns void language plpgsql as $$
begin begin execute stmt; insert into _resl values (name, false);
exception when others then insert into _resl values (name, true); end; end $$;
create or replace function tstc.expect_eq(name text, stmt text, want text) returns void language plpgsql as $$
declare g text; begin execute stmt into g; insert into _resl values (name || ' (got '||coalesce(g,'null')||')', g is not distinct from want); end $$;
grant execute on all functions in schema tstc to anon, authenticated;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000020a1','admin@a.ao'),('00000000-0000-0000-0000-0000000020b1','admin@b.ao'),
 ('00000000-0000-0000-0000-0000000020c1','plataforma@x.ao');
insert into institutions(id,name) values ('esc_a','Escola A'),('esc_b','Escola B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-0000000020a1','esc_a','admin','Admin A','admin@a.ao'),
 ('00000000-0000-0000-0000-0000000020b1','esc_b','admin','Admin B','admin@b.ao');
insert into platform_admins(user_id) values ('00000000-0000-0000-0000-0000000020c1');

set role authenticated;
select tstc.as_user('00000000-0000-0000-0000-0000000020a1');
-- 1) Escola A reporta; o mesmo erro agrupa-se num contador
select public.report_client_error('{"kind":"error","message":"x is undefined","fingerprint":"fp1","url":"https://app/#/alunos"}');
select public.report_client_error('{"kind":"error","message":"x is undefined","fingerprint":"fp1"}');
select tstc.expect_eq('mesmo erro soma ao contador', $$select string_agg(occurrences::text, ',') from (select occurrences from public.client_errors) q$$, null);   -- escola não lê
reset role;
select tstc.expect_eq('agrupou numa só linha com 2 ocorrências', $$select occurrences::text from public.client_errors where fingerprint='fp1'$$, '2');
select tstc.expect_eq('escola deduzida do JWT', $$select institution_id from public.client_errors where fingerprint='fp1'$$, 'esc_a');
-- 2) Mensagem vazia e tipo inválido
set role authenticated;
select tstc.as_user('00000000-0000-0000-0000-0000000020a1');
select tstc.expect_eq('mensagem vazia recusada', $$select public.report_client_error('{"kind":"error","message":""}')::text$$, 'false');
select public.report_client_error('{"kind":"hack","message":"y","fingerprint":"fp2"}');
reset role;
select tstc.expect_eq('tipo inválido vira other', $$select kind from public.client_errors where fingerprint='fp2'$$, 'other');
-- 3) Truncagem
set role authenticated;
select tstc.as_user('00000000-0000-0000-0000-0000000020a1');
select public.report_client_error(jsonb_build_object('kind','error','message',repeat('a',5000),'stack',repeat('b',9000),'fingerprint','fp3'));
reset role;
select tstc.expect_eq('mensagem truncada a 500', $$select length(message)::text from public.client_errors where fingerprint='fp3'$$, '500');
select tstc.expect_eq('stack truncada a 4000', $$select length(stack)::text from public.client_errors where fingerprint='fp3'$$, '4000');
-- 4) Anónimo não reporta
set role anon;
select tstc.expect_fail('anónimo sem execute', $$select public.report_client_error('{"kind":"error","message":"z"}')$$);
-- 5) Escola B não vê nada; plataforma vê e resume
set role authenticated;
select tstc.as_user('00000000-0000-0000-0000-0000000020b1');
select tstc.expect_eq('escola B não lê erros', $$select count(*)::text from public.client_errors$$, '0');
select tstc.expect_fail('escola B não pede o resumo', $$select * from public.platform_client_errors_summary(24)$$);
select tstc.expect_fail('escola B não escreve directamente', $$insert into public.client_errors(kind,message,fingerprint) values ('error','m','f')$$);
select tstc.as_user('00000000-0000-0000-0000-0000000020c1');
select tstc.expect_eq('plataforma lê tudo', $$select count(*)::text from public.client_errors$$, '3');
select tstc.expect_eq('resumo soma ocorrências do fp1', $$select total_occurrences::text from public.platform_client_errors_summary(24) where fingerprint='fp1'$$, '2');
-- 6) Anti-inundação: 100 erros distintos por escola/hora
reset role;
set role authenticated;
select tstc.as_user('00000000-0000-0000-0000-0000000020b1');
select public.report_client_error(jsonb_build_object('kind','error','message','m'||g,'fingerprint','flood'||g)) from generate_series(1,130) g;
reset role;
select tstc.expect_eq('máx. 100 distintos por hora', $$select count(*)::text from public.client_errors where institution_id='esc_b'$$, '100');

reset role;
\o
select name as "FALHOU" from _resl where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resl;
drop table public._resl; drop schema tstc cascade;
