import React, { useMemo, useState } from 'react';
import type { JournalLine, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { AppConfirmModal } from '../components/AppConfirmModal';
import {
  CHART, KIND_LABELS, DEFAULT_USEFUL_LIFE_YEARS, accountByCode, buildClosingEntry, buildPostings, computeBalanceSheet,
  computeTrialBalance, isClosingStale, resolveAccountingOptions, validateJournal, type AccountingOptions, type Posting
} from '../utils/accounting';
import { balanceSheetSpec, exportAccountingExcel, postingsSpec, trialBalanceSpec, type ExportContext } from '../utils/accountingExport';
import { ASSET_CATEGORY_LABELS } from './InventarioAtivosView';
import { Notice } from '../components/Notice';

const RULE = 'financeiro.balancete.manage';
const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const kz = (v: number) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT');
const todayIso = () => new Date().toISOString().slice(0, 10);
const blankLines = (): JournalLine[] => [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }];

type Tab = 'balancete' | 'balanco' | 'lancamentos' | 'fecho' | 'opcoes' | 'plano';

const TAB_TITLES: Record<Tab, string> = {
  balancete: 'Balancete de Verificação', balanco: 'Balanço', lancamentos: 'Diário de Lançamentos',
  fecho: 'Fecho do Ano', opcoes: 'Opções da Contabilidade', plano: 'Plano de Contas'
};

/** 'todo' | AAAA | AAAA-MM → intervalo de datas. */
function rangeOf(period: string): { from?: string; to?: string } {
  if (!period || period === 'todo') return {};
  if (/^\d{4}$/.test(period)) return { from: `${period}-01-01`, to: `${period}-12-31` };
  return { from: `${period}-01`, to: `${period}-31` };
}

/** Último dia do período escolhido (para o balanço): AAAA → 31/12, AAAA-MM → último dia do mês, todo → hoje. */
function asOfOf(period: string, today: string): string {
  if (!period || period === 'todo') return today;
  if (/^\d{4}$/.test(period)) return `${period}-12-31`;
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

interface Props { db: SchoolDatabase; currentUserRole: UserRole }

export const ContabilidadeView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const [tab, setTab] = useState<Tab>('balancete');
  const [period, setPeriod] = useState('todo');
  const [modal, setModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jDate, setJDate] = useState(todayIso());
  const [jDesc, setJDesc] = useState('');
  const [jRef, setJRef] = useState('');
  const [jLines, setJLines] = useState<JournalLine[]>(blankLines());

  const manual = db.journalEntries || [];
  const today = todayIso();
  const options: AccountingOptions = useMemo(() => resolveAccountingOptions(db.settings?.accountingOptions), [db.settings?.accountingOptions]);
  const [livesDraft, setLivesDraft] = useState<Record<string, string>>({});
  const [closeYear, setCloseYear] = useState<number | null>(null);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const postings: Posting[] = useMemo(
    () => buildPostings(
      { invoices: (db.invoices || []) as any, expenses: (db.expenses || []) as any, payroll: (db.payrollRecords || []) as any, assets: (db.assets || []) as any, manual },
      options, today
    ),
    [db.invoices, db.expenses, db.payrollRecords, db.assets, manual, options, today]
  );
  const periodOptions = useMemo(() => {
    const months = [...new Set(postings.map((p) => p.date.slice(0, 7)))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    return [
      { value: 'todo', label: 'Todo o período' },
      ...years.map((y) => ({ value: y, label: `Ano ${y}` })),
      ...months.map((m) => ({ value: m, label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` }))
    ];
  }, [postings]);
  const range = rangeOf(period);
  const tb = useMemo(() => computeTrialBalance(postings, range), [postings, period]);
  const asOf = asOfOf(period, today);
  const bs = useMemo(() => computeBalanceSheet(postings, asOf), [postings, asOf]);
  const years = useMemo(() => [...new Set(postings.filter((p) => !p.closing).map((p) => Number(p.date.slice(0, 4))))].filter((y) => y > 2000).sort((a, b) => b - a), [postings]);
  const closings = useMemo(() => manual.filter((j) => j.closingYear), [manual]);
  const periodLabel = periodOptions.find((o) => o.value === period)?.label || 'Todo o período';
  const shownPostings = postings.filter((p) => (!range.from || p.date >= range.from) && (!range.to || p.date <= range.to));

  const totD = jLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totC = jLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const setLine = (i: number, patch: Partial<JournalLine>) => setJLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const openNew = () => { setJDate(todayIso()); setJDesc(''); setJRef(''); setJLines(blankLines()); setError(null); setModal(true); };

  const handleSave = async () => {
    setError(null);
    const lines = jLines.filter((l) => l.account || l.debit || l.credit);
    const errs = validateJournal(jDate, jDesc, lines);
    if (errs.length) { setError(errs[0]); return; }
    try {
      await runGlobalOperation(
        () => { const r = dbService.saveJournalEntry({ date: jDate, description: jDesc, reference: jRef, lines }); if (!r.success) throw new Error(r.error); },
        { loadingMessage: 'A registar lançamento...', requiredRule: RULE, userRole: currentUserRole }
      );
      setModal(false);
    } catch (e: any) { setError(e?.message || 'Não foi possível guardar.'); }
  };

  const handleDelete = async () => {
    const id = deletingId; setDeletingId(null);
    if (!id) return;
    try {
      await runGlobalOperation(
        () => { const r = dbService.deleteJournalEntry(id); if (!r.success) throw new Error(r.error); },
        { loadingMessage: 'A eliminar lançamento...', requiredRule: RULE, userRole: currentUserRole }
      );
    } catch { /* erro já mostrado */ }
  };

  const saveOptions = async (next: AccountingOptions) => {
    setError(null);
    try {
      await runGlobalOperation(
        () => { dbService.updateSettings({ accountingOptions: { basis: next.basis, depreciation: next.depreciation, usefulLifeYears: next.usefulLifeYears } }); },
        { loadingMessage: 'A guardar opções da contabilidade...', requiredRule: RULE, userRole: currentUserRole }
      );
    } catch (e: any) { setError(e?.message || 'Não foi possível guardar.'); }
  };

  const saveLives = () => {
    const lives: Record<string, number> = { ...(options.usefulLifeYears || {}) };
    for (const [k, v] of Object.entries(livesDraft)) {
      if (v === '') { delete lives[k]; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 50) { setError('A vida útil tem de estar entre 1 e 50 anos.'); return; }
      lives[k] = Math.round(n);
    }
    setLivesDraft({});
    void saveOptions({ ...options, usefulLifeYears: lives });
  };

  const doClose = async () => {
    const year = closeYear; setCloseYear(null);
    if (!year) return;
    const c = buildClosingEntry(postings, year);
    if (!c) { setError(`O ano ${year} não tem proveitos nem custos para apurar.`); return; }
    try {
      await runGlobalOperation(
        () => { const r = dbService.saveJournalEntry({ date: c.date, description: c.description, lines: c.lines, closingYear: year }); if (!r.success) throw new Error(r.error); },
        { loadingMessage: `A fechar o ano ${year}...`, requiredRule: RULE, userRole: currentUserRole }
      );
    } catch (e: any) { setError(e?.message || 'Não foi possível fechar o ano.'); }
  };

  const doReopen = async () => {
    const id = reopenId; setReopenId(null);
    if (!id) return;
    try {
      await runGlobalOperation(
        () => { const r = dbService.deleteJournalEntry(id); if (!r.success) throw new Error(r.error); },
        { loadingMessage: 'A reabrir o ano...', requiredRule: RULE, userRole: currentUserRole }
      );
    } catch { /* erro já mostrado */ }
  };

  const exportCtx = (): ExportContext => ({
    schoolName: db.settings?.schoolName || 'Instituto Médio Politécnico BandMed', logoUrl: db.settings?.logoUrl, nif: db.settings?.nif,
    periodLabel: tab === 'balanco' ? `Em ${asOf.split('-').reverse().join('/')}` : periodLabel, basis: options.basis, depreciation: options.depreciation
  });
  const handleExport = async () => {
    setExporting(true); setError(null);
    try {
      const ctx = exportCtx();
      const spec = tab === 'balanco' ? balanceSheetSpec(bs, ctx) : tab === 'lancamentos' ? postingsSpec(shownPostings, ctx) : trialBalanceSpec(tb, ctx);
      await exportAccountingExcel(spec);
    } catch (e) { console.error('Falha ao exportar Excel', e); setError('Não foi possível gerar o ficheiro Excel. Tente novamente.'); }
    finally { setExporting(false); }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id} onClick={() => setTab(id)}
      className={`h-9 px-4 text-xs font-bold rounded-lg ${tab === id ? 'bg-[#0b1f3a] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
    >{label}</button>
  );

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">TESOURARIA</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">CONTABILIDADE</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">PLANO DE CONTAS E BALANCETE</h1>
          <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
            Partidas dobradas: propinas, despesas, salários e activos entram sozinhos; acrescente aqui os lançamentos manuais
            (capital, saldos de abertura, correcções). Isto é diferente do «Balancete de Propinas» das Estatísticas, que só mostra a cobrança por subsistema.
            Base actual: <strong>{options.basis === 'acrescimo' ? 'regime de acréscimo' : 'regime de caixa'}</strong>{options.depreciation ? ' com amortizações' : ''} (muda em «Opções»).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(tab === 'balancete' || tab === 'balanco' || tab === 'lancamentos') && (
            <button onClick={handleExport} disabled={exporting} className="h-9 px-4 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center gap-1.5 disabled:opacity-60">
              <span className="material-symbols-outlined text-[16px]">table_view</span>{exporting ? 'A gerar...' : 'Exportar Excel'}
            </button>
          )}
          <button onClick={() => window.print()} className="h-9 px-4 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">print</span>Imprimir
          </button>
          {canManage && (
            <button onClick={openNew} className="h-9 px-4 text-xs font-bold rounded-lg bg-[#0b1f3a] text-white flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">add</span>Novo lançamento
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap print:hidden">
        {tabBtn('balancete', 'Balancete de Verificação')}
        {tabBtn('balanco', 'Balanço')}
        {tabBtn('lancamentos', 'Lançamentos')}
        {tabBtn('fecho', 'Fecho do Ano')}
        {tabBtn('opcoes', 'Opções')}
        {tabBtn('plano', 'Plano de Contas')}
        {(tab === 'balancete' || tab === 'balanco' || tab === 'lancamentos') && (
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 px-3 border border-slate-300 text-xs bg-white ml-auto">
            {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      {error && !modal && <Notice tone="error">{error}</Notice>}

      {/* `printable-page`: sem isto o CSS global de impressão esconde tudo (a folha saía em branco) e os
          cabeçalhos «congelados» das tabelas deslocavam-se para o meio das linhas. */}
      <div className="printable-page flex flex-col gap-6" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>
      <div className="hidden print:block text-center mb-2">
        {db.settings?.logoUrl && <img src={db.settings.logoUrl} alt="" className="mx-auto mb-1 max-h-16 max-w-[160px] object-contain" />}
        <div className="text-sm font-extrabold uppercase text-[#0b1f3a]">{db.settings?.schoolName || 'Instituto Médio Politécnico BandMed'}</div>
        <div className="text-xs font-bold uppercase text-slate-700">
          {TAB_TITLES[tab]}
        </div>
        <div className="text-[10px] text-slate-500">
          {tab === 'balanco' ? `Em ${fmtDate(asOf)}` : tab === 'plano' || tab === 'opcoes' ? '' : `${periodLabel} · `}
          {options.basis === 'acrescimo' ? 'Regime de acréscimo' : 'Regime de caixa'}{options.depreciation ? ' + amortizações' : ''} · Emitido em {fmtDate(today)}
        </div>
      </div>

      {tab === 'balancete' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Proveitos', value: kz(tb.proveitos), tone: 'text-emerald-700' },
              { label: 'Custos', value: kz(tb.custos), tone: 'text-red-700' },
              { label: 'Resultado do período', value: kz(tb.resultado), tone: tb.resultado >= 0 ? 'text-emerald-700' : 'text-red-700' },
              { label: 'Débitos = Créditos?', value: tb.balanced ? 'Sim, equilibrado' : 'NÃO equilibrado', tone: tb.balanced ? 'text-emerald-700' : 'text-red-700' }
            ].map((k) => (
              <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className={`font-mono text-lg font-extrabold leading-none ${k.tone}`}>{k.value}</div>
                <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {tb.rows.length === 0 ? (
              <div className="py-16 text-center text-xs font-semibold text-slate-400">Sem movimentos neste período.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                      <th className="text-left px-4 py-3 text-white">Conta</th>
                      <th className="text-left px-4 py-3 text-white">Designação</th>
                      <th className="text-right px-4 py-3 text-white">Débito</th>
                      <th className="text-right px-4 py-3 text-white">Crédito</th>
                      <th className="text-right px-4 py-3 text-white">Saldo devedor</th>
                      <th className="text-right px-4 py-3 text-white">Saldo credor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {tb.rows.map((r) => (
                      <tr key={r.account.code}>
                        <td className="px-4 py-2.5 font-bold text-[#0b1f3a]">{r.account.code}</td>
                        <td className="px-4 py-2.5 font-sans text-slate-700">{r.account.name}</td>
                        <td className="px-4 py-2.5 text-right">{kz(r.debit)}</td>
                        <td className="px-4 py-2.5 text-right">{kz(r.credit)}</td>
                        <td className="px-4 py-2.5 text-right">{r.balanceDebit ? kz(r.balanceDebit) : '—'}</td>
                        <td className="px-4 py-2.5 text-right">{r.balanceCredit ? kz(r.balanceCredit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#0b1f3a] text-white font-mono font-bold">
                      <td className="px-4 py-3 font-sans" colSpan={2}>TOTAL</td>
                      <td className="px-4 py-3 text-right">{kz(tb.totalDebit)}</td>
                      <td className="px-4 py-3 text-right">{kz(tb.totalCredit)}</td>
                      <td className="px-4 py-3 text-right">{kz(tb.totalBalanceDebit)}</td>
                      <td className="px-4 py-3 text-right">{kz(tb.totalBalanceCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-400 print:hidden">
            {options.basis === 'acrescimo'
              ? 'Regime de acréscimo: propinas vencidas por receber e despesas/salários por pagar já contam. Salários a líquido (INSS patronal e retenções não separados).'
              : 'Regime de caixa: só entram propinas já recebidas e despesas/salários já pagos. Para ver o que está em atraso ou por pagar, mude para acréscimo em «Opções».'}
            {' '}Plano de contas simplificado (PGC angolano): confirme-o com o contabilista da escola.
          </p>
        </>
      )}

      {tab === 'lancamentos' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {shownPostings.length === 0 ? (
            <div className="py-16 text-center text-xs font-semibold text-slate-400">Sem lançamentos neste período.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                    <th className="text-left px-4 py-3 text-white">Data</th>
                    <th className="text-left px-4 py-3 text-white">Descrição</th>
                    <th className="text-left px-4 py-3 text-white">Débito</th>
                    <th className="text-left px-4 py-3 text-white">Crédito</th>
                    <th className="text-right px-4 py-3 text-white">Valor</th>
                    <th className="text-right px-4 py-3 text-white print:hidden">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownPostings.slice(0, 500).map((p) => {
                    const total = p.lines.reduce((s, l) => s + (l.debit || 0), 0);
                    return (
                      <tr key={p.id} className="align-top">
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtDate(p.date)}</td>
                        <td className="px-4 py-2.5 text-slate-800">{p.description}{p.reference ? <span className="text-slate-400"> · {p.reference}</span> : null}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{p.lines.filter((l) => l.debit > 0).map((l) => l.account).join(', ')}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{p.lines.filter((l) => l.credit > 0).map((l) => l.account).join(', ')}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{kz(total)}</td>
                        <td className="px-4 py-2.5 text-right print:hidden">
                          {p.source === 'manual' || p.source === 'fecho' ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">{p.source === 'fecho' ? 'Fecho do ano' : 'Manual'}</span>
                              {canManage && p.source === 'manual' && (
                                <button onClick={() => setDeletingId(p.id)} title="Eliminar" className="text-slate-400 hover:text-red-600">
                                  <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                              )}
                            </span>
                          ) : <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">{p.source === 'amortizacao' ? 'Amortização' : 'Automático'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shownPostings.length > 500 && <p className="p-3 text-[10px] text-slate-400">A mostrar os 500 mais recentes. Use o filtro de período para ver os restantes.</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'balanco' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-[#0b1f3a] uppercase tracking-wider">Balanço em {fmtDate(asOf)}</span>
            <span className={`text-[11px] font-bold ${bs.balanced ? 'text-emerald-700' : 'text-red-700'}`}>{bs.balanced ? 'Activo = Capital próprio + Passivo' : 'NÃO equilibrado'}</span>
          </div>
          {bs.totalActivo === 0 && bs.totalCapitalEPassivo === 0 ? (
            <div className="py-16 text-center text-xs font-semibold text-slate-400">Sem saldos até esta data.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody className="font-mono">
                {[bs.activoNaoCorrente, bs.activoCorrente].map((sec) => (
                  <React.Fragment key={sec.title}>
                    <tr className="bg-slate-100"><td className="px-4 py-2 font-sans font-bold text-[#0b1f3a] uppercase" colSpan={2}>{sec.title}</td><td className="px-4 py-2 text-right font-bold">{kz(sec.total)}</td></tr>
                    {sec.lines.map((l) => (
                      <tr key={l.label} className="border-b border-slate-50"><td className="px-4 py-2 font-bold text-[#0b1f3a] w-16">{l.code || ''}</td><td className="px-4 py-2 font-sans text-slate-700">{l.label}</td><td className="px-4 py-2 text-right">{kz(l.amount)}</td></tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr className="bg-[#0b1f3a] text-white font-bold"><td className="px-4 py-3 font-sans" colSpan={2}>TOTAL DO ACTIVO</td><td className="px-4 py-3 text-right">{kz(bs.totalActivo)}</td></tr>
                {[bs.capitalProprio, bs.passivoCorrente].map((sec) => (
                  <React.Fragment key={sec.title}>
                    <tr className="bg-slate-100"><td className="px-4 py-2 font-sans font-bold text-[#0b1f3a] uppercase" colSpan={2}>{sec.title}</td><td className="px-4 py-2 text-right font-bold">{kz(sec.total)}</td></tr>
                    {sec.lines.map((l) => (
                      <tr key={l.label} className="border-b border-slate-50"><td className="px-4 py-2 font-bold text-[#0b1f3a] w-16">{l.code || ''}</td><td className="px-4 py-2 font-sans text-slate-700">{l.label}</td><td className="px-4 py-2 text-right">{kz(l.amount)}</td></tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr className="bg-[#0b1f3a] text-white font-bold"><td className="px-4 py-3 font-sans" colSpan={2}>TOTAL DO CAPITAL PRÓPRIO E PASSIVO</td><td className="px-4 py-3 text-right">{kz(bs.totalCapitalEPassivo)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="p-3 text-[10px] text-slate-400 print:hidden">
            Saldos acumulados desde o primeiro lançamento até à data indicada. Sem um lançamento de abertura (Débito 43 / Crédito 51), o capital próprio só mostra o resultado acumulado.
            Salários a líquido: INSS patronal e retenções (IRT, INSS do trabalhador) não são separados.
          </p>
        </div>
      )}

      {tab === 'fecho' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 max-w-3xl">
            O fecho apura o resultado do ano: zera cada conta de proveitos e de custos contra a conta 88 (Resultado líquido do exercício) num lançamento a 31 de Dezembro.
            Depois de fechado, o ano fica protegido: não aceita novos lançamentos manuais até ser reaberto. O balancete do ano continua a mostrar os proveitos e custos originais.
          </p>
          {years.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center text-xs font-semibold text-slate-400">Ainda não há movimentos.</div>
          ) : years.map((y) => {
            const closing = closings.find((j) => j.closingYear === y);
            const preview = buildClosingEntry(postings, y);
            const stale = !!closing && isClosingStale(postings, y, closing.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })));
            return (
              <div key={y} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-headline text-lg font-extrabold text-[#0b1f3a]">{y}</span>
                    {closing
                      ? <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">FECHADO</span>
                      : <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">EM ABERTO</span>}
                    {stale && <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-bold">FECHO DESACTUALIZADO</span>}
                  </div>
                  {preview ? (
                    <div className="mt-1 text-[11px] text-slate-600 font-mono">
                      Proveitos {kz(preview.proveitos)} · Custos {kz(preview.custos)} · <span className={preview.resultado >= 0 ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>Resultado {kz(preview.resultado)}</span>
                    </div>
                  ) : <div className="mt-1 text-[11px] text-slate-400">Sem proveitos nem custos por apurar.</div>}
                  {stale && <div className="mt-1 text-[11px] text-red-700">Entraram movimentos neste ano depois do fecho. Reabra o ano e feche-o de novo para actualizar o resultado.</div>}
                </div>
                {canManage && (closing
                  ? <button onClick={() => setReopenId(closing.id)} className="h-9 px-4 text-xs font-bold rounded-lg bg-white border border-slate-300 text-slate-700">Reabrir ano</button>
                  : <button disabled={!preview} onClick={() => setCloseYear(y)} className="h-9 px-4 text-xs font-bold rounded-lg bg-[#0b1f3a] text-white disabled:opacity-40">Fechar {y}</button>)}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'opcoes' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0b1f3a]">Regime contabilístico</h3>
            {([
              ['caixa', 'Regime de caixa', 'Só entram propinas já recebidas e despesas/salários já pagos. Simples e fiel ao dinheiro que passou pela escola.'],
              ['acrescimo', 'Regime de acréscimo', 'Propinas vencidas e ainda por receber entram em Clientes (31); despesas e salários por pagar entram em Fornecedores (32) e Pessoal (36). É o regime que o PGC pede nas demonstrações financeiras.']
            ] as const).map(([val, title, desc]) => (
              <label key={val} className={`flex items-start gap-3 p-3 rounded-xl border ${options.basis === val ? 'border-[#0b1f3a] bg-slate-50' : 'border-slate-200'} ${canManage ? 'cursor-pointer' : 'opacity-70'}`}>
                <input type="radio" name="basis" className="mt-0.5" disabled={!canManage} checked={options.basis === val} onChange={() => saveOptions({ ...options, basis: val })} />
                <span><span className="block text-xs font-bold text-slate-800">{title}</span><span className="block text-[11px] text-slate-500">{desc}</span></span>
              </label>
            ))}
            <p className="text-[10px] text-slate-400">Mudar de regime não apaga nada: os lançamentos automáticos são recalculados. Se já fechou um ano, volte a verificar o fecho.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <label className={`flex items-start gap-3 ${canManage ? 'cursor-pointer' : 'opacity-70'}`}>
              <input type="checkbox" className="mt-0.5" disabled={!canManage} checked={options.depreciation} onChange={(e) => saveOptions({ ...options, depreciation: e.target.checked })} />
              <span><span className="block text-xs font-bold text-slate-800">Calcular amortizações dos activos</span>
                <span className="block text-[11px] text-slate-500">Uma quota por mês (quotas constantes), do mês de aquisição até esgotar a vida útil: Débito 73 Amortizações do exercício / Crédito 18 Amortizações acumuladas. Só entram meses já completos.</span></span>
            </label>
            {options.depreciation && (
              <div className="pt-2 border-t border-slate-100">
                <div className="text-[11px] font-bold uppercase text-slate-700 mb-2">Vida útil por categoria (anos)</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(ASSET_CATEGORY_LABELS).map(([k, label]) => (
                    <div key={k}>
                      <label className={labelCls}>{label}</label>
                      <input type="number" min="1" max="50" step="1" disabled={!canManage}
                        placeholder={String(DEFAULT_USEFUL_LIFE_YEARS[k] ?? DEFAULT_USEFUL_LIFE_YEARS.outro)}
                        value={livesDraft[k] ?? (options.usefulLifeYears?.[k] ?? '')}
                        onChange={(e) => setLivesDraft((d) => ({ ...d, [k]: e.target.value }))} className={inputCls} />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-2">O valor a cinzento é a estimativa por omissão (não é uma taxa oficial). Deixe em branco para a usar. Confirme as vidas úteis com o contabilista.</p>
                {canManage && Object.keys(livesDraft).length > 0 && (
                  <div className="flex justify-end mt-2"><button onClick={saveLives} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">Guardar vidas úteis</button></div>
                )}
              </div>
            )}
          </div>
          {!canManage && <p className="text-[11px] text-slate-500">Só quem gere a contabilidade pode alterar estas opções.</p>}
        </div>
      )}

      {tab === 'plano' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="text-left px-4 py-3 text-white">Conta</th>
                <th className="text-left px-4 py-3 text-white">Designação</th>
                <th className="text-left px-4 py-3 text-white">Tipo</th>
                <th className="text-left px-4 py-3 text-white">Natureza</th>
                <th className="text-left px-4 py-3 text-white">Conferida com o PGC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {CHART.map((a) => (
                <tr key={a.code}>
                  <td className="px-4 py-2.5 font-mono font-bold text-[#0b1f3a]">{a.code}</td>
                  <td className="px-4 py-2.5 text-slate-800">{a.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{KIND_LABELS[a.kind]}</td>
                  <td className="px-4 py-2.5 text-slate-600 capitalize">{a.nature}</td>
                  <td className="px-4 py-2.5">
                    {a.verified
                      ? <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold">Sim</span>
                      : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">A confirmar</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-4 text-[10px] text-slate-400">Plano simplificado do PGC angolano (Decreto n.º 82/01). «Sim» = código e designação conferidos com o texto do PGC; «A confirmar» = o contabilista deve validar (51 Capital e 88 Resultado líquido do exercício). Confirme todo o plano antes de uso oficial.</p>
        </div>
      )}

      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <FormModalHeader title="Novo Lançamento" subtitle="Partidas dobradas: débitos = créditos" icon="balance" onClose={() => setModal(false)} />
            <div className="p-6 space-y-3 overflow-y-auto">
              {error && <Notice tone="error">{error}</Notice>}
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Data</label><input type="date" value={jDate} onChange={(e) => setJDate(e.target.value)} className={inputCls} /></div>
                <div className="col-span-2"><label className={labelCls}>Descrição</label><input value={jDesc} onChange={(e) => setJDesc(e.target.value)} className={inputCls} placeholder="Ex.: Capital inicial" /></div>
              </div>
              <div><label className={labelCls}>Referência (opcional)</label><input value={jRef} onChange={(e) => setJRef(e.target.value)} className={inputCls} /></div>
              <div className="space-y-2">
                {jLines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} className={`${inputCls} col-span-6`}>
                      <option value="">Conta...</option>
                      {CHART.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                    <input type="number" min="0" step="0.01" placeholder="Débito" value={l.debit || ''} onChange={(e) => setLine(i, { debit: Number(e.target.value) || 0, credit: Number(e.target.value) ? 0 : l.credit })} className={`${inputCls} col-span-3`} />
                    <input type="number" min="0" step="0.01" placeholder="Crédito" value={l.credit || ''} onChange={(e) => setLine(i, { credit: Number(e.target.value) || 0, debit: Number(e.target.value) ? 0 : l.debit })} className={`${inputCls} col-span-2`} />
                    <button type="button" onClick={() => setJLines((p) => (p.length > 2 ? p.filter((_, k) => k !== i) : p))} title="Remover linha" className="text-slate-400 hover:text-red-600 col-span-1">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setJLines((p) => [...p, { account: '', debit: 0, credit: 0 }])} className="text-xs font-bold text-[#0b1f3a]">+ Adicionar linha</button>
              </div>
              <div className={`text-xs font-mono font-bold ${Math.abs(totD - totC) < 0.005 && totD > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                Débito {kz(totD)} · Crédito {kz(totC)}{Math.abs(totD - totC) >= 0.005 ? ` · diferença ${kz(Math.abs(totD - totC))}` : ''}
              </div>
              <p className="text-[10px] text-slate-400">Exemplo de abertura: Débito 43 Depósitos à ordem / Crédito 51 Capital ({accountByCode('51')?.name}).</p>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="h-9 px-4 text-xs font-bold text-slate-600">Cancelar</button>
              <button onClick={handleSave} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">Guardar</button>
            </div>
          </div>
        </div>
      )}

      <AppConfirmModal
        isOpen={closeYear !== null}
        title={`Fechar o ano ${closeYear ?? ''}`}
        message="Vai ser criado o lançamento de apuramento do resultado a 31 de Dezembro. O ano fica protegido contra novos lançamentos manuais até ser reaberto."
        variant="warning"
        confirmLabel="Fechar ano"
        onConfirm={doClose}
        onCancel={() => setCloseYear(null)}
      />
      <AppConfirmModal
        isOpen={!!reopenId}
        title="Reabrir o ano"
        message="O lançamento de fecho será eliminado e o ano volta a aceitar lançamentos. Depois de fazer as correções, feche-o de novo."
        variant="warning"
        confirmLabel="Reabrir"
        onConfirm={doReopen}
        onCancel={() => setReopenId(null)}
      />
      <AppConfirmModal
        isOpen={!!deletingId}
        title="Eliminar Lançamento"
        message="Tem a certeza que pretende eliminar este lançamento manual? Esta ação não pode ser revertida."
        variant="error"
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
};
