import { describe, expect, it } from 'vitest';
import type { ClassRoom, Student, Subject } from '../src/types';
import type { StudentMiniPautaItem } from '../src/types/pauta';
import { DEFAULT_GRADE_RULES, normalizeGradeRules } from '../src/utils/pautaCalculations';
import {
  buildCouncilEntry,
  buildCouncilStudentSummary,
  diffGradeRows,
  fieldMax,
  recalcCouncilRow,
  sanitizeGradeInput,
  type CouncilContext
} from '../src/utils/councilGrades';

const subj = (id: string, name: string, extra: Partial<Subject> = {}): Subject => ({ id, name, code: id, weeklyHours: 3, ...extra } as Subject);
const cls = (grade: string, extra: Partial<ClassRoom> = {}): ClassRoom => ({ id: 'c1', name: `${grade} A`, grade, section: 'A', cycle: '', shift: 'Manhã', room: '', studentCount: 1, maxCapacity: 30, headTeacherId: '', headTeacherName: '', ...extra } as ClassRoom);
const student = (extra: Partial<Student> = {}): Student => ({ id: 's1', name: 'Aluno Teste', classId: 'c1', status: 'active', ...extra } as Student);

/** Linha de mini-pauta com o mesmo valor em todas as avaliações dos 3 trimestres. */
const flat = (v: number | ''): Partial<StudentMiniPautaItem> => ({
  mac1: v, npp1: v, npt1: v, mac2: v, npp2: v, npt2: v, mac3: v, npp3: v, npt3: v
});
const row = (id: string, patch: Partial<StudentMiniPautaItem>): StudentMiniPautaItem =>
  ({ id: `s1-${id}`, studentId: 's1', num: 1, name: 'Aluno Teste', gender: 'M', birthYear: '-', age: '-', isDebtor: false, isDesistente: false, mt1: '', mt2: '', mt3: '', mfd: '', pg: '', ca: '', obs: '', ...patch } as StudentMiniPautaItem);

const ctxFor = (c: ClassRoom, subjects: Subject[], rules = DEFAULT_GRADE_RULES): CouncilContext => ({ cls: c, subjects, rules });

describe('conselho de turma: negativas do ano', () => {
  it('conta e lista as disciplinas negativas', () => {
    const subjects = [subj('mat', 'Matemática'), subj('lp', 'Língua Portuguesa'), subj('hist', 'História')];
    const store = { mat: [row('mat', flat(6))], lp: [row('lp', flat(14))], hist: [row('hist', flat(8))] };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(cls('7.ª Classe'), subjects), miniStore: store as any });
    expect(r.negativeCount).toBe(2);
    expect(r.negatives.map((n) => n.subjectName).sort()).toEqual(['História', 'Matemática']);
    expect(r.reasons.join(' ')).toContain('Negativa a 2 disciplina(s)');
  });

  it('classes de transição seguem a regra da Pauta Final (MF ≥ nota de aprovação)', () => {
    const subjects = [subj('mat', 'Matemática'), subj('lp', 'Língua Portuguesa')];
    const store = { mat: [row('mat', flat(8))], lp: [row('lp', flat(16))] };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(cls('7.ª Classe'), subjects), miniStore: store as any });
    expect(r.mf).toBe(12);
    expect(r.situation).toBe('APROVADO');
    expect(r.proposed).toBe('aprovado');
    expect(r.negativeCount).toBe(1);
  });

  it('aluno sem notas fica incompleto, sem inventar negativas', () => {
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(cls('7.ª Classe'), [subj('mat', 'Matemática')]) });
    expect(r.negativeCount).toBe(0);
    expect(r.incomplete).toBe(true);
    expect(r.missingFinal).toEqual(['Matemática']);
  });

  it('assinala o trimestre por lançar mesmo havendo média final', () => {
    const store = { mat: [row('mat', { mac1: 12, npp1: 12, npt1: 12 })] };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(cls('7.ª Classe'), [subj('mat', 'Matemática')]), miniStore: store as any });
    expect(r.incomplete).toBe(true);
    expect(r.reasons.join(' ')).toContain('Trimestre(s) por lançar');
    expect(r.reasons.join(' ')).toContain('II/III');
  });
});

describe('conselho de turma: classes de exame, limite de negativas e disciplinas chave', () => {
  const nineth = (extra: Partial<ClassRoom> = {}) => cls('9.ª Classe', extra);
  const subjects = [subj('mat', 'Matemática', { keySubsystems: ['secundario_1'] }), subj('hist', 'História'), subj('geo', 'Geografia'), subj('bio', 'Biologia')];

  it('negativa a disciplina chave reprova (sem recurso)', () => {
    const store = { mat: [row('mat', flat(8))], hist: [row('hist', flat(12))], geo: [row('geo', flat(12))], bio: [row('bio', flat(12))] };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(nineth(), subjects), miniStore: store as any });
    expect(r.situation).toBe('REPROVADO');
    expect(r.proposed).toBe('reprovado');
    expect(r.negatives[0].isKey).toBe(true);
    expect(r.reasons.join(' ')).toContain('disciplina chave');
  });

  it('até ao limite configurado de negativas (fora das chave): recurso → condicional', () => {
    const store = { mat: [row('mat', flat(12))], hist: [row('hist', flat(8))], geo: [row('geo', flat(9))], bio: [row('bio', flat(12))] };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(nineth(), subjects), miniStore: store as any });
    expect(r.maxNegativasRecurso).toBe(2);
    expect(r.situation).toBe('RECURSO');
    expect(r.proposed).toBe('condicional');
  });

  it('acima do limite configurado reprova; subir o limite nas Configurações passa a recurso', () => {
    const store = { mat: [row('mat', flat(12))], hist: [row('hist', flat(8))], geo: [row('geo', flat(9))], bio: [row('bio', flat(8))] };
    const strict = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(nineth(), subjects), miniStore: store as any });
    expect(strict.situation).toBe('REPROVADO');
    expect(strict.reasons.join(' ')).toContain('acima do limite configurado (2)');
    const lenient = buildCouncilStudentSummary({
      student: student(),
      ctx: ctxFor(nineth(), subjects, normalizeGradeRules({ maxNegativasRecurso6e9: 3 })),
      miniStore: store as any
    });
    expect(lenient.situation).toBe('RECURSO');
  });

  it('NER ≥ aprovação recupera a negativa: aprovado e sem recurso por abrir', () => {
    const store = {
      mat: [row('mat', flat(12))],
      hist: [row('hist', { ...flat(8), nee: 10, neo: 10, ner: 12 })],
      geo: [row('geo', flat(12))],
      bio: [row('bio', flat(12))]
    };
    const r = buildCouncilStudentSummary({ student: student(), ctx: ctxFor(nineth(), subjects), miniStore: store as any });
    const hist = r.negatives.find((n) => n.subjectName === 'História');
    // MF = 8×60% + 10×40% = 8.8 → 9; negativa, mas recuperada no recurso
    expect(hist?.recovered).toBe(true);
    expect(r.situation).toBe('APROVADO');
  });

  it('desistente propõe reprovado e não tem notas por atribuir', () => {
    const r = buildCouncilStudentSummary({ student: student({ status: 'suspended' } as any), ctx: ctxFor(nineth(), subjects) });
    expect(r.isDesistente).toBe(true);
    expect(r.proposed).toBe('reprovado');
    expect(r.incomplete).toBe(false);
  });

  it('transferido mantém as notas lançadas e não é desistente', () => {
    const only = [subj('mat', 'Matemática')];
    const store = { mat: [row('mat', flat(14))] };
    const r = buildCouncilStudentSummary({ student: student({ status: 'transferred' } as any), ctx: ctxFor(cls('7.ª Classe'), only), miniStore: store as any });
    expect(r.isTransferido).toBe(true);
    expect(r.isDesistente).toBe(false);
    expect(r.situation).toBe('TRANSFERIDO');
    expect(r.incomplete).toBe(false);
    expect(r.lines[0].decisive).toBe(14);
  });

  it('matrícula cancelada com notas lançadas não é desistente', () => {
    const only = [subj('mat', 'Matemática')];
    const store = { mat: [row('mat', flat(14))] };
    const r = buildCouncilStudentSummary({ student: student({ status: 'suspended' } as any), ctx: ctxFor(cls('7.ª Classe'), only), miniStore: store as any });
    expect(r.isDesistente).toBe(false);
    expect(r.lines[0].decisive).toBe(14);
  });
});

describe('boletim individual do conselho', () => {
  const subjects = [subj('mat', 'Matemática')];
  const ctx = ctxFor(cls('7.ª Classe'), subjects);

  it('as notas atribuídas recalculam MT, MFD e o resultado do aluno', () => {
    let draft = recalcCouncilRow(row('mat', {}), subjects[0], ctx);
    for (const f of ['mac1', 'npp1', 'npt1', 'mac2', 'npp2', 'npt2', 'mac3', 'npp3', 'npt3']) draft = recalcCouncilRow({ ...draft, [f]: 15 } as StudentMiniPautaItem, subjects[0], ctx);
    expect(draft.mt1).toBe(15);
    expect(draft.mfd).toBe(15);
    const r = buildCouncilStudentSummary({ student: student(), ctx, overrides: { mat: draft } });
    expect(r.negativeCount).toBe(0);
    expect(r.incomplete).toBe(false);
    expect(r.proposed).toBe('aprovado');
  });

  it('diff só regista campos de avaliação alterados', () => {
    const before = recalcCouncilRow(row('mat', { mac1: 8, npt1: 9 }), subjects[0], ctx);
    const after = recalcCouncilRow({ ...before, mac1: 12 } as StudentMiniPautaItem, subjects[0], ctx);
    const d = diffGradeRows(before, after, 'transicao');
    expect(d).toEqual([{ field: 'mac1', label: 'MAC I trim.', from: 8, to: 12 }]);
  });

  it('limites por campo (EJA tem escalas próprias) e sanitização', () => {
    expect(fieldMax('mac1', 'transicao')).toBe(20);
    expect(fieldMax('mac2', 'eja')).toBe(14);
    expect(fieldMax('aav3', 'eja')).toBe(2);
    expect(fieldMax('pcp1', 'eja')).toBe(4);
    expect(sanitizeGradeInput('25', 20)).toBe(20);
    expect(sanitizeGradeInput('-3', 20)).toBe(0);
    expect(sanitizeGradeInput('', 20)).toBe('');
    expect(sanitizeGradeInput('12,5', 20)).toBe(12.5);
  });

  it('decisão manual do conselho sobrevive à recomposição; a automática segue a nova proposta', () => {
    const st = student();
    const r1 = buildCouncilStudentSummary({ student: st, ctx: ctxFor(cls('7.ª Classe'), subjects), miniStore: { mat: [row('mat', flat(6))] } as any });
    const auto = buildCouncilEntry(st, r1);
    expect(auto.decision).toBe('reprovado');
    const r2 = buildCouncilStudentSummary({ student: st, ctx: ctxFor(cls('7.ª Classe'), subjects), miniStore: { mat: [row('mat', flat(14))] } as any });
    expect(buildCouncilEntry(st, r2, auto).decision).toBe('aprovado');
    const manual = { ...auto, decision: 'aprovado' as const, justification: 'Decisão do conselho' };
    const kept = buildCouncilEntry(st, r1, manual);
    expect(kept.decision).toBe('aprovado');
    expect(kept.justification).toBe('Decisão do conselho');
  });
});
