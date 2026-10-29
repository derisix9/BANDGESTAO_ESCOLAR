import { describe, expect, it } from 'vitest';
import type { AttendanceSheet, ClassRoom, Student, Subject } from '../src/types';
import type { StudentMiniPautaItem } from '../src/types/pauta';
import { DEFAULT_GRADE_RULES, normalizeGradeRules } from '../src/utils/pautaCalculations';
import { absenceReason, absenceVerdict, computeAbsenceStats } from '../src/utils/councilAbsences';
import { buildCouncilEntry, buildCouncilStudentSummary, type CouncilContext } from '../src/utils/councilGrades';

const sheet = (i: number, status: string, classId = 'c1', year = '2026/2027', studentId = 's1'): AttendanceSheet =>
  ({ id: `a${i}`, classId, academicYear: year, students: [{ studentId, status }] } as unknown as AttendanceSheet);
const sheets = (fi: number, total: number, fj = 0): AttendanceSheet[] =>
  Array.from({ length: total }, (_, i) => sheet(i, i < fi ? 'FI' : i < fi + fj ? 'FJ' : 'P'));

const subj = (id: string, name: string): Subject => ({ id, name, code: id, weeklyHours: 3 } as Subject);
const cls = (): ClassRoom => ({ id: 'c1', name: '7.ª Classe A', grade: '7.ª Classe', section: 'A', cycle: '', shift: 'Manhã', room: '', studentCount: 1, maxCapacity: 30, headTeacherId: '', headTeacherName: '' } as ClassRoom);
const student = (extra: Partial<Student> = {}): Student => ({ id: 's1', name: 'Aluno Teste', classId: 'c1', status: 'active', ...extra } as Student);
const flat = (v: number) => ({ mac1: v, npp1: v, npt1: v, mac2: v, npp2: v, npt2: v, mac3: v, npp3: v, npt3: v });
const row = (patch: Partial<StudentMiniPautaItem>) =>
  ({ id: 's1-mat', studentId: 's1', num: 1, name: 'Aluno Teste', gender: 'M', birthYear: '-', age: '-', isDebtor: false, isDesistente: false, mt1: '', mt2: '', mt3: '', mfd: '', pg: '', ca: '', obs: '', ...patch } as StudentMiniPautaItem);
const store = { mat: [row(flat(14))] } as any;
const ctx = (att: AttendanceSheet[], rules = DEFAULT_GRADE_RULES): CouncilContext => ({
  cls: cls(), subjects: [subj('mat', 'Matemática')], rules, attendanceSheets: att, academicYear: '2026/2027'
});

describe('faltas: estatística e veredicto', () => {
  it('conta só a turma e o ano certos, FI e FJ em separado', () => {
    const all = [...sheets(5, 40, 3), sheet(99, 'FI', 'outra'), sheet(98, 'FI', 'c1', '2025/2026'), sheet(97, 'FI', 'c1', '2026/2027', 'outro')];
    expect(computeAbsenceStats('s1', 'c1', all, '2026/2027')).toEqual({ recordedLessons: 40, unexcused: 5, excused: 3, unexcusedPercent: 12.5 });
  });
  it('só reprova acima do limite e com aulas suficientes', () => {
    const v = (fi: number, total: number) => absenceVerdict(computeAbsenceStats('s1', 'c1', sheets(fi, total)), 25);
    expect(v(11, 40)).toBe('exceeded');     // 27.5%
    expect(v(10, 40)).toBe('warning');      // 25% = no limite, não acima
    expect(v(8, 40)).toBe('warning');       // 20% = 80% do limite
    expect(v(4, 40)).toBe('ok');
    expect(v(5, 10)).toBe('insufficient');  // poucas aulas: não reprova
  });
  it('frase de motivo só quando há algo a dizer', () => {
    expect(absenceReason(computeAbsenceStats('s1', 'c1', sheets(0, 40)))).toBeNull();
    expect(absenceReason(computeAbsenceStats('s1', 'c1', sheets(12, 40)))).toContain('reprovação por faltas');
  });
});

describe('faltas: proposta do conselho', () => {
  it('aluno positivo mas com faltas acima do limite é proposto reprovado', () => {
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctx(sheets(12, 40)), miniStore: store });
    expect(r.situation).toBe('APROVADO');
    expect(r.absenceVerdict).toBe('exceeded');
    expect(r.proposed).toBe('reprovado');
    expect(r.reasons.join(' ')).toContain('reprovação por faltas');
  });
  it('perto do limite só avisa; a proposta mantém-se', () => {
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctx(sheets(9, 40)), miniStore: store });
    expect(r.absenceVerdict).toBe('warning');
    expect(r.proposed).toBe('aprovado');
  });
  it('sem cadernetas suficientes não reprova', () => {
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctx(sheets(8, 10)), miniStore: store });
    expect(r.proposed).toBe('aprovado');
  });
  it('o limite é configurável por escola', () => {
    const rules = normalizeGradeRules({ maxAbsencePercent: 40 });
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctx(sheets(12, 40), rules), miniStore: store });
    expect(r.proposed).toBe('aprovado');
    expect(normalizeGradeRules({}).maxAbsencePercent).toBe(25);
    expect(normalizeGradeRules({ maxAbsencePercent: 0 }).maxAbsencePercent).toBe(25);
  });
  it('decisão manual do conselho continua a prevalecer sobre a proposta por faltas', () => {
    const c = ctx(sheets(12, 40));
    const first = buildCouncilEntry(student(), buildCouncilStudentSummary({ student: student(), ctx: c, miniStore: store }));
    const manual = { ...first, decision: 'aprovado' as const, justification: 'Doença comprovada' };
    const again = buildCouncilEntry(student(), buildCouncilStudentSummary({ student: student(), ctx: c, miniStore: store }), manual);
    expect(again.proposed).toBe('reprovado');
    expect(again.decision).toBe('aprovado');
    expect(again.justification).toBe('Doença comprovada');
  });
});
