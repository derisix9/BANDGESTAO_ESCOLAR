-- Testes do registo com verificação de e-mail (0044). Corre depois das migrações: psql -f supabase/tests/pending_registrations.test.sql
\set ON_ERROR_STOP on
create table public._resp(name text, ok boolean);
grant all on public._resp to anon, authenticated;
\o /dev/null
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000060a1','novo@a.ao',null),
 ('00000000-0000-0000-0000-0000000060a2','velho@a.ao',null),
 ('00000000-0000-0000-0000-0000000060a3','ok@a.ao',now());
insert into public.pending_registrations(user_id,email,school_name,admin_name,terms_version,expires_at) values
 ('00000000-0000-0000-0000-0000000060a1','novo@a.ao','Escola Nova','Admin','1.0', now() + interval '1 day'),
 ('00000000-0000-0000-0000-0000000060a2','velho@a.ao','Escola Velha','Admin','1.0', now() - interval '1 hour'),
 ('00000000-0000-0000-0000-0000000060a3','ok@a.ao','Escola Ok','Admin','1.0', now() - interval '1 hour');

-- 1) o registo pendente não cria escola nem perfil
insert into _resp select 'pendente não cria escola', not exists (select 1 from institutions where name in ('Escola Nova','Escola Velha'));
insert into _resp select 'pendente não cria perfil', not exists (select 1 from profiles where id in ('00000000-0000-0000-0000-0000000060a1','00000000-0000-0000-0000-0000000060a2'));

-- 2) limpeza: apaga só o expirado e por confirmar
insert into _resp select 'purge apaga 1', public.purge_expired_registrations() = 1;
insert into _resp select 'expirado por confirmar apagado (conta e pedido)', not exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000060a2') and not exists (select 1 from pending_registrations where user_id='00000000-0000-0000-0000-0000000060a2');
insert into _resp select 'válido mantém-se', exists (select 1 from pending_registrations where user_id='00000000-0000-0000-0000-0000000060a1');
insert into _resp select 'conta confirmada nunca é apagada', exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000060a3');

-- 3) permissões: cliente não lê a tabela nem chama a função
set role authenticated;
do $$ begin begin perform 1 from public.pending_registrations; insert into _resp values ('authenticated não lê pending', false);
exception when others then insert into _resp values ('authenticated não lê pending', true); end; end $$;
do $$ begin begin perform public.purge_expired_registrations(); insert into _resp values ('authenticated não chama purge', false);
exception when others then insert into _resp values ('authenticated não chama purge', true); end; end $$;
set role anon;
do $$ begin begin perform 1 from public.pending_registrations; insert into _resp values ('anon não lê pending', false);
exception when others then insert into _resp values ('anon não lê pending', true); end; end $$;
reset role;
\o
select name as "FALHOU" from _resp where not ok;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _resp;
drop table public._resp;
