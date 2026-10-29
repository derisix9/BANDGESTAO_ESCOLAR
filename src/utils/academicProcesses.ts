/**
 * Processos académicos (passo 3): numeração de documentos, decisão do conselho de turma
 * e fluxo de recuperação / exame de recurso. Lógica pura, sem acesso à base de dados,
 * para poder ser testada isoladamente (ver tests/academicProcesses.test.ts).
 */

export type AcademicDocType =
  | 'certificado'
  | 'declaracao_sem_notas'
  | 'declaracao_com_notas'
  | 'diploma'
  | 'cartao_estudante'
  | 'cartao_transporte'
  | 'cracha_funcionario'
  | 'historico_academico';

export const DOC_PREFIX: Record<AcademicDocType, string> = {
  certificado: 'CERT',
  declaracao_sem_notas: 'DECL',
  declaracao_com_notas: 'DECN',
  diploma: 'DIPL',
  cartao_estudante: 'CART',
  cartao_transporte: 'TRSP',
  cracha_funcionario: 'CRAC',
  historico_academico: 'HIST'
};

export const DOC_LABEL: Record<AcademicDocType, string> = {
  certificado: 'Certificado',
  declaracao_sem_notas: 'Declaração (sem notas)',
  declaracao_com_notas: 'Declaração (com notas)',
  diploma: 'Diploma',
  cartao_estudante: 'Cartão de estudante',
  cartao_transporte: 'Cartão de transporte',
  cracha_funcionario: 'Crachá de funcionário',
  historico_academico: 'Histórico académico'
};

/** Registo mínimo de um documento já emitido — só o que a numeração precisa. */
export interface IssuedDocRef {
  type: AcademicDocType;
  /** Ano civil ou letivo de emissão (ex.: 2026). */
  year: number;
  /** Sequência dentro de (tipo, ano). */
  seq: number;
  status?: 'emitido' | 'anulado';
}

/**
 * Próximo número de um tipo de documento no ano dado. A sequência nunca reutiliza
 * números, mesmo de documentos anulados: um documento anulado continua a ocupar o seu número.
 */
export function nextDocSequence(issued: IssuedDocRef[], type: AcademicDocType, year: number): number {
  let max = 0;
  for (const d of issued) {
    if (d.type === type && d.year === year && d.seq > max) max = d.seq;
  }
  return max + 1;
}

/** Ex.: CERT-2026-000012 */
export function formatDocNumber(type: AcademicDocType, year: number, seq: number): string {
  return `${DOC_PREFIX[type]}-${year}-${String(seq).padStart(6, '0')}`;
}

/** Interpreta um número formatado; devolve null se não for válido. */
export function parseDocNumber(
  value: string
): { type: AcademicDocType; year: number; seq: number } | null {
  const m = /^([A-Z]{4})-(\d{4})-(\d{6})$/.exec(value.trim());
  if (!m) return null;
  const type = (Object.keys(DOC_PREFIX) as AcademicDocType[]).find((t) => DOC_PREFIX[t] === m[1]);
  if (!type) return null;
  return { type, year: Number(m[2]), seq: Number(m[3]) };
}

/**
 * Código de verificação curto, estável para o mesmo documento. Serve para o público conferir
 * o documento contra o registo da escola; não é uma assinatura criptográfica.
 */
export function docVerificationCode(docNumber: string, studentId: string, issuedAtISO: string): string {
  const input = `${docNumber}|${studentId}|${issuedAtISO}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
  const raw = hex(h1) + hex(h2);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

// ---------------------------------------------------------------------------
// Conselho de turma: decisão de transição de classe
// ---------------------------------------------------------------------------

export type CouncilDecision = 'aprovado' | 'reprovado' | 'condicional';

export interface CouncilRules {
  /** Nota mínima de aprovação por disciplina (escala 0–20). */
  passingGrade: number;
  /** Máximo de disciplinas negativas que ainda permite transição condicional. */
  maxNegativesForCondicional: number;
  /** Quantidade de negativas a partir da qual a retenção é automática. */
  maxNegativesToFail: number;
  /** Disciplinas em que uma negativa é sempre eliminatória (ex.: Língua Portuguesa, Matemática). */
  eliminatorySubjectIds: string[];
  /** Percentagem máxima de faltas injustificadas antes de reprovar por faltas. */
  maxAbsencePercent: number;
}

export const DEFAULT_COUNCIL_RULES: CouncilRules = {
  passingGrade: 10,
  maxNegativesForCondicional: 2,
  maxNegativesToFail: 3,
  eliminatorySubjectIds: [],
  maxAbsencePercent: 25
};

export interface CouncilSubjectResult {
  subjectId: string;
  subjectName: string;
  /** Média final da disciplina; '' quando ainda não foi lançada. */
  finalGrade: number | '';
}

export interface CouncilProposal {
  decision: CouncilDecision;
  negatives: CouncilSubjectResult[];
  missing: CouncilSubjectResult[];
  reasons: string[];
  /** Disciplinas que o aluno terá de recuperar (decisão condicional). */
  recoverySubjectIds: string[];
  /** Verdadeiro quando falta informação e a proposta não deve ser homologada. */
  incomplete: boolean;
}

/**
 * Proposta automática para o conselho de turma. É sempre uma proposta: o conselho pode
 * decidir diferente, e nesse caso o registo guarda a decisão final e a justificação.
 */
export function proposeCouncilDecision(params: {
  results: CouncilSubjectResult[];
  unexcusedAbsences?: number;
  totalLessons?: number;
  isDesistente?: boolean;
  rules?: CouncilRules;
}): CouncilProposal {
  const rules = params.rules ?? DEFAULT_COUNCIL_RULES;
  const reasons: string[] = [];
  const missing = params.results.filter((r) => r.finalGrade === '');
  const graded = params.results.filter((r) => typeof r.finalGrade === 'number');
  const negatives = graded.filter((r) => (r.finalGrade as number) < rules.passingGrade);
  const recoverySubjectIds: string[] = [];

  if (params.isDesistente) {
    return {
      decision: 'reprovado',
      negatives,
      missing,
      reasons: ['Aluno desistente: sem avaliação completa no ano letivo.'],
      recoverySubjectIds,
      incomplete: false
    };
  }

  if (missing.length > 0) {
    reasons.push(`Faltam notas finais em ${missing.length} disciplina(s).`);
  }

  if (params.totalLessons && params.totalLessons > 0 && params.unexcusedAbsences !== undefined) {
    const pct = (params.unexcusedAbsences / params.totalLessons) * 100;
    if (pct > rules.maxAbsencePercent) {
      reasons.push(
        `Faltas injustificadas (${pct.toFixed(1)}%) acima do limite de ${rules.maxAbsencePercent}%.`
      );
      return { decision: 'reprovado', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
    }
  }

  const eliminatory = negatives.filter((r) => rules.eliminatorySubjectIds.includes(r.subjectId));
  if (eliminatory.length > 0) {
    reasons.push(`Negativa em disciplina eliminatória: ${eliminatory.map((r) => r.subjectName).join(', ')}.`);
    return { decision: 'reprovado', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
  }

  if (negatives.length >= rules.maxNegativesToFail) {
    reasons.push(`${negatives.length} disciplinas negativas (limite de retenção: ${rules.maxNegativesToFail}).`);
    return { decision: 'reprovado', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
  }

  if (negatives.length === 0) {
    if (reasons.length === 0) reasons.push('Positiva a todas as disciplinas.');
    return { decision: 'aprovado', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
  }

  if (negatives.length <= rules.maxNegativesForCondicional) {
    reasons.push(
      `Negativa a ${negatives.length} disciplina(s): ${negatives.map((r) => r.subjectName).join(', ')}. Transição condicional com recuperação.`
    );
    recoverySubjectIds.push(...negatives.map((r) => r.subjectId));
    return { decision: 'condicional', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
  }

  reasons.push('Número de negativas fora dos limites de transição condicional.');
  return { decision: 'reprovado', negatives, missing, reasons, recoverySubjectIds, incomplete: missing.length > 0 };
}

// ---------------------------------------------------------------------------
// Recuperação e exame de recurso (secundário)
// ---------------------------------------------------------------------------

export type RecoveryStage = 'inscrito' | 'recuperacao' | 'exame_recurso' | 'concluido';
export type RecoveryOutcome = 'aprovado' | 'reprovado' | 'pendente';

export interface RecoveryCase {
  studentId: string;
  subjectId: string;
  /** Nota que originou o processo. */
  originalGrade: number;
  stage: RecoveryStage;
  recoveryGrade?: number | '';
  appealExamGrade?: number | '';
  outcome: RecoveryOutcome;
}

export interface RecoveryRules {
  passingGrade: number;
  /** Nota mínima para ser admitido a recuperação / exame de recurso. */
  minGradeToEnter: number;
}

export const DEFAULT_RECOVERY_RULES: RecoveryRules = { passingGrade: 10, minGradeToEnter: 7 };

/** Um aluno só entra no fluxo se a nota estiver entre o mínimo de admissão e a nota de aprovação. */
export function isEligibleForRecovery(grade: number, rules: RecoveryRules = DEFAULT_RECOVERY_RULES): boolean {
  return grade >= rules.minGradeToEnter && grade < rules.passingGrade;
}

/**
 * Avança o processo conforme as notas lançadas. A recuperação vem antes do exame de recurso:
 * só se passa ao recurso quando a recuperação foi lançada e continua negativa.
 */
export function advanceRecovery(c: RecoveryCase, rules: RecoveryRules = DEFAULT_RECOVERY_RULES): RecoveryCase {
  const next: RecoveryCase = { ...c };
  const hasRec = typeof c.recoveryGrade === 'number';
  const hasAppeal = typeof c.appealExamGrade === 'number';

  if (!isEligibleForRecovery(c.originalGrade, rules) && c.stage === 'inscrito') {
    return { ...next, stage: 'concluido', outcome: c.originalGrade >= rules.passingGrade ? 'aprovado' : 'reprovado' };
  }
  if (hasAppeal) {
    return { ...next, stage: 'concluido', outcome: (c.appealExamGrade as number) >= rules.passingGrade ? 'aprovado' : 'reprovado' };
  }
  if (hasRec) {
    if ((c.recoveryGrade as number) >= rules.passingGrade) return { ...next, stage: 'concluido', outcome: 'aprovado' };
    return { ...next, stage: 'exame_recurso', outcome: 'pendente' };
  }
  return { ...next, stage: c.stage === 'inscrito' ? 'recuperacao' : c.stage, outcome: 'pendente' };
}

/** Nota que passa a valer na pauta depois do processo concluído (a de aprovação, ou a original). */
export function effectiveGradeAfterRecovery(c: RecoveryCase): number {
  if (c.outcome === 'aprovado') {
    if (typeof c.appealExamGrade === 'number' && c.stage === 'concluido' && c.appealExamGrade >= 0) return c.appealExamGrade;
    if (typeof c.recoveryGrade === 'number') return c.recoveryGrade;
  }
  return c.originalGrade;
}
