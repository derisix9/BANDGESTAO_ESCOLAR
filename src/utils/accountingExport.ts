/**
 * Exportação da Contabilidade para Excel (.xlsx): monta as folhas (cabeçalho oficial, colunas, linha de total) e
 * entrega-as ao mesmo exportador dos Relatórios. Esta parte é pura (testável sem o Excel); só `exportAccountingExcel`
 * toca no ficheiro.
 */
import type { XlsxCol, XlsxReportSpec } from './relatoriosExcelExport';
import type { AccountingBasis, BalanceSheet, Posting, TrialBalance } from './accounting';

export interface ExportContext {
  schoolName: string;
  logoUrl?: string;
  nif?: string;
  /** Texto do período, ex.: «Ano 2026» ou «Todo o período». */
  periodLabel: string;
  basis: AccountingBasis;
  depreciation: boolean;
  /** DD de mês de AAAA — injectável para os testes. */
  issuedOn?: string;
}

const KZ_FMT = '#,##0.00" Kz"';
const NAVY = { totFill: '0B1F3A', totColor: 'FFFFFF' };
const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const basisLabel = (c: ExportContext) =>
  `${c.basis === 'acrescimo' ? 'Regime de acréscimo' : 'Regime de caixa'}${c.depreciation ? ' + amortizações' : ''}`;

const baseSpec = (c: ExportContext, title: string, sheetName: string, file: string): XlsxReportSpec => ({
  fileName: `${file}-${slug(c.periodLabel)}.xlsx`,
  sheetName,
  schoolName: c.schoolName,
  logoUrl: c.logoUrl,
  title,
  meta: [
    { label: 'Período:', value: c.periodLabel },
    { label: 'Base:', value: basisLabel(c) },
    { label: 'NIF & Alvará:', value: c.nif || '—' },
    { label: 'Data de Emissão:', value: c.issuedOn || new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' }) }
  ],
  signatures: ['O Contabilista', 'A Tesouraria', 'A Direcção Geral'],
  columns: [],
  rows: []
});

const NOTE = 'Plano de contas simplificado, baseado no PGC angolano (Decreto n.º 82/01): confirme-o com o contabilista da escola antes de uso oficial.';

export function trialBalanceSpec(tb: TrialBalance, c: ExportContext): XlsxReportSpec {
  const spec = baseSpec(c, 'Balancete de Verificação', 'Balancete', 'balancete-verificacao');
  const col = (header: string, extra: Partial<XlsxCol> = {}): XlsxCol => ({ header, width: 20, align: 'right', numFmt: KZ_FMT, ...NAVY, ...extra });
  spec.columns = [
    { header: 'Conta', width: 10, bold: true, ...NAVY },
    { header: 'Designação', width: 52, ...NAVY },
    col('Débito'), col('Crédito'), col('Saldo devedor'), col('Saldo credor')
  ];
  spec.rows = tb.rows.map((r) => [r.account.code, r.account.name, r.debit, r.credit, r.balanceDebit, r.balanceCredit]);
  spec.total = ['TOTAL', '', tb.totalDebit, tb.totalCredit, tb.totalBalanceDebit, tb.totalBalanceCredit];
  spec.footnote = `Proveitos ${tb.proveitos.toFixed(2)} Kz · Custos ${tb.custos.toFixed(2)} Kz · Resultado ${tb.resultado.toFixed(2)} Kz. ${tb.balanced ? 'Débitos e créditos equilibrados.' : 'ATENÇÃO: débitos e créditos NÃO estão equilibrados.'} ${NOTE}`;
  spec.emptyMessage = 'Sem movimentos neste período.';
  return spec;
}

export function postingsSpec(postings: Posting[], c: ExportContext): XlsxReportSpec {
  const spec = baseSpec(c, 'Diário de Lançamentos', 'Lançamentos', 'lancamentos');
  spec.columns = [
    { header: 'Data', width: 12, ...NAVY },
    { header: 'Descrição', width: 58, ...NAVY },
    { header: 'Referência', width: 18, ...NAVY },
    { header: 'Conta', width: 10, bold: true, ...NAVY },
    { header: 'Débito', width: 18, align: 'right', numFmt: KZ_FMT, ...NAVY },
    { header: 'Crédito', width: 18, align: 'right', numFmt: KZ_FMT, ...NAVY },
    { header: 'Origem', width: 14, ...NAVY }
  ];
  const origem = { auto: 'Automático', manual: 'Manual', amortizacao: 'Amortização', fecho: 'Fecho do ano' } as const;
  const sorted = [...postings].sort((a, b) => a.date.localeCompare(b.date));
  spec.rows = sorted.flatMap((p) =>
    p.lines.map((l, i) => [i === 0 ? p.date : '', i === 0 ? p.description : '', i === 0 ? (p.reference || '') : '', l.account, l.debit || 0, l.credit || 0, i === 0 ? origem[p.source] : ''])
  );
  const d = Math.round(sorted.reduce((s, p) => s + p.lines.reduce((x, l) => x + (l.debit || 0), 0), 0) * 100) / 100;
  const k = Math.round(sorted.reduce((s, p) => s + p.lines.reduce((x, l) => x + (l.credit || 0), 0), 0) * 100) / 100;
  spec.total = ['TOTAL', '', '', '', d, k, ''];
  spec.footnote = NOTE;
  spec.emptyMessage = 'Sem lançamentos neste período.';
  return spec;
}

export function balanceSheetSpec(bs: BalanceSheet, c: ExportContext): XlsxReportSpec {
  const spec = baseSpec(c, `Balanço em ${bs.asOf.split('-').reverse().join('/')}`, 'Balanço', 'balanco');
  spec.meta[0] = { label: 'Data do balanço:', value: bs.asOf.split('-').reverse().join('/') };
  spec.columns = [
    { header: 'Conta', width: 10, bold: true, ...NAVY },
    { header: 'Designação', width: 58, ...NAVY },
    { header: 'Valor', width: 22, align: 'right', numFmt: KZ_FMT, ...NAVY }
  ];
  const sec = (s: { title: string; lines: { code?: string; label: string; amount: number }[]; total: number }): unknown[][] => [
    ['', s.title.toUpperCase(), s.total],
    ...s.lines.map((l) => [l.code || '', `    ${l.label}`, l.amount])
  ];
  spec.rows = [
    ...sec(bs.activoNaoCorrente), ...sec(bs.activoCorrente), ['', 'TOTAL DO ACTIVO', bs.totalActivo],
    ...sec(bs.capitalProprio), ...sec(bs.passivoCorrente), ['', 'TOTAL DO CAPITAL PRÓPRIO E PASSIVO', bs.totalCapitalEPassivo]
  ];
  spec.footnote = `${bs.balanced ? 'Activo = capital próprio + passivo.' : 'ATENÇÃO: o activo não é igual ao capital próprio + passivo.'} Salários a líquido (INSS patronal e retenções não separados). ${NOTE}`;
  spec.emptyMessage = 'Sem saldos até esta data.';
  return spec;
}

export async function exportAccountingExcel(spec: XlsxReportSpec): Promise<void> {
  const { exportReportExcel } = await import('./relatoriosExcelExport');
  await exportReportExcel(spec);
}
