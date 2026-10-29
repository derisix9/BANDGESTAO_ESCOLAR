import { SchoolDatabase, Subject, Teacher } from '../types';

function norm(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function stripTitles(name: string): string {
  return norm(name)
    .replace(/\b(prof(a|essor|essora)?|dr|dra|doutor|doutora|eng|enga|mestre|lic)\b\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determina qual o DOCENTE efetivamente responsável por uma disciplina numa dada turma.
 *
 * Ordem de prioridade (apenas fontes reais — nunca o Diretor de Turma por omissão):
 *   0. Atribuição (Secretaria Académica → Atribuição) para a Classe/Curso desta turma —
 *      fonte oficial de "quem lecciona o quê", independentemente de já haver horário lançado.
 *   1. Um tempo lectivo já existente na Grelha Horária para esta turma + disciplina.
 *   2. Um tempo lectivo desta disciplina em QUALQUER turma (o docente da cadeira).
 *   3. A alocação registada na ficha do docente (`allocatedClasses`).
 *   4. O Coordenador da Disciplina definido na Matriz Curricular.
 *   5. O docente cujo Departamento/Área corresponde à disciplina.
 *
 * Se nenhuma destas fontes responder, devolve '' (por atribuir). Atribuir o Diretor de
 * Turma a todas as disciplinas era precisamente o erro que fazia a grelha inteira
 * aparecer com o mesmo nome em todos os tempos lectivos.
 */
export function resolveTeacherForSubject(
  db: SchoolDatabase,
  subject: Pick<Subject, 'name'> & Partial<Subject>,
  classId?: string | null
): string {
  const subjectNorm = norm(subject.name);
  if (!subjectNorm) return '';

  // 0. Atribuição (Secretaria Académica → Atribuição)
  if (classId != null) {
    const classRoom = (db.classes || []).find((c) => String(c.id) === String(classId));
    if (classRoom) {
      const assignment = (db.subjectAssignments || []).find((a) => {
        if (norm(a.subjectName) !== subjectNorm) return false;
        if (norm(a.grade) !== norm(classRoom.grade)) return false;
        const courseKey = norm(classRoom.area || '');
        const assignmentCourseKey = norm(a.courseName || '');
        if (courseKey || assignmentCourseKey) {
          if (courseKey !== assignmentCourseKey) return false;
        }
        // Atribuição com Turmas específicas: só vale para essa turma, não para
        // todas as turmas da Classe/Curso.
        if (a.classIds && a.classIds.length > 0) {
          return a.classIds.some((id) => String(id) === String(classId));
        }
        return true;
      });
      if (assignment) return assignment.teacherName;
    }
  }

  const timetable = db.timetable || [];

  // 1. Mesma turma, mesma disciplina
  const sameClass = timetable.find(
    (e) =>
      classId != null &&
      String(e.classId) === String(classId) &&
      norm(e.subject) === subjectNorm &&
      e.teacherName
  );
  if (sameClass) return sameClass.teacherName;

  // 2. Mesma disciplina noutra turma
  const anyClass = timetable.find((e) => norm(e.subject) === subjectNorm && e.teacherName);
  if (anyClass) return anyClass.teacherName;

  const teachers = db.teachers || [];

  // 3. Alocação registada na ficha do docente
  const byAllocation = teachers.find((t) =>
    (t.allocatedClasses || []).some(
      (a) =>
        norm(a.subject) === subjectNorm &&
        (classId == null || !a.classId || String(a.classId) === String(classId))
    )
  );
  if (byAllocation) return byAllocation.name;

  // 4. Coordenador da disciplina
  if (subject.coordinatorName) {
    const coordinator = teachers.find(
      (t) => stripTitles(t.name) === stripTitles(subject.coordinatorName!)
    );
    if (coordinator) return coordinator.name;
    return subject.coordinatorName;
  }

  // 5. Departamento / área do docente compatível com a disciplina
  const byDepartment = teachers.find((t) => {
    const dep = norm(t.department);
    if (!dep) return false;
    return dep === subjectNorm || dep.includes(subjectNorm) || subjectNorm.includes(dep);
  });
  if (byDepartment) return byDepartment.name;

  return '';
}

/**
 * Lista de docentes candidatos a leccionar uma disciplina, ordenada por afinidade real,
 * para alimentar o seletor "Docente / Professor" sem sugerir sempre o Diretor de Turma.
 */
export function rankTeachersForSubject(
  db: SchoolDatabase,
  subjectName: string
): Teacher[] {
  const subjectNorm = norm(subjectName);
  const teachers = db.teachers || [];
  if (!subjectNorm) return teachers;

  const score = (t: Teacher): number => {
    const teaches = (db.timetable || []).some(
      (e) => norm(e.subject) === subjectNorm && stripTitles(e.teacherName) === stripTitles(t.name)
    );
    if (teaches) return 0;
    if ((t.allocatedClasses || []).some((a) => norm(a.subject) === subjectNorm)) return 1;
    const dep = norm(t.department);
    if (dep && (dep === subjectNorm || dep.includes(subjectNorm) || subjectNorm.includes(dep))) return 2;
    return 3;
  };

  return [...teachers].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
