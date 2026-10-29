import { describe, expect, it } from 'vitest';
import { describeValue, hashValue, recordLabelOf, splitPatchByConflict, stableStringify } from '../src/utils/syncConflicts';

describe('conflitos de sincronização: impressão', () => {
  it('a ordem das chaves não conta; valores diferentes dão impressões diferentes', () => {
    expect(hashValue({ a: 1, b: [1, 2] })).toBe(hashValue({ b: [1, 2], a: 1 }));
    expect(hashValue('Ana')).not.toBe(hashValue('Ana '));
    expect(hashValue(undefined)).toBe(hashValue(null));
    expect(stableStringify({ x: undefined, y: 1 })).toBe('{"y":1}');
  });
});

describe('conflitos de sincronização: detecção por campo', () => {
  const base = (v: unknown) => hashValue(v);
  it('servidor igual ao que vimos: envia', () => {
    const r = splitPatchByConflict({ phone: '923' }, { phone: '911' }, { phone: base('911') });
    expect(r.safe).toEqual({ phone: '923' });
    expect(r.conflicts).toEqual([]);
  });
  it('outra pessoa mudou o mesmo campo para outro valor: conflito, não envia', () => {
    const r = splitPatchByConflict({ phone: '923' }, { phone: '900' }, { phone: base('911') });
    expect(r.safe).toEqual({});
    expect(r.conflicts).toEqual([{ field: 'phone', mine: '923', theirs: '900' }]);
  });
  it('outra pessoa chegou ao mesmo valor: converge, sem conflito', () => {
    const r = splitPatchByConflict({ phone: '923' }, { phone: '923' }, { phone: base('911') });
    expect(r.conflicts).toEqual([]);
    expect(r.safe).toEqual({ phone: '923' });
  });
  it('campos diferentes não se afectam: só o que colidiu fica de fora', () => {
    const r = splitPatchByConflict({ phone: '923', address: 'Rua 1' }, { phone: '900', address: 'Rua 0' }, { phone: base('911'), address: base('Rua 0') });
    expect(r.safe).toEqual({ address: 'Rua 1' });
    expect(r.conflicts.map((c) => c.field)).toEqual(['phone']);
  });
  it('sem impressão conhecida: comportamento anterior (envia)', () => {
    const r = splitPatchByConflict({ phone: '923' }, { phone: '900' }, {});
    expect(r.safe).toEqual({ phone: '923' });
    expect(r.conflicts).toEqual([]);
  });
  it('"manter a minha" (forçado) envia mesmo havendo diferença', () => {
    const r = splitPatchByConflict({ phone: '923' }, { phone: '900' }, { phone: base('911') }, new Set(['phone']));
    expect(r.safe).toEqual({ phone: '923' });
    expect(r.conflicts).toEqual([]);
  });
  it('apagar um campo que outro alterou é conflito; apagar o que ninguém mexeu não', () => {
    expect(splitPatchByConflict({ note: null }, { note: 'novo' }, { note: base('velho') }).conflicts).toHaveLength(1);
    expect(splitPatchByConflict({ note: null }, { note: 'velho' }, { note: base('velho') }).conflicts).toHaveLength(0);
  });
  it('campo que antes não existia e que outra pessoa preencheu', () => {
    const r = splitPatchByConflict({ note: 'minha' }, { note: 'dela' }, { note: base(undefined) });
    expect(r.conflicts).toHaveLength(1);
  });
  it('a ordem (_o) nunca gera conflito', () => {
    expect(splitPatchByConflict({ _o: 5 }, { }, { _o: base(1) }).conflicts).toEqual([]);
  });
});

describe('conflitos de sincronização: apresentação', () => {
  it('descreve valores e nomes de registos', () => {
    expect(describeValue('')).toBe('(vazio)');
    expect(describeValue(true)).toBe('Sim');
    expect(describeValue('x'.repeat(300)).length).toBe(121);
    expect(recordLabelOf({ name: ' Ana ' }, 'id1')).toBe('Ana');
    expect(recordLabelOf(undefined, 'id1')).toBe('id1');
    expect(recordLabelOf({ foo: 1 }, 'id1')).toBe('id1');
  });
});
