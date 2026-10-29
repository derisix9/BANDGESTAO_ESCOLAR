import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dbService } from '../src/services/db';
import {
  initialInvoiceStatus,
  isInvoiceInMora,
  resolveFinancialSituation
} from '../src/utils/financialSituation';

const D: any = dbService;

function seed() {
  const db = D.db;
  db.settings = {
    ...(db.settings || {}),
    currentAcademicYear: '2026/2027',
    academicPeriodStartIso: '2026-09-01',
    financialRules: { paymentDueDay: 10 }
  };
  db.currentUser = { ...(db.currentUser || {}), name: 'Secretaria' };
  db.classes = [{ id: 'c1', name: 'Turma A', grade: '8.ª Classe', section: 'A', cycle: '', shift: 'Tarde', room: '9', studentCount: 0, maxCapacity: 40, headTeacherId: '', headTeacherName: '' }];
  db.students = [{ id: 's1', name: 'Aluno Um', procNumber: '1', avatar: '', classId: '', status: 'active', financialStatus: 'regular', isTuitionPaidCurrentMonth: true, guardianName: 'Enc', guardianPhone: '9', guardianNif: '' }];
  db.matriculas = [];
  db.invoices = [];
  db.cashSessions = [];
}

const enroll = (extra: any = {}) =>
  dbService.confirmMatricula({
    academicYear: '2026/2027', studentId: 's1', grade: '8.ª Classe', classId: 'c1', className: 'Turma A', shift: 'Tarde',
    dataMatricula: '2026-09-01', tipo: 'nova', estado: 'matriculado', tipoAluno: 'interno',
    valorMatriculaKz: 5000, valorPropinaKz: 2500, diaVencimento: 10, formaPagamento: 'numerario', numeroParcelas: 4,
    estadoFinanceiro: 'regular', ...extra
  } as any);

describe('situação financeira da matrícula', () => {
  beforeEach(() => {
    seed();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00'));
  });

  it('regular: matrícula + parcelas ficam PAGAS e a caixa abre automaticamente', () => {
    const m = enroll({ situacaoFinanceira: 'regular' });
    const invs = D.db.invoices;
    expect(invs.length).toBe(5); // matrícula + 4 parcelas
    expect(invs.every((i: any) => i.status === 'pago')).toBe(true);
    expect(D.db.cashSessions.filter((c: any) => c.status === 'aberto').length).toBe(1);
    expect(m.situacaoFinanceira).toBe('regular');
    expect(D.db.students[0].financialStatus).toBe('regular');
  });

  it('regular com caixa já aberta não abre outra', () => {
    D.db.cashSessions = [{ id: 'x', status: 'aberto', openedAt: new Date().toISOString(), openedBy: 'a', openingFloat: 0 }];
    enroll({ situacaoFinanceira: 'regular' });
    expect(D.db.cashSessions.length).toBe(1);
  });

  it('pendente: tudo pendente, sem abrir caixa, e sem mora automática nos meses já vencidos', () => {
    enroll({ situacaoFinanceira: 'pendente' });
    expect(D.db.invoices.every((i: any) => i.status === 'pendente')).toBe(true);
    expect(D.db.cashSessions.length).toBe(0);
    const sit = resolveFinancialSituation(D.db.matriculas[0], D.db.invoices);
    expect(sit).toBe('pendente');
  });

  it('em mora: só os meses já vencidos ficam em atraso; os restantes pendentes', () => {
    enroll({ situacaoFinanceira: 'mora', numeroParcelas: 10 });
    const prop = D.db.invoices.filter((i: any) => /^Propina/.test(i.description));
    const byMonth = Object.fromEntries(prop.map((i: any) => [i.period, i.status]));
    expect(byMonth['Setembro 2026']).toBe('atraso');
    expect(byMonth['Outubro 2026']).toBe('atraso'); // vencia a 10/10
    expect(byMonth['Novembro 2026']).toBe('pendente');
    expect(byMonth['Junho 2027']).toBe('pendente');
    expect(D.db.students[0].financialStatus).toBe('debito');
    expect(resolveFinancialSituation(D.db.matriculas[0], D.db.invoices)).toBe('mora');
  });

  it('bolseiro/isento: sem propinas; só a taxa de matrícula (outros serviços) fica pendente', () => {
    const m = enroll({ tipoAluno: 'bolseiro', situacaoFinanceira: 'pendente' });
    expect(m.situacaoFinanceira).toBe('isento');
    expect(D.db.invoices.length).toBe(1);
    expect(D.db.invoices[0].description).toMatch(/Taxa de Matrícula/);
    expect(D.db.students[0].financialStatus).toBe('isento');
    expect(resolveFinancialSituation(m, D.db.invoices)).toBe('isento');
  });

  it('isento com serviço em mora passa a "mora"', () => {
    const m = enroll({ situacaoFinanceira: 'isento' });
    const svc = [{ studentId: 's1', status: 'atraso', dueDate: '2026-10-01' }];
    expect(resolveFinancialSituation(m, svc as any)).toBe('mora');
  });

  it('muda com os pagamentos: mora → paga tudo → regular', () => {
    const m = enroll({ situacaoFinanceira: 'mora', numeroParcelas: 3 });
    expect(resolveFinancialSituation(m, D.db.invoices)).toBe('mora');
    D.db.invoices.forEach((i: any) => (i.status = 'pago'));
    expect(resolveFinancialSituation(m, D.db.invoices)).toBe('regular');
  });

  it('pendente já vencida DEPOIS da matrícula passa a mora', () => {
    enroll({ situacaoFinanceira: 'pendente', numeroParcelas: 6 });
    vi.setSystemTime(new Date('2027-01-20T10:00:00')); // Novembro e Dezembro vencem depois da matrícula
    const nov = D.db.invoices.find((i: any) => i.period === 'Novembro 2026');
    expect(isInvoiceInMora(nov, '2027-01-20')).toBe(true);
    const set = D.db.invoices.find((i: any) => i.period === 'Setembro 2026');
    expect(isInvoiceInMora(set, '2027-01-20')).toBe(false); // vencida já à data da matrícula
  });

  it('initialInvoiceStatus', () => {
    expect(initialInvoiceStatus('regular', '2026-01-01', '2026-10-25')).toBe('pago');
    expect(initialInvoiceStatus('pendente', '2026-01-01', '2026-10-25')).toBe('pendente');
    expect(initialInvoiceStatus('mora', '2026-01-01', '2026-10-25')).toBe('atraso');
    expect(initialInvoiceStatus('mora', '2026-12-01', '2026-10-25')).toBe('pendente');
    expect(initialInvoiceStatus('isento', '2026-01-01', '2026-10-25')).toBe('pendente');
  });
});
