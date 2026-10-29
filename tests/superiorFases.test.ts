import { describe, expect, it } from 'vitest';
import {
  allocateRegisterNumber,
  calculateCadeirasEmFalta,
  nextDiplomaSequence,
  checkYearTransitionEligibility
} from '../src/utils/superiorCalculations';
import { buildDiplomaSupplement } from '../src/utils/diplomaSupplement';
import type { DiplomaSuperior, InscricaoUC, UnidadeCurricular } from '../src/types/superior';

export const insc = (o: Partial<InscricaoUC>): InscricaoUC => ({
  id: 'i', studentId: 's1', studentName: 'A', studentProcNumber: '1', courseId: 'c1', courseName: 'C',
  ucId: 'uc1', ucCode: 'UC1', ucName: 'UC', academicYear: '2025/2026', year: 1, semester: 1, creditsECTS: 6,
  isCadeiraAtraso: false, status: 'inscrito', inscribedAt: '2025-09-01', ...o
});
export const uc = (o: Partial<UnidadeCurricular>): UnidadeCurricular => ({
  id: 'uc1', code: 'UC1', name: 'UC', courseId: 'c1', courseName: 'C', year: 1, semester: 1, creditsECTS: 6,
  totalHours: 90, contactHours: { teorica: 30, pratica: 30, teoricoPratica: 30, laboratorial: 0 }, autonomousHours: 60,
  type: 'obrigatoria', prerequisites: [], academicYear: '2025/2026', status: 'ativo', ...o
});

describe('Fase 1 — cadeiras nunca inscritas contam como atraso', () => {
  const catalogo = [uc({ id: 'a', code: 'A' }), uc({ id: 'b', code: 'B' }), uc({ id: 'c', code: 'C' }), uc({ id: 'o', code: 'O', type: 'optativa' }), uc({ id: 'x', code: 'X', status: 'inativo' })];

  it('UC obrigatória nunca inscrita é atraso; optativa e inactiva não', () => {
    const r = calculateCadeirasEmFalta(catalogo, [insc({ ucId: 'a', status: 'aprovado', notaFinal: 12 })], 2);
    expect(r.map((x) => x.code).sort()).toEqual(['B', 'C']);
    expect(r.every((x) => x.motivo === 'nunca_inscrita')).toBe(true);
  });

  it('distingue reprovada de nunca inscrita e não duplica', () => {
    const r = calculateCadeirasEmFalta(catalogo, [insc({ ucId: 'a', status: 'reprovado', notaFinal: 6 })], 2);
    expect(r.find((x) => x.code === 'A')?.motivo).toBe('reprovada');
    expect(r.filter((x) => x.code === 'A')).toHaveLength(1);
  });

  it('cadeira recuperada em ano posterior não conta', () => {
    const r = calculateCadeirasEmFalta(catalogo.slice(0, 1), [
      insc({ id: '1', ucId: 'a', status: 'reprovado', notaFinal: 6, academicYear: '2025/2026' }),
      insc({ id: '2', ucId: 'a', status: 'aprovado', notaFinal: 11, academicYear: '2026/2027' })
    ], 2);
    expect(r).toHaveLength(0);
  });

  it('UCs do ano pretendido ou posterior não são atraso', () => {
    expect(calculateCadeirasEmFalta([uc({ id: 'z', year: 2 })], [], 2)).toHaveLength(0);
  });

  it('reprovada em UC fora do catálogo continua em atraso', () => {
    const r = calculateCadeirasEmFalta([], [insc({ ucId: 'gone', ucCode: 'G', status: 'reprovado', notaFinal: 4 })], 2);
    expect(r.map((x) => x.code)).toEqual(['G']);
  });

  it('a transição bloqueia quando o catálogo revela mais de 2 cadeiras nunca feitas', () => {
    const cat = ['a', 'b', 'c'].map((id) => uc({ id, code: id.toUpperCase() }));
    expect(checkYearTransitionEligibility([], 2).eligible).toBe(true); // sem catálogo: comportamento antigo
    const r = checkYearTransitionEligibility([], 2, 2, 12, cat);
    expect(r.eligible).toBe(false);
    expect(r.arrearsCount).toBe(3);
  });
});

describe('Fase 2 — número de registo de diplomas', () => {
  const d = (n: string) => ({ registerNumber: n });
  it('usa o maior número do ano + 1, não a contagem', () => {
    expect(nextDiplomaSequence([d('1/2026'), d('5/2026')], 2026)).toBe(6);
  });
  it('não repete número depois de apagar registos', () => {
    // existiam 1,2,3; o 2 foi apagado: o próximo é 4 (a contagem daria 3 e repetiria)
    expect(allocateRegisterNumber([d('1/2026'), d('3/2026')], 2026)).toBe('4/2026');
  });
  it('anos diferentes têm sequências independentes', () => {
    expect(nextDiplomaSequence([d('9/2025')], 2026)).toBe(1);
  });
  it('emissão simultânea: o número pedido já ocupado é substituído pelo próximo livre', () => {
    const existentes = [d('1/2026'), d('2/2026')];
    expect(allocateRegisterNumber(existentes, 2026, '2/2026')).toBe('3/2026');
    expect(allocateRegisterNumber(existentes, 2026, '3/2026')).toBe('3/2026');
  });
  it('lista vazia começa em 1', () => {
    expect(allocateRegisterNumber([], 2026)).toBe('1/2026');
  });
});

describe('Fase 4 — suplemento ao diploma', () => {
  const diploma = {
    id: 'd', code: 'DIP-2026-0001', studentId: 's1', studentName: 'Ana', studentProcNumber: '9', courseId: 'c1',
    courseName: 'Informática', degreeGranted: 'Licenciatura', degreeTitle: 'Licenciado em Informática',
    academicYearConcluded: '2026/2027', completionDate: '2027-07-01', finalGradeCurricular: 14, finalCourseGrade: 14.5,
    finalMention: 'Bom', totalCreditsECTS: 18, registerNumber: '1/2026', registryBook: '', registryPage: '',
    issueDate: '2027-07-10', rectorName: '', academicDirectorName: '', status: 'emitido'
  } as DiplomaSuperior;

  it('agrupa por ano, ordena e conta uma UC uma só vez (melhor aprovação)', () => {
    const s = buildDiplomaSupplement({
      diploma,
      ucs: [uc({ id: 'a', year: 1 }), uc({ id: 'b', year: 2, semester: 2 })],
      inscricoes: [
        insc({ id: '1', ucId: 'b', ucCode: 'B', year: 2, semester: 2, status: 'aprovado', notaFinal: 15, epocaAprovacao: 'normal' }),
        insc({ id: '2', ucId: 'a', ucCode: 'A', status: 'reprovado', notaFinal: 5 }),
        insc({ id: '3', ucId: 'a', ucCode: 'A', status: 'aprovado', notaFinal: 12, epocaAprovacao: 'recurso', academicYear: '2026/2027' }),
        insc({ id: '4', studentId: 'outro', ucId: 'z', ucCode: 'Z', status: 'aprovado', notaFinal: 20 })
      ]
    });
    expect(s.years.map((y) => y.year)).toEqual([1, 2]);
    expect(s.years[0].rows).toHaveLength(1);
    expect(s.years[0].rows[0].grade).toBe(12);
    expect(s.years[0].rows[0].origem).toBe('Recurso');
    expect(s.totalECTS).toBe(12); // só do próprio estudante; sem a UC de outro
  });

  it('UC reprovada não aparece no suplemento', () => {
    const s = buildDiplomaSupplement({ diploma, inscricoes: [insc({ status: 'reprovado', notaFinal: 4 })] });
    expect(s.years).toHaveLength(0);
  });
});
