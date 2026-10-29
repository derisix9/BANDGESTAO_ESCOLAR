import { describe, it, expect } from 'vitest';
import { encodeKey, toRecordMap, diffCollection, fromRecordMap, applyUpdates } from '../src/utils/shardSync';
import { decodeKey, rowsToRecordMap, updatesToOps, applyPatch, recordToRow } from '../src/utils/shardSupabase';

describe('shardSupabase', () => {
  it('decodeKey é o inverso de encodeKey', () => {
    for (const id of ['a', 'a.b', 'x/y#z', 'ç[1]$', 'id~3', '2024/2025']) expect(decodeKey(encodeKey(id))).toBe(id);
  });

  it('linhas → mapa → lista mantém ordem e dados (ord decimal incluído)', () => {
    const map = rowsToRecordMap([
      { id: 'b', data: { id: 'b', name: 'B' }, ord: 2.5, academic_year: null },
      { id: 'a', data: { id: 'a', name: 'A' }, ord: 1, academic_year: null },
    ]);
    expect(fromRecordMap(map).map((r) => r.id)).toEqual(['a', 'b']);
    expect(map['b']._o).toBe(2.5);
  });

  it('diff do db.ts → operações: novo, apagado e campo alterado', () => {
    const list0 = [{ id: 's.1', name: 'Ana', classId: 'c1' }, { id: 's2', name: 'Rui', classId: 'c1' }];
    const base = toRecordMap(list0);
    const list1 = [{ id: 's.1', name: 'Ana Maria', classId: 'c1' }, { id: 's3', name: 'Eva', classId: 'c2', academicYear: '2025/2026' }];
    const { updates } = diffCollection(base, list1);
    const ops = updatesToOps(updates);
    expect(ops.deletes).toEqual(['s2']);
    expect(ops.inserts.map((r) => r.id)).toEqual(['s3']);
    expect(ops.inserts[0].academic_year).toBe('2025/2026');
    expect(ops.inserts[0].data._o).toBeUndefined();            // `_o` vai para a coluna ord, não para os dados
    expect(ops.patches['s.1']).toEqual({ name: 'Ana Maria' });   // chave descodificada
  });

  it('applyPatch junta campos sem perder os outros e remove com null', () => {
    const row = { id: 'x', data: { id: 'x', name: 'A', grades: { m: 10 }, obs: 'z' }, ord: 3, academic_year: '2024/2025', version: 4 };
    const n = applyPatch(row, { grades: { m: 12 }, obs: null, academicYear: '2025/2026', _o: 7 });
    expect(n.data).toEqual({ id: 'x', name: 'A', grades: { m: 12 }, academicYear: '2025/2026' });
    expect(n.ord).toBe(7);
    expect(n.academic_year).toBe('2025/2026');
    expect(row.data.obs).toBe('z');                              // original intacto
  });

  it('ida e volta: o que a base devolve é igual ao que o db.ts enviou (sem diferenças fantasma)', () => {
    const list = [{ id: 'a', name: 'A', tags: ['x'], n: 1 }, { id: 'b', name: 'B' }];
    const map = toRecordMap(list);
    const rows = Object.entries(map).map(([k, rec]) => { const r = recordToRow(rec as any, decodeKey(k)); return { ...r }; });
    const back = rowsToRecordMap(rows);
    expect(back).toEqual(map);
    expect(Object.keys(diffCollection(back, list).updates)).toHaveLength(0);
    expect(applyUpdates(back, {})).toEqual(back);
  });
});
