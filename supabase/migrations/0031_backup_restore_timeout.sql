-- Restauro de backups de escolas grandes: o limite por omissão do Supabase para o papel `authenticated`
-- (8 s) cancela o restauro (erro 57014 / HTTP 500 em /rpc/school_backup_restore). Sobe-se para 120 s.
-- Seguro de repetir. Ver docs/BACKUPS_SUPABASE.md.
alter role authenticated set statement_timeout = '120s';
notify pgrst, 'reload config';
