import { describe, it, expect } from 'vitest';
import {
  MINIPAUTA_LOCKED_TYPES,
  buildPautaGradeTypes,
  toggleMiniPautaType,
  togglePautaMt,
  usesFullSubjectNames,
  withMiniPautaLockedTypes,
  PautaMtKey
} from '../src/utils/pautaView';
import type { GradeTypeKey } from '../src/types/pauta';

describe('Mini-Pauta: MT1, MT2, MT3 e MFD não se desmarcam', () => {
  it('toggle de uma coluna fixa não a remove', () => {
    let sel = withMiniPautaLockedTypes(['MAC', 'NPT']);
    for (const k of MINIPAUTA_LOCKED_TYPES) {
      sel = toggleMiniPautaType(sel, k);
      expect(sel.has(k)).toBe(true);
    }
  });

  it('as restantes colunas continuam a poder ser marcadas e desmarcadas', () => {
    let sel = withMiniPautaLockedTypes(['MAC', 'NPT']);
    sel = toggleMiniPautaType(sel, 'MAC');
    expect(sel.has('MAC')).toBe(false);
    sel = toggleMiniPautaType(sel, 'MAC');
    expect(sel.has('MAC')).toBe(true);
    sel = toggleMiniPautaType(sel, 'MF');
    expect(sel.has('MF')).toBe(true);
    sel = toggleMiniPautaType(sel, 'MF');
    expect(sel.has('MF')).toBe(false);
  });

  it('um conjunto sem as colunas fixas é corrigido', () => {
    const sel = withMiniPautaLockedTypes(['MAC']);
    expect(['MT1', 'MT2', 'MT3', 'MFD'].every((k) => sel.has(k as GradeTypeKey))).toBe(true);
  });
});

describe('Pauta: só MT1, MT2 e MT3 se desmarcam', () => {
  const all = new Set<PautaMtKey>(['MT1', 'MT2', 'MT3']);

  it('desmarca e volta a marcar uma MT', () => {
    const a = togglePautaMt(all, 'MT2');
    expect([...a].sort()).toEqual(['MT1', 'MT3']);
    const b = togglePautaMt(a, 'MT2');
    expect([...b].sort()).toEqual(['MT1', 'MT2', 'MT3']);
  });

  it('outros tipos (MFD, MF, MAC...) não alteram nada', () => {
    for (const k of ['MFD', 'MF', 'MAC', 'NPT', 'NER'] as GradeTypeKey[]) {
      expect([...togglePautaMt(all, k)].sort()).toEqual(['MT1', 'MT2', 'MT3']);
    }
  });

  it('MFD e MF estão sempre nas colunas da Pauta', () => {
    const none = buildPautaGradeTypes([], 'transicao');
    expect(none.has('MFD') && none.has('MF')).toBe(true);
    expect(none.has('MT1') || none.has('MT2') || none.has('MT3')).toBe(false);
  });

  it('o estado da Pauta não toca no da Mini-Pauta (só oculta)', () => {
    const mini = withMiniPautaLockedTypes(['MAC', 'NPT']);
    const before = [...mini].sort();
    buildPautaGradeTypes(togglePautaMt(new Set<PautaMtKey>(['MT1', 'MT2', 'MT3']), 'MT1'), 'exame');
    expect([...mini].sort()).toEqual(before);
  });
});

describe('Nome completo da disciplina', () => {
  it('só com MFD e MF: nome completo', () => {
    expect(usesFullSubjectNames(buildPautaGradeTypes([], 'transicao'))).toBe(true);
    expect(usesFullSubjectNames(buildPautaGradeTypes([], 'exame'))).toBe(true);
  });
  it('com qualquer MT visível: sigla', () => {
    for (const k of ['MT1', 'MT2', 'MT3'] as PautaMtKey[]) {
      expect(usesFullSubjectNames(buildPautaGradeTypes([k], 'transicao'))).toBe(false);
    }
  });
});
