# Monitorização de erros

Desde a migração `0047_client_errors.sql` a app regista erros do browser e falhas de sincronização numa tabela do Supabase,
para a equipa da plataforma os ver antes de as escolas ligarem ao suporte.

## O que é capturado
| Tipo (`kind`) | Origem |
|---|---|
| `error` | erro não tratado (`window.onerror`) |
| `unhandledrejection` | promessa rejeitada sem `catch` |
| `react` | falha de renderização apanhada pelo `ErrorBoundary` |
| `sync` | sincronização com a nuvem a falhar **3 ou mais vezes seguidas** (cortes breves de rede não contam) |

Ficam de fora: `ResizeObserver loop`, `Script error.` (outra origem), cancelamentos (`AbortError`) e erros de extensões do browser.

## Privacidade
- Antes de sair do browser, a mensagem e a stack perdem JWT, e-mails, tokens em parâmetros e números com 9+ dígitos (BI, telefone, NIF). O URL fica sem parâmetros nem fragmentos `#chave=valor`.
- Não se envia conteúdo de formulários, notas, nomes de alunos nem o estado da escola.
- A escola e o utilizador **não vêm do cliente**: o servidor deduz-os do JWT.
- É um registo técnico; mesmo assim, mencione-o na política de privacidade.
- Retenção: 30 dias (limpeza automática ocasional e `select public.purge_client_errors(30);` com `service_role`).

## Anti-inundação
- Cliente: no máximo 30 relatórios por sessão; o mesmo erro só volta a ser enviado ao fim de 60 s.
- Servidor: o mesmo erro na mesma escola, na mesma hora, soma a um contador (`occurrences`); no máximo 100 erros distintos por escola e por hora.
- Sem sessão ou sem rede, ficam numa fila local (20) e seguem ao iniciar sessão ou quando a rede volta.

## Como ler (equipa da plataforma)
Só utilizadores em `platform_admins` têm acesso. No SQL Editor do Supabase (com a sessão de um administrador da plataforma) ou por RPC:

```sql
-- Erros mais frequentes das últimas 24 horas (máx. 30 dias)
select kind, message, total_occurrences, schools, users, app_versions, last_seen, sample_url
  from public.platform_client_errors_summary(24);

-- Detalhe de um erro
select institution_id, role, occurrences, url, stack, context, last_seen_at
  from public.client_errors where fingerprint = '<fingerprint>' order by last_seen_at desc;
```

Sinais a vigiar: um erro com muitas `schools` logo após uma publicação (regressão), `sync` a subir (problema de rede ou do Supabase) e `react` numa vista específica (`context.section`).

## Versão da app
Defina `VITE_APP_VERSION` no build (ex.: o SHA do commit) para o relatório indicar a versão. Sem ela aparece `dev`.

## Alertas (opcional, fora do código)
O resumo pode ser consultado por um agendamento (n8n, GitHub Actions, Supabase Cron) que envie e-mail ou WhatsApp quando `total_occurrences` de um erro passar de um limiar. Isto exige uma conta de serviço e não está incluído.

## Testes
- `tests/errorReport.test.ts`: limpeza de dados pessoais, impressão digital, ruído e limitador.
- `supabase/tests/client_errors.test.sql` (corre em `npm run test:db`): agrupamento, truncagem, isolamento entre escolas, permissões e anti-inundação. **Precisa de um Postgres com `psql`**.
