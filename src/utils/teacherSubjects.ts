import { SchoolDatabase, Subject, User, TimetableEntry, TeacherAllocation, Teacher } from '../types';
import { assignmentAppliesTo, getAssignedSubjectsForGrade } from './classSubjects';

function normalizeText(text?: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Returns the list of curricular disciplines available for a user.
 * For administrators and coordinators, all registered disciplines in the school database are shown.
 * For teachers (role === 'professor'), only the disciplines that they actually teach are shown.
 *
 * Fonte prioritária: Secretaria Académica → Atribuição (`db.subjectAssignments`), que define
 * oficialmente qual professor lecciona cada disciplina, por Classe/Curso. As fontes legadas
 * (alocações de turma, grelha horária, coordenação de disciplina) continuam a ser somadas, para
 * instituições que ainda não tenham preenchido a Atribuição para todas as classes.
 */
export function getAvailableSubjectsForUser(db: SchoolDatabase, currentUser?: User | null): Subject[] {
  const allSubjects = db.subjects || [];
  if (!currentUser || currentUser.role !== 'professor') {
    return allSubjects;
  }

  // Locate teacher profile in database
  const userEmail = normalizeText(currentUser.email);
  const userName = normalizeText(currentUser.name);
  const userProc = normalizeText(currentUser.processNumber || '');

  const teacher = (db.teachers || []).find(
    (t) =>
      t.id === currentUser.id ||
      (t.email && normalizeText(t.email) === userEmail) ||
      (t.name && normalizeText(t.name) === userName) ||
      (userProc && t.agentNumber && normalizeText(t.agentNumber) === userProc)
  );

  const taughtSubjectsList: { name: string; code?: string; classId?: string }[] = [];
  const assignedSubjectIds = new Set<string>();

  // 0. Atribuição (Secretaria Académica → Atribuição): fonte oficial — todas as
  //    disciplinas que este professor está atribuído a lecionar, em qualquer Classe/Curso.
  (db.subjectAssignments || []).forEach((a) => {
    const matchesTeacher =
      (teacher && a.teacherId === teacher.id) ||
      (a.teacherName && normalizeText(a.teacherName) === userName);
    if (matchesTeacher && a.subjectName) {
      taughtSubjectsList.push({ name: a.subjectName });
      if (a.subjectId) assignedSubjectIds.add(a.subjectId);
    }
  });

  if (teacher) {
    // 1. From allocated classes
    (teacher.allocatedClasses || []).forEach((alloc) => {
      if (alloc.subject) {
        taughtSubjectsList.push({ name: alloc.subject, classId: alloc.classId });
      }
    });

    // 2. From timetable
    (db.timetable || []).forEach((item) => {
      if (item.teacherName && normalizeText(item.teacherName) === normalizeText(teacher.name)) {
        if (item.subject) {
          taughtSubjectsList.push({ name: item.subject, classId: item.classId });
        }
      }
    });
  } else {
    // Match against timetable by current user name
    (db.timetable || []).forEach((item) => {
      if (item.teacherName && normalizeText(item.teacherName) === userName) {
        if (item.subject) {
          taughtSubjectsList.push({ name: item.subject, classId: item.classId });
        }
      }
    });
  }

  const taughtNamesNormalized = new Set(taughtSubjectsList.map((t) => normalizeText(t.name)));

  // Filter existing registered subjects that match what this teacher teaches
  const matchedSubjects: Subject[] = allSubjects.filter((s) => {
    if (assignedSubjectIds.has(s.id)) return true;
    const sNameNorm = normalizeText(s.name);
    const sCodeNorm = normalizeText(s.code);

    if (taughtNamesNormalized.has(sNameNorm) || taughtNamesNormalized.has(sCodeNorm)) {
      return true;
    }

    for (const taught of taughtNamesNormalized) {
      if (!taught) continue;
      if (sNameNorm.includes(taught) || taught.includes(sNameNorm)) {
        return true;
      }
      // Common subject keywords
      const keywords = taught.split(/\s+/).filter((w) => w.length >= 4);
      if (keywords.some((k) => sNameNorm.includes(k))) {
        return true;
      }
    }

    // Also include if the teacher is the designated subject coordinator
    if (
      teacher &&
      s.coordinatorName &&
      (normalizeText(s.coordinatorName) === normalizeText(teacher.name) ||
        normalizeText(teacher.name).includes(normalizeText(s.coordinatorName)))
    ) {
      return true;
    }

    return false;
  });

  // If teacher has allocated subjects not yet formally in db.subjects, synthesize valid entries so they can be selected
  const seenNames = new Set(matchedSubjects.map((s) => normalizeText(s.name)));
  taughtSubjectsList.forEach((taught, idx) => {
    const tNorm = normalizeText(taught.name);
    if (!seenNames.has(tNorm) && !matchedSubjects.some((s) => normalizeText(s.name).includes(tNorm) || tNorm.includes(normalizeText(s.name)))) {
      seenNames.add(tNorm);
      matchedSubjects.push({
        id: `taught-sub-${idx + 1}-${tNorm.slice(0, 4)}`,
        name: taught.name,
        code: taught.name.slice(0, 3).toUpperCase(),
        cycle: 'Ensino Regular',
        weeklyHours: 4,
        status: 'Aprovada'
      });
    }
  });

  // Strictly return only what the teacher teaches. If none allocated, return empty array.
  return matchedSubjects;
}

/**
 * Restringe uma lista de disciplinas (normalmente já filtrada por Classe/Curso via
 * `getSubjectsForClass`) às que o utilizador pode ver: para Admin/Direção/Secretaria
 * devolve a lista tal como veio; para um Professor, restringe às disciplinas que lhe
 * estão atribuídas (via `getAvailableSubjectsForUser`, cuja fonte oficial é a
 * Atribuição) E que essa Classe/Turma realmente tem.
 *
 * Sem fallback: se a turma não tiver nenhuma disciplina atribuída (lista de
 * entrada vazia), ou se este professor não leccionar nenhuma das disciplinas
 * atribuídas a essa turma, o resultado é uma lista vazia — um professor só
 * pode lançar notas/assiduidade nas suas próprias turmas e apenas na(s)
 * disciplina(s) que realmente lecciona nelas, nunca "noutra disciplina
 * qualquer que ele dê noutra turma" como substituto.
 *
 * `classId`, quando indicado, aplica ainda a restrição de Turmas de uma
 * Atribuição (`SubjectClassAssignment.classIds`): quando a Atribuição desta
 * disciplina/classe seleccionou turmas específicas, um professor só a vê
 * filtrada aqui se a turma atual estiver entre elas.
 */
export function filterSubjectsForUser(
  subjects: Subject[],
  db: SchoolDatabase,
  currentUser?: User | null,
  classId?: string | number | null
): Subject[] {
  if (!currentUser || currentUser.role !== 'professor') return subjects;
  const teacherSubjects = getAvailableSubjectsForUser(db, currentUser);
  const teacherKeys = new Set(teacherSubjects.map((s) => normalizeText(s.name)));
  let result = subjects.filter((s) => teacherKeys.has(normalizeText(s.name)));

  if (classId != null) {
    const classRoom = (db.classes || []).find((c) => String(c.id) === String(classId));
    if (classRoom) {
      const userEmail = normalizeText(currentUser.email);
      const userName = normalizeText(currentUser.name);
      const teacher = (db.teachers || []).find(
        (t) =>
          t.id === currentUser.id ||
          (t.email && normalizeText(t.email) === userEmail) ||
          (t.name && normalizeText(t.name) === userName)
      );
      const relevantAssignments = (db.subjectAssignments || []).filter((a) => {
        const matchesTeacher = (teacher && a.teacherId === teacher.id) || normalizeText(a.teacherName) === userName;
        if (!matchesTeacher) return false;
        // Classe/Curso/Ano (sem restrição de turma: essa é tratada logo a seguir).
        return assignmentAppliesTo(a, { grade: classRoom.grade, courseName: classRoom.area, academicYear: classRoom.academicYear });
      });
      result = result.filter((s) => {
        const assignment = relevantAssignments.find((a) => normalizeText(a.subjectName) === normalizeText(s.name));
        if (!assignment) return true; // sem Atribuição casada, não bloqueia (fontes legadas)
        if (!assignment.classIds || assignment.classIds.length === 0) return true; // "Todas as turmas"
        return assignment.classIds.some((id) => String(id) === String(classId));
      });
    }
  }

  return result;
}

/**
 * Returns the set of class IDs (as strings) a teacher is allocated to,
 * used to scope "Visualizar Processo Completo" (Módulo Alunos) to only the
 * teacher's own classes per a Matriz de Perfis & Permissões.
 * Returns null for non-teacher roles, meaning "no restriction to apply here".
 */
export function getAllocatedClassIdsForUser(db: SchoolDatabase, currentUser?: User | null): Set<string> | null {
  if (!currentUser || currentUser.role !== 'professor') {
    return null;
  }

  const userEmail = normalizeText(currentUser.email);
  const userName = normalizeText(currentUser.name);
  const userProc = normalizeText(currentUser.processNumber || '');

  const teacher = (db.teachers || []).find(
    (t) =>
      t.id === currentUser.id ||
      (t.email && normalizeText(t.email) === userEmail) ||
      (t.name && normalizeText(t.name) === userName) ||
      (userProc && t.agentNumber && normalizeText(t.agentNumber) === userProc)
  );

  const classIds = new Set<string>();

  // 0. Atribuição (Secretaria Académica → Atribuição): cobre TODAS as turmas da
  //    Classe/Curso a que este professor foi atribuído, mesmo sem horário/alocação lançados.
  const myAssignments = (db.subjectAssignments || []).filter(
    (a) => (teacher && a.teacherId === teacher.id) || (a.teacherName && normalizeText(a.teacherName) === userName)
  );
  if (myAssignments.length > 0) {
    (db.classes || []).forEach((c) => {
      const matches = myAssignments.some((a) =>
        assignmentAppliesTo(a, { grade: c.grade, courseName: c.area, academicYear: c.academicYear, classId: c.id })
      );
      if (matches) classIds.add(String(c.id));
    });
  }

  if (teacher) {
    (teacher.allocatedClasses || []).forEach((alloc) => {
      if (alloc.classId) classIds.add(String(alloc.classId));
    });
    (db.timetable || []).forEach((item) => {
      if (item.teacherName && normalizeText(item.teacherName) === normalizeText(teacher.name) && item.classId) {
        classIds.add(String(item.classId));
      }
    });
  } else {
    (db.timetable || []).forEach((item) => {
      if (item.teacherName && normalizeText(item.teacherName) === userName && item.classId) {
        classIds.add(String(item.classId));
      }
    });
  }

  return classIds;
}

// Indexed by JS Date.getDay() (0 = Sunday .. 6 = Saturday). Weekends never match real
// timetable entries (which only use the 5 weekday values), so they're just placeholders here.
const WEEKDAY_NAMES: string[] = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

/**
 * Returns the Portuguese weekday name (as used in TimetableEntry.dayOfWeek) for a given
 * date string ("YYYY-MM-DD"). Returns an empty string if the date is invalid.
 */
export function getDayOfWeekFromDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return WEEKDAY_NAMES[parsed.getDay()] || '';
}

/**
 * Returns the timetable entries (Grelha Horária) for a given class + subject + weekday,
 * sorted by start time. Matching is done leniently (case/accents-insensitive) on subject name.
 */
export function getTimetableEntriesForClassSubjectDay(
  db: SchoolDatabase,
  classId?: string | number | null,
  subjectName?: string | null,
  dayOfWeek?: string | null
): TimetableEntry[] {
  if (!classId || !subjectName || !dayOfWeek) return [];
  const normalizedSubject = normalizeText(subjectName);
  const normalizedDay = normalizeText(dayOfWeek);

  return (db.timetable || [])
    .filter(
      (entry) =>
        String(entry.classId) === String(classId) &&
        normalizeText(entry.subject) === normalizedSubject &&
        normalizeText(entry.dayOfWeek) === normalizedDay
    )
    .sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''));
}

/**
 * Formats a list of timetable entries for the same day into a single display string,
 * e.g. "08:30–10:00" or "08:30–10:00, 10:15–11:00" when there is more than one slot.
 */
export function formatTimetableEntriesAsSlot(entries: TimetableEntry[]): string {
  if (!entries || entries.length === 0) return '';
  return entries.map((entry) => `${entry.timeStart}–${entry.timeEnd}`).join(', ');
}

/**
 * Disciplinas oficialmente atribuídas a uma turma específica (Secretaria
 * Académica → Atribuição) — nunca uma lista genérica de todas as disciplinas
 * do sistema, nem herdadas de outra turma. Usada para que a Folha de
 * Chamada/Presença de Prova e a Assiduidade só ofereçam disciplinas que
 * aquela turma realmente tem atribuídas. Uma turma sem Atribuição lançada
 * devolve uma lista vazia (ver `getAssignedSubjectsForGrade` em
 * utils/classSubjects.ts, a mesma fonte única usada em toda a aplicação).
 */
export function getSubjectsTaughtInClass(db: SchoolDatabase, classId?: string | number | null): string[] {
  if (!classId) return [];
  const classRoom = (db.classes || []).find((c) => String(c.id) === String(classId));
  if (!classRoom) return [];
  return getAssignedSubjectsForGrade(db, classRoom.grade, classRoom.area, classRoom.academicYear, classRoom.id)
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, 'pt'));
}

/**
 * Entradas da Grelha Horária de uma turma + disciplina, independentemente do
 * dia da semana — usada para sugerir automaticamente o horário e a sala reais
 * dessa aula quando se gera a Folha de Chamada/Presença de Prova (o operador
 * pode depois ajustar apenas a hora, se a prova ocorrer num horário especial).
 */
export function getTimetableEntriesForClassSubject(
  db: SchoolDatabase,
  classId?: string | number | null,
  subjectName?: string | null
): TimetableEntry[] {
  if (!classId || !subjectName) return [];
  const normalizedSubject = normalizeText(subjectName);
  return (db.timetable || [])
    .filter(
      (entry) => String(entry.classId) === String(classId) && normalizeText(entry.subject) === normalizedSubject
    )
    .sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''));
}

/**
 * Remove tratamentos/títulos ("Prof.", "Professor", "Dr.", "Dra.", "Eng.") do nome do docente,
 * para que a Grelha Horária ("Prof. João Silva") case com a ficha do docente ("João Silva").
 */
function stripTeacherTitles(name: string): string {
  return normalizeText(name)
    .replace(/\b(prof(a|essor|essora)?|dr|dra|doutor|doutora|eng|enga|mestre|lic)\b\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara nomes de docente de forma tolerante (títulos, acentos, nome parcial). */
function teacherNamesMatch(candidate: string, normalizedTarget: string): boolean {
  const c = stripTeacherTitles(candidate);
  if (!c || !normalizedTarget) return false;
  if (c === normalizedTarget) return true;
  // Nome abreviado na grelha vs. nome completo na ficha (ou vice-versa).
  return c.includes(normalizedTarget) || normalizedTarget.includes(c);
}

function parseHoursBetween(timeStart: string, timeEnd: string): number {
  const [sh, sm] = (timeStart || '').split(':').map((n) => Number(n) || 0);
  const [eh, em] = (timeEnd || '').split(':').map((n) => Number(n) || 0);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  return minutes > 0 ? minutes / 60 : 0;
}

/**
 * Deriva a Distribuição Curricular & Carga Horária Letiva de um professor a partir da
 * Grelha Horária real (db.timetable) — nunca de um valor manualmente preenchido e
 * potencialmente desatualizado. Agrupa por turma + disciplina e soma as horas semanais
 * reais de cada entrada da grelha (todos os dias da semana em que a disciplina é dada
 * àquela turma por este professor).
 */
export function getTeacherCurricularDistribution(db: SchoolDatabase, teacher: Teacher | null | undefined): TeacherAllocation[] {
  if (!teacher) return [];
  const normalizedTeacherName = stripTeacherTitles(teacher.name);
  const groups = new Map<string, TeacherAllocation & { entriesCount: number }>();

  (db.timetable || [])
    .filter((entry) => entry.teacherName && teacherNamesMatch(entry.teacherName, normalizedTeacherName))
    .forEach((entry) => {
      const key = `${entry.classId}__${normalizeText(entry.subject)}`;
      const classRoom = (db.classes || []).find((c) => String(c.id) === String(entry.classId));
      const hours = parseHoursBetween(entry.timeStart, entry.timeEnd);
      const existing = groups.get(key);
      if (existing) {
        existing.hoursWeekly += hours;
        existing.entriesCount += 1;
        if (!existing.room && entry.room) existing.room = entry.room;
      } else {
        groups.set(key, {
          classId: String(entry.classId),
          className: classRoom?.name || entry.classId,
          subject: entry.subject,
          hoursWeekly: hours,
          room: entry.room || undefined,
          entriesCount: 1
        });
      }
    });

  return Array.from(groups.values())
    .map(({ entriesCount, ...allocation }) => ({
      ...allocation,
      hoursWeekly: Math.round(allocation.hoursWeekly * 10) / 10
    }))
    .sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
}
