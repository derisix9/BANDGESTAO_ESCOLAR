/**
 * Faltas no conselho de turma.
 *
 * A taxa de faltas sai das cadernetas (AttendanceSheet) já gravadas para a turma: cada caderneta é uma aula dada e
 * cada aluno nela tem P, A (atraso), FJ ou FI. Faltas injustificadas (FI) / aulas registadas do aluno = taxa de faltas.
 * Não se inventa um total de aulas: com poucas cadernetas gravadas a regra não reprova ninguém (só informa).
 * Lógica pura e testável.
 */
import type { AttendanceSheet } from '../types';

/** Percentagem máxima de faltas injustificadas antes de reprovar por faltas (por defeito; configurável por escola). */
export const DEFAULT_MAX_ABSENCE_PERCENT = 25;
/** Abaixo deste nº de aulas registadas a taxa não é fiável: só informa, nunca propõe reprovação. */
export const MIN_LESSONS_FOR_ABSENCE_RULE = 20;
/** A partir de que fracção do limite o conselho é avisado (80% do limite). */
export const ABSENCE_WARNING_FRACTION = 0.8;

export interface AbsenceStats {
  /** Aulas (cadernetas) da turma em que o aluno tem registo. */
  recordedLessons: number;
  unexcused: number;
  excused: number;
  /** FI / aulas registadas, em % (1 casa decimal). */
  unexcusedPercent: number;
}

export type AbsenceVerdict = 'ok' | 'warning' | 'exceeded' | 'insufficient';

export function computeAbsenceStats(
  studentId: string,
  classId: string,
  sheets: AttendanceSheet[] | undefined,
  academicYear?: string
): AbsenceStats {
  let recordedLessons = 0;
  let unexcused = 0;
  let excused = 0;
  for (const sheet of sheets || []) {
    if (String(sheet.classId) !== String(classId)) continue;
    if (academicYear && sheet.academicYear && sheet.academicYear !== academicYear) continue;
    const rec = (sheet.students || []).find((st) => String(st.studentId) === String(studentId));
    if (!rec) continue;
    recordedLessons += 1;
    if (rec.status === 'FI') unexcused += 1;
    else if (rec.status === 'FJ') excused += 1;
  }
  const unexcusedPercent = recordedLessons > 0 ? Math.round((unexcused / recordedLessons) * 1000) / 10 : 0;
  return { recordedLessons, unexcused, excused, unexcusedPercent };
}

export function absenceVerdict(stats: AbsenceStats, maxPercent: number = DEFAULT_MAX_ABSENCE_PERCENT): AbsenceVerdict {
  if (stats.recordedLessons < MIN_LESSONS_FOR_ABSENCE_RULE) return 'insufficient';
  if (stats.unexcusedPercent > maxPercent) return 'exceeded';
  if (stats.unexcusedPercent >= maxPercent * ABSENCE_WARNING_FRACTION) return 'warning';
  return 'ok';
}

/** Frase para a lista de motivos do conselho; null quando não há nada a dizer. */
export function absenceReason(stats: AbsenceStats, maxPercent: number = DEFAULT_MAX_ABSENCE_PERCENT): string | null {
  const v = absenceVerdict(stats, maxPercent);
  const pct = `${stats.unexcusedPercent.toFixed(1)}% (${stats.unexcused} em ${stats.recordedLessons} aulas)`;
  if (v === 'exceeded') return `Faltas injustificadas ${pct} acima do limite de ${maxPercent}%: reprovação por faltas.`;
  if (v === 'warning') return `Faltas injustificadas ${pct}, perto do limite de ${maxPercent}%.`;
  if (v === 'insufficient' && stats.unexcused > 0) {
    return `${stats.unexcused} falta(s) injustificada(s) em ${stats.recordedLessons} aulas registadas: poucas aulas para aplicar o limite de faltas.`;
  }
  return null;
}
