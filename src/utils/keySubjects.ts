import { Subject } from '../types';

/** Subsistemas de ensino em que uma disciplina pode ser marcada como chave. */
export type KeySubsystemId = 'primario' | 'secundario_1';

export const KEY_SUBSYSTEM_OPTIONS: Array<{ id: KeySubsystemId; label: string; exam: string }> = [
  { id: 'primario', label: 'Ensino Primário', exam: '6.ª Classe' },
  { id: 'secundario_1', label: 'I Ciclo do Ensino Secundário', exam: '9.ª Classe' }
];

function norm(text?: string | null): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Número da classe (6, 9, 12, 13...) a partir de "9.ª Classe", "9ª", etc. */
export function getClassNumber(grade?: string | null): number | null {
  if (!grade) return null;
  const m = String(grade).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * A disciplina é CHAVE para esta classe/curso?
 *  • 6.ª classe  -> marcada como chave do Ensino Primário.
 *  • 9.ª classe  -> marcada como chave do I Ciclo.
 *  • 12.ª/13.ª   -> o curso da turma consta em `keyCourses` da disciplina.
 * Fora das classes de exame, o conceito não se aplica (devolve false).
 */
export function isKeySubjectFor(
  subject: Pick<Subject, 'keySubsystems' | 'keyCourses'> | undefined | null,
  grade?: string | null,
  courseName?: string | null
): boolean {
  if (!subject) return false;
  const n = getClassNumber(grade);
  if (n === 6) return !!subject.keySubsystems?.includes('primario');
  if (n === 9) return !!subject.keySubsystems?.includes('secundario_1');
  if (n === 12 || n === 13) {
    const course = norm(courseName);
    if (!course) return false;
    return (subject.keyCourses || []).some((c) => norm(c) === course);
  }
  return false;
}

/** Texto curto para listagens: "Chave: Primário, I Ciclo, Curso X". */
export function describeKeySubject(subject: Pick<Subject, 'keySubsystems' | 'keyCourses'>): string {
  const parts: string[] = [];
  if (subject.keySubsystems?.includes('primario')) parts.push('Primário (6.ª)');
  if (subject.keySubsystems?.includes('secundario_1')) parts.push('I Ciclo (9.ª)');
  (subject.keyCourses || []).forEach((c) => parts.push(c));
  return parts.join(' • ');
}
