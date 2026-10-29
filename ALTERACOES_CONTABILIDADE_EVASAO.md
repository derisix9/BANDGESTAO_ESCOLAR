# Alterações — Contabilidade e Evasão Escolar (v3)

## Evasão escolar
- Limites de risco configuráveis (painel «Limites de risco» no ecrã Evasão Escolar), com validação e «Repor padrão».
  Padrões iguais aos anteriores: presença 70/80/90 %, faltas 5/10, média 8/10, pontos 3/6, 30 dias.
- Gravados em `settings.dropoutThresholds`. Ficheiros: `src/utils/dropoutRisk.ts`, `src/views/EvasaoEscolarView.tsx`.

## Contabilidade
- Plano de contas corrigido segundo o PGC angolano (Decreto 82/01): Caixa 45, Depósitos à ordem 43,
  Prestações de serviços 62, Custos com o pessoal 72, FST 75.2, Amortizações do exercício 73.
  Contas 51 (Capital) e 88 (Resultado líquido) marcadas «A confirmar». O contabilista deve validar o plano todo.
- Lançamentos manuais antigos (sem `chartVersion`) são convertidos ao ler; os novos gravam `chartVersion: 2`.
- Regime de acréscimo (opção): Clientes 31, Fornecedores 32, Pessoal 36. Salários a líquido (INSS patronal/retenções não separados).
- Amortizações mensais (quotas constantes), vida útil por categoria editável (estimativas, não taxas oficiais).
- Balanço, Fecho do Ano (apuramento contra a conta 88; ano fechado recusa lançamentos manuais até ser reaberto;
  aviso de «fecho desactualizado») e exportação Excel (balancete, lançamentos, balanço).
- Opções guardadas em `settings.accountingOptions`.
- Ficheiros: `src/utils/accounting.ts`, `src/utils/accountingExport.ts` (novo), `src/views/ContabilidadeView.tsx`,
  `src/services/db.ts` (`saveJournalEntry`), `src/types/index.ts`.

## Testes
- `tests/accounting.test.ts`, `tests/accountingExport.test.ts` (novo), `tests/dropoutRisk.test.ts`.

## Ainda por fazer (consigo)
1. `npm install`, `npm test`, `tsc` e abrir Contabilidade e Evasão no navegador.
2. Aplicar a migração `0037_evasao_e_contabilidade.sql` no Supabase.
3. Contabilista confirmar o plano de contas e as vidas úteis.

## Correcções posteriores
- Contabilidade: as impressões das abas saíam em branco (o CSS global só mostra `.printable-*`); o conteúdo passou a estar
  num `printable-page`, com cabeçalho de impressão (escola, aba, período, regime). Isto também corrige o cabeçalho
  «congelado» das tabelas, que ficava a meio das linhas.
- Reuniões: a lista de presença de reuniões **realizadas** ganhou a coluna «Situação» (Esteve presente / Faltou / Sem registo)
  e assinatura manuscrita digital automática para quem esteve presente. Agendadas ficam como antes (em branco).

## Ajustes seguintes
- Assinatura digital das reuniões: sem inclinação, primeiro e último nome com inicial maiúscula.
- Logótipo da escola na lista de presença das reuniões e nas impressões da Contabilidade.
- Relatórios → Listagem: novas listagens «Contabilidade — Balancete de Verificação», «Contabilidade — Lançamentos»,
  «Evasão Escolar — Alunos em Risco» e «Evasão Escolar — Acompanhamentos» (impressão e Excel).
