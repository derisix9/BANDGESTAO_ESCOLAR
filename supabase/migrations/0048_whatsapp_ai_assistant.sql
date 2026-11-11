-- =====================================================================
-- 0048 — BANDGESTÃO AI (WhatsApp)
-- Associação verificada de utilizadores, memória curta, idempotência de webhook
-- e arquivo privado dos PDFs emitidos pelo assistente.
-- As escritas são feitas exclusivamente pelas funções de servidor (service_role).
-- =====================================================================

create table if not exists public.whatsapp_ai_links (
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  active boolean not null default true,
  paired_at timestamptz not null default now(),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (institution_id, user_id)
);
create index if not exists whatsapp_ai_links_phone_idx on public.whatsapp_ai_links(phone_e164) where active;

create table if not exists public.whatsapp_ai_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_ai_pairing_exp_idx on public.whatsapp_ai_pairing_codes(expires_at);

create table if not exists public.whatsapp_ai_conversations (
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (institution_id, user_id, phone_e164)
);
create index if not exists whatsapp_ai_conversations_exp_idx on public.whatsapp_ai_conversations(updated_at);

create table if not exists public.whatsapp_ai_webhook_events (
  message_id text primary key,
  from_phone text not null,
  phone_number_id text not null,
  status text not null default 'received' check (status in ('received','processing','processed','failed')),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists whatsapp_ai_events_created_idx on public.whatsapp_ai_webhook_events(created_at);

create table if not exists public.whatsapp_ai_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id text not null references public.institutions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('school_overview','students_list','classes_list','finance_summary')),
  title text not null,
  filename text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_ai_documents_inst_date_idx on public.whatsapp_ai_documents(institution_id, created_at desc);
create index if not exists whatsapp_ai_documents_user_date_idx on public.whatsapp_ai_documents(institution_id, user_id, created_at desc);

alter table public.whatsapp_ai_links enable row level security;
alter table public.whatsapp_ai_pairing_codes enable row level security;
alter table public.whatsapp_ai_conversations enable row level security;
alter table public.whatsapp_ai_webhook_events enable row level security;
alter table public.whatsapp_ai_documents enable row level security;

-- Apenas leitura de metadados no painel autenticado; operações de ligação são server-side.
revoke all on public.whatsapp_ai_links, public.whatsapp_ai_pairing_codes,
  public.whatsapp_ai_conversations, public.whatsapp_ai_webhook_events,
  public.whatsapp_ai_documents from anon, authenticated;
-- Nenhuma tabela interna é consultada directamente pelo browser; o servidor usa service_role
-- depois de validar sessão, instituição activa e permissões.
revoke all on public.whatsapp_ai_links, public.whatsapp_ai_documents from authenticated;
-- As rotas Vercel usam exclusivamente a chave service_role depois de validar sessão e ACL.
grant all privileges on public.whatsapp_ai_links, public.whatsapp_ai_pairing_codes,
  public.whatsapp_ai_conversations, public.whatsapp_ai_webhook_events,
  public.whatsapp_ai_documents to service_role;

create policy whatsapp_ai_links_read on public.whatsapp_ai_links for select to authenticated
  using (user_id = auth.uid() or
    (institution_id = app.current_institution() and app.current_role() in ('admin','director')));

create policy whatsapp_ai_documents_read on public.whatsapp_ai_documents for select to authenticated
  using (institution_id = app.current_institution() and
    (user_id = auth.uid() or app.current_role() in ('admin','director')));

-- Não se publica o bucket `school-files`; os PDFs são enviados por URL assinada de curta duração.
-- A service_role do webhook é a única identidade com permissões para inserir/ler/remover estes objectos.
