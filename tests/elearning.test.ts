import { describe, expect, it } from 'vitest';
import { assignmentProgress, gradeSubmission, isSafeHttpUrl, submissionState, submitWork, validateAssignment, type Assignment } from '../src/utils/elearning';

const A: Assignment = {
  id: 'a1', academicYear: '2026/2027', classId: 'c1', className: '7.ª A', subjectName: 'Matemática', teacherName: 'Prof',
  title: 'TPC 1', instructions: '', dueAt: '2026-10-10T18:00', maxGrade: 20, allowLate: false, status: 'publicado', createdAt: '', createdBy: ''
};
const before = Date.parse('2026-10-10T10:00');
const after = Date.parse('2026-10-11T10:00');

describe('ligações', () => {
  it('só aceita http/https', () => {
    expect(isSafeHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<b>')).toBe(false);
    expect(isSafeHttpUrl('não é url')).toBe(false);
  });
});

describe('validação', () => {
  it('aponta o que falta', () => {
    expect(validateAssignment({ ...A, title: '', classId: '', maxGrade: 0, dueAt: 'x' }).length).toBe(4);
    expect(validateAssignment(A)).toEqual([]);
    expect(validateAssignment({ ...A, externalLink: 'ftp://x' })).toHaveLength(1);
  });
});

describe('entrega', () => {
  const input = { studentId: 's1', studentName: 'Ana', text: 'resposta' };
  it('entrega a tempo', () => {
    const r = submitWork(A, undefined, input, before, 'e1');
    expect(r.ok && r.submission.late).toBe(false);
  });
  it('recusa atrasado se não permitido; aceita e marca se permitido', () => {
    expect(submitWork(A, undefined, input, after, 'e1').ok).toBe(false);
    const r = submitWork({ ...A, allowLate: true }, undefined, input, after, 'e1');
    expect(r.ok && r.submission.late).toBe(true);
  });
  it('recusa vazio, link inseguro, trabalho fechado e já corrigido', () => {
    expect(submitWork(A, undefined, { studentId: 's1', studentName: 'Ana' }, before, 'e').ok).toBe(false);
    expect(submitWork(A, undefined, { ...input, link: 'javascript:x' }, before, 'e').ok).toBe(false);
    expect(submitWork({ ...A, status: 'fechado' }, undefined, input, before, 'e').ok).toBe(false);
    const graded = { id: 'e1', assignmentId: 'a1', studentId: 's1', studentName: 'Ana', submittedAt: '', late: false, grade: 15 };
    expect(submitWork(A, graded, input, before, 'e').ok).toBe(false);
  });
  it('reentrega mantém o mesmo id', () => {
    const first = submitWork(A, undefined, input, before, 'e1');
    if (!first.ok) throw new Error('x');
    const again = submitWork(A, first.submission, { ...input, text: 'nova' }, before, 'e2');
    expect(again.ok && again.submission.id).toBe('e1');
  });
});

describe('correção e estados', () => {
  const sub = { id: 'e1', assignmentId: 'a1', studentId: 's1', studentName: 'Ana', submittedAt: '', late: false };
  it('nota dentro do intervalo', () => {
    expect(gradeSubmission(A, sub, 21, '', 'P', before).ok).toBe(false);
    expect(gradeSubmission(A, sub, -1, '', 'P', before).ok).toBe(false);
    const ok = gradeSubmission(A, sub, 16, 'bom', 'P', before);
    expect(ok.ok && ok.submission.grade).toBe(16);
  });
  it('estado do aluno', () => {
    expect(submissionState(A, undefined, before)).toBe('por_entregar');
    expect(submissionState(A, undefined, after)).toBe('em_falta');
    expect(submissionState(A, sub, after)).toBe('entregue');
    expect(submissionState(A, { ...sub, late: true }, after)).toBe('entregue_atrasado');
    expect(submissionState(A, { ...sub, grade: 10 }, after)).toBe('corrigido');
  });
  it('progresso da turma', () => {
    const subs = [{ ...sub, grade: 10 }, { ...sub, id: 'e2', studentId: 's2', late: true, grade: 14 }];
    const p = assignmentProgress(A, ['s1', 's2', 's3'], subs, after);
    expect(p).toEqual({ total: 3, delivered: 2, late: 1, graded: 2, missing: 1, average: 12 });
  });
});
