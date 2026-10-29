import { describe, expect, it } from 'vitest';
import {
  EARLY_PAYMENT_CUTOFF_DAY, computeTuitionCharges, countEnrolledSiblings, evaluateMonthsLateStatus, getFinancialRules, getTuitionDueDate
} from '../src/utils/financialRules';

const rules = getFinancialRules(null); // dia 10, 3 dias de carência, multa 10%, antecipado 5%, irmãos 10%

describe('getFinancialRules', () => {
  it('valores por omissão e configuração parcial', () => {
    expect(rules).toMatchObject({ paymentDueDay: 10, graceDays: 3, lateFeePercent: 10, discountPercent: 5, siblingDiscountPercent: 10 });
    expect(getFinancialRules({ financialRules: { paymentDueDay: 15, lateFeePercent: 0 } } as any)).toMatchObject({
      paymentDueDay: 15, lateFeePercent: 0, graceDays: 3
    });
  });
});

describe('getTuitionDueDate', () => {
  it('o vencimento é o dia limite do próprio mês (com acentos e maiúsculas)', () => {
    expect(getTuitionDueDate('março', new Date(2026, 2, 5), 10)).toEqual(new Date(2026, 2, 10));
    expect(getTuitionDueDate('Março', new Date(2026, 2, 5), 10)).toEqual(new Date(2026, 2, 10));
    expect(getTuitionDueDate('marco', new Date(2026, 2, 5), 10)).toEqual(new Date(2026, 2, 10));
  });

  it('dezembro pago em janeiro pertence ao ano anterior', () => {
    expect(getTuitionDueDate('dezembro', new Date(2026, 0, 8), 10)).toEqual(new Date(2025, 11, 10));
  });
});

describe('evaluateMonthsLateStatus', () => {
  it('a carência protege até ao dia limite + 3', () => {
    expect(evaluateMonthsLateStatus(['março'], new Date(2026, 2, 13), rules)[0]).toMatchObject({ isLate: false, daysLate: 0 });
    expect(evaluateMonthsLateStatus(['março'], new Date(2026, 2, 14), rules)[0]).toMatchObject({ isLate: true, daysLate: 1 });
    expect(evaluateMonthsLateStatus(['março'], new Date(2026, 2, 20), rules)[0]).toMatchObject({ isLate: true, daysLate: 7 });
  });

  it('cada mês é avaliado à parte', () => {
    const r = evaluateMonthsLateStatus(['janeiro', 'março'], new Date(2026, 2, 12), rules);
    expect(r.map((m) => m.isLate)).toEqual([true, false]);
  });
});

describe('countEnrolledSiblings', () => {
  const s = (id: string, extra: any = {}) => ({ id, guardianName: 'Maria Silva', guardianPhone: '923', ...extra }) as any;

  it('conta outros alunos do mesmo encarregado, sem contar o próprio', () => {
    const all = [s('1'), s('2'), s('3', { guardianName: 'Outro', guardianPhone: '1' })];
    expect(countEnrolledSiblings(all, all[0])).toBe(1);
    expect(countEnrolledSiblings(all, all[2])).toBe(0);
  });

  it('o NIF do encarregado tem prioridade sobre nome e telefone', () => {
    const a = s('1', { guardianNif: '123' });
    const b = s('2', { guardianNif: '123', guardianName: 'Outro nome', guardianPhone: '000' });
    expect(countEnrolledSiblings([a, b], a)).toBe(1);
  });

  it('sem dados do encarregado não há irmãos', () => {
    const a = { id: '1' } as any;
    expect(countEnrolledSiblings([a, { id: '2' } as any], a)).toBe(0);
  });
});

describe('computeTuitionCharges', () => {
  const charge = (day: number, extra: any = {}) =>
    computeTuitionCharges({ months: ['março'], monthlyTuitionKz: 50000, paymentDate: new Date(2026, 2, day), rules, siblingCount: 0, ...extra });

  it('pagamento antecipado (até ao dia 5): desconto de 5%', () => {
    expect(EARLY_PAYMENT_CUTOFF_DAY).toBe(5);
    expect(charge(3)).toMatchObject({ baseAmountKz: 50000, earlyDiscountKz: 2500, lateFeeKz: 0, totalAmountKz: 47500, isEarly: true, isLate: false });
    expect(charge(5).isEarly).toBe(true);
    expect(charge(6)).toMatchObject({ isEarly: false, totalAmountKz: 50000 });
  });

  it('em atraso: multa de 10% e sem desconto antecipado', () => {
    expect(charge(20)).toMatchObject({ lateFeeKz: 5000, earlyDiscountKz: 0, totalAmountKz: 55000, isLate: true, maxDaysLate: 7 });
  });

  it('desconto de agregado familiar a partir do 2.º educando', () => {
    expect(charge(8, { siblingCount: 1 })).toMatchObject({ siblingDiscountKz: 5000, totalAmountKz: 45000, hasSiblingDiscount: true });
    expect(charge(8, { siblingCount: 0 }).hasSiblingDiscount).toBe(false);
  });

  it('descontos acumulam; com atraso só fica o desconto de irmãos', () => {
    expect(charge(3, { siblingCount: 1 })).toMatchObject({ totalDiscountKz: 7500, totalAmountKz: 42500 });
    expect(charge(20, { siblingCount: 1 })).toMatchObject({ earlyDiscountKz: 0, siblingDiscountKz: 5000, lateFeeKz: 5000, totalAmountKz: 50000 });
  });

  it('vários meses: a multa só incide nos meses em atraso', () => {
    const r = computeTuitionCharges({
      months: ['janeiro', 'fevereiro', 'março'], monthlyTuitionKz: 10000, paymentDate: new Date(2026, 2, 12), rules, siblingCount: 0
    });
    expect(r.baseAmountKz).toBe(30000);
    expect(r.lateFeeKz).toBe(2000); // janeiro + fevereiro × 10%
    expect(r.totalAmountKz).toBe(32000);
  });

  it('sem meses ou sem valor não cobra nada', () => {
    expect(computeTuitionCharges({ months: [], monthlyTuitionKz: 50000, paymentDate: new Date(2026, 2, 3), rules, siblingCount: 1 }).totalAmountKz).toBe(0);
    expect(charge(3, { monthlyTuitionKz: 0 }).totalAmountKz).toBe(0);
  });

  it('o total nunca é negativo, mesmo com descontos enormes', () => {
    const greedy = { ...rules, discountPercent: 80, siblingDiscountPercent: 80 };
    expect(charge(3, { rules: greedy, siblingCount: 1 }).totalAmountKz).toBe(0);
  });
});
