/**
 * DADOS POR REGISTO — lógica pura (sem React nem Firebase), por isso testável.
 *
 * As colecções de `config/dataShards.json` deixam de viajar no documento único da escola.
 * Cada registo passa a ser um nó em `inst_data/{instituição}/{colecção}/{id}`:
 *  - só o que mudou é enviado (diff por campo), em vez da base inteira;
 *  - as regras do Firebase decidem por colecção (e por campo) quem lê e escreve;
 *  - a ordem da lista é preservada no campo `_o`.
 *
 * ATENÇÃO: o `update()` com vários caminhos é atómico. Um único caminho recusado pelas regras
 * recusa o envio todo. Por isso `filterUpdatesForActor` tem de espelhar EXACTAMENTE as regras
 * geradas por scripts/gen-supabase-acl.mjs (npm run check:acl confirma as duas metades contra o mesmo JSON).
 */
import shardConfig from '../config/dataShards.json';

export type RecordMap = Record<string, any>;
export type ShardUpdates = Record<string, any>;

export interface ShardCollectionConfig {
  sections: string[];
  read: string[];
  write: string[];
  fieldWrites?: Record<string, string[]>;
  /** perfil → campo com o uid do dono: esse perfil só cria/altera registos seus (nunca apaga). */
  ownerWrite?: Record<string, string>;
  academicYearScoped?: boolean;
  indexOn?: string[];
}

export const SHARD_CONFIG = (shardConfig as any).collections as Record<string, ShardCollectionConfig>;
export const SHARD_KEYS: string[] = Object.keys(SHARD_CONFIG);

/** Campo reservado com a posição do registo na lista. */
export const ORDER_FIELD = '_o';

export interface ShardActor {
  /** uid da conta (igual ao id do utilizador). */
  id?: string;
  role?: string;
  access?: { sections?: Record<string, { enabled?: boolean; mode?: string }> } | null;
}

// ---------------------------------------------------------------------------
// Chaves, igualdade, limpeza
// ---------------------------------------------------------------------------

/** Os nós do Realtime Database não aceitam . $ # [ ] / — codifica sem perder unicidade. */
export function encodeKey(id: unknown): string {
  return String(id).replace(/[.$#\[\]\/~]/g, (c) => '~' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** Remove `undefined` (o Firebase recusa o envio inteiro com um só). */
export function stripUndefined<T = any>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)).filter((v) => v !== undefined) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Forma "como o Firebase a guarda": sem `undefined`/`null`, sem arrays/objectos vazios.
 * Comparar nesta forma evita diferenças fantasma (um `[]` local nunca volta da nuvem).
 */
export function normalizeValue(value: any): any {
  if (value === undefined || value === null) return undefined; // o Firebase nunca guarda null: é "não existe"
  if (Array.isArray(value)) {
    const arr = value.map((v) => normalizeValue(v)).map((v) => (v === undefined ? null : v));
    return arr.length === 0 ? undefined : arr;
  }
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalizeValue(v);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

function normalizeRecord(rec: any): any {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return rec;
  const out: any = {};
  for (const [k, v] of Object.entries(rec)) {
    const n = normalizeValue(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lista <-> mapa de registos
// ---------------------------------------------------------------------------

/** Todos os registos têm `id` e os ids (já codificados) são únicos? */
export function isShardable(list: any[]): boolean {
  if (!Array.isArray(list)) return false;
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const id = (item as any).id;
    if (id === undefined || id === null || id === '') return false;
    const key = encodeKey(id);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Posição (`_o`) de cada registo. Os que já existem mantêm a sua; os novos ficam entre os vizinhos
 * (um registo inserido no início da lista fica antes de todos, um no fim fica depois).
 */
export function assignOrder(list: any[], baseline: RecordMap = {}): number[] {
  const known: Array<number | undefined> = list.map((item) => {
    const o = baseline[encodeKey(item?.id)]?.[ORDER_FIELD];
    return typeof o === 'number' && isFinite(o) ? o : undefined;
  });
  const out: number[] = new Array(list.length);
  let i = 0;
  while (i < list.length) {
    if (known[i] !== undefined) {
      out[i] = known[i] as number;
      i++;
      continue;
    }
    let j = i;
    while (j < list.length && known[j] === undefined) j++;
    const prev = i > 0 ? out[i - 1] : undefined;
    const next = j < list.length ? (known[j] as number) : undefined;
    const count = j - i;
    for (let n = 0; n < count; n++) {
      if (prev !== undefined && next !== undefined) out[i + n] = prev + ((next - prev) * (n + 1)) / (count + 1);
      else if (prev !== undefined) out[i + n] = prev + (n + 1);
      else if (next !== undefined) out[i + n] = next - (count - n);
      else out[i + n] = n;
    }
    i = j;
  }
  return out;
}

export function toRecordMap(list: any[], baseline: RecordMap = {}): RecordMap {
  const order = assignOrder(list, baseline);
  const map: RecordMap = {};
  list.forEach((item, idx) => {
    map[encodeKey(item.id)] = { ...normalizeRecord(item), [ORDER_FIELD]: order[idx] };
  });
  return map;
}

export function deepCloneRecord<T>(v: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(v);
  } catch { /* cai para JSON */ }
  return JSON.parse(JSON.stringify(v));
}

export function fromRecordMap(map: RecordMap | null | undefined): any[] {
  if (!map || typeof map !== 'object') return [];
  const rows = Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v], idx) => ({ key, v: v as any, idx }));
  rows.sort((a, b) => {
    const oa = typeof a.v[ORDER_FIELD] === 'number' ? a.v[ORDER_FIELD] : Number.MAX_SAFE_INTEGER;
    const ob = typeof b.v[ORDER_FIELD] === 'number' ? b.v[ORDER_FIELD] : Number.MAX_SAFE_INTEGER;
    return oa - ob || a.idx - b.idx;
  });
  return rows.map(({ v }) => {
    const { [ORDER_FIELD]: _o, ...rest } = v;
    // Cópia profunda: a lista de trabalho NÃO pode partilhar arrays/objectos com o baseline, senão
    // edições no sítio (ex.: student.trimesterGrades.push) alteram também o baseline e o diff
    // não vê mudança -> as notas nunca eram enviadas para a nuvem.
    return deepCloneRecord(rest);
  });
}

// ---------------------------------------------------------------------------
// Diferenças
// ---------------------------------------------------------------------------

/**
 * Compara a lista local com o que a nuvem tem (`baseline`) e devolve só o que mudou:
 *   "id"        → registo novo (objecto) ou apagado (null)
 *   "id/campo"  → campo alterado (valor) ou removido (null)
 */
export function diffCollection(baseline: RecordMap, list: any[]): { updates: ShardUpdates; nextBaseline: RecordMap } {
  const next = toRecordMap(list, baseline);
  const updates: ShardUpdates = {};
  for (const key of Object.keys(baseline)) {
    if (!(key in next)) updates[key] = null;
  }
  for (const [key, rec] of Object.entries(next)) {
    const old = baseline[key];
    if (!old) {
      updates[key] = rec;
      continue;
    }
    for (const [field, value] of Object.entries(rec)) {
      if (!deepEqual(old[field], value)) updates[`${key}/${field}`] = value;
    }
    for (const field of Object.keys(old)) {
      if (!(field in rec)) updates[`${key}/${field}`] = null;
    }
  }
  return { updates, nextBaseline: next };
}

/** Aplica diferenças (caminhos "id" e "id/campo") a um mapa — devolve um novo mapa. */
export function applyUpdates(baseline: RecordMap, updates: ShardUpdates): RecordMap {
  const out: RecordMap = { ...baseline };
  for (const [path, value] of Object.entries(updates)) {
    const slash = path.indexOf('/');
    if (slash === -1) {
      if (value === null) delete out[path];
      else out[path] = value;
      continue;
    }
    const id = path.slice(0, slash);
    const field = path.slice(slash + 1);
    const rec = { ...(out[id] || {}) };
    if (value === null) delete rec[field];
    else rec[field] = value;
    out[id] = rec;
  }
  return out;
}

/**
 * Garante ids únicos antes da migração (registos sem id ou repetidos recebem um novo).
 * Devolve a lista corrigida e quantos registos foram alterados.
 */
export function normalizeIds(list: any[], prefix: string): { list: any[]; changed: number } {
  const seen = new Set<string>();
  let changed = 0;
  const out = list.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      changed++;
      let n = 0;
      let candidate = `${prefix}-${index}`;
      while (seen.has(encodeKey(candidate))) candidate = `${prefix}-${index}-${++n}`;
      seen.add(encodeKey(candidate));
      return { id: candidate, value: item };
    }
    let id = item.id;
    let key = id === undefined || id === null || id === '' ? '' : encodeKey(id);
    if (!key || seen.has(key)) {
      let n = 0;
      let candidate = `${prefix}-${index}`;
      while (seen.has(encodeKey(candidate))) candidate = `${prefix}-${index}-${++n}`;
      id = candidate;
      key = encodeKey(id);
      changed++;
      seen.add(key);
      return { ...item, id };
    }
    seen.add(key);
    return item;
  });
  return { list: out, changed };
}

/** Parte um objecto de caminhos em lotes (limita o tamanho de cada escrita). */
export function chunkUpdates(updates: ShardUpdates, maxPaths = 200): ShardUpdates[] {
  const entries = Object.entries(updates);
  const out: ShardUpdates[] = [];
  for (let i = 0; i < entries.length; i += maxPaths) out.push(Object.fromEntries(entries.slice(i, i + maxPaths)));
  return out;
}

// ---------------------------------------------------------------------------
// Permissões (espelho das regras do Firebase)
// ---------------------------------------------------------------------------

function customSections(cfg: ShardCollectionConfig, actor: ShardActor) {
  const all = actor.access?.sections || {};
  return cfg.sections.map((s) => all[s]).filter(Boolean) as Array<{ enabled?: boolean; mode?: string }>;
}

/** Acesso à colecção inteira: admin sempre; com acesso personalizado manda este; senão manda o perfil. */
function grants(cfg: ShardCollectionConfig, actor: ShardActor, kind: 'read' | 'write'): boolean {
  if (!actor || !actor.role) return false;
  if (actor.role === 'admin') return true;
  const custom = customSections(cfg, actor);
  if (custom.length > 0) {
    return custom.some((c) => c.enabled === true && (kind === 'read' || c.mode === 'write'));
  }
  return cfg[kind].includes(actor.role);
}

export function canReadCollection(name: string, actor: ShardActor | null | undefined): boolean {
  const cfg = SHARD_CONFIG[name];
  return !!cfg && !!actor && grants(cfg, actor, 'read');
}

export function canWriteCollection(name: string, actor: ShardActor | null | undefined): boolean {
  const cfg = SHARD_CONFIG[name];
  return !!cfg && !!actor && grants(cfg, actor, 'write');
}

/** Campos que o perfil pode escrever num registo existente, sem escrita completa. */
export function writableFields(name: string, actor: ShardActor | null | undefined): string[] {
  const cfg = SHARD_CONFIG[name];
  if (!cfg || !actor?.role) return [];
  return cfg.fieldWrites?.[actor.role] || [];
}

/** Deixa passar só os caminhos que as regras deste perfil aceitam. */
export function filterUpdatesForActor(name: string, updates: ShardUpdates, actor: ShardActor | null | undefined): ShardUpdates {
  if (!actor) return {};
  if (canWriteCollection(name, actor)) return { ...updates };
  const ownerField = actor.role ? SHARD_CONFIG[name]?.ownerWrite?.[actor.role] : undefined;
  if (ownerField && actor.id) {
    // Só registos inteiros cujo dono é este utilizador; apagar e mexer em campos soltos não passa.
    const own: ShardUpdates = {};
    for (const [path, value] of Object.entries(updates)) {
      if (path.includes('/')) continue;
      if (value && typeof value === 'object' && (value as any)[ownerField] === actor.id) own[path] = value;
    }
    return own;
  }
  const fields = new Set(writableFields(name, actor));
  if (fields.size === 0) return {};
  const out: ShardUpdates = {};
  for (const [path, value] of Object.entries(updates)) {
    const slash = path.indexOf('/');
    if (slash === -1) continue; // criar/apagar registos exige escrita completa
    const field = path.slice(slash + 1);
    if (fields.has(field)) out[path] = value;
  }
  return out;
}

/** Indica se a colecção é particionada e indexada por ano lectivo. */
export function isYearScopedCollection(name: string): boolean {
  return !!SHARD_CONFIG[name]?.academicYearScoped;
}

/** Filtra uma lista mantendo os registos do ano lectivo pretendido (ou sem ano). */
export function filterRecordsByAcademicYear<T extends { academicYear?: string }>(
  records: T[] | null | undefined,
  year?: string
): T[] {
  if (!Array.isArray(records)) return [];
  if (!year) return [...records];
  return records.filter((r) => !r || !r.academicYear || r.academicYear === year);
}

