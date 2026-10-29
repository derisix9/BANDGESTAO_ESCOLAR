import { describe, it, expect } from 'vitest';
import { splitIntoBatches, overallPercent, isTransientError, withRetry, createBackupApi, type TableProgress } from '../src/utils/schoolBackupApi';

describe('splitIntoBatches', () => {
  it('devolve sempre pelo menos um lote (tabela vazia)', () => { expect(splitIntoBatches([])).toEqual([[]]); });
  it('respeita o máximo de linhas', () => {
    const b = splitIntoBatches(Array.from({ length: 10 }, (_, i) => ({ i })), 1_000_000, 4);
    expect(b.map((x) => x.length)).toEqual([4, 4, 2]);
  });
  it('respeita o tamanho em bytes, sem partir uma linha', () => {
    const big = { t: 'x'.repeat(600) };
    const b = splitIntoBatches([big, big, big], 1000, 100);
    expect(b.map((x) => x.length)).toEqual([1, 1, 1]);
  });
});

describe('overallPercent', () => {
  it('a aplicação em lotes faz a barra avançar entre 60% e 100%', () => {
    const t = (applied: number): TableProgress => ({ key: 'k', label: 'x', total: 10, sent: 10, status: 'a aplicar', applied });
    expect(overallPercent([t(0)])).toBe(60); expect(overallPercent([t(5)])).toBe(80); expect(overallPercent([t(10)])).toBe(100);
  });
  const t = (total: number, sent: number, status: TableProgress['status']): TableProgress => ({ key: String(total), label: 'x', total, sent, status });
  it('0% no início e 100% quando tudo concluído', () => {
    expect(overallPercent([t(10, 0, 'pendente'), t(10, 0, 'pendente')])).toBe(0);
    expect(overallPercent([t(10, 10, 'concluida'), t(10, 10, 'concluida')])).toBe(100);
  });
  it('envio completo vale 60%', () => { expect(overallPercent([t(10, 10, 'a aplicar')])).toBe(60); });
  it('tabelas vazias contam', () => { expect(overallPercent([t(0, 0, 'concluida')])).toBe(100); });
});

describe('withRetry', () => {
  it('repete erros de ligação e devolve o resultado', async () => {
    let n = 0;
    const r = await withRetry(async () => { n++; if (n < 3) throw new Error('upstream request timeout'); return 'ok'; }, 4, 1, async () => {});
    expect(r).toBe('ok'); expect(n).toBe(3);
  });
  it('não repete erros de regra (ex.: permissão)', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw Object.assign(new Error('Só o administrador'), { code: '42501' }); }, 4, 1, async () => {})).rejects.toThrow();
    expect(n).toBe(1);
  });
  it('não repete o cancelamento do servidor por tempo (57014)', () => {
    expect(isTransientError(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))).toBe(false);
  });
});

describe('restoreTablesChunked', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ collection: 'students', id: 's' + i, data: {} }));

  it('envia em lotes, aplica lote a lote (0034) e reporta progresso', async () => {
    const calls: string[] = [];
    const api = createBackupApi(async (fn, args) => {
      calls.push(fn + (args?.p_seq !== undefined ? '#' + args.p_seq : ''));
      if (fn === 'school_restore_begin') return { data: 'sess-1', error: null };
      if (fn === 'school_restore_apply_batch') return { data: { applied: 3, ignored: 0 }, error: null };
      return { data: null, error: null };
    });
    const seen: number[] = [];
    const r = await api.restoreTablesChunked(
      [{ key: 'a', label: 'students', kind: 'records', collection: 'students', items: rows(5) }, { key: 'b', label: 'docs', kind: 'docs', collection: '', items: [] }],
      'RESTAURAR', (p) => seen.push(p.percent));
    expect(r.applied).toBe(6);                                  // 1 lote por tabela, 3 + 3
    expect(calls[0]).toBe('school_restore_begin');
    expect(calls.filter((c) => c === 'school_restore_prepare').length).toBe(2);
    expect(calls.filter((c) => c.startsWith('school_restore_apply_batch')).length).toBe(2);
    expect(calls.filter((c) => c === 'school_restore_complete').length).toBe(2);
    expect(calls).not.toContain('school_restore_apply');
    expect(calls[calls.length - 1]).toBe('school_restore_finish');
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));    // o progresso nunca recua
  });

  it('uma tabela grande é aplicada em VÁRIOS pedidos curtos (nenhum pedido leva a tabela inteira)', async () => {
    const applyBatches: number[] = [];
    const api = createBackupApi(async (fn, args) => {
      if (fn === 'school_restore_begin') return { data: 'sess', error: null };
      if (fn === 'school_restore_apply_batch') { applyBatches.push(Number(args?.p_seq)); return { data: { applied: 250 }, error: null }; }
      return { data: null, error: null };
    });
    await api.restoreTablesChunked([{ key: 'a', label: 'students', kind: 'records', collection: 'students', items: rows(600) }], 'RESTAURAR', () => {});
    expect(applyBatches).toEqual([0, 1, 2]);                  // 250 + 250 + 100
  });

  it('repete um lote que deu timeout do gateway e termina bem (sem refazer os outros)', async () => {
    let failures = 0; const applied: number[] = [];
    const api = createBackupApi(async (fn, args) => {
      if (fn === 'school_restore_begin') return { data: 'sess', error: null };
      if (fn === 'school_restore_apply_batch') {
        if (args?.p_seq === 1 && failures < 2) { failures++; return { data: null, error: { message: 'upstream request timeout' } }; }
        applied.push(Number(args?.p_seq)); return { data: { applied: 1 }, error: null };
      }
      return { data: null, error: null };
    });
    const orig = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: any) => orig(fn, 0);          // sem esperas reais
    try { await api.restoreTablesChunked([{ key: 'a', label: 'students', kind: 'records', collection: 'students', items: rows(600) }], 'RESTAURAR', () => {}); }
    finally { globalThis.setTimeout = orig; }
    expect(failures).toBe(2);
    expect(applied).toEqual([0, 1, 2]);
  });

  it('sem a migração 0034 usa a função única da 0033', async () => {
    const calls: string[] = [];
    const api = createBackupApi(async (fn) => {
      calls.push(fn);
      if (fn === 'school_restore_begin') return { data: 'sess-1', error: null };
      if (fn === 'school_restore_prepare') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.school_restore_prepare' } };
      if (fn === 'school_restore_apply') return { data: { applied: 5, ignored: 0 }, error: null };
      return { data: null, error: null };
    });
    const r = await api.restoreTablesChunked([{ key: 'a', label: 'students', kind: 'records', collection: 'students', items: rows(5) }], 'RESTAURAR', () => {});
    expect(r.applied).toBe(5);
    expect(calls.filter((c) => c === 'school_restore_apply').length).toBe(1);
    expect(calls).not.toContain('school_restore_apply_batch');
  });

  it('se o envio falha, nada é aplicado', async () => {
    const calls: string[] = [];
    const api = createBackupApi(async (fn) => {
      calls.push(fn);
      if (fn === 'school_restore_begin') return { data: 's', error: null };
      if (fn === 'school_restore_stage') return { data: null, error: { message: 'invalid-backup: x', code: '22023' } };
      return { data: null, error: null };
    });
    await expect(api.restoreTablesChunked([{ key: 'a', label: 'x', kind: 'records', collection: 'x', items: [{ collection: 'x', id: '1', data: {} }] }], 'RESTAURAR', () => {})).rejects.toThrow();
    expect(calls).not.toContain('school_restore_prepare');
    expect(calls).not.toContain('school_restore_apply_batch');
  });

  it('se um lote falha de vez, diz que tabela falhou e quais já foram aplicadas', async () => {
    const api = createBackupApi(async (fn, args) => {
      if (fn === 'school_restore_begin') return { data: 's', error: null };
      if (fn === 'school_restore_apply_batch' && args?.p_collection === 'classes') return { data: null, error: { message: 'permission denied', code: '42501' } };
      return { data: { applied: 1 }, error: null };
    });
    const err: any = await api.restoreTablesChunked([
      { key: 'a', label: 'students', kind: 'records', collection: 'students', items: rows(2) },
      { key: 'b', label: 'classes', kind: 'records', collection: 'classes', items: [{ collection: 'classes', id: 'c', data: {} }] }
    ], 'RESTAURAR', () => {}).catch((e) => e);
    expect(err.failedTable).toBe('classes');
    expect(err.appliedTables).toEqual(['students']);
  });
});
