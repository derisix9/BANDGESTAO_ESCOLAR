import type { Student, User } from '../types';
import { normalizeText } from './guardianLinks';

/**
 * Aluno que corresponde à conta de um utilizador com perfil "aluno": nº de processo, depois
 * e-mail e, por fim, o nome EXATO. Nunca devolve "outro aluno qualquer" (isso mostraria os
 * trabalhos e avaliações de um colega) e nunca usa "contém" no nome.
 */
export function resolveOwnStudent(
  students: Student[],
  user: Pick<User, 'processNumber' | 'email' | 'name'> | null | undefined
): Student | undefined {
  if (!user) return undefined;
  const proc = normalizeText(user.processNumber);
  if (proc) {
    const byProc = students.find((s) => normalizeText(s.procNumber) === proc);
    if (byProc) return byProc;
  }
  const email = normalizeText(user.email);
  if (email) {
    const byEmail = students.find((s) => normalizeText(s.email) === email);
    if (byEmail) return byEmail;
  }
  const name = normalizeText(user.name);
  if (name) {
    const matches = students.filter((s) => normalizeText(s.name) === name);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}
