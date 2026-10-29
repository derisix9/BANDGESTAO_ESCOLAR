import { describe, expect, it } from 'vitest';
import { LISTAGENS, visibleListagens, totalsRow, filterRows, fmtCell, lab } from '../src/utils/listagemCatalog';

const empty: any = { users: [], students: [], classes: [], subjects: [], invoices: [], notices: [], books: [], loans: [], timetable: [], settings: {}, attendance: {} };
const db: any = {
  ...empty,
  students: [
    { id: 's1', name: 'Tiago', classId: 'c1', currentAverage: 14, attendanceRate: 90 },
    { id: 's2', name: 'Ana', classId: 'c1', currentAverage: 8, attendanceRate: 80 },
  ],
  classes: [{ id: 'c1', name: '10A', grade: '10' }],
  invoices: [
    { id: 'i1', totalAmountKz: 1000, totalPaidKz: 1000, dueDate: '2026-10-05', paymentDate: '2026-10-03', status: 'pago' },
    { id: 'i2', totalAmountKz: 500, dueDate: '2026-10-05', status: 'pendente' },
  ],
  loans: [{ id: 'l1', fineAmount: 200 }, { id: 'l2', fineAmount: 0 }],
};
const def = (id: string) => LISTAGENS.find((l) => l.id === id)!;

describe('catálogo de listagens', () => {
  it('ids únicos e nenhuma listagem rebenta com dados vazios', () => {
    const ids = LISTAGENS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LISTAGENS) expect(l.rows(empty)).toEqual([]);
  });
  it('todas as células são texto ou número', () => {
    for (const l of LISTAGENS) for (const r of l.rows(db)) for (const c of l.cols) {
      const v = c.get(r, db);
      expect(v === undefined || v === null || typeof v === 'string' || typeof v === 'number').toBe(true);
    }
  });
  it('evolução financeira agrega faturado, cobrado e dívida por mês', () => {
    expect(def('evolucao_financeira').rows(db)).toEqual([{ mes: '2026-10', faturado: 1500, cobrado: 1000, divida: 500, faturas: 2 }]);
  });
  it('evolução académica por turma', () => {
    const r = def('evolucao_academica').rows(db)[0];
    expect([r.alunos, r.positivos, r.negativos, r.media]).toEqual([2, 1, 1, 11]);
  });
  it('multas só inclui empréstimos com multa', () => {
    expect(def('multas').rows(db)).toHaveLength(1);
  });
  it('acesso: secção E regra financeira', () => {
    expect(visibleListagens(() => false)).toHaveLength(0);
    const ids = visibleListagens(() => true, () => false).map((l) => l.id);
    for (const id of ['pagamentos', 'fluxo_caixa', 'despesas', 'bolsas_regras', 'evolucao_financeira']) expect(ids).not.toContain(id);
    expect(ids).toContain('alunos');
    expect(visibleListagens(() => true, (r) => r === 'propinas.reports').map((l) => l.id)).toContain('pagamentos');
  });
  it('linha de total soma só colunas numéricas', () => {
    const l = def('pagamentos');
    const t = totalsRow(l.cols, l.rows(db).map((r) => l.cols.map((c) => c.get(r, db))));
    expect(t).toContain(1500);
    expect(totalsRow(def('fornecedores').cols, [])).toBeNull();
  });
  it('formatação e pesquisa', () => {
    expect(lab('licenca_maternidade')).toBe('Licença maternidade');
    expect(lab(null)).toBe('—');
    expect(fmtCell(1500, { kz: true })).toMatch(/Kz$/);
    expect(filterRows([['Ana'], ['Rui']], 'rui')).toEqual([1]);
  });
  it('contabilidade e evasão escolar têm listagem e os dados aparecem', () => {
    const d: any = {
      ...db,
      expenses: [{ id: 'e1', category: 'Água', amount: 300, date: '2026-10-01', paidDate: '2026-10-02' }],
      dropoutFollowUps: [{ id: 'f1', studentId: 's2', studentName: 'Ana', date: '2026-10-10', kind: 'contacto_telefonico', note: 'x', caseStatus: 'em_acompanhamento', createdBy: 'u', createdAt: 'x' }],
    };
    expect(def('contab_balancete').rows(d).length).toBeGreaterThan(0);
    expect(def('contab_lancamentos').rows(d).length).toBeGreaterThan(0);
    expect(def('evasao_acompanhamentos').rows(d)).toHaveLength(1);
    expect(def('evasao_risco').rows(d).length).toBeGreaterThan(0);
    expect(visibleListagens((sec) => sec === 'evasao_escolar').map((l) => l.id)).toContain('evasao_risco');
  });
});
