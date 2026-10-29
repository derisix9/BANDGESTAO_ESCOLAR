import type { Matricula, Student, StudentSituation } from '../types';

/**
 * Matrícula mais recente de um aluno: ano lectivo mais novo e, no mesmo ano,
 * a registada por último (uma matrícula cancelada pode ser seguida de uma nova).
 */
export function latestMatriculaOf(matriculas: Matricula[] | undefined, studentId: string): Matricula | undefined {
  const own = (matriculas || []).filter((m) => String(m.studentId) === String(studentId));
  if (own.length === 0) return undefined;
  return [...own].sort((a, b) => {
    const y = String(b.academicYear || '').localeCompare(String(a.academicYear || ''));
    if (y !== 0) return y;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  })[0];
}

/**
 * Situação do aluno mostrada em Alunos. Regra: todo o aluno cuja matrícula mais
 * recente está CANCELADA ou TRANSFERIDA fica "Inactivo", mesmo que a ficha ainda diga
 * outra coisa (dados anteriores a esta regra).
 */
export function resolveStudentSituation(
  student: Pick<Student, 'id' | 'studentSituation'>,
  matriculas: Matricula[] | undefined
): StudentSituation {
  const last = latestMatriculaOf(matriculas, String(student.id));
  if (last?.estado === 'cancelada' || last?.estado === 'transferida') return 'Inactivo';
  return student.studentSituation || 'Activo';
}
