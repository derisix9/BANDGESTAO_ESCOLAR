import React, { useMemo, useState } from 'react';
import { SchoolDatabase, SituacaoFinanceira } from '../types';
import { SITUACAO_FINANCEIRA_OPTIONS } from '../utils/financialSituation';
import { dbService } from '../services/db';
import { findTuitionRowForGrade } from '../utils/educationSubsystems';
import { buildAcademicYearList } from '../utils/academicYear';
import { guardPlan } from '../utils/planGuard';
import { Notice } from './Notice';

interface BulkEnrollModalProps {
  db: SchoolDatabase;
  /** Alunos escolhidos na tabela (ids). */
  studentIds: string[];
  onClose: () => void;
}

type Skipped = { studentId: string; name: string; reason: string; detail: string };
type Failed = { studentId: string; name: string; error: string };

/**
 * Matrícula EM LOTE: todos os alunos escolhidos ficam matriculados na MESMA turma e ano lectivo.
 * Antes de gravar mostra quantos serão matriculados e quais serão IGNORADOS por já terem matrícula nesse ano lectivo.
 * A gravação usa `dbService.enrollStudentsInClass`, que aplica as mesmas regras da Nova Matrícula individual
 * (valores da Tabela Financeira, faturas de matrícula e propinas) e repete a verificação de duplicados.
 */
export const BulkEnrollModal: React.FC<BulkEnrollModalProps> = ({ db, studentIds, onClose }) => {
  const [academicYear, setAcademicYear] = useState(db.settings?.currentAcademicYear || '');
  const [classId, setClassId] = useState('');
  const [situacao, setSituacao] = useState<SituacaoFinanceira>('pendente');
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form');
  const [progress, setProgress] = useState({ done: 0, total: 0, name: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ enrolled: number; skipped: Skipped[]; failed: Failed[] } | null>(null);

  const years = useMemo(
    () => buildAcademicYearList(db.settings, [academicYear, ...(db.classes || []).map((c) => c.academicYear)]),
    [db.settings, db.classes, academicYear]
  );
  const classes = useMemo(
    () => (db.classes || []).filter((c) => !academicYear || c.academicYear === academicYear),
    [db.classes, academicYear]
  );
  const cls = useMemo(() => classes.find((c) => String(c.id) === String(classId)), [classes, classId]);
  const tuition = useMemo(() => (cls ? findTuitionRowForGrade(db.settings?.tuitionRows, cls.grade) : undefined), [cls, db.settings?.tuitionRows]);

  // Pré-verificação (não grava): quem entra e quem é ignorado por já ter matrícula neste ano lectivo.
  const plan = useMemo(
    () => (academicYear ? dbService.planBulkEnrollment(studentIds, academicYear) : { eligible: [], skipped: [] }),
    [studentIds, academicYear, db.matriculas]
  );

  const canRun = phase === 'form' && !!cls && !!tuition && plan.eligible.length > 0;

  const run = async () => {
    if (!canRun || !cls) return;
    if (!guardPlan('armazenamento')) return;
    setError(''); setPhase('running');
    setProgress({ done: 0, total: plan.eligible.length, name: '' });
    // Grava em fatias pequenas e cede o ecrã entre elas, para a barra de progresso avançar mesmo com muitos alunos.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const ids = plan.eligible.map((s) => String(s.id));
      const SLICE = 10;
      let enrolled = 0; const skipped: Skipped[] = [...plan.skipped]; const failed: Failed[] = [];
      for (let i = 0; i < ids.length; i += SLICE) {
        const slice = ids.slice(i, i + SLICE);
        setProgress({ done: i, total: ids.length, name: plan.eligible[i]?.name || '' });
        await new Promise((r) => setTimeout(r, 0));
        const out = dbService.enrollStudentsInClass(slice, { classId: String(cls.id), academicYear, situacaoFinanceira: situacao });
        enrolled += out.enrolled.length; skipped.push(...out.skipped); failed.push(...out.failed);
        // Limite do plano / armazenamento: os restantes iriam falhar pelo mesmo motivo.
        if (out.failed.some((f) => /^Não processado:/.test(f.error))) {
          for (const rest of ids.slice(i + SLICE)) failed.push({ studentId: rest, name: plan.eligible.find((e) => String(e.id) === rest)?.name || rest, error: 'Não processado: limite do plano atingido.' });
          break;
        }
      }
      setProgress({ done: ids.length, total: ids.length, name: '' });
      setResult({ enrolled, skipped, failed });
      setPhase('done');
    } catch (e: any) {
      setError(e?.message || 'Não foi possível gravar as matrículas.');
      setPhase('form');
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const skippedNow = plan.skipped;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" data-testid="bulk-enroll-modal">
      <div className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px]">groups</span>
            <div>
              <h3 className="font-bold text-sm tracking-wide uppercase leading-tight">Matrícula em lote</h3>
              <p className="text-[11px] text-slate-300 leading-tight">{studentIds.length} aluno(s) selecionado(s) → uma única turma</p>
            </div>
          </div>
          {phase !== 'running' && (
            <button onClick={onClose} type="button" className="text-slate-400 hover:text-white p-1 cursor-pointer" aria-label="Fechar">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {phase !== 'done' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">Ano lectivo</span>
                  <select value={academicYear} disabled={phase === 'running'} onChange={(e) => { setAcademicYear(e.target.value); setClassId(''); }}
                    className="mt-1 w-full p-2 border border-slate-300 bg-white" data-testid="bulk-enroll-year">
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="font-bold text-slate-600 uppercase text-[11px]">Turma</span>
                  <select value={classId} disabled={phase === 'running'} onChange={(e) => setClassId(e.target.value)}
                    className="mt-1 w-full p-2 border border-slate-300 bg-white" data-testid="bulk-enroll-class">
                    <option value="">Selecione a turma…</option>
                    {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.grade} · {c.name} · {c.shift}</option>)}
                  </select>
                </label>
              </div>
              <label className="block max-w-[260px]">
                <span className="font-bold text-slate-600 uppercase text-[11px]">Situação financeira</span>
                <select value={situacao} disabled={phase === 'running'} onChange={(e) => setSituacao(e.target.value as SituacaoFinanceira)} className="mt-1 w-full p-2 border border-slate-300 bg-white" data-testid="bulk-enroll-situacao">
                  {SITUACAO_FINANCEIRA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="block mt-1 text-[11px] text-slate-500">
                  {situacao === 'regular' && 'Faturas registadas como pagas (a caixa abre-se automaticamente).'}
                  {situacao === 'pendente' && 'Faturas registadas como pendentes.'}
                  {situacao === 'mora' && 'Meses já vencidos ficam em mora; os restantes, pendentes.'}
                  {situacao === 'isento' && 'Sem propinas neste ano lectivo; só se cobram outros serviços.'}
                </span>
              </label>

              {cls && !tuition && (
                <Notice tone="error">
                  Não existe Tabela Financeira configurada para a classe "{cls.grade}". Configure-a em Configurações → Financeiro antes de matricular.
                </Notice>
              )}
              {cls && tuition && (
                <div className="p-3 bg-slate-50 border border-slate-200 text-slate-700">
                  Cada aluno fica com matrícula de <b>{(tuition.matriculaKz ?? 0).toLocaleString('pt-AO')} Kz</b> e propina de <b>{(tuition.monthlyTuitionKz ?? 0).toLocaleString('pt-AO')} Kz</b>/mês (Tabela Financeira da classe), com as faturas geradas como na matrícula individual.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-emerald-300 bg-emerald-50 text-emerald-900">
                  <div className="text-2xl font-black" data-testid="bulk-enroll-eligible">{plan.eligible.length}</div>
                  <div className="font-semibold">serão matriculados</div>
                </div>
                <div className={`p-3 border ${skippedNow.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  <div className="text-2xl font-black" data-testid="bulk-enroll-skipped">{skippedNow.length}</div>
                  <div className="font-semibold">ignorados (já matriculados em {academicYear || '—'})</div>
                </div>
              </div>

              {skippedNow.length > 0 && (
                <div className="border border-amber-200">
                  <div className="px-3 py-2 bg-amber-100 text-amber-900 font-bold text-[11px] uppercase">Alunos que serão ignorados</div>
                  <ul className="max-h-40 overflow-y-auto divide-y divide-amber-100">
                    {skippedNow.map((s) => (
                      <li key={s.studentId} className="px-3 py-1.5"><b>{s.name}</b> — <span className="text-slate-600">{s.detail}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {phase === 'running' && (
                <div>
                  <div className="flex justify-between font-semibold text-slate-700 mb-1">
                    <span>A matricular{progress.name ? `: ${progress.name}` : '…'}</span><span>{progress.done}/{progress.total}</span>
                  </div>
                  <div className="h-3 bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1 text-slate-500">Não feche esta janela.</p>
                </div>
              )}
              {error && <Notice tone="error">{error}</Notice>}
            </>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3" data-testid="bulk-enroll-result">
              <div className="p-3 border border-emerald-300 bg-emerald-50 text-emerald-900 font-bold text-sm">
                {result.enrolled} aluno(s) matriculado(s) em {cls?.grade} · {cls?.name} ({academicYear}).
              </div>
              {result.skipped.length > 0 && (
                <div className="border border-amber-200">
                  <div className="px-3 py-2 bg-amber-100 text-amber-900 font-bold text-[11px] uppercase">{result.skipped.length} ignorado(s) — já tinham matrícula neste ano lectivo</div>
                  <ul className="max-h-36 overflow-y-auto divide-y divide-amber-100">
                    {result.skipped.map((s) => <li key={s.studentId} className="px-3 py-1.5"><b>{s.name}</b> — {s.detail}</li>)}
                  </ul>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="border border-red-200">
                  <div className="px-3 py-2 bg-red-100 text-red-900 font-bold text-[11px] uppercase">{result.failed.length} não matriculado(s) por erro</div>
                  <ul className="max-h-36 overflow-y-auto divide-y divide-red-100">
                    {result.failed.map((f) => <li key={f.studentId} className="px-3 py-1.5"><b>{f.name}</b> — {f.error}</li>)}
                  </ul>
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
              <button type="button" onClick={run} disabled={!canRun} data-testid="bulk-enroll-confirm"
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {phase === 'running' ? 'A matricular…' : `Matricular ${plan.eligible.length} aluno(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
