import { describe, expect, it } from 'vitest';
import { validateIndividualPlan, addMonthsIso, planProgress, isReviewOverdue, daysUntil } from '../src/utils/individualPlan';

const ok = (o: any = {}) => ({ studentId: 's1', category: 'autismo', startDate: '2026-09-15', reviewEveryMonths: 3, responsible: 'Dra. X', description: 'Precisa de apoio', goals: [{ description: 'Ler frases curtas', targetDate: '2026-12-01' }], ...o });

describe('plano individual', () => {
  it('plano completo é válido', () => { expect(validateIndividualPlan(ok(), [])).toEqual([]); });
  it('exige objectivos, responsável e intervalo de revisão válido', () => {
    expect(validateIndividualPlan(ok({ goals: [] }), [])).toContain('Defina pelo menos um objectivo.');
    expect(validateIndividualPlan(ok({ responsible: ' ' }), [])).toContain('Indique o responsável pelo plano.');
    expect(validateIndividualPlan(ok({ reviewEveryMonths: 0 }), []).length).toBe(1);
    expect(validateIndividualPlan(ok({ reviewEveryMonths: 2.5 }), []).length).toBe(1);
  });
  it('data-alvo antes do início e data impossível', () => {
    expect(validateIndividualPlan(ok({ goals: [{ description: 'a', targetDate: '2026-01-01' }] }), []).length).toBe(1);
    expect(validateIndividualPlan(ok({ goals: [{ description: 'a', targetDate: '2026-02-30' }] }), []).length).toBe(1);
  });
  it('um só plano em curso por aluno (encerrado não conta)', () => {
    expect(validateIndividualPlan(ok(), [{ id: 'p', studentId: 's1', status: 'ativo' } as any]).length).toBe(1);
    expect(validateIndividualPlan(ok(), [{ id: 'p', studentId: 's1', status: 'encerrado' } as any])).toEqual([]);
    expect(validateIndividualPlan(ok(), [{ id: 'p', studentId: 's1', status: 'ativo' } as any], 'p')).toEqual([]);
  });
  it('datas de revisão', () => {
    expect(addMonthsIso('2026-09-15', 3)).toBe('2026-12-15');
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsIso('2026-12-10', 1)).toBe('2027-01-10');
  });
  it('progresso e atraso', () => {
    expect(planProgress([{ status: 'atingido' }, { status: 'pendente' }] as any)).toBe(50);
    expect(planProgress([])).toBe(0);
    expect(isReviewOverdue({ status: 'ativo', nextReviewDate: '2026-10-01' }, '2026-10-27')).toBe(true);
    expect(isReviewOverdue({ status: 'encerrado', nextReviewDate: '2026-10-01' }, '2026-10-27')).toBe(false);
    expect(daysUntil('2026-10-30', '2026-10-27')).toBe(3);
  });
});
