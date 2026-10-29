/**
 * Ensino à distância (passo 6): trabalhos online com prazo, entrega pelo aluno e correção
 * pelo professor. Lógica pura e testável.
 *
 * NOTA: não há videoaulas nem ligação a Google Classroom/Moodle/Teams. Aqui há entrega de
 * trabalhos e ligações externas (o professor cola o link da aula/sala). A integração com
 * uma plataforma real é um passo à parte (precisa de conta e chaves da plataforma).
 */

export interface Assignment {
  id: string;
  academicYear: string;
  classId: string;
  className: string;
  subjectId?: string;
  subjectName: string;
  teacherId?: string;
  teacherName: string;
  title: string;
  instructions: string;
  /** AAAA-MM-DDTHH:mm */
  dueAt: string;
  maxGrade: number;
  /** Aceitar entregas depois do prazo (ficam marcadas como atrasadas). */
  allowLate: boolean;
  /** Ligação externa (sala virtual, vídeo, pasta de materiais). */
  externalLink?: string;
  status: 'rascunho' | 'publicado' | 'fechado';
  createdAt: string;
  createdBy: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  text?: string;
  /** Ligação para o ficheiro (Drive, OneDrive, etc.). Não guardamos ficheiros na base de dados. */
  link?: string;
  submittedAt: string;
  late: boolean;
  grade?: number;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
  /** uid de quem entregou: a regra de segurança só deixa o próprio aluno alterar este registo. */
  submitterUid?: string;
}

export type SubmissionState = 'por_entregar' | 'entregue' | 'entregue_atrasado' | 'corrigido' | 'em_falta';

export function validateAssignment(a: Pick<Assignment, 'title' | 'classId' | 'subjectName' | 'dueAt' | 'maxGrade' | 'externalLink'>): string[] {
  const errors: string[] = [];
  if (!a.title.trim()) errors.push('Indique o título do trabalho.');
  if (!a.classId) errors.push('Escolha a turma.');
  if (!a.subjectName.trim()) errors.push('Indique a disciplina.');
  if (!a.dueAt || Number.isNaN(Date.parse(a.dueAt))) errors.push('Indique um prazo válido.');
  if (!(a.maxGrade > 0)) errors.push('A nota máxima tem de ser maior que zero.');
  if (a.externalLink && !isSafeHttpUrl(a.externalLink)) errors.push('A ligação externa tem de começar por http:// ou https://.');
  return errors;
}

/** Só http/https: nunca javascript: nem data: (as ligações são mostradas a outros utilizadores). */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isPastDue(a: Pick<Assignment, 'dueAt'>, nowMs: number): boolean {
  const due = Date.parse(a.dueAt);
  return !Number.isNaN(due) && nowMs > due;
}

export type SubmitResult = { ok: true; submission: Submission } | { ok: false; error: string };

export function submitWork(
  a: Assignment,
  existing: Submission | undefined,
  input: { studentId: string; studentName: string; text?: string; link?: string },
  nowMs: number,
  newId: string
): SubmitResult {
  if (a.status !== 'publicado') return { ok: false, error: 'Este trabalho não está aberto a entregas.' };
  if (!(input.text || '').trim() && !(input.link || '').trim()) return { ok: false, error: 'Escreva a resposta ou indique uma ligação para o ficheiro.' };
  if (input.link && !isSafeHttpUrl(input.link)) return { ok: false, error: 'A ligação tem de começar por http:// ou https://.' };
  if (existing?.grade !== undefined) return { ok: false, error: 'O trabalho já foi corrigido e não pode ser alterado.' };
  const late = isPastDue(a, nowMs);
  if (late && !a.allowLate) return { ok: false, error: 'O prazo terminou e este trabalho não aceita entregas atrasadas.' };
  return {
    ok: true,
    submission: {
      id: existing?.id || newId,
      assignmentId: a.id,
      studentId: input.studentId,
      studentName: input.studentName,
      text: input.text?.trim() || undefined,
      link: input.link?.trim() || undefined,
      submittedAt: new Date(nowMs).toISOString(),
      late
    }
  };
}

export function gradeSubmission(
  a: Assignment,
  s: Submission,
  grade: number,
  feedback: string,
  gradedBy: string,
  nowMs: number
): { ok: true; submission: Submission } | { ok: false; error: string } {
  if (!Number.isFinite(grade) || grade < 0 || grade > a.maxGrade) {
    return { ok: false, error: `A nota tem de estar entre 0 e ${a.maxGrade}.` };
  }
  return { ok: true, submission: { ...s, grade, feedback: feedback.trim() || undefined, gradedBy, gradedAt: new Date(nowMs).toISOString() } };
}

export function submissionState(a: Assignment, s: Submission | undefined, nowMs: number): SubmissionState {
  if (s) {
    if (s.grade !== undefined) return 'corrigido';
    return s.late ? 'entregue_atrasado' : 'entregue';
  }
  return isPastDue(a, nowMs) ? 'em_falta' : 'por_entregar';
}

export const SUBMISSION_STATE_META: Record<SubmissionState, { label: string; badge: string }> = {
  por_entregar: { label: 'Por entregar', badge: 'bg-amber-100 text-amber-800' },
  entregue: { label: 'Entregue', badge: 'bg-blue-100 text-blue-800' },
  entregue_atrasado: { label: 'Entregue (atrasado)', badge: 'bg-orange-100 text-orange-800' },
  corrigido: { label: 'Corrigido', badge: 'bg-emerald-100 text-emerald-800' },
  em_falta: { label: 'Em falta', badge: 'bg-red-100 text-red-800' }
};

export interface AssignmentProgress {
  total: number;
  delivered: number;
  late: number;
  graded: number;
  missing: number;
  average: number | null;
}

export function assignmentProgress(a: Assignment, rosterIds: string[], submissions: Submission[], nowMs: number): AssignmentProgress {
  const byStudent = new Map(submissions.filter((s) => s.assignmentId === a.id).map((s) => [s.studentId, s]));
  let delivered = 0, late = 0, graded = 0, missing = 0, sum = 0;
  for (const id of rosterIds) {
    const s = byStudent.get(id);
    if (s) {
      delivered += 1;
      if (s.late) late += 1;
      if (s.grade !== undefined) { graded += 1; sum += s.grade; }
    } else if (isPastDue(a, nowMs)) {
      missing += 1;
    }
  }
  return { total: rosterIds.length, delivered, late, graded, missing, average: graded > 0 ? Math.round((sum / graded) * 100) / 100 : null };
}
