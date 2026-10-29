import { Student } from '../types';
import { sortByName } from './alphabetical';

export type RosterStudent = Partial<Student> & {
  id: string;
  procNumber: string;
  name: string;
  email: string;
  avatar: string;
  grade: string;
  section: string;
  cycle: string;
  birthDate: string;
  gender: string;
  financialStatus: 'regular' | 'debito' | string;
  status: 'active' | 'inactive' | 'suspended';
  currentAverage: number;
  unexcusedAbsences: number;
  excusedAbsences: number;
  isTuitionPaidCurrentMonth: boolean;
};

// No demonstration data: a real institution's roster comes exclusively from
// db.students. This map intentionally stays empty.
export const CLASS_ROSTERS: Record<string, RosterStudent[]> = {};

/**
 * Returns the list of enrolled students for a specific class, sourced only
 * from the real database. Returns an empty list when the class has no
 * enrolled students yet — it never invents placeholder students.
 */
export function getStudentsForClass(classId: string, allDbStudents: Student[], className?: string): Student[] {
  // Sempre em ordem alfabética pelo nome do aluno.
  return sortByName((allDbStudents || []).filter((s) => String(s.classId) === String(classId)), (s) => s.name);
}
