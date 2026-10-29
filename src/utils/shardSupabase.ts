/**
 * Tradução entre o formato "Firebase" que o db.ts usa (mapa de registos + caminhos "id" / "id/campo")
 * e as linhas da tabela `records` do Supabase. Lógica pura, sem rede — por isso testável.
 */
import { ORDER_FIELD, encodeKey, type RecordMap, type ShardUpdates } from './shardSync';

/** Inverso de encodeKey(). */
export function decodeKey(key: string): string {
  return key.replace(/~([0-9a-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

export interface RecordRow { id: string; data: Record<string, any>; ord: number | null; academic_year: string | null; version?: number }

/** Linhas da base → mapa de registos (o `_o` volta a ser um campo, como no Firebase). */
export function rowsToRecordMap(rows: RecordRow[]): RecordMap {
  const map: RecordMap = {};
  for (const r of rows) {
    const rec: Record<string, any> = { ...(r.data || {}) };
    if (rec.id === undefined) rec.id = r.id;
    if (typeof r.ord === 'number') rec[ORDER_FIELD] = r.ord;
    map[encodeKey(r.id)] = rec;
  }
  return map;
}

export interface NewRow { id: string; data: Record<string, any>; ord: number | null; academic_year: string | null }
export interface RecordOps {
  inserts: NewRow[];
  deletes: string[];
  /** id → campos alterados (valor) ou removidos (null) */
  patches: Record<string, Record<string, any>>;
}

export function recordToRow(rec: Record<string, any>, fallbackId: string): NewRow {
  const { [ORDER_FIELD]: ord, ...data } = rec;
  const id = String(data.id ?? fallbackId);
  return {
    id, data: { ...data, id: data.id ?? id },
    ord: typeof ord === 'number' && isFinite(ord) ? ord : null,
    academic_year: data.academicYear != null ? String(data.academicYear) : null
  };
}

/** Caminhos do diff ("id" ou "id/campo") → operações sobre linhas. */
export function updatesToOps(updates: ShardUpdates): RecordOps {
  const ops: RecordOps = { inserts: [], deletes: [], patches: {} };
  for (const [path, value] of Object.entries(updates)) {
    const slash = path.indexOf('/');
    if (slash === -1) {
      if (value === null || value === undefined) ops.deletes.push(decodeKey(path));
      else ops.inserts.push(recordToRow(value, decodeKey(path)));
    } else {
      const id = decodeKey(path.slice(0, slash));
      (ops.patches[id] ||= {})[path.slice(slash + 1)] = value === undefined ? null : value;
    }
  }
  return ops;
}

/** Aplica campos alterados a uma linha existente (devolve a nova linha; a original não é mexida). */
export function applyPatch(row: RecordRow, patch: Record<string, any>): { data: Record<string, any>; ord: number | null; academic_year: string | null } {
  const data: Record<string, any> = { ...row.data };
  let ord = row.ord;
  let year = row.academic_year;
  for (const [field, value] of Object.entries(patch)) {
    if (field === ORDER_FIELD) { ord = typeof value === 'number' ? value : null; continue; }
    if (value === null) delete data[field]; else data[field] = value;
    if (field === 'academicYear') year = value === null ? null : String(value);
  }
  return { data, ord, academic_year: year };
}
