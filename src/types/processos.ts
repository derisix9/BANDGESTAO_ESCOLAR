import type { AcademicDocType, CouncilDecision, RecoveryOutcome, RecoveryStage } from '../utils/academicProcesses';
import type { DiscountRule, Installment } from '../utils/financeExtras';

/** Documento académico emitido (certificado, declaração, diploma, cartão, histórico). */
export interface AcademicDocument {
  id: string;
  /** Ex.: CERT-2026-000012 */
  number: string;
  type: AcademicDocType;
  /** Ano civil usado na numeração. */
  year: number;
  seq: number;
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  /** Ano letivo a que o documento se refere, quando aplicável. */
  academicYear?: string;
  purpose?: string;
  verificationCode: string;
  status: 'emitido' | 'anulado';
  issuedAt: string;
  issuedBy: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  /** Quem recebeu o documento: aluno (por omissão), professor ou funcionário (crachá). */
  personKind?: 'aluno' | 'professor' | 'funcionario';
  /** Receita do documento tal como foi emitido no Estúdio (para reimprimir exactamente o mesmo). */
  studioSnapshot?: Record<string, any>;
}

export type TransferKind = 'transferencia_saida' | 'transferencia_entrada' | 'equivalencia' | 'anulacao_matricula';

/** Quem está do outro lado: escola do mesmo sistema (autopreenchimento) ou desconhecida (manual). */
export interface TransferInstitutionRef {
  kind: 'conhecida' | 'desconhecida';
  /** Só para escolas conhecidas: id da instituição no registo partilhado. */
  institutionId?: string;
  name: string;
}

/** Notas de um trimestre/disciplina que viajam com o aluno (entrada manual ou recebidas da escola de origem). */
export interface TransferredSubjectGrades {
  subjectName: string;
  /** Preenchido quando a disciplina de origem foi mapeada para uma disciplina desta escola. */
  destSubjectId?: string;
  /** Nome original na escola de origem (só se o nome mudou ao mapear). */
  originSubjectName?: string;
  mt1?: number | '';
  mt2?: number | '';
  mt3?: number | '';
}

/** Pacote que a escola de origem envia à de destino (e que a Guia de Transferência imprime). */
export interface TransferPackage {
  guideNumber: string;
  fromInstitutionId: string;
  fromInstitutionName: string;
  date: string;
  reason: string;
  academicYear: string;
  grade: string;
  courseName?: string;
  className?: string;
  student: {
    name: string; birthDate: string; gender?: string; nationality?: string; birthPlace?: string;
    biNumber?: string; nif?: string; address?: string; email?: string; studentPhone?: string;
    guardianName?: string; guardianPhone?: string; guardianEmail?: string; guardianNif?: string; guardianRelation?: string;
    procNumber?: string;
  };
  /** Notas dos trimestres já concluídos neste ano lectivo. */
  trimesterGrades: TransferredSubjectGrades[];
}

/** Pedido de transferência recebido de outra escola do sistema, à espera de decisão da secretaria. */
export interface IncomingTransferRequest {
  id: string;
  toInstitutionId: string;
  fromInstitutionId: string;
  package: TransferPackage;
  status: 'pendente' | 'aceite' | 'recusada' | 'concluida';
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Preenchido quando a matrícula por transferência é concluída. */
  studentId?: string;
}

/** Mapeamento Disciplina_Origem → Disciplina_Destino (tabela equivalencias_disciplinas). */
export interface SubjectEquivalence {
  id: string;
  originSubject: string;
  /** Plano de origem, ex.: "Ensino Técnico — Informática" ou "Portugal". */
  originPlan?: string;
  destSubject: string;
  destSubjectId?: string;
  createdBy: string;
  createdAt: string;
}

/** Disciplina em atraso (regime de dependência): o aluno avança de classe mas fica inscrito nela. */
export interface StudentDependency {
  id: string;
  studentId: string;
  studentName: string;
  subjectName: string;
  /** Classe a que a disciplina pertence (a que o aluno nunca fez). */
  fromGrade: string;
  academicYear: string;
  status: 'pendente' | 'regularizada';
  origin: 'equivalencia' | 'manual';
  transferId?: string;
  createdBy: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface StudentTransfer {
  id: string;
  code: string;
  kind: TransferKind;
  studentId: string;
  studentName: string;
  studentProcNumber: string;
  date: string;
  /** Escola de origem (entrada) ou destino (saída). */
  otherSchool?: string;
  reason: string;
  /** Equivalências: disciplinas reconhecidas, uma por linha. */
  equivalences?: Array<{ subjectName: string; originGrade?: number; recognized: boolean; destSubject?: string }>;
  /** Cópia do histórico do aluno no momento do processo, para nunca se perder. */
  historySnapshot: {
    grade: string;
    className: string;
    academicYear: string;
    enrollments: Array<{ academicYear: string; numeroMatricula: string; grade?: string; status?: string }>;
    grades: unknown;
  };
  status: 'pendente' | 'concluido' | 'rejeitado';
  /** Escola do outro lado (conhecida do sistema ou escrita à mão). */
  otherInstitution?: TransferInstitutionRef;
  /** Dados enviados/guardados na saída (permitem reenviar e reimprimir a guia). */
  package?: TransferPackage;
  /** Estado da entrega à escola de destino (só escolas conhecidas). */
  deliveryStatus?: 'entregue' | 'falhou' | 'nao_aplicavel';
  /** Nº da Guia de Transferência (emitida na saída; trazida pelo aluno na entrada). */
  guideNumber?: string;
  /** Saída para escola conhecida: id do pedido entregue na caixa de entrada dela. */
  deliveredRequestId?: string;
  /** Entrada: a matrícula criada por esta transferência. */
  matriculaId?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface ClassCouncilStudentEntry {
  studentId: string;
  studentName: string;
  /** Disciplinas negativas do ano lectivo (nota decisiva abaixo da nota de aprovação). */
  negatives: Array<{ subjectId: string; subjectName: string; grade: number; isKey?: boolean; /** Recuperada em exame de recurso (NER ≥ aprovação). */ recovered?: boolean }>;
  /** Quantas disciplinas negativas teve no ano lectivo. */
  negativeCount?: number;
  /** Falta nota final ou trimestre por lançar. */
  incomplete?: boolean;
  proposed: CouncilDecision;
  decision: CouncilDecision;
  /** Obrigatória quando a decisão difere da proposta automática. */
  justification?: string;
  reasons: string[];
}

/** Alteração de nota feita no conselho de turma (fica registada no próprio conselho). */
export interface CouncilGradeChange {
  id: string;
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectName: string;
  /** Campo alterado: mac1, npt2, nee, ner... */
  field: string;
  label: string;
  from: number | '';
  to: number | '';
  reason?: string;
  by: string;
  at: string;
}

export interface ClassCouncilRecord {
  id: string;
  academicYear: string;
  classId: string;
  className: string;
  grade: string;
  date: string;
  entries: ClassCouncilStudentEntry[];
  /** Notas atribuídas/alteradas no conselho; as Mini-Pautas e a Pauta Final seguem estas alterações. */
  gradeChanges?: CouncilGradeChange[];
  status: 'rascunho' | 'homologado';
  homologatedBy?: string;
  homologatedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface RecoveryRecord {
  id: string;
  academicYear: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  originalGrade: number;
  stage: RecoveryStage;
  recoveryGrade?: number | '';
  appealExamGrade?: number | '';
  outcome: RecoveryOutcome;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentPlan {
  id: string;
  studentId: string;
  studentName: string;
  academicYear: string;
  description: string;
  total: number;
  installments: Installment[];
  status: 'ativo' | 'concluido' | 'cancelado';
  createdBy: string;
  createdAt: string;
}

export interface StoredDiscountRule extends DiscountRule {
  active: boolean;
}

export interface BankStatementLine {
  id: string;
  date: string;
  amount: number;
  description: string;
  reference?: string;
  /** Fatura a que foi associada (depois de confirmada por um utilizador). */
  matchedInvoiceId?: string;
  status: 'por_conciliar' | 'conciliada' | 'ignorada';
  importedAt: string;
  importedBy: string;
  batchId: string;
}

export interface ExpenseRecord {
  id: string;
  supplier?: string;
  category: string;
  description?: string;
  amount: number;
  date: string;
  dueDate?: string;
  paidDate?: string;
  createdBy: string;
  createdAt: string;
}


/** Sessão de caixa (abertura/fecho), como numa caixa registadora de loja. */
export interface CashSession {
  id: string;
  status: 'aberto' | 'fechado';
  openedAt: string;
  openedBy: string;
  /** Fundo de maneio com que a caixa foi aberta. */
  openingFloat: number;
  openingNote?: string;
  closedAt?: string;
  closedBy?: string;
  /** Totais gravados no fecho (ficam como registo imutável). */
  cashIn?: number;
  otherIn?: number;
  /** Total de entradas contabilizadas (todos os meios: numerário, TPA, Multicaixa, outros). */
  totalIn?: number;
  /** Entradas por meio de pagamento. */
  inByMethod?: Array<{ method: string; total: number; count: number }>;
  /** Numerário esperado fisicamente na gaveta (informativo). */
  expectedDrawerCash?: number;
  cashOut?: number;
  expectedCash?: number;
  countedCash?: number;
  difference?: number;
  closingNote?: string;
  /** Movimentos já contabilizados neste fecho (inv:ID / exp:ID). */
  movementIds?: string[];
}
