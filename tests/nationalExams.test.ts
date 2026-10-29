import { describe, expect, it } from 'vitest';
import { validateExam, validateScore, resultOf, eligibleStudents, summarizeExam, isRealDate } from '../src/utils/nationalExams';

const exam = (o: any = {}): any => ({ id: 'e1', name: 'X', grade: '9.ª Classe', subject: 'Matemática', date: '2026-11-10', startTime: '08:00', status: 'agendado', ...o });
const cls = (id: string, grade: string): any => ({ id, name: id, grade });
const st = (id: string, classId: string, status = 'active'): any => ({ id, name: `Aluno ${id}`, classId, status });
const en = (studentId: string, status: string, score?: number, examId = 'e1'): any => ({ id: `n${studentId}`, examId, studentId, status, score });

describe('exames: validação', () => {
  it('datas reais e campos obrigatórios', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(validateExam({ grade: '', subject: '', date: 'x' }, []).length).toBe(3);
  });
  it('rejeita duplicado e choque de horário na mesma classe', () => {
    expect(validateExam({ grade: '9.ª Classe', subject: 'matemática', date: '2026-11-10' }, [exam()])).toContain('Já existe um exame desta disciplina, nesta classe e data.');
    const clash = validateExam({ grade: '9ª Classe', subject: 'Português', date: '2026-11-10', startTime: '08:00' }, [exam()]);
    expect(clash.length).toBe(1);
    expect(validateExam({ grade: '9.ª Classe', subject: 'Matemática', date: '2026-11-10' }, [exam()], 'e1')).toEqual([]);
    expect(validateExam({ grade: '9.ª Classe', subject: 'Matemática', date: '2026-11-10' }, [exam({ status: 'cancelado' })])).toEqual([]);
  });
});

describe('exames: notas e resultados', () => {
  it('nota 0–20 com vírgula decimal', () => {
    expect(validateScore('14,5')).toEqual({ ok: true, value: 14.5 });
    expect(validateScore(21).ok).toBe(false);
    expect(validateScore(-1).ok).toBe(false);
    expect(validateScore('').ok).toBe(false);
    expect(validateScore('abc').ok).toBe(false);
  });
  it('aprova a partir de 10', () => {
    expect(resultOf({ status: 'classificado', score: 10 })).toBe('aprovado');
    expect(resultOf({ status: 'classificado', score: 9.9 })).toBe('reprovado');
    expect(resultOf({ status: 'faltou' })).toBe('faltou');
    expect(resultOf({ status: 'inscrito' })).toBe('pendente');
  });
  it('resumo ignora anuladas e conta faltas fora da taxa', () => {
    const s = summarizeExam([en('1', 'classificado', 14), en('2', 'classificado', 8), en('3', 'faltou'), en('4', 'inscrito'), en('5', 'anulado')]);
    expect(s).toMatchObject({ inscritos: 4, classificados: 2, aprovados: 1, reprovados: 1, faltas: 1, pendentes: 1, taxaAprovacao: 50, media: 11 });
  });
});

describe('exames: elegíveis', () => {
  it('só activos da classe do exame e ainda não inscritos', () => {
    const e = eligibleStudents(exam(), [st('1', 'c9'), st('2', 'c9', 'transferred'), st('3', 'c9'), st('4', 'c7')], [cls('c9', '9.ª Classe'), cls('c7', '7.ª Classe')], [en('3', 'inscrito')]);
    expect(e.map((s) => s.id)).toEqual(['1']);
    // inscrição anulada volta a ser elegível
    expect(eligibleStudents(exam(), [st('3', 'c9')], [cls('c9', '9.ª Classe')], [en('3', 'anulado')]).length).toBe(1);
  });
});
