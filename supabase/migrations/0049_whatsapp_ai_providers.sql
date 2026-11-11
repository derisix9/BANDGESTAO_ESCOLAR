-- =====================================================================
-- 0049 — BANDGESTÃO AI: fornecedores de IA por instituição + documentos Excel
-- 1) Chaves de API (OpenAI, Gemini, Claude, Groq, OpenRouter) guardadas CIFRADAS, só acessíveis ao servidor.
-- 2) whatsapp_ai_documents passa a aceitar todos os tipos de relatório e o formato (pdf/xlsx).
-- 3) O bucket `school-files` passa a aceitar .xlsx (mantém o limite de 5 MB).
-- Pré-requisito: migração 0048.
-- =====================================================================

create table if not exists public.whatsapp_ai_provider_keys (
  institution_id text not null references public.institutions(id) on delete cascade,
  provider text not null check (provider in ('openai','gemini','claude','groq','openrouter')),
  key_cipher text not null,
  key_hint text not null default '••••',
  model text not null,
  priority integer not null default 10 check (priority between 1 and 99),
  enabled boolean not null default true,
  last_status text not null default 'untested' check (last_status in ('untested','ok','error')),
  last_error text,
  last_used_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institution_id, provider)
);
create index if not exists whatsapp_ai_provider_keys_order_idx
  on public.whatsapp_ai_provider_keys(institution_id, priority) where enabled;

-- Sem políticas: nem o navegador nem utilizadores autenticados lêem esta tabela (nem a chave cifrada).
alter table public.whatsapp_ai_provider_keys enable row level security;
revoke all on public.whatsapp_ai_provider_keys from anon, authenticated;
grant all privileges on public.whatsapp_ai_provider_keys to service_role;

-- Documentos: novos tipos de relatório e formato do ficheiro.
alter table public.whatsapp_ai_documents add column if not exists file_format text not null default 'pdf';
alter table public.whatsapp_ai_documents drop constraint if exists whatsapp_ai_documents_file_format_check;
alter table public.whatsapp_ai_documents add constraint whatsapp_ai_documents_file_format_check check (file_format in ('pdf','xlsx'));
alter table public.whatsapp_ai_documents drop constraint if exists whatsapp_ai_documents_document_type_check;
alter table public.whatsapp_ai_documents add constraint whatsapp_ai_documents_document_type_check check (document_type in (
  'school_overview','students_list','classes_list','finance_summary','overdue_invoices','expenses_list','teachers_list','staff_list'));

-- Bucket privado: acrescenta o tipo Excel (o 0008 só previa imagens e PDF).
do $$ begin
  if to_regnamespace('storage') is null then
    raise notice 'Sem Storage (Postgres local): saltado.'; return;
  end if;
  update storage.buckets
     set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf',
                                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
         file_size_limit = 5242880
   where id = 'school-files';
end $$;
