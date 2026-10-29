/**
 * Biblioteca (passo 6): empréstimos, devoluções, renovações e multas por atraso.
 * Lógica pura e testável. Datas em AAAA-MM-DD (não usar toLocaleDateString: não dá para
 * fazer contas com datas em texto "pt-PT").
 */

export interface LibraryPolicy {
  /** Dias de empréstimo por defeito. */
  loanDays: number;
  /** Dias de tolerância depois do prazo, em que ainda não há multa. */
  graceDays: number;
  /** Multa por dia de atraso, em Kwanzas. */
  finePerDay: number;
  /** Teto da multa por empréstimo (0 = sem teto). */
  fineCap: number;
  /** Máximo de empréstimos ativos por leitor. */
  maxActiveLoans: number;
  /** Máximo de renovações por empréstimo. */
  maxRenewals: number;
  /** Bloquear novos empréstimos a quem tem multas por pagar. */
  blockOnUnpaidFines: boolean;
}

export const DEFAULT_LIBRARY_POLICY: LibraryPolicy = {
  loanDays: 14,
  graceDays: 1,
  finePerDay: 50,
  fineCap: 2000,
  maxActiveLoans: 3,
  maxRenewals: 1,
  blockOnUnpaidFines: true
};

export interface LoanRecord {
  id: string;
  bookId: string;
  bookTitle: string;
  borrowerId?: string;
  borrowerName: string;
  borrowerRole: string;
  /** AAAA-MM-DD */
  borrowDate: string;
  /** AAAA-MM-DD */
  dueDate: string;
  returnDate?: string;
  renewals?: number;
  status: 'ativo' | 'devolvido' | 'atrasado' | 'perdido';
  /** Multa fixada na devolução (ou na marcação de perdido). */
  fineAmount?: number;
  finePaid?: boolean;
  finePaidAt?: string;
  fineWaivedReason?: string;
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Aceita AAAA-MM-DD e DD/MM/AAAA (formato antigo guardado por versões anteriores). */
export function parseDateLoose(value?: string): Date | null {
  if (!value) return null;
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseDateLoose(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Dias inteiros entre duas datas (b - a). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = parseDateLoose(aISO);
  const b = parseDateLoose(bISO);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Dias de atraso a contar para multa (já descontada a tolerância). */
export function overdueDays(dueDate: string, asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): number {
  const late = daysBetween(dueDate, asOf);
  return Math.max(0, late - Math.max(0, policy.graceDays));
}

export function computeFine(dueDate: string, asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): number {
  const days = overdueDays(dueDate, asOf, policy);
  const raw = days * Math.max(0, policy.finePerDay);
  return policy.fineCap > 0 ? Math.min(raw, policy.fineCap) : raw;
}

export function isOverdue(loan: Pick<LoanRecord, 'dueDate' | 'returnDate' | 'status'>, asOf: string): boolean {
  if (loan.returnDate || loan.status === 'devolvido' || loan.status === 'perdido') return false;
  return daysBetween(loan.dueDate, asOf) > 0;
}

export function activeLoansOf(loans: LoanRecord[], borrowerKey: (l: LoanRecord) => string, key: string): LoanRecord[] {
  return loans.filter((l) => !l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido' && borrowerKey(l) === key);
}

export const borrowerKeyOf = (l: Pick<LoanRecord, 'borrowerId' | 'borrowerName'>) =>
  (l.borrowerId || l.borrowerName || '').trim().toLowerCase();

export interface CanBorrowInput {
  availableCopies: number;
  borrowerKey: string;
  loans: LoanRecord[];
  asOf: string;
  policy?: LibraryPolicy;
}

/** Devolve a lista de motivos que impedem o empréstimo (vazia = pode levar). */
export function borrowBlockers({ availableCopies, borrowerKey, loans, asOf, policy = DEFAULT_LIBRARY_POLICY }: CanBorrowInput): string[] {
  const reasons: string[] = [];
  if (availableCopies <= 0) reasons.push('Não há exemplares disponíveis.');
  const mine = loans.filter((l) => borrowerKeyOf(l) === borrowerKey);
  const active = mine.filter((l) => !l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido');
  if (active.length >= policy.maxActiveLoans) reasons.push(`O leitor já tem ${active.length} empréstimo(s) ativo(s) (máximo ${policy.maxActiveLoans}).`);
  if (active.some((l) => isOverdue(l, asOf))) reasons.push('O leitor tem um empréstimo em atraso por devolver.');
  if (policy.blockOnUnpaidFines && mine.some((l) => (l.fineAmount || 0) > 0 && !l.finePaid && !l.fineWaivedReason)) {
    reasons.push('O leitor tem multas por pagar.');
  }
  return reasons;
}

export function renewBlockers(loan: LoanRecord, asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): string[] {
  const reasons: string[] = [];
  if (loan.returnDate || loan.status === 'devolvido' || loan.status === 'perdido') reasons.push('O empréstimo já está encerrado.');
  if (isOverdue(loan, asOf)) reasons.push('Empréstimos em atraso não se renovam: devolva primeiro.');
  if ((loan.renewals || 0) >= policy.maxRenewals) reasons.push(`Já atingiu o máximo de ${policy.maxRenewals} renovação(ões).`);
  return reasons;
}

export function renewLoan(loan: LoanRecord, asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): LoanRecord {
  if (renewBlockers(loan, asOf, policy).length > 0) return loan;
  return { ...loan, dueDate: addDaysISO(loan.dueDate, policy.loanDays), renewals: (loan.renewals || 0) + 1 };
}

export function returnLoan(loan: LoanRecord, asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): LoanRecord {
  const fine = computeFine(loan.dueDate, asOf, policy);
  return {
    ...loan,
    status: 'devolvido',
    returnDate: asOf,
    fineAmount: fine > 0 ? fine : undefined,
    finePaid: fine > 0 ? false : undefined
  };
}

/** Livro perdido: a multa é o valor de reposição indicado pela biblioteca. */
export function markLost(loan: LoanRecord, asOf: string, replacementCost: number): LoanRecord {
  return {
    ...loan,
    status: 'perdido',
    returnDate: asOf,
    fineAmount: Math.max(0, Math.round(replacementCost)),
    finePaid: false
  };
}

export function payFine(loan: LoanRecord, asOf: string): LoanRecord {
  if (!(loan.fineAmount && loan.fineAmount > 0) || loan.finePaid) return loan;
  return { ...loan, finePaid: true, finePaidAt: asOf };
}

/** Perdoar a multa exige motivo (fica registado). */
export function waiveFine(loan: LoanRecord, reason: string): LoanRecord {
  const r = reason.trim();
  if (!r || !(loan.fineAmount && loan.fineAmount > 0) || loan.finePaid) return loan;
  return { ...loan, fineWaivedReason: r };
}

export function outstandingFine(loan: LoanRecord): number {
  if (!(loan.fineAmount && loan.fineAmount > 0)) return 0;
  return loan.finePaid || loan.fineWaivedReason ? 0 : loan.fineAmount;
}

export interface LibrarySummary {
  active: number;
  overdue: number;
  finesAccrued: number;
  finesOutstanding: number;
  /** Multas de empréstimos ainda abertos e já em atraso (ainda não cobradas). */
  finesRunning: number;
}

export function summarizeLoans(loans: LoanRecord[], asOf: string, policy: LibraryPolicy = DEFAULT_LIBRARY_POLICY): LibrarySummary {
  let active = 0, overdue = 0, finesAccrued = 0, finesOutstanding = 0, finesRunning = 0;
  for (const l of loans) {
    if (l.fineAmount) {
      finesAccrued += l.fineAmount;
      finesOutstanding += outstandingFine(l);
    }
    if (!l.returnDate && l.status !== 'devolvido' && l.status !== 'perdido') {
      active += 1;
      if (isOverdue(l, asOf)) {
        overdue += 1;
        finesRunning += computeFine(l.dueDate, asOf, policy);
      }
    }
  }
  return { active, overdue, finesAccrued, finesOutstanding, finesRunning };
}

/** Estado a mostrar: "atrasado" calcula-se, não se guarda (muda com o calendário). */
export function effectiveStatus(loan: LoanRecord, asOf: string): LoanRecord['status'] {
  if (loan.status === 'devolvido' || loan.status === 'perdido') return loan.status;
  return isOverdue(loan, asOf) ? 'atrasado' : 'ativo';
}
