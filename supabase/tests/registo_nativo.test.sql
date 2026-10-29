-- Testes do registo nativo (0046): e-mails descartáveis, escola só com e-mail confirmado, idempotência, permissões.
\set ON_ERROR_STOP on
create table public._resp(name text, ok boolean);
grant all on public._resp to anon, authenticated;
\o /dev/null
-- recusa e-mails temporários (domínio e subdomínio) e aceita os normais
do $$ begin begin insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000070f1','x@yopmail.com');
  insert into _resp values ('yopmail recusado', false); exception when others then insert into _resp values ('yopmail recusado', true); end; end $$;
do $$ begin begin insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000070f2','x@sub.Mailinator.com');
  insert into _resp values ('subdomínio descartável recusado', false); exception when others then insert into _resp values ('subdomínio descartável recusado', true); end; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values
 ('00000000-0000-0000-0000-0000000070a2','ok@escola.ao', now(), '{"registration":"school","school_name":"Escola Ótima Nº 1","admin_name":"Maria Admin","terms_version":"1.0","nif":"5000123456","username":"maria","settings":{"province":"Luanda"}}', now()),
 ('00000000-0000-0000-0000-0000000070a3','sem@escola.ao', now(), '{}', now()),
 ('00000000-0000-0000-0000-0000000070a4','semtermos@escola.ao', now(), '{"registration":"school","school_name":"Escola X","admin_name":"Ana"}', now()),
 ('00000000-0000-0000-0000-0000000070a5','velho@escola.ao', null, '{"registration":"school","school_name":"Escola Velha"}', now() - interval '10 days'),
 ('00000000-0000-0000-0000-0000000070a6','novo@escola.ao', null, '{"registration":"school","school_name":"Escola Nova"}', now()),
 ('00000000-0000-0000-0000-0000000070a7','naoconf@escola.ao', null, '{"registration":"school","school_name":"Escola Por Confirmar","admin_name":"Rui","terms_version":"1.0"}', now());
insert into _resp select 'e-mail normal aceite', exists (select 1 from auth.users where email='ok@escola.ao');

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u)::text, false) $$;
create temp table r1(j jsonb); grant all on r1 to authenticated;

-- 1) sem sessão e sem e-mail confirmado: recusado, nada criado
set role authenticated;
do $$ begin begin perform public.complete_registration(); insert into _resp values ('sem sessão recusado', false);
  exception when others then insert into _resp values ('sem sessão recusado', true); end; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000070a7');
do $$ begin begin perform public.complete_registration(); insert into _resp values ('e-mail por confirmar recusado', false);
  exception when others then insert into _resp values ('e-mail por confirmar recusado', true); end; end $$;
reset role;
insert into _resp select 'por confirmar não cria escola', not exists (select 1 from institutions where name='Escola Por Confirmar');
insert into _resp select 'por confirmar não cria perfil', not exists (select 1 from profiles where id='00000000-0000-0000-0000-0000000070a7');

-- 2) conta confirmada sem dados de registo: devolve null
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000070a3');
insert into r1 select public.complete_registration();
reset role;
insert into _resp select 'conta sem registo devolve null', (select j from r1) is null; delete from r1;
-- dados inválidos: recusado
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000070a4');
do $$ begin begin perform public.complete_registration(); insert into _resp values ('dados inválidos recusados', false);
  exception when others then insert into _resp values ('dados inválidos recusados', true); end; end $$;

-- 3) confirmado: cria escola + administrador fundador + termos; 2.ª chamada não duplica
select pg_temp.as_user('00000000-0000-0000-0000-0000000070a2');
insert into r1 select public.complete_registration();
reset role;
insert into _resp select 'cria escola', (select j->>'created' from r1) = 'true' and exists (select 1 from institutions where name='Escola Ótima Nº 1' and plan_status='trial' and nif='5000123456');
insert into _resp select 'id da escola válido', (select j->>'institutionId' from r1) ~ '^inst_escola_otima_n_1_[0-9a-f]{6}$';
insert into _resp select 'cria admin fundador', exists (select 1 from profiles where id='00000000-0000-0000-0000-0000000070a2' and role='admin' and is_founder and name='Maria Admin' and data->>'username'='maria');
insert into _resp select 'regista aceitação dos termos', exists (select 1 from institution_terms_acceptances where user_id='00000000-0000-0000-0000-0000000070a2' and version='1.0');
insert into _resp select 'devolve definições', (select j->'settings'->>'province' from r1) = 'Luanda';
insert into _resp select 'limpa os dados do registo da conta', (select raw_user_meta_data from auth.users where id='00000000-0000-0000-0000-0000000070a2') = '{}'::jsonb;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000070a2');
delete from r1; insert into r1 select public.complete_registration();
reset role;
insert into _resp select 'repetir não duplica', (select j->>'created' from r1) = 'false' and (select count(*) from institutions where name='Escola Ótima Nº 1') = 1;

-- 4) limpeza de contas nunca confirmadas
create temp table purged as select public.purge_unconfirmed_signups(7) as n;
insert into _resp select 'purge apaga 1 conta', (select n from purged) = 1;
insert into _resp select 'purge só apaga a antiga por confirmar',
  not exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000070a5')
  and exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000070a6')
  and exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000070a2');

-- 5) permissões
set role authenticated;
do $$ begin begin perform public.purge_unconfirmed_signups(1); insert into _resp values ('authenticated não chama purge', false);
  exception when others then insert into _resp values ('authenticated não chama purge', true); end; end $$;
do $$ begin begin perform 1 from public.disposable_email_domains; insert into _resp values ('authenticated não lê a lista negra', false);
  exception when others then insert into _resp values ('authenticated não lê a lista negra', true); end; end $$;
set role anon;
do $$ begin begin perform public.complete_registration(); insert into _resp values ('anon não chama complete_registration', false);
  exception when others then insert into _resp values ('anon não chama complete_registration', true); end; end $$;
reset role;
\o
select name as "FALHOU" from _resp where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resp;
drop table public._resp;
