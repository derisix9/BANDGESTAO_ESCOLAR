import { Student } from '../types';
import {
  GradeRules,
  DEFAULT_GRADE_RULES,
  recomputeTrimesterRecord,
  normalizeGender,
  EnabledGradeParts,
  isNoTrimestersRuleActive,
  resolveStudentStanding,
  studentExitKind,
  studentGradeEvidence
} from './pautaCalculations';

export type TrimesterFilter = 'todos' | '1' | '2' | '3';

/** Contagem separada por sexo: M (masculino), F (feminino) e MF (total dos dois). */
export interface GenderCount {
  M: number;
  F: number;
  MF: number;
}

export interface GenderPercent {
  M: number | null;
  F: number | null;
  MF: number | null;
}

export interface ClassStats {
  matriculados: GenderCount;
  desistidos: GenderCount;
  /**
   * Alunos que SAÍRAM por transferência (Transferências, Equivalências e Anulações →
   * "Transferência de saída"). Não inclui os que entraram por transferência.
   */
  transferidos: GenderCount;
  avaliados: GenderCount;
  reprovados: GenderCount;
  aprovados: GenderCount;
  /** Percentagem de aprovação = aprovados / avaliados * 100 (null quando não há avaliados). */
  percentagem: GenderPercent;
  /** Média das notas dos alunos avaliados (null sem notas). */
  averageGrade: number | null;
}

export interface StatsOptions {
  trimester: TrimesterFilter;
  /** Disciplina escolhida no filtro; vazio = todas as disciplinas. */
  subjectId?: string;
  subjectName?: string;
  rules?: GradeRules;
  /** Linhas da mini-pauta desta turma: { [subjectId]: linhas[] } (db.miniPautasStore[classId]). */
  classMiniPautas?: Record<string, any[]>;
  /** Campos de nota habilitados para o professor (por omissão, todos). */
  enabled?: Partial<EnabledGradeParts>;
  /** Trimestre em curso ('1' | '2' | '3'); a regra "sem notas no I e II" só vale com o III em curso ou lançado. */
  currentTrimester?: string;
}

const emptyCount = (): GenderCount => ({ M: 0, F: 0, MF: 0 });

function bump(c: GenderCount, g: 'M' | 'F') {
  c[g] += 1;
  c.MF += 1;
}

export function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

export function percentOf(approved: GenderCount, evaluated: GenderCount): GenderPercent {
  return {
    M: percent(approved.M, evaluated.M),
    F: percent(approved.F, evaluated.F),
    MF: percent(approved.MF, evaluated.MF)
  };
}

function numeric(v: unknown): number | null {
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

/** Nota de um registo trimestral (uma disciplina) para o trimestre pedido. */
function recordGrade(rec: any, trimester: TrimesterFilter, rules: GradeRules): number | null {
  const { mt1, mt2, mt3, mfd } = recomputeTrimesterRecord(rec, rules);
  if (trimester === '1') return numeric(mt1);
  if (trimester === '2') return numeric(mt2);
  if (trimester === '3') return numeric(mt3);
  return numeric(mfd);
}

/** Linha da mini-pauta guardada para este aluno e disciplina (se existir). */
function findMiniRow(student: Student, opts: StatsOptions): any | undefined {
  if (!opts.classMiniPautas || !opts.subjectId) return undefined;
  const rows = opts.classMiniPautas[opts.subjectId];
  return Array.isArray(rows) ? rows.find((r) => String(r?.studentId) === String(student.id)) : undefined;
}

/**
 * Nota do aluno para os filtros activos, ou null se ainda não foi avaliado.
 * Sem disciplina escolhida, é a média das disciplinas com nota lançada.
 */
export function studentGrade(student: Student, opts: StatsOptions): number | null {
  const rules = opts.rules || DEFAULT_GRADE_RULES;
  const subjectFilter = Boolean(opts.subjectId);
  const wantedName = (opts.subjectName || '').trim().toLowerCase();

  const records = (student.trimesterGrades || []).filter((rec) => {
    if (!subjectFilter) return true;
    return (
      String(rec.subjectId) === String(opts.subjectId) ||
      (wantedName !== '' && (rec.subjectName || '').trim().toLowerCase() === wantedName)
    );
  });

  const values = records
    .map((rec) => recordGrade(rec, opts.trimester, rules))
    .filter((v): v is number => v !== null);

  if (values.length > 0) {
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  // Sem registo no aluno: usa a mini-pauta guardada desta disciplina.
  const miniRow = findMiniRow(student, opts);
  if (miniRow) {
    const key = opts.trimester === '1' ? 'mt1' : opts.trimester === '2' ? 'mt2' : opts.trimester === '3' ? 'mt3' : 'mfd';
    return numeric(miniRow[key]);
  }

  // Sem filtro de disciplina, aceita a média corrente do aluno quando não há mais nada.
  if (!subjectFilter && student.currentAverage && student.currentAverage > 0) {
    return student.currentAverage;
  }
  return null;
}

/**
 * Estatística de uma turma: Matriculados, Desistidos, Avaliados, Reprovados, Aprovados
 * (cada um em M, F e MF) e a percentagem de aprovação.
 *
 * - Matriculados: todos os alunos da turma.
 * - Desistidos: mesma regra da Mini-Pauta e da Pauta Final (resolveStudentStanding):
 *   matrícula cancelada/aluno inactivo sem notas nos campos habilitados, ou sem notas no
 *   I e II trimestres (com o III trimestre em curso ou já lançado).
 * - Transferidos: matrícula transferida (aluno inactivo); contam com as notas até então,
 *   mas não entram em Avaliados, Aprovados nem Reprovados.
 * - Avaliados: não desistidos nem transferidos com nota lançada para o filtro activo.
 * - Aprovados / Reprovados: avaliados com nota >= / < nota mínima de aprovação.
 */
export function computeClassStats(students: Student[], opts: StatsOptions): ClassStats {
  const rules = opts.rules || DEFAULT_GRADE_RULES;
  const matriculados = emptyCount();
  const desistidos = emptyCount();
  const transferidos = emptyCount();
  const avaliados = emptyCount();
  const aprovados = emptyCount();
  const reprovados = emptyCount();
  const grades: number[] = [];

  // Notas lançadas por aluno (todas as disciplinas gravadas + a linha da mini-pauta em edição).
  const evidences = students.map((st) => studentGradeEvidence(st, [findMiniRow(st, opts)], opts.enabled));
  const ruleActive = isNoTrimestersRuleActive(opts.currentTrimester, evidences.some((e) => e.t3));

  students.forEach((st, idx) => {
    const g = normalizeGender(st.gender, st.name);
    bump(matriculados, g);

    const { isDesistente, isTransferido } = resolveStudentStanding(studentExitKind(st), evidences[idx], ruleActive);
    // Transferido conta em "Transferidos" e não em "Desistidos" (sem dupla contagem).
    if (isTransferido) {
      bump(transferidos, g);
      return;
    }
    if (isDesistente) {
      bump(desistidos, g);
      return;
    }

    const grade = studentGrade(st, opts);
    if (grade === null) return;

    grades.push(grade);
    bump(avaliados, g);
    if (grade >= rules.passingGrade) bump(aprovados, g);
    else bump(reprovados, g);
  });

  return {
    matriculados,
    desistidos,
    transferidos,
    avaliados,
    reprovados,
    aprovados,
    percentagem: percentOf(aprovados, avaliados),
    averageGrade: grades.length > 0 ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null
  };
}

export function sumCounts(list: GenderCount[]): GenderCount {
  return list.reduce(
    (acc, c) => ({ M: acc.M + c.M, F: acc.F + c.F, MF: acc.MF + c.MF }),
    emptyCount()
  );
}
