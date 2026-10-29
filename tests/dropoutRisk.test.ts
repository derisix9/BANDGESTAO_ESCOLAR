import { describe, it, expect } from 'vitest';
import {
  computeDropoutRisk, latestFollowUps, summarizeRisk, resolveDropoutThresholds, validateDropoutThresholds,
  dropoutAlertLabel, DEFAULT_DROPOUT_THRESHOLDS
} from '../src/utils/dropoutRisk';

const student = (id: string, over: any = {}) => ({ id, name: 'Aluno ' + id, classId: 'c1', className: '7A', status: 'active', currentAverage: 14, unexcusedAbsences: 0, guardianName: 'G', guardianPhone: '9', ...over });
const sheets = (id: string, present: number, absent: number) => [{
  students: [...Array(present).fill('P'), ...Array(absent).fill('FI')].map((status) => ({ studentId: id, status }))
}].flatMap((x) => x.students.map((st: any) => ({ students: [st] })));
const run = (o: any) => computeDropoutRisk({ students: [], attendanceSheets: [], invoices: [], followUps: [], today: '2026-10-26', ...o });
const lateInv = (n: number, id = '1') => Array.from({ length: n }, () => ({ studentId: id, status: 'atraso' }));

describe('risco de evasão por aluno', () => {
  it('aluno sem sinais fica com risco baixo', () => {
    expect(run({ students: [student('1')] })[0].level).toBe('baixo');
  });
  it('média baixa + 3 propinas em atraso = alto, com motivos', () => {
    const r = run({ students: [student('1', { currentAverage: 5 })], invoices: lateInv(3) })[0];
    expect(r.level).toBe('alto');
    expect(r.reasons.length).toBe(2);
  });
  it('presença baixa conta só com um mínimo de registos', () => {
    expect(run({ students: [student('1')], attendanceSheets: sheets('1', 1, 1) })[0].attendanceRate).toBeNull();
    expect(run({ students: [student('1')], attendanceSheets: sheets('1', 2, 2) })[0].attendanceRate).toBe(50);
  });
  it('alerta quando há risco e nenhum acompanhamento', () => {
    const r = run({ students: [student('1', { currentAverage: 5 })], invoices: lateInv(3) })[0];
    expect(r.alert).toBe('sem_acompanhamento');
  });
  it('alerta de ação em atraso e de caso parado', () => {
    const base = { students: [student('1', { currentAverage: 5 })], invoices: lateInv(3) };
    const f = (over: any) => [{ id: 'a', studentId: '1', date: '2026-10-20', caseStatus: 'em_acompanhamento', createdAt: '2026-10-20', ...over }];
    expect(run({ ...base, followUps: f({ nextActionDate: '2026-10-25' }) })[0].alert).toBe('acao_atrasada');
    expect(run({ ...base, followUps: f({ date: '2026-08-01' }) })[0].alert).toBe('acompanhamento_parado');
    expect(run({ ...base, followUps: f({ nextActionDate: '2026-11-05' }) })[0].alert).toBeNull();
  });
  it('caso recuperado deixa de gerar alerta e de contar', () => {
    const list = run({ students: [student('1', { currentAverage: 5 })], invoices: lateInv(3), followUps: [{ id: 'a', studentId: '1', date: '2026-10-20', caseStatus: 'recuperado', createdAt: 'x' }] });
    expect(list[0].alert).toBeNull();
    expect(summarizeRisk(list).alto).toBe(0);
    expect(summarizeRisk(list).recuperados).toBe(1);
  });
  it('ignora alunos transferidos', () => {
    expect(run({ students: [student('1', { status: 'transferred' })] })).toHaveLength(0);
  });
  it('o acompanhamento mais recente manda', () => {
    const mk = (id: string, date: string, caseStatus: string) => ({ id, studentId: '1', date, caseStatus, createdAt: date } as any);
    expect(latestFollowUps([mk('a', '2026-10-01', 'em_acompanhamento'), mk('b', '2026-10-10', 'recuperado')]).get('1')!.caseStatus).toBe('recuperado');
  });

  describe('limites configuráveis', () => {
    it('sem limites gravados valem os padrões', () => {
      expect(resolveDropoutThresholds(undefined)).toEqual(DEFAULT_DROPOUT_THRESHOLDS);
      expect(resolveDropoutThresholds({})).toEqual(DEFAULT_DROPOUT_THRESHOLDS);
    });
    it('limites parciais juntam-se aos padrões', () => {
      const t = resolveDropoutThresholds({ averageHigh: 9, averageMid: 11 });
      expect(t.averageHigh).toBe(9);
      expect(t.attendanceHigh).toBe(70);
    });
    it('limites inválidos voltam aos padrões em vez de rebentar', () => {
      expect(resolveDropoutThresholds({ attendanceHigh: 95 })).toEqual(DEFAULT_DROPOUT_THRESHOLDS);
      expect(validateDropoutThresholds({ ...DEFAULT_DROPOUT_THRESHOLDS, scoreMedium: 7 }).length).toBeGreaterThan(0);
      expect(validateDropoutThresholds({ ...DEFAULT_DROPOUT_THRESHOLDS, staleDays: 0 }).length).toBeGreaterThan(0);
      expect(validateDropoutThresholds({ ...DEFAULT_DROPOUT_THRESHOLDS, averageHigh: NaN }).length).toBeGreaterThan(0);
      expect(validateDropoutThresholds(DEFAULT_DROPOUT_THRESHOLDS)).toEqual([]);
    });
    it('média 9 é «negativa» (2 pts) com os padrões, mas «muito baixa» (3 pts) se o limite subir', () => {
      const s = [student('1', { currentAverage: 9 })];
      const d = run({ students: s, invoices: lateInv(3) })[0];
      const custom = run({ students: s, invoices: lateInv(3), thresholds: { averageHigh: 10, averageMid: 12 } })[0];
      expect(d.score).toBe(5);
      expect(custom.score).toBe(6);
      expect(custom.level).toBe('alto');
      expect(d.level).toBe('medio');
    });
    it('os dias de «caso parado» seguem o limite da escola', () => {
      const base = { students: [student('1', { currentAverage: 5 })], invoices: lateInv(3) };
      const f = [{ id: 'a', studentId: '1', date: '2026-10-10', caseStatus: 'em_acompanhamento', createdAt: 'x' }];
      expect(run({ ...base, followUps: f })[0].alert).toBeNull();
      expect(run({ ...base, followUps: f, thresholds: { staleDays: 7 } })[0].alert).toBe('acompanhamento_parado');
      expect(dropoutAlertLabel('acompanhamento_parado', 7)).toContain('7 dias');
      expect(dropoutAlertLabel('sem_acompanhamento', 7)).toBe('Sem acompanhamento');
    });
  });
});
