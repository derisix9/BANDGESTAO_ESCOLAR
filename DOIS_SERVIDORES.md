# Dois servidores: LOCAL (o seu PC) e NUVEM (Supabase)

## Ideia importante
A BandMed **não fala directamente com o PostgreSQL**: fala com a API do Supabase (login, RLS, Realtime, Edge Functions).
Por isso, o "servidor local" tem de ser o **Supabase local** (corre em Docker no seu PC, com um Postgres verdadeiro lá dentro e
as mesmas migrações de `supabase/migrations/`). Um PostgreSQL "solto" não serviria sem reescrever a app.

## Como funciona agora
| Situação | Servidor usado |
|---|---|
| `npm run dev` no seu PC | **Local** (ou o que escolher no selector no canto do ecrã) |
| `npm run build` / Vercel / Render | **Sempre a nuvem** (não há forma de mudar isto no site publicado) |

Em desenvolvimento aparece uma etiqueta no canto inferior esquerdo (verde = local, laranja = nuvem) com a ligação "mudar para…".
Ao trocar, a página recarrega e as caches do navegador são limpas (dados de um servidor nunca aparecem no outro).
Também pode usar `http://localhost:3000/?backend=cloud` ou `?backend=local`.

## Configuração (uma vez)
1. Instale **Docker Desktop** e abra-o.
2. `npm install`
3. `cp .env.example .env` (Windows: copie o ficheiro e renomeie para `.env`).
4. `npm run db:start` (a 1.ª vez demora; aplica sozinho as migrações). No fim, `npm run db:status` mostra a **URL** e a **anon key**.
5. No `.env`: cole a anon key local em `VITE_SUPABASE_ANON_KEY_LOCAL` e, nas variáveis `_CLOUD`, a URL e a anon key do seu projecto
   (Supabase → Project Settings → API).
6. `npm run dev`.

## Comandos
- `npm run db:start` / `db:stop` / `db:status` — ligar, desligar e ver dados do servidor local.
- `npm run db:reset` — **apaga** a base local e volta a aplicar as migrações (nunca toca na nuvem).
- `npm run db:push:cloud` — aplica na nuvem as migrações novas (pede `supabase login` e `supabase link --project-ref SEU_REF` uma vez).
- `npm run functions:serve` — Edge Functions (criar utilizador, registar escola…) a correr localmente. Segredos locais em `supabase/functions/.env`.

## Cuidados
- **Os dois servidores têm dados separados.** O local começa vazio: crie lá uma escola/administrador de teste.
- Emails de confirmação/recuperação no local não saem para a internet: abra o Inbucket em `http://127.0.0.1:54324`.
- Alterou o esquema? Crie a migração com `supabase migration new nome`, teste no local e só depois `npm run db:push:cloud`.
- A chave `service_role` nunca vai para o `.env` do site. O `server/*.ts` (backups, notificações) usa `SUPABASE_URL` próprio: aponte-o para o servidor que quiser nesse processo.
- Copiar dados da nuvem para o local (ou ao contrário) é possível, mas é uma operação à parte (contas de login incluídas); peça-me se precisar.
