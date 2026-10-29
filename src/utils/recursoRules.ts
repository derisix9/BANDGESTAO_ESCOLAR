/**
 * Regras de acesso ao Exame de Recurso (classes de exame: 6.ª, 9.ª, 12.ª e 13.ª).
 *
 * 1) CONDIÇÃO TRIMESTRAL
 *    O Recurso só existe quando o aluno tem NEGATIVA no III Trimestre. Enquanto a negativa
 *    estiver apenas nos I e/ou II Trimestres (III ainda sem nota), a situação é REPROVADO.
 *
 * 2) CONDIÇÃO POR DURAÇÃO DO CURSO (12.ª e 13.ª classes)
 *    - Curso de 4 anos: o Recurso aplica-se SÓ na 13.ª classe (na 12.ª não há Recurso).
 *    - Curso de 3 anos: o Recurso aplica-se SÓ na 12.ª classe (na 13.ª não há Recurso).
 *    As 6.ª e 9.ª classes não dependem da duração do curso.
 */
import type { ClassRoom, Course } from '../types';

/** Número da classe a partir de "12.ª Classe", "12", "13ª"... (0 se não reconhecido). */
export function classNumberOf(grade: string | null | undefined): number {
  const m = String(grade ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

const norm = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * Duração (em anos) do curso a que a turma pertence. A ligação turma→curso faz-se pela área
 * curricular da turma (= nome do curso), pelos `linkedClassIds` do curso ou pelo código.
 * Devolve undefined se o curso não for encontrado ou não tiver duração válida.
 */
export function resolveCourseDurationYears(
  courses: Course[] | undefined | null,
  cls: Pick<ClassRoom, 'id' | 'area'> | undefined | null
): number | undefined {
  if (!cls || !courses?.length) return undefined;
  const area = norm(cls.area);
  const course =
    courses.find((c) => (c.linkedClassIds || []).some((id) => String(id) === String(cls.id))) ||
    (area ? courses.find((c) => norm(c.name) === area || norm(c.code) === area) : undefined);
  const years = Number(course?.durationYears);
  return Number.isFinite(years) && years > 0 ? years : undefined;
}

/**
 * A classe tem direito a Exame de Recurso, tendo em conta a duração do curso?
 *  - 6.ª e 9.ª: sim (independente da duração);
 *  - 12.ª: só em cursos de 3 anos;
 *  - 13.ª: só em cursos de 4 anos.
 * Se a duração for desconhecida, infere-se pela classe: existir 13.ª classe implica curso de
 * 4 anos; na 12.ª assume-se 3 anos (valor por omissão do sistema).
 */
export function classAllowsRecurso(classGrade: string | null | undefined, courseDurationYears?: number): boolean {
  const n = classNumberOf(classGrade);
  if (n === 6 || n === 9) return true;
  if (n !== 12 && n !== 13) return false;
  const years = courseDurationYears && courseDurationYears > 0 ? courseDurationYears : n === 13 ? 4 : 3;
  return years >= 4 ? n === 13 : n === 12;
}

/** O III Trimestre já tem nota (MT3)? Só então a negativa conduz a Recurso. */
export function hasThirdTrimesterGrade(mt3: number | '' | null | undefined): boolean {
  return typeof mt3 === 'number';
}

/** Motivo (texto) para mostrar ao utilizador quando a classe/curso não tem Recurso. */
export function recursoBlockedReason(classGrade: string | null | undefined, courseDurationYears?: number): string {
  const n = classNumberOf(classGrade);
  if (classAllowsRecurso(classGrade, courseDurationYears)) return '';
  const years = courseDurationYears && courseDurationYears > 0 ? courseDurationYears : n === 13 ? 4 : 3;
  return years >= 4
    ? 'Curso de 4 anos: o Exame de Recurso só se aplica na 13.ª classe.'
    : 'Curso de 3 anos: o Exame de Recurso só se aplica na 12.ª classe.';
}
