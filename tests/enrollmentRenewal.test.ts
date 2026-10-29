import { describe, expect, it } from 'vitest';
import { gradeNumber, planAnnualRenewal, previousAcademicYear, type RenewalInput } from '../src/utils/enrollmentRenewal';

const PREV = '2025/2026', TARGET = '2026/2027';

const cls = (id: string, grade: number, section: string, year: string, extra: any = {}) =>
  ({ id, name: `${grade}.ª Classe ${section}`, grade: `${grade}.ª Classe`, section, cycle: '', shift: 'Manhã', room: 'S', studentCount: 0, maxCapacity: 40, academicYear: year, ...extra });
const stu = (id: string, extra: any = {}) => ({ id, name: `Aluno ${id}`, status: 'active', ...extra });
const mat = (studentId: string, c: any, year: string, extra: any = {}) =>
  ({ id: `m-${studentId}-${year}`, numeroMatricula: `MAT-${year}-${studentId}`, academicYear: year, studentId, studentName: `Aluno ${studentId}`, classId: c.id, className: c.name, grade: c.grade, shift: c.shift, estado: 'matriculado', createdAt: `${year}-01-01`, ...extra });
const council = (classId: string, entries: Array<[string, 'aprovado' | 'reprovado' | 'condicional']>, status: 'homologado' | 'rascunho' = 'homologado') =>
  ({ id: `cc-${classId}`, academicYear: PREV, classId, className: classId, grade: '', date: '2026-07-01', status, createdBy: 'x', createdAt: '', entries: entries.map(([studentId, decision]) => ({ studentId, studentName: studentId, negatives: [], proposed: decision, decision, reasons: [] })) });

function base(over: Partial<RenewalInput> & Record<string, any> = {}): RenewalInput {
  const p7 = cls('p7', 7, 'A', PREV);
  const students = [stu('s1'), stu('s2'), stu('s3')];
  return {
    targetYear: TARGET,
    students: students as any,
    classes: [p7, cls('t7A', 7, 'A', TARGET), cls('t8A', 8, 'A', TARGET)] as any,
    matriculas: students.map((s) => mat(s.id, p7, PREV)) as any,
    classCouncils: [council('p7', [['s1', 'aprovado'], ['s2', 'reprovado'], ['s3', 'condicional']])] as any,
    recoveryRecords: [],
    invoices: [],
    hasTuition: () => true,
    todayISO: '2027-01-10',
    ...over
  } as RenewalInput;
}
const row = (plan: ReturnType<typeof planAnnualRenewal>, id: string) => plan.rows.find((r) => r.studentId === id)!;

describe('renovação anual: auxiliares', () => {
  it('ano anterior e número da classe', () => {
    expect(previousAcademicYear('2026/2027')).toBe('2025/2026');
    expect(previousAcademicYear('2026-2027')).toBe('2025/2026');
    expect(previousAcademicYear('abc')).toBe('');
    expect(gradeNumber('7.ª Classe')).toBe(7);
    expect(gradeNumber('Iniciação')).toBeNull();
  });
});

describe('renovação anual: decisão pelo conselho', () => {
  it('aprovado promove, reprovado repete', () => {
    const plan = planAnnualRenewal(base());
    expect(row(plan, 's1')).toMatchObject({ action: 'promover', targetClassName: '8.ª Classe A', status: 'pronto' });
    expect(row(plan, 's2')).toMatchObject({ action: 'repetir', targetClassName: '7.ª Classe A', status: 'pronto' });
  });
  it('condicional: sem registo de recuperação e pendente bloqueiam; aprovado promove; reprovado repete', () => {
    const rec = (outcome: string) => [{ id: 'r', academicYear: PREV, studentId: 's3', outcome }] as any;
    const r0 = row(planAnnualRenewal(base()), 's3');
    expect(r0.status).toBe('bloqueado'); expect(r0.blockers[0].code).toBe('recuperacao-pendente'); expect(r0.canDecideManually).toBe(true);
    expect(row(planAnnualRenewal(base({ recoveryRecords: rec('pendente') })), 's3').status).toBe('bloqueado');
    expect(row(planAnnualRenewal(base({ recoveryRecords: rec('aprovado') })), 's3')).toMatchObject({ action: 'promover', status: 'aviso' });
    expect(row(planAnnualRenewal(base({ recoveryRecords: rec('reprovado') })), 's3')).toMatchObject({ action: 'repetir', status: 'aviso' });
  });
  it('sem conselho, conselho em rascunho e aluno fora do conselho bloqueiam', () => {
    const none = planAnnualRenewal(base({ classCouncils: [] }));
    expect(row(none, 's1').blockers[0].code).toBe('sem-conselho');
    expect(none.pendingCouncils).toEqual([{ classId: 'p7', className: '7.ª Classe A', students: 3 }]);
    const draft = planAnnualRenewal(base({ classCouncils: [council('p7', [['s1', 'aprovado']], 'rascunho')] as any }));
    expect(row(draft, 's1').blockers[0].code).toBe('conselho-nao-homologado');
    const missing = planAnnualRenewal(base({ classCouncils: [council('p7', [['s1', 'aprovado']])] as any }));
    expect(row(missing, 's2').blockers[0].code).toBe('sem-entrada-conselho');
  });
  it('decisão manual desbloqueia, mas fica marcada e com aviso', () => {
    const plan = planAnnualRenewal(base({ classCouncils: [], manualDecisions: { s1: 'promover', s2: 'repetir' } }));
    expect(row(plan, 's1')).toMatchObject({ basis: 'manual', manual: true, action: 'promover', status: 'aviso', targetClassName: '8.ª Classe A' });
    expect(row(plan, 's2')).toMatchObject({ action: 'repetir', targetClassName: '7.ª Classe A' });
    expect(row(plan, 's3').status).toBe('bloqueado');
  });
  it('conselho de outro ano não conta', () => {
    const old = { ...council('p7', [['s1', 'aprovado']]), academicYear: '2024/2025' };
    expect(row(planAnnualRenewal(base({ classCouncils: [old] as any })), 's1').blockers[0].code).toBe('sem-conselho');
  });
});

describe('renovação anual: classe final e exclusões', () => {
  it('aprovado na 13.ª conclui o ciclo e não entra nas contagens de matrícula', () => {
    const p13 = cls('p13', 13, 'A', PREV);
    const plan = planAnnualRenewal(base({
      students: [stu('f1')] as any, matriculas: [mat('f1', p13, PREV)] as any, classes: [p13] as any,
      classCouncils: [council('p13', [['f1', 'aprovado']])] as any
    }));
    expect(row(plan, 'f1').action).toBe('concluir');
    expect(plan.counts).toMatchObject({ concluem: 1, pronto: 0, bloqueado: 0 });
  });
  it('reprovado na 13.ª repete a 13.ª', () => {
    const p13 = cls('p13', 13, 'A', PREV);
    const plan = planAnnualRenewal(base({
      students: [stu('f1')] as any, matriculas: [mat('f1', p13, PREV)] as any, classes: [p13, cls('t13', 13, 'A', TARGET)] as any,
      classCouncils: [council('p13', [['f1', 'reprovado']])] as any
    }));
    expect(row(plan, 'f1')).toMatchObject({ action: 'repetir', targetClassName: '13.ª Classe A' });
  });
  it('transferidos e suspensos ficam fora; matrículas canceladas não contam como anteriores', () => {
    const plan = planAnnualRenewal(base({ students: [stu('s1', { status: 'transferred' }), stu('s2', { status: 'suspended' }), stu('s3')] as any }));
    expect(plan.rows.map((r) => r.studentId)).toEqual(['s3']);
    const p7 = cls('p7', 7, 'A', PREV);
    const cancelled = planAnnualRenewal(base({ matriculas: [mat('s1', p7, PREV, { estado: 'cancelada' })] as any }));
    expect(cancelled.rows).toHaveLength(0);
  });
  it('quem já está matriculado no ano de destino aparece como feito', () => {
    const p7 = cls('p7', 7, 'A', PREV), t8 = cls('t8A', 8, 'A', TARGET);
    const plan = planAnnualRenewal(base({ matriculas: [mat('s1', p7, PREV), mat('s1', t8, TARGET)] as any }));
    expect(row(plan, 's1')).toMatchObject({ status: 'feito', targetClassName: t8.name });
    expect(plan.counts.feito).toBe(1);
  });
});

describe('renovação anual: turma de destino e lotação', () => {
  it('prefere a mesma secção e turno', () => {
    const p7B = cls('p7B', 7, 'B', PREV, { shift: 'Tarde' });
    const plan = planAnnualRenewal(base({
      students: [stu('s1')] as any, matriculas: [mat('s1', p7B, PREV)] as any,
      classes: [p7B, cls('t8A', 8, 'A', TARGET), cls('t8B', 8, 'B', TARGET, { shift: 'Tarde' })] as any,
      classCouncils: [council('p7B', [['s1', 'aprovado']])] as any
    }));
    expect(row(plan, 's1').targetClassId).toBe('t8B');
    expect(row(plan, 's1').classOptions.map((o) => o.id)).toEqual(['t8B', 't8A']);
  });
  it('respeita o curso (área) da turma anterior', () => {
    const p = cls('p10', 10, 'A', PREV, { area: 'Informática' });
    const plan = planAnnualRenewal(base({
      students: [stu('s1')] as any, matriculas: [mat('s1', p, PREV)] as any,
      classes: [p, cls('t11-enf', 11, 'A', TARGET, { area: 'Enfermagem' }), cls('t11-inf', 11, 'B', TARGET, { area: 'Informática' })] as any,
      classCouncils: [council('p10', [['s1', 'aprovado']])] as any
    }));
    expect(row(plan, 's1').targetClassId).toBe('t11-inf');
  });
  it('enche uma turma e passa à seguinte; quando todas estão cheias bloqueia sem inventar', () => {
    const students = ['a', 'b', 'c'].map((i) => stu(i));
    const p7 = cls('p7', 7, 'A', PREV);
    const mk = (caps: number[]) => planAnnualRenewal(base({
      students: students as any, matriculas: students.map((s) => mat(s.id, p7, PREV)) as any,
      classes: [p7, ...caps.map((c, i) => cls(`t8${i}`, 8, String.fromCharCode(65 + i), TARGET, { maxCapacity: c }))] as any,
      classCouncils: [council('p7', [['a', 'aprovado'], ['b', 'aprovado'], ['c', 'aprovado']])] as any
    }));
    const two = mk([2, 5]);
    expect(two.rows.map((r) => r.targetClassId)).toEqual(['t80', 't80', 't81']);
    const full = mk([1, 1]);
    expect(full.rows.map((r) => r.status)).toEqual(['pronto', 'pronto', 'bloqueado']);
    expect(full.rows[2].blockers[0].code).toBe('turma-cheia');
  });
  it('conta as matrículas já gravadas no destino', () => {
    const p7 = cls('p7', 7, 'A', PREV), t8 = cls('t8A', 8, 'A', TARGET, { maxCapacity: 1 });
    const plan = planAnnualRenewal(base({
      students: [stu('s1'), stu('x')] as any, matriculas: [mat('s1', p7, PREV), mat('x', t8, TARGET)] as any, classes: [p7, t8] as any,
      classCouncils: [council('p7', [['s1', 'aprovado']])] as any
    }));
    expect(row(plan, 's1').blockers[0].code).toBe('turma-cheia');
  });
  it('sem turma no ano de destino, sem tabela financeira e turma escolhida inválida bloqueiam', () => {
    expect(row(planAnnualRenewal(base({ classes: [cls('p7', 7, 'A', PREV)] as any })), 's1').blockers[0].code).toBe('sem-turma');
    expect(row(planAnnualRenewal(base({ hasTuition: (g) => g !== '8.ª Classe' })), 's1').blockers[0].code).toBe('sem-tabela-financeira');
    expect(row(planAnnualRenewal(base({ classOverrides: { s1: 'p7' } })), 's1').blockers[0].code).toBe('sem-turma');
  });
  it('a secretaria pode trocar a turma de destino', () => {
    const input = base({ classes: [cls('p7', 7, 'A', PREV), cls('t8A', 8, 'A', TARGET), cls('t8B', 8, 'B', TARGET)] as any, classOverrides: { s1: 't8B' } });
    expect(row(planAnnualRenewal(input), 's1').targetClassId).toBe('t8B');
  });
  it('classe sem número bloqueia', () => {
    const p = cls('pi', 0, 'A', PREV, { grade: 'Iniciação', name: 'Iniciação A' });
    const plan = planAnnualRenewal(base({ students: [stu('s1')] as any, matriculas: [mat('s1', p, PREV)] as any, classes: [p] as any, classCouncils: [council('pi', [['s1', 'aprovado']])] as any }));
    expect(row(plan, 's1').blockers[0].code).toBe('classe-sem-numero');
  });
});

describe('renovação anual: dívidas', () => {
  const inv = [{ studentId: 's1', status: 'pendente', dueDate: '2026-10-10', totalAmountKz: 20000 }, { studentId: 's1', status: 'paga', dueDate: '2026-09-10', totalAmountKz: 20000 }] as any;
  it('por defeito avisa; com política "bloquear" bloqueia', () => {
    const warn = row(planAnnualRenewal(base({ invoices: inv })), 's1');
    expect(warn.status).toBe('aviso'); expect(warn.debtKz).toBe(20000);
    const blocked = row(planAnnualRenewal(base({ invoices: inv, debtPolicy: 'bloquear' })), 's1');
    expect(blocked.status).toBe('bloqueado'); expect(blocked.blockers[0].code).toBe('divida');
  });
  it('quem fica bloqueado por dívida devolve a vaga ao seguinte', () => {
    const p7 = cls('p7', 7, 'A', PREV);
    const plan = planAnnualRenewal(base({
      students: [stu('s1'), stu('s2')] as any, matriculas: [mat('s1', p7, PREV), mat('s2', p7, PREV)] as any,
      classes: [p7, cls('t8A', 8, 'A', TARGET, { maxCapacity: 1 })] as any,
      classCouncils: [council('p7', [['s1', 'aprovado'], ['s2', 'aprovado']])] as any, invoices: inv, debtPolicy: 'bloquear'
    }));
    expect(row(plan, 's1').status).toBe('bloqueado');
    expect(row(plan, 's2').status).toBe('pronto');
  });
});

describe('renovação anual: execução por fatias', () => {
  it('onlyStudentIds limita o plano e dá o mesmo destino que o plano completo', () => {
    const full = planAnnualRenewal(base());
    const part = planAnnualRenewal(base({ onlyStudentIds: ['s2'] }));
    expect(part.rows).toHaveLength(1);
    expect(part.rows[0].targetClassId).toBe(row(full, 's2').targetClassId);
  });
});
