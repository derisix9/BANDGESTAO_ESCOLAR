import React, { useMemo, useState } from 'react';
import type { IndividualPlan, IndividualPlanStatus, InclusionNeedCategory, PlanGoalStatus, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { SearchableSelect } from '../components/SearchableSelect';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Badge, Banner, ErrorLine, Kpis, ModalShell, PageHeader, THEAD, TH, TD, areaCls, btnGhost, btnPrimary, fmtDate, inputCls, labelCls, todayIso } from '../components/moduleUi';
import { GOAL_LABELS, NEED_LABELS, daysUntil, isReviewOverdue, planProgress } from '../utils/individualPlan';

const RULE = 'plano_individual.manage';
const STATUS_LABEL: Record<IndividualPlanStatus, string> = { rascunho: 'Rascunho', ativo: 'Activo', em_revisao: 'Em revisão', encerrado: 'Encerrado' };
const STATUS_TONE: Record<IndividualPlanStatus, string> = { rascunho: 'bg-slate-100 text-slate-600', ativo: 'bg-emerald-50 text-emerald-700', em_revisao: 'bg-amber-50 text-amber-700', encerrado: 'bg-slate-100 text-slate-500' };

type GoalDraft = { id?: string; area: string; description: string; targetDate: string; status: PlanGoalStatus };
type Draft = {
  id?: string; studentId: string; category: InclusionNeedCategory; description: string; status: IndividualPlanStatus; startDate: string;
  reviewEveryMonths: number; responsible: string; supports: string; accommodations: string; goals: GoalDraft[];
};
const emptyGoal = (): GoalDraft => ({ area: '', description: '', targetDate: '', status: 'pendente' });

interface Props { db: SchoolDatabase; currentUserRole: UserRole }

export const PlanoIndividualView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const plans = db.individualPlans || [];
  const today = todayIso();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | IndividualPlanStatus>('todos');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rev, setRev] = useState({ date: today, notes: '', outcome: 'manter' as 'manter' | 'ajustar' | 'encerrar' });
  const [revError, setRevError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<IndividualPlan | null>(null);

  const detail = plans.find((p) => p.id === detailId) || null;
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return plans
      .filter((p) => (statusFilter === 'todos' || p.status === statusFilter) && (!term || p.studentName.toLowerCase().includes(term)))
      .sort((a, b) => Number(isReviewOverdue(b, today)) - Number(isReviewOverdue(a, today)) || a.studentName.localeCompare(b.studentName, 'pt'));
  }, [plans, q, statusFilter, today]);
  const { page, setPage, pageItems } = usePagedList(rows, [rows.length, q, statusFilter]);

  const studentOptions = useMemo(() => {
    const withPlan = new Set(plans.filter((p) => p.status !== 'encerrado' && p.id !== draft?.id).map((p) => p.studentId));
    return (db.students || []).filter((s) => !withPlan.has(s.id) || s.id === draft?.studentId)
      .map((s) => ({ value: s.id, label: s.name, sublabel: s.className || s.grade }));
  }, [db.students, plans, draft?.id, draft?.studentId]);

  const active = plans.filter((p) => p.status === 'ativo' || p.status === 'em_revisao').length;
  const overdue = plans.filter((p) => isReviewOverdue(p, today)).length;

  const openNew = () => {
    setFormError(null);
    setDraft({ studentId: '', category: 'aprendizagem', description: '', status: 'ativo', startDate: today, reviewEveryMonths: 3, responsible: dbService.getCurrentUser()?.name || '', supports: '', accommodations: '', goals: [emptyGoal()] });
  };
  const openEdit = (p: IndividualPlan) => {
    setFormError(null);
    setDraft({ id: p.id, studentId: p.studentId, category: p.category, description: p.description, status: p.status, startDate: p.startDate, reviewEveryMonths: p.reviewEveryMonths, responsible: p.responsible, supports: p.supports || '', accommodations: p.accommodations || '', goals: p.goals.map((g) => ({ id: g.id, area: g.area, description: g.description, targetDate: g.targetDate || '', status: g.status })) });
  };
  const save = async () => {
    if (!draft) return;
    setFormError(null);
    try {
      await runGlobalOperation(() => {
        const r = dbService.saveIndividualPlan({ ...draft, goals: draft.goals.map((g) => ({ ...g, targetDate: g.targetDate || undefined })) });
        if (!r.success) throw new Error(r.error);
      }, { loadingMessage: 'A guardar plano...', requiredRule: RULE, userRole: currentUserRole });
      setDraft(null);
    } catch (e: any) { setFormError(e?.message || 'Não foi possível guardar.'); }
  };
  const setGoalStatus = async (planId: string, goalId: string, status: PlanGoalStatus) => {
    try { await runGlobalOperation(() => { const r = dbService.setIndividualPlanGoalStatus(planId, goalId, status); if (!r.success) throw new Error(r.error); }, { loadingMessage: 'A actualizar objectivo...', requiredRule: RULE, userRole: currentUserRole }); } catch { /* erro mostrado pelo modal global */ }
  };
  const addReview = async () => {
    if (!detail) return;
    setRevError(null);
    try {
      await runGlobalOperation(() => { const r = dbService.addIndividualPlanReview(detail.id, rev); if (!r.success) throw new Error(r.error); }, { loadingMessage: 'A registar revisão...', requiredRule: RULE, userRole: currentUserRole });
      setRev({ date: today, notes: '', outcome: 'manter' });
    } catch (e: any) { setRevError(e?.message || 'Não foi possível registar.'); }
  };
  const doDelete = async () => {
    if (!deleting) return;
    const id = deleting.id; setDeleting(null);
    try { await runGlobalOperation(() => { const r = dbService.deleteIndividualPlan(id); if (!r.success) throw new Error(r.error); }, { loadingMessage: 'A eliminar plano...', requiredRule: RULE, userRole: currentUserRole }); } catch { /* idem */ }
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <PageHeader kicker="PEDAGÓGICO" title="Plano Educativo Individual"
        subtitle="Necessidades educativas especiais: objectivos, apoios e revisões periódicas por aluno."
        right={canManage ? <button className={btnPrimary} onClick={openNew}><span className="material-symbols-outlined text-[18px]">add</span>Novo plano</button> : undefined} />
      <Banner tone="warn" icon="lock">
        <strong>Dados sensíveis.</strong> Só a Direcção e quem tiver acesso personalizado a esta secção (por exemplo, o psicólogo escolar) vêem estes planos. Os encarregados e alunos não os recebem.
        Descreva as necessidades em termos pedagógicos; evite diagnósticos clínicos detalhados. O registo de auditoria guarda apenas quem alterou o quê, não o conteúdo.
      </Banner>
      <Kpis items={[
        { label: 'Planos activos', value: active, icon: 'volunteer_activism' },
        { label: 'Revisões em atraso', value: overdue, icon: 'event_busy', tone: overdue ? 'bg-red-50 text-red-700' : undefined },
        { label: 'Total de planos', value: plans.length, icon: 'folder_shared' },
        { label: 'Encerrados', value: plans.filter((p) => p.status === 'encerrado').length, icon: 'task_alt' }
      ]} />

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <input className="h-8 px-3 border border-slate-300 text-xs w-64" placeholder="Procurar aluno…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="h-8 px-2 border border-slate-300 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="todos">Todos os estados</option>
            {(Object.keys(STATUS_LABEL) as IndividualPlanStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className={THEAD}><th className={TH}>Aluno</th><th className={TH}>Categoria</th><th className={TH}>Estado</th><th className={`${TH} text-center`}>Objectivos</th><th className={TH}>Próxima revisão</th><th className={`${TH} text-right`}>Acções</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-400">Nenhum plano encontrado.</td></tr>}
              {pageItems.map((p) => {
                const late = isReviewOverdue(p, today);
                const d = daysUntil(p.nextReviewDate, today);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className={TD}><div className="font-semibold text-slate-900">{p.studentName}</div><div className="text-[10px] text-slate-500">{p.className || ''}</div></td>
                    <td className={TD}>{NEED_LABELS[p.category]}</td>
                    <td className={TD}><Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge></td>
                    <td className={`${TD} text-center font-mono`}>{planProgress(p.goals)}% <span className="text-slate-400">({p.goals.length})</span></td>
                    <td className={TD}>{p.status === 'encerrado' ? '—' : <>{fmtDate(p.nextReviewDate)} {late ? <Badge tone="bg-red-50 text-red-700">Atrasada {Math.abs(d)} d</Badge> : d <= 14 ? <Badge tone="bg-amber-50 text-amber-700">em {d} d</Badge> : null}</>}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => { setDetailId(p.id); setRevError(null); }} title="Abrir plano" aria-label="Abrir plano"><span className="material-symbols-outlined text-[18px]">visibility</span></button>
                      {canManage && <><button type="button" onClick={() => openEdit(p)} title="Editar plano" aria-label="Editar plano"><span className="material-symbols-outlined text-[18px]">edit</span></button><button type="button" onClick={() => setDeleting(p)} title="Eliminar plano" aria-label="Eliminar plano"><span className="material-symbols-outlined text-[18px]">delete</span></button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={rows.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {draft && (
        <ModalShell wide>
          <FormModalHeader title={draft.id ? 'Editar Plano' : 'Novo Plano Individual'} subtitle="Dados sensíveis" icon="volunteer_activism" onClose={() => setDraft(null)} />
          <div className="p-6 space-y-3 overflow-y-auto">
            <ErrorLine message={formError} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><label className={labelCls}>Aluno</label>
                <SearchableSelect options={studentOptions} value={draft.studentId} disabled={!!draft.id} onChange={(v) => setDraft({ ...draft, studentId: v })} placeholder="Pesquise o aluno…" maxResults={50} /></div>
              <div><label className={labelCls}>Categoria</label>
                <select className={inputCls} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as InclusionNeedCategory })}>
                  {(Object.keys(NEED_LABELS) as InclusionNeedCategory[]).map((k) => <option key={k} value={k}>{NEED_LABELS[k]}</option>)}
                </select></div>
              <div><label className={labelCls}>Estado</label>
                <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as IndividualPlanStatus })}>
                  {(Object.keys(STATUS_LABEL) as IndividualPlanStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
                </select></div>
              <div><label className={labelCls}>Início</label><input type="date" className={inputCls} value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></div>
              <div><label className={labelCls}>Rever de (meses)</label><input type="number" min={1} max={12} className={inputCls} value={draft.reviewEveryMonths} onChange={(e) => setDraft({ ...draft, reviewEveryMonths: Number(e.target.value) })} /></div>
              <div className="md:col-span-2"><label className={labelCls}>Responsável pelo plano</label><input className={inputCls} value={draft.responsible} onChange={(e) => setDraft({ ...draft, responsible: e.target.value })} /></div>
            </div>
            <div><label className={labelCls}>Necessidades educativas</label><textarea rows={3} className={areaCls} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className={labelCls}>Apoios e recursos</label><textarea rows={2} className={areaCls} value={draft.supports} onChange={(e) => setDraft({ ...draft, supports: e.target.value })} /></div>
              <div><label className={labelCls}>Adaptações (avaliação / currículo)</label><textarea rows={2} className={areaCls} value={draft.accommodations} onChange={(e) => setDraft({ ...draft, accommodations: e.target.value })} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><label className={labelCls}>Objectivos</label>
                <button type="button" className={btnGhost} onClick={() => setDraft({ ...draft, goals: [...draft.goals, emptyGoal()] })}>+ Objectivo</button></div>
              <div className="space-y-2">
                {draft.goals.map((g, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className={`${inputCls} col-span-3`} placeholder="Área" value={g.area} onChange={(e) => setDraft({ ...draft, goals: draft.goals.map((x, k) => k === i ? { ...x, area: e.target.value } : x) })} />
                    <input className={`${inputCls} col-span-5`} placeholder="Objectivo" value={g.description} onChange={(e) => setDraft({ ...draft, goals: draft.goals.map((x, k) => k === i ? { ...x, description: e.target.value } : x) })} />
                    <input type="date" className={`${inputCls} col-span-3`} value={g.targetDate} onChange={(e) => setDraft({ ...draft, goals: draft.goals.map((x, k) => k === i ? { ...x, targetDate: e.target.value } : x) })} />
                    <button type="button" className="col-span-1 text-red-600 material-symbols-outlined text-[18px]" title="Remover" onClick={() => setDraft({ ...draft, goals: draft.goals.filter((_, k) => k !== i) })}>delete</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2"><button className={btnGhost} onClick={() => setDraft(null)}>Cancelar</button><button className={btnPrimary} onClick={() => void save()}>Guardar</button></div>
          </div>
        </ModalShell>
      )}

      {detail && (
        <ModalShell wide>
          <FormModalHeader title={detail.studentName} subtitle={`${NEED_LABELS[detail.category]} · ${STATUS_LABEL[detail.status]}`} icon="folder_shared" onClose={() => setDetailId(null)} />
          <div className="p-6 space-y-4 overflow-y-auto text-xs">
            <p><b>Necessidades:</b> {detail.description}</p>
            {detail.supports && <p><b>Apoios:</b> {detail.supports}</p>}
            {detail.accommodations && <p><b>Adaptações:</b> {detail.accommodations}</p>}
            <p className="text-slate-500">Responsável: {detail.responsible} · Início {fmtDate(detail.startDate)} · Revisão de {detail.reviewEveryMonths} em {detail.reviewEveryMonths} meses</p>
            <div>
              <h4 className="font-bold text-[#0b1f3a] uppercase text-[11px] mb-1">Objectivos ({planProgress(detail.goals)}% atingidos)</h4>
              <div className="space-y-1.5">
                {detail.goals.map((g) => (
                  <div key={g.id} className="border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-3">
                    <div><div className="font-semibold text-slate-800">{g.description}</div><div className="text-[10px] text-slate-500">{g.area}{g.targetDate ? ` · até ${fmtDate(g.targetDate)}` : ''}</div></div>
                    {canManage && detail.status !== 'encerrado'
                      ? <select className="h-8 px-2 border border-slate-300 text-[11px]" value={g.status} onChange={(e) => void setGoalStatus(detail.id, g.id, e.target.value as PlanGoalStatus)}>
                          {(Object.keys(GOAL_LABELS) as PlanGoalStatus[]).map((k) => <option key={k} value={k}>{GOAL_LABELS[k]}</option>)}
                        </select>
                      : <Badge tone="bg-slate-100 text-slate-600">{GOAL_LABELS[g.status]}</Badge>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-bold text-[#0b1f3a] uppercase text-[11px] mb-1">Revisões</h4>
              {detail.reviews.length === 0 ? <p className="text-slate-400">Ainda sem revisões. Próxima: {fmtDate(detail.nextReviewDate)}.</p> : detail.reviews.map((r) => (
                <div key={r.id} className="border border-slate-200 rounded-lg p-2.5 mb-1.5">
                  <div className="font-bold text-slate-800">{fmtDate(r.date)} · {r.outcome === 'manter' ? 'Manter plano' : r.outcome === 'ajustar' ? 'Ajustar plano' : 'Plano encerrado'} <span className="font-normal text-slate-400">— {r.author}</span></div>
                  <p className="text-slate-600 mt-0.5">{r.notes}</p>
                </div>
              ))}
            </div>
            {canManage && detail.status !== 'encerrado' && (
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <h4 className="font-bold text-[#0b1f3a] uppercase text-[11px]">Registar revisão</h4>
                <ErrorLine message={revError} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={inputCls} value={rev.date} onChange={(e) => setRev({ ...rev, date: e.target.value })} />
                  <select className={inputCls} value={rev.outcome} onChange={(e) => setRev({ ...rev, outcome: e.target.value as any })}>
                    <option value="manter">Manter o plano</option><option value="ajustar">Ajustar o plano</option><option value="encerrar">Encerrar o plano</option>
                  </select>
                </div>
                <textarea rows={2} className={areaCls} placeholder="Balanço da revisão" value={rev.notes} onChange={(e) => setRev({ ...rev, notes: e.target.value })} />
                <div className="flex justify-end"><button className={btnPrimary} onClick={() => void addReview()}>Registar revisão</button></div>
              </div>
            )}
          </div>
        </ModalShell>
      )}

      <AppConfirmModal isOpen={!!deleting} title="Eliminar plano" variant="error" confirmLabel="Eliminar"
        message={`Eliminar o plano de "${deleting?.studentName}"? Não pode ser revertido. Se o plano terminou, prefira encerrá-lo numa revisão.`}
        onConfirm={() => void doDelete()} onCancel={() => setDeleting(null)} />
    </div>
  );
};
