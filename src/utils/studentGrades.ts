import { Student, StudentGradeArchive, StudentTrimesterRecord, Matricula } from '../types';
import { buildAcademicYearList } from './academicYear';

/**
 * Notas de um aluno por Ano Lectivo.
 *
 * `student.trimesterGrades` guarda as notas do ano "vivo" (o Ano Lectivo Ativo, que é o que
 * Pautas, Mini-Pautas e Dashboards lêem). Os anos já encerrados ficam em
 * `student.gradeHistory`. Registos antigos sem `trimesterGradesYear` pertencem ao ano ativo.
 */

/** Ano Lectivo a que pertencem, neste momento, as notas "vivas" do aluno. */
export function getLiveGradesYear(student: Student, currentYear: string): string {
  return student.trimesterGradesYear || currentYear;
}

/** Notas do aluno no Ano Lectivo pedido (vazio quando não há nada registado nesse ano). */
export function getStudentRecordsForYear(
  student: Student,
  year: string,
  currentYear: string
): StudentTrimesterRecord[] {
  if (year === getLiveGradesYear(student, currentYear)) return student.trimesterGrades || [];
  return student.gradeHistory?.find((h) => h.academicYear === year)?.trimesterGrades || [];
}

/** Arquivo do ano pedido, se o ano já foi encerrado para este aluno. */
export function getStudentArchiveForYear(student: Student, year: string): StudentGradeArchive | undefined {
  return student.gradeHistory?.find((h) => h.academicYear === year);
}

/** Matrícula do aluno no Ano Lectivo pedido (turma/curso desse ano), se existir. */
export function findMatriculaForYear(
  matriculas: Matricula[] | undefined,
  studentId: string,
  year: string
): Matricula | undefined {
  return (matriculas || []).find((m) => String(m.studentId) === String(studentId) && m.academicYear === year);
}

/**
 * Anos Lectivos em que este aluno tem registo real: o ano ativo, os anos das suas matrículas
 * e os anos com notas arquivadas — do mais recente para o mais antigo.
 */
export function getStudentAcademicYears(
  student: Student,
  matriculas: Matricula[] | undefined,
  currentYear: string
): string[] {
  return buildAcademicYearList(
    { currentAcademicYear: currentYear },
    [
      student.trimesterGradesYear,
      ...(matriculas || []).filter((m) => String(m.studentId) === String(student.id)).map((m) => m.academicYear),
      ...(student.gradeHistory || []).map((h) => h.academicYear)
    ],
    { includeInstitutionYears: false }
  );
}
