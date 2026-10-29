import { beforeEach, describe, expect, it } from 'vitest';
import { dbService } from '../src/services/db';

const D: any = dbService;

function seed() {
  const db = D.db;
  db.settings = { ...(db.settings || {}), currentAcademicYear: '2026/2027', tuitionRows: [{ grade: '7.ª Classe', matriculaKz: 10000, monthlyTuitionKz: 20000 }, { grade: '8.ª Classe', matriculaKz: 12000, monthlyTuitionKz: 22000 }] };
  db.classes = [
    { id: 'c1', name: '7.ª Classe A', grade: '7.ª Classe', section: 'A', cycle: '', shift: 'Manhã', room: 'S1', studentCount: 0, maxCapacity: 40, academicYear: '2026/2027' },
    { id: 'c2', name: '8.ª Classe A', grade: '8.ª Classe', section: 'A', cycle: '', shift: 'Manhã', room: 'S2', studentCount: 0, maxCapacity: 40, academicYear: '2026/2027' },
    { id: 'c3', name: '9.ª Classe A', grade: '9.ª Classe', section: 'A', cycle: '', shift: 'Manhã', room: 'S3', studentCount: 0, maxCapacity: 40, academicYear: '2026/2027' }
  ];
  db.students = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id, name: `Aluno ${i + 1}`, procNumber: `P${i}`, status: 'active', birthDate: '2012-01-01', gender: 'M', guardianName: 'Enc', guardianPhone: '9', financialStatus: 'regular' }));
  db.matriculas = [];
  db.invoices = [];
}

describe('matrícula em lote por turma', () => {
  beforeEach(() => seed());

  it('matricula todos numa só turma e gera faturas com ids únicos', () => {
    const r = D.enrollStudentsInClass(['s1', 's2', 's3'], { classId: 'c1', academicYear: '2026/2027' });
    expect(r.enrolled.length).toBe(3);
    expect(r.failed).toEqual([]);
    expect(D.db.matriculas.every((m: any) => m.classId === 'c1')).toBe(true);
    const ids = D.db.matriculas.map((m: any) => m.id);
    expect(new Set(ids).size).toBe(3);
    const inv = D.db.invoices.map((i: any) => i.id);
    expect(new Set(inv).size).toBe(inv.length);                      // nenhuma fatura repetida
    expect(D.db.students.find((s: any) => s.id === 's1').classId).toBe('c1');
  });

  it('ignora quem já tem matrícula NESSE ano lectivo e matricula os restantes', () => {
    D.enrollStudentsInClass(['s2'], { classId: 'c2', academicYear: '2026/2027' });
    const plan = D.planBulkEnrollment(['s1', 's2', 's3'], '2026/2027');
    expect(plan.eligible.map((s: any) => s.id)).toEqual(['s1', 's3']);
    expect(plan.skipped.map((s: any) => s.studentId)).toEqual(['s2']);
    expect(plan.skipped[0].reason).toBe('ja-matriculado');
    const r = D.enrollStudentsInClass(['s1', 's2', 's3'], { classId: 'c1', academicYear: '2026/2027' });
    expect(r.enrolled.length).toBe(2);
    expect(r.skipped.length).toBe(1);
    expect(D.db.matriculas.filter((m: any) => m.studentId === 's2').length).toBe(1);   // não duplicou
  });

  it('matrícula de OUTRO ano lectivo não conta; cancelada/transferida também não', () => {
    D.db.matriculas = [
      { id: 'm0', studentId: 's1', academicYear: '2025/2026', estado: 'matriculado', numeroMatricula: 'MAT-2025-2026-0001', grade: '6.ª Classe' },
      { id: 'm1', studentId: 's2', academicYear: '2026/2027', estado: 'cancelada', numeroMatricula: 'MAT-2026-2027-0002', grade: '7.ª Classe' }
    ];
    const plan = D.planBulkEnrollment(['s1', 's2'], '2026/2027');
    expect(plan.eligible.length).toBe(2);
    const r = D.enrollStudentsInClass(['s1'], { classId: 'c1', academicYear: '2026/2027' });
    expect(D.db.matriculas.find((m: any) => m.id === r.enrolled[0].id).tipo).toBe('renovacao');   // já estudou cá
  });

  it('sem Tabela Financeira para a classe não grava nada', () => {
    expect(() => D.enrollStudentsInClass(['s1'], { classId: 'c3', academicYear: '2026/2027' })).toThrow();
    expect(D.db.matriculas.length).toBe(0);
  });

  it('ids repetidos na seleção contam uma só vez', () => {
    const r = D.enrollStudentsInClass(['s1', 's1', 's1'], { classId: 'c1', academicYear: '2026/2027' });
    expect(r.enrolled.length).toBe(1);
  });
});
