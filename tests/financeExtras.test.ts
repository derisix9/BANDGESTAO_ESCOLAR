import { describe, expect, it } from 'vitest';
import {
  accountsPayable, applyDiscountRules, buildInstallmentPlan, buildLedger, computeSessionTotals, isOverdue, monthlyCashFlow,
  parseAmount, parseBankCsv, reconcileBank, toISODate, balanceByChannel, invoicePeriodOptions, filterInvoicesByPeriod, ledgerPeriodOptions, filterLedgerByPeriod, expensesTotal, collectionSummary, PAYROLL_CATEGORY, ASSET_INVESTMENT_CATEGORY
} from '../src/utils/financeExtras';

describe('plano de prestações', () => {
  it('a soma das prestações é exatamente o total; o resto vai para a última', () => {
    const p = buildInstallmentPlan(100000, 3, '2026-10-31');
    expect(p.map((x) => x.amount)).toEqual([33333, 33333, 33334]);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBe(100000);
  });
  it('datas mensais respeitam fim de mês e virada de ano', () => {
    const p = buildInstallmentPlan(3000, 4, '2026-11-30');
    expect(p.map((x) => x.dueDate)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  });
  it('entradas inválidas devolvem vazio', () => {
    expect(buildInstallmentPlan(0, 3, '2026-10-01')).toEqual([]);
    expect(buildInstallmentPlan(100, 0, '2026-10-01')).toEqual([]);
  });
});

describe('descontos por regra', () => {
  const irmao = { id: 'irm', label: 'Irmãos', kind: 'percent' as const, value: 10, minSiblingPosition: 2 };
  const pronto = { id: 'pp', label: 'Pronto pagamento', kind: 'fixed' as const, value: 2000, paidByDay: 10, stackable: true };
  const bolsa = { id: 'b', label: 'Bolsa mérito', kind: 'percent' as const, value: 25 };
  it('só aplica a regra de irmãos a partir do 2.º', () => {
    expect(applyDiscountRules(50000, [irmao], { siblingPosition: 1 }).discount).toBe(0);
    expect(applyDiscountRules(50000, [irmao], { siblingPosition: 2 }).discount).toBe(5000);
  });
  it('não acumuláveis: fica a mais vantajosa; acumuláveis somam', () => {
    const r = applyDiscountRules(50000, [irmao, bolsa, pronto], { siblingPosition: 2, paymentDay: 5 });
    expect(r.discount).toBe(12500 + 2000);
    expect(r.final).toBe(50000 - 14500);
  });
  it('o desconto nunca excede o valor base', () => {
    const tudo = { id: 't', label: 'Total', kind: 'fixed' as const, value: 999999 };
    expect(applyDiscountRules(50000, [tudo]).final).toBe(0);
  });
  it('pronto pagamento falha depois do dia limite', () => {
    expect(applyDiscountRules(50000, [pronto], { paymentDay: 15 }).discount).toBe(0);
  });
});

describe('conciliação bancária', () => {
  const inv = [
    { id: 'f1', amount: 45000, dueDate: '2026-10-10', reference: '123 456 789' },
    { id: 'f2', amount: 45000, dueDate: '2026-10-10', reference: '987654321' },
    { id: 'f3', amount: 30000, dueDate: '2026-10-10' }
  ];
  it('casa por referência+valor como exata, ignorando espaços', () => {
    const r = reconcileBank([{ id: 'l1', date: '2026-10-05', amount: 45000, description: 'x', reference: '123456789' }], inv);
    expect(r.matches[0].invoice.id).toBe('f1');
    expect(r.matches[0].confidence).toBe('exata');
  });
  it('por valor só casa se for inequívoco; com duas candidatas fica por casar', () => {
    const amb = reconcileBank([{ id: 'l2', date: '2026-10-05', amount: 45000, description: 'x' }], inv);
    expect(amb.matches).toHaveLength(0);
    expect(amb.unmatchedLines).toHaveLength(1);
    const ok = reconcileBank([{ id: 'l3', date: '2026-10-05', amount: 30000, description: 'x' }], inv);
    expect(ok.matches[0].confidence).toBe('provavel');
  });
  it('uma fatura não casa duas vezes', () => {
    const r = reconcileBank(
      [
        { id: 'a', date: '2026-10-05', amount: 30000, description: 'x' },
        { id: 'b', date: '2026-10-06', amount: 30000, description: 'y' }
      ],
      inv
    );
    expect(r.matches).toHaveLength(1);
    expect(r.unmatchedLines).toHaveLength(1);
  });
});

describe('contas a pagar e fluxo de caixa', () => {
  it('em atraso e ordenação por prazo', () => {
    const ex = [
      { id: '1', category: 'x', amount: 1, date: '2026-09-01', dueDate: '2026-10-20' },
      { id: '2', category: 'x', amount: 1, date: '2026-09-01', dueDate: '2026-09-30' },
      { id: '3', category: 'x', amount: 1, date: '2026-09-01', dueDate: '2026-09-15', paidDate: '2026-09-14' }
    ];
    expect(accountsPayable(ex).map((e) => e.id)).toEqual(['2', '1']);
    expect(isOverdue(ex[1], '2026-10-02')).toBe(true);
    expect(isOverdue(ex[2], '2026-10-02')).toBe(false);
  });
  it('saldo acumulado mês a mês', () => {
    const f = monthlyCashFlow(
      [
        { date: '2026-09-05', amount: 100, source: 'propinas' },
        { date: '2026-09-20', amount: -40, source: 'despesa' },
        { date: '2026-10-02', amount: -80, source: 'folha_pagamento' }
      ],
      50
    );
    expect(f.map((m) => m.closingBalance)).toEqual([110, 30]);
  });
});

describe('leitura de extratos', () => {
  it('datas ISO e pt-PT', () => {
    expect(toISODate('2026-10-05')).toBe('2026-10-05');
    expect(toISODate('5/10/2026')).toBe('2026-10-05');
    expect(toISODate('05/10/2026 14:30')).toBe('2026-10-05');
    expect(toISODate('amanhã')).toBe('');
  });
  it('valores em vários formatos', () => {
    expect(parseAmount('45.000,00')).toBe(45000);
    expect(parseAmount('45 000,50')).toBe(45000.5);
    expect(parseAmount('45000.00')).toBe(45000);
    expect(parseAmount('-1.200,00')).toBe(-1200);
    expect(parseAmount('12.500')).toBe(12500);
    expect(Number.isNaN(parseAmount('abc'))).toBe(true);
  });
  it('CSV: ignora cabeçalho, regista erros por linha', () => {
    const r = parseBankCsv('Data;Descrição;Valor;Referência\n05/10/2026;Transf. João;45.000,00;123 456 789\n99/99;x;1\n06/10/2026;Sem valor;abc');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].reference).toBe('123 456 789');
    expect(r.errors).toHaveLength(2);
  });
});

describe('totais da caixa: contam todos os meios de pagamento', () => {
  const inv = (id: string, method: string, amount: number) => ({
    id, status: 'pago', paymentDate: '2026-10-03', totalAmountKz: amount, totalPaidKz: amount, method
  });
  const ledger = buildLedger(
    [inv('1', 'numerario', 10000), inv('2', 'tpa', 20000), inv('3', 'multicaixa', 5000), inv('4', 'mcx', 2500), inv('5', 'debito', 1500)],
    [{ id: 'e1', category: 'Água', amount: 4000, date: '2026-10-03', paidDate: '2026-10-03' }]
  );

  it('as entradas contabilizadas somam numerário, TPA, Multicaixa e outros', () => {
    const t = computeSessionTotals(ledger, '2026-10-03T08:00:00.000Z', 3000, new Set());
    expect(t.cashIn).toBe(10000);
    expect(t.otherIn).toBe(29000);
    expect(t.totalIn).toBe(39000);
    expect(t.cashOut).toBe(4000);
  });

  it('o saldo esperado usa todas as entradas; a gaveta só o numerário', () => {
    const t = computeSessionTotals(ledger, '2026-10-03T08:00:00.000Z', 3000, new Set());
    expect(t.expectedCash).toBe(3000 + 39000 - 4000);
    expect(t.expectedDrawerCash).toBe(3000 + 10000 - 4000);
  });

  it('agrupa por meio de pagamento', () => {
    const t = computeSessionTotals(ledger, '2026-10-03T08:00:00.000Z', 0, new Set());
    const by = Object.fromEntries(t.byMethod.map((m) => [m.method, m.total]));
    expect(by['TPA']).toBe(20000);
    expect(by['Numerário']).toBe(10000);
    expect(by['Multicaixa']).toBe(7500);
  });

  it('não repete movimentos de um fecho anterior', () => {
    const t = computeSessionTotals(ledger, '2026-10-03T08:00:00.000Z', 0, new Set(['inv:2']));
    expect(t.totalIn).toBe(19000);
  });
});


describe('folha de pagamento como saída; saldo e despesas do dashboard', () => {
  const inv = (id: string, method: string, amount: number, items?: any[]) => ({
    id, status: 'pago', paymentDate: '2026-10-03', totalAmountKz: amount, totalPaidKz: amount, method, items
  });
  const payroll = [
    { id: 'p1', status: 'pago', paymentDate: '2026-10-28', paymentMethod: 'transferencia', netSalaryKz: 50000, personName: 'Ana', personRole: 'Professora', referenceMonth: 10, referenceYear: 2026 },
    { id: 'p2', status: 'pendente', paymentMethod: 'numerario', netSalaryKz: 70000, referenceMonth: 10, referenceYear: 2026 },
    { id: 'p3', status: 'cancelado', paymentDate: '2026-10-28', netSalaryKz: 90000, referenceMonth: 10, referenceYear: 2026 },
    { id: 'p4', status: 'pago', paymentDate: '2026-11-02', paymentMethod: 'numerario', netSalaryKz: 20000, personName: 'Rui', referenceMonth: 10, referenceYear: 2026 }
  ];
  const ledger = buildLedger(
    [inv('1', 'numerario', 100000), inv('2', 'multicaixa', 60000)],
    [{ id: 'e1', category: 'Água', amount: 4000, date: '2026-10-03', paidDate: '2026-10-03' }],
    payroll
  );

  it('só recibos pagos entram, no mês do pagamento, como saída "Folha de pagamento"', () => {
    const fp = ledger.filter((e) => e.category === PAYROLL_CATEGORY);
    expect(fp.map((e) => [e.date, e.amount, e.kind])).toEqual([['2026-10-28', 50000, 'saida'], ['2026-11-02', 20000, 'saida']]);
    const flow = monthlyCashFlow(ledger.map((e) => ({ date: e.date, amount: e.kind === 'entrada' ? e.amount : -e.amount, source: 'despesa' as const })), 0);
    expect(flow.find((m) => m.month === '2026-10')!.outflow).toBe(54000);
    expect(flow.find((m) => m.month === '2026-11')!.outflow).toBe(20000);
  });

  it('salário por transferência não sai da gaveta; em numerário sim', () => {
    const t = computeSessionTotals(ledger, '2026-10-01T08:00:00.000Z', 0, new Set());
    expect(t.cashOut).toBe(74000);
    expect(t.expectedCash).toBe(160000 - 74000);
    expect(t.expectedDrawerCash).toBe(100000 - 4000 - 20000);
  });

  it('saldo por canal e total', () => {
    expect(balanceByChannel(ledger).total).toBe(160000 - 74000);
    expect(balanceByChannel(ledger, 'numerario')).toEqual({ total: 100000 - 4000 - 20000, entradas: 100000, saidas: 24000 });
    expect(balanceByChannel(ledger, 'multicaixa').total).toBe(60000);
    expect(balanceByChannel(ledger, 'banco').total).toBe(-50000);
  });

  it('despesas por categoria', () => {
    expect(expensesTotal(ledger).total).toBe(74000);
    expect(expensesTotal(ledger, PAYROLL_CATEGORY)).toEqual({ total: 70000, count: 2 });
    expect(expensesTotal(ledger, 'Água').total).toBe(4000);
  });

  it('cobrança filtrada por propinas e serviços', () => {
    const invoices = [
      { status: 'pago', totalAmountKz: 15000, items: [{ code: 'PROP-ESC', liquidTotalKz: 10000 }, { code: 'DECL', liquidTotalKz: 5000 }] },
      { status: 'pendente', totalAmountKz: 10000, items: [{ code: 'PROP-ESC', liquidTotalKz: 10000 }] }
    ];
    const cat = (c: string) => (c === 'DECL' ? 'Declarações' : undefined);
    expect(collectionSummary(invoices, 'todos', cat)).toMatchObject({ collected: 15000, invoiced: 25000, pending: 1 });
    expect(collectionSummary(invoices, 'Propinas', cat)).toMatchObject({ collected: 10000, invoiced: 20000, pending: 1 });
    expect(collectionSummary(invoices, 'Declarações', cat)).toMatchObject({ collected: 5000, invoiced: 5000, pending: 0 });
    expect(collectionSummary(invoices, 'todos', cat).kinds).toEqual(['Declarações', 'Propinas']);
  });
});


describe('filtro por período do livro', () => {
  const l = buildLedger(
    [{ id: '1', status: 'pago', paymentDate: '2026-09-10', totalAmountKz: 100, method: 'numerario' }, { id: '2', status: 'pago', paymentDate: '2026-10-05', totalAmountKz: 50, method: 'numerario' }],
    [{ id: 'e', category: 'Água', amount: 30, date: '2026-10-06', paidDate: '2026-10-06' }]
  );
  it('lista anos e meses, do mais recente', () => {
    expect(ledgerPeriodOptions(l).map((o) => o.value)).toEqual(['2026', '2026-10', '2026-09']);
    expect(ledgerPeriodOptions(l)[1].label).toBe('Outubro 2026');
  });
  it('filtra por mês e por ano', () => {
    expect(balanceByChannel(filterLedgerByPeriod(l, '2026-10')).total).toBe(20);
    expect(balanceByChannel(filterLedgerByPeriod(l, '2026-09')).total).toBe(100);
    expect(balanceByChannel(filterLedgerByPeriod(l, '2026')).total).toBe(120);
    expect(filterLedgerByPeriod(l, 'todo')).toHaveLength(3);
  });
});


describe('filtro por período da cobrança', () => {
  const invs = [
    { status: 'pago', paymentDate: '2026-10-05', dueDate: '2026-10-01' },
    { status: 'pendente', dueDate: '2026-09-30' },
    { status: 'pago', paymentDate: '10/09/2026', dueDate: '2026-09-05' }
  ];
  it('usa o pagamento (se paga) ou o vencimento', () => {
    expect(filterInvoicesByPeriod(invs, '2026-10')).toHaveLength(1);
    expect(filterInvoicesByPeriod(invs, '2026-09')).toHaveLength(2);
    expect(filterInvoicesByPeriod(invs, 'todo')).toHaveLength(3);
    expect(invoicePeriodOptions(invs).map((o) => o.value)).toEqual(['2026', '2026-10', '2026-09']);
  });
});


describe('inventário de activos no fluxo de caixa', () => {
  const inv = [{ id: 'i1', status: 'pago', paymentDate: '2026-09-10', totalAmountKz: 500000 }] as any;
  it('o valor de aquisição de cada activo sai como despesa no mês da aquisição', () => {
    const l = buildLedger(inv, [], [], [
      { id: 'a1', code: 'ATIVO-0001', name: 'Projector', acquisitionDate: '2026-09-20', acquisitionValueKz: 120000 },
      { id: 'a2', code: 'ATIVO-0002', name: 'Cadeiras', acquisitionValueKz: 30000, createdAt: '2026-10-02T09:00:00.000Z' },
      { id: 'a3', code: 'ATIVO-0003', name: 'Sem valor', acquisitionDate: '2026-09-01' },
      { id: 'a4', code: 'ATIVO-0004', name: 'Zero', acquisitionDate: '2026-09-01', acquisitionValueKz: 0 }
    ]);
    const saidas = l.filter((e) => e.kind === 'saida');
    expect(saidas.map((e) => [e.id, e.date, e.amount, e.category])).toEqual([
      ['ast:a1', '2026-09-20', 120000, ASSET_INVESTMENT_CATEGORY],
      ['ast:a2', '2026-10-02', 30000, ASSET_INVESTMENT_CATEGORY]
    ]);
    const flow = monthlyCashFlow(l.map((e) => ({ date: e.date, amount: e.kind === 'entrada' ? e.amount : -e.amount, source: 'despesa' as const })), 0);
    expect(flow.map((m) => [m.month, m.inflow, m.outflow, m.closingBalance])).toEqual([
      ['2026-09', 500000, 120000, 380000],
      ['2026-10', 0, 30000, 350000]
    ]);
  });
  it('não mexe na gaveta de numerário (não é saída em dinheiro)', () => {
    const l = buildLedger([], [], [], [{ id: 'a1', acquisitionDate: '2026-10-01', acquisitionValueKz: 80000 }]);
    expect(l[0].isCash).toBe(false);
    expect(computeSessionTotals(l, '2026-10-01T08:00:00Z', 1000, new Set()).expectedDrawerCash).toBe(1000);
  });
});
