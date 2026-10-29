/** Propinas do ano lectivo mês a mês (10 meses, Out → Jul) para o verso "Talão de Propinas". */
import type { TuitionInvoice } from '../types';
import type { FeeCell } from './cardsHtml';
import { FEE_MONTHS } from './cardsHtml';

const TOKENS = ['out', 'nov', 'dez', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul'];
const strip = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function feesFor(invoices: TuitionInvoice[] | undefined, studentId: string, year: string): FeeCell[] {
  const mine = (invoices || []).filter((i) => String(i.studentId) === String(studentId) && (!i.academicYear || !year || i.academicYear === year));
  return FEE_MONTHS.map((m, idx) => {
    const tok = TOKENS[idx];
    const inv = mine.find((i) => strip(i.period).includes(tok));
    const paid = !!inv && (inv.status === 'pago' || inv.status === 'isento');
    const rec = inv ? (inv.status === 'isento' ? 'ISENTO' : String(inv.receiptNumber || inv.invoiceNumber || '').replace(/^\D+/, '').slice(-6)) : '';
    return { m, paid, rec };
  });
}
