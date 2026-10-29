-- Testes do backup/restauro por escola em ficheiro (0012). Corre depois das migrações.
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
create or replace function bt.expect_fail_msg(name text, stmt text, frag text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _bres values (name, false);
  exception when others then insert into _bres values (name || ' ['||sqlerrm||']', position(frag in sqlerrm) > 0); end;
end $$;
create or replace function bt.expect_ok(name text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; insert into _bres values (name, true);
  exception when others then insert into _bres values (name || ' ['||sqlerrm||']', false); end;
end $$;
create or replace function bt.check(name text, cond boolean) returns void language plpgsql as $$
begin insert into _bres values (name, coalesce(cond, false)); end $$;

-- ---------- dados: duas escolas ----------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000e001','admin@bk-a.ao'),
 ('00000000-0000-0000-0000-00000000e002','prof@bk-a.ao'),
 ('00000000-0000-0000-0000-00000000e0b1','admin@bk-b.ao'),
 ('00000000-0000-0000-0000-00000000e0c1','semperfil@x.ao');
insert into institutions(id,name) values ('bk_a','Escola BK A'),('bk_b','Escola BK B');
insert into profiles(id,institution_id,role,name,email) values
 ('00000000-0000-0000-0000-00000000e001','bk_a','admin','Admin A','admin@bk-a.ao'),
 ('00000000-0000-0000-0000-00000000e002','bk_a','professor','Prof A','prof@bk-a.ao'),
 ('00000000-0000-0000-0000-00000000e0b1','bk_b','admin','Admin B','admin@bk-b.ao');
insert into records(institution_id,collection,id,ord,data) values
 ('bk_a','students','s1',1,'{"id":"s1","name":"Ana","address":"Rua 1"}'),
 ('bk_a','students','s2',2.5,'{"id":"s2","name":"Bruno"}'),
 ('bk_a','invoices','f1',1,'{"id":"f1","status":"pago","totalPaidKz":1000,"totalAmountKz":1000}'),
 ('bk_a','invoices','f2',2,'{"id":"f2","status":"pendente","totalAmountKz":500}'),
 ('bk_b','students','s9',1,'{"id":"s9","name":"Outro"}');
select set_config('app.rpc','homologate',false);
insert into records(institution_id,collection,id,data) values ('bk_a','homologations','h1','{"id":"h1","turma":"7A"}');
select set_config('app.rpc','',false);
insert into institution_docs(institution_id,key,data) values
 ('bk_a','settings','{"name":"Escola A","v":1}'),
 ('bk_a','events','[{"id":"e1"}]'),
 ('bk_b','settings','{"name":"Escola B"}');
insert into public_admission_config(institution_id,data) values ('bk_a','{"open":true}');
insert into public_admission_requests(institution_id,id,data) values ('bk_a','rq1','{"nome":"Candidato 1"}');
insert into payments(institution_id,invoice_id,amount_kz,method,idempotency_key,registered_by) values
 ('bk_a','f1',1000,'numerario','k1','00000000-0000-0000-0000-00000000e001');
insert into fiscal_series(institution_id,series,doc_type,last_number,last_hash) values ('bk_a','FT2026','FT',1,'h1');
insert into fiscal_documents(institution_id,doc_type,series,number,customer_name,lines,net_kz,total_kz,hash,issued_by)
 values ('bk_a','FT','FT2026',1,'Cliente','[]',1000,1000,'h1','00000000-0000-0000-0000-00000000e001');

create or replace function bt.sig(inst text) returns text language sql as $$
  select md5(coalesce((select jsonb_agg(to_jsonb(r) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at' order by collection, id)::text from records r where institution_id = inst), '') ||
             coalesce((select jsonb_agg(d.data order by key)::text from institution_docs d where institution_id = inst), '') ||
             coalesce((select jsonb_agg(q.data order by id)::text from public_admission_requests q where institution_id = inst), ''))
$$;
create or replace function bt.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u,''), false); end $$;
create table bt.snap(k text primary key, v jsonb);
grant all on bt.snap to authenticated;
create table bt.sig(k text primary key, v text);

-- ---------- exportar ----------
select bt.as_user('00000000-0000-0000-0000-00000000e001');
set role authenticated;
insert into bt.snap select 'a', public.school_backup_export();
reset role;
select bt.check('export: formato, versão e escola', (select v ->> 'format' = 'bandmed-school-backup' and v ->> 'formatVersion' = '1' and v ->> 'institutionId' = 'bk_a' from bt.snap where k='a'));
select bt.check('export: contagens (5 registos, 2 docs, 1 pedido)', (select (v #>> '{counts,records}')::int = 5 and (v #>> '{counts,docs}')::int = 2 and (v #>> '{counts,publicAdmissionRequests}')::int = 1 from bt.snap where k='a'));
select bt.check('export: nada de outra escola', (select not (v::text like '%Outro%') and not (v::text like '%Escola BK B%') from bt.snap where k='a'));
select bt.check('export: sem contas nem e-mails', (select not (v::text like '%admin@bk-a.ao%') from bt.snap where k='a'));
select bt.check('export: pagamentos e fiscais só como referência', (select jsonb_array_length(v #> '{archive,payments}') = 1 and jsonb_array_length(v #> '{archive,fiscalDocuments}') = 1 and (v -> 'payments') is null from bt.snap where k='a'));
select bt.check('export: ord decimal preservado', (select (r ->> 'ord')::float = 2.5 from bt.snap, jsonb_array_elements(v -> 'records') r where k='a' and r ->> 'id' = 's2'));
select bt.check('export auditado', (select count(*) = 1 from audit_log where institution_id='bk_a' and action='RPC:school_backup_export'));

-- permissões do export
select bt.as_user('00000000-0000-0000-0000-00000000e002');
set role authenticated;
select bt.expect_fail('professor não exporta', $$select public.school_backup_export()$$);
reset role;
select bt.as_user('00000000-0000-0000-0000-00000000e0c1');
set role authenticated;
select bt.expect_fail('utilizador sem perfil não exporta', $$select public.school_backup_export()$$);
reset role;
select bt.as_user('');
set role anon;
select bt.expect_fail('anon não exporta', $$select public.school_backup_export()$$);
select bt.expect_fail('anon não restaura', $$select public.school_backup_restore('{}'::jsonb, 'RESTAURAR')$$);
reset role;

-- ---------- estado depois do backup: alterar tudo (como servidor) ----------
select bt.as_user('');
insert into bt.sig select 'antes', bt.sig('bk_a');
insert into bt.sig select 'b_antes', bt.sig('bk_b');
update records set data = '{"id":"s1","name":"Ana ALTERADA"}' where institution_id='bk_a' and id='s1';
delete from records where institution_id='bk_a' and id='s2';
insert into records(institution_id,collection,id,data) values ('bk_a','students','s3','{"id":"s3","name":"Novo depois do backup"}');
insert into records(institution_id,collection,id,data) values ('bk_a','invoices','f3','{"id":"f3","status":"pendente","totalAmountKz":10}');
delete from records where institution_id='bk_a' and id='f2';                       -- factura apagada: deve voltar
update institution_docs set data = '{"name":"Escola A","v":99}' where institution_id='bk_a' and key='settings';
delete from institution_docs where institution_id='bk_a' and key='events';
insert into institution_docs(institution_id,key,data) values ('bk_a','attendance','[{"d":1}]');
delete from public_admission_requests where institution_id='bk_a';
insert into public_admission_requests(institution_id,id,data) values ('bk_a','rq2','{"nome":"Depois"}');
insert into payments(institution_id,invoice_id,amount_kz,method,idempotency_key,registered_by) values
 ('bk_a','f3',10,'numerario','k3','00000000-0000-0000-0000-00000000e001');

-- ---------- restaurar: recusas (nada pode mudar) ----------
select bt.as_user('00000000-0000-0000-0000-00000000e002');
set role authenticated;
select bt.expect_fail('professor não restaura', $$select public.school_backup_restore((select v from bt.snap where k='a'), 'RESTAURAR')$$);
reset role;
select bt.as_user('00000000-0000-0000-0000-00000000e001');
set role authenticated;
select bt.expect_fail_msg('sem a palavra RESTAURAR não restaura', $$select public.school_backup_restore((select v from bt.snap where k='a'), 'sim')$$, 'RESTAURAR');
select bt.expect_fail_msg('ficheiro que não é backup', $$select public.school_backup_restore('{"foo":1}'::jsonb, 'RESTAURAR')$$, 'invalid-backup');
select bt.expect_fail_msg('versão futura do formato', $$select public.school_backup_restore((select v || '{"formatVersion":2}' from bt.snap where k='a'), 'RESTAURAR')$$, 'invalid-backup');
select bt.expect_fail_msg('registos com tipo errado', $$select public.school_backup_restore((select v || '{"records":"x"}' from bt.snap where k='a'), 'RESTAURAR')$$, 'invalid-backup');
select bt.expect_fail_msg('backup de OUTRA escola é recusado', $$select public.school_backup_restore((select v || '{"institutionId":"bk_b"}' from bt.snap where k='a'), 'RESTAURAR')$$, 'wrong-school');
-- atomicidade: documento com forma inválida rebenta a meio -> TUDO volta atrás
select bt.expect_fail('ficheiro corrompido a meio falha', $$select public.school_backup_restore((select v || '{"docs":[{"key":"settings","data":[1]}]}' from bt.snap where k='a'), 'RESTAURAR')$$);
reset role;
select bt.as_user('00000000-0000-0000-0000-00000000e0b1');
set role authenticated;
select bt.expect_fail_msg('admin da escola B não restaura o backup da A', $$select public.school_backup_restore((select v from bt.snap where k='a'), 'RESTAURAR')$$, 'wrong-school');
reset role;
select bt.as_user('');
select bt.check('recusas e rollback não alteraram a escola A (continua o estado "depois")',
  (select exists (select 1 from records where institution_id='bk_a' and id='s3') and not exists (select 1 from records where institution_id='bk_a' and id='s2')
          and (select data ->> 'name' from records where institution_id='bk_a' and id='s1') = 'Ana ALTERADA'
          and (select (data ->> 'v')::int from institution_docs where institution_id='bk_a' and key='settings') = 99));

-- ---------- restaurar: caso feliz ----------
insert into bt.sig select 'payments_before', (select count(*)::text from payments where institution_id='bk_a');
insert into bt.sig select 'audit_before', (select count(*)::text from audit_log where institution_id='bk_a');
insert into bt.sig select 'fiscal_before', (select count(*)::text from fiscal_documents where institution_id='bk_a');
select bt.as_user('00000000-0000-0000-0000-00000000e001');
set role authenticated;
select bt.expect_ok('admin restaura o seu próprio backup', $$insert into bt.snap select 'res', public.school_backup_restore((select v from bt.snap where k='a'), 'RESTAURAR')$$);
reset role;
select bt.as_user('');
select bt.check('registos voltaram ao que eram (assinatura), excepto facturas criadas depois (f3 mantém-se)',
  (select (select md5(coalesce((select jsonb_agg(to_jsonb(r) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at' order by collection, id)::text from records r where institution_id='bk_a' and id <> 'f3'), '') ||
                   coalesce((select jsonb_agg(d.data order by key)::text from institution_docs d where institution_id='bk_a'), '') ||
                   coalesce((select jsonb_agg(q.data order by id)::text from public_admission_requests q where institution_id='bk_a'), ''))) =
          (select v from bt.sig where k='antes')));
select bt.check('s1 repôs o nome, s2 voltou, s3 desapareceu', (select (select data ->> 'name' from records where institution_id='bk_a' and id='s1') = 'Ana'
  and exists (select 1 from records where institution_id='bk_a' and id='s2') and not exists (select 1 from records where institution_id='bk_a' and id='s3')));
select bt.check('ord decimal e versão preservados', (select ord = 2.5 and version = 1 from records where institution_id='bk_a' and id='s2'));
select bt.check('homologação restaurada', (select count(*) = 1 from records where institution_id='bk_a' and collection='homologations' and id='h1'));
select bt.check('factura apagada (f2) foi recriada; paga (f1) intacta', (select count(*) = 2 from records where institution_id='bk_a' and id in ('f1','f2')
  and (id <> 'f1' or data ->> 'status' = 'pago')));
select bt.check('factura criada depois do backup (f3) NÃO foi apagada', (select count(*) = 1 from records where institution_id='bk_a' and id='f3'));
select bt.check('documentos: settings repostas, events repostos, attendance (inexistente no backup) removido', (select
  (select (data ->> 'v')::int from institution_docs where institution_id='bk_a' and key='settings') = 1
  and exists (select 1 from institution_docs where institution_id='bk_a' and key='events')
  and not exists (select 1 from institution_docs where institution_id='bk_a' and key='attendance')));
select bt.check('pré-matrícula: pedido rq1 volta, rq2 sai; config reposta', (select exists (select 1 from public_admission_requests where institution_id='bk_a' and id='rq1')
  and not exists (select 1 from public_admission_requests where institution_id='bk_a' and id='rq2')
  and exists (select 1 from public_admission_config where institution_id='bk_a' and (data ->> 'open')::boolean)));
select bt.check('pagamentos NUNCA reescritos (o pagamento posterior continua)', (select count(*)::text = (select v from bt.sig where k='payments_before') and count(*) = 2 from payments where institution_id='bk_a'));
select bt.check('documentos fiscais intactos', (select count(*)::text = (select v from bt.sig where k='fiscal_before') from fiscal_documents where institution_id='bk_a'));
select bt.check('escola B intacta', (select bt.sig('bk_b') = (select v from bt.sig where k='b_antes')));
select bt.check('resumo: 3 registos (s1, s2, h1), 1 factura recriada, 1 mantida', (select (v ->> 'records')::int = 3 and (v ->> 'invoicesRecreated')::int = 1 and (v ->> 'invoicesKept')::int = 1 from bt.snap where k='res'));
select bt.check('auditoria: o restauro acrescentou UMA só entrada (sem uma linha por registo)', (select count(*) = (select v::int from bt.sig where k='audit_before') + 1 from audit_log where institution_id='bk_a'));
select bt.check('cadeia de auditoria íntegra', (select app.verify_audit_chain('bk_a') is null));

-- ---------- ficheiro com coleção desconhecida (backup de versão futura) e restauro repetido ----------
select bt.as_user('00000000-0000-0000-0000-00000000e001');
set role authenticated;
select bt.expect_ok('colecção desconhecida é ignorada, não falha', $$insert into bt.snap select 'res2', public.school_backup_restore(
  (select jsonb_set(v, '{records}', (v -> 'records') || '[{"collection":"colecao_do_futuro","id":"x1","data":{"a":1}}]'::jsonb) from bt.snap where k='a'), 'RESTAURAR')$$);
select bt.expect_ok('restaurar duas vezes seguidas é seguro (idempotente)', $$select public.school_backup_restore((select v from bt.snap where k='a'), 'RESTAURAR')$$);
reset role;
select bt.as_user('');
select bt.check('registo de colecção desconhecida contado como ignorado', (select (v ->> 'recordsIgnored')::int = 1 from bt.snap where k='res2'));
select bt.check('restauro repetido dá o mesmo estado', (select md5(coalesce((select jsonb_agg(to_jsonb(r) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at' order by collection, id)::text from records r where institution_id='bk_a' and id <> 'f3'), '')) =
  md5(coalesce((select jsonb_agg(to_jsonb(r) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at' order by collection, id)::text from records r where institution_id='bk_a' and id <> 'f3'), ''))));

-- ---------- a auditoria volta ao normal depois do restauro ----------
insert into records(institution_id,collection,id,data) values ('bk_a','students','s7','{"id":"s7"}');
select bt.check('auditoria linha-a-linha reactivada depois do restauro', (select count(*) = 1 from audit_log where institution_id='bk_a' and action='INSERT' and entity_id='s7'));

\o
select name as "FALHOU" from _bres where not ok;
select count(*) filter (where ok) as backup_passou, count(*) filter (where not ok) as backup_falhou from _bres;
drop table public._bres; drop schema bt cascade;
