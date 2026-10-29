-- =====================================================================
-- 0002: registos por colecção (substitui inst_data/{escola}/{colecção}/{id})
-- Uma tabela genérica `records` (JSONB) permite migrar o db.ts de 10 mil linhas
-- módulo a módulo. As permissões vêm da tabela `collection_acl`, preenchida a
-- partir de src/config/dataShards.json (0005), a MESMA fonte das regras Firebase.
-- Módulos críticos (facturas, pagamentos, auditoria) têm tabelas próprias (0003).
-- =====================================================================
create table public.collection_acl (
  collection           text primary key,
  sections             text[] not null,
  read_roles           text[] not null,
  write_roles          text[] not null,
  field_writes         jsonb  not null default '{}'::jsonb,   -- {"professor": ["grades", ...]}
  owner_write          jsonb  not null default '{}'::jsonb,   -- {"aluno": "submitterUid"}
  academic_year_scoped boolean not null default false,
  audited              boolean not null default true,
  server_only          boolean not null default false         -- escrita só por RPC (ex.: homologações)
);
alter table public.collection_acl enable row level security;
create policy acl_read on public.collection_acl for select to authenticated using (true);
grant select on public.collection_acl to authenticated;

create table public.records (
  institution_id text    not null references public.institutions(id) on delete cascade,
  collection     text    not null references public.collection_acl(collection),
  id             text    not null,
  academic_year  text,
  ord            bigint,                               -- posição na lista (campo `_o` no Firebase)
  data           jsonb   not null,
  version        integer not null default 1,           -- bloqueio optimista
  created_by     uuid    references auth.users(id),
  updated_by     uuid    references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, collection, id)
);
create index records_year_idx on public.records (institution_id, collection, academic_year);
create index records_data_gin on public.records using gin (data jsonb_path_ops);
alter table public.records enable row level security;

-- ---------- Permissão por colecção (espelha scripts/shard-rules-lib.mjs) ----------
-- Regra: admin sempre; se o utilizador tem acesso personalizado a alguma das secções
-- da colecção, ele manda; senão vale a lista de perfis.
create or replace function app.can_access(p_collection text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    join public.collection_acl c on c.collection = p_collection
    where p.id = auth.uid() and p.active
      and (p_kind = 'read' or not c.server_only)
      and ( p.role = 'admin'
        or case
             when exists (select 1 from public.user_access ua
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and exists (select 1 from unnest(c.sections) s where ua.sections ? s))
             then exists (select 1 from public.user_access ua, unnest(c.sections) s
                          where ua.user_id = p.id and ua.institution_id = p.institution_id
                            and ua.sections -> s ->> 'enabled' = 'true'
                            and (p_kind = 'read' or ua.sections -> s ->> 'mode' = 'write'))
             else (p_kind = 'read'  and p.role = any (c.read_roles))
               or (p_kind = 'write' and p.role = any (c.write_roles))
           end )
  )
$$;

create or replace function app.can_field_write(p_collection text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.collection_acl c
                 where c.collection = p_collection
                   and c.field_writes ? coalesce(app.current_role(), ''))
$$;

create or replace function app.is_owner_writer(p_collection text, p_data jsonb) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.collection_acl c
                 where c.collection = p_collection
                   and c.owner_write ? coalesce(app.current_role(), '')
                   and p_data ->> (c.owner_write ->> app.current_role()) = auth.uid()::text)
$$;

-- ---------- Políticas ----------
create policy rec_select on public.records for select to authenticated
  using (institution_id = app.current_institution() and app.can_access(collection, 'read'));

create policy rec_insert on public.records for insert to authenticated
  with check (institution_id = app.current_institution()
              and (app.can_access(collection, 'write') or app.is_owner_writer(collection, data)));

create policy rec_update on public.records for update to authenticated
  using (institution_id = app.current_institution()
         and (app.can_access(collection, 'write') or app.can_field_write(collection)
              or app.is_owner_writer(collection, data)))
  with check (institution_id = app.current_institution());

create policy rec_delete on public.records for delete to authenticated
  using (institution_id = app.current_institution() and app.can_access(collection, 'write'));

grant select, insert, update, delete on public.records to authenticated;

-- ---------- Trigger: campos permitidos, dono, estado de pagamento, versão ----------
create or replace function app.guard_record_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r text := app.current_role();
  rpc text := coalesce(current_setting('app.rpc', true), '');
  allowed jsonb; owner_field text; k text;
begin
  if auth.uid() is null then return new; end if;      -- servidor (service_role)

  -- Homologações só pela função homologate_pauta
  if new.collection = 'homologations' and rpc <> 'homologate' then
    raise exception 'Use homologate_pauta' using errcode = '42501';
  end if;

  -- Estado de pagamento só muda pela função register_payment (impede marcar "pago" à mão)
  if new.collection = 'invoices' and rpc <> 'payment' then
    if tg_op = 'INSERT' and new.data ->> 'status' = 'pago' then
      raise exception 'Pagamentos só se registam pela função register_payment' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
       and (   new.data ->> 'status'      is distinct from old.data ->> 'status'
            or new.data ->> 'totalPaidKz' is distinct from old.data ->> 'totalPaidKz'
            or new.data ->> 'paymentDate' is distinct from old.data ->> 'paymentDate')
       and (old.data ->> 'status' = 'pago' or new.data ->> 'status' = 'pago') then
      raise exception 'Pagamentos só se registam pela função register_payment' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.updated_by := auth.uid();
    return new;
  end if;

  -- UPDATE
  if new.institution_id <> old.institution_id or new.collection <> old.collection or new.id <> old.id then
    raise exception 'Chave do registo é imutável' using errcode = '42501';
  end if;

  if not app.can_access(old.collection, 'write') then
    select c.field_writes -> r, c.owner_write ->> r into allowed, owner_field
      from public.collection_acl c where c.collection = old.collection;
    if owner_field is not null then
      if old.data ->> owner_field is distinct from auth.uid()::text
         or new.data ->> owner_field is distinct from auth.uid()::text then
        raise exception 'Só pode alterar registos seus' using errcode = '42501';
      end if;
    elsif allowed is not null then
      for k in select jsonb_object_keys(new.data) loop
        if (old.data -> k) is distinct from (new.data -> k) and not (allowed ? k) then
          raise exception 'Perfil % não pode alterar o campo "%"', r, k using errcode = '42501';
        end if;
      end loop;
      for k in select jsonb_object_keys(old.data) loop
        if not (new.data ? k) and not (allowed ? k) then
          raise exception 'Perfil % não pode remover o campo "%"', r, k using errcode = '42501';
        end if;
      end loop;
    else
      raise exception 'Sem permissão de escrita' using errcode = '42501';
    end if;
  end if;

  -- Bloqueio optimista: o cliente envia a versão que leu. Se outro utilizador gravou
  -- entretanto, falha em vez de sobrepor ("última escrita ganha").
  -- Chamadas de RPC do servidor (app.rpc definido) mantêm a versão.
  if rpc = '' and new.version is distinct from old.version then
    raise exception 'Conflito de versão: o registo foi alterado por outro utilizador' using errcode = '40001';
  end if;
  new.version := old.version + 1;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
create trigger records_guard before insert or update on public.records
  for each row execute function app.guard_record_write();
