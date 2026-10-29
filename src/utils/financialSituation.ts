/**
 * Situação financeira REAL de um aluno matriculado, calculada a partir das faturas
 * (propinas e pagamentos de outros serviços) — muda sempre que há pagamentos ou atrasos.
 *
 *  - Em mora   : alguma fatura em atraso (estado "atraso", ou pendente já vencida);
 *  - Isento    : matrícula isenta/bolseiro, sem faturas em mora (só se cobram outros serviços);
 *  - Pendente  : há faturas por pagar, ainda dentro do prazo;
 *  - Regular   : tudo pago (ou sem faturas).
 */
import type { Matricula, SituacaoFinanceira, TuitionInvoice } from '../types';

export const SITUACAO_FINANCEIRA_OPTIONS: { value: SituacaoFinanceira; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'mora', label: 'Em Mora' },
  { value: 'isento', label: 'Isento / Bolseiro' }
];

export const SITUACAO_FINANCEIRA_LABEL: Record<SituacaoFinanceira, string> = {
  regular: 'Regular',
  pendente: 'Pendente',
  mora: 'Em Mora',
  isento: 'Isento / Bolseiro'
};

export const SITUACAO_FINANCEIRA_BADGE: Record<SituacaoFinanceira, string> = {
  regular: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  pendente: 'bg-amber-50 text-amber-800 border-amber-300',
  mora: 'bg-red-50 text-[#7a0c0c] border-red-300',
  isento: 'bg-sky-50 text-sky-800 border-sky-300'
};

type InvoiceLite = Pick<TuitionInvoice, 'studentId' | 'status' | 'dueDate'> & { overdueFrom?: string };

/** AAAA-MM-DD no fuso local (toISOString() desloca o dia em UTC+1). */
export function localISODate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Aceita AAAA-MM-DD ou DD/MM/AAAA; devolve AAAA-MM-DD ou ''. */
export function toIsoDay(value: string | undefined | null): string {
  const v = String(value ?? '').trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** A fatura está em mora? (estado "atraso", ou pendente com vencimento já passado). */
export function isInvoiceInMora(inv: InvoiceLite, todayISO: string = localISODate()): boolean {
  if (inv.status === 'atraso') return true;
  if (inv.status !== 'pendente') return false;
  const due = toIsoDay(inv.dueDate);
  if (!due || due >= todayISO) return false;
  // Faturas geradas "pendentes" na matrícula e já vencidas nessa altura mantêm-se pendentes.
  if (inv.overdueFrom && due < inv.overdueFrom) return false;
  return true;
}

export function isMatriculaExempt(m: Pick<Matricula, 'tipoAluno' | 'situacaoFinanceira' | 'estadoFinanceiro'> | undefined | null): boolean {
  if (!m) return false;
  return m.situacaoFinanceira === 'isento' || m.tipoAluno === 'isento' || m.tipoAluno === 'bolseiro' || (!m.situacaoFinanceira && m.estadoFinanceiro === 'isento');
}

/** Índice de faturas por aluno (calcula-se uma só vez para listagens grandes). */
export function indexInvoicesByStudent<T extends InvoiceLite>(invoices: T[] | undefined | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const inv of invoices || []) {
    const k = String(inv.studentId);
    const list = map.get(k);
    if (list) list.push(inv); else map.set(k, [inv]);
  }
  return map;
}

export function resolveFinancialSituation(
  matricula: Pick<Matricula, 'tipoAluno' | 'situacaoFinanceira' | 'estadoFinanceiro'> | undefined | null,
  studentInvoices: InvoiceLite[] | undefined,
  todayISO: string = localISODate()
): SituacaoFinanceira {
  const invoices = studentInvoices || [];
  if (invoices.some((i) => isInvoiceInMora(i, todayISO))) return 'mora';
  if (isMatriculaExempt(matricula)) return 'isento';
  if (invoices.some((i) => i.status === 'pendente')) return 'pendente';
  return 'regular';
}

/** Valor antigo (regular/debito/isento) correspondente a uma situação — compatibilidade. */
export function legacyEstadoFinanceiro(s: SituacaoFinanceira): 'regular' | 'debito' | 'isento' {
  return s === 'mora' ? 'debito' : s === 'isento' ? 'isento' : 'regular';
}

/**
 * Estado inicial de cada fatura criada na matrícula, conforme a situação escolhida:
 *  - regular  → paga;
 *  - pendente → pendente;
 *  - mora     → em atraso se o vencimento já passou, senão pendente;
 *  - isento   → pendente (só se cobram outros serviços, ex.: taxa de matrícula).
 */
export function initialInvoiceStatus(
  situacao: SituacaoFinanceira,
  dueISO: string,
  todayISO: string = localISODate()
): 'pago' | 'pendente' | 'atraso' {
  if (situacao === 'regular') return 'pago';
  if (situacao === 'mora') return dueISO && dueISO < todayISO ? 'atraso' : 'pendente';
  return 'pendente';
}
