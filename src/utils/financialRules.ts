import { InstitutionSettings, Student } from '../types';

// Regras financeiras com valores por omissão — usados sempre que a instituição
// ainda não gravou explicitamente as suas próprias Configurações Financeiras.
export interface ResolvedFinancialRules {
  paymentDueDay: number;
  lateFeePercent: number;
  discountPercent: number; // desconto por pagamento antecipado
  siblingDiscountPercent: number;
  graceDays: number;
  allowPartialPayments: boolean;
  blockExamsWithDebt: boolean;
  blockCertificatesWithDebt: boolean;
}

const DEFAULT_RULES: ResolvedFinancialRules = {
  paymentDueDay: 10,
  lateFeePercent: 10,
  discountPercent: 5,
  siblingDiscountPercent: 10,
  graceDays: 3,
  allowPartialPayments: true,
  blockExamsWithDebt: false,
  blockCertificatesWithDebt: true
};

// Dia-limite (fixo) até ao qual um pagamento é considerado "antecipado" para efeitos
// do Desconto por Pagamento Antecipado — corresponde à política descrita no próprio
// ecrã de Configurações: "Desconto concedido se a liquidação ocorrer até ao dia 05
// de cada mês."
export const EARLY_PAYMENT_CUTOFF_DAY = 5;

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

export function getFinancialRules(settings?: InstitutionSettings | null): ResolvedFinancialRules {
  const raw = (settings?.financialRules || {}) as Partial<ResolvedFinancialRules>;
  return {
    paymentDueDay: raw.paymentDueDay ?? DEFAULT_RULES.paymentDueDay,
    lateFeePercent: raw.lateFeePercent ?? DEFAULT_RULES.lateFeePercent,
    discountPercent: raw.discountPercent ?? DEFAULT_RULES.discountPercent,
    siblingDiscountPercent: raw.siblingDiscountPercent ?? DEFAULT_RULES.siblingDiscountPercent,
    graceDays: raw.graceDays ?? DEFAULT_RULES.graceDays,
    allowPartialPayments: raw.allowPartialPayments ?? DEFAULT_RULES.allowPartialPayments,
    blockExamsWithDebt: raw.blockExamsWithDebt ?? DEFAULT_RULES.blockExamsWithDebt,
    blockCertificatesWithDebt: raw.blockCertificatesWithDebt ?? DEFAULT_RULES.blockCertificatesWithDebt
  };
}

function monthIndexFromName(monthName: string): number {
  const normalized = monthName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const idx = MONTHS_PT.findIndex((m) =>
    m.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized
  );
  return idx >= 0 ? idx : new Date().getMonth();
}

// Data de vencimento oficial de uma mensalidade: o "Dia Limite sem Multa"
// configurado, no mês/ano da própria mensalidade.
export function getTuitionDueDate(monthName: string, referenceDate: Date, paymentDueDay: number): Date {
  const monthIdx = monthIndexFromName(monthName);
  let year = referenceDate.getFullYear();
  // Se o mês da propina está bastante à frente do mês do pagamento, assume-se que
  // pertence ao ano lectivo anterior (ex.: a liquidar em Janeiro uma propina de
  // Dezembro transacto).
  if (monthIdx - referenceDate.getMonth() > 6) {
    year -= 1;
  }
  return new Date(year, monthIdx, paymentDueDay);
}

export interface MonthLateInfo {
  month: string;
  isLate: boolean;
  daysLate: number;
}

// Calcula, para cada mês selecionado, se o pagamento (na data indicada) incorre em
// multa por mora — aplicando o "Dia Limite sem Multa" e os "Dias de Carência /
// Tolerância" configurados em Configurações > Tabela Financeira.
export function evaluateMonthsLateStatus(
  months: string[],
  paymentDate: Date,
  rules: ResolvedFinancialRules
): MonthLateInfo[] {
  return months.map((month) => {
    const dueDate = getTuitionDueDate(month, paymentDate, rules.paymentDueDay);
    const toleratedUntil = new Date(dueDate);
    toleratedUntil.setDate(toleratedUntil.getDate() + Math.max(0, rules.graceDays));
    const msLate = paymentDate.getTime() - toleratedUntil.getTime();
    const daysLate = msLate > 0 ? Math.ceil(msLate / (1000 * 60 * 60 * 24)) : 0;
    return { month, isLate: daysLate > 0, daysLate };
  });
}

// Número de irmãos (outros alunos ativos com o mesmo Encarregado de Educação) já
// matriculados — usado para aplicar o Desconto por Agregado Familiar a partir do
// 2.º educando.
export function countEnrolledSiblings(students: Student[], student: Student): number {
  const guardianKey = (s: Student) =>
    (s.guardianNif && s.guardianNif.trim()) ||
    `${(s.guardianName || '').trim().toLowerCase()}|${(s.guardianPhone || '').trim()}`;

  const key = guardianKey(student);
  if (!key || key === '|') return 0;

  return students.filter(
    (s) => String(s.id) !== String(student.id) && guardianKey(s) === key
  ).length;
}

export interface TuitionChargeBreakdown {
  baseAmountKz: number;
  lateFeeKz: number;
  earlyDiscountKz: number;
  siblingDiscountKz: number;
  totalDiscountKz: number;
  totalAmountKz: number;
  isLate: boolean;
  isEarly: boolean;
  maxDaysLate: number;
  hasSiblingDiscount: boolean;
  notes: string[];
}

// Aplica, de uma só vez, todas as Políticas de Prazos & Multas configuradas
// (multa por mora, desconto por pagamento antecipado e desconto por agregado
// familiar) sobre o valor bruto das propinas de um pagamento.
export function computeTuitionCharges(params: {
  months: string[];
  monthlyTuitionKz: number;
  paymentDate: Date;
  rules: ResolvedFinancialRules;
  siblingCount: number;
}): TuitionChargeBreakdown {
  const { months, monthlyTuitionKz, paymentDate, rules, siblingCount } = params;
  const baseAmountKz = monthlyTuitionKz * months.length;

  const notes: string[] = [];

  if (baseAmountKz <= 0 || months.length === 0) {
    return {
      baseAmountKz: 0,
      lateFeeKz: 0,
      earlyDiscountKz: 0,
      siblingDiscountKz: 0,
      totalDiscountKz: 0,
      totalAmountKz: 0,
      isLate: false,
      isEarly: false,
      maxDaysLate: 0,
      hasSiblingDiscount: false,
      notes
    };
  }

  const monthsStatus = evaluateMonthsLateStatus(months, paymentDate, rules);
  const lateMonths = monthsStatus.filter((m) => m.isLate);
  const isLate = lateMonths.length > 0;
  const maxDaysLate = monthsStatus.reduce((max, m) => Math.max(max, m.daysLate), 0);

  const lateFeeKz = isLate
    ? Math.round((monthlyTuitionKz * lateMonths.length * rules.lateFeePercent) / 100)
    : 0;

  if (isLate) {
    notes.push(
      `Multa de mora de ${rules.lateFeePercent}% aplicada (${lateMonths.length} mensalidade(s) com até ${maxDaysLate} dia(s) de atraso após o limite do dia ${rules.paymentDueDay} + ${rules.graceDays} dia(s) de carência).`
    );
  }

  // Desconto por pagamento antecipado — só faz sentido se não houver nenhuma
  // mensalidade em atraso.
  const isEarly = !isLate && paymentDate.getDate() <= EARLY_PAYMENT_CUTOFF_DAY;
  const earlyDiscountKz = isEarly ? Math.round((baseAmountKz * rules.discountPercent) / 100) : 0;
  if (isEarly && earlyDiscountKz > 0) {
    notes.push(`Desconto de ${rules.discountPercent}% por pagamento antecipado (até ao dia ${EARLY_PAYMENT_CUTOFF_DAY}).`);
  }

  // Desconto por agregado familiar — a partir do 2.º educando matriculado.
  const hasSiblingDiscount = siblingCount >= 1 && rules.siblingDiscountPercent > 0;
  const siblingDiscountKz = hasSiblingDiscount
    ? Math.round((baseAmountKz * rules.siblingDiscountPercent) / 100)
    : 0;
  if (hasSiblingDiscount) {
    notes.push(`Desconto de ${rules.siblingDiscountPercent}% por agregado familiar (${siblingCount} irmão(s) já matriculado(s)).`);
  }

  const totalDiscountKz = earlyDiscountKz + siblingDiscountKz;
  const totalAmountKz = Math.max(0, baseAmountKz - totalDiscountKz + lateFeeKz);

  return {
    baseAmountKz,
    lateFeeKz,
    earlyDiscountKz,
    siblingDiscountKz,
    totalDiscountKz,
    totalAmountKz,
    isLate,
    isEarly,
    maxDaysLate,
    hasSiblingDiscount,
    notes
  };
}
