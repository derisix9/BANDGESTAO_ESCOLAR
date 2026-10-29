# Validador MED + Exames Nacionais, Plano Individual e Internato

## Validador da exportação MED (`src/utils/medValidator.ts`)
Corre **antes** de exportar (Relatórios → Exportação) e mostra os problemas por escola, turma, aluno e docente, com descarga em CSV.
- **Erro** = dado em falta ou impossível (o ecrã pede confirmação para exportar mesmo assim). **Aviso** = suspeito mas possível.
- Confere: campos da escola, província/município/comuna contra a Lei 14/24, natureza; turno e lotação das turmas; alunos (nome, género,
  nascimento, idade impossível, distorção idade-classe, nº de processo e BI duplicados, sem turma); docentes (habilitações, nº de agente repetido);
  totais da folha 3 (aprovados + reprovados ≤ avaliados; avaliados ≤ matriculados).
- **Limite importante:** o MED não publica um esquema oficial do ficheiro nem uma API de submissão que eu tenha conseguido confirmar. O validador
  garante **consistência interna**, não aceitação pelo GEPE. Quando o Ministério fornecer o modelo oficial, acrescentam-se as regras em `validateMedData`.
- As regras de idade/classe (1.ª classe aos 6 anos) e o formato de BI/telefone são convenções comuns: confirme-as com a secretaria.

## Exames Nacionais (`exames_nacionais`)
Calendário (classe, disciplina, data, hora, sala), inscrição por classe com um clique (só alunos activos da classe, sem repetir) e resultados 0–20
(aprova com ≥ 10). Faltas não entram na taxa de aprovação. As classes sugeridas (6.ª, 9.ª, 12.ª, 13.ª) são só uma sugestão: confirme no calendário do MED.

## Plano Educativo Individual (`plano_individual`)
Plano por aluno com categoria, necessidades, apoios, adaptações, objectivos e revisões periódicas (a próxima revisão calcula-se sozinha; revisões em atraso
aparecem a vermelho). **Acesso restrito:** só `admin` e `director`. O sistema não tem perfil "psicólogo": para o dar a um psicólogo, crie-o (por exemplo como
`funcionario`) e ligue-lhe a secção *Plano Individual* em Configurações → Utilizadores (acesso personalizado). Alunos e encarregados nunca recebem estes dados.
A auditoria regista quem fez o quê, **sem o conteúdo** do plano.

## Internato (`internato`)
Quartos (género, camas, mensalidade), alojamento por cama (valida género, cama livre, aluno activo e já alojado) e **facturas mensais** em Tesouraria
(uma por aluno e mês, sem repetir; só para alojamentos activos). A descrição não contém "propina", por isso não conta como mês de propina pago.

## Instalação
1. `supabase db push` (migração `0040_exames_inclusao_internato.sql`; a `0005` foi regenerada com `npm run gen:acl`).
2. `npm run lint && npm test && npm run check:acl`.
