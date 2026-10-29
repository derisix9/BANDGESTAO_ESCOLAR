/**
 * Financeiro (passo 4): planos de pagamento, bolsas e descontos por regra, conciliação
 * bancária e contabilidade básica (despesas, contas a pagar, fluxo de caixa).
 * Lógica pura e testável. Valores em Kwanzas, arredondados à unidade.
 *
 * NOTA FISCAL: nada aqui emite documentos fiscais. A faturação certificada pela AGT
 * exige software validado pela própria AGT; este sistema não gera nem submete o SAF-T.
 */

const round = (n: number) => Math.round(n);

// ---------------------------------------------------------------------------
// Planos de pagamento (prestações)
// ---------------------------------------------------------------------------

export interface Installment {
  number: number;
  /** AAAA-MM-DD */
  dueDate: string;
  amount: number;
  paid?: boolean;
}

function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/**
 * Divide um total em N prestações mensais. O resto da divisão vai para a última prestação,
 * de modo que a soma das prestações é sempre exatamente igual ao total.
 */
export function buildInstallmentPlan(total: number, count: number, firstDueISO: string): Installment[] {
  if (!(total > 0) || !Number.isInteger(count) || count < 1) return [];
  const base = Math.floor(total / count);
  const plan: Installment[] = [];
  let accumulated = 0;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? total - accumulated : base;
    accumulated += amount;
    plan.push({ number: i + 1, dueDate: addMonthsISO(firstDueISO, i), amount });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Bolsas e descontos por regra
// ---------------------------------------------------------------------------

export interface DiscountRule {
  id: string;
  label: string;
  kind: 'percent' | 'fixed';
  /** Percentagem (0–100) ou valor fixo em Kz. */
  value: number;
  /** Aplica-se a partir do N.º irmão matriculado (0 = a todos). */
  minSiblingPosition?: number;
  /** Aplica-se se o pagamento for feito até este dia do mês (pronto pagamento). */
  paidByDay?: number;
  /** Pode acumular com outras regras. */
  stackable?: boolean;
}

export interface DiscountContext {
  /** Posição do aluno entre irmãos matriculados (1 = primeiro). */
  siblingPosition?: number;
  /** Dia do mês em que o pagamento foi feito. */
  paymentDay?: number;
}

function ruleApplies(rule: DiscountRule, ctx: DiscountContext): boolean {
  if (rule.minSiblingPosition && (ctx.siblingPosition ?? 1) < rule.minSiblingPosition) return false;
  if (rule.paidByDay && (ctx.paymentDay === undefined || ctx.paymentDay > rule.paidByDay)) return false;
  return true;
}

/**
 * Aplica as regras ao valor base. Regras não acumuláveis: aplica-se só a mais vantajosa.
 * As acumuláveis somam-se sobre o valor base. O desconto nunca excede o valor base.
 */
export function applyDiscountRules(
  base: number,
  rules: DiscountRule[],
  ctx: DiscountContext = {}
): { final: number; discount: number; applied: DiscountRule[] } {
  const amountOf = (r: DiscountRule) => (r.kind === 'percent' ? (base * r.value) / 100 : r.value);
  const eligible = rules.filter((r) => ruleApplies(r, ctx));
  const stackable = eligible.filter((r) => r.stackable);
  const exclusive = eligible.filter((r) => !r.stackable);

  const bestExclusive = exclusive.reduce<DiscountRule | null>(
    (best, r) => (!best || amountOf(r) > amountOf(best) ? r : best),
    null
  );
  const applied = [...stackable, ...(bestExclusive ? [bestExclusive] : [])];
  const raw = applied.reduce((s, r) => s + amountOf(r), 0);
  const discount = Math.min(base, round(raw));
  return { final: base - discount, discount, applied };
}

// ---------------------------------------------------------------------------
// Conciliação bancária
// ---------------------------------------------------------------------------

export interface BankLine {
  id: string;
  /** AAAA-MM-DD */
  date: string;
  amount: number;
  description: string;
  /** Referência Multicaixa ou de pagamento, quando o extrato a traz. */
  reference?: string;
}

export interface OpenInvoice {
  id: string;
  amount: number;
  dueDate: string;
  reference?: string;
  studentName?: string;
}

export type MatchConfidence = 'exata' | 'provavel';

export interface ReconciliationMatch {
  line: BankLine;
  invoice: OpenInvoice;
  confidence: MatchConfidence;
  reason: string;
}

export interface ReconciliationResult {
  matches: ReconciliationMatch[];
  unmatchedLines: BankLine[];
  unmatchedInvoices: OpenInvoice[];
}

const norm = (s?: string) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Cruza o extrato com as faturas em aberto. Cada linha e cada fatura só podem casar uma vez.
 * 1.º passo: referência igual e valor igual ("exata"). 2.º: valor igual e uma única fatura
 * candidata ("provavel", para o utilizador confirmar). Nada é dado como pago automaticamente.
 */
export function reconcileBank(lines: BankLine[], invoices: OpenInvoice[]): ReconciliationResult {
  const usedInvoices = new Set<string>();
  const usedLines = new Set<string>();
  const matches: ReconciliationMatch[] = [];

  for (const line of lines) {
    if (!(line.amount > 0) || !line.reference) continue;
    const inv = invoices.find(
      (i) => !usedInvoices.has(i.id) && i.reference && norm(i.reference) === norm(line.reference) && i.amount === line.amount
    );
    if (inv) {
      usedInvoices.add(inv.id);
      usedLines.add(line.id);
      matches.push({ line, invoice: inv, confidence: 'exata', reason: 'Referência e valor coincidem.' });
    }
  }

  for (const line of lines) {
    if (usedLines.has(line.id) || !(line.amount > 0)) continue;
    const candidates = invoices.filter((i) => !usedInvoices.has(i.id) && i.amount === line.amount);
    if (candidates.length === 1) {
      usedInvoices.add(candidates[0].id);
      usedLines.add(line.id);
      matches.push({
        line,
        invoice: candidates[0],
        confidence: 'provavel',
        reason: 'Só uma fatura em aberto com este valor; confirmar antes de dar como paga.'
      });
    }
  }

  return {
    matches,
    unmatchedLines: lines.filter((l) => !usedLines.has(l.id)),
    unmatchedInvoices: invoices.filter((i) => !usedInvoices.has(i.id))
  };
}

// ---------------------------------------------------------------------------
// Contabilidade básica: despesas, contas a pagar, fluxo de caixa
// ---------------------------------------------------------------------------

export interface Expense {
  id: string;
  supplier?: string;
  category: string;
  description?: string;
  amount: number;
  /** Data da despesa AAAA-MM-DD */
  date: string;
  /** Data limite de pagamento; ausente = pago no ato. */
  dueDate?: string;
  paidDate?: string;
}

export interface CashMovement {
  /** AAAA-MM-DD */
  date: string;
  /** Positivo = entrada, negativo = saída. */
  amount: number;
  source: 'propinas' | 'outras_receitas' | 'despesa' | 'folha_pagamento' | 'investimento_ativos';
}

export function isPayable(e: Expense): boolean {
  return !e.paidDate;
}

export function isOverdue(e: Expense, todayISO: string): boolean {
  return isPayable(e) && !!e.dueDate && e.dueDate < todayISO;
}

/** Contas a pagar em aberto, por data limite crescente (as sem prazo vão para o fim). */
export function accountsPayable(expenses: Expense[]): Expense[] {
  return expenses
    .filter(isPayable)
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
}

export interface CashFlowMonth {
  month: string; // AAAA-MM
  inflow: number;
  outflow: number;
  net: number;
  closingBalance: number;
}

/** Fluxo de caixa mensal com saldo acumulado a partir do saldo de abertura. */
export function monthlyCashFlow(movements: CashMovement[], openingBalance = 0): CashFlowMonth[] {
  const byMonth = new Map<string, { inflow: number; outflow: number }>();
  for (const m of movements) {
    const key = m.date.slice(0, 7);
    const cur = byMonth.get(key) ?? { inflow: 0, outflow: 0 };
    if (m.amount >= 0) cur.inflow += m.amount;
    else cur.outflow += -m.amount;
    byMonth.set(key, cur);
  }
  let balance = openingBalance;
  return [...byMonth.keys()].sort().map((month) => {
    const { inflow, outflow } = byMonth.get(month)!;
    balance += inflow - outflow;
    return { month, inflow, outflow, net: inflow - outflow, closingBalance: balance };
  });
}

// ---------------------------------------------------------------------------
// Livro de caixa detalhado e sessões de caixa (abertura / fecho)
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  /** inv:ID para faturas, exp:ID para despesas. */
  id: string;
  date: string;
  kind: 'entrada' | 'saida';
  category: string;
  description: string;
  /** Aluno (entradas) ou fornecedor (saídas). */
  party?: string;
  method?: string;
  isCash: boolean;
  /** Canal do dinheiro: serve os filtros do saldo (Numerário, Multicaixa, TPA, Banco). */
  channel: PaymentChannel;
  reference?: string;
  amount: number;
}

export type PaymentChannel = 'numerario' | 'multicaixa' | 'tpa' | 'banco' | 'outro';

export const CHANNEL_LABELS: Record<PaymentChannel, string> = {
  numerario: 'Numerário',
  multicaixa: 'Multicaixa',
  tpa: 'TPA',
  banco: 'Banco (depósito / transferência)',
  outro: 'Outros meios'
};

/** Agrupa os meios de pagamento (faturas e folha) em canais. */
export function channelOf(method?: string): PaymentChannel {
  switch (method) {
    case 'numerario': return 'numerario';
    case 'mcx': case 'multicaixa': return 'multicaixa';
    case 'tpa': return 'tpa';
    case 'debito': case 'transferencia': case 'cheque': return 'banco';
    default: return 'outro';
  }
}

/** Recibo de vencimento, no mínimo necessário para o livro de caixa. */
export interface LedgerPayroll {
  id: string;
  status: string;
  paymentDate?: string;
  paymentMethod?: string;
  netSalaryKz: number;
  personName?: string;
  personRole?: string;
  referenceMonth?: number;
  referenceYear?: number;
}

export const PAYROLL_CATEGORY = 'Folha de pagamento';
/** Categoria das saídas geradas pelo valor de aquisição dos activos do inventário. */
export const ASSET_INVESTMENT_CATEGORY = 'Inventário de activos';

/** Activo do inventário, no mínimo necessário para o livro de caixa. */
export interface LedgerAsset {
  id: string;
  code?: string;
  name?: string;
  acquisitionDate?: string;
  acquisitionValueKz?: number;
  supplierName?: string;
  createdAt?: string;
}

interface LedgerInvoice {
  id: string; status: string; paymentDate?: string; totalPaidKz?: number; totalAmountKz: number;
  studentName?: string; description?: string; period?: string; method?: string; methodLabel?: string;
  receiptNumber?: string; invoiceNumber?: string;
}

const METHOD_LABELS: Record<string, string> = {
  numerario: 'Numerário', mcx: 'Multicaixa', multicaixa: 'Multicaixa', debito: 'Débito', tpa: 'TPA'
};

/**
 * Junta faturas pagas (entradas), despesas pagas e recibos de vencimento pagos (saídas) num só livro,
 * ordenado por data. A folha de pagamento sai no mês em que foi paga (data de pagamento do recibo).
 * O valor investido em cada activo do inventário (valor de aquisição) sai como despesa no mês da
 * data de aquisição (ou, se não houver, no mês em que o activo foi registado).
 */
export function buildLedger(invoices: LedgerInvoice[], expenses: Expense[], payroll: LedgerPayroll[] = [], assets: LedgerAsset[] = []): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const i of invoices) {
    if (i.status !== 'pago') continue;
    const date = toISODate(i.paymentDate);
    if (!date) continue;
    const method = i.method ? (METHOD_LABELS[i.method] || i.methodLabel || i.method) : 'Não indicado';
    out.push({
      id: `inv:${i.id}`, date, kind: 'entrada', category: 'Propinas e serviços',
      description: [i.description, i.period].filter(Boolean).join(' · ') || 'Pagamento de fatura',
      party: i.studentName, method, isCash: i.method === 'numerario', channel: channelOf(i.method),
      reference: i.receiptNumber || i.invoiceNumber, amount: i.totalPaidKz ?? i.totalAmountKz
    });
  }
  for (const e of expenses) {
    if (!e.paidDate) continue;
    out.push({
      id: `exp:${e.id}`, date: e.paidDate, kind: 'saida', category: e.category || 'Sem categoria',
      description: e.description || '—', party: e.supplier, method: 'Numerário', isCash: true, channel: 'numerario',
      reference: e.id, amount: e.amount
    });
  }
  for (const r of payroll) {
    if (r.status !== 'pago') continue;
    const mm = String(r.referenceMonth ?? '').padStart(2, '0');
    const date = toISODate(r.paymentDate) || (r.referenceMonth && r.referenceYear ? `${r.referenceYear}-${mm}-01` : '');
    if (!date || !(r.netSalaryKz > 0)) continue;
    const ch = channelOf(r.paymentMethod);
    out.push({
      id: `fp:${r.id}`, date, kind: 'saida', category: PAYROLL_CATEGORY,
      description: `Salário ${r.referenceMonth ? `${mm}/${r.referenceYear}` : ''}${r.personRole ? ` · ${r.personRole}` : ''}`.trim(),
      party: r.personName, method: CHANNEL_LABELS[ch].split(' (')[0], isCash: ch === 'numerario', channel: ch,
      reference: r.id, amount: r.netSalaryKz
    });
  }
  for (const a of assets) {
    const value = Number(a.acquisitionValueKz);
    if (!Number.isFinite(value) || value <= 0) continue;
    const date = toISODate(a.acquisitionDate) || toISODate(a.createdAt);
    if (!date) continue;
    out.push({
      id: `ast:${a.id}`, date, kind: 'saida', category: ASSET_INVESTMENT_CATEGORY,
      description: `Aquisição de activo${a.code ? ` ${a.code}` : ''}${a.name ? ` · ${a.name}` : ''}`,
      party: a.supplierName, method: 'Não indicado', isCash: false, channel: 'outro',
      reference: a.code || a.id, amount: value
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export interface CategoryTotal { category: string; total: number; count: number; percent: number }

export function totalsByCategory(entries: LedgerEntry[], kind: 'entrada' | 'saida'): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of entries) {
    if (e.kind !== kind) continue;
    const cur = map.get(e.category) ?? { total: 0, count: 0 };
    cur.total += e.amount; cur.count += 1;
    map.set(e.category, cur);
  }
  const sum = [...map.values()].reduce((a, b) => a + b.total, 0);
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v, percent: sum > 0 ? (v.total / sum) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

export interface MethodTotal { method: string; total: number; count: number }

export interface SessionTotals {
  /** Entradas em numerário (gaveta). */
  cashIn: number;
  /** Entradas por TPA, Multicaixa, MCX, débito e outros meios. */
  otherIn: number;
  /** Total de entradas contabilizadas: TODOS os meios de pagamento. */
  totalIn: number;
  /** Entradas agrupadas por meio de pagamento. */
  byMethod: MethodTotal[];
  cashOut: number;
  /** Saldo esperado da caixa: fundo + todas as entradas - saídas. */
  expectedCash: number;
  /** Só o numerário que deve existir fisicamente na gaveta: fundo + numerário - saídas. */
  expectedDrawerCash: number;
  movementIds: string[];
}

/** Mensagem única usada em todos os bloqueios por caixa fechada. */
export const CASH_CLOSED_MESSAGE =
  'Caixa fechada: abra a caixa em Despesas & Fluxo de Caixa antes de registar pagamentos de propinas, serviços ou despesas.';

/**
 * Movimentos a contabilizar no fecho: a partir do dia de abertura, ainda não
 * incluídos em nenhum fecho anterior. As entradas contam TODOS os meios de pagamento
 * (numerário, TPA, Multicaixa/MCX, débito e outros). O esperado da caixa é
 * fundo + todas as entradas - saídas; o numerário da gaveta é calculado à parte.
 */
export function computeSessionTotals(ledger: LedgerEntry[], openedAtISO: string, openingFloat: number, alreadyClosedIds: Set<string>): SessionTotals {
  const from = openedAtISO.slice(0, 10);
  const mine = ledger.filter((e) => e.date >= from && !alreadyClosedIds.has(e.id));
  const entries = mine.filter((e) => e.kind === 'entrada');
  const cashIn = entries.filter((e) => e.isCash).reduce((s, e) => s + e.amount, 0);
  const otherIn = entries.filter((e) => !e.isCash).reduce((s, e) => s + e.amount, 0);
  const totalIn = cashIn + otherIn;
  const saidas = mine.filter((e) => e.kind === 'saida');
  const cashOut = saidas.reduce((s, e) => s + e.amount, 0);
  // Só as saídas em numerário saem fisicamente da gaveta (salários por transferência, por exemplo, não).
  const drawerOut = saidas.filter((e) => e.isCash).reduce((s, e) => s + e.amount, 0);
  const methods = new Map<string, MethodTotal>();
  for (const e of entries) {
    const key = e.method || 'Não indicado';
    const cur = methods.get(key) ?? { method: key, total: 0, count: 0 };
    cur.total += e.amount; cur.count += 1;
    methods.set(key, cur);
  }
  return {
    cashIn, otherIn, totalIn,
    byMethod: [...methods.values()].sort((a, b) => b.total - a.total),
    cashOut,
    expectedCash: openingFloat + totalIn - cashOut,
    expectedDrawerCash: openingFloat + cashIn - drawerOut,
    movementIds: mine.map((e) => e.id)
  };
}

// ---------------------------------------------------------------------------
// Leitura de extratos (CSV) e datas
// ---------------------------------------------------------------------------

/** Aceita AAAA-MM-DD ou DD/MM/AAAA (com ou sem hora). Devolve '' se não reconhecer. */
export function toISODate(value?: string | null): string {
  if (!value) return '';
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** "45.000,00", "45 000,50", "45000.00" e "-1.200,00" → número. NaN se inválido. */
export function parseAmount(raw: string): number {
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, '');
  else if (lastComma !== -1) s = s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  else if (/^-?\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  return Number(s);
}

export interface ParsedBankCsv {
  lines: Array<{ date: string; amount: number; description: string; reference?: string }>;
  errors: string[];
}

/**
 * Lê um CSV com colunas: data; descrição; valor; referência (opcional). Separador ; ou ,
 * (com valores decimais com vírgula, use ;). Uma primeira linha de cabeçalho é ignorada.
 */
export function parseBankCsv(text: string): ParsedBankCsv {
  const out: ParsedBankCsv = { lines: [], errors: [] };
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  rows.forEach((row, idx) => {
    const sep = row.includes(';') ? ';' : ',';
    const cols = row.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = toISODate(cols[0]);
    if (!date && idx === 0) return; // cabeçalho
    const amount = parseAmount(cols[2] ?? '');
    if (!date) { out.errors.push(`Linha ${idx + 1}: data inválida.`); return; }
    if (!Number.isFinite(amount)) { out.errors.push(`Linha ${idx + 1}: valor inválido.`); return; }
    out.lines.push({ date, description: cols[1] || '', amount, reference: cols[3] || undefined });
  });
  return out;
}


// ---------------------------------------------------------------------------
// Dashboard: saldo da instituição, despesas e cobrança por tipo
// ---------------------------------------------------------------------------

export interface BalanceSummary { total: number; entradas: number; saidas: number }

/** Saldo (entradas − saídas) do livro de caixa, opcionalmente só de um canal (Numerário, Multicaixa, TPA, Banco...). */
export function balanceByChannel(ledger: LedgerEntry[], channel?: PaymentChannel | 'todos'): BalanceSummary {
  const list = !channel || channel === 'todos' ? ledger : ledger.filter((e) => e.channel === channel);
  const entradas = list.filter((e) => e.kind === 'entrada').reduce((s, e) => s + e.amount, 0);
  const saidas = list.filter((e) => e.kind === 'saida').reduce((s, e) => s + e.amount, 0);
  return { total: entradas - saidas, entradas, saidas };
}

/** Despesas pagas (incluindo a folha de pagamento), opcionalmente só de uma categoria. */
export function expensesTotal(ledger: LedgerEntry[], category?: string): { total: number; count: number } {
  const list = ledger.filter((e) => e.kind === 'saida' && (!category || category === 'todas' || e.category === category));
  return { total: list.reduce((s, e) => s + e.amount, 0), count: list.length };
}

export type CollectionKind = string;

interface CollectionInvoice {
  status: string; description?: string; totalAmountKz: number; totalPaidKz?: number;
  items?: Array<{ code: string; description?: string; quantity?: number; unitPriceKz?: number; discountKz?: number; liquidTotalKz?: number }>;
}

/** Tipo de cada linha de uma fatura: Propinas, Multas por atraso ou a categoria do serviço no catálogo. */
export function collectionKindOfItem(code: string, serviceCategory: (code: string) => string | undefined): string {
  if (code === 'PROP-ESC') return 'Propinas';
  if (code === 'MULTA-MORA') return 'Multas por atraso';
  return serviceCategory(code) || 'Outros serviços';
}

/**
 * Cobrança por tipo (Propinas / serviços por categoria). Sem filtro devolve os totais das faturas
 * tal como estão; com filtro soma só as linhas desse tipo. Faturas sem linhas contam como Propinas
 * (ou Outros serviços, se a descrição não falar de propinas).
 */
export function collectionSummary(
  invoices: CollectionInvoice[],
  kind: CollectionKind | undefined,
  serviceCategory: (code: string) => string | undefined
): { collected: number; invoiced: number; pending: number; kinds: string[] } {
  const kinds = new Set<string>();
  let collected = 0, invoiced = 0, pending = 0;
  const all = !kind || kind === 'todos';
  for (const inv of invoices) {
    const lines = inv.items && inv.items.length
      ? inv.items.map((it) => ({
          kind: collectionKindOfItem(it.code, serviceCategory),
          amount: it.liquidTotalKz ?? Math.max(0, (it.unitPriceKz ?? 0) * (it.quantity ?? 1) - (it.discountKz ?? 0))
        }))
      : [{ kind: /propina/i.test(inv.description || '') ? 'Propinas' : 'Outros serviços', amount: inv.totalAmountKz }];
    lines.forEach((l) => kinds.add(l.kind));
    if (all) {
      invoiced += inv.totalAmountKz || 0;
      if (inv.status === 'pago') collected += inv.totalAmountKz || 0;
      if (inv.status === 'pendente' || inv.status === 'atraso') pending += 1;
      continue;
    }
    const mine = lines.filter((l) => l.kind === kind);
    if (!mine.length) continue;
    const sum = mine.reduce((s, l) => s + l.amount, 0);
    invoiced += sum;
    if (inv.status === 'pago') collected += sum;
    if (inv.status === 'pendente' || inv.status === 'atraso') pending += 1;
  }
  return { collected, invoiced, pending, kinds: [...kinds].sort((a, b) => a.localeCompare(b, 'pt')) };
}


const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Períodos disponíveis no livro: anos (AAAA) e meses (AAAA-MM), do mais recente para o mais antigo. */
export function ledgerPeriodOptions(ledger: LedgerEntry[]): Array<{ value: string; label: string }> {
  const months = [...new Set(ledger.map((e) => e.date.slice(0, 7)))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return [
    ...years.map((y) => ({ value: y, label: `Ano ${y}` })),
    ...months.map((m) => ({ value: m, label: `${MONTHS_PT[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` }))
  ];
}

/** Filtra o livro por ano (AAAA) ou mês (AAAA-MM); 'todo' ou vazio devolve tudo. */
export function filterLedgerByPeriod(ledger: LedgerEntry[], period?: string): LedgerEntry[] {
  return !period || period === 'todo' ? ledger : ledger.filter((e) => e.date.startsWith(period));
}


/** Data de referência de uma fatura para o filtro de período: pagamento (se paga) ou vencimento. */
export function invoiceReferenceDate(inv: { status: string; paymentDate?: string; dueDate?: string }): string {
  return (inv.status === 'pago' ? toISODate(inv.paymentDate) : '') || toISODate(inv.dueDate) || toISODate(inv.paymentDate);
}

/** Filtra faturas por ano (AAAA) ou mês (AAAA-MM); 'todo' devolve tudo. */
export function filterInvoicesByPeriod<T extends { status: string; paymentDate?: string; dueDate?: string }>(invoices: T[], period?: string): T[] {
  return !period || period === 'todo' ? invoices : invoices.filter((i) => invoiceReferenceDate(i).startsWith(period));
}

/** Anos e meses que existem nas faturas, do mais recente para o mais antigo. */
export function invoicePeriodOptions(invoices: Array<{ status: string; paymentDate?: string; dueDate?: string }>): Array<{ value: string; label: string }> {
  const months = [...new Set(invoices.map((i) => invoiceReferenceDate(i).slice(0, 7)))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return [
    ...years.map((y) => ({ value: y, label: `Ano ${y}` })),
    ...months.map((m) => ({ value: m, label: `${MONTHS_PT[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` }))
  ];
}
