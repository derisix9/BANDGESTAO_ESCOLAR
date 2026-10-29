import { describe, expect, it } from 'vitest';
import {
  ORDER_FIELD, SHARD_CONFIG, SHARD_KEYS, applyUpdates, assignOrder, canReadCollection, canWriteCollection,
  chunkUpdates, deepEqual, diffCollection, encodeKey, filterUpdatesForActor, fromRecordMap, isShardable,
  normalizeIds, normalizeValue, stripUndefined, toRecordMap, writableFields
} from '../src/utils/shardSync';

describe('chaves e limpeza', () => {
  it('encodeKey é seguro para o Firebase e injectivo', () => {
    const k = encodeKey('a.b/c#d$e[f]g');
    expect(k).not.toMatch(/[.$#\[\]\/]/);
    expect(encodeKey('a.b')).not.toBe(encodeKey('a~2eb'));
    expect(encodeKey('simples-1')).toBe('simples-1');
  });

  it('stripUndefined remove undefined em profundidade', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, undefined, 2] } })).toEqual({ a: 1, c: { e: [1, 2] } });
  });

  it('normalizeValue trata vazios como o Firebase (não existem)', () => {
    expect(normalizeValue([])).toBeUndefined();
    expect(normalizeValue({})).toBeUndefined();
    expect(normalizeValue({ a: [], b: { c: {} }, d: 0, e: '', f: null })).toEqual({ d: 0, e: '' });
  });

  it('deepEqual', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1] }, { a: { 0: 1 } })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('isShardable', () => {
  it('aceita registos com id único e recusa o resto', () => {
    expect(isShardable([{ id: '1' }, { id: 2 }])).toBe(true);
    expect(isShardable([])).toBe(true);
    expect(isShardable([{ id: '1' }, { id: '1' }])).toBe(false);
    expect(isShardable([{ name: 'x' }])).toBe(false);
    expect(isShardable(['texto'] as any)).toBe(false);
    expect(isShardable([{ id: 'a.b' }, { id: 'a~2eb' }])).toBe(true); // codificados continuam distintos
  });
});

describe('ordem e conversão lista <-> mapa', () => {
  it('ida e volta preserva ordem e conteúdo (sem o campo interno)', () => {
    const list = [{ id: 'z', n: 1 }, { id: 'a', n: 2 }, { id: 'm', n: 3 }];
    const back = fromRecordMap(toRecordMap(list));
    expect(back).toEqual(list);
    expect(JSON.stringify(back)).not.toContain(ORDER_FIELD);
  });

  it('um registo novo no início fica no início, no fim fica no fim, no meio fica no meio', () => {
    const base = toRecordMap([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const next = toRecordMap([{ id: 'n0' }, { id: 'a' }, { id: 'b' }, { id: 'n1' }, { id: 'c' }, { id: 'n2' }], base);
    expect(fromRecordMap(next).map((r) => r.id)).toEqual(['n0', 'a', 'b', 'n1', 'c', 'n2']);
  });

  it('vários novos seguidos mantêm a ordem entre si', () => {
    const base = toRecordMap([{ id: 'a' }, { id: 'b' }]);
    const order = assignOrder([{ id: 'a' }, { id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'b' }], base);
    expect(order[1]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[3]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[3]).toBeLessThan(order[4]);
  });

  it('registos com ids estranhos sobrevivem à ida e volta', () => {
    const list = [{ id: 'a.b/c', v: 1 }, { id: 7, v: 2 }];
    const map = toRecordMap(list);
    expect(Object.keys(map).every((k) => !/[.$#\[\]\/]/.test(k))).toBe(true);
    expect(fromRecordMap(map)).toEqual(list);
  });

  it('fromRecordMap tolera nulo e entradas inválidas', () => {
    expect(fromRecordMap(null)).toEqual([]);
    expect(fromRecordMap({ a: null, b: 'x', c: { id: 'c' } } as any)).toEqual([{ id: 'c' }]);
  });
});

describe('diffCollection', () => {
  it('sem alterações não produz diferenças (mesmo com arrays vazios locais)', () => {
    const base = toRecordMap([{ id: '1', name: 'Ana', tags: [] }]);
    const { updates } = diffCollection(base, [{ id: '1', name: 'Ana', tags: [] }]);
    expect(updates).toEqual({});
  });

  it('registo novo, campo alterado, campo removido e registo apagado', () => {
    const base = toRecordMap([{ id: '1', name: 'Ana', phone: '9' }, { id: '2', name: 'Rui' }]);
    const { updates } = diffCollection(base, [{ id: '1', name: 'Ana Maria' }, { id: '3', name: 'Eva' }]);
    expect(updates['1/name']).toBe('Ana Maria');
    expect(updates['1/phone']).toBeNull();
    expect(updates['2']).toBeNull();
    expect(updates['3']).toMatchObject({ id: '3', name: 'Eva' });
    expect(Object.keys(updates).sort()).toEqual(['1/name', '1/phone', '2', '3']);
  });

  it('campos null locais não geram "apagar" fantasma a cada sincronização', () => {
    // a nuvem nunca guarda null: o aluno sem ficheiro volta sem o campo
    const remote = { '1': { id: '1', name: 'Ana', [ORDER_FIELD]: 0 } };
    expect(diffCollection(remote, [{ id: '1', name: 'Ana', docBiFile: null }]).updates).toEqual({});
    expect(toRecordMap([{ id: '1', docBiFile: null, a: [null, 1] }])['1']).toEqual({ id: '1', a: [null, 1], [ORDER_FIELD]: 0 });
  });

  it('um campo que passa a vazio é removido na nuvem', () => {
    const base = toRecordMap([{ id: '1', list: [1, 2] }]);
    const { updates } = diffCollection(base, [{ id: '1', list: [] }]);
    expect(updates).toEqual({ '1/list': null });
  });

  it('nextBaseline é exactamente o baseline com as diferenças aplicadas', () => {
    const base = toRecordMap([{ id: '1', a: 1 }, { id: '2', a: 2 }]);
    const { updates, nextBaseline } = diffCollection(base, [{ id: '2', a: 3 }, { id: '9', a: 9 }]);
    expect(applyUpdates(base, updates)).toEqual(nextBaseline);
  });

  it('o ciclo completo converge: depois de aplicado não há mais diferenças', () => {
    const base = toRecordMap([{ id: '1', nested: { x: [1, 2], y: 'a' } }]);
    const local = [{ id: '1', nested: { x: [1, 2, 3], y: 'a' } }, { id: '2', nested: { x: [] } }];
    const { updates } = diffCollection(base, local);
    const after = applyUpdates(base, updates);
    expect(diffCollection(after, local).updates).toEqual({});
    expect(fromRecordMap(after)).toEqual([{ id: '1', nested: { x: [1, 2, 3], y: 'a' } }, { id: '2' }]);
  });
});

describe('applyUpdates / normalizeIds / chunkUpdates', () => {
  it('applyUpdates não altera o original', () => {
    const base = toRecordMap([{ id: '1', a: 1 }]);
    const copy = JSON.parse(JSON.stringify(base));
    applyUpdates(base, { '1/a': 5, '2': { id: '2' } });
    expect(base).toEqual(copy);
  });

  it('normalizeIds corrige ids em falta e repetidos sem mexer nos bons', () => {
    const r = normalizeIds([{ id: 'a' }, { name: 'x' }, { id: 'a' }, { id: 'b' }], 'mig');
    expect(r.changed).toBe(2);
    expect(isShardable(r.list)).toBe(true);
    expect(r.list[0].id).toBe('a');
    expect(r.list[3].id).toBe('b');
  });

  it('normalizeIds embrulha valores que não são objectos e nunca repete ids', () => {
    const r = normalizeIds(['x', 'y', { id: 'mig-0' }], 'mig');
    expect(isShardable(r.list)).toBe(true);
    expect(new Set(r.list.map((i) => i.id)).size).toBe(3);
  });

  it('chunkUpdates respeita o tamanho do lote', () => {
    const u: any = {};
    for (let i = 0; i < 450; i++) u['k' + i] = i;
    expect(chunkUpdates(u, 200).map((c) => Object.keys(c).length)).toEqual([200, 200, 50]);
    expect(chunkUpdates({}, 200)).toEqual([]);
  });
});

describe('permissões por colecção', () => {
  const actor = (role: string, sections?: any) => ({ role, access: sections ? { sections } : null });

  it('todas as colecções têm configuração válida', () => {
    expect(SHARD_KEYS.length).toBeGreaterThan(0);
    for (const [name, cfg] of Object.entries(SHARD_CONFIG)) {
      expect(cfg.sections.length, name).toBeGreaterThan(0);
      expect(cfg.read, name).toContain('admin');
      expect(cfg.write, name).toContain('admin');
      for (const r of cfg.write) expect(cfg.read, `${name}: quem escreve tem de poder ler (${r})`).toContain(r);
    }
  });

  it('o administrador pode tudo', () => {
    for (const name of SHARD_KEYS) {
      expect(canReadCollection(name, actor('admin'))).toBe(true);
      expect(canWriteCollection(name, actor('admin'))).toBe(true);
    }
  });

  it('dados de saúde, disciplina e folha de pagamento não são legíveis por professor, aluno e encarregado', () => {
    for (const name of ['medicalRecords', 'disciplinaryIncidents', 'pickupAuthorizations', 'payrollRecords']) {
      for (const role of ['professor', 'aluno', 'encarregado']) {
        expect(canReadCollection(name, actor(role)), `${role} → ${name}`).toBe(false);
      }
    }
    expect(canReadCollection('medicalRecords', actor('secretaria'))).toBe(true);
    expect(canReadCollection('payrollRecords', actor('secretaria'))).toBe(false);
    expect(canReadCollection('payrollRecords', actor('financeiro'))).toBe(true);
  });

  it('aluno e encarregado nunca escrevem', () => {
    for (const name of SHARD_KEYS) {
      expect(canWriteCollection(name, actor('aluno')), name).toBe(false);
      expect(canWriteCollection(name, actor('encarregado')), name).toBe(false);
    }
  });

  it('acesso personalizado substitui o do perfil', () => {
    // professor com a secção de saúde ligada em leitura: lê mas não escreve
    const ro = actor('professor', { saude_ficha_medica: { enabled: true, mode: 'read' } });
    expect(canReadCollection('medicalRecords', ro)).toBe(true);
    expect(canWriteCollection('medicalRecords', ro)).toBe(false);
    const rw = actor('professor', { saude_ficha_medica: { enabled: true, mode: 'write' } });
    expect(canWriteCollection('medicalRecords', rw)).toBe(true);
    // secretaria com a secção desligada perde o acesso que o perfil daria
    const off = actor('secretaria', { saude_ficha_medica: { enabled: false, mode: 'write' } });
    expect(canReadCollection('medicalRecords', off)).toBe(false);
  });

  it('sem sessão ou sem perfil não há acesso', () => {
    expect(canReadCollection('students', null)).toBe(false);
    expect(canReadCollection('students', {} as any)).toBe(false);
    expect(canReadCollection('inexistente', actor('admin'))).toBe(false);
  });
});

describe('filterUpdatesForActor', () => {
  const base = toRecordMap([{ id: '1', name: 'Ana', attendanceRate: 100, financialStatus: 'regular' }]);
  const { updates } = diffCollection(base, [
    { id: '1', name: 'Hack', attendanceRate: 70, financialStatus: 'isento' },
    { id: '2', name: 'Novo' }
  ]);

  it('quem escreve tudo passa tudo', () => {
    expect(filterUpdatesForActor('students', updates, { role: 'secretaria' })).toEqual(updates);
  });

  it('professor só escreve os campos de assiduidade/notas, nunca cria nem apaga', () => {
    const out = filterUpdatesForActor('students', updates, { role: 'professor' });
    expect(Object.keys(out)).toEqual(['1/attendanceRate']);
    expect(filterUpdatesForActor('students', { '1': null }, { role: 'professor' })).toEqual({});
  });

  it('financeiro só escreve o estado financeiro', () => {
    const out = filterUpdatesForActor('students', updates, { role: 'financeiro' });
    expect(Object.keys(out)).toEqual(['1/financialStatus']);
  });

  it('aplicar só o permitido ao baseline não deixa passar o resto', () => {
    const allowed = filterUpdatesForActor('students', updates, { role: 'professor' });
    const after = applyUpdates(base, allowed);
    expect(fromRecordMap(after)).toEqual([{ id: '1', name: 'Ana', attendanceRate: 70, financialStatus: 'regular' }]);
  });

  it('perfil sem escrita nem campos não envia nada', () => {
    expect(filterUpdatesForActor('students', updates, { role: 'encarregado' })).toEqual({});
    expect(filterUpdatesForActor('students', updates, null)).toEqual({});
    expect(writableFields('students', { role: 'secretaria' })).toEqual([]);
  });
});
