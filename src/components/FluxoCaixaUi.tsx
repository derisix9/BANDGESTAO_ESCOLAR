import React, { useMemo, useState } from 'react';
import type { CashSession } from '../types/processos';
import { BtnIcon, IconButton } from './IconButton';
import { LedgerEntry, SessionTotals, totalsByCategory } from '../utils/financeExtras';
import { TablePagination, usePagedList } from './TablePagination';

const kz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;
const inputCls = 'w-full h-10 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg';
const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';

const fmtDateTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
};
const fmtDate = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const monthLabel = (m: string) => {
  const names = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const idx = Number(m.slice(5, 7)) - 1;
  return `${names[idx] ?? m.slice(5, 7)} de ${m.slice(0, 4)}`;
};
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 flex items-start justify-center p-3 md:p-6 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} my-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-[#0b1f3a]">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <IconButton icon="close" label="Fechar" onClick={onClose} />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) => (
  <div className={`kpi-card ${tone === 'good' ? 'kpi-green' : tone === 'bad' ? 'kpi-red' : 'kpi-blue'} p-3`}>
    <div className="kpi-label text-[10px] font-bold uppercase tracking-wide">{label}</div>
    <div className="kpi-value text-sm font-extrabold mt-1">{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Estado da caixa: abrir / fechar
// ---------------------------------------------------------------------------
interface PanelProps {
  openSession?: CashSession;
  live: SessionTotals | null;
  sessions: CashSession[];
  can: boolean;
  denyMessage?: string;
  onOpen: (openingFloat: number, note: string) => Promise<boolean>;
  onRequestClose: () => void;
  onViewSession: (s: CashSession) => void;
}

export function CashSessionPanel({ openSession, live, sessions, can, denyMessage, onOpen, onRequestClose, onViewSession }: PanelProps) {
  const [floatValue, setFloatValue] = useState('0');
  const [note, setNote] = useState('');
  const closed = sessions.filter((s) => s.status === 'fechado');
  const { page: pgClosed, setPage: setPgClosed, pageItems: visibleClosed } = usePagedList(closed, [closed.length]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-[#0b1f3a]">Caixa</h2>
      {openSession && live ? (
        <div className="bg-white border border-emerald-300 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" /></span>
              <div>
                <div className="text-sm font-extrabold text-emerald-700">CAIXA ABERTA</div>
                <div className="text-[11px] text-slate-500">Aberta em {fmtDateTime(openSession.openedAt)} por {openSession.openedBy}</div>
              </div>
            </div>
            <button className={btnPrimary} disabled={!can} title={can ? undefined : denyMessage} onClick={onRequestClose}><BtnIcon n="lock" /> Fechar caixa</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Fundo de abertura" value={kz(openSession.openingFloat)} />
            <Stat label="Entradas contabilizadas (todos os meios)" value={kz(live.totalIn)} tone="good" />
            <Stat label="Saídas (despesas e folha de pagamento)" value={kz(live.cashOut)} tone="bad" />
            <Stat label="Saldo esperado da caixa" value={kz(live.expectedCash)} />
          </div>
          {live.byMethod.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {live.byMethod.map((m) => (
                <span key={m.method} className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700"><b>{m.method}</b>: {kz(m.total)} <span className="text-slate-400">({m.count})</span></span>
              ))}
            </div>
          )}
          {openSession.openingNote && <p className="text-[11px] text-slate-500">Nota de abertura: {openSession.openingNote}</p>}
        </div>
      ) : (
        <div className="bg-white border border-red-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex rounded-full h-3 w-3 bg-red-500" />
            <div>
              <div className="text-sm font-extrabold text-red-700">CAIXA FECHADA</div>
              <div className="text-[11px] text-slate-500">Abra a caixa para iniciar o turno. Com a caixa fechada ficam bloqueados os pagamentos de propinas, de outros serviços e de despesas.</div>
            </div>
          </div>
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div><label className={labelCls}>Fundo de maneio (Kz)</label><input className={inputCls} inputMode="decimal" value={floatValue} onChange={(e) => setFloatValue(e.target.value)} /></div>
            <div className="md:col-span-2"><label className={labelCls}>Observação (opcional)</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: Turno da manhã" /></div>
            <button className={btnPrimary} disabled={!can} title={can ? undefined : denyMessage} onClick={async () => { const ok = await onOpen(Number(floatValue.replace(',', '.')) || 0, note); if (ok) { setNote(''); setFloatValue('0'); } }}><BtnIcon n="lock_open" /> Abrir caixa</button>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <div className="px-3 pt-3 text-[11px] font-bold text-slate-600">Histórico de caixas fechadas</div>
          <table className="w-full text-xs mt-2">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Abertura</th><th className="p-3">Fecho</th><th className="p-3">Operador</th><th className="p-3 text-right">Esperado</th><th className="p-3 text-right">Contado</th><th className="p-3 text-right">Diferença</th><th className="p-3 text-right">Ação</th></tr></thead>
            <tbody>{visibleClosed.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="p-3">{fmtDateTime(s.openedAt)}</td>
                <td className="p-3">{fmtDateTime(s.closedAt)}</td>
                <td className="p-3">{s.closedBy || s.openedBy}</td>
                <td className="p-3 text-right">{kz(s.expectedCash ?? 0)}</td>
                <td className="p-3 text-right">{kz(s.countedCash ?? 0)}</td>
                <td className={`p-3 text-right font-bold ${(s.difference ?? 0) === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{(s.difference ?? 0) > 0 ? '+' : ''}{kz(s.difference ?? 0)}</td>
                <td className="p-3 text-right"><IconButton icon="visibility" tone="primary" label="Ver detalhes" onClick={() => onViewSession(s)} /></td>
              </tr>
            ))}</tbody>
          </table>
          <TablePagination total={closed.length} page={pgClosed} onPageChange={setPgClosed} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fecho de caixa (contagem e diferença)
// ---------------------------------------------------------------------------
export function CloseCashModal({ session, live, onCancel, onConfirm }: { session: CashSession; live: SessionTotals; onCancel: () => void; onConfirm: (counted: number, note: string) => Promise<void> }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const countedNum = Number(counted.replace(',', '.'));
  const valid = counted.trim() !== '' && countedNum >= 0;
  const diff = valid ? countedNum - live.expectedCash : 0;
  return (
    <Modal title="Fechar caixa" subtitle={`Aberta em ${fmtDateTime(session.openedAt)} por ${session.openedBy}`} onClose={onCancel}>
      <div className="space-y-4">
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
          <div className="flex justify-between p-3"><span>Fundo de abertura</span><b>{kz(session.openingFloat)}</b></div>
          {live.byMethod.map((m) => (
            <div key={m.method} className="flex justify-between p-3 text-slate-600"><span>&nbsp;&nbsp;{m.method} ({m.count})</span><span>{kz(m.total)}</span></div>
          ))}
          <div className="flex justify-between p-3"><span>+ Entradas contabilizadas (todos os meios)</span><b className="text-emerald-700">{kz(live.totalIn)}</b></div>
          <div className="flex justify-between p-3"><span>− Saídas (despesas e folha de pagamento)</span><b className="text-red-700">{kz(live.cashOut)}</b></div>
          <div className="flex justify-between p-3 bg-slate-50"><span className="font-bold">Saldo esperado da caixa</span><b>{kz(live.expectedCash)}</b></div>
          <div className="flex justify-between p-3 text-slate-500"><span>Dos quais em numerário na gaveta (informativo)</span><span>{kz(live.expectedDrawerCash)}</span></div>
        </div>
        <div><label className={labelCls}>Valor total apurado em caixa (Kz): numerário + comprovativos TPA/Multicaixa</label><input autoFocus className={inputCls} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
        {valid && (
          <div className={`px-3 py-2 rounded-lg text-xs font-bold ${diff === 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {diff === 0 ? 'Caixa certa: sem diferença.' : diff > 0 ? `Sobra de ${kz(diff)}` : `Falta de ${kz(-diff)}`}
          </div>
        )}
        <div><label className={labelCls}>Observação (opcional)</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Justificação de diferença, se existir" /></div>
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onCancel}><BtnIcon n="close" /> Cancelar</button>
          <button className={btnPrimary} disabled={!valid || busy} onClick={async () => { setBusy(true); await onConfirm(countedNum, note); setBusy(false); }}><BtnIcon n="check" /> Confirmar fecho</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tabela de movimentos (partilhada)
// ---------------------------------------------------------------------------
function MovementsTable({ entries }: { entries: LedgerEntry[] }) {
  const { page: pgEntries, setPage: setPgEntries, pageItems: visibleEntries } = usePagedList(entries, [entries.length]);
  if (entries.length === 0) return <p className="text-xs text-slate-400 font-semibold py-6 text-center">Sem movimentos para este filtro.</p>;
  return (
    <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[380px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left sticky top-0"><tr><th className="p-2.5">Data</th><th className="p-2.5">Tipo</th><th className="p-2.5">Categoria</th><th className="p-2.5">Descrição</th><th className="p-2.5">Aluno / Fornecedor</th><th className="p-2.5">Meio</th><th className="p-2.5">Ref.</th><th className="p-2.5 text-right">Valor</th></tr></thead>
        <tbody>{visibleEntries.map((e) => (
          <tr key={e.id} className="border-t border-slate-100 align-top">
            <td className="p-2.5 whitespace-nowrap">{fmtDate(e.date)}</td>
            <td className="p-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${e.kind === 'entrada' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{e.kind === 'entrada' ? 'ENTRADA' : 'SAÍDA'}</span></td>
            <td className="p-2.5 font-semibold">{e.category}</td>
            <td className="p-2.5 min-w-[180px]">{e.description}</td>
            <td className="p-2.5">{e.party || '—'}</td>
            <td className="p-2.5">{e.method || '—'}</td>
            <td className="p-2.5 text-slate-500">{e.reference || '—'}</td>
            <td className={`p-2.5 text-right font-bold whitespace-nowrap ${e.kind === 'entrada' ? 'text-emerald-700' : 'text-red-700'}`}>{e.kind === 'saida' ? '−' : '+'}{kz(e.amount)}</td>
          </tr>
        ))}</tbody>
      </table>
      <TablePagination total={entries.length} page={pgEntries} onPageChange={setPgEntries} />
    </div>
  );
}

function CategoryBars({ title, rows, tone }: { title: string; rows: ReturnType<typeof totalsByCategory>; tone: 'good' | 'bad' }) {
  return (
    <div className="border border-slate-200 rounded-xl p-3">
      <div className="text-[11px] font-bold text-slate-600 mb-2">{title}</div>
      {rows.length === 0 ? <p className="text-[11px] text-slate-400">Sem movimentos.</p> : (
        <div className="space-y-2.5">{rows.map((r) => (
          <div key={r.category}>
            <div className="flex justify-between text-[11px]"><span className="font-semibold">{r.category} <span className="text-slate-400 font-normal">({r.count})</span></span><span className="font-bold">{kz(r.total)} · {r.percent.toFixed(0)}%</span></div>
            <div className="h-1.5 bg-slate-100 rounded-full mt-1"><div className={`h-1.5 rounded-full ${tone === 'good' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.max(2, r.percent)}%` }} /></div>
          </div>
        ))}</div>
      )}
    </div>
  );
}

function exportCsv(name: string, entries: LedgerEntry[]) {
  const head = ['Data', 'Tipo', 'Categoria', 'Descrição', 'Aluno/Fornecedor', 'Meio', 'Referência', 'Valor (Kz)'];
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [fmtDate(e.date), e.kind === 'entrada' ? 'Entrada' : 'Saída', e.category, e.description, e.party || '', e.method || '', e.reference || '', (e.kind === 'saida' ? -e.amount : e.amount)].map(q).join(';'));
  const blob = new Blob(['\ufeff' + [head.map(q).join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function printReport(title: string, subtitle: string, summary: [string, string][], entries: LedgerEntry[]) {
  const w = window.open('', '_blank');
  if (!w) return;
  const rows = entries.map((e) => `<tr><td>${esc(fmtDate(e.date))}</td><td>${e.kind === 'entrada' ? 'Entrada' : 'Saída'}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>${esc(e.party || '—')}</td><td>${esc(e.method || '—')}</td><td style="text-align:right">${e.kind === 'saida' ? '−' : '+'}${esc(kz(e.amount))}</td></tr>`).join('');
  const sum = summary.map(([l, v]) => `<div class="s"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;color:#0b1f3a;padding:24px;font-size:12px}h1{font-size:18px;margin:0}p{color:#64748b;margin:4px 0 16px}.g{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.s{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;min-width:130px}.s small{display:block;color:#64748b;font-size:10px;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}th{background:#f1f5f9;font-size:10px;text-transform:uppercase}</style></head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div class="g">${sum}</div><table><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Aluno/Fornecedor</th><th>Meio</th><th style="text-align:right">Valor</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();
  // Impressão pedida pela própria app (a CSP não permite scripts inline na janela nova).
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* janela fechada */ } }, 300);
}

// ---------------------------------------------------------------------------
// Detalhe do fluxo de caixa de um mês
// ---------------------------------------------------------------------------
export function MonthDetailModal({ month, openingBalance, entries, onClose }: { month: string; openingBalance: number; entries: LedgerEntry[]; onClose: () => void }) {
  const [kind, setKind] = useState<'todos' | 'entrada' | 'saida'>('todos');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const inflow = entries.filter((e) => e.kind === 'entrada').reduce((s, e) => s + e.amount, 0);
  const outflow = entries.filter((e) => e.kind === 'saida').reduce((s, e) => s + e.amount, 0);
  const inCats = useMemo(() => totalsByCategory(entries, 'entrada'), [entries]);
  const outCats = useMemo(() => totalsByCategory(entries, 'saida'), [entries]);
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category))].sort(), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (kind === 'todos' || e.kind === kind) && (!category || e.category === category) &&
      (!q || [e.description, e.party, e.category, e.reference, e.method].some((v) => (v || '').toLowerCase().includes(q))));
  }, [entries, kind, category, query]);
  const title = `Fluxo de caixa · ${monthLabel(month)}`;
  const summary: [string, string][] = [['Saldo inicial', kz(openingBalance)], ['Entradas', kz(inflow)], ['Saídas', kz(outflow)], ['Líquido', kz(inflow - outflow)], ['Saldo final', kz(openingBalance + inflow - outflow)]];

  return (
    <Modal wide title={title} subtitle={`${entries.length} movimentos · ${entries.filter((e) => e.kind === 'entrada').length} entradas · ${entries.filter((e) => e.kind === 'saida').length} saídas`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Saldo inicial" value={kz(openingBalance)} />
          <Stat label="Entradas" value={kz(inflow)} tone="good" />
          <Stat label="Saídas" value={kz(outflow)} tone="bad" />
          <Stat label="Líquido" value={kz(inflow - outflow)} tone={inflow - outflow < 0 ? 'bad' : 'good'} />
          <Stat label="Saldo final" value={kz(openingBalance + inflow - outflow)} />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <CategoryBars title="Entradas por categoria" rows={inCats} tone="good" />
          <CategoryBars title="Saídas por categoria" rows={outCats} tone="bad" />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex gap-1 border-b border-slate-200 h-10 items-end">
            {(['todos', 'entrada', 'saida'] as const).map((k) => (
              <button key={k} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 -mb-px ${kind === k ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'}`} onClick={() => setKind(k)}>{k === 'todos' ? 'Todos' : k === 'entrada' ? 'Entradas' : 'Saídas'}</button>
            ))}
          </div>
          <select className={`${inputCls} !w-48`} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className={`${inputCls} !w-64`} placeholder="Pesquisar descrição, aluno, fornecedor..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} onClick={() => exportCsv(`fluxo-caixa-${month}`, filtered)}><BtnIcon n="download" /> Exportar CSV</button>
            <button className={btnGhost} onClick={() => printReport(title, `${filtered.length} movimentos`, summary, filtered)}><BtnIcon n="print" /> Imprimir</button>
          </div>
        </div>
        <MovementsTable entries={filtered} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detalhe de uma caixa fechada
// ---------------------------------------------------------------------------
export function SessionDetailModal({ session, ledger, onClose }: { session: CashSession; ledger: LedgerEntry[]; onClose: () => void }) {
  const ids = new Set(session.movementIds || []);
  const entries = ledger.filter((e) => ids.has(e.id));
  const diff = session.difference ?? 0;
  // Fechos antigos não guardavam o total: reconstrói-se a partir de numerário + outros meios.
  const totalIn = session.totalIn ?? (session.cashIn ?? 0) + (session.otherIn ?? 0);
  const title = `Fecho de caixa · ${fmtDateTime(session.closedAt)}`;
  const summary: [string, string][] = [['Fundo', kz(session.openingFloat)], ['Entradas contabilizadas (todos os meios)', kz(totalIn)], ['Saídas', kz(session.cashOut ?? 0)], ['Esperado', kz(session.expectedCash ?? 0)], ['Contado', kz(session.countedCash ?? 0)], ['Diferença', kz(diff)]];
  return (
    <Modal wide title={title} subtitle={`Aberta em ${fmtDateTime(session.openedAt)} por ${session.openedBy} · fechada por ${session.closedBy || '—'}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Fundo de abertura" value={kz(session.openingFloat)} />
          <Stat label="Entradas contabilizadas (todos os meios)" value={kz(totalIn)} tone="good" />
          <Stat label="Saídas" value={kz(session.cashOut ?? 0)} tone="bad" />
          <Stat label="Esperado" value={kz(session.expectedCash ?? 0)} />
          <Stat label="Contado" value={kz(session.countedCash ?? 0)} />
          <Stat label="Diferença" value={`${diff > 0 ? '+' : ''}${kz(diff)}`} tone={diff === 0 ? 'good' : 'bad'} />
        </div>
        {(session.openingNote || session.closingNote) && (
          <div className="text-[11px] text-slate-600 space-y-1">
            {session.openingNote && <p>Nota de abertura: {session.openingNote}</p>}
            {session.closingNote && <p>Nota de fecho: {session.closingNote}</p>}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <CategoryBars title="Entradas por categoria" rows={totalsByCategory(entries, 'entrada')} tone="good" />
          <CategoryBars title="Saídas por categoria" rows={totalsByCategory(entries, 'saida')} tone="bad" />
        </div>
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={() => exportCsv(`fecho-caixa-${session.id}`, entries)}><BtnIcon n="download" /> Exportar CSV</button>
          <button className={btnGhost} onClick={() => printReport(title, `Operador: ${session.closedBy || session.openedBy}`, summary, entries)}><BtnIcon n="print" /> Imprimir</button>
        </div>
        <MovementsTable entries={entries} />
      </div>
    </Modal>
  );
}
