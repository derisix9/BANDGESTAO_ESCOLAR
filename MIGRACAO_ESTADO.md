# Migração Firebase → Supabase — estado

Código migrado: já não há imports do Firebase (o pacote `firebase` saiu do `package.json`).

## Feito
- `cloud.ts`, `db.ts`, `shardBackendSupabase.ts`, `authSupabase.ts`, Edge Functions (create-user, delete-user).
- `LoginView.tsx`: login só Supabase (e-mail ou utilizador via `resolveLoginEmail`), `restoreSession` no fim; registo de escola por `signUp` nativo com confirmação de e-mail.
- `App.tsx`: só `watchAuthState` do Supabase + `dbService.restoreSession`.
- QR públicos SEGUROS: payload mínimo (sem BI, contactos, notas, facturas, folha), validade (1 ano, renovada ao publicar), revogação (`revoke_public_subject`) e reemissão só por admin (migração `0010_publish_public_token.sql`, testes no bloco 10 de `supabase/tests/rls.test.sql`). Página pública = só "cartão válido/inactivo"; histórico por QR removido.
- `reauthenticate` usa cliente isolado: nunca rebaixa a sessão 2FA.
- Edge Functions: limite de avatar.
- `server/notify.ts` valida o token de sessão no Supabase (`SUPABASE_URL` + `SUPABASE_ANON_KEY`).
- Limpeza: `firebase.ts`, `auth.ts`, `database.rules.json`, `firebase-*.json`, `gen-shard-rules`, `shard-rules-lib`, `shardRules.test.ts`, passo `check:rules` da CI, `sw.js`, README, `.env.example`.
- `generateTempPassword()` garante maiúscula + minúscula + número (teste novo).

## Por verificar (não foi possível neste ambiente: sem rede/node_modules/Postgres)
1. `npm install && npm run lint && npm test` (esperado: sem erros de tipos; testes antigos menos `shardRules`, mais `tempPassword`).
2. `npm run test:db` (corre 0001–0010 + RLS) — a 0010 e o bloco 10 de `rls.test.sql` nunca foram executados.
3. Edge Functions nunca foram executadas: testar `create-user`, `delete-user` com `supabase functions serve`.
4. `reauthenticate` na homologação pode descer a sessão 2FA (aal2 → aal1): testar com um admin com 2FA.
5. Importar os dados antigos com `scripts/import-to-supabase.mjs` (mantido de propósito).

## Backup e restauro por escola — um ficheiro .json (versão simples)
- Migração `0012_school_backup_file.sql`: `school_backup_export()` e `school_backup_restore(p_payload, p_confirm)` (só administrador; escola vem do perfil; tudo ou nada).
- App: `SchoolRestorePoints` (Baixar backup / Carregar backup) + `src/utils/schoolBackupApi.ts`. Antes de restaurar descarrega-se o estado actual.
- Pagamentos, documentos fiscais e auditoria: só no ficheiro como referência; nunca reescritos. Facturas existentes ficam como estão (recriam-se só as que faltam).
- Removido: Edge Function, Storage, pg_cron, cifra, `server/backup*.ts`, workflow `backup-escolas.yml`. Mantido: `pg_dump` global (`backup.yml`).
- Por verificar: `npm run test:db` no teu ambiente e um restauro real numa escola de teste (ver `docs/BACKUPS_SUPABASE.md`).

---
## Plano e Subscrição, limites e tolerância (migração 0020)

- Aplicar por ordem: `0019_platform_admin.sql` (Admin Master) e `0020_plan_limits_grace.sql`.
- Nova secção **Configurações › Plano e Subscrição** (`TabPlanoSubscricao.tsx`): plano ativo, data de ativação,
  contagem regressiva até expirar, tolerância concedida, consumo de alunos/utilizadores/armazenamento,
  pedidos de suporte (responder e abrir novos). Só Administrador/Diretor.
- Os limites são impostos na base de dados; a app só reconhece o erro `LIMITE_PLANO:<tipo>` (`src/utils/planLimits.ts`)
  e mostra uma janela clara. Ecrã de bloqueio (`PlanBlockedScreen`) permite pedir regularização/tolerância.
- Campos de texto: regra global em `src/styles/global-fields.css` (fundo #9fbad8, texto preto, placeholder claro).
