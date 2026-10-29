import { describe, expect, it } from 'vitest';
import {
  buildAllUserProjections,
  buildProjectionForAluno,
  buildProjectionForEncarregado,
  findStudentForUser
} from '../src/utils/userProjections';
import { SchoolDatabase, Student, User, Matricula, ClassRoom, TuitionInvoice, GuardianStudentLink } from '../src/types';

const INST = 'inst_bandmed';

describe('Projeções de Utilizador (Aluno & Encarregado)', () => {
  const mockStudents: Student[] = [
    {
      id: 'st-1',
      procNumber: '2026001',
      name: 'Manuel Kuanza',
      email: 'manuel@escola.ao',
      classId: 'c-10a',
      className: '10ª A',
      grade: '10ª',
      section: 'A',
      cycle: 'II Ciclo',
      birthDate: '2008-05-10',
      nif: '001234567LA01',
      citizenCard: '001234567LA01',
      address: 'Luanda',
      guardianName: 'António Kuanza',
      guardianPhone: '923000001',
      guardianEmail: 'antonio@empresa.ao',
      guardianNif: '009876543LA01',
      avatar: '',
      attendanceRate: 95,
      financialStatus: 'regular',
      status: 'ativo',
      currentAverage: 14
    } as any,
    {
      id: 'st-2',
      procNumber: '2026002',
      name: 'Maria Kuanza',
      email: 'maria@escola.ao',
      classId: 'c-8b',
      className: '8ª B',
      grade: '8ª',
      section: 'B',
      cycle: 'I Ciclo',
      birthDate: '2010-09-12',
      nif: '001234568LA02',
      citizenCard: '001234568LA02',
      address: 'Luanda',
      guardianName: 'António Kuanza',
      guardianPhone: '923000001',
      guardianEmail: 'antonio@empresa.ao',
      guardianNif: '009876543LA01',
      avatar: '',
      attendanceRate: 98,
      financialStatus: 'regular',
      status: 'ativo',
      currentAverage: 16
    } as any,
    {
      id: 'st-3',
      procNumber: '2026003',
      name: 'Sebastião Zaire',
      email: 'sebastiao@escola.ao',
      classId: 'c-10a',
      className: '10ª A',
      grade: '10ª',
      section: 'A',
      cycle: 'II Ciclo',
      birthDate: '2008-01-15',
      nif: '001234569LA03',
      citizenCard: '001234569LA03',
      address: 'Luanda',
      guardianName: 'Paula Zaire',
      guardianPhone: '923000099',
      guardianEmail: 'paula@empresa.ao',
      guardianNif: '009876599LA01',
      avatar: '',
      attendanceRate: 90,
      financialStatus: 'regular',
      status: 'ativo',
      currentAverage: 12
    } as any
  ];

  const mockMatriculas: Matricula[] = [
    {
      id: 'mat-1',
      studentId: 'st-1',
      studentName: 'Manuel Kuanza',
      academicYear: '2026/2027',
      classId: 'c-10a',
      className: '10ª A',
      grade: '10ª',
      tipo: 'renovacao',
      tipoAluno: 'interno',
      estado: 'confirmada',
      history: []
    } as any,
    {
      id: 'mat-2',
      studentId: 'st-2',
      studentName: 'Maria Kuanza',
      academicYear: '2026/2027',
      classId: 'c-8b',
      className: '8ª B',
      grade: '8ª',
      tipo: 'renovacao',
      tipoAluno: 'interno',
      estado: 'confirmada',
      history: []
    } as any,
    {
      id: 'mat-3',
      studentId: 'st-3',
      studentName: 'Sebastião Zaire',
      academicYear: '2026/2027',
      classId: 'c-10a',
      className: '10ª A',
      grade: '10ª',
      tipo: 'nova',
      tipoAluno: 'interno',
      estado: 'confirmada',
      history: []
    } as any
  ];

  const mockClasses: ClassRoom[] = [
    {
      id: 'c-10a',
      name: '10ª A',
      grade: '10ª',
      room: 'Sala 1',
      studentIds: ['st-1', 'st-3'],
      academicYear: '2026/2027',
      status: 'ativo'
    } as any,
    {
      id: 'c-8b',
      name: '8ª B',
      grade: '8ª',
      room: 'Sala 2',
      studentIds: ['st-2'],
      academicYear: '2026/2027',
      status: 'ativo'
    } as any,
    {
      id: 'c-12c',
      name: '12ª C',
      grade: '12ª',
      room: 'Sala 3',
      studentIds: [],
      academicYear: '2026/2027',
      status: 'ativo'
    } as any
  ];

  const mockInvoices: TuitionInvoice[] = [
    {
      id: 'inv-1',
      invoiceNumber: 'FT-001',
      studentId: 'st-1',
      studentName: 'Manuel Kuanza',
      amountKz: 45000,
      totalAmountKz: 45000,
      totalPaidKz: 45000,
      status: 'pago',
      issueDate: '2026-09-05',
      dueDate: '2026-09-10',
      description: 'Propina Setembro',
      period: 'Setembro',
      paymentMethod: 'TPA',
      taxRegime: 'Isento',
      items: []
    } as any,
    {
      id: 'inv-2',
      invoiceNumber: 'FT-002',
      studentId: 'st-2',
      studentName: 'Maria Kuanza',
      amountKz: 35000,
      totalAmountKz: 35000,
      totalPaidKz: 0,
      status: 'pendente',
      issueDate: '2026-09-05',
      dueDate: '2026-09-10',
      description: 'Propina Setembro',
      period: 'Setembro',
      paymentMethod: 'TPA',
      taxRegime: 'Isento',
      items: []
    } as any,
    {
      id: 'inv-3',
      invoiceNumber: 'FT-003',
      studentId: 'st-3',
      studentName: 'Sebastião Zaire',
      amountKz: 45000,
      totalAmountKz: 45000,
      totalPaidKz: 45000,
      status: 'pago',
      issueDate: '2026-09-05',
      dueDate: '2026-09-10',
      description: 'Propina Setembro',
      period: 'Setembro',
      paymentMethod: 'TPA',
      taxRegime: 'Isento',
      items: []
    } as any
  ];

  const mockLinks: GuardianStudentLink[] = [
    {
      id: 'link-1',
      studentId: 'st-1',
      studentName: 'Manuel Kuanza',
      studentProcNumber: '2026001',
      guardianUserId: 'u-encarregado-antonio',
      guardianName: 'António Kuanza',
      guardianEmail: 'antonio@empresa.ao',
      relation: 'pai',
      status: 'ativo',
      financialResponsible: true,
      origin: 'manual',
      linkedAt: '2026-01-01',
      linkedBy: 'admin'
    },
    {
      id: 'link-2',
      studentId: 'st-2',
      studentName: 'Maria Kuanza',
      studentProcNumber: '2026002',
      guardianUserId: 'u-encarregado-antonio',
      guardianName: 'António Kuanza',
      guardianEmail: 'antonio@empresa.ao',
      relation: 'pai',
      status: 'ativo',
      financialResponsible: true,
      origin: 'manual',
      linkedAt: '2026-01-01',
      linkedBy: 'admin'
    }
  ];

  const mockDb: SchoolDatabase = {
    users: [
      { id: 'u-aluno-manuel', name: 'Manuel Kuanza', roleTitle: 'Aluno', email: 'manuel@escola.ao', processNumber: '2026001', role: 'aluno', avatar: '' },
      { id: 'u-encarregado-antonio', name: 'António Kuanza', roleTitle: 'Encarregado', email: 'antonio@empresa.ao', phone: '923000001', role: 'encarregado', avatar: '' }
    ],
    currentUser: { id: 'u-admin', name: 'Administrador', roleTitle: 'Administrador', email: 'admin@escola.ao', role: 'admin', avatar: '' },
    students: mockStudents,
    matriculas: mockMatriculas,
    classes: mockClasses,
    invoices: mockInvoices,
    guardianLinks: mockLinks,
    teachers: [],
    subjects: [],
    attendance: {} as any,
    pauta: {} as any,
    notices: [],
    books: [],
    loans: [],
    timetable: [],
    settings: { currentAcademicYear: '2026/2027' } as any
  };

  it('findStudentForUser encontra aluno por número de processo, email ou nome', () => {
    const u1: User = { id: 'u1', name: 'Outro', roleTitle: 'Aluno', email: '', processNumber: '2026001', role: 'aluno', avatar: '' };
    expect(findStudentForUser(u1, mockStudents)?.id).toBe('st-1');

    const u2: User = { id: 'u2', name: 'Maria Kuanza', roleTitle: 'Aluno', email: '', role: 'aluno', avatar: '' };
    expect(findStudentForUser(u2, mockStudents)?.id).toBe('st-2');

    const u3: User = { id: 'u3', name: 'Outro', roleTitle: 'Aluno', email: 'sebastiao@escola.ao', role: 'aluno', avatar: '' };
    expect(findStudentForUser(u3, mockStudents)?.id).toBe('st-3');
  });

  it('buildProjectionForAluno isola apenas o aluno, as suas matrículas, turma e faturas', () => {
    const userAluno = mockDb.users[0];
    const proj = buildProjectionForAluno(userAluno, mockDb);

    expect(proj.userId).toBe('u-aluno-manuel');
    expect(proj.role).toBe('aluno');

    // Apenas Manuel Kuanza
    expect(proj.students.length).toBe(1);
    expect(proj.students[0].id).toBe('st-1');

    // Apenas matrícula de Manuel
    expect(proj.matriculas.length).toBe(1);
    expect(proj.matriculas[0].studentId).toBe('st-1');

    // Apenas turma de Manuel (10ª A)
    expect(proj.classes.length).toBe(1);
    expect(proj.classes[0].id).toBe('c-10a');

    // Apenas faturas de Manuel
    expect(proj.invoices.length).toBe(1);
    expect(proj.invoices[0].id).toBe('inv-1');
    expect(proj.invoices.some((i) => i.studentId === 'st-3')).toBe(false);
  });

  it('buildProjectionForEncarregado isola apenas os educandos vinculados e as suas faturas', () => {
    const userEncarregado = mockDb.users[1];
    const proj = buildProjectionForEncarregado(userEncarregado, mockDb);

    expect(proj.userId).toBe('u-encarregado-antonio');
    expect(proj.role).toBe('encarregado');

    // Dois filhos: Manuel (st-1) e Maria (st-2), NUNCA Sebastião (st-3)
    const studentIds = proj.students.map((s) => s.id).sort();
    expect(studentIds).toEqual(['st-1', 'st-2']);

    // Faturas apenas dos dois filhos (inv-1 e inv-2)
    const invoiceIds = proj.invoices.map((i) => i.id).sort();
    expect(invoiceIds).toEqual(['inv-1', 'inv-2']);
    expect(proj.invoices.some((i) => i.studentId === 'st-3')).toBe(false);

    // Turmas dos filhos (10ª A e 8ª B)
    const classIds = proj.classes.map((c) => c.id).sort();
    expect(classIds).toEqual(['c-10a', 'c-8b']);
  });

  it('buildAllUserProjections gera projeção para todos os alunos e encarregados da base', () => {
    const all = buildAllUserProjections(mockDb);
    expect(Object.keys(all)).toContain('u-aluno-manuel');
    expect(Object.keys(all)).toContain('u-encarregado-antonio');
    expect(all['u-aluno-manuel'].students.length).toBe(1);
    expect(all['u-encarregado-antonio'].students.length).toBe(2);
  });

});
