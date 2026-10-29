-- =====================================================================
-- 0015: Zona de perigo — eliminar os dados da escola do administrador
--
-- Fluxo (tudo verificado no SERVIDOR; o cliente nunca indica a escola):
--   1) school_delete_check(nome, frase)  → só diz se está tudo certo (admin + escola + nome + frase).
--   2) school_delete_prepare(nome, frase) → volta a verificar, devolve o BACKUP completo e um bilhete de uso único (15 min).
--   3) school_delete_execute(bilhete, nome, frase) → volta a verificar, consome o bilhete e apaga.
-- Sem o passo 2 (que entrega o backup) não há bilhete, logo não há eliminação.
--
-- O QUE SE APAGA: registos, documentos e definições da escola, acessos, projecções, tokens/QR, admissões públicas e fila de mensagens.
-- O QUE FICA: a escola (nome/plano), as CONTAS de utilizadores (incluindo o administrador) e o registo histórico imutável
--   (audit_log, payments, fiscal_documents, fiscal_series): por desenho (0003) e por obrigação fiscal não podem ser apagados.
-- Depende de public.write_audit_event_service (0009). ATENÇÃO: a versão original de school_delete_prepare exigia app.export_school,
-- que a 0012 actual apaga → aplicar também a 0016, que a substitui por app.school_backup_build.
-- =====================================================================

create table if not exists public.school_delete_tickets (
  id             uuid primary key default gen_random_uuid(),
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  expires_at     timestamptz not null default (now() + interval '15 minutes'),
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.school_delete_tickets enable row level security;   -- sem políticas: só funções do servidor
revoke all on public.school_delete_tickets from anon, authenticated;

create or replace function app.school_delete_phrase() returns text language sql immutable as $$ select 'Eliminar banco de dados' $$;

-- Verificação: o chamador é admin activo, a escola dele existe e o NOME e a FRASE coincidem.
create or replace function app.school_delete_check(p_uid uuid, p_name text, p_phrase text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p record; i record; admin_ok boolean := false; school_ok boolean := false; name_ok boolean := false;
begin
  select institution_id, role, active into p from public.profiles where id = p_uid;
  admin_ok := coalesce(p.active and p.role = 'admin', false);
  if admin_ok then
    select id, name into i from public.institutions where id = p.institution_id;
    school_ok := i.id is not null;
    name_ok := school_ok and btrim(coalesce(p_name, '')) = i.name;                -- o nome escrito é o desta escola
  end if;
  return jsonb_build_object(
    'adminOk', admin_ok, 'schoolOk', school_ok, 'nameOk', name_ok,
    'phraseOk', btrim(coalesce(p_phrase, '')) = app.school_delete_phrase(),
    'institutionId', case when admin_ok then p.institution_id end,
    'expectedName', case when admin_ok then i.name end);
end $$;
revoke all on function app.school_delete_check(uuid, text, text), app.school_delete_phrase() from public, anon, authenticated;

create or replace function public.school_delete_check(p_name text, p_phrase text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c jsonb := app.school_delete_check(auth.uid(), p_name, p_phrase);
begin
  return (c - 'institutionId') || jsonb_build_object('ok', (c ->> 'adminOk')::boolean and (c ->> 'schoolOk')::boolean
                                                            and (c ->> 'nameOk')::boolean and (c ->> 'phraseOk')::boolean);
end $$;

-- Passo 2: entrega o backup e o bilhete.
create or replace function public.school_delete_prepare(p_name text, p_phrase text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb := app.school_delete_check(auth.uid(), p_name, p_phrase); inst text; t uuid; bk jsonb;
begin
  if not ((c ->> 'adminOk')::boolean and (c ->> 'schoolOk')::boolean and (c ->> 'nameOk')::boolean and (c ->> 'phraseOk')::boolean) then
    raise exception 'Confirmação inválida: só o administrador, com o nome da escola e a frase correctos' using errcode = '42501';
  end if;
  if to_regprocedure('app.export_school(text)') is null then
    raise exception 'Falta a migração 0012 (app.export_school): sem backup não se elimina' using errcode = '42883';
  end if;
  inst := c ->> 'institutionId';
  bk := app.export_school(inst);
  update public.school_delete_tickets set used_at = now() where user_id = auth.uid() and used_at is null;   -- um bilhete de cada vez
  insert into public.school_delete_tickets(institution_id, user_id) values (inst, auth.uid()) returning id into t;
  perform public.write_audit_event_service(inst, auth.uid(), 'RPC:school_delete_prepared', 'school', inst, bk -> 'counts');
  return jsonb_build_object('ticket', t, 'backup', bk);
end $$;

-- Apaga os dados editáveis da escola, tudo ou nada (uma transacção).
create or replace function app.wipe_school_data(p_inst text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t text; n int; res jsonb := '{}'::jsonb; progressed boolean;
  pending text[] := array['records','institution_docs','user_access','user_projections','public_token_hits','public_tokens',
                          'public_academic_years','public_admission_complaints','public_admission_status',
                          'public_admission_requests','public_admission_config','notification_queue'];
  nxt text[];
begin
  perform pg_advisory_xact_lock(hashtext('restore:' || p_inst));
  perform pg_advisory_xact_lock(hashtext('audit:' || p_inst));
  perform set_config('app.restoring', 'on', true);     -- não gera um evento de auditoria por linha
  perform set_config('app.rpc', 'wipe', true);
  loop
    nxt := array[]::text[]; progressed := false;
    foreach t in array pending loop
      if not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = t and column_name = 'institution_id') then
        continue;                                      -- tabela sem esta coluna (ou inexistente): nada a apagar
      end if;
      begin
        execute format('delete from public.%I where institution_id = $1', t) using p_inst;
        get diagnostics n = row_count;
        res := res || jsonb_build_object(t, n); progressed := true;
      exception when foreign_key_violation then
        nxt := nxt || t;                               -- depende de outra tabela: tenta depois
      end;
    end loop;
    exit when coalesce(array_length(nxt, 1), 0) = 0;
    if not progressed then raise exception 'Não foi possível apagar (dependências): %', nxt; end if;
    pending := nxt;
  end loop;
  return res;
end $$;
revoke all on function app.wipe_school_data(text) from public, anon, authenticated;

-- Passo 3.
create or replace function public.school_delete_execute(p_ticket uuid, p_name text, p_phrase text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb := app.school_delete_check(auth.uid(), p_name, p_phrase); inst text; tk record; res jsonb;
begin
  if not ((c ->> 'adminOk')::boolean and (c ->> 'schoolOk')::boolean and (c ->> 'nameOk')::boolean and (c ->> 'phraseOk')::boolean) then
    raise exception 'Confirmação inválida' using errcode = '42501';
  end if;
  inst := c ->> 'institutionId';
  select * into tk from public.school_delete_tickets
   where id = p_ticket and user_id = auth.uid() and institution_id = inst and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'Bilhete inválido ou expirado: descarregue o backup outra vez' using errcode = '42501';
  end if;
  update public.school_delete_tickets set used_at = now() where id = tk.id;
  res := app.wipe_school_data(inst);
  perform public.write_audit_event_service(inst, auth.uid(), 'RPC:school_data_deleted', 'school', inst, res);
  return res;
end $$;

revoke all on function public.school_delete_check(text, text), public.school_delete_prepare(text, text),
  public.school_delete_execute(uuid, text, text) from public, anon;
grant execute on function public.school_delete_check(text, text), public.school_delete_prepare(text, text),
  public.school_delete_execute(uuid, text, text) to authenticated;
