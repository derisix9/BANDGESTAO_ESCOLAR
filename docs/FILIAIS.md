# Gestão de filiais (migração 0024)

## Como funciona
- **Admin Master** (app `bandmed-admin`) → Escolas → ficha da escola mãe → **Filiais → Nova filial**.
  Só ele cria filiais. A filial herda o plano da mãe (sincronizado por trigger) e fica sem administrador próprio.
- O **administrador da escola mãe é único** e passa a ter acesso total à mãe e a todas as filiais.
- Ao entrar, se existir mais de uma escola (mãe + filiais), aparece o **painel de escolha de escola**
  (`SchoolPickerScreen`). Quem só tem uma escola nunca o vê. Depois pode reabri-lo em **Trocar de escola** (barra superior).
- **Isolamento**: cada filial vê só os seus dados. O servidor guarda a escola ativa do admin em
  `profiles.active_institution_id`; `app.current_institution()` devolve essa escola, e todas as políticas RLS
  (já baseadas nessa função) passam a filtrar por ela. Um admin na filial A não lê nem grava na mãe nem na filial B.
- Contas criadas/eliminadas, e a cópia de segurança na nuvem, passam a ser da **escola ativa** (Edge Functions
  `create-user`, `delete-user`, `school-backups` usam `resolve_institution`).

## Instalar
1. `supabase db push` / correr `supabase/migrations/0024_filiais.sql` (a mesma está em `bandmed-admin/migrations/`).
2. Publicar de novo as Edge Functions `create-user`, `delete-user`, `school-backups` (app da escola)
   e `platform-admin` (app Admin Master).
3. `npm run test:db` corre também `supabase/tests/branches.test.sql`.

## Regras e limites
- Um só nível: uma filial não tem filiais; `parent_id` é imutável.
- Uma escola mãe com filiais não pode ser eliminada (eliminar primeiro as filiais).
- Suspender a mãe bloqueia também as filiais. Plano, tolerância e pagamentos são geridos só na mãe.
- Limites do plano (alunos, utilizadores, armazenamento) contam por escola, usando o plano da mãe.
- A troca de escola é por sessão de conta: se o admin tiver dois separadores abertos e trocar num, o outro
  deve ser recarregado (o servidor já está na nova escola).
