import { describe, expect, it } from 'vitest';
import { attachmentKind, findSummariesForLesson, formatSummaryForAttendance, mondayOf, nextLessonNumber, planTransition, validateLessonPlan, validateMaterial, validatePlanAttachment, validateSummary, type LessonPlan, type LessonSummaryEntry } from '../src/utils/teacherWork';

const plan: LessonPlan = {
  id: 'p', academicYear: '2026/2027', teacherId: 't', teacherName: 'Prof', classId: 'c', className: '7.ª A', subjectName: 'Mat', trimester: '1',
  weekStart: '2026-10-05', topic: 'Frações', objectives: 'x', activities: 'y', status: 'rascunho', createdAt: '', updatedAt: ''
};

describe('semana', () => {
  it('devolve a segunda-feira', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05'); // quarta
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // domingo
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
  });
});

describe('fluxo do plano', () => {
  const prof = { name: 'Prof', isManager: false };
  const dir = { name: 'Dir', isManager: true };
  it('professor submete; só a direção aprova/devolve', () => {
    const sub = planTransition(plan, 'submeter', prof);
    expect(sub.ok && sub.plan.status).toBe('submetido');
    if (!sub.ok) return;
    expect(planTransition(sub.plan, 'aprovar', prof).ok).toBe(false);
    const ap = planTransition(sub.plan, 'aprovar', dir);
    expect(ap.ok && ap.plan.status).toBe('aprovado');
  });
  it('devolver exige nota e permite nova submissão', () => {
    const sub = planTransition(plan, 'submeter', prof);
    if (!sub.ok) throw new Error('x');
    expect(planTransition(sub.plan, 'devolver', dir, ' ').ok).toBe(false);
    const dev = planTransition(sub.plan, 'devolver', dir, 'Falta avaliação');
    if (!dev.ok) throw new Error('x');
    expect(dev.plan.reviewerNote).toBe('Falta avaliação');
    expect(planTransition(dev.plan, 'submeter', prof).ok).toBe(true);
  });
  it('não se submete duas vezes nem se aprova rascunho', () => {
    const sub = planTransition(plan, 'submeter', prof);
    if (!sub.ok) throw new Error('x');
    expect(planTransition(sub.plan, 'submeter', prof).ok).toBe(false);
    expect(planTransition(plan, 'aprovar', dir).ok).toBe(false);
  });
});

describe('validações', () => {
  it('plano, sumário e material', () => {
    expect(validateLessonPlan(plan)).toEqual([]);
    expect(validateLessonPlan({ ...plan, topic: '', objectives: '' }).length).toBe(2);
    expect(validateSummary({ classId: 'c', subjectName: 'M', date: '2026-10-05', topic: 't', summary: 'Resumo longo o bastante' })).toEqual([]);
    expect(validateSummary({ classId: 'c', subjectName: 'M', date: '5/10', topic: 't', summary: 'curto' }).length).toBe(2);
    expect(validateMaterial({ classId: 'c', subjectName: 'M', title: 'Ficha', link: 'https://x.pt/a.pdf' })).toEqual([]);
    expect(validateMaterial({ classId: 'c', subjectName: 'M', title: 'Ficha', link: 'javascript:1' })).toHaveLength(1);
  });
  it('numera as aulas por turma, disciplina e ano', () => {
    const e = (n: number, cls = 'c', sub = 'M') => ({ id: String(n), academicYear: 'y', teacherId: '', teacherName: '', classId: cls, className: '', subjectName: sub, date: '', lessonNumber: n, topic: '', summary: '', createdAt: '' });
    expect(nextLessonNumber([], 'c', 'M', 'y')).toBe(1);
    expect(nextLessonNumber([e(1), e(2), e(7, 'outra')], 'c', 'M', 'y')).toBe(3);
  });
});

describe('plano de aulas em ficheiro', () => {
  const base = { classId: 'c', subjectName: 'Mat', weekStart: '2026-10-05', topic: 'Frações', objectives: '', activities: '' };
  const att = { name: 'plano.docx', mimeType: 'application/octet-stream', size: 1000, dataUrl: 'data:application/octet-stream;base64,AAAA' };

  it('com ficheiro, objetivos e atividades deixam de ser obrigatórios', () => {
    expect(validateLessonPlan(base).length).toBe(2);
    expect(validateLessonPlan({ ...base, attachment: att })).toEqual([]);
  });
  it('aceita só PDF, Word e Excel até 2 MB', () => {
    for (const n of ['a.pdf', 'a.DOC', 'a.docx', 'a.xls', 'a.xlsx']) expect(validatePlanAttachment({ name: n, size: 10 })).toBeNull();
    expect(validatePlanAttachment({ name: 'a.exe', size: 10 })).toMatch(/PDF, Word/);
    expect(validatePlanAttachment({ name: 'a.pdf', size: 3 * 1024 * 1024 })).toMatch(/limite/);
    expect(validatePlanAttachment({ name: 'a.pdf', size: 0 })).toMatch(/vazio/);
    expect(validateLessonPlan({ ...base, attachment: { ...att, name: 'a.zip' } }).join(' ')).toMatch(/PDF, Word/);
  });
  it('identifica o tipo do documento', () => {
    expect(attachmentKind('x.pdf')).toBe('PDF');
    expect(attachmentKind('x.docx')).toBe('Word');
    expect(attachmentKind('x.xlsx')).toBe('Excel');
  });
});

describe('sumário diário → assiduidade', () => {
  const mk = (n: number, extra: Partial<LessonSummaryEntry> = {}): LessonSummaryEntry => ({
    id: `s${n}`, academicYear: '2026/2027', teacherId: 't', teacherName: 'Prof', classId: 'c1', className: '7.ª A', subjectName: 'Matemática',
    date: '2026-10-05', lessonNumber: n, topic: `Tema ${n}`, summary: `Resumo da aula ${n}`, createdAt: '', ...extra
  });
  it('encontra os sumários da turma + disciplina + dia (ignora acentos e maiúsculas)', () => {
    const list = [mk(2), mk(1), mk(3, { date: '2026-10-06' }), mk(4, { classId: 'c2' }), mk(5, { subjectName: 'História' })];
    expect(findSummariesForLesson(list, 'c1', 'matematica', '2026-10-05').map((e) => e.lessonNumber)).toEqual([1, 2]);
    expect(findSummariesForLesson(undefined, 'c1', 'Matemática', '2026-10-05')).toEqual([]);
  });
  it('formata o texto legal com n.º da aula, tema, sumário e TPC', () => {
    const t = formatSummaryForAttendance([mk(7, { homework: 'Exercícios 1 a 5' })]);
    expect(t).toBe('Aula n.º 7 • Tema 7\nResumo da aula 7\nTPC: Exercícios 1 a 5');
    expect(formatSummaryForAttendance([])).toBe('');
  });
});
