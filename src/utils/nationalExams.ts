/**
 * EXAMES NACIONAIS — calendário, inscrição por aluno e resultados.
 * Lógica pura (sem base de dados), testada em tests/nationalExams.test.ts.
 *
 * Reaproveita o que o sistema já tem: alunos e turmas (inscrição em lote por classe)
 * e a escala 0–20 das pautas. As classes com exame nacional e a nota mínima variam
 * conforme o calendário do MED de cada ano: por isso a escola escolhe a classe ao
 * criar o exame; `SUGGESTED_EXAM_GRADES` é só uma sugestão (confirme no calendário do MED).
 */
import type { ClassRoom, ExamEnrollment, NationalExam, Student } from '../types';

export const EXAM_PASS_MARK = 10;
export const EXAM_MAX_SCORE = 20;
/** Sugestão de classes com exame de fim de ciclo. Confirme no calendário oficial do MED. */
export const SUGGESTED_EXAM_GRADES = ['6.ª Classe', '9.ª Classe', '12.ª Classe', '13.ª Classe'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isRealDate(iso?: string): boolean {
  if (!iso || !ISO.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function gradeKey(g?: string): string {
  const m = String(g || '').match(/(\d+)/);
  return m ? m[1] : String(g || '').trim().toLowerCase();
}

export function validateExam(
  input: { grade: string; subject: string; date: string; startTime?: string; name?: string },
  existing: NationalExam[],
  ignoreId?: string
): string[] {
  const errs: string[] = [];
  if (!input.grade?.trim()) errs.push('Escolha a classe do exame.');
  if (!input.subject?.trim()) errs.push('Indique a disciplina.');
  if (!isRealDate(input.date)) errs.push('Indique uma data válida.');
  if (input.startTime && !TIME.test(input.startTime)) errs.push('Hora inválida (use HH:MM).');
  const clash = existing.find(
    (e) => e.id !== ignoreId && e.status !== 'cancelado' &&
      gradeKey(e.grade) === gradeKey(input.grade) &&
      e.subject.trim().toLowerCase() === input.subject.trim().toLowerCase() &&
      e.date === input.date
  );
  if (clash) errs.push('Já existe um exame desta disciplina, nesta classe e data.');
  // Dois exames da mesma classe à mesma data e hora
  if (input.startTime) {
    const same = existing.find(
      (e) => e.id !== ignoreId && e.status !== 'cancelado' && gradeKey(e.grade) === gradeKey(input.grade) &&
        e.date === input.date && e.startTime === input.startTime
    );
    if (same) errs.push(`A ${same.grade} já tem o exame de ${same.subject} a essa hora.`);
  }
  return errs;
}

export function validateScore(raw: unknown): { ok: boolean; value?: number; error?: string } {
  if (raw === '' || raw === null || raw === undefined) return { ok: false, error: 'Indique a nota.' };
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, error: 'Nota inválida.' };
  if (n < 0 || n > EXAM_MAX_SCORE) return { ok: false, error: `A nota deve estar entre 0 e ${EXAM_MAX_SCORE}.` };
  return { ok: true, value: Math.round(n * 10) / 10 };
}

export type ExamResult = 'aprovado' | 'reprovado' | 'faltou' | 'pendente';

export function resultOf(e: Pick<ExamEnrollment, 'status' | 'score'>): ExamResult {
  if (e.status === 'faltou') return 'faltou';
  if (e.status === 'classificado' && typeof e.score === 'number') return e.score >= EXAM_PASS_MARK ? 'aprovado' : 'reprovado';
  return 'pendente';
}

/** Alunos activos das turmas da classe do exame que ainda não estão inscritos. */
export function eligibleStudents(exam: NationalExam, students: Student[], classes: ClassRoom[], enrollments: ExamEnrollment[]): Student[] {
  const classIds = new Set(classes.filter((c) => gradeKey(c.grade) === gradeKey(exam.grade)).map((c) => String(c.id)));
  const taken = new Set(enrollments.filter((e) => e.examId === exam.id && e.status !== 'anulado').map((e) => e.studentId));
  return students.filter((s) => s.status === 'active' && classIds.has(String(s.classId)) && !taken.has(s.id));
}

export interface ExamSummary {
  inscritos: number; classificados: number; aprovados: number; reprovados: number; faltas: number; pendentes: number;
  taxaAprovacao: number | null; media: number | null;
}

export function summarizeExam(enrollments: ExamEnrollment[]): ExamSummary {
  const active = enrollments.filter((e) => e.status !== 'anulado');
  let aprovados = 0, reprovados = 0, faltas = 0, pendentes = 0, soma = 0, n = 0;
  for (const e of active) {
    const r = resultOf(e);
    if (r === 'aprovado') aprovados++; else if (r === 'reprovado') reprovados++; else if (r === 'faltou') faltas++; else pendentes++;
    if (typeof e.score === 'number' && e.status === 'classificado') { soma += e.score; n++; }
  }
  const classificados = aprovados + reprovados;
  return {
    inscritos: active.length, classificados, aprovados, reprovados, faltas, pendentes,
    taxaAprovacao: classificados > 0 ? Math.round((aprovados / classificados) * 1000) / 10 : null,
    media: n > 0 ? Math.round((soma / n) * 10) / 10 : null
  };
}
