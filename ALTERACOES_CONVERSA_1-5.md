# Alterações concluídas (conversas 1–5)
1. Notas de alunos transferidos/equivalência (médias importadas) aparecem nas mini-pautas, pauta final, homologação, conselho de turma e boletim; gravar a mini-pauta já não as apaga (pautaCalculations.ts, types/pauta.ts, PautasView, HomologacaoPautaView, councilGrades.ts, db.ts).
2. Caixa de entrada: avisos de novos pedidos de admissão online, transferências recebidas, aluno admitido por transferência e aluno transferido (db.ts `startInboxWatchers`, App.tsx).
3. Integrações e Backup automático por escola, definidos pelo Super Admin: Desativar / Leitura / Gravação (omissão: Desativar).
   - Migração `supabase/migrations/0023_school_feature_modes.sql` (também em admin/migrations)
   - App escola: `src/utils/featureModes.ts`, `src/components/FeatureReadOnly.tsx`, ConfiguracoesView, TabSegurancaBackups, userAccess.canViewSection
   - Servidor: Edge Function `school-backups` exige modo Gravação para configurar
   - Admin Master: cartão em SchoolDetail.tsx + funções em lib/api.ts
Aplicar: `supabase db push` e `supabase functions deploy school-backups`.
