# Excel sem o `xlsx` (SheetJS)

O `xlsx@0.18.5` tem falhas conhecidas (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) e as versões corrigidas
(0.20.x) já não saem no npm. A app lê Excel de utilizadores (pautas, extractos bancários, backups), por isso foi retirado.
Tudo passa agora pelo `exceljs` (que o projecto já usava nas exportações) através de **`src/utils/xlsxSafe.ts`**.

## O que o `xlsxSafe.ts` garante
- Limites antes de devolver dados: 15 MB por ficheiro (100 MB nos backups), 50 folhas, 100 000 linhas, 256 colunas.
- Só devolve valores simples (texto, número, booleano, data). Fórmulas dão o último resultado; texto rico e hiperligações dão texto.
- Ao escrever, texto que começa por `=`, `+` ou `@` continua a ser texto (não vira fórmula).
- NaN/Infinity/undefined não estragam o ficheiro; nomes de folha são limpos (≤ 31 caracteres, sem `\ / * ? : [ ]`, únicos).

## Mudanças de comportamento
- **Extractos bancários:** deixam de ser lidos `.xls` e `.ods`. A app avisa: guardar como `.xlsx` ou CSV.
- **Pautas:** só `.xlsx`, `.csv` e `.txt` (já era assim).
- `downloadTemplateForClass` e `downloadValidationReport` passaram a assíncronas (os ecrãs usam `void`).
- Os testes da lógica de backup usam `tests/xlsxFake.ts` (sem exceljs); `tests/xlsxSafe.test.ts` usa o exceljs a sério.

## Passos para fechar
1. `npm uninstall xlsx` (actualiza `package.json` e `package-lock.json`; faça commit dos dois).
2. `npm run lint && npm test`.
3. Teste à mão: importar uma pauta .xlsx, importar um extracto .xlsx, descarregar o modelo de pauta e o relatório de validação,
   exportar um backup em Excel e restaurá-lo na pré-visualização, e gerar o ZIP "antes de eliminar".

## CI
`.github/workflows/ci.yml` tem agora o trabalho `security`: `npm audit --omit=dev --audit-level=high` e `gitleaks` (segredos, com histórico completo).
Se o audit falhar por outra dependência, veja `npm audit` e actualize; só baixe o nível como último recurso.
`.github/dependabot.yml` abre PRs semanais de actualização.
