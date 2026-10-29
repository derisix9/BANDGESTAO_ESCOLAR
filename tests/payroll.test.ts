import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYROLL_TAX_SETTINGS as TAX, calcInss, calcIrt, computePayroll, formatKz, getEffectivePayrollTaxSettings } from '../src/utils/payroll';

describe('INSS do trabalhador (3%)', () => {
  it('arredonda ao Kwanza e nunca é negativo', () => {
    expect(calcInss(300000, TAX)).toBe(9000);
    expect(calcInss(100001, TAX)).toBe(3000); // 3000,03
    expect(calcInss(0, TAX)).toBe(0);
    expect(calcInss(-500, TAX)).toBe(0);
  });
});

describe('IRT marginal por escalões', () => {
  it('isento até ao limite de isenção', () => {
    expect(calcIrt(0, TAX)).toBe(0);
    expect(calcIrt(150000, TAX)).toBe(0);
  });

  it('cada escalão só taxa a sua parte', () => {
    expect(calcIrt(200000, TAX)).toBe(8000); // 50 000 × 16%
    expect(calcIrt(291000, TAX)).toBe(24380); // 8 000 + 91 000 × 18%
    expect(calcIrt(300000, TAX)).toBe(26000); // 8 000 + 100 000 × 18%
  });

  it('escalões altos e escalão aberto (sem tecto)', () => {
    // 150–200: 8 000 | 200–300: 18 000 | 300–500: 38 000 | 500–1 000: 100 000 → 164 000 até 1 000 000
    expect(calcIrt(1000000, TAX)).toBe(164000);
    expect(calcIrt(6000000, TAX)).toBeGreaterThan(calcIrt(5000000, TAX));
  });

  it('é monótono: ganhar mais nunca paga menos imposto', () => {
    let prev = 0;
    for (let base = 0; base <= 6000000; base += 12500) {
      const irt = calcIrt(base, TAX);
      expect(irt).toBeGreaterThanOrEqual(prev);
      prev = irt;
    }
  });

  it('o imposto nunca excede a taxa máxima sobre a base', () => {
    for (const base of [160000, 400000, 2000000, 9000000]) {
      expect(calcIrt(base, TAX)).toBeLessThanOrEqual(Math.round(base * 0.25));
    }
  });
});

describe('computePayroll', () => {
  it('caso de referência: 300 000 Kz brutos', () => {
    const r = computePayroll({ baseSalaryKz: 300000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 0 }, TAX);
    expect(r).toEqual({ grossSalaryKz: 300000, inssEmployeeKz: 9000, irtKz: 24380, netSalaryKz: 266620 });
  });

  it('subsídios e bónus entram no bruto', () => {
    const r = computePayroll({ baseSalaryKz: 200000, allowancesKz: 50000, bonusKz: 50000, otherDeductionsKz: 0 }, TAX);
    expect(r.grossSalaryKz).toBe(300000);
    expect(r.netSalaryKz).toBe(266620);
  });

  it('outras deduções descontam do líquido; valores negativos são ignorados', () => {
    const base = { baseSalaryKz: 300000, allowancesKz: 0, bonusKz: 0 };
    expect(computePayroll({ ...base, otherDeductionsKz: 10000 }, TAX).netSalaryKz).toBe(256620);
    expect(computePayroll({ ...base, otherDeductionsKz: -10000 }, TAX).netSalaryKz).toBe(266620);
  });

  it('salário abaixo da isenção: só paga INSS', () => {
    const r = computePayroll({ baseSalaryKz: 100000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 0 }, TAX);
    expect(r.irtKz).toBe(0);
    expect(r.netSalaryKz).toBe(97000);
  });

  it('o líquido nunca é negativo nem superior ao bruto', () => {
    const r = computePayroll({ baseSalaryKz: 50000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 999999 }, TAX);
    expect(r.netSalaryKz).toBe(0);
    const s = computePayroll({ baseSalaryKz: 800000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 0 }, TAX);
    expect(s.netSalaryKz).toBeLessThan(s.grossSalaryKz);
  });

  it('bruto = líquido + INSS + IRT + outras deduções', () => {
    const input = { baseSalaryKz: 450000, allowancesKz: 30000, bonusKz: 20000, otherDeductionsKz: 5000 };
    const r = computePayroll(input, TAX);
    expect(r.netSalaryKz + r.inssEmployeeKz + r.irtKz + input.otherDeductionsKz).toBe(r.grossSalaryKz);
  });

  it('usa a tabela configurada pela escola', () => {
    const custom = { ...TAX, irtExemptionThresholdKz: 500000 };
    const r = computePayroll({ baseSalaryKz: 300000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 0 }, custom);
    expect(r.irtKz).toBe(0);
  });
});

describe('definições e formatação', () => {
  it('sem tabela guardada usa a de referência', () => {
    expect(getEffectivePayrollTaxSettings({ settings: {} } as any)).toBe(TAX);
    expect(getEffectivePayrollTaxSettings({ settings: { payrollTaxSettings: { irtBrackets: [] } } } as any)).toBe(TAX);
  });

  it('formatKz tolera valores em falta', () => {
    expect(typeof formatKz(1234)).toBe('string');
    expect(() => formatKz(null)).not.toThrow();
    expect(() => formatKz(undefined)).not.toThrow();
  });
});
