# Renovação anual de matrícula (em lote)

Matrículas → botão **RENOVAÇÃO ANUAL**. Pensado para Janeiro: em vez de escolher alunos e turma à mão,
o sistema parte dos **conselhos de turma homologados** do ano anterior e propõe a matrícula de cada aluno.
Mostra tudo antes de gravar.

## Regras (src/utils/enrollmentRenewal.ts)

| Situação no ano anterior | Resultado |
|---|---|
| Aprovado | Matricula na classe seguinte |
| Reprovado | Repete a mesma classe |
| Condicional | Só depois da recuperação: aprovado em tudo promove; reprovado em alguma repete; recuperação por concluir (ou sem processo registado) bloqueia |
| Aprovado na 13.ª classe | Conclui o ciclo: não se matricula |
| Transferido / suspenso | Não entra no plano |
| Já matriculado no ano novo | Aparece como «já renovado» e nunca é duplicado |

- **Turma de destino:** a do mesmo curso, preferindo a mesma secção e o mesmo turno; depois a que tiver vaga.
  A lotação (`maxCapacity`) é respeitada, contando as matrículas já gravadas. A secretaria pode trocar a turma por aluno.
- **Bloqueios:** conselho em falta ou por homologar, aluno fora do conselho, recuperação pendente, sem turma da classe
  seguinte no ano novo, turma cheia, classe sem Tabela Financeira (nunca se inventam valores).
- **Decisão manual:** nos alunos bloqueados por falta de conselho ou de recuperação, a secretaria pode escolher
  «Promove» ou «Repete». Fica assinalado como decisão manual e registado no registo de auditoria.
- **Dívidas:** faturas em mora do aluno. A escola escolhe entre **avisar** (por defeito) e **bloquear** a renovação.
  Bloquear é uma decisão da escola, por isso não é o padrão.
- **Valores e tipo:** a matrícula é criada pelo mesmo caminho da Nova Matrícula (Tabela Financeira, faturas de matrícula e
  propinas, tipo «renovação», desconto, isenção e responsável financeiro herdados da matrícula anterior). O resultado anterior fica em `previousResult`.

## Segurança da gravação

A gravação (`dbService.renewEnrollments`) **recalcula o plano com os dados do momento** e só matricula quem continua sem
bloqueios. Se alguém renovou o aluno entretanto, ou a turma encheu, o aluno vai para «não renovados» em vez de duplicar.
Grava em fatias de 10 com barra de progresso e pára se o limite do plano for atingido.

## Limites

- O «ano anterior» é calculado pelo formato `AAAA/AAAA` (2026/2027 → 2025/2026). Alunos sem matrícula nesse ano
  (reingresso, saltaram um ano) não entram; use a matrícula individual.
- Classes sem número («Iniciação», «Pré-escolar») não têm classe seguinte calculável.
- Só a 13.ª classe é tratada como fim de ciclo. Em cursos que terminam na 12.ª (ou 9.ª), o aluno aprovado aparece
  bloqueado «sem turma da classe seguinte»: ignore-o, ou crie a turma se for esse o caso.
- A matrícula do ano anterior **não** é marcada como «concluída». Ao matricular, o aluno passa a reflectir a nova turma
  (comportamento igual ao da Nova Matrícula individual): faça a renovação depois de fechar as notas do ano.
- A interface foi escrita e verificada sem browser: a lógica e a gravação têm testes (`tests/enrollmentRenewal.test.ts`);
  o ecrã não foi testado num browser real. Teste-o com dados de uma escola antes de Janeiro.
