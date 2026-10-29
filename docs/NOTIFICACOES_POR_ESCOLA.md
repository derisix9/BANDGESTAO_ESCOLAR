# Notificações mais baratas — por escola

Cada escola liga os **seus** serviços em *Configurações → Integrações → Notificações* (como na cópia na nuvem e nos pagamentos).
As credenciais ficam **cifradas no servidor** (AES-256-GCM, chave fora da base de dados) e nunca voltam ao navegador.

| Canal | Para quê | Custo | Como liga a escola |
|---|---|---|---|
| **Push** (Web Push) | avisos normais | grátis | gera as chaves VAPID da escola (a privada fica só no servidor) |
| **SMS** | só o **crítico** (ex.: propina em atraso) | por mensagem | Twilio, Infobip ou **agregador local** por API HTTP |
| **WhatsApp** | só com **modelo aprovado** | por conversa | Meta Cloud API ou Twilio (Content SID) |

Regras aplicadas **no servidor**, não só no ecrã: o SMS de um aviso normal é recusado quando a escola deixou "só crítico" ligado
(omissão); o WhatsApp só envia o modelo aprovado (o texto do aviso entra como variável `{{1}}`).

## Instalação
1. Aplicar `supabase/migrations/0039_notificacoes_por_escola.sql`.
2. Publicar a função: `supabase functions deploy notifications`.
3. Segredos: `supabase secrets set NOTIFY_SECRETS_KEY=<≥32 caracteres> NOTIFY_CRON_SECRET=<≥24 caracteres>`
   (se faltarem, usa `BACKUP_SECRETS_KEY` / `BACKUP_CRON_SECRET`). **Não troque `NOTIFY_SECRETS_KEY` depois**: as credenciais guardadas deixam de abrir.
4. Agendador (repetições e fila): GitHub Actions `.github/workflows/notificacoes-escolas.yml` (secrets `SUPABASE_PROJECT_URL`, `NOTIFY_CRON_SECRET`)
   **ou** pg_cron, como em `docs/BACKUP_EXTERNO.md`:
   ```sql
   select vault.create_secret('O-MESMO-VALOR-DE-NOTIFY_CRON_SECRET', 'bm_notify_cron_secret');
   select cron.schedule('bm_notifications', '*/5 * * * *', $$
     select net.http_post(url := 'https://<projeto>.supabase.co/functions/v1/notifications',
       headers := jsonb_build_object('Content-Type','application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bm_notify_cron_secret')),
       body := '{}'::jsonb) $$);
   ```
5. O Super Admin tem de pôr *Integrações* em modo **gravação** para a escola (migração 0023).

## Push
- A escola escreve um contacto (`mailto:secretaria@escola.ao`) e carrega **Gerar chaves e guardar**. A chave **pública** vai para os aparelhos; a privada fica cifrada.
- Cada utilizador activa as notificações no sino do topo; o aparelho fica registado para a **sua escola e conta**. Ao terminar a sessão é desregistado.
- **iPhone/iPad:** só funciona com a app instalada no ecrã inicial (iOS 16.4+).
- Quem recebe é resolvido no **servidor** (professores, funcionários, alunos e os seus encarregados, ou toda a escola); só contas activas da escola.
- Gerar novas chaves repõe os aparelhos (voltam a registar-se ao abrir a app). Aparelhos que respondem 404/410, ou falham 5 vezes seguidas, são removidos.
- Implementação sem dependências (WebCrypto): RFC 8291 (aes128gcm) e RFC 8292 (VAPID), testada com o vetor da RFC e um receptor independente (`tests/webpush.test.ts`).

## SMS por fornecedor à escolha
Interface `SmsProvider` (`supabase/functions/_shared/notify.ts`); cada fornecedor é uma classe. Para ligar um **agregador local** não é preciso código:
a escola indica o endereço https, o modelo do corpo (`{"to":"{{to}}","text":"{{message}}"}`), a autenticação (Bearer, Basic, cabeçalho ou parâmetro) e o
formato do número (`+244…`, `244…` ou `9…`). Endereços internos, IPs, `localhost` e portas fora de 443 são recusados (anti-SSRF) e não se seguem redireccionamentos.

### Servidor global (`server/notify.ts`)
Serve as escolas que **não** ligaram o seu fornecedor (sem duplicar envios: `claim_notifications()` salta as que têm o seu). O fornecedor escolhe-se por ambiente:

```
SMS_PROVIDER=twilio|infobip|http        WHATSAPP_PROVIDER=twilio|meta_cloud       SMS_CRITICAL_ONLY=true (omissão)
twilio:  TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_SMS_FROM  [TWILIO_MESSAGING_SERVICE_SID]
infobip: INFOBIP_BASE_URL INFOBIP_API_KEY INFOBIP_SENDER
http:    SMS_HTTP_URL SMS_HTTP_BODY_TEMPLATE [SMS_HTTP_CONTENT_TYPE SMS_HTTP_AUTH_MODE SMS_HTTP_AUTH_NAME SMS_HTTP_TOKEN SMS_HTTP_PHONE_FORMAT SMS_HTTP_SENDER SMS_HTTP_SUCCESS_CONTAINS]
WhatsApp: TWILIO_WHATSAPP_FROM + TWILIO_WHATSAPP_CONTENT_SID   |   META_PHONE_NUMBER_ID META_ACCESS_TOKEN META_TEMPLATE_NAME [META_TEMPLATE_LANG META_API_VERSION]
```
**Atenção:** com a regra "SMS só crítico" ligada por omissão, os envios de SMS que não estejam marcados como críticos passam a ser recusados. Para manter o comportamento antigo use `SMS_CRITICAL_ONLY=false`.

## Na aplicação
*Comunicação → Notificações*: canal **Push (grátis)**, SMS, WhatsApp ou SMS + WhatsApp, e a caixa **Aviso crítico**. O SMS fica reservado ao crítico;
o estado "na fila" significa *aceite*, não *entregue*. Falhas temporárias repetem com recuo (2, 4, 8… min, até 5 tentativas); erros de configuração ou de número não repetem.

## Testes
`npx vitest run tests/webpush.test.ts tests/notificationProviders.test.ts` e `bash scripts/test-db.sh` (inclui `supabase/tests/notifications_gateway.test.sql`).
