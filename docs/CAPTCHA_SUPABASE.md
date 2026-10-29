# Captcha (Cloudflare Turnstile) verificado pelo Supabase

## Como funciona
1. A app mostra o widget Turnstile com a **site key** (`VITE_TURNSTILE_SITE_KEY`, pública).
2. O token do widget segue com o pedido de login: `supabase.auth.signInWithPassword({ options: { captchaToken } })`.
3. O **Supabase Auth** valida o token na Cloudflare com o **secret** que guardou em *Authentication → Attack Protection → Enable Captcha protection*.
   Quem chamar `/auth/v1/token` directamente, sem token válido, é recusado. Já não há verificação "só de interface".

Cobertos pelo Supabase: login (`signIn`), reautenticação (`reauthenticate`) e recuperação de palavra-passe (`sendPasswordReset`).
O código já enviava o token nestas três; não foi preciso mudar nada.

## O que tem de estar certo
- Vercel → Environment Variables: `VITE_TURNSTILE_SITE_KEY` = site key **real** do widget (e fazer novo deploy: as variáveis `VITE_` entram no build).
- Supabase → Attack Protection: provider Turnstile + o secret **do mesmo widget**. Site key e secret têm de ser do mesmo par.
- No painel da Cloudflare, o widget tem de listar o seu domínio (ex.: `app.escola.ao`) em *Hostname Management*.
- Não use as chaves de teste `1x000…`: a app bloqueia-as em produção.

## Registo de escolas
O registo usa `auth.signUp`, por isso o Supabase valida o token do Turnstile como no login. Já não há Edge Function própria nem o secret `TURNSTILE_SECRET_KEY` no Supabase → Edge Functions.
