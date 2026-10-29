import { describe, it, expect } from 'vitest';
import {
  classAllowsRecurso,
  resolveCourseDurationYears,
  hasThirdTrimesterGrade
} from '../src/utils/recursoRules';
import {
  calculateSituation,
  calculateExamPautaSituation,
  recalcMiniPautaRow,
  normalizeGradeRules
} from '../src/utils/pautaCalculations';

const rules = normalizeGradeRules(undefined as any);

describe('classAllowsRecurso (duração do curso)', () => {
  it('6.ª e 9.ª não dependem da duração', () => {
    expect(classAllowsRecurso('6.ª Classe', 4)).toBe(true);
    expect(classAllowsRecurso('9.ª Classe', 3)).toBe(true);
  });
  it('curso de 4 anos: Recurso só na 13.ª', () => {
    expect(classAllowsRecurso('12.ª Classe', 4)).toBe(false);
    expect(classAllowsRecurso('13.ª Classe', 4)).toBe(true);
  });
  it('curso de 3 anos: Recurso só na 12.ª', () => {
    expect(classAllowsRecurso('12.ª Classe', 3)).toBe(true);
    expect(classAllowsRecurso('13.ª Classe', 3)).toBe(false);
  });
  it('duração desconhecida: 13.ª => 4 anos, 12.ª => 3 anos', () => {
    expect(classAllowsRecurso('13.ª Classe')).toBe(true);
    expect(classAllowsRecurso('12.ª Classe')).toBe(true);
  });
});

describe('resolveCourseDurationYears', () => {
  const courses: any[] = [
    { id: 'c1', code: 'ENF', name: 'Enfermagem', durationYears: 4, linkedClassIds: [] },
    { id: 'c2', code: 'INF', name: 'Informática', durationYears: 3, linkedClassIds: ['k9'] }
  ];
  it('liga pela área curricular, sem acentos/maiúsculas', () => {
    expect(resolveCourseDurationYears(courses, { id: 'k1', area: 'ENFERMAGEM' } as any)).toBe(4);
  });
  it('liga por linkedClassIds', () => {
    expect(resolveCourseDurationYears(courses, { id: 'k9', area: '' } as any)).toBe(3);
  });
  it('sem curso => undefined', () => {
    expect(resolveCourseDurationYears(courses, { id: 'x', area: 'Outro' } as any)).toBeUndefined();
  });
});

describe('calculateSituation com recursoAllowed', () => {
  const base = { finalGrade: 8, hasAnyGrade: true, isDesistente: false, classGrade: '9.ª Classe', rules };
  it('negativa elegível com direito => RECURSO', () => {
    expect(calculateSituation({ ...base })).toBe('RECURSO');
  });
  it('sem direito (III trimestre sem nota / duração) => REPROVADO', () => {
    expect(calculateSituation({ ...base, recursoAllowed: false })).toBe('REPROVADO');
  });
});

describe('Lançar Notas: Recurso só com negativa no III Trimestre', () => {
  const mk = (mt3: string) =>
    ({ id: 'r', studentId: 's', num: 1, name: 'A', mac1: 8, npp1: 8, npt1: 8, mac2: 8, npp2: 8, npt2: 8, mac3: mt3 === '' ? '' : Number(mt3), npp3: mt3 === '' ? '' : Number(mt3), npt3: mt3 === '' ? '' : Number(mt3), nee: '', neo: '', ner: '', isDesistente: false } as any);
  const ctx = { regime: 'exame' as const, classGrade: '9.ª Classe', rules };

  it('negativa só no I e II => REPROVADO', () => {
    const r = recalcMiniPautaRow(mk(''), ctx);
    expect(r.obs).toBe('REPROVADO');
  });
  it('negativa também no III => RECURSO', () => {
    const r = recalcMiniPautaRow(mk('8'), ctx);
    expect(r.obs).toBe('RECURSO');
  });
  it('12.ª em curso de 4 anos, mesmo com III => REPROVADO', () => {
    const r = recalcMiniPautaRow(mk('8'), { ...ctx, classGrade: '12.ª Classe', courseDurationYears: 4 });
    expect(r.obs).toBe('REPROVADO');
  });
  it('13.ª em curso de 4 anos com III => RECURSO', () => {
    const r = recalcMiniPautaRow(mk('8'), { ...ctx, classGrade: '13.ª Classe', courseDurationYears: 4 });
    expect(r.obs).toBe('RECURSO');
  });
  it('13.ª em curso de 3 anos => REPROVADO', () => {
    const r = recalcMiniPautaRow(mk('8'), { ...ctx, classGrade: '13.ª Classe', courseDurationYears: 3 });
    expect(r.obs).toBe('REPROVADO');
  });
  it('12.ª em curso de 3 anos com III => RECURSO', () => {
    const r = recalcMiniPautaRow(mk('8'), { ...ctx, classGrade: '12.ª Classe', courseDurationYears: 3 });
    expect(r.obs).toBe('RECURSO');
  });
});

describe('Pauta Final (exame)', () => {
  const subj = (mt3: number | '') => ({ grade: 8, isKey: false, mt3 });
  it('sem III => REPROVADO; com III => RECURSO', () => {
    expect(calculateExamPautaSituation({ subjects: [subj('')], isDesistente: false, classGrade: '9.ª Classe', rules })).toBe('REPROVADO');
    expect(calculateExamPautaSituation({ subjects: [subj(8)], isDesistente: false, classGrade: '9.ª Classe', rules })).toBe('RECURSO');
  });
  it('12.ª em curso de 4 anos => REPROVADO', () => {
    expect(calculateExamPautaSituation({ subjects: [subj(8)], isDesistente: false, classGrade: '12.ª Classe', rules, courseDurationYears: 4 })).toBe('REPROVADO');
  });
  it('hasThirdTrimesterGrade', () => {
    expect(hasThirdTrimesterGrade(0)).toBe(true);
    expect(hasThirdTrimesterGrade('')).toBe(false);
  });
});
