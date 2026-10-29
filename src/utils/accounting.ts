/**
 * Contabilidade por partidas dobradas: plano de contas, lançamentos, balancete de verificação, balanço,
 * amortizações e fecho do ano. Função pura, sem React nem base de dados.
 *
 * Os lançamentos automáticos nascem do que o sistema já mantém (propinas, despesas, salários, activos):
 *  - regime de CAIXA (por omissão): só valores já recebidos ou pagos;
 *  - regime de ACRÉSCIMO: propinas vencidas e por receber (31 Clientes), despesas e salários por pagar
 *    (32 Fornecedores, 36 Pessoal), reconhecidos quando ocorrem e não quando se paga.
 * Os lançamentos manuais (JournalEntry) completam-nos (capital, saldos de abertura, correcções, fecho do ano).
 *
 * PLANO DE CONTAS: versão SIMPLIFICADA do Plano Geral de Contabilidade angolano (Decreto n.º 82/01).
 * Cada conta traz `verified`: true quando o código e a designação foram conferidos com o texto do PGC;
 * false quando ainda precisam de confirmação pelo contabilista da escola. Estão todos em CHART.
 */
import type { JournalEntry, JournalLine } from '../types';
import {
  ASSET_INVESTMENT_CATEGORY, PAYROLL_CATEGORY, buildLedger, channelOf, toISODate,
  type Expense, type LedgerEntry, type LedgerAsset, type LedgerPayroll, type PaymentChannel
} from './financeExtras';

export type AccountKind = 'ativo' | 'passivo' | 'capital' | 'proveito' | 'custo';

export interface Account {
  code: string;
  name: string;
  kind: AccountKind;
  /** Lado em que a conta normalmente aumenta. */
  nature: 'devedora' | 'credora';
  /** Conferida com o texto do PGC angolano (Decreto n.º 82/01)? */
  verified: boolean;
}

/** Versão do plano de contas. Lançamentos manuais sem `chartVersion` usam os códigos da versão 1 (ver LEGACY_CODE_MAP). */
export const CHART_VERSION = 2;

export const CHART: Account[] = [
  { code: '11', name: 'Imobilizações corpóreas', kind: 'ativo', nature: 'devedora', verified: true },
  { code: '18', name: 'Amortizações acumuladas', kind: 'ativo', nature: 'credora', verified: true },
  { code: '31', name: 'Clientes (propinas a receber)', kind: 'ativo', nature: 'devedora', verified: true },
  { code: '43', name: 'Depósitos à ordem (bancos, Multicaixa, TPA)', kind: 'ativo', nature: 'devedora', verified: true },
  { code: '45', name: 'Caixa', kind: 'ativo', nature: 'devedora', verified: true },
  { code: '32', name: 'Fornecedores', kind: 'passivo', nature: 'credora', verified: true },
  { code: '36', name: 'Pessoal (salários a pagar)', kind: 'passivo', nature: 'credora', verified: true },
  { code: '51', name: 'Capital', kind: 'capital', nature: 'credora', verified: false },
  { code: '81', name: 'Resultados transitados', kind: 'capital', nature: 'credora', verified: true },
  { code: '88', name: 'Resultado líquido do exercício', kind: 'capital', nature: 'credora', verified: false },
  { code: '62', name: 'Prestações de serviços (propinas e serviços escolares)', kind: 'proveito', nature: 'credora', verified: true },
  { code: '72', name: 'Custos com o pessoal', kind: 'custo', nature: 'devedora', verified: true },
  { code: '73', name: 'Amortizações do exercício', kind: 'custo', nature: 'devedora', verified: true },
  { code: '75.2', name: 'Fornecimentos e serviços de terceiros', kind: 'custo', nature: 'devedora', verified: true }
];

export const KIND_LABELS: Record<AccountKind, string> = {
  ativo: 'Activo', passivo: 'Passivo', capital: 'Capital próprio', proveito: 'Proveitos', custo: 'Custos'
};

/** Códigos da versão 1 do plano (de memória, errados face ao PGC) → códigos actuais. Aplicado de uma só vez, sem encadear. */
export const LEGACY_CODE_MAP: Record<string, string> = { '41': '45', '42': '43', '61': '62', '71': '72', '72': '75.2' };

export const accountByCode = (code: string): Account | undefined => CHART.find((a) => a.code === code);

/** Linhas de um lançamento manual já com os códigos actuais (os gravados sem `chartVersion` são da versão 1). */
export const linesInCurrentChart = (lines: JournalLine[], chartVersion?: number): JournalLine[] =>
  (chartVersion ?? 1) >= CHART_VERSION ? lines : lines.map((l) => ({ ...l, account: LEGACY_CODE_MAP[l.account] ?? l.account }));

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Posting {
  id: string;
  date: string;
  description: string;
  reference?: string;
  lines: JournalLine[];
  source: 'auto' | 'manual' | 'amortizacao' | 'fecho';
  /** Lançamento de apuramento do resultado: fica fora do balancete do período, mas conta no balanço. */
  closing?: boolean;
}

const cashAccountOf = (ch: PaymentChannel | string) => (ch === 'numerario' ? '45' : '43');

/** Lançamentos gerados a partir do livro de caixa (regime de caixa). */
export function postingsFromLedger(ledger: LedgerEntry[]): Posting[] {
  const out: Posting[] = [];
  for (const e of ledger) {
    const amount = r2(Number(e.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const cash = cashAccountOf(e.channel);
    let lines: JournalLine[];
    if (e.kind === 'entrada') {
      lines = [{ account: cash, debit: amount, credit: 0 }, { account: '62', debit: 0, credit: amount }];
    } else if (e.category === PAYROLL_CATEGORY) {
      lines = [{ account: '72', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }];
    } else if (e.category === ASSET_INVESTMENT_CATEGORY) {
      lines = [{ account: '11', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }];
    } else {
      lines = [{ account: '75.2', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }];
    }
    out.push({ id: e.id, date: e.date, description: e.description, reference: e.reference, lines, source: 'auto' });
  }
  return out;
}

export const postingsFromManual = (entries: JournalEntry[]): Posting[] =>
  entries.map((j) => ({
    id: j.id, date: j.date, description: j.description, reference: j.reference,
    lines: linesInCurrentChart(j.lines, j.chartVersion),
    source: j.closingYear ? ('fecho' as const) : ('manual' as const),
    closing: !!j.closingYear
  }));

/** Valida um lançamento manual: devolve mensagens de erro (vazio = válido). */
export function validateJournal(date: string, description: string, lines: JournalLine[]): string[] {
  const errs: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) errs.push('Indique a data do lançamento.');
  if (!description?.trim()) errs.push('Indique a descrição.');
  const used = lines.filter((l) => l.account || l.debit || l.credit);
  if (used.length < 2) errs.push('Um lançamento precisa de pelo menos duas linhas.');
  let d = 0, c = 0;
  for (const l of used) {
    if (!accountByCode(l.account)) { errs.push(`Conta inválida: "${l.account || '—'}".`); continue; }
    const hasD = l.debit > 0, hasC = l.credit > 0;
    if (hasD === hasC) errs.push(`A conta ${l.account} deve ter débito OU crédito (não os dois, nem nenhum).`);
    if (l.debit < 0 || l.credit < 0) errs.push('Os valores não podem ser negativos.');
    d += l.debit || 0; c += l.credit || 0;
  }
  if (used.length >= 2 && Math.abs(d - c) > 0.005) errs.push(`O lançamento não está equilibrado: débito ${r2(d)} ≠ crédito ${r2(c)}.`);
  if (d <= 0) errs.push('O valor do lançamento tem de ser maior que zero.');
  return errs;
}

export interface TrialRow {
  account: Account;
  debit: number;
  credit: number;
  /** Saldo devedor / credor (só um deles é > 0). */
  balanceDebit: number;
  balanceCredit: number;
}

export interface TrialBalance {
  rows: TrialRow[];
  totalDebit: number;
  totalCredit: number;
  totalBalanceDebit: number;
  totalBalanceCredit: number;
  /** Total de débitos = total de créditos. */
  balanced: boolean;
  proveitos: number;
  custos: number;
  /** proveitos − custos */
  resultado: number;
}

export interface PeriodRange { from?: string; to?: string }

/**
 * Balancete de verificação: movimentos e saldos de cada conta no período (datas AAAA-MM-DD, inclusivas).
 * Os lançamentos de fecho do ano ficam de fora (senão os proveitos e custos do ano fechado apareceriam a zero),
 * a não ser que se peça `includeClosing`.
 */
export function computeTrialBalance(postings: Posting[], range: PeriodRange = {}, opts: { includeClosing?: boolean } = {}): TrialBalance {
  const acc = new Map<string, { d: number; c: number }>();
  for (const p of postings) {
    if (p.closing && !opts.includeClosing) continue;
    if (range.from && p.date < range.from) continue;
    if (range.to && p.date > range.to) continue;
    for (const l of p.lines) {
      const cur = acc.get(l.account) || { d: 0, c: 0 };
      cur.d += l.debit || 0; cur.c += l.credit || 0;
      acc.set(l.account, cur);
    }
  }
  const rows: TrialRow[] = CHART.filter((a) => acc.has(a.code)).map((a) => {
    const v = acc.get(a.code)!;
    const debit = r2(v.d), credit = r2(v.c), diff = r2(debit - credit);
    return { account: a, debit, credit, balanceDebit: diff > 0 ? diff : 0, balanceCredit: diff < 0 ? -diff : 0 };
  });
  const sum = (f: (r: TrialRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  const totalDebit = sum((r) => r.debit), totalCredit = sum((r) => r.credit);
  const proveitos = r2(rows.filter((r) => r.account.kind === 'proveito').reduce((s, r) => s + r.credit - r.debit, 0));
  const custos = r2(rows.filter((r) => r.account.kind === 'custo').reduce((s, r) => s + r.debit - r.credit, 0));
  return {
    rows, totalDebit, totalCredit,
    totalBalanceDebit: sum((r) => r.balanceDebit), totalBalanceCredit: sum((r) => r.balanceCredit),
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    proveitos, custos, resultado: r2(proveitos - custos)
  };
}

// ---------------------------------------------------------------------------
// Regime de ACRÉSCIMO: propinas por receber, despesas e salários por pagar
// ---------------------------------------------------------------------------

export type AccountingBasis = 'caixa' | 'acrescimo';

export interface AccountingOptions {
  basis: AccountingBasis;
  /** Calcular amortizações mensais dos activos (D 73 / C 18). */
  depreciation: boolean;
  /** Vida útil (anos) por categoria de activo; o que faltar usa DEFAULT_USEFUL_LIFE_YEARS. */
  usefulLifeYears?: Record<string, number>;
}

export const DEFAULT_ACCOUNTING_OPTIONS: AccountingOptions = { basis: 'caixa', depreciation: false };

/**
 * Vida útil por omissão, em anos (método das quotas constantes). São ESTIMATIVAS de gestão, não taxas oficiais:
 * a escola ajusta-as (Contabilidade → Opções) conforme o contabilista indicar.
 */
export const DEFAULT_USEFUL_LIFE_YEARS: Record<string, number> = {
  mobiliario: 8, informatica: 3, eletrodomesticos: 6, equipamento_didatico: 5,
  equipamento_desportivo: 5, equipamento_laboratorial: 8, outro: 5
};

export function resolveAccountingOptions(stored?: Partial<AccountingOptions> | null): AccountingOptions {
  const lives: Record<string, number> = {};
  for (const [k, v] of Object.entries(stored?.usefulLifeYears || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= 50) lives[k] = Math.round(n);
  }
  return {
    basis: stored?.basis === 'acrescimo' ? 'acrescimo' : 'caixa',
    depreciation: !!stored?.depreciation,
    usefulLifeYears: lives
  };
}

export interface AccrualInvoice {
  id: string; status: string; dueDate?: string; paymentDate?: string; totalPaidKz?: number; totalAmountKz: number;
  studentName?: string; description?: string; period?: string; method?: string;
  receiptNumber?: string; invoiceNumber?: string;
}

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthEndIso = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-${String(lastDayOf(year, month)).padStart(2, '0')}`;

/** Propinas: o proveito nasce no vencimento (D 31 / C 62); o recebimento limpa o cliente (D caixa-banco / C 31). */
export function accrualPostingsFromInvoices(invoices: AccrualInvoice[], today: string): Posting[] {
  const out: Posting[] = [];
  for (const i of invoices) {
    if (i.status === 'isento') continue;
    const paid = i.status === 'pago';
    const payDate = toISODate(i.paymentDate);
    const due = toISODate(i.dueDate);
    const amount = r2(Number(paid ? (i.totalPaidKz ?? i.totalAmountKz) : i.totalAmountKz));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (paid && !payDate) continue;
    const recognised = paid ? (due && due < payDate ? due : payDate) : due;
    if (!recognised || recognised > today) continue;
    const label = [i.description, i.period].filter(Boolean).join(' · ') || 'Fatura de propina';
    const ref = i.receiptNumber || i.invoiceNumber;
    out.push({
      id: `inv:${i.id}:fat`, date: recognised, description: `${label}${i.studentName ? ` — ${i.studentName}` : ''}`, reference: ref,
      lines: [{ account: '31', debit: amount, credit: 0 }, { account: '62', debit: 0, credit: amount }], source: 'auto'
    });
    if (paid) {
      out.push({
        id: `inv:${i.id}:rec`, date: payDate, description: `Recebimento: ${label}${i.studentName ? ` — ${i.studentName}` : ''}`, reference: ref,
        lines: [{ account: cashAccountOf(channelOf(i.method)), debit: amount, credit: 0 }, { account: '31', debit: 0, credit: amount }], source: 'auto'
      });
    }
  }
  return out;
}

/** Despesas: o custo nasce na data da despesa (D 75.2 / C 32); o pagamento limpa o fornecedor (D 32 / C 45). */
export function accrualPostingsFromExpenses(expenses: Expense[], today: string): Posting[] {
  const out: Posting[] = [];
  for (const e of expenses) {
    const amount = r2(Number(e.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const date = toISODate(e.date) || toISODate(e.paidDate);
    if (!date || date > today) continue;
    const label = `${e.category || 'Despesa'}${e.description ? ` · ${e.description}` : ''}${e.supplier ? ` — ${e.supplier}` : ''}`;
    out.push({ id: `exp:${e.id}:cus`, date, description: label, reference: e.id, lines: [{ account: '75.2', debit: amount, credit: 0 }, { account: '32', debit: 0, credit: amount }], source: 'auto' });
    const paidOn = toISODate(e.paidDate);
    if (paidOn) {
      out.push({ id: `exp:${e.id}:pag`, date: paidOn, description: `Pagamento: ${label}`, reference: e.id, lines: [{ account: '32', debit: amount, credit: 0 }, { account: '45', debit: 0, credit: amount }], source: 'auto' });
    }
  }
  return out;
}

/**
 * Salários (a líquido): o custo nasce no fim do mês de referência (D 72 / C 36); o pagamento limpa o pessoal.
 * ATENÇÃO: INSS patronal e retenções (IRT, INSS do trabalhador) não são separados — ver nota no ecrã.
 */
export function accrualPostingsFromPayroll(payroll: LedgerPayroll[], today: string): Posting[] {
  const out: Posting[] = [];
  for (const r of payroll) {
    if (r.status === 'cancelado') continue;
    const amount = r2(Number(r.netSalaryKz));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const mm = r.referenceMonth && r.referenceYear ? monthEndIso(r.referenceYear, r.referenceMonth) : '';
    const paidOn = r.status === 'pago' ? toISODate(r.paymentDate) : '';
    const date = mm && paidOn ? (mm < paidOn ? mm : paidOn) : (mm || paidOn);
    if (!date || date > today) continue;
    const label = `Salário ${r.referenceMonth ? `${String(r.referenceMonth).padStart(2, '0')}/${r.referenceYear}` : ''}${r.personRole ? ` · ${r.personRole}` : ''}${r.personName ? ` — ${r.personName}` : ''}`.trim();
    out.push({ id: `fp:${r.id}:cus`, date, description: label, reference: r.id, lines: [{ account: '72', debit: amount, credit: 0 }, { account: '36', debit: 0, credit: amount }], source: 'auto' });
    if (paidOn) {
      out.push({ id: `fp:${r.id}:pag`, date: paidOn, description: `Pagamento: ${label}`, reference: r.id, lines: [{ account: '36', debit: amount, credit: 0 }, { account: cashAccountOf(channelOf(r.paymentMethod)), debit: 0, credit: amount }], source: 'auto' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Amortizações (quotas constantes, em duodécimos, só meses já completos)
// ---------------------------------------------------------------------------

export interface DepreciableAsset extends LedgerAsset { category?: string; status?: string; updatedAt?: string }

export function usefulLifeOf(category: string | undefined, lives?: Record<string, number>): number {
  const key = category || 'outro';
  return lives?.[key] ?? DEFAULT_USEFUL_LIFE_YEARS[key] ?? DEFAULT_USEFUL_LIFE_YEARS.outro;
}

/**
 * Uma quota por mês (D 73 / C 18), datada do último dia do mês, desde o mês de aquisição até ao último mês
 * completo antes de `today`, ou até esgotar a vida útil. Activos abatidos deixam de amortizar no mês do abate
 * (data de última alteração; sem ela, não se amortiza). A última quota apanha o arredondamento.
 */
export function depreciationPostings(assets: DepreciableAsset[], today: string, lives?: Record<string, number>): Posting[] {
  const out: Posting[] = [];
  for (const a of assets) {
    const value = r2(Number(a.acquisitionValueKz));
    if (!Number.isFinite(value) || value <= 0) continue;
    const start = toISODate(a.acquisitionDate) || toISODate(a.createdAt);
    if (!start) continue;
    let stop = today;
    if (a.status === 'abatido') {
      const baixa = toISODate(a.updatedAt);
      if (!baixa) continue;
      if (baixa < stop) stop = baixa;
    }
    const years = usefulLifeOf(a.category, lives);
    const totalMonths = years * 12;
    const monthly = r2(value / totalMonths);
    let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
    let booked = 0;
    for (let k = 0; k < totalMonths; k++) {
      const end = monthEndIso(y, m);
      if (end > stop) break;
      const amount = k === totalMonths - 1 ? r2(value - booked) : monthly;
      booked = r2(booked + amount);
      if (amount > 0) {
        out.push({
          id: `dep:${a.id}:${y}-${String(m).padStart(2, '0')}`, date: end,
          description: `Amortização ${String(m).padStart(2, '0')}/${y}${a.code ? ` · ${a.code}` : ''}${a.name ? ` · ${a.name}` : ''}`,
          reference: a.code || a.id,
          lines: [{ account: '73', debit: amount, credit: 0 }, { account: '18', debit: 0, credit: amount }],
          source: 'amortizacao'
        });
      }
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  }
  return out;
}

export interface PostingSources {
  invoices: AccrualInvoice[];
  expenses: Expense[];
  payroll: LedgerPayroll[];
  assets: DepreciableAsset[];
  manual: JournalEntry[];
}

/** Todos os lançamentos (automáticos + manuais) segundo o regime e as amortizações escolhidos, do mais recente para o mais antigo. */
export function buildPostings(src: PostingSources, options: AccountingOptions, today: string): Posting[] {
  const opts = resolveAccountingOptions(options);
  let auto: Posting[];
  if (opts.basis === 'acrescimo') {
    const assetsLedger = buildLedger([], [], [], src.assets).filter((e) => e.kind === 'saida');
    auto = [
      ...accrualPostingsFromInvoices(src.invoices, today),
      ...accrualPostingsFromExpenses(src.expenses, today),
      ...accrualPostingsFromPayroll(src.payroll, today),
      ...postingsFromLedger(assetsLedger)
    ];
  } else {
    auto = postingsFromLedger(buildLedger(src.invoices as any, src.expenses, src.payroll, src.assets));
  }
  const dep = opts.depreciation ? depreciationPostings(src.assets, today, opts.usefulLifeYears) : [];
  return [...auto, ...dep, ...postingsFromManual(src.manual)].sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// Fecho do ano
// ---------------------------------------------------------------------------

export interface ClosingResult {
  date: string;
  description: string;
  lines: JournalLine[];
  proveitos: number;
  custos: number;
  /** proveitos − custos (positivo = lucro). */
  resultado: number;
}

/**
 * Lançamento que apura o resultado do ano: zera cada conta de proveitos e de custos do ano contra 88
 * (Resultado líquido do exercício). Devolve null se o ano não tem proveitos nem custos por apurar.
 * Ignora fechos já feitos, por isso volta a dar o valor que um fecho deveria ter hoje.
 */
export function buildClosingEntry(postings: Posting[], year: number): ClosingResult | null {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const acc = new Map<string, number>(); // débito − crédito
  for (const p of postings) {
    if (p.closing || p.date < from || p.date > to) continue;
    for (const l of p.lines) {
      const a = accountByCode(l.account);
      if (!a || (a.kind !== 'proveito' && a.kind !== 'custo')) continue;
      acc.set(l.account, r2((acc.get(l.account) || 0) + (l.debit || 0) - (l.credit || 0)));
    }
  }
  const lines: JournalLine[] = [];
  let proveitos = 0, custos = 0;
  for (const a of CHART) {
    const net = acc.get(a.code);
    if (!net) continue;
    if (a.kind === 'proveito') proveitos = r2(proveitos - net);
    else custos = r2(custos + net);
    // para zerar a conta: se o saldo é credor, debita-se; se devedor, credita-se
    lines.push(net < 0 ? { account: a.code, debit: r2(-net), credit: 0 } : { account: a.code, debit: 0, credit: r2(net) });
  }
  if (!lines.length) return null;
  const resultado = r2(proveitos - custos);
  if (resultado !== 0) lines.push(resultado > 0 ? { account: '88', debit: 0, credit: resultado } : { account: '88', debit: r2(-resultado), credit: 0 });
  return { date: to, description: `Apuramento do resultado do exercício ${year}`, lines, proveitos, custos, resultado };
}

/** O fecho gravado já não bate certo com os movimentos do ano (houve lançamentos depois de fechar)? */
export function isClosingStale(postings: Posting[], year: number, stored: JournalLine[]): boolean {
  const fresh = buildClosingEntry(postings, year);
  const norm = (ls: JournalLine[]) => ls.map((l) => `${l.account}|${r2(l.debit || 0)}|${r2(l.credit || 0)}`).sort().join(';');
  return norm(fresh?.lines || []) !== norm(stored);
}

// ---------------------------------------------------------------------------
// Balanço
// ---------------------------------------------------------------------------

export interface BalanceLine { code?: string; label: string; amount: number }
export interface BalanceSection { title: string; lines: BalanceLine[]; total: number }
export interface BalanceSheet {
  asOf: string;
  activoNaoCorrente: BalanceSection;
  activoCorrente: BalanceSection;
  totalActivo: number;
  capitalProprio: BalanceSection;
  passivoCorrente: BalanceSection;
  totalCapitalEPassivo: number;
  /** Total do activo = capital próprio + passivo. */
  balanced: boolean;
}

/** Balanço numa data: saldos acumulados desde o início (todos os lançamentos até `asOf`, incluindo fechos). */
export function computeBalanceSheet(postings: Posting[], asOf: string): BalanceSheet {
  const net = new Map<string, number>(); // débito − crédito
  for (const p of postings) {
    if (p.date > asOf) continue;
    for (const l of p.lines) net.set(l.account, r2((net.get(l.account) || 0) + (l.debit || 0) - (l.credit || 0)));
  }
  const dr = (code: string) => net.get(code) || 0;       // saldo devedor (positivo) / credor (negativo)
  const cr = (code: string) => r2(-(net.get(code) || 0)); // saldo credor (positivo)
  const sum = (ls: BalanceLine[]) => r2(ls.reduce((s, l) => s + l.amount, 0));
  const keep = (ls: BalanceLine[]) => ls.filter((l) => l.amount !== 0);

  const proveitos = r2(CHART.filter((a) => a.kind === 'proveito').reduce((s, a) => s + cr(a.code), 0));
  const custos = r2(CHART.filter((a) => a.kind === 'custo').reduce((s, a) => s + dr(a.code), 0));
  const resultadoAberto = r2(proveitos - custos);

  const nc = keep([
    { code: '11', label: 'Imobilizações corpóreas (custo de aquisição)', amount: dr('11') },
    { code: '18', label: 'Amortizações acumuladas', amount: dr('18') }
  ]);
  const co = keep([
    { code: '31', label: 'Contas a receber (propinas)', amount: dr('31') },
    { code: '43', label: 'Depósitos à ordem', amount: dr('43') },
    { code: '45', label: 'Caixa', amount: dr('45') }
  ]);
  const cp = keep([
    { code: '51', label: 'Capital', amount: cr('51') },
    { code: '81', label: 'Resultados transitados', amount: cr('81') },
    { code: '88', label: 'Resultado de exercícios fechados', amount: cr('88') },
    { label: 'Resultado do período em aberto', amount: resultadoAberto }
  ]);
  const pc = keep([
    { code: '32', label: 'Fornecedores', amount: cr('32') },
    { code: '36', label: 'Pessoal (salários a pagar)', amount: cr('36') }
  ]);
  const activoNaoCorrente = { title: 'Activo não corrente', lines: nc, total: sum(nc) };
  const activoCorrente = { title: 'Activo corrente', lines: co, total: sum(co) };
  const capitalProprio = { title: 'Capital próprio', lines: cp, total: sum(cp) };
  const passivoCorrente = { title: 'Passivo corrente', lines: pc, total: sum(pc) };
  const totalActivo = r2(activoNaoCorrente.total + activoCorrente.total);
  const totalCapitalEPassivo = r2(capitalProprio.total + passivoCorrente.total);
  return { asOf, activoNaoCorrente, activoCorrente, totalActivo, capitalProprio, passivoCorrente, totalCapitalEPassivo, balanced: Math.abs(totalActivo - totalCapitalEPassivo) < 0.005 };
}
