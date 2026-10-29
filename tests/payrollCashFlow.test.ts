import { beforeEach, describe, expect, it } from 'vitest';
import type { PayrollRecord } from '../src/types';
import { DEFAULT_PAYROLL_TAX_SETTINGS } from '../src/utils/payroll';
import {
  PAYROLL_CHARGES_CATEGORY, employerInss, inssDueDate, irtDueDate, payrollChargesDue, payrollForecast, planChargeSync
} from '../src/utils/payrollCashFlow';
import { ASSET_INVESTMENT_CATEGORY, PAYROLL_CATEGORY, buildLedger, monthlyCashFlow } from '../src/utils/financeExtras';
import { dbService } from '../src/services/db';

const tax = DEFAULT_PAYROLL_TAX_SETTINGS;
const rec = (id: string, extra: Partial<PayrollRecord> = {}): PayrollRecord => ({
  id, personId: `p-${id}`, personType: 'teacher', personName: `Pessoa ${id}`, personRole: 'Professor', academicYear: '2026/2027',
  referenceMonth: 10, referenceYear: 2026, baseSalaryKz: 200000, allowancesKz: 0, bonusKz: 0, otherDeductionsKz: 0,
  grossSalaryKz: 200000, inssEmployeeKz: 6000, irtKz: 20000, netSalaryKz: 174000, status: 'pendente',
  generatedAt: '2026-10-01T00:00:00.000Z', generatedByName: 'Teste', ...extra
} as PayrollRecord);

describe('encargos da folha', () => {
  it('INSS patronal pelas taxas configuradas', () => {
    expect(employerInss(200000, tax)).toBe(16000);
    expect(employerInss(0, tax)).toBe(0);
    expect(employerInss(100000, { ...tax, inssEmployerRatePercent: 10 })).toBe(10000);
  });

  it('prazos: INSS dia 10 e IRT fim do mês seguinte (também na viragem do ano e em fevereiro)', () => {
    expect(inssDueDate(2026, 10)).toBe('2026-11-10');
    expect(inssDueDate(2026, 12)).toBe('2027-01-10');
    expect(irtDueDate(2026, 10)).toBe('2026-11-30');
    expect(irtDueDate(2026, 12)).toBe('2027-01-31');
    expect(irtDueDate(2027, 1)).toBe('2027-02-28');
  });

  it('soma por mês, ignora cancelados e tem ids estáveis', () => {
    const due = payrollChargesDue([
      rec('a'), rec('b', { inssEmployeeKz: 3000, grossSalaryKz: 100000, irtKz: 0 }),
      rec('c', { status: 'cancelado' }), rec('d', { referenceMonth: 11, status: 'pago' })
    ], tax);
    const oct = due.filter((d) => d.month === 10);
    // INSS out: (6000+16000) + (3000+8000) = 33000; IRT: 20000
    expect(oct.map((d) => [d.id, d.kind, d.amount, d.dueDate, d.supplier, d.records])).toEqual([
      ['enc-inss-2026-10', 'inss', 33000, '2026-11-10', 'INSS', 2],
      ['enc-irt-2026-10', 'irt', 20000, '2026-11-30', 'AGT', 2]
    ]);
    expect(due.filter((d) => d.month === 11).map((d) => d.id)).toEqual(['enc-inss-2026-11', 'enc-irt-2026-11']);
    expect(payrollChargesDue([rec('a', { irtKz: 0 })], tax).map((d) => d.kind)).toEqual(['inss']);
    expect(payrollChargesDue([rec('x', { referenceMonth: 13 as any })], tax)).toEqual([]);
  });

  it('plano de sincronização: cria, actualiza o por pagar, nunca mexe no pago, não duplica', () => {
    const due = payrollChargesDue([rec('a')], tax);
    expect(planChargeSync(due, []).create).toHaveLength(2);
    expect(planChargeSync(due, [{ id: 'enc-inss-2026-10', amount: 22000 }, { id: 'enc-irt-2026-10', amount: 20000 }])).toMatchObject({ unchanged: 2, create: [], update: [], paidMismatch: [] });
    const changed = planChargeSync(due, [{ id: 'enc-inss-2026-10', amount: 1 }, { id: 'enc-irt-2026-10', amount: 1, paidDate: '2026-11-05' }]);
    expect(changed.update.map((d) => d.id)).toEqual(['enc-inss-2026-10']);
    expect(changed.paidMismatch.map((d) => d.id)).toEqual(['enc-irt-2026-10']);
  });

  it('previsão: pendentes (líquido) + encargos por pagar; pagos saem da previsão', () => {
    const records = [rec('a'), rec('b', { status: 'pago' }), rec('c', { status: 'cancelado' })];
    expect(payrollForecast(records, tax)).toEqual([{ month: '2026-10', pendingNet: 174000, pendingCount: 1, chargesDue: 84000 }]);
    expect(payrollForecast(records, tax, ['enc-inss-2026-10', 'enc-irt-2026-10'])).toEqual([{ month: '2026-10', pendingNet: 174000, pendingCount: 1, chargesDue: 0 }]);
    expect(payrollForecast([rec('b', { status: 'pago' })], tax, ['enc-inss-2026-10', 'enc-irt-2026-10'])).toEqual([]);
  });
});

describe('fluxo de caixa: salário pago + encargos pagos', () => {
  it('encargos só saem do fluxo quando a despesa é paga; o salário líquido sai no pagamento', () => {
    const payroll = [rec('a', { status: 'pago', paymentDate: '2026-10-28', paymentMethod: 'transferencia' })];
    const expenses = [
      { id: 'enc-inss-2026-10', category: PAYROLL_CHARGES_CATEGORY, amount: 22000, date: '2026-10-31', dueDate: '2026-11-10' },
      { id: 'enc-irt-2026-10', category: PAYROLL_CHARGES_CATEGORY, amount: 20000, date: '2026-10-31', dueDate: '2026-11-30', paidDate: '2026-11-20' }
    ];
    const ledger = buildLedger([], expenses as any, payroll as any);
    expect(ledger.map((e) => [e.date, e.category, e.amount])).toEqual([
      ['2026-10-28', PAYROLL_CATEGORY, 174000],
      ['2026-11-20', PAYROLL_CHARGES_CATEGORY, 20000]
    ]);
    const flow = monthlyCashFlow(ledger.map((e) => ({ date: e.date, amount: -e.amount, source: 'despesa' as const })), 0);
    expect(flow.map((m) => [m.month, m.outflow])).toEqual([['2026-10', 174000], ['2026-11', 20000]]);
    expect(ASSET_INVESTMENT_CATEGORY).not.toBe(PAYROLL_CHARGES_CATEGORY);
  });
});

const D: any = dbService;
describe('db.syncPayrollChargePayables', () => {
  beforeEach(() => {
    D.db.settings = { ...(D.db.settings || {}), payrollTaxSettings: undefined };
    D.db.currentUser = { ...(D.db.currentUser || {}), name: 'Fin. Teste' };
    D.db.expenses = [];
    D.db.payrollRecords = [rec('a'), rec('b', { referenceMonth: 11 })];
  });

  it('cria as contas a pagar e repetir não duplica', () => {
    const r1 = dbService.syncPayrollChargePayables();
    expect(r1).toMatchObject({ success: true, created: 4, updated: 0 });
    expect(D.db.expenses.map((e: any) => e.id).sort()).toEqual(['enc-inss-2026-10', 'enc-inss-2026-11', 'enc-irt-2026-10', 'enc-irt-2026-11']);
    const inss = D.db.expenses.find((e: any) => e.id === 'enc-inss-2026-10');
    expect(inss).toMatchObject({ amount: 22000, supplier: 'INSS', category: PAYROLL_CHARGES_CATEGORY, dueDate: '2026-11-10', createdBy: 'Fin. Teste' });
    expect(inss.paidDate).toBeUndefined();
    expect(dbService.syncPayrollChargePayables()).toMatchObject({ created: 0, updated: 0 });
    expect(D.db.expenses).toHaveLength(4);
  });

  it('se a folha mudar actualiza o por pagar e não toca no já pago', () => {
    dbService.syncPayrollChargePayables();
    D.db.expenses = D.db.expenses.map((e: any) => (e.id === 'enc-irt-2026-10' ? { ...e, paidDate: '2026-11-20' } : e));
    D.db.payrollRecords = [rec('a', { grossSalaryKz: 300000, inssEmployeeKz: 9000, irtKz: 30000 }), rec('b', { referenceMonth: 11 })];
    const r = dbService.syncPayrollChargePayables();
    expect(r).toMatchObject({ created: 0, updated: 1, paidMismatch: 1 });
    expect(D.db.expenses.find((e: any) => e.id === 'enc-inss-2026-10').amount).toBe(33000);
    expect(D.db.expenses.find((e: any) => e.id === 'enc-irt-2026-10')).toMatchObject({ amount: 20000, paidDate: '2026-11-20' });
  });

  it('não mexe nas despesas normais', () => {
    D.db.expenses = [{ id: 'desp-1', category: 'Água', amount: 5000, date: '2026-10-03', createdBy: 'x', createdAt: '' }];
    dbService.syncPayrollChargePayables();
    expect(D.db.expenses.find((e: any) => e.id === 'desp-1')).toMatchObject({ amount: 5000 });
    expect(D.db.expenses).toHaveLength(5);
  });
});
