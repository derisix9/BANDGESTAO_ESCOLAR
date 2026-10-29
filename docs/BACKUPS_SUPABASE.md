# Backup e restauro por escola — um ficheiro, no próprio Supabase

O administrador da escola, em **Configurações → Segurança & Backups**:

- **Baixar backup** → escolha o **tipo de ficheiro** (JSON, XLSX, SQL ou CSV) e descarrega `bandmed_<escola>_<data>.<tipo>`.
- **Carregar backup** → escolha o mesmo tipo de ficheiro, seleccione-o, confirma com `RESTAURAR` e a escola passa a ter exactamente os dados do ficheiro (mais antigo = voltar atrás; mais recente = actualizar).

Antes de restaurar, a app descarrega sozinha o estado actual (`..._antes-do-restauro_...json`), para poder desfazer carregando esse ficheiro.

## Tipos de ficheiro
| Tipo | Como é | Restauro |
|---|---|---|
| JSON | objecto completo (recomendado) | directo |
| XLSX | folhas info/registos/documentos/prematricula/referencia; células longas partidas em partes | a app lê as folhas |
| CSV | um ficheiro plano (`section,collection,id,…,data`) | a app lê as linhas |
| SQL | INSERTs legíveis | a app só lê este formato estrito (nunca executa SQL) |
O tipo escolhido tem de coincidir com o do ficheiro. A cópia "antes do restauro" é sempre JSON.

## Instalação (uma vez)
Aplicar a migração `supabase/migrations/0012_school_backup_file.sql` (`supabase db push`, ou colar o ficheiro no SQL Editor e clicar Run). **Sem isto a app mostra 404 em `/rpc/school_backup_export`.** A migração termina com `notify pgrst, 'reload schema'`. Não há segredos, bucket, Edge Function nem agendador.

Se uma escola for grande e o restauro der "tempo esgotado", suba o limite do papel `authenticated` (por omissão 8 s no Supabase):
```sql
alter role authenticated set statement_timeout = '120s';
notify pgrst, 'reload config';
```

## O que o ficheiro leva
| Parte | Baixar | Restaurar |
|---|---|---|
| Registos (alunos, turmas, notas, matrículas…) | sim | **substitui** os da escola |
| Documentos da escola (definições, calendário, pautas, assiduidade) | sim | **substitui** |
| Pré-matrícula online (config., pedidos, estados, reclamações, anos) | sim | **substitui** |
| Facturas | sim | as existentes **ficam como estão**; só se recriam as que faltam |
| Pagamentos, documentos fiscais | sim (só referência) | **nunca** se tocam (imutáveis) |
| Auditoria | não | nunca se toca; o restauro acrescenta UMA entrada-resumo |
| Contas de utilizador, palavras-passe, acessos personalizados | não | não se tocam |

## Segurança
- Só o **administrador activo**; a escola vem sempre do perfil autenticado, nunca do ficheiro. Um ficheiro de outra escola é recusado.
- Uma só transacção: se o ficheiro estiver corrompido, a escola fica exactamente como estava.
- O ficheiro **não é cifrado** e contém dados pessoais: guarde-o em local seguro (não em e-mail nem em pastas partilhadas).
- Colecções desconhecidas (ficheiro de uma versão futura) são ignoradas e contadas no resumo; uma versão de formato superior à suportada é recusada.

## Importante
O ficheiro é uma cópia por escola, feita **à mão**. Não substitui o `pg_dump` global (`.github/workflows/backup.yml`), que protege contra a perda do projecto inteiro. Peça aos administradores que baixem um backup regularmente, ou active a **cópia diária automática para a nuvem da escola** (`docs/BACKUP_EXTERNO.md`).

## Testes
`npm test` (unitários) e `npm run test:db` (Postgres real: exportar, restaurar, recusas, escola errada, atomicidade, pagamentos intactos).

## Edge Functions (criar utilizadores)
Publique `create-user` e `delete-user` (`supabase functions deploy create-user delete-user`); opcional `supabase secrets set ALLOWED_ORIGIN=https://a-sua-app`. A criação de escolas já não usa Edge Functions (migração 0046).

## Restauro e backup em lotes (migração 0033)

Em escolas grandes (20 mil+ registos, com fotos), enviar/receber a escola inteira numa só chamada fazia o gateway
do Supabase responder `upstream request timeout`. A migração `0033_backup_restore_chunked.sql` acrescenta:

- `school_backup_meta()` + `school_backup_page(kind, colecção, offset, limite)` — o backup (e o ponto de segurança
  antes de restaurar) é lido em páginas pequenas.
- `school_restore_begin` / `school_restore_stage` / `school_restore_apply` / `school_restore_finish` — o ficheiro é
  enviado em lotes para a tabela `restore_staging` (sem tocar nos dados vivos) e só depois cada tabela é substituída,
  numa transacção própria. A app mostra uma barra global e uma barra por tabela (envio → aplicação) e repete
  automaticamente pedidos que falhem por ligação instável.

Sem a 0033 a app continua a funcionar para backups pequenos (≤ 3000 registos) pela via antiga (0012).

## Restauro sem timeout (migrações 0033 e 0034)

- **0033** — o envio do backup para a área de preparação e a exportação fazem-se em lotes pequenos.
- **0034** — a *aplicação* de cada tabela também: `school_restore_prepare` (valida e apaga o que não vem no ficheiro) →
  `school_restore_apply_batch` (um lote de cada vez) → `school_restore_complete`. Cada pedido dura segundos e é repetível sem
  risco: se o gateway responder "upstream request timeout", a app repete o mesmo pedido (até 6 vezes, com espera crescente) e
  o servidor espera pelo pedido anterior em vez de responder "busy". Sem a 0034 a app usa a função única da 0033.
- Os backups descarregados e o ponto de segurança "antes-do-restauro" saem em **.zip** (o JSON/Excel vai dentro). "Carregar"
  aceita .zip e também o Excel legível do ZIP de "antes de eliminar" (folha `Resumo` + uma folha por módulo); quando o ZIP traz
  `backup.json`, a app lê só o JSON.
