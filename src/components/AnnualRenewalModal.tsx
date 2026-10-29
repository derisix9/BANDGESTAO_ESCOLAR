import React, { useMemo, useState } from 'react';
import { SchoolDatabase, SituacaoFinanceira } from '../types';
import { SITUACAO_FINANCEIRA_OPTIONS } from '../utils/financialSituation';
import { dbService } from '../services/db';
import { buildAcademicYearList } from '../utils/academicYear';
import { guardPlan } from '../utils/planGuard';
import type { DebtPolicy, ManualDecision, RenewalRow, RenewalStatus } from '../utils/enrollmentRenewal';
import { Notice } from './Notice';

interface Props {
  db: SchoolDatabase;
  onClose: () => void;
}

type Result = { enrolled: number; skipped: { studentId: string; name: string; detail: string }[]; failed: { studentId: string; name: string; error: string }[] };
type Filter = 'todos' | RenewalStatus;

const STATUS_LABEL: Record<RenewalStatus, string> = { pronto: 'Pronto', aviso: 'Com aviso', bloqueado: 'Bloqueado', feito: 'Já renovado' };
const STATUS_CLS: Record<RenewalStatus, string> = {
  pronto: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  aviso: 'bg-amber-50 text-amber-800 border-amber-300',
  bloqueado: 'bg-red-50 text-[#7a0c0c] border-red-300',
  feito: 'bg-slate-100 text-slate-600 border-slate-300'
};
const ACTION_LABEL = { promover: 'Promove', repetir: 'Repete', concluir: 'Conclui o ciclo' } as const;

/**
 * Renovação anual de matrícula em lote (Janeiro). Parte dos conselhos de turma homologados do ano anterior:
 * aprovados passam à classe seguinte, reprovados repetem, condicionais esperam pela recuperação.
 * Mostra tudo antes de gravar; a gravação (`dbService.renewEnrollments`) volta a validar cada aluno com os dados de agora.
 */
export const AnnualRenewalModal: React.FC<Props> = ({ db, onClose }) => {
  const [year, setYear] = useState(db.settings?.currentAcademicYear || '');
  const [debtPolicy, setDebtPolicy] = useState<DebtPolicy>('avisar');
  const [situacao, setSituacao] = useState<SituacaoFinanceira>('pendente');
  const [manual, setManual] = useState<Record<string, ManualDecision>>({});
  const [classPick, setClassPick] = useState<Record<string, string>>({});
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('todos');
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const years = useMemo(
    () => buildAcademicYearList(db.settings, [year, ...(db.classes || []).map((c) => c.academicYear)]),
    [db.settings, db.classes, year]
  );

  const plan = useMemo(
    () => (year ? dbService.planAnnualRenewal(year, { debtPolicy, manualDecisions: manual, classOverrides: classPick }) : null),
    [year, debtPolicy, manual, classPick, db.matriculas, db.classCouncils, db.recoveryRecords, db.invoices, db.classes, db.students]
  );

  const selectable = (r: RenewalRow) => (r.status === 'pronto' || r.status === 'aviso') && r.action !== 'concluir';
  const rows = plan?.rows || [];
  const selectedIds = rows.filter((r) => selectable(r) && !deselected.has(r.studentId)).map((r) => r.studentId);
  const visible = rows.filter((r) => filter === 'todos' || r.status === filter);
  const toggle = (id: string) => setDeselected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = async () => {
    if (!plan || selectedIds.length === 0 || phase !== 'form') return;
    if (!guardPlan('armazenamento')) return;
    setError(''); setPhase('running'); setProgress({ done: 0, total: selectedIds.length });
    await new Promise((r) => setTimeout(r, 30));
    try {
      let enrolled = 0; const skipped: Result['skipped'] = []; const failed: Result['failed'] = [];
      const SLICE = 10;
      for (let i = 0; i < selectedIds.length; i += SLICE) {
        const slice = selectedIds.slice(i, i + SLICE);
        setProgress({ done: i, total: selectedIds.length });
        await new Promise((r) => setTimeout(r, 0));
        const out = dbService.renewEnrollments(slice, { academicYear: year, debtPolicy, situacaoFinanceira: situacao, manualDecisions: manual, classOverrides: classPick });
        enrolled += out.enrolled.length; skipped.push(...out.skipped); failed.push(...out.failed);
        // Limite do plano / armazenamento: os restantes iriam falhar pelo mesmo motivo.
        if (out.failed.some((f) => /^Não processado:/.test(f.error))) {
          for (const rest of selectedIds.slice(i + SLICE)) failed.push({ studentId: rest, name: rows.find((x) => x.studentId === rest)?.name || rest, error: 'Não processado: limite do plano atingido.' });
          break;
        }
      }
      setProgress({ done: selectedIds.length, total: selectedIds.length });
      setResult({ enrolled, skipped, failed });
      setPhase('done');
    } catch (e: any) {
      setError(e?.message || 'Não foi possível gravar as renovações.');
      setPhase('form');
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const c = plan?.counts;
  const card = (label: string, n: number, cls: string, f: Filter) => (
    <button type="button" onClick={() => setFilter(filter === f ? 'todos' : f)} className={`p-2 border text-left cursor-pointer ${cls} ${filter === f ? 'ring-2 ring-[#0b1f3a]' : ''}`}>
      <div className="text-xl font-black">{n}</div><div className="font-semibold">{label}</div>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" data-testid="annual-renewal-modal">
      <div className="bg-white max-w-6xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px]">event_repeat</span>
            <div>
              <h3 className="font-bold text-sm tracking-wide uppercase leading-tight">Renovação anual de matrícula</h3>
              <p className="text-[11px] text-slate-300 leading-tight">{plan?.previousYear || '—'} → {year || '—'} · pelo resultado do conselho de turma</p>
            </div>
          </div>
          {phase !== 'running' && (
            <button onClick={onClose} type="button" className="text-slate-400 hover:text-white p-1 cursor-pointer" aria-label="Fechar">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {phase !== 'done' && plan && c && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">Ano lectivo novo</span>
                  <select value={year} disabled={phase === 'running'} onChange={(e) => { setYear(e.target.value); setManual({}); setClassPick({}); setDeselected(new Set()); }} className="mt-1 w-full p-2 border border-slate-300 bg-white" data-testid="renewal-year">
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">Dívidas em mora</span>
                  <select value={debtPolicy} disabled={phase === 'running'} onChange={(e) => setDebtPolicy(e.target.value as DebtPolicy)} className="mt-1 w-full p-2 border border-slate-300 bg-white" data-testid="renewal-debt">
                    <option value="avisar">Avisar, mas permitir renovar</option>
                    <option value="bloquear">Bloquear a renovação</option>
                  </select>
                </label>
                <label className="block">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">Situação financeira inicial</span>
                  <select value={situacao} disabled={phase === 'running'} onChange={(e) => setSituacao(e.target.value as SituacaoFinanceira)} className="mt-1 w-full p-2 border border-slate-300 bg-white">
                    {SITUACAO_FINANCEIRA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>

              {!plan.previousYear && <Notice tone="error">O ano lectivo "{year}" não está no formato AAAA/AAAA; não é possível encontrar o ano anterior.</Notice>}
              {plan.previousYear && rows.length === 0 && <Notice tone="warn">Não há alunos com matrícula activa em {plan.previousYear} para renovar.</Notice>}
              {plan.pendingCouncils.length > 0 && (
                <Notice tone="warn">
                  Conselho de turma por homologar em {plan.previousYear}: {plan.pendingCouncils.map((p) => `${p.className} (${p.students})`).join(', ')}.
                  Os alunos destas turmas ficam bloqueados até o conselho ser homologado, ou até decidir à mão (fica registado).
                </Notice>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {card('Prontos', c.pronto, 'border-emerald-300 bg-emerald-50 text-emerald-900', 'pronto')}
                {card('Com aviso', c.aviso, 'border-amber-300 bg-amber-50 text-amber-900', 'aviso')}
                {card('Bloqueados', c.bloqueado, 'border-red-300 bg-red-50 text-[#7a0c0c]', 'bloqueado')}
                {card('Já renovados', c.feito, 'border-slate-300 bg-slate-50 text-slate-600', 'feito')}
                <div className="p-2 border border-sky-300 bg-sky-50 text-sky-900"><div className="text-xl font-black">{c.concluem}</div><div className="font-semibold">concluem o ciclo</div></div>
              </div>

              <div className="bg-white border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
                    <tr><th className="p-2 w-8" /><th className="p-2">Aluno</th><th className="p-2">Turma anterior</th><th className="p-2">Decisão</th><th className="p-2">Nova turma</th><th className="p-2">Estado</th><th className="p-2">Observações</th></tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.studentId} className="border-t border-slate-100 align-top" data-testid={`renewal-row-${r.studentId}`}>
                        <td className="p-2">{selectable(r) && <input type="checkbox" checked={!deselected.has(r.studentId)} disabled={phase === 'running'} onChange={() => toggle(r.studentId)} aria-label={`Renovar ${r.name}`} />}</td>
                        <td className="p-2 font-semibold">{r.name}</td>
                        <td className="p-2">{r.previousClassName}</td>
                        <td className="p-2">
                          {r.canDecideManually ? (
                            <select value={manual[r.studentId] || ''} disabled={phase === 'running'} className="p-1 border border-slate-300 bg-white"
                              onChange={(e) => setManual((cur) => { const n = { ...cur }; if (e.target.value) n[r.studentId] = e.target.value as ManualDecision; else delete n[r.studentId]; return n; })}>
                              <option value="">Decidir à mão…</option><option value="promover">Promove</option><option value="repetir">Repete</option>
                            </select>
                          ) : (
                            <>
                              {r.basis && <span className="text-slate-500">{r.basis === 'manual' ? 'manual' : r.basis} · </span>}
                              <b>{r.action ? ACTION_LABEL[r.action] : '—'}</b>
                              {r.manual && (
                                <button type="button" className="ml-2 text-[#ac332b] underline cursor-pointer" onClick={() => setManual((cur) => { const n = { ...cur }; delete n[r.studentId]; return n; })}>desfazer</button>
                              )}
                            </>
                          )}
                        </td>
                        <td className="p-2">
                          {r.action === 'concluir' ? '—' : r.classOptions.length > 1 && selectable(r) ? (
                            <select value={r.targetClassId} disabled={phase === 'running'} className="p-1 border border-slate-300 bg-white" onChange={(e) => setClassPick((cur) => ({ ...cur, [r.studentId]: e.target.value }))}>
                              {r.classOptions.map((o) => <option key={o.id} value={o.id}>{o.name}{o.free !== null ? ` (${o.free} vagas)` : ''}</option>)}
                            </select>
                          ) : (r.targetClassName || '—')}
                        </td>
                        <td className="p-2"><span className={`px-2 py-0.5 border font-bold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                        <td className="p-2 text-slate-600 max-w-xs">{[...r.blockers.map((b) => b.text), ...r.warnings].join(' ')}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">Nenhum aluno neste filtro.</td></tr>}
                  </tbody>
                </table>
              </div>

              {phase === 'running' && (
                <div>
                  <div className="flex justify-between font-semibold text-slate-700 mb-1"><span>A renovar…</span><span>{progress.done}/{progress.total}</span></div>
                  <div className="h-3 bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1 text-slate-500">Não feche esta janela.</p>
                </div>
              )}
              {error && <Notice tone="error">{error}</Notice>}
            </>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3" data-testid="renewal-result">
              <div className="p-3 border border-emerald-300 bg-emerald-50 text-emerald-900 font-bold text-sm">{result.enrolled} aluno(s) renovado(s) em {year}.</div>
              {result.skipped.length > 0 && (
                <div className="border border-amber-200">
                  <div className="px-3 py-2 bg-amber-100 text-amber-900 font-bold text-[11px] uppercase">{result.skipped.length} não renovado(s) — mudaram desde a pré-visualização</div>
                  <ul className="max-h-36 overflow-y-auto divide-y divide-amber-100">{result.skipped.map((s) => <li key={s.studentId} className="px-3 py-1.5"><b>{s.name}</b> — {s.detail}</li>)}</ul>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="border border-red-200">
                  <div className="px-3 py-2 bg-red-100 text-red-900 font-bold text-[11px] uppercase">{result.failed.length} com erro</div>
                  <ul className="max-h-36 overflow-y-auto divide-y divide-red-100">{result.failed.map((f) => <li key={f.studentId} className="px-3 py-1.5"><b>{f.name}</b> — {f.error}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          {phase === 'done' ? (
            <button type="button" onClick={onClose} className="px-4 py-2 bg-[#0b1f3a] text-white font-bold cursor-pointer">Fechar</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={phase === 'running'} className="px-4 py-2 border border-slate-300 bg-white font-bold cursor-pointer disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={run} disabled={phase !== 'form' || selectedIds.length === 0} data-testid="renewal-confirm"
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {phase === 'running' ? 'A renovar…' : `Renovar ${selectedIds.length} aluno(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
