import React, { useMemo, useState } from 'react';
import type { DropoutCaseStatus, DropoutFollowUp, DropoutFollowUpKind, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { TablePagination, usePagedList } from '../components/TablePagination';
import {
  computeDropoutRisk, summarizeRisk, DROPOUT_LEVEL_META, dropoutAlertLabel,
  DEFAULT_DROPOUT_THRESHOLDS, resolveDropoutThresholds, validateDropoutThresholds,
  type DropoutLevel, type DropoutThresholds, type StudentDropoutRisk
} from '../utils/dropoutRisk';
import { Notice } from '../components/Notice';

const RULE = 'evasao.manage';

const KIND_LABELS: Record<DropoutFollowUpKind, string> = {
  contacto_telefonico: 'Contacto telefónico',
  visita_domiciliar: 'Visita domiciliar',
  reuniao_encarregado: 'Reunião com o encarregado',
  carta_convocatoria: 'Carta / convocatória',
  apoio_pedagogico: 'Apoio pedagógico',
  apoio_social: 'Apoio social',
  outro: 'Outro'
};
const STATUS_LABELS: Record<DropoutCaseStatus, string> = {
  em_acompanhamento: 'Em acompanhamento',
  recuperado: 'Recuperado (voltou a frequentar)',
  desistiu: 'Desistiu',
  transferido: 'Transferido'
};

const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';
const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT') : '—');
const todayIso = () => new Date().toISOString().slice(0, 10);

interface Props { db: SchoolDatabase; currentUserRole: UserRole }

export const EvasaoEscolarView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);

  const [q, setQ] = useState('');
  const [levelFilter, setLevelFilter] = useState<'todos' | DropoutLevel>('todos');
  const [classFilter, setClassFilter] = useState('todas');
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [target, setTarget] = useState<StudentDropoutRisk | null>(null);   // novo acompanhamento
  const [history, setHistory] = useState<StudentDropoutRisk | null>(null);
  const [deleting, setDeleting] = useState<DropoutFollowUp | null>(null);
  const [error, setError] = useState<string | null>(null);

  // formulário
  const [date, setDate] = useState(todayIso());
  const [kind, setKind] = useState<DropoutFollowUpKind>('contacto_telefonico');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [caseStatus, setCaseStatus] = useState<DropoutCaseStatus>('em_acompanhamento');

  const followUps = db.dropoutFollowUps || [];
  const thresholds = useMemo(() => resolveDropoutThresholds(db.settings?.dropoutThresholds), [db.settings?.dropoutThresholds]);
  const [showLimits, setShowLimits] = useState(false);
  const [draft, setDraft] = useState<DropoutThresholds>(thresholds);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const all = useMemo(
    () => computeDropoutRisk({ students: db.students || [], attendanceSheets: db.attendanceSheets || [], invoices: db.invoices || [], followUps, thresholds }),
    [db.students, db.attendanceSheets, db.invoices, followUps, thresholds]
  );

  const setDraftField = (k: keyof DropoutThresholds, v: string) => setDraft((d) => ({ ...d, [k]: v === '' ? NaN : Number(v) }));
  const saveLimits = async (next: DropoutThresholds) => {
    const errs = validateDropoutThresholds(next);
    if (errs.length) { setLimitsError(errs[0]); return; }
    setLimitsError(null);
    try {
      await runGlobalOperation(
        () => { dbService.updateSettings({ dropoutThresholds: { ...next } }); },
        { loadingMessage: 'A guardar limites de risco...', requiredRule: RULE, userRole: currentUserRole }
      );
      setDraft(next);
    } catch (e: any) { setLimitsError(e?.message || 'Não foi possível guardar.'); }
  };
  const summary = useMemo(() => summarizeRisk(all), [all]);
  const classes = useMemo(() => [...new Set(all.map((r) => r.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')), [all]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((r) => {
      if (!showClosed && r.closed) return false;
      if (r.level === 'baixo' && !r.lastFollowUp) return false;           // sem risco e sem caso aberto: não aparece
      if (levelFilter !== 'todos' && r.level !== levelFilter) return false;
      if (classFilter !== 'todas' && r.className !== classFilter) return false;
      if (onlyAlerts && !r.alert) return false;
      if (term && !r.name.toLowerCase().includes(term) && !r.guardianName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [all, q, levelFilter, classFilter, onlyAlerts, showClosed]);
  const { page, setPage, pageItems } = usePagedList(rows, [rows.length, q, levelFilter, classFilter, onlyAlerts, showClosed]);

  const openNew = (r: StudentDropoutRisk) => {
    setTarget(r); setError(null); setDate(todayIso()); setKind('contacto_telefonico');
    setNote(''); setOutcome(''); setNextActionDate(''); setCaseStatus('em_acompanhamento');
  };

  const handleSave = async () => {
    if (!target) return;
    setError(null);
    try {
      await runGlobalOperation(
        () => {
          const res = dbService.saveDropoutFollowUp({ studentId: target.studentId, date, kind, note, outcome, nextActionDate: nextActionDate || undefined, caseStatus });
          if (!res.success) throw new Error(res.error || 'Não foi possível guardar o acompanhamento.');
        },
        { loadingMessage: 'A registar acompanhamento...', requiredRule: RULE, userRole: currentUserRole }
      );
      setTarget(null);
    } catch (e: any) { setError(e?.message || 'Não foi possível guardar.'); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    try {
      await runGlobalOperation(
        () => { const res = dbService.deleteDropoutFollowUp(id); if (!res.success) throw new Error(res.error); },
        { loadingMessage: 'A eliminar registo...', requiredRule: RULE, userRole: currentUserRole }
      );
    } catch { /* erro já mostrado pelo modal global */ }
  };

  const studentHistory = history ? followUps.filter((f) => f.studentId === history.studentId).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')) : [];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RELATÓRIOS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">EVASÃO ESCOLAR</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">ALUNOS EM RISCO DE ABANDONO</h1>
        <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
          Risco calculado por aluno a partir da presença, das faltas injustificadas, da média e das propinas em atraso.
          Registe cada contacto, visita ou apoio para que o caso não fique esquecido.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Risco Alto', value: summary.alto, icon: 'warning', tone: summary.alto ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-[#0b1f3a]' },
          { label: 'Risco Médio', value: summary.medio, icon: 'error_outline', tone: summary.medio ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-[#0b1f3a]' },
          { label: 'Com Alerta', value: summary.comAlerta, icon: 'notifications_active', tone: summary.comAlerta ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-[#0b1f3a]' },
          { label: 'Em Acompanhamento', value: summary.emAcompanhamento, icon: 'support_agent', tone: 'bg-slate-100 text-[#0b1f3a]' }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${k.tone}`}>
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button type="button" onClick={() => { setDraft(thresholds); setLimitsError(null); setShowLimits((v) => !v); }} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2 text-xs font-bold text-[#0b1f3a] uppercase tracking-wider">
            <span className="material-symbols-outlined text-[18px]">tune</span>Limites de risco
          </span>
          <span className="material-symbols-outlined text-[18px] text-slate-400">{showLimits ? 'expand_less' : 'expand_more'}</span>
        </button>
        {showLimits && (
          <div className="p-4 border-t border-slate-100 space-y-4">
            <p className="text-[11px] text-slate-500">
              Cada sinal dá pontos de risco; a soma decide o nível. {canManage ? 'Ajuste os limites à realidade da escola.' : 'Só quem gere a evasão pode alterar estes valores.'}
            </p>
            {limitsError && <Notice tone="error">{limitsError}</Notice>}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {([
                ['attendanceHigh', 'Presença abaixo de (%) · 3 pts'], ['attendanceMid', 'Presença abaixo de (%) · 2 pts'], ['attendanceLow', 'Presença abaixo de (%) · 1 pt'],
                ['absencesHigh', 'Faltas injust. a partir de · 2 pts'], ['absencesMid', 'Faltas injust. a partir de · 1 pt'],
                ['averageHigh', 'Média abaixo de · 3 pts'], ['averageMid', 'Média abaixo de · 2 pts'],
                ['scoreHigh', 'Pontos para risco ALTO'], ['scoreMedium', 'Pontos para risco MÉDIO'], ['staleDays', 'Dias sem contacto (alerta)']
              ] as [keyof DropoutThresholds, string][]).map(([k, label]) => (
                <div key={k}>
                  <label className={labelCls}>{label}</label>
                  <input type="number" min="0" step="any" disabled={!canManage} value={Number.isNaN(draft[k]) ? '' : draft[k]} onChange={(e) => setDraftField(k, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Propinas em atraso: 1 = 1 pt, 2 = 2 pts, 3 ou mais = 3 pts (fixo).</p>
            {canManage && (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => saveLimits({ ...DEFAULT_DROPOUT_THRESHOLDS })} className="h-9 px-4 text-xs font-bold text-slate-600">Repor padrão</button>
                <button type="button" onClick={() => saveLimits(draft)} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">Guardar limites</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className={labelCls}>Pesquisar</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do aluno ou do encarregado..." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nível</label>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as any)} className={inputCls}>
              <option value="todos">Todos</option><option value="alto">Alto</option><option value="medio">Médio</option><option value="baixo">Baixo (com caso aberto)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Turma</label>
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={inputCls}>
              <option value="todas">Todas</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} /> Só com alerta
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Mostrar casos encerrados
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <span className="material-symbols-outlined text-[40px]">task_alt</span>
            <p className="text-xs font-semibold">Nenhum aluno em risco com estes filtros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="text-left px-4 py-3 text-white">Aluno</th>
                  <th className="text-left px-4 py-3 text-white">Turma</th>
                  <th className="text-left px-4 py-3 text-white">Risco</th>
                  <th className="text-left px-4 py-3 text-white">Motivos</th>
                  <th className="text-left px-4 py-3 text-white">Encarregado</th>
                  <th className="text-left px-4 py-3 text-white">Último acompanhamento</th>
                  <th className="text-right px-4 py-3 text-white">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((r) => (
                  <tr key={r.studentId} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.className || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${DROPOUT_LEVEL_META[r.level].tone}`}>{DROPOUT_LEVEL_META[r.level].label}</span>
                      {r.alert && (
                        <div className="mt-1 text-[10px] font-bold text-red-700 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">notifications_active</span>{dropoutAlertLabel(r.alert, thresholds.staleDays)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.reasons.length ? r.reasons.join(' · ') : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.guardianName || '—'}{r.guardianPhone ? <div className="text-slate-400">{r.guardianPhone}</div> : null}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.lastFollowUp ? (
                        <>
                          <div>{fmtDate(r.lastFollowUp.date)} · {KIND_LABELS[r.lastFollowUp.kind]}</div>
                          <div className="text-[10px] text-slate-400">{STATUS_LABELS[r.lastFollowUp.caseStatus]}{r.lastFollowUp.nextActionDate ? ` · próxima: ${fmtDate(r.lastFollowUp.nextActionDate)}` : ''}</div>
                        </>
                      ) : <span className="text-slate-400">Nenhum</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setHistory(r)} title="Ver histórico" className="p-1.5 text-slate-500 hover:text-[#0b1f3a]">
                          <span className="material-symbols-outlined text-[18px]">history</span>
                        </button>
                        {canManage && (
                          <button onClick={() => openNew(r)} title="Registar acompanhamento" className="p-1.5 text-emerald-600 hover:text-emerald-800">
                            <span className="material-symbols-outlined text-[18px]">add_task</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={rows.length} page={page} onPageChange={setPage} />
          </div>
        )}
      </div>

      {target && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <FormModalHeader title="Registar Acompanhamento" subtitle={`${target.name}${target.className ? ' · ' + target.className : ''}`} icon="support_agent" onClose={() => setTarget(null)} />
            <div className="p-6 space-y-3 overflow-y-auto">
              {error && <Notice tone="error">{error}</Notice>}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Tipo</label>
                  <select value={kind} onChange={(e) => setKind(e.target.value as DropoutFollowUpKind)} className={inputCls}>
                    {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>O que foi feito</label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full px-3 py-2 bg-white border border-slate-300 text-xs focus:border-[#0b1f3a] focus:outline-none" /></div>
              <div><label className={labelCls}>Resultado (opcional)</label><input value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls} placeholder="Ex.: Encarregado prometeu regularizar até dia 10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Próxima ação em</label><input type="date" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Estado do caso</label>
                  <select value={caseStatus} onChange={(e) => setCaseStatus(e.target.value as DropoutCaseStatus)} className={inputCls}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-slate-400">Se a próxima ação passar sem novo registo, o aluno fica com alerta. Casos recuperados, desistentes ou transferidos deixam de gerar alertas.</p>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className="h-9 px-4 text-xs font-bold text-slate-600">Cancelar</button>
              <button onClick={handleSave} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <FormModalHeader title="Histórico de Acompanhamento" subtitle={history.name} icon="history" onClose={() => setHistory(null)} />
            <div className="p-6 space-y-3 overflow-y-auto text-xs">
              <p className="text-slate-600"><b>Motivos de risco:</b> {history.reasons.length ? history.reasons.join(' · ') : 'nenhum sinal actual'}</p>
              {studentHistory.length === 0 ? (
                <p className="text-slate-400">Ainda não há acompanhamentos registados.</p>
              ) : studentHistory.map((f) => (
                <div key={f.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">{fmtDate(f.date)} · {KIND_LABELS[f.kind]}</span>
                    {canManage && (
                      <button onClick={() => setDeleting(f)} title="Eliminar" className="text-slate-400 hover:text-red-600">
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    )}
                  </div>
                  <p className="text-slate-700 mt-1 whitespace-pre-wrap break-words">{f.note}</p>
                  {f.outcome && <p className="text-slate-500 mt-1"><b>Resultado:</b> {f.outcome}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">{STATUS_LABELS[f.caseStatus]}{f.nextActionDate ? ` · próxima ação: ${fmtDate(f.nextActionDate)}` : ''} · por {f.createdBy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <AppConfirmModal
        isOpen={!!deleting}
        title="Eliminar Registo"
        message="Tem a certeza que pretende eliminar este registo de acompanhamento? Esta ação não pode ser revertida."
        variant="error"
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
};
