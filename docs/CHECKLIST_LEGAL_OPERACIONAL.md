# Checklist legal e operacional (antes e durante a produção)

Este documento **não é aconselhamento jurídico nem fiscal**. Separa o que o código já cobre do que depende de decisões e
contactos externos (jurista, contabilista, AGT, MED, APD). Cada linha tem um responsável e uma data: preencha na reunião de arranque.

Legenda: ✅ existe no código/infraestrutura · ⚠️ existe em parte · ⬜ fora do código (tem de ser feito por pessoas)

## 1. Protecção de dados (Lei n.º 22/11)
| # | Ponto | Estado | Responsável | Data |
|---|---|---|---|---|
| 1.1 | Registo de pedidos dos titulares (acesso, retificação, apagamento, portabilidade, oposição) e prazos de retenção por categoria | ✅ Configurações → Protecção de Dados (`TabProtecaoDados.tsx`, `src/utils/dataProtection.ts`) | | |
| 1.2 | Política de privacidade e termos publicados | ⚠️ `public/termos-e-privacidade.html`; o jurista deve rever o texto, incluindo a menção ao registo técnico de erros | | |
| 1.3 | Isolamento entre escolas, permissões por colecção e campo, projecções privadas para alunos e encarregados | ✅ RLS + `collection_acl` (`docs/SUPABASE_FASE1.md`) | | |
| 1.4 | Dados guardados fora de Angola (Supabase): a transferência internacional precisa de enquadramento legal | ⬜ Perguntar ao jurista se é necessário registo e/ou autorização junto da Agência de Protecção de Dados (APD), e em que condições (dados de menores e de saúde incluídos). Guardar a resposta por escrito | | |
| 1.5 | Região do projecto Supabase e subcontratante | ⬜ Registar a região escolhida e o contrato/termos de tratamento com o fornecedor | | |
| 1.6 | Consentimento e informação aos encarregados no ato da matrícula | ⬜ Definir o texto e onde é recolhido | | |
| 1.7 | Encarregado de protecção de dados / ponto de contacto da escola | ⬜ Nomear e publicar o contacto | | |
| 1.8 | Notificação de violação de dados: a quem, em que prazo, com que conteúdo | ⬜ Jurista confirma; depois preencher a secção 3 do `docs/PLANO_RESPOSTA_INCIDENTES.md` | | |

## 2. Fiscal e regulamentar (o código não resolve)
| # | Ponto | Estado | Responsável | Data |
|---|---|---|---|---|
| 2.1 | Facturação certificada pela AGT / SAF-T | ⬜ O sistema **não** emite documentos fiscais válidos. Escolher: certificar o software ou integrar com um software já certificado. Confirmar com o contabilista | | |
| 2.2 | Folha de pagamento: tabela de IRT, taxas de INSS e prazos de entrega | ⚠️ Editáveis e com valores de referência (`docs/FOLHA_NO_FLUXO_DE_CAIXA.md`). O contabilista valida antes de usar para fins fiscais | | |
| 2.3 | Ligação ao MED | ⬜ A exportação só valida a consistência interna (`medValidator`); não há modelo oficial nem submissão. Perguntar ao MED/direcção provincial o formato e o canal | | |
| 2.4 | Documentos académicos | ⬜ O código de verificação e o QR **não** são assinatura digital; continua a ser preciso carimbo e assinatura físicos | | |
| 2.5 | Conformidade do regime de avaliação (faltas, recurso, limites de negativas) com a norma em vigor | ⚠️ Configurável em Regras de Notas; a direcção confirma os valores de cada ano lectivo | | |

## 3. Segurança e operação
| # | Ponto | Estado | Responsável | Data |
|---|---|---|---|---|
| 3.1 | Login com 2FA, captcha, política de palavras-passe, IPs autorizados | ✅ `docs/CAPTCHA_SUPABASE.md`, `docs/IP_AUTORIZADOS.md` | | |
| 3.2 | Cabeçalhos de segurança e CSP sem scripts inline | ✅ `vercel.json`, `tests/securityHeaders.test.ts` | | |
| 3.3 | Monitorização de erros do browser e da sincronização | ✅ `docs/MONITORIZACAO_ERROS.md` (migração 0047) | | |
| 3.4 | **Alguém lê o resumo de erros** com rotina fixa (por exemplo todas as manhãs e depois de cada publicação) | ⬜ Definir pessoa e hora. Sem isto a monitorização só serve para investigar depois | | |
| 3.5 | Alertas automáticos (e-mail/WhatsApp) quando um erro dispara | ⬜ Exige conta de serviço; não incluído | | |
| 3.6 | Backups: cópia diária e teste de restauro mensal | ⚠️ Workflows `backup.yml` (diário) e `restore-test.yml` (mensal) em `.github/workflows/`; conferir que estão activos, que os segredos estão definidos e que alguém vê as falhas. Backup por escola: `docs/BACKUPS_SUPABASE.md`, `docs/BACKUP_EXTERNO.md` | | |
| 3.7 | **Teste de restauro a sério** num projecto à parte, com cronómetro | ⬜ Fazer antes de Janeiro e anotar quanto demorou | | |
| 3.8 | Plano de resposta a incidentes | ✅ Rascunho em `docs/PLANO_RESPOSTA_INCIDENTES.md`; falta preencher contactos e ensaiar | | |
| 3.9 | Teste de intrusão (pentest) independente | ⬜ Contratar. O código não substitui isto | | |
| 3.10 | Teste de carga com centenas de escolas (todas partilham a tabela `records`) | ⬜ Ainda não feito | | |
| 3.11 | Plano do Supabase adequado à produção (backups geridos, sem pausa por inactividade) | ⬜ Confirmar o plano contratado | | |
| 3.12 | Aplicar a migração `0047_client_errors.sql` e correr `npm run test:db` num Postgres local antes | ⬜ Não foi possível correr neste ambiente | | |

## 4. Antes de cada época crítica (Janeiro: matrículas)
- [ ] Ensaiar a **Renovação anual** com dados reais de uma escola (`docs/RENOVACAO_ANUAL_MATRICULA.md`).
- [ ] Conselhos de turma homologados e recuperações fechadas, senão os alunos ficam bloqueados na renovação.
- [ ] Tabela Financeira de todas as classes do novo ano.
- [ ] Teste de restauro recente (3.7) e resumo de erros sem pendentes (3.4).
- [ ] Equipa de suporte avisada do período de maior carga.

## 5. Revisão
Rever este documento a cada trimestre e sempre que mudar a lei, o fornecedor de alojamento ou o regime de avaliação.
