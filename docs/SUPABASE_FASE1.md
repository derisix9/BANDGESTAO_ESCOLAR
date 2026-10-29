# BandMed → Supabase: Fase 1 (segurança e base multi-escola)

## O que esta fase entrega (e foi testado)
Esquema Postgres com segurança por escola e por perfil, auditoria encadeada, pagamentos e homologação só pelo servidor,
documentos fiscais imutáveis e QR público com validade. **35+ testes de segurança (`supabase/tests/rls.test.sql`) passam**
num Postgres 16 local, incluindo: intruso a tentar criar-se admin, admin de outra escola, aluno malicioso, professor a editar
campos que não pode, "pago" à mão, adulteração da auditoria.

## O que NÃO está feito (ver também o relatório)
- O `db.ts` (10 mil linhas) **ainda fala com o Firebase**. A camada nova está em `src/services/supabaseData.ts`; a migração
  módulo a módulo é a Fase 2 (autenticação → alunos/turmas → finanças → pautas → resto).
- **Facturação certificada AGT**: a estrutura (série, número sequencial, hash encadeado, imutabilidade) está pronta, mas a
  assinatura RSA, o SAF-T(AO) e a certificação do software são passos legais e externos. Até lá, são "documentos internos".
- **Referência Multicaixa/EMIS oficial** e confirmação automática de pagamento: exigem contrato com a EMIS/banco.
- 2FA: o Supabase Auth já suporta TOTP (activado em `config.toml`); falta o ecrã de inscrição/verificação na app e exigir `aal2` a admin/director/financeiro.
- Cifra de dados de saúde, política de privacidade, registo na APD, retenção automática.
- `tsc`/`vitest` **não foram corridos** (sem `node_modules` no ambiente de trabalho). Corra `npm install && npm run lint && npm test`.

## Passo a passo (sem instalar nada)
1. **Supabase → SQL Editor**: cole e execute, por ordem, `supabase/migrations/0001` … `0005`.
2. **Authentication → Providers → Email**: desligue *Allow new users to sign up* (**crítico**), mínimo de 10 caracteres,
   active confirmação de e-mail. **Authentication → MFA**: active TOTP.
3. **Project Settings → API**: copie *URL* e *anon key* para `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
   **Nunca** ponha a `service_role` no frontend nem no Git.
4. **Edge Functions** (com a CLI do Supabase): `supabase functions deploy create-user delete-user`
   e `supabase secrets set ALLOWED_ORIGIN=https://o-seu-site`.
5. Crie a sua conta de plataforma: registe-se no ecrã de registo da app (confirme o e-mail); depois, no SQL Editor,
   `insert into platform_admins(user_id) values ('<seu uuid>');` (só se for equipa BandMed).
6. Corra os testes: `PGURL=postgres://... npm run test:db`.
7. **Firebase**: até concluir a Fase 2, desactive o registo aberto no Firebase Auth e não publique novos dados reais lá.

## Notas de desenho
- `records` guarda cada colecção de `dataShards.json` como JSONB. As permissões vêm de `collection_acl`, gerada por
  `npm run gen:acl` a partir do mesmo JSON das regras Firebase (`npm run check:acl` na CI evita divergências).
- Gravações usam bloqueio optimista (`version`): dois utilizadores a editar o mesmo registo já não se sobrepõem em silêncio.
- Plano Free pausa após 1 semana sem uso e não inclui backups gerenciados: use `scripts/backup.sh` e passe a Pro ao hospedar.
- Dados de menores/saúde fora de Angola: consulte um advogado sobre a Lei 22/11 e a APD antes de ter escolas reais.

## Fase 2a — Autenticação Supabase + página de verificação
- `src/services/authSupabase.ts`: login, 2FA (TOTP), recuperação de palavra-passe, perfil vindo de `profiles`.
- `supabase-check.html` (abrir em `http://localhost:3000/supabase-check.html` com `npm run dev`): entra com o administrador e corre
  verificações reais contra o seu Supabase (isolamento entre escolas, gravação, "perfil admin" bloqueado, "pago" à mão bloqueado, auditoria).
- Verificado: `tsc` sem erros e 950 testes existentes a passar. A página em si ainda não foi corrida contra o seu projecto (só o utilizador a pode abrir).

## Fase 2b (parcial) — ecrã de login real
- Migração `0006_fix_pgcrypto_search_path.sql`: corrige `digest() does not exist` (pgcrypto vive em `extensions` no Supabase). **Aplicada e confirmada** (8/9 verificações ✔).
- `LoginView`: novos passos **Recuperar palavra-passe** (link por e-mail, resposta igual exista ou não a conta), **Nova palavra-passe** (ao abrir o link),
  **Código 2FA** e **Activar 2FA** (QR) — este último obrigatório para admin/director/financeiro.
- Interruptor `VITE_AUTH_BACKEND=supabase` (vazio = Firebase, comportamento actual). **Não o active ainda**: `db.ts` continua a ler os dados do Firebase,
  que não reconhece sessões Supabase. Ligue-o quando os módulos estiverem migrados (alunos/turmas → finanças → pautas → resto).
- Para o link de recuperação funcionar: Supabase → Authentication → URL Configuration → **Site URL** e **Redirect URLs** = o endereço onde a app corre
  (ex.: `http://localhost:3000/` e o domínio final). Para testar já: abra a app com `VITE_AUTH_BACKEND=supabase` só para ver o login, sem esperar dados.
- Verificado: `tsc` sem erros, 950 testes a passar. Os novos ecrãs ainda não foram corridos no navegador contra o seu projecto.

## Fase 2b — alunos e turmas no Supabase (muitas escolas): onde fica cada coisa
| O quê | Onde | Porquê |
|---|---|---|
| Alunos, matrículas, turmas (e depois as restantes colecções) | Postgres, tabela `records`, sempre com `institution_id` + RLS | Uma só base para todas as escolas; cada utilizador só vê a sua |
| Filtrar / pesquisar / paginar | No servidor (`dbService.queryRecordsPage`, índices da migração 0008) | Nenhum ecrã novo deve carregar "tudo" |
| Fotos, BI, certificados, PDFs | Storage, bucket privado `school-files` (`src/services/schoolFiles.ts`) | Ficheiros não vão para a base; permissões iguais às da colecção |
| Login, 2FA, recuperação | Supabase Auth | Já feito |
| Pagamentos, facturas, homologação, criar contas, auditoria | Funções no servidor (RPC / Edge Functions), nunca o navegador | Regras que ninguém pode contornar |
| Avisos, chat | Realtime (migração 0007) | |
| Boletins PDF, SAF-T, SMS, importação de pautas | Trabalho em segundo plano (fila) | **Ainda não feito** |
| Esquema | Só em `supabase/migrations/*.sql` (SQL standard) | Poder mudar de fornecedor |

**Como ligar (por esta ordem, numa escola de teste primeiro):**
1. SQL Editor: correr `0007_records_realtime_ord.sql` e `0008_indexes_storage.sql`.
2. Exportar do Firebase (Realtime Database → `⋮` → *Exportar JSON*) e importar:
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-to-supabase.mjs --file export.json --institution inst_bandmed --collections students,matriculas,classes`
   (corra primeiro com `--dry-run`; a chave `service_role` só na sua máquina). Dá uma conferência de contagens no fim.
3. Cada utilizador precisa de conta Supabase com o **mesmo e-mail e palavra-passe** (Edge Function `create-user`). Sem ela vê estas colecções vazias e não as consegue alterar.
4. No `.env`: `VITE_SUPABASE_COLLECTIONS=students,matriculas,classes` e reiniciar. Quem já estava com sessão tem de sair e entrar uma vez.
5. Para voltar atrás: esvaziar essa variável (os dados do Firebase não são apagados por este processo).

**Limites conhecidos:**
- Os ecrãs actuais ainda usam a lista da escola em memória (limitada a uma escola e ao ano lectivo, não à base toda); a paginação por ecrã faz-se ecrã a ecrã com `queryRecordsPage`.
- Anexos grandes em base64 continuam a ser descartados no envio (como antes) até os formulários passarem a usar `uploadSchoolFile`.
- Alunos e encarregados continuam a ler a sua "projecção" do Firebase; só é actualizada quando a equipa grava algo.
- `invoices` e `homologations` ficam de fora (exigem RPC); o interruptor ignora-os.
