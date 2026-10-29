import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIBRARY_POLICY as P, borrowBlockers, computeFine, daysBetween, effectiveStatus, markLost, outstandingFine, overdueDays,
  parseDateLoose, payFine, renewLoan, returnLoan, summarizeLoans, waiveFine, type LoanRecord
} from '../src/utils/libraryLoans';

const loan = (o: Partial<LoanRecord> = {}): LoanRecord => ({
  id: 'l1', bookId: 'b1', bookTitle: 'Livro', borrowerName: 'Ana', borrowerRole: 'aluno',
  borrowDate: '2026-10-01', dueDate: '2026-10-15', status: 'ativo', ...o
});

describe('datas', () => {
  it('lê AAAA-MM-DD e o formato antigo DD/MM/AAAA', () => {
    expect(parseDateLoose('2026-10-15')?.toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(parseDateLoose('15/10/2026')?.toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(parseDateLoose('lixo')).toBeNull();
  });
  it('conta dias entre datas, incluindo virada de mês', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });
});

describe('multas', () => {
  it('sem multa no prazo e dentro da tolerância', () => {
    expect(computeFine('2026-10-15', '2026-10-15')).toBe(0);
    expect(computeFine('2026-10-15', '2026-10-16')).toBe(0); // 1 dia de tolerância
  });
  it('conta dias depois da tolerância', () => {
    expect(overdueDays('2026-10-15', '2026-10-20')).toBe(4);
    expect(computeFine('2026-10-15', '2026-10-20')).toBe(4 * P.finePerDay);
  });
  it('respeita o teto', () => {
    expect(computeFine('2026-01-01', '2026-10-01')).toBe(P.fineCap);
    expect(computeFine('2026-01-01', '2026-10-01', { ...P, fineCap: 0 })).toBeGreaterThan(P.fineCap);
  });
});

describe('devolução, renovação e perda', () => {
  it('devolver em atraso fixa a multa por pagar', () => {
    const r = returnLoan(loan(), '2026-10-20');
    expect(r.status).toBe('devolvido');
    expect(r.fineAmount).toBe(200);
    expect(r.finePaid).toBe(false);
    expect(outstandingFine(r)).toBe(200);
  });
  it('devolver a tempo não cria multa', () => {
    const r = returnLoan(loan(), '2026-10-10');
    expect(r.fineAmount).toBeUndefined();
    expect(outstandingFine(r)).toBe(0);
  });
  it('renova uma vez e depois recusa; em atraso não renova', () => {
    const once = renewLoan(loan(), '2026-10-10');
    expect(once.dueDate).toBe('2026-10-29');
    expect(once.renewals).toBe(1);
    expect(renewLoan(once, '2026-10-11')).toEqual(once);
    expect(renewLoan(loan(), '2026-10-20').renewals).toBeUndefined();
  });
  it('perdido usa o valor de reposição como multa', () => {
    const r = markLost(loan(), '2026-10-20', 3500);
    expect(r.status).toBe('perdido');
    expect(outstandingFine(r)).toBe(3500);
  });
  it('pagar e perdoar (perdão exige motivo)', () => {
    const r = returnLoan(loan(), '2026-10-20');
    expect(outstandingFine(payFine(r, '2026-10-21'))).toBe(0);
    expect(outstandingFine(waiveFine(r, '  '))).toBe(200);
    expect(outstandingFine(waiveFine(r, 'Caso de doença'))).toBe(0);
  });
});

describe('quem pode levar livros', () => {
  const key = 'ana';
  it('bloqueia sem exemplares, no limite, com atraso e com multas por pagar', () => {
    expect(borrowBlockers({ availableCopies: 0, borrowerKey: key, loans: [], asOf: '2026-10-10' })).toHaveLength(1);
    const three = [1, 2, 3].map((i) => loan({ id: `x${i}` }));
    expect(borrowBlockers({ availableCopies: 1, borrowerKey: key, loans: three, asOf: '2026-10-10' })).toHaveLength(1);
    expect(borrowBlockers({ availableCopies: 1, borrowerKey: key, loans: [loan()], asOf: '2026-10-20' })).toHaveLength(1);
    const withFine = [returnLoan(loan(), '2026-10-20')];
    expect(borrowBlockers({ availableCopies: 1, borrowerKey: key, loans: withFine, asOf: '2026-10-21' })).toHaveLength(1);
  });
  it('deixa levar quando está tudo em ordem; outros leitores não contam', () => {
    expect(borrowBlockers({ availableCopies: 2, borrowerKey: key, loans: [loan({ borrowerName: 'Outro' })], asOf: '2026-10-10' })).toEqual([]);
  });
});

describe('resumo e estado', () => {
  it('o estado "atrasado" calcula-se pela data', () => {
    expect(effectiveStatus(loan(), '2026-10-10')).toBe('ativo');
    expect(effectiveStatus(loan(), '2026-10-16')).toBe('atrasado');
  });
  it('soma ativos, atrasados e multas', () => {
    const s = summarizeLoans([loan(), returnLoan(loan({ id: 'l2' }), '2026-10-20')], '2026-10-20');
    expect(s.active).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.finesAccrued).toBe(200);
    expect(s.finesOutstanding).toBe(200);
    expect(s.finesRunning).toBe(200);
  });
});
