# Cópia diária para a nuvem da escola (Google Drive, Backblaze B2, Wasabi, R2, S3…)

Em **Configurações → Segurança & Backups → 3. Cópia diária para a nuvem da escola**, o administrador liga a conta de armazenamento
**da própria escola**. Todos os dias, à hora escolhida (hora de Angola), o servidor envia `bandmed_<escola>_<data>_<hora>.json`
com os dados **só dessa escola** (mesmo conteúdo de "Baixar backup"): **repõe-se com "Carregar backup"**.

## Controlos
| Controlo | O que faz |
|---|---|
| Serviço | Google Drive **ou** S3 (Backblaze B2, Wasabi, Cloudflare R2, Amazon S3, outro compatível) |
| Backup diário automático | liga/desliga |
| Hora (Angola) | 00–23h; por omissão 23:00. Se falhar, repete (até 4 vezes/dia, 1 por hora) |
| Guardar durante | 7 dias … 1 ano, ou **Nunca apagar**. Só apaga `bandmed_<escola>_….json`; as 3 mais recentes ficam sempre |
| Testar ligação / Fazer backup agora | envia e apaga um ficheiro de teste / corre já |
| Desligar | apaga credenciais do servidor (revoga o Google). Não apaga o que já está na nuvem |

Tudo fica no registo de auditoria da escola.

## Instalação (uma vez, por quem gere o projecto)
1. **Migração** `supabase/migrations/0018_external_backup.sql` (requer a 0016).
2. **Segredos**:
   ```bash
   supabase secrets set BACKUP_SECRETS_KEY="$(openssl rand -base64 48)"   # ≥ 32 chars; guarde-o também FORA do servidor
   supabase secrets set BACKUP_CRON_SECRET="$(openssl rand -hex 32)"
   supabase secrets set ALLOWED_ORIGIN=https://a-sua-app                   # recomendado (também usado no regresso do Google)
   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...      # só para Google Drive
   ```
   ⚠️ Se perder/alterar `BACKUP_SECRETS_KEY`, cada escola tem de voltar a ligar o destino (os backups na nuvem não são afectados).
3. **Publicar**: `supabase functions deploy school-backups --no-verify-jwt` (vários ficheiros: use a CLI, não o editor do painel).
4. **Agendador** (de 15 em 15 min; só processa escolas com backup devido). Uma das opções:
   - **pg_cron** (ligar `pg_cron` e `pg_net`):
     ```sql
     select vault.create_secret('https://SEU-PROJECTO.supabase.co', 'bm_project_url');
     select vault.create_secret('O-MESMO-VALOR-DE-BACKUP_CRON_SECRET', 'bm_backup_cron_secret');
     select cron.schedule('bm_school_backups', '*/15 * * * *', $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'bm_project_url') || '/functions/v1/school-backups',
         headers := jsonb_build_object('Content-Type', 'application/json',
                      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bm_backup_cron_secret')),
         body := '{}'::jsonb, timeout_milliseconds := 120000);
     $$);
     ```
   - **GitHub Actions**: `.github/workflows/backup-escolas.yml`; defina os Secrets `SUPABASE_PROJECT_URL` e `BACKUP_CRON_SECRET`.
5. Escola grande com "statement timeout": `alter role service_role set statement_timeout = '300s'; notify pgrst, 'reload config';`

## Google Drive — aplicação OAuth (uma vez para todas as escolas)
1. console.cloud.google.com → criar projecto → activar **Google Drive API**.
2. Ecrã de consentimento *Externo*; âmbitos `openid`, `email`, `…/auth/drive.file` (só ficheiros criados pelo BandMed).
3. **Publicar a app ("Em produção")**. Em modo *Teste* o Google revoga a autorização ao fim de 7 dias e os backups param.
4. Credenciais → ID de cliente OAuth *Aplicação Web*; URI de redireccionamento:
   `https://SEU-PROJECTO.supabase.co/functions/v1/school-backups/gdrive-callback`
5. ID e segredo → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Sem isto o botão do Drive avisa que não está configurado; o S3 funciona na mesma.

## S3 — o que a escola faz no fornecedor
Bucket **privado** + chave **só desse bucket** (escrever, listar, apagar). Backblaze B2: região = parte do *Endpoint* (ex.: `us-west-004`).
Wasabi: região do bucket. Cloudflare R2: endereço `https://<ID-DA-CONTA>.r2.cloudflarestorage.com`, região `auto`.

## Segurança
- Chaves S3 e refresh token do Google cifrados (AES-256-GCM) com `BACKUP_SECRETS_KEY` (fora da BD); o id da escola entra na cifra.
  Tabelas sem acesso para `anon`/`authenticated`; o painel só recebe "tem credenciais: sim/não".
- Só o administrador activo; a escola vem do perfil autenticado.
- Endereço S3: só HTTPS em domínio público (sem IPs, localhost, portas, nomes internos). Risco residual: DNS rebinding não detectado.
- Escola sem registos: não envia nada e **não apaga** backups antigos.
- O ficheiro não é cifrado e tem dados de menores: bucket privado e conta com 2 passos.
- Limite de 100 MB por backup (memória da função).

## Testes
`tests/externalBackup.test.ts` (anti-SSRF, cifra, SigV4 oficial AWS, S3 e Drive com rede simulada, retenção). **Não** testado contra
serviços reais nem contra Postgres real (0018): corra `npm run test:db`/aplique a migração e use *Testar ligação*.
