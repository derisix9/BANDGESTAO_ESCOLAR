/**
 * Meses de propina já liquidados por um aluno, a partir das faturas/recibos emitidos.
 * Só conta faturas totalmente pagas ('pago') que incluam propinas; pagamentos parciais ('pendente') não contam.
 */
import type { TuitionInvoice } from '../types';

export const TUITION_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const monthsIn = (text: string): string[] => {
  const t = strip(text);
  return TUITION_MONTHS.filter((m) => new RegExp(`\\b${strip(m)}\\b`).test(t));
};

const hasTuition = (inv: TuitionInvoice): boolean =>
  (inv.items || []).some((i) => i.code === 'PROP-ESC' || /propina/i.test(i.description || '')) ||
  (!inv.items?.length && /propina/i.test(inv.description || ''));

export function getPaidTuitionMonths(invoices: TuitionInvoice[] | undefined, studentId: string | number, academicYear?: string): Set<string> {
  const paid = new Set<string>();
  if (!studentId) return paid;
  for (const inv of invoices || []) {
    if (String(inv.studentId) !== String(studentId) || inv.status !== 'pago' || !hasTuition(inv)) continue;
    if (academicYear && inv.academicYear && inv.academicYear !== academicYear) continue;
    const tuitionItem = (inv.items || []).find((i) => i.code === 'PROP-ESC');
    const months = tuitionItem
      ? monthsIn(`${tuitionItem.description || ''} ${tuitionItem.periodOrRef || ''}`)
      : inv.selectedMonths?.length ? inv.selectedMonths : monthsIn(`${inv.period || ''} ${inv.description || ''}`);
    for (const m of months) paid.add(m);
  }
  return paid;
}
