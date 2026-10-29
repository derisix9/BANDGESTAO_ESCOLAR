/**
 * Conselho de turma ↔ pautas.
 *
 * Tudo o que o conselho mostra e decide sai das MESMAS notas e das MESMAS regras do lançamento
 * de notas (Mini-Pauta → Pauta Final): MT1/MT2/MT3, MFD, MF, disciplinas chave e o limite de
 * negativas com direito a Recurso definido em Configurações → Regras & Escala de Notas.
 * Lógica pura e testável.
 */

import type { AttendanceSheet, ClassRoom, Student, Subject } from '../types';
import { absenceReason, absenceVerdict, computeAbsenceStats, type AbsenceStats, type AbsenceVerdict } from './councilAbsences';
import type { StudentMiniPautaItem, StudentPautaGeralItem, StudentSubjectDisciplineGrades } from '../types/pauta';
import type { ClassCouncilStudentEntry } from '../types/processos';
import type { CouncilDecision } from './academicProcesses';
import { isKeySubjectFor } from './keySubjects';
import { classAllowsRecurso, hasThirdTrimesterGrade } from './recursoRules';
import {
  EJA_LIMITS,
  GradeRules,
  PautaClassContext,
  PautaRegime,
  PautaSituation,
  buildMiniPautaRows,
  decisiveSubjectGrade,
  getMaxNegativasRecurso,
  getPautaRegime,
  isNoTrimestersRuleActive,
  recalcMiniPautaRow,
  importedAveragesOf,
  findStudentSubjectRecord,
  resolveStudentStanding,
  studentExitKind,
  studentGradeEvidence,
  summarizePautaGeralRow
} from './pautaCalculations';

// ---------------------------------------------------------------------------
// Campos editáveis do boletim individual (iguais aos da Mini-Pauta)
// ---------------------------------------------------------------------------

export type CouncilEvalPrefix = 'mac' | 'npp' | 'npt' | 'aav' | 'pcp';
export type CouncilExamField = 'pg' | 'nee' | 'neo' | 'ner';

/** Avaliações de cada trimestre, por regime. */
export function trimesterPrefixesFor(regime: PautaRegime): CouncilEvalPrefix[] {
  return regime === 'eja' ? ['mac', 'npt', 'aav', 'pcp'] : ['mac', 'npp', 'npt'];
}

/** Notas "globais" da disciplina, por regime (PG nas classes de transição; NEE/NEO/NER nas de exame). */
export function examFieldsFor(regime: PautaRegime): CouncilExamField[] {
  if (regime === 'exame') return ['nee', 'neo', 'ner'];
  if (regime === 'transicao') return ['pg'];
  return [];
}

/** Nota máxima de um campo (o EJA tem escalas próprias: 14/14/2/4). */
export function fieldMax(field: string, regime: PautaRegime): number {
  if (regime !== 'eja') return 20;
  const prefix = field.replace(/\d$/, '');
  if (prefix === 'mac') return EJA_LIMITS.MAC;
  if (prefix === 'npt') return EJA_LIMITS.NPT;
  if (prefix === 'aav') return EJA_LIMITS.AAV;
  if (prefix === 'pcp') return EJA_LIMITS.PCP;
  return 20;
}

const TRIM_ROMAN = ['I', 'II', 'III'];

export function fieldLabel(field: string): string {
  const m = /^([a-z]+)([123])?$/.exec(field);
  if (!m) return field.toUpperCase();
  const name = m[1].toUpperCase();
  return m[2] ? `${name} ${TRIM_ROMAN[Number(m[2]) - 1]} trim.` : name;
}

/** Normaliza o que foi escrito numa célula: vazio, ou um número entre 0 e o máximo do campo. */
export function sanitizeGradeInput(raw: string | number | '', max: number): number | '' {
  if (raw === '' || raw === null || raw === undefined) return '';
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return Math.max(0, Math.min(max, n));
}

/** Todos os campos de nota (de avaliação) que o conselho pode alterar numa linha. */
export function editableFieldsOf(regime: PautaRegime): string[] {
  const fields: string[] = [];
  for (const t of [1, 2, 3]) trimesterPrefixesFor(regime).forEach((p) => fields.push(`${p}${t}`));
  examFieldsFor(regime).forEach((f) => fields.push(f));
  return fields;
}

export interface CouncilFieldChange {
  field: string;
  label: string;
  from: number | '';
  to: number | '';
}

/** Diferenças entre duas versões da mesma linha (só campos de avaliação, nunca as médias calculadas). */
export function diffGradeRows(before: Partial<StudentMiniPautaItem> | undefined, after: Partial<StudentMiniPautaItem>, regime: PautaRegime): CouncilFieldChange[] {
  const out: CouncilFieldChange[] = [];
  for (const field of editableFieldsOf(regime)) {
    const a = (before as any)?.[field];
    const b = (after as any)?.[field];
    const from: number | '' = typeof a === 'number' ? a : '';
    const to: number | '' = typeof b === 'number' ? b : '';
    if (from !== to) out.push({ field, label: fieldLabel(field), from, to });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resumo do aluno para o conselho
// ---------------------------------------------------------------------------

export interface CouncilSubjectLine {
  subjectId: string;
  subjectName: string;
  isKey: boolean;
  row: StudentMiniPautaItem;
  /** Nota decisiva: MF (classes de exame, com exame lançado) ou MFD. */
  decisive: number | '';
  negative: boolean;
  /** NER ≥ nota de aprovação: a negativa foi recuperada no exame de recurso. */
  recoveredByNer: boolean;
  /** Trimestres (1, 2, 3) sem média lançada nesta disciplina. */
  missingTrimesters: Array<1 | 2 | 3>;
}

export interface CouncilNegative {
  subjectId: string;
  subjectName: string;
  grade: number;
  isKey: boolean;
  recovered: boolean;
}

export interface CouncilStudentSummary {
  regime: PautaRegime;
  lines: CouncilSubjectLine[];
  negatives: CouncilNegative[];
  /** Quantas disciplinas negativas teve no ano lectivo. */
  negativeCount: number;
  /** Limite de negativas com direito a Recurso (6.ª/9.ª ou 12.ª/13.ª); null fora das classes de exame. */
  maxNegativasRecurso: number | null;
  mf: number | '';
  situation: PautaSituation;
  proposed: CouncilDecision;
  reasons: string[];
  /** Falta nota final em alguma disciplina ou algum trimestre por lançar. */
  incomplete: boolean;
  missingFinal: string[];
  isDesistente: boolean;
  /** Matrícula transferida: mantém as notas lançadas até à transferência. */
  isTransferido: boolean;
  /** Faltas injustificadas do ano, a partir das cadernetas. */
  absences: AbsenceStats;
  absenceVerdict: AbsenceVerdict;
}

export interface CouncilContext {
  cls: ClassRoom;
  subjects: Subject[];
  rules: GradeRules;
  /** Trimestre em curso; a regra "sem notas no I e II trimestres" só vale com o III em curso ou lançado. */
  currentTrimester?: string;
  /** Duração do curso (anos): 4 => Recurso só na 13.ª; 3 => só na 12.ª. */
  courseDurationYears?: number;
  /** Cadernetas de presença gravadas: dão a taxa de faltas injustificadas de cada aluno. */
  attendanceSheets?: AttendanceSheet[];
  /** Ano lectivo das cadernetas a contar (por defeito, todas as da turma). */
  academicYear?: string;
}

export function councilRegime(cls: ClassRoom): PautaRegime {
  return getPautaRegime(cls.grade, cls.name, cls.area);
}

export function councilClassCtx(cls: ClassRoom, courseDurationYears?: number): PautaClassContext {
  return { labels: [cls.name, cls.area], courseName: cls.area, courseDurationYears };
}

/**
 * Linha de mini-pauta do aluno numa disciplina: a que está na Mini-Pauta guardada, senão a que sai
 * das notas trimestrais do aluno, senão uma linha vazia. Sempre recalculada.
 */
export function councilRowFor(
  student: Student,
  subject: Subject,
  ctx: CouncilContext,
  stored?: StudentMiniPautaItem[] | null,
  override?: StudentMiniPautaItem
): StudentMiniPautaItem {
  const regime = councilRegime(ctx.cls);
  const isKey = isKeySubjectFor(subject, ctx.cls.grade, ctx.cls.area);
  const calc = { regime, classGrade: ctx.cls.grade, isKeySubject: isKey, rules: ctx.rules, courseDurationYears: ctx.courseDurationYears };
  const found = override || stored?.find((r) => String(r.studentId) === String(student.id));
  const base =
    found ||
    buildMiniPautaRows([student], String(subject.id), [], undefined, ctx.rules, { regime, classGrade: ctx.cls.grade, isKeySubject: isKey, subjectName: subject.name })[0];
  const imported = importedAveragesOf(findStudentSubjectRecord(student, String(subject.id), subject.name));
  const withImported = imported && !override ? { ...base, importedMt: base.importedMt ?? imported.mts, importedMfd: base.importedMfd ?? imported.mfd } : base;
  return recalcMiniPautaRow(withImported, calc);
}

function joinNames(items: string[]): string {
  return items.join(', ');
}

export function buildCouncilStudentSummary(params: {
  student: Student;
  ctx: CouncilContext;
  /** Mini-Pautas guardadas desta turma: `miniPautasStore[classId]` (subjectId → linhas). */
  miniStore?: Record<string, StudentMiniPautaItem[]>;
  /** Linhas ainda não gravadas (o boletim em edição), por disciplina. */
  overrides?: Record<string, StudentMiniPautaItem>;
}): CouncilStudentSummary {
  const { student, ctx, miniStore, overrides } = params;
  const { cls, subjects, rules } = ctx;
  const regime = councilRegime(cls);
  // Mesma regra da Mini-Pauta e da Pauta Final: situação pela ficha do aluno e pelas notas lançadas.
  const evidenceRows = [
    ...Object.values(overrides || {}),
    ...subjects.map((sj) => miniStore?.[String(sj.id)]?.find((r) => String(r.studentId) === String(student.id)))
  ];
  const evidence = studentGradeEvidence(student, evidenceRows);
  const { isDesistente, isTransferido } = resolveStudentStanding(
    studentExitKind(student),
    evidence,
    isNoTrimestersRuleActive(ctx.currentTrimester, evidence.t3)
  );
  const noEvaluation = isDesistente || isTransferido;

  const lines: CouncilSubjectLine[] = subjects.map((subject) => {
    const id = String(subject.id);
    const row = councilRowFor(student, subject, ctx, miniStore?.[id], overrides?.[id]);
    const grades: StudentSubjectDisciplineGrades = { mt1: row.mt1, mt2: row.mt2, mt3: row.mt3, mfd: row.mfd, mf: row.mf ?? '', ner: row.ner ?? '' };
    const decisive = isDesistente ? '' : decisiveSubjectGrade(grades, regime);
    const negative = typeof decisive === 'number' && decisive < rules.passingGrade;
    const recoveredByNer = regime === 'exame' && negative && typeof row.ner === 'number' && row.ner >= rules.passingGrade;
    const missingTrimesters = ([1, 2, 3] as const).filter((t) => typeof (row as any)[`mt${t}`] !== 'number');
    return {
      subjectId: id,
      subjectName: subject.name,
      isKey: isKeySubjectFor(subject, cls.grade, cls.area),
      row,
      decisive,
      negative,
      recoveredByNer,
      missingTrimesters: noEvaluation ? [] : [...missingTrimesters]
    };
  });

  // Situação oficial da Pauta Final (a mesma função que a Pauta Final usa).
  const subjectGrades: Record<string, StudentSubjectDisciplineGrades> = {};
  lines.forEach((l) => {
    subjectGrades[l.subjectId] = isDesistente
      ? { mt1: '', mt2: '', mt3: '', mfd: '', mf: '', ner: '' }
      : { mt1: l.row.mt1, mt2: l.row.mt2, mt3: l.row.mt3, mfd: l.row.mfd, mf: regime === 'exame' ? l.row.mf ?? '' : '', ner: regime === 'exame' ? l.row.ner ?? '' : '' };
  });
  const pautaRow = summarizePautaGeralRow(
    {
      id: `council-${student.id}`,
      studentId: String(student.id),
      num: 0,
      name: student.name || '',
      gender: 'M',
      birthYear: '-',
      age: '-',
      isDebtor: false,
      isDesistente,
      isTransferido,
      subjectGrades
    } as Omit<StudentPautaGeralItem, 'mf' | 'situation'>,
    subjects,
    cls.grade,
    rules,
    regime,
    councilClassCtx(cls, ctx.courseDurationYears)
  );

  const negatives: CouncilNegative[] = lines
    .filter((l) => l.negative)
    .map((l) => ({ subjectId: l.subjectId, subjectName: l.subjectName, grade: l.decisive as number, isKey: l.isKey, recovered: l.recoveredByNer }));

  const missingFinal = noEvaluation ? [] : lines.filter((l) => l.decisive === '').map((l) => l.subjectName);
  const missingTrim = noEvaluation ? [] : lines.filter((l) => l.decisive !== '' && l.missingTrimesters.length > 0);
  const incomplete = missingFinal.length > 0 || missingTrim.length > 0;
  const maxNeg = regime === 'exame' ? getMaxNegativasRecurso(cls.grade, rules) : null;

  const reasons: string[] = [];
  const situation = pautaRow.situation;
  if (isDesistente) {
    reasons.push('Aluno desistente: sem avaliação completa no ano letivo.');
  } else if (isTransferido) {
    reasons.push('Aluno transferido: notas lançadas até à data da transferência; não há decisão de transição.');
  } else {
    if (negatives.length === 0) {
      if (missingFinal.length < lines.length) reasons.push('Positiva a todas as disciplinas com nota lançada.');
    } else {
      reasons.push(`Negativa a ${negatives.length} disciplina(s): ${joinNames(negatives.map((n) => `${n.subjectName} (${n.grade})`))}.`);
    }
    const keyNeg = negatives.filter((n) => n.isKey);
    if (keyNeg.length > 0) reasons.push(`Negativa em disciplina chave (sem direito a recurso): ${joinNames(keyNeg.map((n) => n.subjectName))}.`);
    if (regime === 'exame' && maxNeg !== null) {
      const eligible = negatives.filter((n) => !n.isKey && n.grade >= rules.recursoMinGrade);
      const below = negatives.filter((n) => !n.isKey && n.grade < rules.recursoMinGrade);
      if (below.length > 0) reasons.push(`Nota abaixo de ${rules.recursoMinGrade} (mínimo para recurso): ${joinNames(below.map((n) => n.subjectName))}.`);
      if (eligible.length > maxNeg) reasons.push(`${eligible.length} negativas com direito a recurso, acima do limite configurado (${maxNeg}).`);
      else if (situation === 'RECURSO') reasons.push(`Direito a exame de recurso (limite configurado: ${maxNeg} negativa(s) fora das disciplinas chave).`);
    }
    if (regime !== 'exame' && negatives.length > 0 && situation === 'REPROVADO') {
      reasons.push(`Média final ${pautaRow.mf} abaixo da nota mínima de aprovação (${rules.passingGrade}).`);
    }
    if (missingFinal.length > 0) reasons.push(`Faltam notas finais em ${missingFinal.length} disciplina(s): ${joinNames(missingFinal)}.`);
    if (missingTrim.length > 0) {
      const names = missingTrim.map((l) => `${l.subjectName} (${l.missingTrimesters.map((t) => TRIM_ROMAN[t - 1]).join('/')})`);
      reasons.push(`Trimestre(s) por lançar: ${joinNames(names)}.`);
    }
  }

  // Faltas: acima do limite (com aulas suficientes) o aluno reprova por faltas; perto do limite só avisa.
  const absences = computeAbsenceStats(String(student.id), String(cls.id), ctx.attendanceSheets, ctx.academicYear);
  const verdict: AbsenceVerdict = noEvaluation ? 'ok' : absenceVerdict(absences, rules.maxAbsencePercent);
  if (!noEvaluation) {
    const why = absenceReason(absences, rules.maxAbsencePercent);
    if (why) reasons.push(why);
  }

  const proposed: CouncilDecision =
    situation === 'REPROVADO' || situation === 'DESISTIDO' || situation === 'TRANSFERIDO' || verdict === 'exceeded'
      ? 'reprovado'
      : situation === 'RECURSO'
        ? 'condicional'
        : 'aprovado';

  return {
    regime,
    lines,
    negatives,
    negativeCount: negatives.length,
    maxNegativasRecurso: maxNeg,
    mf: pautaRow.mf,
    situation,
    proposed,
    reasons,
    incomplete,
    missingFinal,
    isDesistente,
    isTransferido,
    absences,
    absenceVerdict: verdict
  };
}

/**
 * Entrada do conselho para um aluno. Se já havia uma decisão e ela diferia da proposta antiga
 * (decisão manual do conselho), mantém-se a decisão e a justificação; senão segue a nova proposta.
 */
export function buildCouncilEntry(student: Student, summary: CouncilStudentSummary, existing?: ClassCouncilStudentEntry): ClassCouncilStudentEntry {
  const manual = !!existing && existing.decision !== existing.proposed;
  return {
    studentId: String(student.id),
    studentName: student.name || '',
    negatives: summary.negatives.map((n) => ({ subjectId: n.subjectId, subjectName: n.subjectName, grade: n.grade, isKey: n.isKey, recovered: n.recovered })),
    negativeCount: summary.negativeCount,
    proposed: summary.proposed,
    decision: manual && existing ? existing.decision : summary.proposed,
    justification: manual && existing ? existing.justification : undefined,
    reasons: [...summary.reasons],
    incomplete: summary.incomplete
  };
}

/** Linha editável → linha pronta a gravar, recalculada com as regras da classe. */
export function recalcCouncilRow(row: StudentMiniPautaItem, subject: Subject, ctx: CouncilContext): StudentMiniPautaItem {
  const regime = councilRegime(ctx.cls);
  return recalcMiniPautaRow(row, {
    regime,
    classGrade: ctx.cls.grade,
    isKeySubject: isKeySubjectFor(subject, ctx.cls.grade, ctx.cls.area),
    rules: ctx.rules,
    courseDurationYears: ctx.courseDurationYears
  });
}
