import {
  GuardianRelation,
  GuardianStudentLink,
  GuardianUnlinkReason,
  Student,
  User
} from '../types';

/**
 * VÍNCULO / DESVÍNCULO DE FILHOS — regras de negócio (sem React nem Firebase).
 *
 * Um Encarregado de Educação é uma conta de utilizador com perfil 'encarregado'.
 * O que ele consegue ver no Portal Online (notas, boletim, finanças) é decidido
 * aqui, num único sítio:
 *
 *  1. Vínculo ATIVO registado em Serviços → Vínculo/Desvínculo de Filhos.
 *  2. Acesso "implícito" herdado da ficha do Aluno (contas criadas antes deste
 *     módulo existir): `linkedStudentId` da conta, e-mail igual ao do encarregado
 *     na ficha, ou nome igual quando a ficha não tem e-mail.
 *  3. Um Desvínculo registado BLOQUEIA sempre o acesso implícito — sem isto,
 *     desvincular um filho não teria qualquer efeito enquanto a ficha do aluno
 *     continuasse a apontar para o mesmo e-mail.
 */

export const GUARDIAN_RELATION_LABELS: Record<GuardianRelation, string> = {
  pai: 'Pai',
  mae: 'Mãe',
  avo: 'Avô / Avó',
  tio: 'Tio / Tia',
  irmao: 'Irmão / Irmã (maior de idade)',
  padrasto_madrasta: 'Padrasto / Madrasta',
  tutor_legal: 'Tutor Legal',
  outro: 'Outro'
};

export const UNLINK_REASON_LABELS: Record<GuardianUnlinkReason, string> = {
  erro_cadastro: 'Vínculo criado por engano / erro de cadastro',
  mudanca_encarregado: 'Mudança de Encarregado de Educação',
  decisao_judicial: 'Decisão judicial / tutela',
  pedido_encarregado: 'A pedido do próprio Encarregado',
  aluno_saiu: 'Aluno transferido ou concluiu os estudos',
  outro: 'Outro motivo'
};

export function normalizeText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Últimos 9 dígitos de um telefone (ignora +244, espaços e hífenes). */
export function phoneKey(value?: string | null): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

/**
 * Interpreta `birthDate` (aceita "DD/MM/AAAA", "DD-MM-AAAA" ou "AAAA-MM-DD")
 * devolvendo ano/mês/dia. Quando só é possível recuperar o ano (ex.: texto
 * livre com apenas 4 dígitos), assume 1 de Janeiro — a mesma convenção já
 * usada em `calculateBirthYearAndAge` (utils/pautaCalculations.ts).
 */
function parseBirthDateParts(birthDateStr?: string): { year: number; month: number; day: number } | null {
  if (!birthDateStr) return null;
  const trimmed = birthDateStr.trim();

  if (trimmed.includes('/') || trimmed.includes('-')) {
    const delimiter = trimmed.includes('/') ? '/' : '-';
    const parts = trimmed.split(delimiter).map((p) => p.trim());
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        // DD/MM/AAAA ou DD-MM-AAAA
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) return { year, month, day };
      } else if (parts[0].length === 4) {
        // AAAA-MM-DD
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) return { year, month, day };
      }
    }
  }

  const match = trimmed.match(/(19\d\d|20\d\d)/);
  if (match) {
    return { year: parseInt(match[1], 10), month: 1, day: 1 };
  }

  return null;
}

/**
 * Determina se um aluno já é maior de idade (18 anos ou mais) na data de
 * referência (por omissão, hoje).
 *
 * Regra de negócio (Portal do Encarregado — ver AlunoPortalView.tsx):
 *  - Aluno MAIOR (>= 18 anos): o boletim só fica visível/imprimível na área
 *    do Encarregado depois de o próprio aluno o enviar ("Enviar Boletim ao
 *    Encarregado"), respeitando a autonomia do aluno adulto.
 *  - Aluno MENOR (< 18 anos): o Encarregado de Educação tem sempre acesso
 *    às notas do seu educando, sem depender de qualquer envio/permissão do
 *    aluno — é o Encarregado, e não o menor, quem responde legalmente por ele.
 *
 * Sem uma data de nascimento válida na ficha, assume-se maioridade (mantém o
 * comportamento mais cauteloso: exige o envio em vez de abrir acesso
 * automático por falta de informação).
 */
export function isStudentAdult(birthDateStr?: string, referenceDate: Date = new Date()): boolean {
  const parts = parseBirthDateParts(birthDateStr);
  if (!parts) return true;

  const birthDate = new Date(parts.year, parts.month - 1, parts.day);
  if (isNaN(birthDate.getTime())) return true;

  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const alreadyHadBirthdayThisYear =
    referenceDate.getMonth() > birthDate.getMonth() ||
    (referenceDate.getMonth() === birthDate.getMonth() && referenceDate.getDate() >= birthDate.getDate());
  if (!alreadyHadBirthdayThisYear) age -= 1;

  return age >= 18;
}

export type ChildAccessSource = 'vinculo' | 'ficha';

export interface GuardianChild {
  student: Student;
  /** 'vinculo' = vínculo registado; 'ficha' = herdado dos dados da ficha do aluno. */
  source: ChildAccessSource;
  link?: GuardianStudentLink;
}

type GuardianIdentity = Pick<User, 'id' | 'email' | 'name' | 'linkedStudentId'>;

/** A ficha do aluno aponta para esta conta de Encarregado? (acesso implícito) */
export function isImplicitGuardianMatch(user: GuardianIdentity, student: Student): boolean {
  if (user.linkedStudentId && user.linkedStudentId === student.id) return true;

  const userEmail = normalizeText(user.email);
  const ficheEmail = normalizeText(student.guardianEmail);
  if (userEmail && ficheEmail && userEmail === ficheEmail) return true;

  // Sem e-mail na ficha, o nome exato é o único elo possível. Nunca "contém":
  // "Maria" não pode abrir a ficha de quem tem "Ana Maria Santos" como encarregada.
  const userName = normalizeText(user.name);
  if (!ficheEmail && userName && userName === normalizeText(student.guardianName)) return true;

  return false;
}

/**
 * Educandos a que esta conta de Encarregado tem acesso: vínculos ativos +
 * acesso implícito da ficha, exceto os pares explicitamente desvinculados.
 */
export function resolveGuardianChildren(
  user: GuardianIdentity,
  students: Student[],
  links: GuardianStudentLink[] = []
): GuardianChild[] {
  const active = new Map<string, GuardianStudentLink>();
  const blocked = new Set<string>();
  for (const link of links) {
    if (link.guardianUserId !== user.id) continue;
    if (link.status === 'ativo') active.set(link.studentId, link);
    else blocked.add(link.studentId);
  }

  const result: GuardianChild[] = [];
  for (const student of students) {
    const link = active.get(student.id);
    if (link) {
      result.push({ student, source: 'vinculo', link });
    } else if (!blocked.has(student.id) && isImplicitGuardianMatch(user, student)) {
      result.push({ student, source: 'ficha' });
    }
  }
  return result.sort((a, b) => a.student.name.localeCompare(b.student.name, 'pt'));
}

export interface GuardianSuggestion {
  student: Student;
  reason: string;
}

/**
 * Educandos que provavelmente pertencem a este Encarregado mas ainda não têm
 * acesso: mesmo telefone ou mesmo nome de encarregado na ficha. Nunca sugere
 * um par que a escola já desvinculou de propósito.
 */
export function suggestStudentsForGuardian(
  user: Pick<User, 'id' | 'email' | 'name' | 'phone' | 'linkedStudentId'>,
  students: Student[],
  links: GuardianStudentLink[] = []
): GuardianSuggestion[] {
  const hasAccess = new Set(resolveGuardianChildren(user, students, links).map((c) => c.student.id));
  const blocked = new Set(
    links.filter((l) => l.guardianUserId === user.id && l.status === 'desvinculado').map((l) => l.studentId)
  );
  const userPhone = phoneKey(user.phone);
  const userName = normalizeText(user.name);

  const out: GuardianSuggestion[] = [];
  for (const s of students) {
    if (hasAccess.has(s.id) || blocked.has(s.id)) continue;
    if (userPhone && phoneKey(s.guardianPhone) === userPhone) {
      out.push({ student: s, reason: 'Mesmo telefone do Encarregado na ficha' });
    } else if (userName && userName === normalizeText(s.guardianName)) {
      out.push({ student: s, reason: 'Mesmo nome de Encarregado na ficha' });
    }
  }
  return out.sort((a, b) => a.student.name.localeCompare(b.student.name, 'pt'));
}

/** Mapeia o texto livre de `guardianRelation` (ficha) para o tipo de relação. */
export function relationFromText(text?: string | null): GuardianRelation {
  const t = normalizeText(text);
  if (!t) return 'outro';
  if (/\bpai\b/.test(t)) return 'pai';
  if (/\bmae\b/.test(t)) return 'mae';
  if (/\bavo\b|\bavos\b/.test(t)) return 'avo';
  if (/\btio\b|\btia\b/.test(t)) return 'tio';
  if (/\birmao\b|\birma\b/.test(t)) return 'irmao';
  if (/padrasto|madrasta/.test(t)) return 'padrasto_madrasta';
  if (/tutor/.test(t)) return 'tutor_legal';
  return 'outro';
}

export function relationLabel(link: Pick<GuardianStudentLink, 'relation' | 'relationOther'>): string {
  if (link.relation === 'outro' && link.relationOther?.trim()) return link.relationOther.trim();
  return GUARDIAN_RELATION_LABELS[link.relation] || 'Outro';
}

/** Alunos (não transferidos) que nenhuma conta de Encarregado consegue ver. */
export function studentsWithoutGuardianAccess(
  guardians: GuardianIdentity[],
  students: Student[],
  links: GuardianStudentLink[] = []
): Student[] {
  const covered = new Set<string>();
  for (const g of guardians) {
    for (const c of resolveGuardianChildren(g, students, links)) covered.add(c.student.id);
  }
  return students
    .filter((s) => s.status !== 'transferred' && !covered.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}
