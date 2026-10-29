import {
  Funcionario,
  IrtBracket,
  PayrollRecord,
  PayrollTaxSettings,
  RhPersonType,
  SchoolDatabase,
  Teacher
} from '../types';

/**
 * Cálculo da Folha de Pagamento (INSS + IRT — Grupo A, trabalho dependente).
 *
 * IMPORTANTE: a tabela de IRT por omissão abaixo é apenas uma REFERÊNCIA DE GESTÃO,
 * construída a partir da subida do limite de isenção para 150.000 Kz anunciada para
 * 2026. Não substitui a tabela oficial da Administração Geral Tributária (AGT) — a
 * instituição deve confirmar e, se necessário, ajustar os escalões em
 * Configurações > Financeiro > Folha de Pagamento antes de usar os valores para fins
 * fiscais. O INSS está fixado por lei em 3% (trabalhador) + 8% (entidade patronal).
 */
export const DEFAULT_PAYROLL_TAX_SETTINGS: PayrollTaxSettings = {
  inssEmployeeRatePercent: 3,
  inssEmployerRatePercent: 8,
  irtExemptionThresholdKz: 150000,
  irtBrackets: [
    { uptoKz: 200000, ratePercent: 16 },
    { uptoKz: 300000, ratePercent: 18 },
    { uptoKz: 500000, ratePercent: 19 },
    { uptoKz: 1000000, ratePercent: 20 },
    { uptoKz: 1500000, ratePercent: 21 },
    { uptoKz: 2000000, ratePercent: 22 },
    { uptoKz: 2500000, ratePercent: 23 },
    { uptoKz: 5000000, ratePercent: 24 },
    { uptoKz: null, ratePercent: 25 }
  ]
};

export function getEffectivePayrollTaxSettings(db: SchoolDatabase): PayrollTaxSettings {
  const stored = db.settings?.payrollTaxSettings;
  if (!stored || !Array.isArray(stored.irtBrackets) || stored.irtBrackets.length === 0) {
    return DEFAULT_PAYROLL_TAX_SETTINGS;
  }
  return stored;
}

export function calcInss(grossKz: number, tax: PayrollTaxSettings): number {
  if (grossKz <= 0) return 0;
  return Math.round(grossKz * (tax.inssEmployeeRatePercent / 100));
}

/** IRT marginal: cada escalão só é tributado na parte do rendimento que lhe cabe. */
export function calcIrt(taxableBaseKz: number, tax: PayrollTaxSettings): number {
  if (taxableBaseKz <= tax.irtExemptionThresholdKz) return 0;

  let remaining = taxableBaseKz - tax.irtExemptionThresholdKz;
  let lowerBound = tax.irtExemptionThresholdKz;
  let totalTax = 0;

  const brackets: IrtBracket[] = tax.irtBrackets;
  for (const bracket of brackets) {
    const bracketCeiling = bracket.uptoKz == null ? Infinity : bracket.uptoKz;
    const bracketSpan = Math.max(0, bracketCeiling - lowerBound);
    const taxableInBracket = Math.min(remaining, bracketSpan);
    if (taxableInBracket > 0) {
      totalTax += taxableInBracket * (bracket.ratePercent / 100);
      remaining -= taxableInBracket;
    }
    lowerBound = bracketCeiling;
    if (remaining <= 0) break;
  }

  return Math.round(totalTax);
}

export interface PayrollComputationInput {
  baseSalaryKz: number;
  allowancesKz: number;
  bonusKz: number;
  otherDeductionsKz: number;
}

export interface PayrollComputationResult {
  grossSalaryKz: number;
  inssEmployeeKz: number;
  irtKz: number;
  netSalaryKz: number;
}

/** INSS incide sobre base + subsídios; o bónus (ex.: prémios pontuais) entra na base do IRT
 * mas, seguindo a prática comum, também é considerado matéria colectável de INSS. */
export function computePayroll(input: PayrollComputationInput, tax: PayrollTaxSettings): PayrollComputationResult {
  const grossSalaryKz = Math.max(0, input.baseSalaryKz + input.allowancesKz + input.bonusKz);
  const inssEmployeeKz = calcInss(grossSalaryKz, tax);
  const irtTaxableBase = Math.max(0, grossSalaryKz - inssEmployeeKz);
  const irtKz = calcIrt(irtTaxableBase, tax);
  const netSalaryKz = Math.max(0, grossSalaryKz - inssEmployeeKz - irtKz - Math.max(0, input.otherDeductionsKz));
  return { grossSalaryKz, inssEmployeeKz, irtKz, netSalaryKz };
}

export const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export function monthLabel(month: number): string {
  return MONTH_LABELS[month - 1] || String(month);
}

export const PAYROLL_STATUS_META: Record<PayrollRecord['status'], { label: string; badge: string }> = {
  pendente: { label: 'Pendente', badge: 'bg-amber-100 text-amber-800' },
  pago: { label: 'Pago', badge: 'bg-emerald-100 text-emerald-800' },
  cancelado: { label: 'Cancelado', badge: 'bg-slate-200 text-slate-600' }
};

/** Pessoas elegíveis para a Folha de Pagamento: professores e funcionários ativos. */
export interface PayrollEligiblePerson {
  id: string;
  type: RhPersonType;
  name: string;
  role: string;
  department?: string;
  baseSalaryKz: number;
  allowancesKz: number;
  allowanceDescription?: string;
  retentionTaxKz?: number;
  bankName?: string;
  iban?: string;
  status: string;
}

export function listEligiblePeople(db: SchoolDatabase): PayrollEligiblePerson[] {
  const teachers: PayrollEligiblePerson[] = (db.teachers || [])
    .map((t: Teacher) => ({
      id: t.id,
      type: 'professor',
      name: t.name,
      role: t.category || 'Professor',
      department: t.department,
      baseSalaryKz: t.baseSalaryKz || 0,
      allowancesKz: t.allowancesKz || 0,
      allowanceDescription: t.allowanceDescription,
      retentionTaxKz: t.retentionTaxKz,
      bankName: t.bankName,
      iban: t.iban,
      status: t.status
    }));

  const funcionarios: PayrollEligiblePerson[] = (db.funcionarios || []).map((f: Funcionario) => ({
    id: f.id,
    type: 'funcionario',
    name: f.name,
    role: f.cargo === 'outro' ? (f.cargoOutroDescricao || 'Funcionário') : f.cargo,
    department: f.department,
    baseSalaryKz: f.baseSalaryKz || 0,
    allowancesKz: f.allowancesKz || 0,
    allowanceDescription: f.allowanceDescription,
    retentionTaxKz: f.retentionTaxKz,
    bankName: f.bankName,
    iban: f.iban,
    status: f.status
  }));

  return [...teachers, ...funcionarios].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}

export function findPayrollRecord(
  records: PayrollRecord[],
  personId: string,
  month: number,
  year: number
): PayrollRecord | undefined {
  return records.find((r) => r.personId === personId && r.referenceMonth === month && r.referenceYear === year);
}

/** Totais de um mês/ano: útil para o painel-resumo da Folha de Pagamento. */
export function summarizePayrollMonth(records: PayrollRecord[], month: number, year: number) {
  const monthRecords = records.filter((r) => r.referenceMonth === month && r.referenceYear === year);
  const totalGross = monthRecords.reduce((sum, r) => sum + r.grossSalaryKz, 0);
  const totalInss = monthRecords.reduce((sum, r) => sum + r.inssEmployeeKz, 0);
  const totalIrt = monthRecords.reduce((sum, r) => sum + r.irtKz, 0);
  const totalNet = monthRecords.reduce((sum, r) => sum + r.netSalaryKz, 0);
  const paidCount = monthRecords.filter((r) => r.status === 'pago').length;
  const pendingCount = monthRecords.filter((r) => r.status === 'pendente').length;
  return { count: monthRecords.length, totalGross, totalInss, totalIrt, totalNet, paidCount, pendingCount, records: monthRecords };
}

export function payrollRecordsToCsv(records: PayrollRecord[]): string {
  const header = [
    'Nome', 'Tipo', 'Cargo', 'Mês', 'Ano', 'Salário Base (Kz)', 'Subsídios (Kz)', 'Bónus (Kz)',
    'Salário Bruto (Kz)', 'INSS (Kz)', 'IRT (Kz)', 'Outros Descontos (Kz)', 'Salário Líquido (Kz)', 'Estado', 'Data de Pagamento'
  ];
  const rows = records.map((r) => [
    r.personName,
    r.personType === 'professor' ? 'Professor' : 'Funcionário',
    r.personRole,
    monthLabel(r.referenceMonth),
    String(r.referenceYear),
    String(r.baseSalaryKz),
    String(r.allowancesKz),
    String(r.bonusKz),
    String(r.grossSalaryKz),
    String(r.inssEmployeeKz),
    String(r.irtKz),
    String(r.otherDeductionsKz),
    String(r.netSalaryKz),
    PAYROLL_STATUS_META[r.status]?.label || r.status,
    r.paymentDate || ''
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map((c) => escape(String(c))).join(';')).join('\n');
}

export function formatKz(value?: number | null): string {
  const v = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  return `${v.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Kz`;
}
