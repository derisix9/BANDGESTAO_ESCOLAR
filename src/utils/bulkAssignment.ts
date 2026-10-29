import type { Course, Subject, SubjectClassAssignment } from '../types';
import { normalizeGradeKey, isUpperLevelGrade } from './educationSubsystems';

const norm = (text?: string): string =>
  (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/** A disciplina serve este Curso? (Tronco Comum, sem área, ou área igual ao curso.) */
export function subjectFitsCourse(subject: Pick<Subject, 'area'>, courseName: string): boolean {
  const area = norm(subject.area);
  return !area || area === 'tronco comum' || area === norm(courseName);
}

/** Cursos activos que se aplicam a uma classe (sem lista de classes = aplica-se a todas). */
export function coursesForGradeOf(courses: Course[] | undefined, grade: string): Course[] {
  return (courses || []).filter(
    (c) =>
      c.status === 'ativo' &&
      (!c.grades || c.grades.length === 0 || c.grades.some((g) => normalizeGradeKey(g) === normalizeGradeKey(grade)))
  );
}

export type BulkAction = 'create' | 'replace' | 'unchanged' | 'exists' | 'ineligible';

export interface BulkPlanItem {
  grade: string;
  courseName?: string;
  subjectId: string;
  subjectName: string;
  action: BulkAction;
  /** Atribuição já existente (para `replace`/`unchanged`/`exists`). */
  existingId?: string;
}

export interface BulkPlanInput {
  year: string;
  teacherId: string;
  subjects: Array<Pick<Subject, 'id' | 'name' | 'area'>>;
  grades: string[];
  /** Cursos escolhidos; só contam nas classes a partir da 10.ª. */
  courseNames: string[];
  courses: Course[];
  existing: SubjectClassAssignment[];
  /** Se a disciplina já estiver atribuída a outro professor: substitui (true) ou deixa como está (false). */
  replaceExisting: boolean;
}

export interface BulkPlan {
  items: BulkPlanItem[];
  /** Classes a partir da 10.ª em que não há nenhum dos cursos escolhidos aplicável. */
  gradesWithoutCourse: string[];
}

/**
 * Calcula, sem gravar nada, o que a atribuição em massa vai fazer: um professor × várias
 * disciplinas × várias classes (× cursos, a partir da 10.ª). A regra de unicidade mantém-se:
 * uma disciplina só tem UM professor por (ano, classe, curso).
 */
export function planBulkAssignments(input: BulkPlanInput): BulkPlan {
  const items: BulkPlanItem[] = [];
  const gradesWithoutCourse: string[] = [];

  for (const grade of input.grades) {
    let courseTargets: Array<string | undefined> = [undefined];
    if (isUpperLevelGrade(grade)) {
      const applicable = coursesForGradeOf(input.courses, grade).filter((c) => input.courseNames.includes(c.name));
      if (applicable.length === 0) {
        gradesWithoutCourse.push(grade);
        continue;
      }
      courseTargets = applicable.map((c) => c.name);
    }

    for (const courseName of courseTargets) {
      for (const subject of input.subjects) {
        const base = { grade, courseName, subjectId: subject.id, subjectName: subject.name };
        if (courseName && !subjectFitsCourse(subject, courseName)) {
          items.push({ ...base, action: 'ineligible' });
          continue;
        }
        const found = input.existing.find(
          (a) =>
            a.academicYear === input.year &&
            normalizeGradeKey(a.grade) === normalizeGradeKey(grade) &&
            norm(a.courseName) === norm(courseName) &&
            a.subjectId === subject.id
        );
        if (!found) items.push({ ...base, action: 'create' });
        else if (found.teacherId === input.teacherId) items.push({ ...base, action: 'unchanged', existingId: found.id });
        else items.push({ ...base, action: input.replaceExisting ? 'replace' : 'exists', existingId: found.id });
      }
    }
  }
  return { items, gradesWithoutCourse };
}

export function summarizeBulkPlan(items: BulkPlanItem[]): Record<BulkAction, number> {
  const out: Record<BulkAction, number> = { create: 0, replace: 0, unchanged: 0, exists: 0, ineligible: 0 };
  items.forEach((i) => (out[i.action] += 1));
  return out;
}
