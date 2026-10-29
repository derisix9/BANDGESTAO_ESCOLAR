# Passo 8 — Dados no dispositivo, entrada offline e palavras-passe

## A. Dados da escola no computador
**Problema:** terminar a sessão só apagava `bandmed_session_user`. A base inteira (alunos, notas, finanças) ficava em `localStorage` e `IndexedDB` em texto simples, à vista do próximo utilizador do computador.

**Agora** (`src/services/localDataPolicy.ts`, ligado em `dbService.logout()` e `dbService.purgeLocalData()`):
- Ao **sair** (botão, inactividade, sessão "Lembrar-me" expirada) e ao **abrir a app sem sessão**, apaga-se tudo o que é da escola: `escola_inst_*`, `escola_access_map_*`, `escola_pending_*`, `bandmed_escola_db_v1`, `bandmed_session_user`, `escola_active_institution_id`, `escola_institutions_index`, a cache de traduções (pode conter nomes), o lease offline e o IndexedDB. Preferências (modo escuro, cookies) mantêm-se.
- **Excepção:** se houver alterações por sincronizar (`escola_pending_* = 1`) não se apaga nada, para não perder trabalho feito sem rede. Apaga-se na saída seguinte, já sincronizado.
- Quem **não sai** (sessão aberta com "Lembrar-me") continua a ter os dados no aparelho para trabalhar offline, como antes.
- Efeito visível: num aparelho onde se saiu, o login por nome de utilizador ou nº de processo só funciona depois de a lista de utilizadores ser carregada; entre com o e-mail.

**O que NÃO está feito:** os dados continuam **sem cifra** enquanto a sessão está aberta e enquanto houver alterações por sincronizar. Cifrar o IndexedDB e o `localStorage` obriga a tornar assíncrono o arranque do `db.ts` (hoje lê `localStorage` de forma síncrona, em ~11 500 linhas) e a testar offline/sincronização num navegador real. Fica como passo próprio (ver "Próximo passo").

## B. Entrada offline de perfis com 2FA
**Problema:** sem rede, `mfaOk = usedCachedProfile` aceitava o perfil guardado como se o 2FA tivesse sido feito.

**Agora** (`src/services/offlineLease.ts`, `src/components/OfflineUnlockView.tsx`; só actua com `MFA_ENABLED = true`):
- Num login online completo (palavra-passe + 2FA) de admin, director ou financeiro grava-se um *lease* cifrado (AES-GCM 256, chave PBKDF2-SHA256 com 600 000 iterações derivada da palavra-passe, autenticado com o id da conta).
- Sem rede, estes perfis só abrem a cópia local se: o lease existe, é da mesma conta, tem no máximo **7 dias**, o último login teve 2FA, e a pessoa **volta a escrever a palavra-passe**. Alterar o ficheiro invalida-o.
- O lease não dá acesso ao servidor (a sessão e a RLS continuam a decidir); só autoriza abrir a cópia local.
- **Atenção:** `MFA_ENABLED` está `false` em `src/services/authSupabase.ts`. Enquanto estiver assim não há 2FA para contornar, mas também não há 2FA. Ligar o 2FA é o ponto 1 da auditoria.

## C. Palavra-passe temporária e validade (migração `0045_password_policy.sql`)
**Problema:** o administrador criava contas com uma palavra-passe sua e nada obrigava a trocá-la; a validade de 90 dias só existia no navegador e nunca funcionou (`passwordUpdatedAt` nunca era gravado).

**Agora, no servidor:**
- `create-user` marca a conta com `must_change_password = true`. Até a pessoa definir a sua palavra-passe, a RLS recusa **todos** os dados e as Edge Functions recusam o pedido. O login mostra **"Defina a sua palavra-passe"**.
- `password_changed_at` e a limpeza da marca são gravados por um **trigger em `auth.users`** (só quando o hash muda de facto). O utilizador não consegue limpar a marca nem forjar a data (trigger `profiles_pw_guard`). Se o Supabase alguma vez re-hashar a palavra-passe no login (migração de algoritmo), a marca também se limparia: confirme com o suporte se vier a activar isso.
- Validade: `institutions.password_max_age_days` (0 = nunca; 30 a 365). O administrador define em Configurações → Segurança → *Validade da Senha* → **Aplicar no servidor**. Alunos e encarregados não expiram por idade (só trocam a temporária).
- A app confere de 5 em 5 minutos: se a palavra-passe expirar a meio da sessão, ou o administrador pedir a troca (`admin_force_password_change`), a sessão termina e o próximo login obriga a trocar.
- O aviso "faltam N dias" passa a vir do servidor (`days_left`).
- Contas já existentes: `password_changed_at` começa em "agora" na data da migração, por isso ninguém expira de imediato.

## Antes de ir para produção
1. `supabase db push` (migração 0045) e voltar a publicar `create-user` e as Edge Functions que usam `ipGuard` (a mensagem e `edge_ip_allowed` mudaram).
2. O trigger em `auth.users` só é criado se a coluna `encrypted_password` existir (existe no Supabase real). Confirme: `select tgname from pg_trigger where tgname = 'on_auth_password_changed';`.
3. Corra `scripts/test-db.sh` contra uma base de teste (inclui `supabase/tests/password_policy.test.sql`). **Estes testes SQL não foram executados** (não havia PostgreSQL disponível quando foram escritos).
4. Teste manual: criar um professor novo → entrar → tem de aparecer "Defina a sua palavra-passe" → depois entra normalmente.

## D. Cópia local cifrada (cofre) — feito

**O que mudou**
- A base de dados da escola deixou de ir para `localStorage` (texto simples, limite de 5 MB). Fica **só no IndexedDB, cifrada com AES-GCM** (`src/services/localVault.ts`).
- A chave (256 bits) deriva da **palavra-passe** no login (PBKDF2-SHA256, 600 000 iterações, sal próprio). Fica em `sessionStorage` (some ao fechar o navegador) e em memória, nunca em `localStorage`.
- Em `localStorage` ficam apenas o sal (`bm_vault_salt_data`) e uma prova cifrada (`bm_vault_check`) para saber se a palavra-passe abre o cofre. Não têm dados da escola.
- Cada gravação usa um IV novo. Alterar o registo no disco faz a leitura falhar (autenticação do AES-GCM).
- Sem chave **não se grava nada** (nunca em claro). Os restos em claro de versões anteriores (`escola_inst_*`, `bandmed_escola_db_v1` e registos antigos do IndexedDB) são apagados na primeira gravação cifrada.

**Fluxos**
| Situação | O que acontece |
|---|---|
| Login online | Depois de o servidor confirmar a palavra-passe (e o 2FA, se activo), o cofre é criado ou aberto e a cópia é gravada cifrada. |
| Recarregar a página | A chave está no `sessionStorage`: abre sem pedir nada. |
| Navegador reaberto com sessão válida ("Lembrar-me") | Ecrã **"Desbloquear dados"**: pede a palavra-passe. Online e sem alterações por sincronizar, há o botão "Continuar sem guardar dados neste aparelho" (tudo vem do servidor; nada se guarda no aparelho neste separador). |
| Sem internet | Mesmo ecrã. Perfis com 2FA confirmam também o lease (passo B). |
| Sair / inactividade / sessão expirada | Grava a cópia cifrada, esquece a chave e apaga os dados (como no passo A). Se houver alterações por sincronizar, a cópia fica **cifrada e bloqueada**. |
| Palavra-passe alterada noutro lado | A prova deixa de abrir: a cópia antiga é apagada e começa-se um cofre novo; os dados voltam do servidor. |

**Limites (para não prometer demais)**
- Protege o **disco** (computador roubado, sala partilhada, perfil copiado). Não protege quem usa o navegador **enquanto a sessão está aberta**, nem malware no computador.
- Continuam em claro em `localStorage`: o perfil da sessão (`bandmed_session_user`), o id e o índice das escolas e as marcas de "pendente". Não são a base de dados.
- Se a palavra-passe mudar e houver alterações feitas sem rede ainda por enviar, essas alterações não se conseguem abrir (a chave antiga já não existe). Por isso a troca de palavra-passe deve ser feita com a app sincronizada.
- Exige Web Crypto (HTTPS). Sem ele a app funciona como antes, mas sem cópia local.

**Teste manual (pré-visualização)**
1. Entrar. No DevTools → Application → IndexedDB: `school_database` só tem registos `{__enc, iv, ct}`. `localStorage` não tem `escola_inst_*`.
2. Recarregar (F5): entra sem pedir nada.
3. Fechar o navegador e abrir (sessão "Lembrar-me"): aparece "Desbloquear dados". Palavra-passe errada é recusada; a certa abre.
4. Desligar a rede, recarregar: pede a palavra-passe e abre a cópia local.
5. Sair: `school_database` fica vazio e `bm_vault_*` desaparece.
