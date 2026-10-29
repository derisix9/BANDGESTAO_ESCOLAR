# Plano único do grupo, painel «Escolher escola» e correções de filiais

## O que mudou
1. **Plano único (mãe + filiais)** — migração `0025_group_plan_overview.sql` (também em `Bandmed-Admin/migrations`).
   Alunos, utilizadores e armazenamento de todas as escolas do grupo somam-se (ex.: 250 na mãe + 100 na filial = 350).
   O limite é o do plano da escola mãe e é imposto no servidor sobre o total. «Plano e Subscrição» e a ficha do Admin Master
   mostram o total e o detalhe por escola.
2. **Painel «Escolher escola»** (`SchoolPickerScreen.tsx`) redesenhado como o Dashboard do Bandmed:
   cartões iguais aos do Dashboard (alunos, docentes, assiduidade, cobrança, saldo, despesas) com valores gerais e filtro
   por escola (geral / só a mãe / só as filiais / cada escola), mais cartões de ocupação do plano
   (alunos, utilizadores, armazenamento) e tabela «Ocupação por escola».
3. **Admin Master**: cartões KPI e cabeçalho com o mesmo design; lista de escolas e ficha com os totais do grupo.
4. **Correções (causa dos teus problemas)**
   - `shardBackendSupabase.ts` usava sempre a escola do perfil (a mãe). Por isso alunos/registos criados numa filial iam
     para o sítio errado e o painel não os contava. Agora usa a escola ativa.
   - `db.ts`/`cloud.ts`: a lista de utilizadores só aceita contas da escola ativa (acabou a mistura mãe ↔ filial).
   - `server/backupsHttp.ts` e `server/notify.ts` passaram a usar a escola ativa do administrador.

## Como aplicar
```bash
supabase db push                                   # aplica 0025
supabase functions deploy create-user delete-user school-backups
```
**Importante:** se a função `create-user` publicada for anterior à 0024, cria sempre as contas na mãe — é isso que faz
os logins «apontarem para a mãe». Volta a publicá-la. Utilizadores já criados na escola errada têm de ser recriados
(o `institution_id` de um perfil é imutável).

---
## Correção: utilizadores criados na filial a apontar para a mãe

**Causa:** o ficheiro `supabase/functions/create-user/create-user-painel.ts` (o que se cola no editor do painel do Supabase) e o `delete-user-painel.ts`
continuavam na versão anterior à migração 0024 e gravavam sempre `profiles.institution_id` = escola mãe. O cliente mostrava a conta na filial só porque a
adicionava à lista local; ao recarregar, ela só existe na mãe, e o login dela aponta para a mãe.

**Alterações**
- `create-user-painel.ts` e `delete-user-painel.ts`: passam a usar `resolve_institution` (escola ativa). `create-user` devolve agora `{ id, institutionId }`.
- `src/services/cloud.ts` (`createAccountViaServer`): confirma que a conta ficou na escola ativa; se não (ou se a função publicada é antiga), apaga a conta e mostra uma mensagem clara em vez de criar na escola errada.
- `src/services/db.ts`: passa a escola ativa para essa verificação.
- `supabase/REPARAR_UTILIZADORES_FILIAL.sql`: move para a filial as contas já criadas na mãe, sem as recriar.

**Publicar (obrigatório)** — se colar no painel, use o conteúdo de `create-user-painel.ts` e de `delete-user-painel.ts`:
    supabase functions deploy create-user delete-user school-backups

---
## Painel «Escolher escola» (cartões) e Admin Master com o estilo do Bandmed
- `SchoolPickerScreen.tsx`: cartões de entrada na escola reduzidos (~80 px), no estilo `kpi-card` do Dashboard (mãe azul, filiais violeta), numa só grelha.
- Admin Master: sidebar com grupos expansíveis (mesmas classes, cor `#12498A`), cabeçalho azul com pesquisa de escolas, ecrã inteiro, utilizador e sair;
  cabeçalho de página (`PageHeader`), botões de ação em ícone (`ActionBtn`: abrir, editar, bloquear/desbloquear, confirmar/anular),
  tabelas com cabeçalho azul e linhas alternadas, cards `rounded-2xl`, botões `#2563EB`, fonte Inter/Plus Jakarta e ícones Material Symbols.
  Ficheiros: `src/App.tsx`, `src/components/BandmedUi.tsx`, `src/styles/bandmed-ui.css`, `src/components/ui/{table,card,button}.tsx`.

- Modo escuro no Admin Master: botão lua/sol no cabeçalho (`src/lib/colorMode.ts`, regras em `src/styles/bandmed-ui.css`). Mesma chave que o Bandmed (`bandmed:color-mode`).

- Painel «Escolher escola»: removidos os cartões de entrada; a tabela «Escolas do grupo» tem cabeçalho azul e botão «Entrar» por linha.

- Migração `0026_group_overview_logo.sql`: o resumo do grupo inclui o logótipo de cada escola. Tabela «Escolas do grupo» com coluna Logo (iniciais se não houver imagem) e nota sobre alunos registados vs. alunos no plano.

- Painel «Escolher escola»: botões Voltar/Sair com cores fixas (sem perder o texto ao passar o rato), botão de ação da tabela só com ícone, linha «Total do plano» legível (claro e escuro).

- Carregamento: `Spinner` passa a 12 barras estilo iOS no azul da barra lateral (#12498A; claro no modo escuro; `text-white` nos botões azuis). Vale para as 17 utilizações.
- Sucesso: novo `SuccessCheck` (quadrado verde que aparece com ressalto + visto que se desenha com reflexo azul) usado em `OperationStatusModal`. Animações em `src/index.css`.

---
## Página principal pública (site)
- `src/views/LandingView.tsx` + `src/styles/landing.css`: cabeçalho azul com Módulos, Recursos, Planos e preços, Contactos, modo escuro e **Entrar**; hero; módulos (Escolar disponível, Hospitalar e outros «em breve»); recursos; planos; contactos com formulário (WhatsApp/e-mail); rodapé.
- **Planos e preços** vêm da base de dados: migração `0027_public_plans.sql` cria `public.public_plans()` (acessível sem login, só campos comerciais dos planos ativos). Aplicar com `supabase db push`.
- **Editar contactos, módulos e recursos:** `src/config/landing.ts` (os contactos atuais são marcadores: substituir pelos reais).
- `src/App.tsx`: visitantes sem sessão veem a página; «Entrar» abre o login (`?entrar=1`); botão «Página inicial» no login; a app instalada (PWA) abre direto no login.
