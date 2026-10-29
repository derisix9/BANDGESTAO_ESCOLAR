import { describe, expect, it } from 'vitest';
import {
  applyEquivalences, completedTrimesterGrades, dependencyLimitCheck, formatGuideNumber, nextGuideSeq,
  outstandingInvoices, transferredGradesToRecords
} from '../src/utils/transfers';

const inv = (id: number, studentId: string, status: string, dueDate?: string) => ({ id, studentId, status, dueDate, totalAmountKz: 100 });

describe('saída: dívidas', () => {
  it('bloqueia com faturas em atraso ou vencidas; ignora pagas, isentas, futuras e de outros alunos', () => {
    const list = [inv(1, 'a', 'atraso'), inv(2, 'a', 'pendente', '2026-12-01'), inv(3, 'a', 'pendente', '2026-09-01'), inv(4, 'b', 'atraso'), inv(5, 'a', 'pago'), inv(6, 'a', 'isento')];
    expect(outstandingInvoices(list, 'a', '2026-10-04').map((i) => i.id)).toEqual([1, 3]);
  });
});

describe('guia de transferência', () => {
  it('numeração sequencial por ano', () => {
    expect(nextGuideSeq(['GT-2026-0003', 'GT-2025-0009', undefined], 2026)).toBe(4);
    expect(formatGuideNumber(2026, 4)).toBe('GT-2026-0004');
  });
  it('só envia trimestres já avaliados', () => {
    const g = completedTrimesterGrades([{ subjectName: 'Mat', mt1: 12, mt2: 0, mt3: 0 } as any, { subjectName: 'Fis', mt1: 0, mt2: 0, mt3: 0 } as any]);
    expect(g).toEqual([{ subjectName: 'Mat', mt1: 12, mt2: '', mt3: '' }]);
  });
  it('notas importadas ficam marcadas como Transferência', () => {
    const [r] = transferredGradesToRecords([{ subjectName: 'Mat', mt1: 12, mt2: 14, mt3: '' }], 'Escola X');
    expect(r.origemNota).toBe('Transferência');
    expect(r.mfd).toBe(13);
  });
});

describe('equivalências e dependências', () => {
  const rules = [
    { id: '1', originSubject: 'Informática Aplicada', destSubject: 'TIC', createdBy: '', createdAt: '' },
    { id: '2', originSubject: 'Língua Portuguesa', destSubject: 'Língua Portuguesa', createdBy: '', createdAt: '' }
  ];
  it('copia notas das equivalentes e lista as que ficam em atraso', () => {
    const r = applyEquivalences([{ subjectName: 'lingua portuguesa', grade: 14 }, { subjectName: 'Informática aplicada', grade: 15 }, { subjectName: 'Desenho' }], rules, ['Língua Portuguesa', 'TIC', 'Filosofia']);
    expect(r.recognized.map((x) => [x.destSubject, x.grade])).toEqual([['Língua Portuguesa', 14], ['TIC', 15]]);
    expect(r.unmapped.map((x) => x.subjectName)).toEqual(['Desenho']);
    expect(r.missingForDependency).toEqual(['Filosofia']);
  });
  it('só bloqueia acima do limite de dependências', () => {
    expect(dependencyLimitCheck(0, 2).allowed).toBe(true);
    expect(dependencyLimitCheck(1, 2).allowed).toBe(false);
  });
});
