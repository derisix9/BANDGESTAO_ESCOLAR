import { describe, expect, it } from 'vitest';
import {
  gradeEvidenceOf,
  isNoTrimestersRuleActive,
  resolveStudentStanding,
  studentExitKind
} from '../src/utils/pautaCalculations';
import { planBulkAssignments, summarizeBulkPlan } from '../src/utils/bulkAssignment';

const none = { any: false, t12: false, t3: false };

describe('situação do aluno nas pautas (Desistente / Transferido)', () => {
  it('estado da matrícula define o tipo de saída', () => {
    expect(studentExitKind({ status: 'transferred' })).toBe('transferido');
    expect(studentExitKind({ status: 'suspended' })).toBe('cancelado');
    expect(studentExitKind({ status: 'active' })).toBeNull();
  });

  it('transferido nunca é desistente, mesmo sem notas', () => {
    expect(resolveStudentStanding('transferido', none, true)).toEqual({ isDesistente: false, isTransferido: true });
  });

  it('matrícula cancelada: desistente só se não houver notas nos campos habilitados', () => {
    expect(resolveStudentStanding('cancelado', none, false).isDesistente).toBe(true);
    expect(resolveStudentStanding('cancelado', { any: true, t12: false, t3: true }, false).isDesistente).toBe(false);
  });

  it('sem notas no I e II trimestres: desistente só com a regra activa', () => {
    expect(resolveStudentStanding(null, none, false).isDesistente).toBe(false);
    expect(resolveStudentStanding(null, none, true).isDesistente).toBe(true);
    expect(resolveStudentStanding(null, { any: true, t12: true, t3: false }, true).isDesistente).toBe(false);
  });

  it('a regra dos dois trimestres vale com o III em curso ou com notas do III já lançadas', () => {
    expect(isNoTrimestersRuleActive('1', false)).toBe(false);
    expect(isNoTrimestersRuleActive('2', false)).toBe(false);
    expect(isNoTrimestersRuleActive('3', false)).toBe(true);
    expect(isNoTrimestersRuleActive('1', true)).toBe(true);
  });

  it('evidência de notas só olha para os campos habilitados', () => {
    const rec = { mac1: 12 };
    expect(gradeEvidenceOf([rec]).t12).toBe(true);
    expect(gradeEvidenceOf([rec], { MAC: false }).any).toBe(false);
    expect(gradeEvidenceOf([{ npt3: 10 }]).t3).toBe(true);
    expect(gradeEvidenceOf([{ mt1: 15, mfd: 15 }]).any).toBe(false);
  });
});

describe('atribuição em massa', () => {
  const subjects = [
    { id: 'mat', name: 'Matemática', area: 'Tronco Comum' },
    { id: 'bio', name: 'Biologia', area: 'Ciências Físicas e Biológicas' },
    { id: 'dir', name: 'Direito', area: 'Ciências Jurídicas' }
  ];
  const courses = [
    { id: 'c1', name: 'Ciências Físicas e Biológicas', status: 'ativo', grades: [] }
  ] as any;
  const base = { year: '2026', teacherId: 't1', subjects, courseNames: [] as string[], courses, existing: [] as any[], replaceExisting: false };

  it('cria uma atribuição por disciplina e classe nas classes sem curso', () => {
    const plan = planBulkAssignments({ ...base, subjects: [subjects[0]], grades: ['7.ª Classe', '8.ª Classe'] });
    expect(plan.items).toHaveLength(2);
    expect(summarizeBulkPlan(plan.items).create).toBe(2);
  });

  it('a partir da 10.ª usa os cursos e ignora disciplinas de outra área', () => {
    const plan = planBulkAssignments({ ...base, grades: ['10.ª Classe'], courseNames: ['Ciências Físicas e Biológicas'] });
    const s = summarizeBulkPlan(plan.items);
    expect(s.create).toBe(2);
    expect(s.ineligible).toBe(1);
  });

  it('classe do II ciclo sem nenhum dos cursos escolhidos é assinalada', () => {
    const plan = planBulkAssignments({ ...base, grades: ['11.ª Classe'], courseNames: [] });
    expect(plan.gradesWithoutCourse).toEqual(['11.ª Classe']);
    expect(plan.items).toHaveLength(0);
  });

  it('disciplina com outro professor fica como está, ou é substituída se pedido', () => {
    const existing = [{ id: 'a1', academicYear: '2026', grade: '7.ª Classe', subjectId: 'mat', subjectName: 'Matemática', teacherId: 't2', teacherName: 'Professor T2', createdAt: '2026-01-01' }];
    const keep = planBulkAssignments({ ...base, subjects: [subjects[0]], grades: ['7.ª Classe'], existing });
    expect(keep.items[0].action).toBe('exists');
    const swap = planBulkAssignments({ ...base, subjects: [subjects[0]], grades: ['7.ª Classe'], existing, replaceExisting: true });
    expect(swap.items[0].action).toBe('replace');
    expect(swap.items[0].existingId).toBe('a1');
  });

  it('mesmo professor já atribuído não muda nada', () => {
    const existing = [{ id: 'a1', academicYear: '2026', grade: '7.ª Classe', subjectId: 'mat', subjectName: 'Matemática', teacherId: 't1', teacherName: 'Professor T1', createdAt: '2026-01-01' }];
    const plan = planBulkAssignments({ ...base, subjects: [subjects[0]], grades: ['7.ª Classe'], existing });
    expect(plan.items[0].action).toBe('unchanged');
  });
});
