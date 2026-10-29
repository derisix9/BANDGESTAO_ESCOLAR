/**
 * Impedimento de cadastros duplicados (alunos, professores e funcionários).
 *
 * Considera-se a MESMA pessoa quando:
 *  - o nome completo é igual (sem diferenças de maiúsculas, acentos ou espaços) E o número
 *    do documento é igual (B.I., passaporte, cédula, cartão de residente... — ambos vazios
 *    também contam como igual); ou
 *  - o número do documento (quando preenchido) já pertence a outra pessoa, mesmo que o
 *    nome esteja escrito de forma ligeiramente diferente.
 * O documento NÃO é obrigatório: quem não o tem entra só pelo nome completo.
 */
const normName = (v: unknown): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const normDoc = (v: unknown): string => String(v ?? '').replace(/[\s.\-/]/g, '').toUpperCase();

export interface PersonKey {
  id?: string;
  name?: string;
  docs?: Array<string | undefined | null>;
}

export function findDuplicatePerson<T>(
  list: readonly T[] | null | undefined,
  candidate: { name: string; docs: Array<string | undefined | null> },
  toKey: (item: T) => PersonKey,
  excludeId?: string
): T | undefined {
  const name = normName(candidate.name);
  const candDocs = candidate.docs.map(normDoc).filter(Boolean);
  if (!name && candDocs.length === 0) return undefined;

  return (list || []).find((item) => {
    const k = toKey(item);
    if (excludeId && String(k.id) === String(excludeId)) return false;
    const itemDocs = (k.docs || []).map(normDoc).filter(Boolean);
    const sameDoc = candDocs.some((d) => itemDocs.includes(d));
    if (sameDoc) return true;
    const bothWithoutDoc = candDocs.length === 0 && itemDocs.length === 0;
    return !!name && normName(k.name) === name && bothWithoutDoc;
  });
}

export const duplicateMessage = (kind: 'aluno' | 'professor' | 'funcionário', existingName: string): string =>
  `Já existe um ${kind} cadastrado com estes dados ("${existingName}"): mesmo nome completo e mesmo n.º de documento. ` +
  `Não é permitido cadastrar a mesma pessoa duas vezes.`;
