# Registo de escolas com verificação de e-mail (Supabase Auth nativo)

Sem Edge Functions, sem tabela de pedidos, sem pg_cron obrigatório e sem serviço de e-mail próprio: é o `signUp` do Supabase.

## Como funciona
1. A pessoa preenche o registo (com captcha). A app chama `supabase.auth.signUp()` com os dados da escola em `user_metadata`.
   A trigger `on_auth_user_created_check` recusa e-mails temporários (Yopmail, 10minutemail...) antes de a conta existir.
2. O Supabase envia o e-mail **Confirm signup**. Até abrir o link a conta não entra e não tem escola.
3. Ao abrir o link, a app chama `public.complete_registration()`, que **só com e-mail confirmado** cria a escola (30 dias de teste),
   o administrador fundador e o registo de aceitação dos termos. Repetir a chamada não duplica nada.
4. A app termina a sessão e mostra a **caixa verde "Escola criada com sucesso!"** com o botão **Iniciar sessão** (o e-mail já vem preenchido).
   Link expirado ou já usado: volta ao início de sessão com a explicação.
5. Se a página fechar antes de concluir, o primeiro início de sessão chama a mesma função e conclui o registo.

## O que tem de fazer no Supabase
1. Aplicar a migração `0046_registo_nativo.sql` (SQL Editor ou `supabase db push`). Remove a tabela `pending_registrations` e as Edge Functions de registo (pode apagar `register-institution` e `complete-registration` do painel).
2. **Authentication → Sign In / Providers → Email**: **Confirm email** LIGADO e **Allow new users to sign up** LIGADO.
3. **Authentication → Email Templates → Confirm signup**: cole `supabase/templates/confirmacao.html` (o conteúdo do antigo `invite.html`, agora no template certo; o "Invite user" deixa de ser usado).
4. **Authentication → URL Configuration**: Site URL = endereço da app; em Redirect URLs `https://a-sua-app/`.
5. **Authentication → Attack Protection**: captcha (Turnstile) ligado, como já está para o login.
6. Produção: SMTP próprio (Authentication → SMTP Settings); o servidor de testes do Supabase tem limites muito baixos.
7. Opcional: `select public.purge_unconfirmed_signups(7);` apaga contas de registo nunca confirmadas há mais de 7 dias (agendada por pg_cron se a extensão existir).

## Bloquear mais domínios temporários
`insert into public.disposable_email_domains(domain) values ('exemplo.com');` (minúsculas; bloqueia também os subdomínios).

## Notas
- A fotografia escolhida no formulário não é guardada no registo; pode ser definida no perfil depois.
- A palavra-passe fica só no hash do Auth. Os dados da escola saem de `user_metadata` assim que a escola é criada.
- Contas sem perfil não acedem a dados (RLS). Quem abrir o link noutro dispositivo também conclui o registo.
