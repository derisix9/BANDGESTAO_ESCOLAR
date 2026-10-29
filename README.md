# BandMed — Sistema Integrado de Gestão Escolar (EduGest)

Bem-vindo ao **BandMed**, uma plataforma de gestão escolar para escolas angolanas, desenvolvida com **React 19, TypeScript, Vite e Tailwind CSS** no frontend (Bootstrap 5 só por CDN, para alguns estilos e ícones) e **Supabase** (Postgres com RLS, Auth com 2FA, Realtime, Storage e Edge Functions). Funciona também como PWA (instalável, abre sem rede).

Este manual foi escrito passo a passo de forma simples e clara para quem **não é programador**.

---

## 🎨 Identidade Visual & Design System

- **Cor Principal:** Azul Escuro Institucional (`#0B1F3A`)
- **Cor Secundária / Destaque:** Vermelho Escuro (`#7A0C0C`)
- **Tipografia:** Google Fonts Plus Jakarta Sans (Texto corrente) e Syne (Títulos executivos)
- **Componentes:** Tailwind CSS e componentes próprios (menu, cartões, tabelas, modais, formulários, avisos); Bootstrap 5 e Bootstrap Icons por CDN
- **Moeda Padrão:** Kwanza Angolano (**Kz**)

---

## 👥 Perfis de Acesso

O sistema tem **8 perfis fixos**: administrador, direcção pedagógica, secretaria, professor, financeiro, funcionário, aluno e encarregado de educação. Quem precisa de outro papel (psicólogo, bibliotecário, inspector…) recebe **acesso personalizado** por utilizador, com as permissões que o administrador activar na matriz de permissões (Configurações).

**Não existem contas nem palavras-passe por defeito.** O administrador de cada escola é criado no registo
(registo livre pelo **Supabase Auth nativo**: `signUp` com captcha e **verificação de e-mail**; a escola só é criada ao abrir o link, em `complete_registration()` — ver `docs/REGISTO_COM_EMAIL.md`) e cria as restantes contas na app. Para testes,
crie utilizadores de demonstração no seu projecto Supabase de desenvolvimento, nunca em produção.

| Perfil | Âmbito principal |
| :--- | :--- |
| Administrador | Tudo na sua escola (e nas filiais), incluindo Configurações, utilizadores e backups |
| Direcção pedagógica | Supervisão pedagógica, homologação e trancamento de pautas, gestão do corpo docente |
| Secretaria | Alunos, matrículas, documentos académicos, processos |
| Professor | Turmas e disciplinas atribuídas: assiduidade, notas, sumários |
| Financeiro | Propinas, tesouraria, despesas, folha de pagamento |
| Funcionário | Pessoal não docente; sem permissões de escrita por omissão, o administrador activa as que forem necessárias |
| Aluno / Encarregado | Só os próprios dados (e os dos educandos vinculados) |

---

## 🚀 Como Executar o Projeto (Guia Rápido para Não Programadores)

### Pré-requisitos
Apenas precisa de ter o **Node.js** (versão 18 ou superior) instalado no seu computador.
Pode descarregá-lo gratuitamente em [nodejs.org](https://nodejs.org/).

### Passo 1: Instalar Dependências
Abra o seu terminal (ou Linha de Comandos no Windows) na pasta do projeto e execute:
```bash
npm install
```

### Passo 2: Configurar o Ficheiro de Variáveis (.env)
Copie o ficheiro de exemplo `.env.example` para `.env`:
```bash
cp .env.example .env
```
Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (painel do Supabase → Project Settings → API). Opcionais: `VITE_TURNSTILE_SITE_KEY` (captcha) e `VITE_APP_VERSION` (versão que aparece nos relatórios de erro). A chave `service_role` **nunca** vai para o `.env` do site.
Sem estas variáveis a aplicação abre em modo local, sem sessão na nuvem.

Base de dados: aplique as migrações de `supabase/migrations/` por ordem (`supabase db push`) e publique as Edge Functions (`supabase functions deploy create-user delete-user`). O registo de escolas usa o Supabase Auth nativo, sem Edge Functions (ver `docs/REGISTO_COM_EMAIL.md`).

### Passo 3: Iniciar a Aplicação
Execute o seguinte comando no terminal:
```bash
npm run dev
```
O sistema arrancará no endereço:
👉 **`http://localhost:3000`** (ou porta indicada no terminal). Abra esse link no seu navegador de internet (Google Chrome, Firefox, Edge, Safari).

---

## 🗄️ Exportação MySQL (.sql) — só para consulta e migração

A aplicação funciona sobre **Supabase (Postgres)**; a base de produção **não** é MySQL. O ficheiro `database/gestao_escolar.sql` é um **esquema reduzido de referência** (14 tabelas básicas: utilizadores, alunos, professores, turmas, assiduidade, exames, notas, propinas, avisos, biblioteca, definições) para quem quer estudar o modelo ou importar dados para MariaDB/phpMyAdmin. **Não cobre** os módulos mais recentes (folha de pagamento, internato, saúde, ensino superior, filiais…), que vivem nas colecções descritas mais abaixo (`records`, 73 colecções).

Para o importar: crie uma base `gestao_escolar` (`utf8mb4_unicode_ci`) e use *Importar* no phpMyAdmin. Para uma cópia completa dos dados de uma escola use o **backup por escola** (secção abaixo), não este ficheiro.

---

## 📦 Módulos do Sistema Implementados

1. **Dashboard Principal:** Indicadores em tempo real, gráfico SVG de assiduidade por ciclo, execução orçamental de propinas, mural de avisos e agenda de eventos.
2. **Alunos & Matrículas:** Listagem oficial, pesquisa avançada por turma e estado financeiro, emissão de boletins, ficha do aluno e modal de nova matrícula. A **renovação anual em lote** (botão em Matrículas) propõe a matrícula do ano seguinte pelo resultado do conselho de turma: ver `docs/RENOVACAO_ANUAL_MATRICULA.md`.
3. **Boletim de Notas Oficial:** Certificado timbrado com cálculo ponderado (MAC 30%, NPP 30%, NPT 40%), apreciação qualitativa, carimbo notarial e impressão/PDF.
4. **Professores:** Registo com número de agente, habilitações, alocação de carga horária e contacto telefónico.
5. **Turmas & Horários:** Lotação de salas, turnos, diretores de turma e grelha semanal de aulas (Segunda a Sexta).
6. **Assiduidade Diária:** Caderneta oficial com botões rápidos (P - Presente, FJ - Justificada, FI - Injustificada, A - Atraso), sumário de aula e rubrica digital docente.
7. **Exames & Pautas:** Lançamento de notas com recálculo automático instantâneo da Média Trimestral (MT) e homologação pelo conselho pedagógico.
8. **Propinas & Tesouraria:** Facturas e recibos em Kwanzas (**Kz**), controlo de mora, cálculo de juros e referências de pagamento via ProxyPay (ver `docs/PAGAMENTOS_REFERENCIA.md`).
9. **Mural de Comunicados & Biblioteca:** Publicação de circulares com diferentes níveis de urgência e catálogo de obras bibliográficas.
10. **Relatórios Oficiais:** Mapas trimestrais de aproveitamento, balancete financeiro e mapas estatísticos com exportação CSV/Excel.
11. **Configurações:** Dados da instituição, Alvará do MED Angola, alteração do ano letivo e restauro de dados de fábrica.

---

## 🆕 Processos académicos e Financeiro avançado

**Processos académicos** (menu Secretaria e Gestão pedagógica)
- *Documentos Académicos*: certificado, declarações (com e sem notas), diploma, cartão de estudante e histórico, com numeração por tipo e ano (`CERT-2026-000012`). Um documento anulado exige motivo e o número fica reservado. Cada documento tem um código de verificação (conferência na secretaria; não é assinatura digital).
- *Transferências & Equivalências*: transferência de entrada/saída, equivalência de disciplinas e anulação de matrícula. Cada processo guarda uma cópia do histórico do aluno à data.
- *Conselho de Turma*: proposta automática (aprovado / reprovado / condicional) a partir das médias finais da pauta; o conselho decide e tem de justificar qualquer decisão diferente da proposta. Ao homologar, abrem-se os processos de recuperação.
- *Recuperação & Exames de Recurso*: a recuperação vem antes do exame de recurso, que só abre se a recuperação continuar negativa.

**Financeiro** (menu Tesouraria)
- *Planos, Bolsas & Descontos*: prestações (a soma é sempre igual ao total), regras de desconto (irmãos, pronto pagamento, mérito) e simulador.
- *Conciliação Bancária*: importa extratos em CSV (`data; descrição; valor; referência`) e sugere que linha corresponde a que fatura. Só liquida a fatura depois de confirmação manual.
- *Despesas & Fluxo de Caixa*: despesas, contas a pagar (com atrasos) e caixa mensal.

**Limites conhecidos**
- Não emite documentos fiscais válidos para a AGT nem gera o ficheiro SAF-T. Isso exige software certificado pela AGT.
- Não há ligação direta ao banco nem à EMIS/Multicaixa; a conciliação lê CSV.
- A taxa de faltas entra na proposta do conselho: faltas injustificadas (FI) / aulas registadas nas cadernetas. Acima do limite (Configurações → Regras de Notas, por defeito 25%) e com pelo menos 20 aulas registadas, a proposta é «reprovado»; a partir de 80% do limite só avisa. O conselho pode decidir diferente, com justificação.
- A folha de pagamento entra no fluxo de caixa: o salário líquido pago sai no mês do pagamento; o INSS (trabalhador + patronal) e o IRT retido geram contas a pagar («Gerar encargos INSS/IRT» em Despesas & Fluxo de Caixa) e só saem do fluxo quando marcados como pagos. Os prazos de entrega são de referência e a tabela de IRT é editável: confirme ambos com o contabilista. Ver `docs/FOLHA_NO_FLUXO_DE_CAIXA.md`.
- Não há integração oficial com o MED (a exportação só valida a consistência interna) e os documentos académicos continuam a precisar de carimbo e assinatura físicos (o código de verificação e o QR não são assinatura digital).
- A protecção de dados e a operação em produção têm uma lista própria de pontos a validar antes de entrar em produção: `docs/CHECKLIST_LEGAL_OPERACIONAL.md` e `docs/PLANO_RESPOSTA_INCIDENTES.md`.
- Depois de `npm install`: `npm run lint && npm test && npm run check:acl`. Estas colecções novas estão em `src/config/dataShards.json`; depois de as alterar corra `npm run gen:acl` e aplique a migração.

---

## 📄 Pautas: exportação Excel e colunas visíveis

- **Excel igual ao modelo corrigido** (`src/utils/pautaExcelExport.ts`): Arial Narrow 12 (legenda a 10), título centrado sobre a tabela,
  insígnia centrada por cima do título (50 px de altura, proporção original), logótipo do EJA depois da legenda, alturas de linha do modelo.
  As imagens usam âncoras nativas em EMU (o ExcelJS interpreta posições fracionárias com larguras fixas, o que as desalinhava).
- **Mini-Pauta**: MT1, MT2, MT3 e MFD são colunas fixas (não se desmarcam).
- **Pauta**: só MT1, MT2 e MT3 se desmarcam, e isso apenas oculta a coluna (não altera notas); MFD e MF ficam sempre.
  Com as três MT ocultas, o nome da disciplina sai completo na impressão e no Excel; com alguma MT visível sai a sigla.
  As regras vivem em `src/utils/pautaView.ts` (testes em `tests/pautaView.test.ts` e `tests/pautaExcelExport.test.ts`).

## 🔒 Segurança e Dados Locais

- **Gravação imediata:** as alterações feitas no ecrã (matrículas, faltas, notas, pagamentos) são guardadas no aparelho e sincronizadas com o Supabase; sem rede ficam em fila e seguem quando a ligação volta (ver *Conflitos de edição offline*).
- **Segurança por linha (RLS)** e permissões por colecção e por campo: ver «Fundações» abaixo e `docs/DADOS_NO_DISPOSITIVO_E_PALAVRAS_PASSE.md`.
- **Monitorização de erros:** erros do browser e falhas de sincronização repetidas são enviados (sem dados pessoais) para a equipa da plataforma: `docs/MONITORIZACAO_ERROS.md`.

---

## 🧱 Fundações: dados por registo, testes e funcionamento sem internet

### Dados por registo (tabela `records`) e Projeções por Utilizador (`user_projections`)
Todas as 73 colecções do sistema (alunos, matrículas, turmas, professores, funcionários,
faturas, folha de pagamento, homologações, assiduidade, fichas médicas, incidentes disciplinares,
recolha de alunos, vínculos de encarregados, admissões, férias, avaliações docentes, refeitório,
banco de questões, exames, pedidos de titulares de dados/RGPD, chat interno, departamentos,
fornecedores, planos curriculares, atribuição docente, atividades extracurriculares, património,
viaturas, rotas, reuniões, biblioteca e outros) já **não** vivem no documento único da escola.

Cada registo é uma linha da tabela `records` (`institution_id`, `collection`, `id`):
- só o que mudou é enviado (diferença por campo), não a base inteira;
- a segurança por linha (RLS) e a tabela `collection_acl` decidem por colecção (e por campo) quem lê e escreve, incluindo o acesso personalizado
  de `user_access`;
- **Privacidade total para Alunos e Encarregados:** Alunos e Encarregados **não** têm leitura nas colecções globais da escola. A aplicação gera e sincroniza projeções individuais na tabela `user_projections` (instituição + utilizador), onde cada utilizador apenas lê e recebe em tempo real os seus próprios dados e os dos seus educandos vinculados;
- **Carregamento por Ano Lectivo:** As colecções ligadas ao ano lectivo (matrículas, turmas, faturas, assiduidade, pautas, admissões, etc.) têm índice por (`institution_id`, `academic_year`) (migração 0008) e são carregadas sob demanda para o Ano Lectivo Activo, optimizando velocidade e tráfego; ao alternar o ano letivo na barra superior, os registos desse ano são carregados automaticamente;
- a lógica está em `src/utils/shardSync.ts` e `src/utils/userProjections.ts` (lógica pura e 100% testada) e a sincronização em `src/services/db.ts` e `src/services/cloud.ts`.

**Fonte única de verdade:** `src/config/dataShards.json`. O cliente e as permissões do servidor leem o mesmo ficheiro.
Depois de o alterar (por exemplo, para acrescentar uma colecção):

```bash
npm run gen:acl        # regenera supabase/migrations/0005_collection_acl.sql
npm run check:acl      # falha se a migração estiver desactualizada
npm test               # confirma o cliente
npm run test:db        # corre as migrações e os testes de segurança (RLS) num Postgres local
```

**Colocar em produção (por esta ordem):**
1. Aplicar as migrações (`supabase db push`) e publicar as Edge Functions.
2. Definir os segredos das funções (`ALLOWED_ORIGIN`, etc.) e as variáveis `VITE_SUPABASE_*` do site.
3. Publicar a aplicação.
4. Migrar os dados existentes (uma vez por escola) com `scripts/import-to-supabase.mjs` a partir da exportação JSON antiga.
5. Utilizadores existentes: cada um usa **"Recuperar palavra-passe"** uma vez (as contas antigas não trazem a palavra-passe).

### Testes
`npm test` (Vitest) corre os testes de `tests/`: sincronização por registo e permissões, permissões por colecção do cliente, médias e situação final de pautas, folha de pagamento (INSS/IRT) e propinas (multas e descontos).

### Funcionamento sem internet (PWA)
A aplicação é instalável (`public/manifest.webmanifest`) e o `public/sw.js` guarda o ecrã da aplicação para abrir sem
rede. Os dados já ficam no IndexedDB e sincronizam quando a ligação volta. O service worker só é registado em produção
(`npm run build`). Para forçar todos os dispositivos a renovar a cache, mude `VERSION` em `public/sw.js`.

## Tradução automática (Inglês)

O seletor **Idioma** (menu lateral) tem Português e English. Em English, `src/i18n/autoTranslate.ts` traduz o ecrã inteiro
(formulários, tabelas, botões, modais, tooltips, gráficos, `alert/confirm/prompt`) como o "Traduzir página" do Chrome.
Os dados da base de dados (nomes, turmas, moradas…) e os documentos oficiais do Estúdio nunca são traduzidos; para excluir
outra zona use `translate="no"`, `data-no-translate` ou a classe `notranslate`.
Ordem: dicionário local → cache (localStorage) → `/api/translate` (Vercel). Opcional: defina `GOOGLE_TRANSLATE_API_KEY`
no Vercel para usar a API oficial do Google Cloud Translation (sem a chave usa o endpoint público, sem garantia de serviço).

## 💾 Backup e restauro por escola (um ficheiro .json)

O administrador **baixa** um ficheiro com todos os dados da sua escola e **carrega** o mesmo ficheiro para restaurar (recuperar dados ou voltar a uma versão anterior). Tudo corre no Supabase: sem Storage, cron, Edge Function nem servidor externo.

- **Base de dados:** `supabase/migrations/0012_school_backup_file.sql` — `school_backup_export()` e `school_backup_restore(ficheiro, 'RESTAURAR')`, atómicas (tudo ou nada).
- **App:** Configurações → *Segurança & Backups* → "Baixar backup" / "Carregar backup". Antes de restaurar, o estado actual é descarregado automaticamente (para desfazer); depois a cache local é limpa.
- **Testes:** `npm test`, `npm run test:db`. Instalação e detalhes em `docs/BACKUPS_SUPABASE.md`.
- **Cópia diária para a nuvem da escola** (Google Drive, Backblaze B2, Wasabi, R2, S3…): Configurações → *Segurança & Backups* → secção 3. Instalação (migração `0018`, função `school-backups`, segredos, agendador, Google OAuth) em `docs/BACKUP_EXTERNO.md`.

## 🖼️ Imagem de fundo das páginas
Coloque `public/page-bg-light.png|jpg` (claro) e `public/page-bg-dark.png|jpg` (escuro). Sem ficheiro, o modo fica como estava. Ver `docs/FUNDO_DAS_PAGINAS.md`.

## Registo livre, plano e captcha
- Migrações `0013_plan_trial.sql` e `0014_paid_until.sql` (teste de 30 dias, `pendente`, `pago`, `paid_until`).
- Captcha Cloudflare Turnstile, verificado pelo **próprio Supabase Auth** (login, recuperação de palavra-passe e reautenticação): site key em `VITE_TURNSTILE_SITE_KEY` (Vercel) e o secret em Supabase → Authentication → Attack Protection. Ver `docs/CAPTCHA_SUPABASE.md`.
  O registo de escolas (`signUp`) também passa pelo captcha do Auth.
  Não use as chaves de teste da Cloudflare (`1x000…`) em produção: em build de produção a app recusa-se a mostrar o captcha com elas.

## Conflitos de edição offline
Se duas pessoas (uma offline) mudarem o mesmo campo, a app não sobrescreve nenhuma: mostra um aviso com o botão «Resolver» e o utilizador escolhe a versão que fica. Ver `docs/CONFLITOS_SINCRONIZACAO.md`.
