-- =====================================================================
-- 0043: lista de IPs autorizados APLICADA NO SERVIDOR
-- Antes: o navegador pedia o IP a api.ipify.org e decidia sozinho (e falhava em aberto).
-- Agora: o IP vem do cabeçalho que o próprio Supabase/Cloudflare acrescenta ao pedido
-- (cf-connecting-ip), que o cliente NÃO consegue forjar, e a decisão está em app.current_institution():
-- fora da lista, esse utilizador deixa de ter escola activa e a RLS recusa TUDO (87 políticas).
-- Falha FECHADA: se há lista e o IP não se consegue determinar, recusa.
--
-- Âmbito (importante em Angola: IP móvel muda e há CGNAT): por omissão só restringe os perfis de
-- secretaria/gestão (admin, director, secretaria, financeiro). Professores, alunos e encarregados
-- ficam de fora, a não ser que o administrador os inclua (alunos e encarregados nunca podem ser incluídos).
-- Anti-bloqueio: quem grava a lista tem de estar, nesse momento, DENTRO dela; e a plataforma tem
-- uma chave de emergência (platform_clear_ip_ranges).
-- =====================================================================
alter table public.institutions
  add column if not exists allowed_ip_ranges  text[] not null default '{}',
  add column if not exists ip_restricted_roles text[] not null default '{admin,director,secretaria,financeiro}';

-- ---------- IP do cliente, como o servidor o vê ----------
-- NÃO usa o início de x-forwarded-for (o cliente pode acrescentar valores à esquerda).
create or replace function app.client_ip() returns text
language plpgsql stable as $$
declare h jsonb; v text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then return null; end;
  if h is null then return null; end if;
  v := nullif(trim(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip')), '');
  if v is null then return null; end if;
  begin perform v::inet; exception when others then return null; end;
  return v;
end $$;

-- ---------- Uma entrada da lista: IP, CIDR (a.b.c.d/n), intervalo (a-b) ou prefixo (197.218.10.) ----------
-- Devolve a entrada normalizada ou lança erro (validação ao gravar).
create or replace function app.normalize_ip_entry(p_raw text) returns text
language plpgsql immutable as $$
declare e text := trim(coalesce(p_raw, '')); a text; b text; parts text[]; n int;
begin
  if e = '' or length(e) > 80 then raise exception 'Entrada de IP inválida' using errcode = '22023'; end if;
  if e like '%-%' then
    a := trim(split_part(e, '-', 1)); b := trim(split_part(e, '-', 2));
    if family(a::inet) <> family(b::inet) or a::inet > b::inet then raise exception 'Intervalo inválido: %', e using errcode = '22023'; end if;
    return a || '-' || b;
  elsif e like '%/%' then
    return network(e::inet)::text;                                     -- valida e normaliza (197.218.10.4/24 → 197.218.10.0/24)
  elsif e like '%.' then                                              -- prefixo IPv4: 197.218.10.  → /24
    parts := string_to_array(rtrim(e, '.'), '.'); n := coalesce(array_length(parts, 1), 0);
    if n < 1 or n > 3 then raise exception 'Prefixo inválido: %', e using errcode = '22023'; end if;
    for i in 1..n loop
      if parts[i] !~ '^\d{1,3}$' or parts[i]::int > 255 then raise exception 'Prefixo inválido: %', e using errcode = '22023'; end if;
    end loop;
    return network((rtrim(e, '.') || repeat('.0', 4 - n) || '/' || (8 * n))::inet)::text;
  else
    return host(e::inet);                                             -- IP exacto (valida)
  end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Entrada de IP inválida: %', e using errcode = '22023';
end $$;

create or replace function app.ip_in_ranges(p_ip text, p_ranges text[]) returns boolean
language plpgsql immutable as $$
declare r text; ip inet;
begin
  begin ip := p_ip::inet; exception when others then return false; end;
  foreach r in array coalesce(p_ranges, '{}') loop
    begin
      if r like '%-%' then
        if family(ip) = family(split_part(r, '-', 1)::inet) and ip between split_part(r, '-', 1)::inet and split_part(r, '-', 2)::inet then return true; end if;
      elsif r like '%/%' then
        if family(ip) = family(r::cidr) and ip <<= r::cidr then return true; end if;
      else
        if ip = r::inet then return true; end if;
      end if;
    exception when others then continue;    -- entrada corrompida: ignora-a, nunca abre a porta por engano
    end;
  end loop;
  return false;
end $$;

-- ---------- Núcleo: este utilizador, nesta escola, a partir deste IP, pode entrar? ----------
create or replace function app.ip_check(p_uid uuid, p_inst text, p_ip text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ranges text[]; roles text[]; r text;
begin
  -- a filial herda a lista (e os perfis) da escola mãe quando não tem lista própria
  select coalesce(nullif(i.allowed_ip_ranges, '{}'), m.allowed_ip_ranges, '{}'),
         case when cardinality(i.allowed_ip_ranges) > 0 then i.ip_restricted_roles else coalesce(m.ip_restricted_roles, i.ip_restricted_roles) end
    into ranges, roles
  from public.institutions i left join public.institutions m on m.id = i.parent_id
  where i.id = p_inst;
  if ranges is null or cardinality(ranges) = 0 then return true; end if;   -- sem lista: sem restrição
  select role into r from public.profiles where id = p_uid and active;
  if r is null or not (r = any (roles)) then return true; end if;           -- perfil fora do âmbito
  if p_ip is null then return false; end if;                                -- fail-closed
  return app.ip_in_ranges(p_ip, ranges);
end $$;
revoke all on function app.ip_check(uuid, text, text) from public, anon, authenticated;

create or replace function app.ip_allowed(p_inst text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() is null then true else app.ip_check(auth.uid(), p_inst, app.client_ip()) end
$$;

-- ---------- Ponto único de aplicação: escola activa ----------
create or replace function app.current_institution() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id
  from public.institutions i
  left join public.institutions m on m.id = i.parent_id
  where i.id = app.active_institution_id()
    and i.status = 'active'
    and (m.id is null or m.status = 'active')
    and app.plan_active(coalesce(i.parent_id, i.id))
    -- escolas sem lista (a maioria) não pagam nada: a função só corre quando há lista
    and (cardinality(coalesce(nullif(i.allowed_ip_ranges, '{}'), m.allowed_ip_ranges, '{}')) = 0 or app.ip_allowed(i.id))
$$;

-- ---------- Gravar a lista: só pelo administrador, só por esta função ----------
create or replace function public.set_ip_policy(p_ranges text[], p_roles text[] default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution(); norm text[] := '{}'; e text; roles text[]; ip text := app.client_ip();
begin
  if inst is null or app.current_role() <> 'admin' then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if coalesce(array_length(p_ranges, 1), 0) > 50 then raise exception 'No máximo 50 entradas' using errcode = '22023'; end if;
  foreach e in array coalesce(p_ranges, '{}') loop
    if trim(e) <> '' then norm := norm || app.normalize_ip_entry(e); end if;
  end loop;
  roles := coalesce(p_roles, (select ip_restricted_roles from public.institutions where id = inst));
  if exists (select 1 from unnest(roles) x where x not in ('admin','director','secretaria','financeiro','professor','funcionario')) then
    raise exception 'Perfis permitidos na lista: admin, director, secretaria, financeiro, professor, funcionario' using errcode = '22023';
  end if;
  if not ('admin' = any (roles)) then roles := roles || 'admin'; end if;
  -- Anti-bloqueio: tem de estar dentro da lista que está a gravar.
  if cardinality(norm) > 0 then
    if ip is null then raise exception 'Não foi possível determinar o seu IP: lista não gravada (segurança)' using errcode = '22023'; end if;
    if not app.ip_in_ranges(ip, norm) then
      raise exception 'O seu IP actual (%) não está na lista. Inclua-o para não ficar sem acesso.', ip using errcode = '22023';
    end if;
  end if;
  perform set_config('app.ip_rpc', '1', true);
  update public.institutions set allowed_ip_ranges = norm, ip_restricted_roles = roles where id = inst;
  perform app.write_audit(inst, 'RPC:set_ip_policy', 'institutions', inst,
                          jsonb_build_object('entradas', cardinality(norm), 'perfis', roles, 'ip', ip));
  return jsonb_build_object('ranges', norm, 'roles', roles, 'ip', ip);
end $$;
revoke all on function public.set_ip_policy(text[], text[]) from public, anon;
grant execute on function public.set_ip_policy(text[], text[]) to authenticated;

-- A escola NÃO pode mexer nestes campos por UPDATE directo (a política inst_update_admin deixaria): só pela função acima.
create or replace function app.guard_ip_columns() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;                                   -- servidor
  if (new.allowed_ip_ranges is distinct from old.allowed_ip_ranges or new.ip_restricted_roles is distinct from old.ip_restricted_roles)
     and coalesce(current_setting('app.ip_rpc', true), '') <> '1' and not app.is_platform_admin() then
    raise exception 'Use set_ip_policy' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists institutions_ip_guard on public.institutions;
create trigger institutions_ip_guard before update on public.institutions
  for each row execute function app.guard_ip_columns();

-- Ler a política (admin) + o IP que o servidor vê (qualquer utilizador autenticado: é o seu próprio IP).
create or replace function public.get_ip_policy() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text := app.current_institution();
begin
  if inst is null or app.current_role() not in ('admin','director') then raise exception 'Sem permissão' using errcode = '42501'; end if;
  return (select jsonb_build_object('ranges', allowed_ip_ranges, 'roles', ip_restricted_roles, 'ip', app.client_ip())
          from public.institutions where id = inst);
end $$;
revoke all on function public.get_ip_policy() from public, anon;
grant execute on function public.get_ip_policy() to authenticated;

-- A app chama isto depois do login. Não depende de current_institution() (que já devolveria null se bloqueado):
-- devolve {blocked, ip} para mostrar "o seu IP não está autorizado" em vez de uma app vazia.
create or replace function public.ip_access_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare inst text; ip text := app.client_ip(); ok boolean;
begin
  select institution_id into inst from public.profiles where id = auth.uid() and active;
  if inst is null then return jsonb_build_object('blocked', false, 'ip', ip); end if;
  inst := coalesce(app.active_institution_id(), inst);
  ok := app.ip_check(auth.uid(), inst, ip);
  return jsonb_build_object('blocked', not ok, 'ip', ip);
end $$;
revoke all on function public.ip_access_status() from public, anon;
grant execute on function public.ip_access_status() to authenticated;

-- Para as Edge Functions (service_role): o mesmo critério, com o IP do pedido que elas recebem.
create or replace function public.edge_ip_allowed(p_uid uuid, p_ip text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.ip_check(p_uid, coalesce(app.active_institution_of(p_uid), (select institution_id from public.profiles where id = p_uid)), p_ip)
$$;
revoke all on function public.edge_ip_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public.edge_ip_allowed(uuid, text) to service_role;

-- Chave de emergência: a equipa da plataforma limpa a lista de uma escola que ficou sem acesso.
create or replace function public.platform_clear_ip_ranges(p_inst text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_platform_admin() then raise exception 'Só a plataforma' using errcode = '42501'; end if;
  perform set_config('app.ip_rpc', '1', true);
  update public.institutions set allowed_ip_ranges = '{}' where id = p_inst;
  perform app.write_audit(p_inst, 'RPC:platform_clear_ip_ranges', 'institutions', p_inst, null);
end $$;
revoke all on function public.platform_clear_ip_ranges(text) from public, anon;
grant execute on function public.platform_clear_ip_ranges(text) to authenticated;
