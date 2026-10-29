import { describe, it, expect } from 'vitest';
import { trialBalanceSpec, postingsSpec, balanceSheetSpec } from '../src/utils/accountingExport';
import { computeTrialBalance, computeBalanceSheet, postingsFromLedger } from '../src/utils/accounting';

const e = (over: any) => ({ id: 'x', date: '2026-10-01', kind: 'entrada', category: 'Propinas e serviços', description: 'Propina', isCash: true, channel: 'numerario', amount: 1000, ...over });
const ctx = { schoolName: 'Escola', periodLabel: 'Ano 2026', basis: 'caixa' as const, depreciation: false, issuedOn: '26 de outubro de 2026' };
const postings = postingsFromLedger([e({}), e({ id: '2', kind: 'saida', category: 'Água', amount: 300 })] as any);

describe('exportação da contabilidade', () => {
  it('balancete: uma linha por conta, total e colunas alinhadas', () => {
    const tb = computeTrialBalance(postings);
    const s = trialBalanceSpec(tb, ctx);
    expect(s.rows).toHaveLength(tb.rows.length);
    expect(s.rows.every((r) => r.length === s.columns.length)).toBe(true);
    expect(s.total!.length).toBe(s.columns.length);
    expect(s.total![2]).toBe(tb.totalDebit);
    expect(s.fileName).toBe('balancete-verificacao-ano-2026.xlsx');
    expect(s.meta.find((m) => m.label === 'Base:')!.value).toBe('Regime de caixa');
  });
  it('lançamentos: uma linha por conta do lançamento, com a descrição só na primeira', () => {
    const s = postingsSpec(postings, ctx);
    expect(s.rows).toHaveLength(4);
    expect(s.rows.every((r) => r.length === s.columns.length)).toBe(true);
    expect(s.rows[1][1]).toBe('');
    expect(s.total![4]).toBe(s.total![5]);
  });
  it('balanço: totais batem e as linhas têm o nº de colunas certo', () => {
    const bs = computeBalanceSheet(postings, '2026-12-31');
    const s = balanceSheetSpec(bs, { ...ctx, basis: 'acrescimo', depreciation: true });
    expect(s.rows.every((r) => r.length === s.columns.length)).toBe(true);
    expect(s.rows.find((r) => r[1] === 'TOTAL DO ACTIVO')![2]).toBe(bs.totalActivo);
    expect(s.meta[1].value).toBe('Regime de acréscimo + amortizações');
    expect(s.meta[0].value).toBe('31/12/2026');
  });
});
