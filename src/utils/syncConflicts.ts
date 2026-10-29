/**
 * Conflitos de edição na sincronização (lógica pura e testável).
 *
 * O envio faz-se por campo ("id/campo"). Antes, se outra pessoa tinha gravado o mesmo campo entretanto, a nossa
 * versão passava por cima da dela em silêncio. Agora cada campo editado leva consigo a "impressão" (hash) do valor
 * que o utilizador viu quando começou a editar. No envio compara-se com o valor actual do servidor:
 *   • servidor igual ao que vimos      → ninguém mexeu: envia;
 *   • servidor já igual ao nosso       → convergiu: nada a fazer;
 *   • servidor diferente de ambos      → CONFLITO: o campo não é enviado e o utilizador escolhe.
 * Sem impressão conhecida (edição antiga, antes desta versão) mantém-se o comportamento anterior.
 */
import { ORDER_FIELD } from './shardSync';

export interface SyncConflict {
  /** colecção/registo/campo — identifica o conflito de forma estável. */
  id: string;
  collection: string;
  recordId: string;
  field: string;
  /** Nome legível do registo (aluno, turma…), para o ecrã de resolução. */
  recordLabel: string;
  /** O que o utilizador escreveu (undefined/null = apagou o valor). */
  mine: unknown;
  /** O que está agora no servidor. */
  theirs: unknown;
  detectedAt: string;
}

export const conflictId = (collection: string, recordId: string, field: string): string => `${collection}/${recordId}/${field}`;

/** JSON com chaves ordenadas: o mesmo valor dá sempre o mesmo texto. */
export function stableStringify(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Impressão de 16 hex (dois hashes de 32 bits). undefined e null são o mesmo ("campo vazio"). */
export function hashValue(v: unknown): string {
  const s = stableStringify(v);
  let a = 5381, b = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = Math.imul(b ^ c, 16777619);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export interface FieldConflict { field: string; mine: unknown; theirs: unknown }

/**
 * @param patch    campos que queremos gravar (null = apagar)
 * @param current  dados actuais do registo no servidor
 * @param bases    impressão do valor visto pelo utilizador, por campo
 * @param forced   campos que o utilizador já decidiu manter ("manter a minha")
 */
export function splitPatchByConflict(
  patch: Record<string, any>,
  current: Record<string, any>,
  bases: Record<string, string | undefined>,
  forced: ReadonlySet<string> = new Set()
): { safe: Record<string, any>; conflicts: FieldConflict[] } {
  const safe: Record<string, any> = {};
  const conflicts: FieldConflict[] = [];
  for (const [field, mine] of Object.entries(patch)) {
    const base = bases[field];
    if (field === ORDER_FIELD || base === undefined || forced.has(field)) { safe[field] = mine; continue; }
    const theirs = current?.[field];
    const theirsHash = hashValue(theirs);
    if (theirsHash === base || theirsHash === hashValue(mine)) { safe[field] = mine; continue; }
    conflicts.push({ field, mine, theirs });
  }
  return { safe, conflicts };
}

/** Texto curto para mostrar um valor no ecrã de resolução. */
export function describeValue(v: unknown, max = 120): string {
  if (v === undefined || v === null || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  const s = typeof v === 'string' ? v : stableStringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Nome legível de um registo, a partir dos campos mais comuns. */
export function recordLabelOf(rec: Record<string, any> | undefined, fallbackId: string): string {
  if (!rec) return fallbackId;
  for (const k of ['name', 'studentName', 'title', 'label', 'subjectName', 'className', 'description']) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
  }
  return fallbackId;
}
