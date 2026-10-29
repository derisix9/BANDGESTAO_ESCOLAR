# Passo 7 — CORS das Edge Functions e /api/translate

## 1. CORS fechado por omissão (Edge Functions)
Antes: `Access-Control-Allow-Origin: *` se não houvesse segredo. Agora a origem vem **só** de `ALLOWED_ORIGIN`:
- definido (ex.: `https://bandgestao.vercel.app`, sem `/` no fim) → só essa origem;
- `ALLOWED_ORIGIN=*` → aberto, só se for pedido de forma explícita;
- não definido → em desenvolvimento local (`127.0.0.1`/`localhost`/`kong`) fica `*`; em produção fica `null` e o navegador bloqueia.

**Defina o segredo ANTES de publicar as funções**, senão a app deixa de conseguir chamá-las:
`supabase secrets set ALLOWED_ORIGIN=https://bandgestao.vercel.app`
Só aceita uma origem. Previews da Vercel e `localhost` precisam de o segredo ser mudado temporariamente.
As respostas levam `Vary: Origin`.
O `payments-webhook` não usa CORS (é chamado pelo gateway, não pelo navegador).

## 2. /api/translate
| Antes | Agora |
|---|---|
| origem validada com `includes(host)` (contornável com `host.evil.com`) | anfitrião **exacto** do Origin/Referer; Origin obrigatório; extra em `TRANSLATE_ALLOWED_HOSTS` |
| sem autenticação | sessão Supabase obrigatória (Bearer validado em `/auth/v1/user`) |
| sem limite | 60 pedidos/min por IP e 30/min por utilizador; máx. 2000 caracteres por texto |
| erro devolvia a mensagem interna | resposta genérica `upstream` |

Sem sessão (ecrã de login), o cliente traduz directamente no navegador (já era o caminho de reserva); a chave do Google só é usada por quem tem sessão.

### Variáveis a definir na Vercel (Settings → Environment Variables)
`SUPABASE_URL` e `SUPABASE_ANON_KEY` (ou já existem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; a função usa qualquer um dos dois pares).
Sem elas a função responde 401 a todos (fecha por defeito) e a tradução cai para o navegador.

### Limite honesto
O contador de pedidos vive na memória de cada instância da função: na Vercel há várias, por isso o limite é aproximado.
Para um limite firme, crie uma regra de rate limit no Firewall da Vercel para `/api/translate` (confirme se o seu plano inclui).
Convém também pôr um limite de gasto/quotas na chave do Google Cloud.
