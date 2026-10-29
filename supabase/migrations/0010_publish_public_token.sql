-- =====================================================================
-- 0010 — Publicação dos QR públicos sobre `public_tokens` (0004)
--
-- Modelo seguro: o anónimo só chama verify_public_token (0004), que devolve um payload MÍNIMO e só se o
-- token existir, não tiver expirado nem sido revogado. A tabela nunca é legível pelo cliente anónimo.
--
-- O token impresso no cartão é calculado no cliente (src/utils/publicToken.ts) para os QR poderem ser gerados
-- sem rede; esta função regista-o. Garantias:
--  • só gestão (admin/direcção/secretaria/financeiro) da própria escola publica;
--  • nunca sobrescreve o token de outra escola;
--  • um token REVOGADO nunca volta a ficar activo por republicação; só um administrador o reactiva, de forma explícita e auditada (p_reissue);
--  • cada publicação renova a validade (até 3 anos); o payload tem no máximo 4 KB.
-- Seguro de correr mais do que uma vez.
-- =====================================================================
create or replace function public.publish_public_token(
  p_token text, p_subject_type text, p_subject_id text, p_payload jsonb, p_days integer default 365, p_reissue boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); cur public.public_tokens;
begin
  if inst is null or not app.is_staff_manager() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-z_-]{10,64}$' then
    raise exception 'Token inválido' using errcode = '22023';
  end if;
  if p_subject_type not in ('student_card','document','transport_pass','staff_card') then
    raise exception 'Tipo inválido' using errcode = '22023';
  end if;
  if p_payload is null or pg_column_size(p_payload) >= 4096 then
    raise exception 'Payload inválido ou grande demais' using errcode = '22023';
  end if;

  select * into cur from public.public_tokens where token = p_token for update;
  if found then
    if cur.institution_id <> inst then
      raise exception 'Token pertence a outra instituição' using errcode = '42501';
    end if;
    if cur.revoked_at is not null then
      -- Revogado continua inválido, salvo reemissão explícita por um administrador.
      if not (p_reissue and app.current_role() = 'admin') then return 'revoked'; end if;
      perform app.write_audit(inst, 'RPC:reissue_public_token', 'public_tokens', p_subject_id, null);
    end if;
    update public.public_tokens
       set revoked_at = null, payload = p_payload, subject_type = p_subject_type, subject_id = p_subject_id,
           expires_at = now() + make_interval(days => least(greatest(p_days,1), 1095))
     where token = p_token;
    return 'updated';
  end if;
  insert into public.public_tokens(token, institution_id, subject_type, subject_id, payload, expires_at, created_by)
  values (p_token, inst, p_subject_type, p_subject_id, p_payload,
          now() + make_interval(days => least(greatest(p_days,1), 1095)), auth.uid());
  return 'created';
end $$;

-- Revoga TODOS os tokens activos de uma pessoa (cartão perdido, aluno transferido, saída do funcionário).
create or replace function public.revoke_public_subject(p_subject_id text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if not app.is_staff_manager() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.public_tokens set revoked_at = now()
   where institution_id = app.current_institution() and subject_id = p_subject_id and revoked_at is null;
  get diagnostics n = row_count;
  perform app.write_audit(app.current_institution(), 'RPC:revoke_public_subject', 'public_tokens', p_subject_id, null);
  return n;
end $$;

revoke all on function public.publish_public_token(text,text,text,jsonb,integer,boolean) from public, anon;
revoke all on function public.revoke_public_subject(text) from public, anon;
grant execute on function public.publish_public_token(text,text,text,jsonb,integer,boolean) to authenticated;
grant execute on function public.revoke_public_subject(text) to authenticated;

-- ---------- Consulta pública: regista só as tentativas FALHADAS (evita encher a tabela com leituras legítimas) ----------
create or replace function public.verify_public_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.public_tokens; ok boolean;
begin
  if p_token is null or p_token !~ '^[0-9A-Za-z_-]{10,64}$' then return jsonb_build_object('valid', false); end if;
  select * into r from public.public_tokens where token = p_token;
  ok := found and r.revoked_at is null and r.expires_at > now();
  if not ok then
    insert into public.public_token_hits(token_prefix, ok) values (left(p_token, 4), false);
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object('valid', true, 'type', r.subject_type, 'expires_at', r.expires_at, 'data', r.payload,
                            'school', (select name from public.institutions where id = r.institution_id));
end $$;
grant execute on function public.verify_public_token(text) to anon, authenticated;

-- Limpeza do registo de tentativas (agende no painel: select cron.schedule('purge-hits','0 3 * * *','select public.purge_public_token_hits()')).
create or replace function public.purge_public_token_hits() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.public_token_hits where at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_public_token_hits() from public, anon, authenticated;
