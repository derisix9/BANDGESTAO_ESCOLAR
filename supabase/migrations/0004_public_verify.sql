-- =====================================================================
-- 0004: verificação pública (QR) com validade, revogação e dados mínimos
-- Substitui `public_verify/<token>` (.read: true, ficha completa, sem expiração).
-- A tabela NÃO é legível pelo cliente anónimo; só a função devolve o payload,
-- e só se o token existir, não tiver expirado nem sido revogado.
-- =====================================================================
create table public.public_tokens (
  token          text primary key,
  institution_id text not null references public.institutions(id) on delete cascade,
  subject_type   text not null check (subject_type in ('student_card','document','transport_pass','staff_card')),
  subject_id     text not null,
  payload        jsonb not null,               -- APENAS o mínimo para verificar (nome, estado, validade) — sem BI, morada, saúde
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  check (pg_column_size(payload) < 4096)
);
create index public_tokens_subject_idx on public.public_tokens (institution_id, subject_type, subject_id);
alter table public.public_tokens enable row level security;
create policy pt_manage on public.public_tokens for select to authenticated
  using (institution_id = app.current_institution() and app.is_staff_manager());
grant select on public.public_tokens to authenticated;

create table public.public_token_hits (
  id bigint generated always as identity primary key,
  token_prefix text, ok boolean not null, at timestamptz not null default now()
);
alter table public.public_token_hits enable row level security;   -- só servidor

-- Emite (ou renova) o token de um sujeito. Revoga os anteriores do mesmo sujeito.
create or replace function public.issue_public_token(
  p_subject_type text, p_subject_id text, p_payload jsonb, p_days integer default 365
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); t text;
begin
  if inst is null or not app.is_staff_manager() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.public_tokens set revoked_at = now()
   where institution_id = inst and subject_type = p_subject_type and subject_id = p_subject_id and revoked_at is null;
  t := translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');   -- 144 bits de entropia
  insert into public.public_tokens(token, institution_id, subject_type, subject_id, payload, expires_at, created_by)
  values (t, inst, p_subject_type, p_subject_id, p_payload, now() + make_interval(days => least(greatest(p_days,1), 1095)), auth.uid());
  perform app.write_audit(inst, 'RPC:issue_public_token', 'public_tokens', p_subject_type || ':' || p_subject_id, null);
  return t;
end $$;

create or replace function public.revoke_public_token(p_token text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_staff_manager() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  update public.public_tokens set revoked_at = now()
   where token = p_token and institution_id = app.current_institution();
end $$;

-- Consulta pública (anónima). Devolve só o payload mínimo.
create or replace function public.verify_public_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.public_tokens;
begin
  select * into r from public.public_tokens where token = p_token;
  insert into public.public_token_hits(token_prefix, ok)
    values (left(coalesce(p_token,''), 4), found and r.revoked_at is null and r.expires_at > now());
  if not found or r.revoked_at is not null or r.expires_at <= now() then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object('valid', true, 'type', r.subject_type, 'expires_at', r.expires_at, 'data', r.payload,
                            'school', (select name from public.institutions where id = r.institution_id));
end $$;

revoke all on function public.issue_public_token(text,text,jsonb,integer) from public, anon;
revoke all on function public.revoke_public_token(text) from public, anon;
grant execute on function public.issue_public_token(text,text,jsonb,integer) to authenticated;
grant execute on function public.revoke_public_token(text) to authenticated;
grant execute on function public.verify_public_token(text) to anon, authenticated;

-- ---------- Projecções para aluno/encarregado (equivalente a user_projections) ----------
create table public.user_projections (
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  data           jsonb not null,
  updated_at     timestamptz not null default now(),
  primary key (institution_id, user_id)
);
alter table public.user_projections enable row level security;
create policy up_read on public.user_projections for select to authenticated
  using (institution_id = app.current_institution() and (user_id = auth.uid() or app.is_staff_manager()));
create policy up_write on public.user_projections for all to authenticated
  using (institution_id = app.current_institution() and app.is_staff_manager())
  with check (institution_id = app.current_institution() and app.is_staff_manager());
grant select, insert, update, delete on public.user_projections to authenticated;
