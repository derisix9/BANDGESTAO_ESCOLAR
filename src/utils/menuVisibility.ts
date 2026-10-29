import { SchoolDatabase, Student, User } from '../types';
import { resolveGuardianChildren } from './guardianLinks';
import { getSubsystemForGrade } from './educationSubsystems';
import { isEarlyYearsGrade } from './earlyYears';
import { getAllocatedClassIdsForUser } from './teacherSubjects';

/**
 * Regras de visibilidade do menu que dependem dos DADOS (e não só do perfil):
 *  • Ensino Superior / Cadeiras & ECTS / Cadeiras Superiores → só se o formando (aluno ou
 *    educando do encarregado) for do Ensino Superior.
 *  • Avaliação Descritiva → só professores com turmas do Nível 1 (Pré-escolar/Creche e
 *    Primário). I e II Ciclo, Médio e Superior não.
 *  • Encarregado → "Avisos e Biblioteca" sai; fica só "Comunicados".
 */

const SUPERIOR_RE = /superior|licenciatura|bacharelato|mestrado|doutoramento/;

export function isSuperiorStudent(student: Student, db: Pick<SchoolDatabase, 'classes'>): boolean {
  const cls = (db.classes || []).find((c) => String(c.id) === String(student.classId));
  if (getSubsystemForGrade(student.grade || '')?.id === 'superior') return true;
  const text = [student.grade, student.className, student.courseName, cls?.grade, cls?.cycle, cls?.area]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return SUPERIOR_RE.test(text);
}

/** O utilizador (aluno ou encarregado) tem algum formando do Ensino Superior? */
export function hasSuperiorStudent(db: SchoolDatabase, user: User): boolean {
  if (user.role === 'encarregado') {
    return resolveGuardianChildren(user, db.students || [], db.guardianLinks || []).some((c) => isSuperiorStudent(c.student, db));
  }
  if (user.role === 'aluno') {
    const proc = (user.processNumber || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    const me = (db.students || []).find(
      (s) => (proc && (s.procNumber || '').toLowerCase() === proc) || (email && (s.email || '').toLowerCase() === email)
    );
    return !!me && isSuperiorStudent(me, db);
  }
  return true;
}

/** O encarregado tem algum educando do Nível 1 (Creche, Pré-escolar ou Primário até à 6.ª classe)? */
export function hasEarlyYearsChild(db: SchoolDatabase, user: User): boolean {
  return resolveGuardianChildren(user, db.students || [], db.guardianLinks || []).some((c) => {
    const cls = (db.classes || []).find((k) => String(k.id) === String(c.student.classId));
    return isEarlyYearsGrade(c.student.grade || '') || isEarlyYearsGrade(cls?.grade || '') || isEarlyYearsGrade(c.student.className || '');
  });
}

/** O professor lecciona em alguma turma do Nível 1 (Pré-escolar / Primário)? */
export function teachesEarlyYears(db: SchoolDatabase, user: User): boolean {
  const allowed = getAllocatedClassIdsForUser(db, user);
  if (!allowed) return true; // não é professor: a regra não se aplica
  return (db.classes || []).some((c) => allowed.has(String(c.id)) && isEarlyYearsGrade(c.grade || c.name));
}

/** Decide se um item do menu (por view) deve ser escondido para este utilizador. */
export function isMenuViewHidden(view: string, db: SchoolDatabase | undefined | null, user: User | undefined | null): boolean {
  if (!user) return false;
  // Encarregado: "Comunicados" substitui "Avisos e Biblioteca".
  if (user.role === 'encarregado' && view === 'mural_biblioteca') return true;
  if (!db) return false;
  if (view === 'ensino_superior' && (user.role === 'encarregado' || user.role === 'aluno')) {
    return !hasSuperiorStudent(db, user);
  }
  // Avaliação Descritiva do encarregado: só com educandos do Nível 1 (sem filhos vinculados também não aparece).
  if ((view === 'encarregado_descritiva' || view === 'avaliacao_descritiva') && user.role === 'encarregado') {
    return !hasEarlyYearsChild(db, user);
  }
  if (view === 'avaliacao_descritiva' && user.role === 'professor') {
    return !teachesEarlyYears(db, user);
  }
  return false;
}
