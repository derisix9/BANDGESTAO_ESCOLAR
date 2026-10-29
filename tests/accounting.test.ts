import { describe, it, expect } from 'vitest';
import {
  computeTrialBalance, postingsFromLedger, postingsFromManual, validateJournal, buildPostings, buildClosingEntry, isClosingStale,
  computeBalanceSheet, depreciationPostings, accrualPostingsFromInvoices, accrualPostingsFromExpenses, accrualPostingsFromPayroll,
  resolveAccountingOptions, linesInCurrentChart, CHART, CHART_VERSION, DEFAULT_ACCOUNTING_OPTIONS
} from '../src/utils/accounting';
import { ASSET_INVESTMENT_CATEGORY, PAYROLL_CATEGORY } from '../src/utils/financeExtras';

const e = (over: any) => ({ id: 'x', date: '2026-10-01', kind: 'entrada', category: 'Propinas e serviços', description: 'd', isCash: true, channel: 'numerario', amount: 1000, ...over });

describe('contabilidade — balancete', () => {
  it('propina em numerário: D Caixa / C Prestações de serviços', () => {
    const tb = computeTrialBalance(postingsFromLedger([e({}) as any]));
    expect(tb.rows.find((r) => r.account.code === '45')!.balanceDebit).toBe(1000);
    expect(tb.rows.find((r) => r.account.code === '62')!.balanceCredit).toBe(1000);
    expect(tb.balanced).toBe(true);
  });
  it('Multicaixa/TPA/banco vão para Depósitos à ordem', () => {
    const tb = computeTrialBalance(postingsFromLedger([e({ channel: 'multicaixa' }) as any]));
    expect(tb.rows.map((r) => r.account.code).sort()).toEqual(['43', '62']);
  });
  it('salários, activos e outras despesas vão para as contas certas', () => {
    const p = postingsFromLedger([
      e({ id: '1', kind: 'saida', category: PAYROLL_CATEGORY, amount: 300 }),
      e({ id: '2', kind: 'saida', category: ASSET_INVESTMENT_CATEGORY, amount: 500 }),
      e({ id: '3', kind: 'saida', category: 'Energia', amount: 100 })
    ] as any);
    const tb = computeTrialBalance(p);
    const get = (c: string) => tb.rows.find((r) => r.account.code === c)!;
    expect(get('72').debit).toBe(300);
    expect(get('11').debit).toBe(500);
    expect(get('75.2').debit).toBe(100);
    expect(get('45').credit).toBe(900);
    expect(tb.custos).toBe(400);
  });
  it('resultado = proveitos − custos; total débitos = total créditos', () => {
    const p = postingsFromLedger([e({ amount: 2000 }), e({ id: '2', kind: 'saida', category: 'Água', amount: 500 })] as any);
    const tb = computeTrialBalance(p);
    expect(tb.proveitos).toBe(2000);
    expect(tb.resultado).toBe(1500);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
  it('filtra por período (inclusivo)', () => {
    const p = postingsFromLedger([e({ date: '2026-09-30' }), e({ id: '2', date: '2026-10-15', amount: 50 })] as any);
    expect(computeTrialBalance(p, { from: '2026-10-01', to: '2026-10-31' }).totalDebit).toBe(50);
  });
  it('lançamento manual entra no balancete', () => {
    const p = postingsFromManual([{ id: 'j', date: '2026-01-01', description: 'Capital', createdBy: '', createdAt: '', lines: [{ account: '43', debit: 10000, credit: 0 }, { account: '51', debit: 0, credit: 10000 }] }]);
    expect(computeTrialBalance(p).rows.find((r) => r.account.code === '51')!.balanceCredit).toBe(10000);
  });
});

describe('validação de lançamentos manuais', () => {
  const ok = [{ account: '43', debit: 100, credit: 0 }, { account: '51', debit: 0, credit: 100 }];
  it('aceita um lançamento equilibrado', () => expect(validateJournal('2026-01-01', 'x', ok)).toEqual([]));
  it('recusa desequilíbrio', () => expect(validateJournal('2026-01-01', 'x', [ok[0], { account: '51', debit: 0, credit: 90 }]).join()).toMatch(/equilibrado/));
  it('recusa conta inexistente, linha com os dois lados e falta de descrição', () => {
    expect(validateJournal('2026-01-01', 'x', [{ account: '99', debit: 1, credit: 0 }, ok[1]]).join()).toMatch(/Conta inválida/);
    expect(validateJournal('2026-01-01', 'x', [{ account: '43', debit: 5, credit: 5 }, ok[1]]).join()).toMatch(/débito OU crédito/);
    expect(validateJournal('2026-01-01', ' ', ok).join()).toMatch(/descrição/);
  });
});

describe('plano de contas (PGC angolano)', () => {
  it('Caixa é 45, Depósitos à ordem 43, serviços 62, pessoal 72', () => {
    const name = (c: string) => CHART.find((a) => a.code === c)!.name;
    expect(name('45')).toBe('Caixa');
    expect(name('43')).toContain('Depósitos à ordem');
    expect(name('62')).toContain('Prestações de serviços');
    expect(name('72')).toBe('Custos com o pessoal');
    expect(CHART.map((a) => a.code).length).toBe(new Set(CHART.map((a) => a.code)).size);
  });
  it('lançamento manual antigo (versão 1) é convertido sem encadear', () => {
    const old = [{ account: '41', debit: 10, credit: 0 }, { account: '61', debit: 0, credit: 10 }, { account: '71', debit: 5, credit: 0 }, { account: '72', debit: 3, credit: 0 }, { account: '11', debit: 1, credit: 0 }];
    expect(linesInCurrentChart(old).map((l) => l.account)).toEqual(['45', '62', '72', '75.2', '11']);
    expect(linesInCurrentChart(old, CHART_VERSION).map((l) => l.account)).toEqual(['41', '61', '71', '72', '11']);
  });
});

const TODAY = '2026-10-26';
const inv = (over: any) => ({ id: 'i1', status: 'atraso', dueDate: '2026-09-10', totalAmountKz: 5000, studentName: 'Ana', ...over });

describe('regime de acréscimo', () => {
  it('propina vencida e por pagar fica em Clientes (31) e já é proveito', () => {
    const tb = computeTrialBalance(accrualPostingsFromInvoices([inv({})] as any, TODAY));
    expect(tb.rows.find((r) => r.account.code === '31')!.balanceDebit).toBe(5000);
    expect(tb.proveitos).toBe(5000);
    expect(tb.balanced).toBe(true);
  });
  it('propina com vencimento futuro ainda não é proveito', () => {
    expect(accrualPostingsFromInvoices([inv({ dueDate: '2026-12-10', status: 'pendente' })] as any, TODAY)).toHaveLength(0);
  });
  it('propina paga limpa o cliente e entra no caixa/banco certo', () => {
    const tb = computeTrialBalance(accrualPostingsFromInvoices([inv({ status: 'pago', paymentDate: '2026-09-12', method: 'numerario', totalPaidKz: 5000 })] as any, TODAY));
    expect(tb.rows.find((r) => r.account.code === '31')!.balanceDebit).toBe(0);
    expect(tb.rows.find((r) => r.account.code === '45')!.balanceDebit).toBe(5000);
  });
  it('propina isenta não gera nada', () => {
    expect(accrualPostingsFromInvoices([inv({ status: 'isento' })] as any, TODAY)).toHaveLength(0);
  });
  it('despesa por pagar fica em Fornecedores; depois de paga, sai de lá', () => {
    const exp = { id: 'e1', category: 'Água', amount: 800, date: '2026-10-01', supplier: 'EPAL' };
    const open = computeTrialBalance(accrualPostingsFromExpenses([exp] as any, TODAY));
    expect(open.rows.find((r) => r.account.code === '32')!.balanceCredit).toBe(800);
    const paid = computeTrialBalance(accrualPostingsFromExpenses([{ ...exp, paidDate: '2026-10-20' }] as any, TODAY));
    expect(paid.rows.find((r) => r.account.code === '32')!.balanceCredit).toBe(0);
    expect(paid.rows.find((r) => r.account.code === '45')!.balanceCredit).toBe(800);
  });
  it('salário pendente fica em Pessoal (36) no fim do mês de referência', () => {
    const p = accrualPostingsFromPayroll([{ id: 'p1', status: 'pendente', netSalaryKz: 1000, referenceMonth: 9, referenceYear: 2026 }] as any, TODAY);
    expect(p[0].date).toBe('2026-09-30');
    expect(computeTrialBalance(p).rows.find((r) => r.account.code === '36')!.balanceCredit).toBe(1000);
  });
  it('buildPostings: o mesmo cenário dá resultados diferentes em caixa e em acréscimo, sempre equilibrado', () => {
    const src: any = { invoices: [inv({}), inv({ id: 'i2', status: 'pago', paymentDate: '2026-09-12', method: 'numerario', totalPaidKz: 2000, totalAmountKz: 2000 })], expenses: [{ id: 'e1', category: 'Água', amount: 800, date: '2026-10-01' }], payroll: [], assets: [], manual: [] };
    const caixa = computeTrialBalance(buildPostings(src, DEFAULT_ACCOUNTING_OPTIONS, TODAY));
    const acr = computeTrialBalance(buildPostings(src, { basis: 'acrescimo', depreciation: false }, TODAY));
    expect(caixa.resultado).toBe(2000);
    expect(acr.resultado).toBe(5000 + 2000 - 800);
    expect(caixa.balanced && acr.balanced).toBe(true);
  });
});

describe('amortizações', () => {
  const asset = { id: 'a1', code: 'ATIVO-1', name: 'PC', category: 'informatica', acquisitionDate: '2026-07-15', acquisitionValueKz: 360000 };
  it('quota mensal = valor ÷ (vida útil × 12), só meses completos até hoje', () => {
    const p = depreciationPostings([asset], TODAY);
    expect(p.map((x) => x.date)).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
    expect(p[0].lines[0]).toEqual({ account: '73', debit: 10000, credit: 0 });
    expect(p[0].lines[1]).toEqual({ account: '18', debit: 0, credit: 10000 });
  });
  it('a vida útil configurada manda', () => {
    expect(depreciationPostings([asset], TODAY, { informatica: 6 })[0].lines[0].debit).toBe(5000);
  });
  it('pára no fim da vida útil e a soma bate certo ao cêntimo', () => {
    const p = depreciationPostings([{ ...asset, acquisitionValueKz: 1000, acquisitionDate: '2020-01-10' }], TODAY);
    expect(p).toHaveLength(36);
    expect(Math.round(p.reduce((s, x) => s + x.lines[0].debit, 0) * 100) / 100).toBe(1000);
  });
  it('activo abatido pára de amortizar na data do abate; sem data, não amortiza', () => {
    expect(depreciationPostings([{ ...asset, status: 'abatido', updatedAt: '2026-08-20' }], TODAY)).toHaveLength(1);
    expect(depreciationPostings([{ ...asset, status: 'abatido' }], TODAY)).toHaveLength(0);
  });
  it('opções: amortização desligada por omissão; vida útil inválida é ignorada', () => {
    expect(resolveAccountingOptions(undefined).depreciation).toBe(false);
    expect(resolveAccountingOptions({ usefulLifeYears: { informatica: 0, mobiliario: 10 } }).usefulLifeYears).toEqual({ mobiliario: 10 });
  });
});

describe('fecho do ano e balanço', () => {
  const base = () => postingsFromLedger([
    e({ amount: 2000, date: '2026-03-10' }),
    e({ id: '2', kind: 'saida', category: 'Água', amount: 500, date: '2026-04-10' }),
    e({ id: '3', amount: 100, date: '2027-01-05' })
  ] as any);
  it('apura o resultado do ano contra 88 e fica equilibrado', () => {
    const c = buildClosingEntry(base(), 2026)!;
    expect(c.proveitos).toBe(2000);
    expect(c.custos).toBe(500);
    expect(c.resultado).toBe(1500);
    expect(c.lines.find((l) => l.account === '88')).toEqual({ account: '88', debit: 0, credit: 1500 });
    const d = c.lines.reduce((s, l) => s + l.debit, 0), k = c.lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(k);
    expect(c.date).toBe('2026-12-31');
  });
  it('prejuízo vai a débito de 88', () => {
    const c = buildClosingEntry(postingsFromLedger([e({ id: '2', kind: 'saida', category: 'Água', amount: 500 })] as any), 2026)!;
    expect(c.lines.find((l) => l.account === '88')).toEqual({ account: '88', debit: 500, credit: 0 });
  });
  it('ano sem proveitos nem custos: nada a fechar', () => {
    expect(buildClosingEntry(base(), 2025)).toBeNull();
  });
  it('depois do fecho, o balancete do ano continua a mostrar proveitos e custos; o balanço usa o resultado fechado', () => {
    const c = buildClosingEntry(base(), 2026)!;
    const all = [...base(), ...postingsFromManual([{ id: 'f', date: c.date, description: c.description, lines: c.lines, chartVersion: CHART_VERSION, closingYear: 2026, createdBy: '', createdAt: '' }])];
    const tb = computeTrialBalance(all, { from: '2026-01-01', to: '2026-12-31' });
    expect(tb.proveitos).toBe(2000);
    expect(tb.resultado).toBe(1500);
    const bs = computeBalanceSheet(all, '2026-12-31');
    expect(bs.capitalProprio.lines.find((l) => l.code === '88')!.amount).toBe(1500);
    expect(bs.capitalProprio.lines.find((l) => l.label.includes('em aberto'))).toBeUndefined();
    expect(bs.totalActivo).toBe(1500);
    expect(bs.balanced).toBe(true);
  });
  it('detecta fecho desactualizado quando entra um lançamento no ano depois de fechar', () => {
    const c = buildClosingEntry(base(), 2026)!;
    expect(isClosingStale(base(), 2026, c.lines)).toBe(false);
    const late = [...base(), ...postingsFromLedger([e({ id: '9', amount: 40, date: '2026-11-02' })] as any)];
    expect(isClosingStale(late, 2026, c.lines)).toBe(true);
  });
  it('balanço: contas a receber, fornecedores, amortizações acumuladas e capital; total activo = capital + passivo', () => {
    const src: any = {
      invoices: [inv({})], expenses: [{ id: 'e1', category: 'Água', amount: 800, date: '2026-10-01' }], payroll: [],
      assets: [{ id: 'a1', code: 'A1', category: 'informatica', acquisitionDate: '2026-07-01', acquisitionValueKz: 360000 }],
      manual: [{ id: 'j', date: '2026-01-01', description: 'Capital', chartVersion: CHART_VERSION, createdBy: '', createdAt: '', lines: [{ account: '43', debit: 500000, credit: 0 }, { account: '51', debit: 0, credit: 500000 }] }]
    };
    const bs = computeBalanceSheet(buildPostings(src, { basis: 'acrescimo', depreciation: true }, TODAY), TODAY);
    const line = (sec: any, code: string) => sec.lines.find((l: any) => l.code === code)?.amount;
    expect(line(bs.activoCorrente, '31')).toBe(5000);
    expect(line(bs.passivoCorrente, '32')).toBe(800);
    expect(line(bs.activoNaoCorrente, '18')).toBe(-30000);
    expect(line(bs.capitalProprio, '51')).toBe(500000);
    expect(bs.balanced).toBe(true);
  });
});
