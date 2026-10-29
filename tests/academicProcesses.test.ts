import { describe, expect, it } from 'vitest';
import {
  advanceRecovery, docVerificationCode, formatDocNumber, nextDocSequence, parseDocNumber,
  proposeCouncilDecision, isEligibleForRecovery, effectiveGradeAfterRecovery
} from '../src/utils/academicProcesses';

const subj = (id: string, g: number | '') => ({ subjectId: id, subjectName: id.toUpperCase(), finalGrade: g });

describe('numeração de documentos', () => {
  it('sequência por tipo e ano, sem reutilizar números anulados', () => {
    const issued = [
      { type: 'certificado' as const, year: 2026, seq: 1 },
      { type: 'certificado' as const, year: 2026, seq: 2, status: 'anulado' as const },
      { type: 'diploma' as const, year: 2026, seq: 7 }
    ];
    expect(nextDocSequence(issued, 'certificado', 2026)).toBe(3);
    expect(nextDocSequence(issued, 'certificado', 2027)).toBe(1);
  });
  it('formata e interpreta o número', () => {
    const n = formatDocNumber('certificado', 2026, 12);
    expect(n).toBe('CERT-2026-000012');
    expect(parseDocNumber(n)).toEqual({ type: 'certificado', year: 2026, seq: 12 });
    expect(parseDocNumber('XXXX-2026-000001')).toBeNull();
  });
  it('código de verificação é estável e sensível aos dados', () => {
    const a = docVerificationCode('CERT-2026-000001', 's1', '2026-10-02');
    expect(a).toBe(docVerificationCode('CERT-2026-000001', 's1', '2026-10-02'));
    expect(a).not.toBe(docVerificationCode('CERT-2026-000001', 's2', '2026-10-02'));
  });
});

describe('conselho de turma', () => {
  it('aprova com todas positivas', () => {
    expect(proposeCouncilDecision({ results: [subj('a', 12), subj('b', 10)] }).decision).toBe('aprovado');
  });
  it('condicional com 1–2 negativas e lista as disciplinas a recuperar', () => {
    const p = proposeCouncilDecision({ results: [subj('a', 8), subj('b', 12), subj('c', 14)] });
    expect(p.decision).toBe('condicional');
    expect(p.recoverySubjectIds).toEqual(['a']);
  });
  it('reprova com 3 ou mais negativas', () => {
    expect(proposeCouncilDecision({ results: [subj('a', 8), subj('b', 7), subj('c', 9)] }).decision).toBe('reprovado');
  });
  it('negativa em disciplina eliminatória reprova mesmo com uma só', () => {
    const rules = { passingGrade: 10, maxNegativesForCondicional: 2, maxNegativesToFail: 3, eliminatorySubjectIds: ['mat'], maxAbsencePercent: 25 };
    expect(proposeCouncilDecision({ results: [subj('mat', 8), subj('b', 12)], rules }).decision).toBe('reprovado');
  });
  it('faltas acima do limite reprovam', () => {
    expect(proposeCouncilDecision({ results: [subj('a', 15)], unexcusedAbsences: 30, totalLessons: 100 }).decision).toBe('reprovado');
  });
  it('notas em falta marcam a proposta como incompleta', () => {
    expect(proposeCouncilDecision({ results: [subj('a', 15), subj('b', '')] }).incomplete).toBe(true);
  });
});

describe('recuperação e exame de recurso', () => {
  const base = { studentId: 's', subjectId: 'a', originalGrade: 8, stage: 'inscrito' as const, outcome: 'pendente' as const };
  it('elegibilidade: entre o mínimo de admissão e a nota de aprovação', () => {
    expect(isEligibleForRecovery(8)).toBe(true);
    expect(isEligibleForRecovery(6)).toBe(false);
    expect(isEligibleForRecovery(10)).toBe(false);
  });
  it('recuperação positiva conclui aprovado', () => {
    const c = advanceRecovery({ ...base, recoveryGrade: 11 });
    expect(c.outcome).toBe('aprovado');
    expect(effectiveGradeAfterRecovery(c)).toBe(11);
  });
  it('recuperação negativa passa ao exame de recurso; exame decide', () => {
    const c1 = advanceRecovery({ ...base, recoveryGrade: 8 });
    expect(c1.stage).toBe('exame_recurso');
    expect(advanceRecovery({ ...c1, appealExamGrade: 9 }).outcome).toBe('reprovado');
    expect(advanceRecovery({ ...c1, appealExamGrade: 10 }).outcome).toBe('aprovado');
  });
});
