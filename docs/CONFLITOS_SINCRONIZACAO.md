# Conflitos de edição na sincronização

## O problema
Uma escola com cortes de energia e de rede trabalha offline durante horas. Entretanto outra pessoa pode ter gravado
o **mesmo campo do mesmo registo** (por exemplo, o telefone de um aluno). Antes, ao sincronizar, a versão de quem
estava offline passava por cima da outra em silêncio.

## Como funciona agora
O envio faz-se por campo. Cada campo editado leva uma «impressão» (hash) do valor que o utilizador viu quando
começou a editar. No envio compara-se com o valor actual no servidor:

| Servidor… | Resultado |
|---|---|
| igual ao que o utilizador viu | ninguém mexeu: envia |
| já igual ao que o utilizador escreveu | convergiu: nada a fazer |
| diferente de ambos | **conflito**: o campo **não** é enviado |

- Campos diferentes do mesmo registo nunca colidem: só o campo em conflito fica de fora, o resto segue.
- O conflito aparece numa faixa de aviso («N alterações suas entraram em conflito…») com o botão **Resolver**.
  O ecrã mostra, por campo, a versão do utilizador e a do servidor, e permite **Manter a minha** ou **Usar a do servidor**
  (também em lote). Cada decisão fica no registo de auditoria.
- Enquanto há conflitos por resolver, a edição local fica protegida: não é substituída por actualizações do servidor.
- «Manter a minha» volta a enviar já, desta vez sem verificação para esse campo.
- O conflito de versão técnico (duas gravações em simultâneo) continua a ser repetido automaticamente, mas agora a
  verificação do campo repete-se com o valor novo.

## Sobreviver a recarregar a app
As impressões guardam-se no aparelho (`escola_edit_bases_<escola>`, apenas hashes: sem nomes nem dados pessoais) até o envio
ter sucesso. Assim, se a app for fechada e reaberta offline com edições por enviar, o conflito continua detectável.
A impressão de um campo é esquecida quando o utilizador desfaz a edição (evita falsos conflitos mais tarde).
O limite é de 5000 campos pendentes por aparelho.

## Limites conhecidos
- Só trata **campos de um registo existente**. Não trata: registo apagado por outra pessoa enquanto este utilizador o
  editava (a edição é descartada, como antes) e dois registos novos com o mesmo id.
- Edições feitas **antes desta versão** e ainda por enviar não têm impressão: mantêm o comportamento anterior (a última
  gravação ganha).
- A lista de conflitos em ecrã vive em memória. Se a app for recarregada antes de decidir, o conflito é detectado de
  novo no envio seguinte (a edição local mantém-se).
- Campos compostos (listas, objectos) comparam-se por inteiro: uma mudança em qualquer parte conta como conflito do campo todo.
- Dados que não vivem em registos individuais (definições da escola, caderneta guardada como documento) não passam por
  esta verificação.

## Testes
`tests/syncConflicts.test.ts` (lógica), `tests/syncConflictsPush.test.ts` (envio contra um Supabase simulado com
bloqueio por versão), `tests/syncConflictsDb.test.ts` (orquestração, incluindo recarregar a app) e
`tests/syncConflictsModal.test.ts` (ecrã).
