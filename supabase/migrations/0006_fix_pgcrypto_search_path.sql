-- =====================================================================
-- 0006 — Corrige "function digest(text, unknown) does not exist"
-- No Supabase, a extensão pgcrypto vive no schema `extensions`, que não estava
-- no search_path das funções SECURITY DEFINER. Isto parava a auditoria e,
-- por arrasto, QUALQUER gravação em `records` (o trigger de auditoria falhava).
-- Seguro de correr mais do que uma vez.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

alter function app.write_audit(text, text, text, text, jsonb)              set search_path = public, extensions, pg_temp;
alter function app.verify_audit_chain(text)                                set search_path = public, extensions, pg_temp;
alter function public.issue_fiscal_document(text,text,text,text,jsonb,numeric,numeric,text)
                                                                           set search_path = public, extensions, pg_temp;
alter function public.write_audit_service(text, uuid, text, text)          set search_path = public, extensions, pg_temp;
alter function public.issue_public_token(text, text, jsonb, integer)       set search_path = public, extensions, pg_temp;
