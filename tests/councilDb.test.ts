import { beforeEach, describe, expect, it } from 'vitest';
import { dbService } from '../src/services/db';
import { buildPautaGeralRows, normalizeGradeRules } from '../src/utils/pautaCalculations';

const D: any = dbService;

function seed(grade = '7.ª Classe') {
  const db = D.db;
  db.settings = { ...(db.settings || {}), currentAcademicYear: '2026/2027', gradeRules: undefined };
  db.currentUser = { ...(db.currentUser || {}), name: 'Dir. Teste' };
  db.classes = [{ id: 'c1', name: `${grade} A`, grade, section: 'A', cycle: '', shift: 'Manhã', room: '', studentCount: 2, maxCapacity: 30, headTeacherId: '', headTeacherName: '' }];
  db.subjects = [
    { id: 'mat', name: 'Matemática', code: 'MAT', weeklyHours: 4 },
    { id: 'lp', name: 'Língua Portuguesa', code: 'LP', weeklyHours: 4 }
  ];
  db.students = [
    { id: 's1', name: 'Aluno Um', classId: 'c1', status: 'active', birthDate: '2012-01-01', gender: 'M', financialStatus: 'regular', isTuitionPaidCurrentMonth: true },
    { id: 's2', name: 'Aluno Dois', classId: 'c1', status: 'active', birthDate: '2012-01-01', gender: 'F', financialStatus: 'regular', isTuitionPaidCurrentMonth: true }
  ];
  db.miniPautasStore = {};
  db.classCouncils = [];
  db.attendanceSheets = [];
  db.lessonSummaries = [];
}

const allMarks = (v: number) => ({ mac1: v, npp1: v, npt1: v, mac2: v, npp2: v, npt2: v, mac3: v, npp3: v, npt3: v });

describe('conselho de turma: atribuição de notas', () => {
  beforeEach(() => seed());

  it('grava na Mini-Pauta e nas notas do aluno, e a Pauta Final segue', () => {
    const r = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: allMarks(15), lp: allMarks(6) }, reason: 'Revisão de provas' });
    expect(r.success).toBe(true);
    expect(r.changes!.length).toBe(18);
    expect(r.changes![0]).toMatchObject({ studentId: 's1', by: 'Dir. Teste', reason: 'Revisão de provas' });

    // Mini-Pauta guardada com a linha do aluno recalculada (MT/MFD).
    const mat = D.db.miniPautasStore.c1.mat.find((x: any) => x.studentId === 's1');
    expect([mat.mt1, mat.mfd]).toEqual([15, 15]);
    // O outro aluno continua na Mini-Pauta, sem notas.
    expect(D.db.miniPautasStore.c1.mat.find((x: any) => x.studentId === 's2').mfd).toBe('');
    // Notas "vivas" só do aluno alterado (o outro não é tocado).
    expect(D.db.students[0].trimesterGrades.map((g: any) => g.subjectId).sort()).toEqual(['lp', 'mat']);
    expect(D.db.students[1].trimesterGrades).toBeUndefined();

    // Pauta Final, lida como a PautasView a lê (a partir da Mini-Pauta guardada).
    const cache = { mat: Object.fromEntries(D.db.miniPautasStore.c1.mat.map((x: any) => [x.studentId, x])), lp: Object.fromEntries(D.db.miniPautasStore.c1.lp.map((x: any) => [x.studentId, x])) };
    const rows = buildPautaGeralRows(D.db.students, D.db.subjects, D.db.students, cache as any, '7.ª Classe', normalizeGradeRules(undefined));
    // A Pauta está em ordem alfabética: procura-se a linha pelo aluno, não pela posição.
    const r1 = rows.find((x) => x.studentId === 's1')!;
    expect(r1.subjectGrades.mat.mfd).toBe(15);
    expect(r1.subjectGrades.lp.mfd).toBe(6);
    expect(r1.mf).toBe(11); // (15+6)/2 = 10.5 → 11
    expect(r1.situation).toBe('APROVADO');

    // A Pauta Final abre sem cache de sessão: lê as notas do aluno (trimesterGrades) e tem de dar o mesmo.
    const fresh = buildPautaGeralRows(D.db.students, D.db.subjects, D.db.students, undefined, '7.ª Classe', normalizeGradeRules(undefined));
    const f1 = fresh.find((x) => x.studentId === 's1')!;
    const f2 = fresh.find((x) => x.studentId === 's2')!;
    expect(f1.subjectGrades.mat).toMatchObject({ mt1: 15, mt2: 15, mt3: 15, mfd: 15 });
    expect(f1.subjectGrades.lp.mfd).toBe(6);
    expect(f1.mf).toBe(11);
    expect(f2.mf).toBe(''); // o outro aluno não foi tocado
  });

  it('o conselho regista as alterações e acumula-as', () => {
    const a = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: 9 } } });
    dbService.saveClassCouncil({ classId: 'c1', date: '2026-12-10', entries: [], gradeChanges: a.changes });
    const b = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: 13 } } });
    expect(b.changes).toHaveLength(1);
    expect(b.changes![0]).toMatchObject({ field: 'mac1', from: 9, to: 13, label: 'MAC I trim.' });
    const saved = dbService.saveClassCouncil({ classId: 'c1', date: '2026-12-10', entries: [], gradeChanges: b.changes });
    expect(saved.council!.gradeChanges!.map((c) => c.to)).toEqual([9, 13]);
  });

  it('sem alterações não grava nem regista nada', () => {
    dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: 9 } } });
    const again = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: 9 } } });
    expect(again).toEqual({ success: true, changes: [] });
  });

  it('conselho homologado, desistente e notas inválidas são recusados', () => {
    D.db.students[1].status = 'suspended';
    expect(dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's2', rows: { mat: allMarks(10) } }).success).toBe(false);
    expect(dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: Number.NaN as any } } }).success).toBe(false);
    expect(dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { inexistente: { mac1: 10 } } }).success).toBe(false);
    D.db.classCouncils = [{ id: 'k', academicYear: '2026/2027', classId: 'c1', className: 'x', grade: '7.ª Classe', date: '', entries: [], status: 'homologado', createdBy: '', createdAt: '' }];
    const r = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: allMarks(10) } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/homologado/);
  });

  it('notas acima do máximo são limitadas a 20', () => {
    dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { mac1: 99 } } });
    expect(D.db.miniPautasStore.c1.mat.find((x: any) => x.studentId === 's1').mac1).toBe(20);
  });

  it('classe de exame: o NER e o exame entram no cálculo (MF) e na situação', () => {
    seed('9.ª Classe');
    D.db.subjects[0].keySubsystems = ['secundario_1'];
    const r = dbService.applyCouncilStudentGrades({ classId: 'c1', studentId: 's1', rows: { mat: { ...allMarks(12), nee: 14, neo: 14 }, lp: { ...allMarks(8), nee: 8, neo: 8 } } });
    expect(r.success).toBe(true);
    const mat = D.db.miniPautasStore.c1.mat.find((x: any) => x.studentId === 's1');
    expect(mat.mf).toBe(13); // 12×0,6 + 14×0,4 = 12.8 → 13
  });
});

describe('homologação do conselho', () => {
  beforeEach(() => seed());
  const entry = (extra: any = {}) => ({ studentId: 's1', studentName: 'Aluno Um', negatives: [], proposed: 'aprovado', decision: 'aprovado', reasons: [], ...extra });

  it('exige justificação quando faltam notas', () => {
    const c = dbService.saveClassCouncil({ classId: 'c1', date: '2026-12-10', entries: [entry({ incomplete: true })] as any });
    const r = dbService.homologateClassCouncil(c.council!.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Faltam notas/);
    const c2 = dbService.saveClassCouncil({ classId: 'c1', date: '2026-12-10', entries: [entry({ incomplete: true, justification: 'Aluno doente' })] as any });
    expect(dbService.homologateClassCouncil(c2.council!.id).success).toBe(true);
  });

  it('não abre recuperação para negativas já recuperadas em recurso', () => {
    const c = dbService.saveClassCouncil({
      classId: 'c1', date: '2026-12-10',
      entries: [entry({ proposed: 'condicional', decision: 'condicional', negatives: [
        { subjectId: 'mat', subjectName: 'Matemática', grade: 8, recovered: true },
        { subjectId: 'lp', subjectName: 'Língua Portuguesa', grade: 9 }
      ] })] as any
    });
    expect(dbService.homologateClassCouncil(c.council!.id).success).toBe(true);
    expect(D.db.recoveryRecords.map((r: any) => r.subjectId)).toEqual(['lp']);
  });
});

describe('sumário diário → caderneta de assiduidade', () => {
  beforeEach(() => seed());
  it('atualiza o sumário da caderneta existente da mesma turma, disciplina e dia', () => {
    const today = new Date().toISOString().slice(0, 10);
    D.db.attendanceSheets = [
      { id: 'a1', date: today, classId: 'c1', subjectId: 'mat', subjectName: 'Matemática', lessonSummary: '' },
      { id: 'a2', date: today, classId: 'c1', subjectId: 'lp', subjectName: 'Língua Portuguesa', lessonSummary: '' }
    ];
    const r = dbService.saveLessonSummary({ classId: 'c1', subjectName: 'Matemática', date: today, topic: 'Frações', summary: 'Resolução de exercícios sobre frações.' });
    if (!r.success) throw new Error(r.error);
    expect(D.db.attendanceSheets[0].lessonSummary).toBe('Aula n.º 1 • Frações\nResolução de exercícios sobre frações.');
    expect(D.db.attendanceSheets[1].lessonSummary).toBe('');
  });
});
