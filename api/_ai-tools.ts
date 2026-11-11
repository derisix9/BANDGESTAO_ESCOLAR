/**
 * BANDGESTÃO AI — ferramentas que o modelo pode pedir ao servidor.
 * O modelo escolhe a ferramenta e os argumentos; o servidor valida o utilizador, a instituição activa e
 * as permissões da colecção (collection_acl + permissões personalizadas) ANTES de tocar nos dados.
 * Nesta versão todas as ferramentas são de leitura ou de emissão de documentos.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { canAccessCollection, sendWhatsAppDocument, type WhatsAppCaller } from './_whatsapp-ai';
import { renderPdf, renderXlsx, type ReportDoc, type ReportSection } from './_ai-report';
import type { ToolExecutor, ToolOutcome, ToolSpec } from './_ai-providers';

export const AREA_CATALOG = {
  alunos: { collection: 'students', label: 'alunos', fields: ['name', 'procNumber', 'grade', 'className', 'status'] },
  turmas: { collection: 'classes', label: 'turmas', fields: ['name', 'grade', 'section', 'shift', 'room', 'studentCount', 'maxCapacity', 'academicYear'] },
  professores: { collection: 'teachers', label: 'professores', fields: ['name', 'agentNumber', 'department', 'status'] },
  funcionarios: { collection: 'funcionarios', label: 'funcionários', fields: ['name', 'employeeNumber', 'cargo', 'department', 'status'] },
  propinas: { collection: 'invoices', label: 'facturas de propinas', fields: ['invoiceNumber', 'studentName', 'period', 'totalAmountKz', 'status', 'dueDate'] },
  despesas: { collection: 'expenses', label: 'despesas', fields: ['category', 'description', 'amount', 'date', 'paidDate'] },
  assiduidade: { collection: 'attendanceSheets', label: 'folhas de assiduidade', fields: ['date', 'className', 'subjectName', 'teacherName', 'status'] },
  admissoes: { collection: 'admissions', label: 'processos de admissão', fields: ['name', 'studentName', 'status', 'createdAt'] },
  trabalhos: { collection: 'assignments', label: 'trabalhos online', fields: ['title', 'name', 'className', 'subjectName', 'dueDate', 'status'] }
} as const;
export type AreaKey = keyof typeof AREA_CATALOG;
const AREA_KEYS = Object.keys(AREA_CATALOG) as AreaKey[];

export const REPORT_TYPES = ['school_overview', 'students_list', 'classes_list', 'finance_summary', 'overdue_invoices', 'expenses_list', 'teachers_list', 'staff_list'] as const;
export type ReportType = typeof REPORT_TYPES[number];

const MAX_ROWS = 3000;
const SEARCH_FIELDS = ['name', 'procNumber', 'invoiceNumber', 'employeeNumber', 'agentNumber', 'title', 'studentName'];

class DeniedError extends Error {}

interface Ctx {
  admin: SupabaseClient;
  caller: WhatsAppCaller;
  phone: string;
  institutionName?: string;
}

const nf = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
const kz = (n: number) => `${nf(n)} Kz`;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown, fallback = '—') => { const s = String(v ?? '').trim(); return s || fallback; };
const ptSort = (a: string, b: string) => a.localeCompare(b, 'pt-PT', { sensitivity: 'base' });

function checkPeriod(raw: unknown): string | undefined {
  const p = String(raw ?? '').trim();
  if (!p) return undefined;
  if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(p)) throw new Error('Período inválido. Use AAAA ou AAAA-MM, por exemplo 2026-10.');
  return p;
}
function checkYear(raw: unknown): string | undefined {
  const y = String(raw ?? '').trim();
  if (!y) return undefined;
  if (!/^\d{4}(\/\d{4})?$/.test(y)) throw new Error('Ano lectivo inválido. Use o formato 2026/2027.');
  return y;
}
const inPeriod = (value: unknown, period?: string) => !period || String(value ?? '').startsWith(period);

async function requireRead(ctx: Ctx, collection: string, what: string): Promise<void> {
  if (!(await canAccessCollection(ctx.admin, ctx.caller, collection, 'read'))) {
    throw new DeniedError(`O perfil ${ctx.caller.role} não tem acesso a ${what}.`);
  }
}

async function fetchRows(ctx: Ctx, collection: string, what: string, year?: string, max = MAX_ROWS): Promise<{ rows: any[]; truncated: boolean }> {
  await requireRead(ctx, collection, what);
  const all: any[] = [];
  const batch = 1000;
  for (let start = 0; start < max; start += batch) {
    let q = ctx.admin.from('records').select('id,data,academic_year,created_at')
      .eq('institution_id', ctx.caller.institutionId).eq('collection', collection);
    if (year) q = q.eq('academic_year', year);
    const { data, error } = await q.order('created_at', { ascending: false }).range(start, Math.min(start + batch, max) - 1);
    if (error) throw new Error('Não foi possível reunir os dados pedidos.');
    all.push(...(data || []));
    if (!data || data.length < batch) return { rows: all, truncated: false };
  }
  return { rows: all, truncated: true };
}

const countBy = <T,>(items: T[], key: (item: T) => string): Array<{ nome: string; total: number }> => {
  const map = new Map<string, number>();
  for (const item of items) { const k = key(item) || 'Não indicado'; map.set(k, (map.get(k) || 0) + 1); }
  return [...map.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total || ptSort(a.nome, b.nome));
};

const STUDENT_STATUS: Record<string, string> = { active: 'Activo', pending: 'Pendente', transferred: 'Transferido', suspended: 'Suspenso' };
const studentStatus = (s: unknown) => STUDENT_STATUS[String(s)] || str(s, 'Não indicado');
const INVOICE_STATUS: Record<string, string> = { pago: 'Paga', atraso: 'Em atraso', pendente: 'Pendente', isento: 'Isenta' };
const genderOf = (g: unknown) => { const s = String(g ?? '').trim().toLowerCase(); return s.startsWith('m') ? 'Masculino' : s.startsWith('f') ? 'Feminino' : 'Não indicado'; };

function projectFields(data: Record<string, any>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data?.[field];
    if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value)) result[field] = value;
  }
  return result;
}

/* ───────────── consultas ───────────── */
async function indicador(ctx: Ctx, area: AreaKey, year?: string) {
  const cfg = AREA_CATALOG[area];
  if (!cfg) throw new Error('Área não reconhecida.');
  await requireRead(ctx, cfg.collection, cfg.label);
  let q = ctx.admin.from('records').select('id', { count: 'exact', head: true })
    .eq('institution_id', ctx.caller.institutionId).eq('collection', cfg.collection);
  if (year) q = q.eq('academic_year', year);
  const { count, error } = await q;
  if (error) throw new Error('Não foi possível consultar este indicador.');
  return {
    area: cfg.label, totalRegistos: count ?? 0, ...(year ? { anoLectivo: year } : {}),
    criterio: year ? 'Registos desta área no ano lectivo indicado.' : 'Todos os registos desta área na instituição activa; não filtra por estado nem por ano lectivo.'
  };
}

async function pesquisar(ctx: Ctx, area: AreaKey, term: string) {
  const cfg = AREA_CATALOG[area];
  if (!cfg) throw new Error('Área não reconhecida.');
  const query = term.trim().toLocaleLowerCase('pt-PT');
  if (query.length < 2 || query.length > 80) throw new Error('Escreva pelo menos 2 caracteres para pesquisar.');
  const { rows } = await fetchRows(ctx, cfg.collection, cfg.label, undefined, 1500);
  const fields = cfg.fields.filter((f) => SEARCH_FIELDS.includes(f));
  const hits = rows.filter((row) => fields.some((f) => String(row.data?.[f] ?? '').toLocaleLowerCase('pt-PT').includes(query)));
  return {
    area: cfg.label, totalEncontrado: hits.length, limite: 12,
    resultados: hits.slice(0, 12).map((row) => ({ id: row.id, ...projectFields(row.data || {}, cfg.fields), ...(row.academic_year ? { anoLectivo: row.academic_year } : {}) }))
  };
}

async function estatisticasAlunos(ctx: Ctx, year?: string) {
  const { rows, truncated } = await fetchRows(ctx, 'students', 'alunos', year);
  const d = rows.map((r) => r.data || {});
  return {
    totalAlunos: d.length, ...(year ? { anoLectivo: year } : {}), limitadoA3000: truncated,
    porEstado: countBy(d, (x) => studentStatus(x.status)),
    porClasse: countBy(d, (x) => str(x.grade, 'Não indicado')),
    porGenero: countBy(d, (x) => genderOf(x.gender)),
    turmasComMaisAlunos: countBy(d, (x) => str(x.className, 'Sem turma')).slice(0, 12)
  };
}

function classStats(rows: any[]) {
  const d = rows.map((r) => r.data || {});
  const list = d.map((c) => {
    const alunos = num(c.studentCount), capacidade = num(c.maxCapacity);
    return { turma: str(c.name), classe: str(c.grade), turno: str(c.shift), sala: str(c.room), alunos, capacidade, ocupacao: capacidade > 0 ? Math.round((alunos / capacidade) * 100) : null };
  });
  return {
    list,
    totalAlunos: list.reduce((n, c) => n + c.alunos, 0),
    capacidadeTotal: list.reduce((n, c) => n + c.capacidade, 0),
    acimaDaLotacao: list.filter((c) => c.capacidade > 0 && c.alunos > c.capacidade).length
  };
}

async function estadoTurmas(ctx: Ctx, year?: string) {
  const { rows } = await fetchRows(ctx, 'classes', 'turmas', year);
  const s = classStats(rows);
  const top = [...s.list].sort((a, b) => (b.ocupacao ?? -1) - (a.ocupacao ?? -1)).slice(0, 12);
  return {
    totalTurmas: s.list.length, ...(year ? { anoLectivo: year } : {}), alunosNasTurmas: s.totalAlunos, capacidadeTotal: s.capacidadeTotal,
    ocupacaoGeralPercentagem: s.capacidadeTotal > 0 ? Math.round((s.totalAlunos / s.capacidadeTotal) * 100) : null,
    turmasAcimaDaLotacao: s.acimaDaLotacao, turmasMaisCheias: top
  };
}

async function financeData(ctx: Ctx, period?: string, year?: string) {
  const canInv = await canAccessCollection(ctx.admin, ctx.caller, 'invoices', 'read');
  const canExp = await canAccessCollection(ctx.admin, ctx.caller, 'expenses', 'read');
  if (!canInv && !canExp) throw new DeniedError(`O perfil ${ctx.caller.role} não tem acesso às áreas financeiras.`);
  const [inv, exp] = await Promise.all([
    canInv ? fetchRows(ctx, 'invoices', 'facturas', year) : Promise.resolve({ rows: [] as any[], truncated: false }),
    canExp ? fetchRows(ctx, 'expenses', 'despesas', year) : Promise.resolve({ rows: [] as any[], truncated: false })
  ]);
  const invoices = inv.rows.map((r) => r.data || {}).filter((d) => inPeriod(d.dueDate ?? d.period, period));
  const expenses = exp.rows.map((r) => r.data || {}).filter((d) => inPeriod(d.date, period));
  const byStatus = (status: string) => invoices.filter((d) => d.status === status);
  const paid = byStatus('pago').reduce((n, d) => n + num(d.totalPaidKz ?? d.totalAmountKz), 0);
  const overdue = byStatus('atraso').reduce((n, d) => n + num(d.totalAmountKz), 0);
  const pending = byStatus('pendente').reduce((n, d) => n + num(d.totalAmountKz), 0);
  const billed = invoices.filter((d) => d.status !== 'isento').reduce((n, d) => n + num(d.totalAmountKz), 0);
  const expTotal = expenses.reduce((n, d) => n + num(d.amount), 0);
  const expPaid = expenses.filter((d) => d.paidDate).reduce((n, d) => n + num(d.amount), 0);
  const cats = new Map<string, { total: number; n: number }>();
  for (const d of expenses) { const c = str(d.category, 'Sem categoria'); const cur = cats.get(c) || { total: 0, n: 0 }; cur.total += num(d.amount); cur.n++; cats.set(c, cur); }
  return {
    canInv, canExp, invoices, expenses, truncated: inv.truncated || exp.truncated,
    paid, overdue, pending, billed, expTotal, expPaid,
    collectionRate: billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null,
    categories: [...cats.entries()].map(([nome, v]) => ({ nome, total: v.total, n: v.n })).sort((a, b) => b.total - a.total),
    statusRows: ['pago', 'atraso', 'pendente', 'isento'].map((s) => ({
      estado: INVOICE_STATUS[s], n: byStatus(s).length, total: byStatus(s).reduce((n, d) => n + num(s === 'pago' ? (d.totalPaidKz ?? d.totalAmountKz) : d.totalAmountKz), 0)
    }))
  };
}

async function resumoFinanceiro(ctx: Ctx, period?: string, year?: string) {
  const f = await financeData(ctx, period, year);
  return {
    ...(period ? { periodo: period } : { periodo: 'todos os períodos' }), ...(year ? { anoLectivo: year } : {}), limitadoA3000PorArea: f.truncated,
    criterio: 'Facturas filtradas pela data de vencimento e despesas pela data da despesa. Valores informativos, não são fecho contabilístico.',
    ...(f.canInv ? {
      propinas: {
        numeroFacturas: f.invoices.length, facturadoKz: f.billed, cobradoKz: f.paid, emAtrasoKz: f.overdue, pendenteKz: f.pending,
        taxaCobrancaPercentagem: f.collectionRate, porEstado: f.statusRows
      }
    } : { propinas: 'sem permissão para ver facturas' }),
    ...(f.canExp ? {
      despesas: { numeroDespesas: f.expenses.length, totalKz: f.expTotal, pagasKz: f.expPaid, porPagarKz: f.expTotal - f.expPaid, principaisCategorias: f.categories.slice(0, 8) }
    } : { despesas: 'sem permissão para ver despesas' }),
    ...(f.canInv && f.canExp ? { saldoIndicativoKz: f.paid - f.expPaid } : {})
  };
}

async function debtors(ctx: Ctx, year?: string, classFilter?: string) {
  const { rows, truncated } = await fetchRows(ctx, 'invoices', 'facturas', year);
  const cf = (classFilter || '').trim().toLocaleLowerCase('pt-PT');
  const late = rows.map((r) => r.data || {}).filter((d) => d.status === 'atraso' && (!cf || String(d.className ?? '').toLocaleLowerCase('pt-PT').includes(cf)));
  const map = new Map<string, { aluno: string; processo: string; turma: string; faturas: number; totalKz: number; maxDias: number }>();
  for (const d of late) {
    const key = String(d.studentId || d.procNumber || d.studentName);
    const cur = map.get(key) || { aluno: str(d.studentName), processo: str(d.procNumber), turma: str(d.className), faturas: 0, totalKz: 0, maxDias: 0 };
    cur.faturas++; cur.totalKz += num(d.totalAmountKz); cur.maxDias = Math.max(cur.maxDias, num(d.daysLate));
    map.set(key, cur);
  }
  const list = [...map.values()].sort((a, b) => b.totalKz - a.totalKz);
  return { list, truncated, totalKz: list.reduce((n, x) => n + x.totalKz, 0), faturas: late.length };
}

/* ───────────── relatórios ───────────── */
async function buildReport(ctx: Ctx, type: ReportType, opts: { period?: string; year?: string }): Promise<{ title: string; sections: ReportSection[]; notes: string[] }> {
  const notes: string[] = [];
  const sections: ReportSection[] = [];
  const cap = (truncated: boolean) => { if (truncated) notes.push(`A consulta foi limitada aos ${nf(MAX_ROWS)} registos mais recentes.`); };
  const yearNote = opts.year ? ` — ano lectivo ${opts.year}` : '';

  if (type === 'school_overview') {
    const kpis: { label: string; value: string }[] = [];
    for (const area of AREA_KEYS) {
      try { const m = await indicador(ctx, area, opts.year); kpis.push({ label: m.area[0].toUpperCase() + m.area.slice(1), value: nf(m.totalRegistos) }); } catch (e) { if (!(e instanceof DeniedError)) throw e; }
    }
    sections.push({ heading: 'Indicadores gerais (número de registos)', kpis });
    try {
      const s = await estatisticasAlunos(ctx, opts.year);
      sections.push({ heading: 'Alunos por estado', table: { columns: [{ header: 'Estado' }, { header: 'Alunos', align: 'right', width: 30 }], rows: s.porEstado.map((x) => [x.nome, nf(x.total)]) } });
      sections.push({ heading: 'Alunos por classe', table: { columns: [{ header: 'Classe' }, { header: 'Alunos', align: 'right', width: 30 }], rows: s.porClasse.map((x) => [x.nome, nf(x.total)]) } });
    } catch (e) { if (!(e instanceof DeniedError)) throw e; }
    try {
      const f = await financeData(ctx, opts.period, opts.year);
      const k = [];
      if (f.canInv) k.push({ label: 'Facturação (propinas)', value: kz(f.billed) }, { label: 'Cobrado', value: kz(f.paid) }, { label: 'Em atraso', value: kz(f.overdue) });
      if (f.canExp) k.push({ label: 'Despesas registadas', value: kz(f.expTotal) });
      if (k.length) sections.push({ heading: 'Situação financeira', kpis: k });
      cap(f.truncated);
    } catch (e) { if (!(e instanceof DeniedError)) throw e; }
    notes.push('Os indicadores contam todos os registos de cada área, salvo indicação de ano lectivo.');
    return { title: `Resumo geral da instituição${yearNote}`, sections, notes };
  }

  if (type === 'students_list') {
    const { rows, truncated } = await fetchRows(ctx, 'students', 'alunos', opts.year);
    cap(truncated);
    const d = rows.map((r) => r.data || {}).sort((a, b) => ptSort(str(a.className, ''), str(b.className, '')) || ptSort(str(a.name, ''), str(b.name, '')));
    const st = countBy(d, (x) => studentStatus(x.status));
    sections.push({ heading: 'Resumo', kpis: [{ label: 'Total de alunos', value: nf(d.length) }, ...st.map((x) => ({ label: x.nome, value: nf(x.total) }))] });
    sections.push({
      heading: 'Lista de alunos', table: {
        columns: [{ header: 'Nº' , width: 10 }, { header: 'Nº Processo', width: 26 }, { header: 'Nome' }, { header: 'Classe', width: 20 }, { header: 'Turma', width: 28 }, { header: 'Estado', width: 24 }],
        rows: d.map((x, i) => [i + 1, str(x.procNumber), str(x.name), str(x.grade), str(x.className), studentStatus(x.status)])
      }
    });
    return { title: `Lista de alunos${yearNote}`, sections, notes };
  }

  if (type === 'classes_list') {
    const { rows, truncated } = await fetchRows(ctx, 'classes', 'turmas', opts.year);
    cap(truncated);
    const s = classStats(rows);
    sections.push({ heading: 'Resumo', kpis: [{ label: 'Total de turmas', value: nf(s.list.length) }, { label: 'Alunos nas turmas', value: nf(s.totalAlunos) }, { label: 'Capacidade total', value: nf(s.capacidadeTotal) }, { label: 'Turmas acima da lotação', value: nf(s.acimaDaLotacao) }] });
    const sorted = [...s.list].sort((a, b) => ptSort(a.turma, b.turma));
    sections.push({
      heading: 'Lista de turmas', table: {
        columns: [{ header: 'Turma' }, { header: 'Classe', width: 22 }, { header: 'Turno', width: 24 }, { header: 'Sala', width: 20 }, { header: 'Alunos', align: 'right', width: 18 }, { header: 'Capac.', align: 'right', width: 18 }, { header: 'Ocupação', align: 'right', width: 22 }],
        rows: sorted.map((c) => [c.turma, c.classe, c.turno, c.sala, c.alunos, c.capacidade || '—', c.ocupacao === null ? '—' : `${c.ocupacao}%`])
      }
    });
    return { title: `Lista de turmas${yearNote}`, sections, notes };
  }

  if (type === 'finance_summary') {
    const f = await financeData(ctx, opts.period, opts.year);
    cap(f.truncated);
    const label = opts.period ? ` — ${opts.period}` : '';
    if (f.canInv) {
      sections.push({
        heading: 'Propinas', kpis: [
          { label: 'Facturas consideradas', value: nf(f.invoices.length) }, { label: 'Facturado', value: kz(f.billed) }, { label: 'Cobrado', value: kz(f.paid) },
          { label: 'Em atraso', value: kz(f.overdue) }, { label: 'Pendente', value: kz(f.pending) }, { label: 'Taxa de cobrança', value: f.collectionRate === null ? '—' : `${f.collectionRate}%` }
        ]
      });
      sections.push({ heading: 'Facturas por estado', table: { columns: [{ header: 'Estado' }, { header: 'Facturas', align: 'right', width: 28 }, { header: 'Valor (Kz)', align: 'right', width: 48 }], rows: f.statusRows.map((r) => [r.estado, nf(r.n), nf(r.total)]) } });
    }
    if (f.canExp) {
      sections.push({ heading: 'Despesas', kpis: [{ label: 'Número de despesas', value: nf(f.expenses.length) }, { label: 'Total registado', value: kz(f.expTotal) }, { label: 'Pagas', value: kz(f.expPaid) }, { label: 'Por pagar', value: kz(f.expTotal - f.expPaid) }] });
      if (f.categories.length) sections.push({ heading: 'Despesas por categoria', table: { columns: [{ header: 'Categoria' }, { header: 'Nº', align: 'right', width: 20 }, { header: 'Total (Kz)', align: 'right', width: 48 }], rows: f.categories.map((c) => [c.nome, nf(c.n), nf(c.total)]) } });
    }
    if (f.canInv && f.canExp) sections.push({ heading: 'Saldo indicativo', kpis: [{ label: 'Cobrado menos despesas pagas', value: kz(f.paid - f.expPaid) }] });
    notes.push('Facturas filtradas pela data de vencimento e despesas pela data da despesa. Resumo informativo; não substitui o fecho contabilístico oficial.');
    return { title: `Resumo financeiro${label}${yearNote}`, sections, notes };
  }

  if (type === 'overdue_invoices') {
    const x = await debtors(ctx, opts.year);
    cap(x.truncated);
    sections.push({ heading: 'Resumo', kpis: [{ label: 'Alunos com facturas em atraso', value: nf(x.list.length) }, { label: 'Facturas em atraso', value: nf(x.faturas) }, { label: 'Valor total em atraso', value: kz(x.totalKz) }] });
    sections.push({
      heading: 'Alunos devedores (do maior para o menor valor)', table: {
        columns: [{ header: 'Aluno' }, { header: 'Nº Proc.', width: 22 }, { header: 'Turma', width: 28 }, { header: 'Facturas', align: 'right', width: 18 }, { header: 'Valor (Kz)', align: 'right', width: 30 }, { header: 'Máx. dias', align: 'right', width: 18 }],
        rows: x.list.map((r) => [r.aluno, r.processo, r.turma, r.faturas, nf(r.totalKz), r.maxDias])
      }
    });
    return { title: `Facturas em atraso${yearNote}`, sections, notes };
  }

  if (type === 'expenses_list') {
    const { rows, truncated } = await fetchRows(ctx, 'expenses', 'despesas', opts.year);
    cap(truncated);
    const d = rows.map((r) => r.data || {}).filter((x) => inPeriod(x.date, opts.period)).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    const total = d.reduce((n, x) => n + num(x.amount), 0);
    const paid = d.filter((x) => x.paidDate).reduce((n, x) => n + num(x.amount), 0);
    sections.push({ heading: 'Resumo', kpis: [{ label: 'Número de despesas', value: nf(d.length) }, { label: 'Total', value: kz(total) }, { label: 'Pagas', value: kz(paid) }, { label: 'Por pagar', value: kz(total - paid) }] });
    sections.push({
      heading: 'Despesas', table: {
        columns: [{ header: 'Data', width: 24 }, { header: 'Categoria', width: 36 }, { header: 'Descrição' }, { header: 'Valor (Kz)', align: 'right', width: 30 }, { header: 'Estado', width: 20 }],
        rows: d.map((x) => [str(x.date), str(x.category), str(x.description), nf(num(x.amount)), x.paidDate ? 'Paga' : 'Por pagar'])
      }
    });
    return { title: `Despesas${opts.period ? ` — ${opts.period}` : ''}${yearNote}`, sections, notes };
  }

  if (type === 'teachers_list') {
    const { rows, truncated } = await fetchRows(ctx, 'teachers', 'professores');
    cap(truncated);
    const d = rows.map((r) => r.data || {}).sort((a, b) => ptSort(str(a.name, ''), str(b.name, '')));
    sections.push({ heading: 'Resumo', kpis: [{ label: 'Total de professores', value: nf(d.length) }] });
    sections.push({ heading: 'Professores', table: { columns: [{ header: 'Nº', width: 10 }, { header: 'Nº Agente', width: 28 }, { header: 'Nome' }, { header: 'Departamento', width: 50 }, { header: 'Estado', width: 22 }], rows: d.map((x, i) => [i + 1, str(x.agentNumber), str(x.name), str(x.department), str(x.status)]) } });
    return { title: 'Lista de professores', sections, notes };
  }

  // staff_list
  const { rows, truncated } = await fetchRows(ctx, 'funcionarios', 'funcionários');
  cap(truncated);
  const d = rows.map((r) => r.data || {}).sort((a, b) => ptSort(str(a.name, ''), str(b.name, '')));
  sections.push({ heading: 'Resumo', kpis: [{ label: 'Total de funcionários', value: nf(d.length) }] });
  sections.push({ heading: 'Funcionários', table: { columns: [{ header: 'Nº', width: 10 }, { header: 'Nº Func.', width: 26 }, { header: 'Nome' }, { header: 'Cargo', width: 40 }, { header: 'Departamento', width: 40 }, { header: 'Estado', width: 20 }], rows: d.map((x, i) => [i + 1, str(x.employeeNumber), str(x.name), str(x.cargo), str(x.department), str(x.status)]) } });
  return { title: 'Lista de funcionários', sections, notes };
}

async function institutionName(ctx: Ctx): Promise<string> {
  if (ctx.institutionName) return ctx.institutionName;
  const { data } = await ctx.admin.from('institutions').select('name').eq('id', ctx.caller.institutionId).maybeSingle();
  ctx.institutionName = String(data?.name || ctx.caller.institutionId);
  return ctx.institutionName;
}

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

async function deliverReport(ctx: Ctx, type: ReportType, format: 'pdf' | 'xlsx', opts: { period?: string; year?: string; title?: string }) {
  const built = await buildReport(ctx, type, opts);
  const title = opts.title?.trim().slice(0, 100) || built.title;
  const doc: ReportDoc = {
    title, institution: await institutionName(ctx), issuer: `${ctx.caller.name} (${ctx.caller.role})`,
    generatedAt: new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' }), sections: built.sections, notes: built.notes
  };
  const bytes = format === 'xlsx' ? await renderXlsx(doc) : renderPdf(doc);
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('O documento excede 5 MB. Peça um período ou um ano lectivo mais curto.');

  const id = randomUUID();
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || 'Relatorio';
  const filename = `${base}_${new Date().toISOString().slice(0, 10)}.${format}`;
  const storagePath = `${ctx.caller.institutionId}/whatsapp_ai/${ctx.caller.uid}/${id}.${format}`;
  const { error: upErr } = await ctx.admin.storage.from('school-files').upload(storagePath, bytes, { contentType: MIME[format], upsert: false });
  if (upErr) { console.error('BANDGESTAO AI: falha ao arquivar documento:', upErr.message); throw new Error('Não foi possível arquivar o documento na instituição.'); }
  const { error: dbErr } = await ctx.admin.from('whatsapp_ai_documents').insert({
    id, institution_id: ctx.caller.institutionId, user_id: ctx.caller.uid, document_type: type, title, filename, storage_path: storagePath, file_format: format
  });
  if (dbErr) {
    await ctx.admin.storage.from('school-files').remove([storagePath]);
    console.error('BANDGESTAO AI: falha ao guardar metadados:', dbErr.message);
    throw new Error('Não foi possível guardar o registo do documento. Confirme que a migração 0049 foi aplicada.');
  }
  const audit = (action: string) => ctx.admin.rpc('write_audit_event_service', {
    p_inst: ctx.caller.institutionId, p_actor: ctx.caller.uid, p_action: action, p_entity: 'whatsapp_ai_documents', p_entity_id: id,
    p_detail: { filename, documentType: type, format }
  }).then(() => undefined, () => undefined);

  const { data: signed, error: signErr } = await ctx.admin.storage.from('school-files').createSignedUrl(storagePath, 3600);
  if (signErr || !signed?.signedUrl) { await audit('whatsapp_ai_document_saved_delivery_failed'); throw new Error('Documento arquivado, mas não foi possível preparar o envio pelo WhatsApp.'); }
  try {
    await sendWhatsAppDocument(ctx.phone, signed.signedUrl, filename, `${title} — arquivado no BANDGESTÃO.`);
  } catch {
    await audit('whatsapp_ai_document_saved_delivery_failed');
    return { success: true, sentToWhatsApp: false, filename, message: 'Documento arquivado no BANDGESTÃO, mas o WhatsApp não confirmou a entrega. Pode abri-lo em BANDGESTÃO AI → Documentos.' };
  }
  await audit('whatsapp_ai_document_generated');
  return { success: true, sentToWhatsApp: true, filename, message: `${format === 'xlsx' ? 'Excel' : 'PDF'} «${title}» enviado nesta conversa e arquivado no BANDGESTÃO.` };
}

/* ───────────── definição das ferramentas para os modelos ───────────── */
const areaProp = { type: 'string', enum: AREA_KEYS, description: 'Área da instituição.' };
const yearProp = { type: 'string', description: 'Ano lectivo no formato 2026/2027 (opcional).' };
const periodProp = { type: 'string', description: 'Período AAAA ou AAAA-MM, por exemplo 2026-10 (opcional).' };

export const TOOL_SPECS: ToolSpec[] = [
  { name: 'consultar_indicador', description: 'Número de registos de uma área (alunos, turmas, professores, funcionários, propinas, despesas, assiduidade, admissões, trabalhos). Devolve só totais.', parameters: { type: 'object', properties: { area: areaProp, anoLectivo: yearProp }, required: ['area'] } },
  { name: 'pesquisar_registos', description: 'Procura registos pelo nome, número de processo/agente/funcionário, número de factura ou título. Devolve só campos básicos; nunca dados médicos, BI, morada, contactos ou credenciais.', parameters: { type: 'object', properties: { area: areaProp, termo: { type: 'string', description: 'Texto a procurar (mínimo 2 caracteres).' } }, required: ['area', 'termo'] } },
  { name: 'estatisticas_alunos', description: 'Distribuição dos alunos por estado, classe, género e turmas com mais alunos.', parameters: { type: 'object', properties: { anoLectivo: yearProp } } },
  { name: 'estado_turmas', description: 'Número de turmas, lotação, ocupação geral e turmas mais cheias ou acima da capacidade.', parameters: { type: 'object', properties: { anoLectivo: yearProp } } },
  { name: 'resumo_financeiro', description: 'Resumo de propinas (facturado, cobrado, em atraso, taxa de cobrança) e despesas, por período opcional. Informativo, não é fecho contabilístico.', parameters: { type: 'object', properties: { periodo: periodProp, anoLectivo: yearProp } } },
  { name: 'listar_dividas', description: 'Alunos com facturas em atraso, ordenados pelo valor em dívida. Pode filtrar por turma.', parameters: { type: 'object', properties: { limite: { type: 'integer', description: 'Quantos alunos listar (1 a 25, por omissão 10).' }, turma: { type: 'string', description: 'Parte do nome da turma (opcional).' }, anoLectivo: yearProp } } },
  { name: 'resumo_despesas', description: 'Despesas totais, pagas e por pagar, por categoria e as maiores despesas, por período opcional.', parameters: { type: 'object', properties: { periodo: periodProp, categoria: { type: 'string', description: 'Parte do nome da categoria (opcional).' }, anoLectivo: yearProp } } },
  {
    name: 'gerar_relatorio',
    description: 'Gera um documento PDF ou Excel profissional, arquiva-o no BANDGESTÃO e envia-o na conversa. Usar apenas quando a pessoa pedir explicitamente um relatório, documento, PDF, Excel ou ficheiro.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: REPORT_TYPES, description: 'school_overview=resumo geral; students_list=lista de alunos; classes_list=lista de turmas; finance_summary=resumo financeiro; overdue_invoices=facturas em atraso; expenses_list=despesas; teachers_list=professores; staff_list=funcionários.' },
        formato: { type: 'string', enum: ['pdf', 'xlsx'], description: 'pdf por omissão; xlsx se pedirem Excel/folha de cálculo.' },
        titulo: { type: 'string', description: 'Título do documento (opcional).' },
        periodo: periodProp, anoLectivo: yearProp
      },
      required: ['tipo']
    }
  }
];

/* ───────────── executor ───────────── */
export function createToolExecutor(admin: SupabaseClient, caller: WhatsAppCaller, phone: string): ToolExecutor {
  const ctx: Ctx = { admin, caller, phone };
  let linkChecked = false;

  // A ligação WhatsApp é reconfirmada antes da primeira ferramenta de cada pedido.
  const ensureLink = async () => {
    if (linkChecked) return;
    const { data: link } = await admin.from('whatsapp_ai_links').select('active')
      .eq('user_id', caller.uid).eq('institution_id', caller.homeInstitutionId).eq('phone_e164', phone).eq('active', true).maybeSingle();
    if (!link?.active) throw new DeniedError('Ligação do WhatsApp inválida ou desactivada.');
    linkChecked = true;
  };

  return async (name, args): Promise<ToolOutcome> => {
    try {
      await ensureLink();
      const year = checkYear(args.anoLectivo);
      const period = checkPeriod(args.periodo);
      const area = (a: unknown): AreaKey => { if (!AREA_KEYS.includes(a as AreaKey)) throw new Error('Área não reconhecida.'); return a as AreaKey; };
      switch (name) {
        case 'consultar_indicador': return { result: { success: true, ...(await indicador(ctx, area(args.area), year)) } };
        case 'pesquisar_registos': return { result: { success: true, ...(await pesquisar(ctx, area(args.area), String(args.termo || ''))) } };
        case 'estatisticas_alunos': return { result: { success: true, ...(await estatisticasAlunos(ctx, year)) } };
        case 'estado_turmas': return { result: { success: true, ...(await estadoTurmas(ctx, year)) } };
        case 'resumo_financeiro': return { result: { success: true, ...(await resumoFinanceiro(ctx, period, year)) } };
        case 'listar_dividas': {
          const limit = Math.min(25, Math.max(1, Math.round(num(args.limite)) || 10));
          const x = await debtors(ctx, year, String(args.turma || ''));
          return { result: { success: true, alunosComDivida: x.list.length, facturasEmAtraso: x.faturas, totalEmAtrasoKz: x.totalKz, limitadoA3000: x.truncated, maioresDividas: x.list.slice(0, limit) } };
        }
        case 'resumo_despesas': {
          const { rows, truncated } = await fetchRows(ctx, 'expenses', 'despesas', year);
          const cat = String(args.categoria || '').trim().toLocaleLowerCase('pt-PT');
          const d = rows.map((r) => r.data || {}).filter((x) => inPeriod(x.date, period) && (!cat || String(x.category ?? '').toLocaleLowerCase('pt-PT').includes(cat)));
          const total = d.reduce((n, x) => n + num(x.amount), 0);
          const paid = d.filter((x) => x.paidDate).reduce((n, x) => n + num(x.amount), 0);
          const cats = new Map<string, number>();
          d.forEach((x) => cats.set(str(x.category, 'Sem categoria'), (cats.get(str(x.category, 'Sem categoria')) || 0) + num(x.amount)));
          return {
            result: {
              success: true, periodo: period || 'todos os períodos', numeroDespesas: d.length, totalKz: total, pagasKz: paid, porPagarKz: total - paid, limitadoA3000: truncated,
              porCategoria: [...cats.entries()].map(([nome, totalKz]) => ({ nome, totalKz })).sort((a, b) => b.totalKz - a.totalKz).slice(0, 10),
              maioresDespesas: [...d].sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 5).map((x) => ({ data: str(x.date), categoria: str(x.category), descricao: str(x.description).slice(0, 80), valorKz: num(x.amount), paga: !!x.paidDate }))
            }
          };
        }
        case 'gerar_relatorio': {
          const type = args.tipo as ReportType;
          if (!REPORT_TYPES.includes(type)) throw new Error('Tipo de relatório não suportado.');
          const format = args.formato === 'xlsx' ? 'xlsx' : 'pdf';
          const result = await deliverReport(ctx, type, format, { period, year, title: String(args.titulo || '') });
          return { result, finalText: result.success ? String(result.message) : undefined };
        }
        default: return { result: { success: false, message: 'Ferramenta não reconhecida.' } };
      }
    } catch (error) {
      const denied = error instanceof DeniedError;
      return { result: { success: false, ...(denied ? { permitido: false } : {}), message: error instanceof Error ? error.message : 'Não foi possível executar a consulta.' } };
    }
  };
}
