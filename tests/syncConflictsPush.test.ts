import { beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase simulado em memória: tabela `records` com bloqueio optimista por versão.
type Row = { institution_id: string; collection: string; id: string; data: Record<string, any>; ord: number | null; academic_year: string | null; version: number };
const h = vi.hoisted(() => {
  const state: { rows: any[]; beforeUpdate?: () => void } = { rows: [] };
  const builder = (table: string) => {
    const f: { eq: Array<[string, any]>; ins?: [string, any[]]; op: 'select' | 'update' | 'delete' | 'insert'; payload?: any; single?: boolean } = { eq: [], op: 'select' };
    const run = () => {
      if (table === 'profiles') return { data: { institution_id: 'i1', role: 'professor', active_institution_id: null }, error: null };
      const match = (r: any) => f.eq.every(([k, v]) => r[k] === v) && (!f.ins || f.ins[1].includes(r[f.ins[0]]));
      if (f.op === 'select') { const d = state.rows.filter(match).map((r) => JSON.parse(JSON.stringify(r))); return { data: f.single ? d[0] ?? null : d, error: null }; }
      if (f.op === 'update') {
        state.beforeUpdate?.();
        const r = state.rows.find(match);
        if (!r) return { error: null, count: 0 };
        if (f.payload.version !== r.version) return { error: { code: 'PT409', message: 'Conflito de versão' }, count: 0 };
        r.data = f.payload.data; r.version += 1; return { error: null, count: 1 };
      }
      return { error: null };
    };
    const b: any = {
      select: () => b, eq: (k: string, v: any) => { f.eq.push([k, v]); return b; }, in: (k: string, v: any[]) => { f.ins = [k, v]; return b; },
      update: (payload: any) => { f.op = 'update'; f.payload = payload; return b; },
      maybeSingle: () => { f.single = true; return Promise.resolve(run()); },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej)
    };
    return b;
  };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {}
  };
  return { state, supabase };
});
vi.mock('../src/services/supabase', async (orig) => ({ ...(await orig<any>()), supabase: h.supabase }));

import { sbPush } from '../src/services/shardBackendSupabase';
import { hashValue } from '../src/utils/syncConflicts';

const seed = (data: Record<string, any>) => { h.state.rows = [{ institution_id: 'i1', collection: 'students', id: 's1', data: { id: 's1', name: 'Ana', phone: '911', address: 'Rua 0' }, ord: null, academic_year: null, version: 1, ...{ data: { id: 's1', name: 'Ana', phone: '911', address: 'Rua 0', ...data } } }]; };
const row = () => h.state.rows[0] as Row;

describe('envio com conflitos (sbPush)', () => {
  beforeEach(() => { h.state.beforeUpdate = undefined; seed({}); });

  it('sem impressão conhecida: comportamento anterior (grava)', async () => {
    seed({ phone: '900' });
    await sbPush('students', { 's1/phone': '923' });
    expect(row().data.phone).toBe('923');
  });

  it('servidor igual ao que o utilizador viu: grava', async () => {
    const conflicts: any[] = [];
    await sbPush('students', { 's1/phone': '923' }, { bases: { 's1/phone': hashValue('911') }, onConflict: (c) => conflicts.push(c) });
    expect(row().data.phone).toBe('923');
    expect(conflicts).toEqual([]);
  });

  it('outra pessoa mudou o mesmo campo: NÃO sobrescreve e devolve o conflito; o resto grava', async () => {
    seed({ phone: '900' });
    const conflicts: any[] = [];
    await sbPush('students', { 's1/phone': '923', 's1/address': 'Rua 1' },
      { bases: { 's1/phone': hashValue('911'), 's1/address': hashValue('Rua 0') }, onConflict: (c) => conflicts.push(c) });
    expect(row().data.phone).toBe('900');
    expect(row().data.address).toBe('Rua 1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ recordId: 's1', field: 'phone', mine: '923', theirs: '900' });
  });

  it('"manter a minha" (forçado) sobrescreve', async () => {
    seed({ phone: '900' });
    await sbPush('students', { 's1/phone': '923' }, { bases: { 's1/phone': hashValue('911') }, forced: new Set(['s1/phone']) });
    expect(row().data.phone).toBe('923');
  });

  it('conflito de versão durante o envio: relê e volta a verificar o campo contra o valor novo', async () => {
    const conflicts: any[] = [];
    let first = true;
    // Entre a nossa leitura e a nossa gravação, outra pessoa grava o MESMO campo com outro valor.
    h.state.beforeUpdate = () => { if (first) { first = false; row().data.phone = '777'; row().version += 1; } };
    await sbPush('students', { 's1/phone': '923' }, { bases: { 's1/phone': hashValue('911') }, onConflict: (c) => conflicts.push(c) });
    expect(row().data.phone).toBe('777');
    expect(conflicts[0]).toMatchObject({ field: 'phone', mine: '923', theirs: '777' });
  });

  it('conflito de versão noutro campo: reaplica só o nosso e mantém o dela', async () => {
    let first = true;
    h.state.beforeUpdate = () => { if (first) { first = false; row().data.address = 'Rua 9'; row().version += 1; } };
    await sbPush('students', { 's1/phone': '923' }, { bases: { 's1/phone': hashValue('911') } });
    expect(row().data.phone).toBe('923');
    expect(row().data.address).toBe('Rua 9');
  });
});
