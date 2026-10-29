/**
 * Folha de pagamento no fluxo de caixa.
 *
 * O salário líquido PAGO já entra no livro de caixa (financeExtras.buildLedger). Faltava o resto do custo da folha:
 *  - Encargos a entregar ao Estado: INSS (trabalhador + entidade patronal) e IRT retido. Não saem no dia do salário;
 *    saem quando a escola os entrega. Aqui geram-se como CONTAS A PAGAR (despesas por pagar), com prazo, e só entram
 *    no fluxo de caixa quando forem marcadas como pagas, como qualquer despesa.
 *  - Previsão: recibos ainda pendentes (salário líquido por pagar) e encargos por entregar, por mês.
 *
 * Os prazos abaixo são valores de referência de gestão; confirme com o contabilista da escola e ajuste se necessário.
 * Lógica pura e testável.
 */
import type { PayrollRecord, PayrollTaxSettings } from '../types';

export const PAYROLL_CHARGES_CATEGORY = 'Encargos da folha (INSS/IRT)';
/** Dia do mês seguinte até ao qual se entrega o INSS (referência). */
export const INSS_DUE_DAY = 10;
/** O IRT retido entrega-se até ao último dia do mês seguinte (referência). */
export const IRT_DUE_AT_MONTH_END = true;

export type ChargeKind = 'inss' | 'irt';

export interface PayrollChargeDue {
  /** Estável: gerar duas vezes o mesmo mês nunca duplica. */
  id: string;
  kind: ChargeKind;
  /** 1 a 12 */
  month: number;
  year: number;
  amount: number;
  /** Data do custo: último dia do mês de referência. */
  date: string;
  dueDate: string;
  supplier: string;
  description: string;
  /** Nº de recibos (não cancelados) que entram na conta. */
  records: number;
}

const r0 = (n: number) => Math.round(Number.isFinite(n) ? n : 0);
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthEndIso = (year: number, month: number) => `${year}-${pad(month)}-${pad(lastDayOf(year, month))}`;

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function inssDueDate(year: number, month: number): string {
  const n = nextMonth(year, month);
  return `${n.year}-${pad(n.month)}-${pad(INSS_DUE_DAY)}`;
}

export function irtDueDate(year: number, month: number): string {
  const n = nextMonth(year, month);
  return IRT_DUE_AT_MONTH_END ? monthEndIso(n.year, n.month) : `${n.year}-${pad(n.month)}-15`;
}

/** INSS patronal sobre o bruto de um recibo (o do trabalhador já está no recibo). */
export function employerInss(grossKz: number, tax: PayrollTaxSettings): number {
  if (!(grossKz > 0)) return 0;
  return r0(grossKz * (tax.inssEmployerRatePercent / 100));
}

const valid = (r: PayrollRecord) =>
  r.status !== 'cancelado' && Number.isInteger(r.referenceMonth) && r.referenceMonth >= 1 && r.referenceMonth <= 12 && Number.isInteger(r.referenceYear);

/**
 * Encargos por mês de referência: INSS (3% trabalhador + 8% patronal, pelas taxas configuradas) e IRT retido.
 * Recibos cancelados ficam de fora. Meses sem valor a entregar não geram linha.
 */
export function payrollChargesDue(records: PayrollRecord[], tax: PayrollTaxSettings): PayrollChargeDue[] {
  const byMonth = new Map<string, { month: number; year: number; inssEmp: number; inssEr: number; irt: number; n: number }>();
  for (const r of records || []) {
    if (!valid(r)) continue;
    const key = `${r.referenceYear}-${pad(r.referenceMonth)}`;
    const cur = byMonth.get(key) ?? { month: r.referenceMonth, year: r.referenceYear, inssEmp: 0, inssEr: 0, irt: 0, n: 0 };
    cur.inssEmp += Math.max(0, r0(r.inssEmployeeKz));
    cur.inssEr += employerInss(r.grossSalaryKz, tax);
    cur.irt += Math.max(0, r0(r.irtKz));
    cur.n += 1;
    byMonth.set(key, cur);
  }
  const out: PayrollChargeDue[] = [];
  for (const key of [...byMonth.keys()].sort()) {
    const m = byMonth.get(key)!;
    const label = `${pad(m.month)}/${m.year}`;
    const inss = m.inssEmp + m.inssEr;
    if (inss > 0) {
      out.push({
        id: `enc-inss-${key}`, kind: 'inss', month: m.month, year: m.year, amount: inss,
        date: monthEndIso(m.year, m.month), dueDate: inssDueDate(m.year, m.month), supplier: 'INSS',
        description: `INSS da folha ${label} (trabalhador ${m.inssEmp} + patronal ${m.inssEr} Kz)`, records: m.n
      });
    }
    if (m.irt > 0) {
      out.push({
        id: `enc-irt-${key}`, kind: 'irt', month: m.month, year: m.year, amount: m.irt,
        date: monthEndIso(m.year, m.month), dueDate: irtDueDate(m.year, m.month), supplier: 'AGT',
        description: `IRT retido na folha ${label}`, records: m.n
      });
    }
  }
  return out;
}

export interface ExistingChargeExpense { id: string; amount: number; paidDate?: string }

export interface ChargeSyncPlan {
  create: PayrollChargeDue[];
  /** Por pagar e com valor diferente (a folha mudou): actualiza-se o valor. */
  update: PayrollChargeDue[];
  /** Já pagas: nunca se alteram (se o valor da folha mudou depois, fica para ajuste manual). */
  paidMismatch: PayrollChargeDue[];
  unchanged: number;
}

/** Compara os encargos devidos com as despesas já geradas (pelo id estável). Não duplica e não mexe no que já foi pago. */
export function planChargeSync(due: PayrollChargeDue[], existing: ExistingChargeExpense[]): ChargeSyncPlan {
  const byId = new Map((existing || []).map((e) => [e.id, e]));
  const plan: ChargeSyncPlan = { create: [], update: [], paidMismatch: [], unchanged: 0 };
  for (const d of due) {
    const e = byId.get(d.id);
    if (!e) plan.create.push(d);
    else if (e.amount === d.amount) plan.unchanged += 1;
    else if (e.paidDate) plan.paidMismatch.push(d);
    else plan.update.push(d);
  }
  return plan;
}

export interface PayrollForecastMonth {
  month: string; // AAAA-MM
  /** Salário líquido dos recibos ainda pendentes, por mês de referência. */
  pendingNet: number;
  pendingCount: number;
  /** Encargos (INSS+IRT) do mês de referência que vencem no mês seguinte e ainda não foram pagos. */
  chargesDue: number;
}

/**
 * Previsão de saídas da folha por mês de referência: salários pendentes + encargos ainda por pagar.
 * `paidChargeIds` são os ids de encargos já pagos (despesas com data de pagamento).
 */
export function payrollForecast(records: PayrollRecord[], tax: PayrollTaxSettings, paidChargeIds: Iterable<string> = []): PayrollForecastMonth[] {
  const paid = new Set(paidChargeIds);
  const by = new Map<string, PayrollForecastMonth>();
  const get = (k: string) => { const c = by.get(k) ?? { month: k, pendingNet: 0, pendingCount: 0, chargesDue: 0 }; by.set(k, c); return c; };
  for (const r of records || []) {
    if (!valid(r) || r.status !== 'pendente') continue;
    const c = get(`${r.referenceYear}-${pad(r.referenceMonth)}`);
    c.pendingNet += Math.max(0, r0(r.netSalaryKz));
    c.pendingCount += 1;
  }
  for (const d of payrollChargesDue(records, tax)) {
    if (paid.has(d.id)) continue;
    get(`${d.year}-${pad(d.month)}`).chargesDue += d.amount;
  }
  return [...by.values()].filter((m) => m.pendingNet > 0 || m.chargesDue > 0).sort((a, b) => a.month.localeCompare(b.month));
}
