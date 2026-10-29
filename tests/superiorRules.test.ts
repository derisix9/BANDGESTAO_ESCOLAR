import { describe, expect, it } from 'vitest';
import {
  calculateCadeirasEmAtraso,
  calculateCourseFinalGrade,
  calculateCurricularAverage,
  calculateSuperiorTuition,
  checkDiplomaEligibility,
  checkPrerequisites,
  checkScholarshipMaintenance,
  latestResultPerUC,
  resolveInscricaoResult
} from '../src/utils/superiorCalculations';
import { SHARD_CONFIG } from '../src/utils/shardSync';
import { buildProjectionForAluno, buildProjectionForEncarregado } from '../src/utils/userProjections';
import type { BolsaEstudo, InscricaoUC, UnidadeCurricular } from '../src/types/superior';

const insc = (o: Partial<InscricaoUC>): InscricaoUC => ({
  id: 'i', studentId: 's1', studentName: 'A', studentProcNumber: '1', courseId: 'c1', courseName: 'C',
  ucId: 'uc1', ucCode: 'UC1', ucName: 'UC', academicYear: '2025/2026', year: 1, semester: 1, creditsECTS: 6,
  isCadeiraAtraso: false, status: 'inscrito', inscribedAt: '2025-09-01', ...o
});
const uc = (o: Partial<UnidadeCurricular>): UnidadeCurricular => ({
  id: 'uc1', code: 'UC1', name: 'UC', courseId: 'c1', courseName: 'C', year: 1, semester: 1, creditsECTS: 6,
  totalHours: 90, contactHours: { teorica: 30, pratica: 30, teoricoPratica: 30, laboratorial: 0 }, autonomousHours: 60,
  type: 'obrigatoria', prerequisites: [], academicYear: '2025/2026', status: 'ativo', ...o
});

describe('Épocas de exame (resolveInscricaoResult)', () => {
  it('frequência >= 14 dispensa de exame', () => {
    expect(resolveInscricaoResult({ notaFrequencia: 14 })).toEqual({ notaFinal: 14, epocaAprovacao: 'dispensa', status: 'aprovado' });
  });
  it('sem nenhuma época lançada continua inscrito', () => {
    expect(resolveInscricaoResult({ notaFrequencia: 9 }).status).toBe('inscrito');
  });
  it('reprova no normal e aprova no recurso', () => {
    const r = resolveInscricaoResult({ notaFrequencia: 9, notaExameNormal: 8, notaRecurso: 12 });
    expect(r.status).toBe('aprovado');
    expect(r.notaFinal).toBe(12);
    expect(r.epocaAprovacao).toBe('recurso');
  });
  it('uma época posterior mais baixa não anula uma aprovação anterior', () => {
    const r = resolveInscricaoResult({ notaExameNormal: 13, notaRecurso: 5 });
    expect(r.status).toBe('aprovado');
    expect(r.notaFinal).toBe(13);
    expect(r.epocaAprovacao).toBe('normal');
  });
  it('época especial mais baixa que o recurso não prevalece', () => {
    const r = resolveInscricaoResult({ notaExameNormal: 6, notaRecurso: 11, notaEspecial: 7 });
    expect(r.notaFinal).toBe(11);
    expect(r.epocaAprovacao).toBe('recurso');
  });
  it('reprovado em todas fica com a nota da última época', () => {
    const r = resolveInscricaoResult({ notaExameNormal: 6, notaRecurso: 8 });
    expect(r.status).toBe('reprovado');
    expect(r.notaFinal).toBe(8);
  });
  it('ignora valores inválidos e limita a 0-20', () => {
    expect(resolveInscricaoResult({ notaExameNormal: NaN }).status).toBe('inscrito');
    expect(resolveInscricaoResult({ notaExameNormal: 35 }).notaFinal).toBe(20);
  });
});

describe('Cadeiras em atraso e média usam 1 resultado por UC', () => {
  const reprovou = insc({ id: 'a', ucId: 'A', year: 1, academicYear: '2025/2026', status: 'reprovado', notaFinal: 8 });
  const recuperou = insc({ id: 'b', ucId: 'A', year: 1, academicYear: '2026/2027', status: 'aprovado', notaFinal: 11 });

  it('cadeira recuperada deixa de estar em atraso', () => {
    expect(calculateCadeirasEmAtraso([reprovou], 2)).toHaveLength(1);
    expect(calculateCadeirasEmAtraso([reprovou, recuperou], 2)).toHaveLength(0);
  });
  it('inscrição anulada é ignorada', () => {
    expect(latestResultPerUC([insc({ status: 'anulado' })])).toHaveLength(0);
  });
  it('a média conta a UC recuperada uma só vez, com a nota aprovada', () => {
    const r = calculateCurricularAverage([reprovou, recuperou]);
    expect(r.totalECTS).toBe(6);
    expect(r.average).toBe(11);
  });
  it('precedência: aprovação anulada não conta', () => {
    const pre = uc({ id: 'B', prerequisites: ['A'] });
    expect(checkPrerequisites(pre, [insc({ ucId: 'A', status: 'anulado', notaFinal: 15 })], []).allowed).toBe(false);
    expect(checkPrerequisites(pre, [recuperou], []).allowed).toBe(true);
  });
});

describe('Média final do curso', () => {
  it('TCC reprovado impede a conclusão', () => {
    const r = calculateCourseFinalGrade(15, 5);
    expect(r.approved).toBe(false);
    expect(r.finalGrade).toBe(15);
  });
  it('TCC obrigatório em falta impede a conclusão', () => {
    expect(calculateCourseFinalGrade(15, undefined, 0.75, 0.25, true).approved).toBe(false);
  });
  it('75% curricular + 25% TCC quando aprovado', () => {
    const r = calculateCourseFinalGrade(14, 18);
    expect(r.finalGrade).toBe(15);
    expect(r.approved).toBe(true);
  });
  it('média curricular inferior a 10 não aprova', () => {
    expect(calculateCourseFinalGrade(9).approved).toBe(false);
  });
});

describe('Elegibilidade para diploma', () => {
  const ucs = [uc({ id: 'A', code: 'A1' }), uc({ id: 'B', code: 'B1' }), uc({ id: 'O', code: 'OP', type: 'optativa' })];
  const aprovadaA = insc({ id: '1', ucId: 'A', status: 'aprovado', notaFinal: 12 });
  const aprovadaB = insc({ id: '2', ucId: 'B', status: 'aprovado', notaFinal: 14 });

  it('bloqueia com UCs obrigatórias em falta', () => {
    const r = checkDiplomaEligibility({ ucsDoCurso: ucs, inscricoes: [aprovadaA] });
    expect(r.eligible).toBe(false);
    expect(r.missingUCs.map((u) => u.code)).toEqual(['B1']);
  });
  it('optativas não são exigidas', () => {
    expect(checkDiplomaEligibility({ ucsDoCurso: ucs, inscricoes: [aprovadaA, aprovadaB] }).eligible).toBe(true);
  });
  it('exige ECTS mínimos quando indicados', () => {
    expect(checkDiplomaEligibility({ ucsDoCurso: ucs, inscricoes: [aprovadaA, aprovadaB], requiredECTS: 240 }).eligible).toBe(false);
  });
  it('bloqueia com TCC não defendido', () => {
    const r = checkDiplomaEligibility({ ucsDoCurso: ucs, inscricoes: [aprovadaA, aprovadaB], tcc: { status: 'em_elaboracao' } as any });
    expect(r.eligible).toBe(false);
  });
  it('bloqueia com estágio por concluir', () => {
    const r = checkDiplomaEligibility({
      ucsDoCurso: ucs, inscricoes: [aprovadaA, aprovadaB],
      estagios: [{ code: 'E1', status: 'em_curso', completedHours: 10, totalRequiredHours: 300 } as any]
    });
    expect(r.eligible).toBe(false);
  });
  it('sem UCs obrigatórias registadas não há diploma', () => {
    expect(checkDiplomaEligibility({ ucsDoCurso: [], inscricoes: [] }).eligible).toBe(false);
  });
});

describe('Bolsas', () => {
  const bolsa = { minAverageRequired: 14, maxArrearsAllowed: 0 };
  it('mantém-se com média e atrasos dentro dos limites (0 atrasos é um limite válido)', () => {
    expect(checkScholarshipMaintenance(bolsa, 15, 0).maintained).toBe(true);
    expect(checkScholarshipMaintenance(bolsa, 15, 1).maintained).toBe(false);
    expect(checkScholarshipMaintenance(bolsa, 12, 0).maintained).toBe(false);
  });
  it('montante fixo mensal multiplica pelos meses cobertos', () => {
    const b = { status: 'ativa', coverageType: 'montante_fixo', fixedMonthlyAmountKz: 10000, sponsorName: 'X', discountPercent: 0 } as BolsaEstudo;
    expect(calculateSuperiorTuition(30, 5000, b, 0, 6).discountAmountKz).toBe(60000);
    expect(calculateSuperiorTuition(30, 5000, b, 0, 6).netAmountKz).toBe(90000);
  });
});

describe('Privacidade dos portais e carregamento por ano', () => {
  const PORTAIS = ['aluno', 'encarregado'];
  it('aluno e encarregado não leem listas com dados de outras pessoas', () => {
    for (const name of ['internalChatThreads', 'inscricoesUC', 'bolsasEstudo', 'monografiasTCC', 'estagiosCurriculares',
      'diplomasSuperior', 'homologations', 'attendanceSheets', 'loans', 'students', 'classes', 'invoices', 'matriculas', 'guardianLinks']) {
      for (const r of PORTAIS) expect(SHARD_CONFIG[name].read, `${name}/${r}`).not.toContain(r);
    }
  });
  it('o histórico académico do superior não fica preso ao ano activo', () => {
    for (const name of ['unidadesCurriculares', 'inscricoesUC', 'monografiasTCC', 'estagiosCurriculares', 'bolsasEstudo']) {
      expect(!!SHARD_CONFIG[name].academicYearScoped, name).toBe(false);
    }
  });
  it('a projecção do aluno só traz as suas conversas e os seus empréstimos', () => {
    const db: any = {
      students: [{ id: 's1', name: 'Ana Silva', classId: 'k1' }, { id: 's2', name: 'Rui', classId: 'k1' }],
      users: [], matriculas: [], classes: [], invoices: [], guardianLinks: [], homologations: [], attendanceSheets: [],
      internalChatThreads: [
        { id: 't1', participantIds: ['u-ana', 'u-sec'], participants: [], messages: [] },
        { id: 't2', participantIds: ['u-prof', 'u-sec'], participants: [], messages: [] }
      ],
      loans: [{ id: 'l1', borrowerName: 'Ana Silva' }, { id: 'l2', borrowerName: 'Rui' }]
    };
    const p = buildProjectionForAluno({ id: 'u-ana', role: 'aluno', name: 'Ana Silva', linkedStudentId: 's1' } as any, db);
    expect(p.internalChatThreads!.map((t) => t.id)).toEqual(['t1']);
    expect(p.loans!.map((l) => l.id)).toEqual(['l1']);
    const e = buildProjectionForEncarregado({ id: 'u-ana', role: 'encarregado', name: 'X' } as any, db);
    expect(e.internalChatThreads!.map((t) => t.id)).toEqual(['t1']);
  });
});
