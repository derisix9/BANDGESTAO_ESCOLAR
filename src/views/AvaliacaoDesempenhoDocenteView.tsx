import React, { useMemo, useState } from 'react';
import { EvaluationClassification, SchoolDatabase, TeacherEvaluation, TeacherEvaluationCriterionScore, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { CLASSIFICATION_META, EVALUATION_STATUS_META, classifyScore, computeFinalScore } from '../utils/teacherEvaluation';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface AvaliacaoDesempenhoDocenteViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{children}</span>
  </div>
);

const PERIOD_SUGGESTIONS = ['1º Trimestre', '2º Trimestre', '3º Trimestre', 'Avaliação Anual'];

export const AvaliacaoDesempenhoDocenteView: React.FC<AvaliacaoDesempenhoDocenteViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherEvaluation['status']>('all');
  const [classificationFilter, setClassificationFilter] = useState<'all' | EvaluationClassification>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherEvaluation | null>(null);
  const [teacherId, setTeacherId] = useState('');
  const [period, setPeriod] = useState('');
  const [criteria, setCriteria] = useState<TeacherEvaluationCriterionScore[]>([]);
  const [strengths, setStrengths] = useState('');
  const [areasToImprove, setAreasToImprove] = useState('');
  const [developmentPlan, setDevelopmentPlan] = useState('');
  const [formError, setFormError] = useState('');

  const [viewing, setViewing] = useState<TeacherEvaluation | null>(null);
  const [deleting, setDeleting] = useState<TeacherEvaluation | null>(null);

  const evaluations = db.teacherEvaluations || [];
  const teachers = db.teachers || [];

  const teacherOptions = useMemo(
    () => teachers.map((t) => ({ value: t.id, label: t.name, sublabel: t.department || t.category })),
    [teachers]
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return evaluations
      .filter((e) => statusFilter === 'all' || e.status === statusFilter)
      .filter((e) => classificationFilter === 'all' || e.classification === classificationFilter)
      .filter((e) => !q || e.teacherName.toLowerCase().includes(q) || e.period.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [evaluations, searchTerm, statusFilter, classificationFilter]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const run = async (action: () => void, loadingMessage: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: 'rh.avaliacao.manage', userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openNew = () => {
    setEditing(null);
    setTeacherId('');
    setPeriod('');
    setCriteria([]);
    setStrengths('');
    setAreasToImprove('');
    setDevelopmentPlan('');
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (evaluation: TeacherEvaluation) => {
    setEditing(evaluation);
    setTeacherId(evaluation.teacherId);
    setPeriod(evaluation.period);
    setCriteria(evaluation.criteria);
    setStrengths(evaluation.strengths || '');
    setAreasToImprove(evaluation.areasToImprove || '');
    setDevelopmentPlan(evaluation.developmentPlan || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handlePickTeacher = (id: string) => {
    setTeacherId(id);
    if (!editing) {
      const result = dbService.getDefaultEvaluationCriteria(id);
      if (result.success && result.criteria) {
        setCriteria(result.criteria);
      } else {
        setCriteria([]);
        setFormError(result.error || 'Não foi possível carregar os critérios.');
      }
    }
  };

  const updateCriterionScore = (key: string, score: number) => {
    setCriteria((prev) => prev.map((c) => (c.key === key ? { ...c, score } : c)));
  };

  const updateCriterionNote = (key: string, note: string) => {
    setCriteria((prev) => prev.map((c) => (c.key === key ? { ...c, note } : c)));
  };

  const liveFinalScore = useMemo(() => computeFinalScore(criteria), [criteria]);
  const liveClassification = useMemo(() => classifyScore(liveFinalScore), [liveFinalScore]);

  const handleSubmit = (status: TeacherEvaluation['status']) => async () => {
    if (!acl.can('rh.avaliacao.manage')) {
      acl.guard('rh.avaliacao.manage', () => undefined);
      return;
    }
    if (!teacherId) {
      setFormError('Selecione o professor a avaliar.');
      return;
    }
    if (!period.trim()) {
      setFormError('Indique o período da avaliação.');
      return;
    }

    let failure = '';
    const result = await run(() => {
      const r = dbService.saveTeacherEvaluation({
        id: editing?.id,
        teacherId,
        period: period.trim(),
        criteria,
        strengths: strengths.trim() || undefined,
        areasToImprove: areasToImprove.trim() || undefined,
        developmentPlan: developmentPlan.trim() || undefined,
        status
      });
      if (!r.success) {
        failure = r.error || '';
        throw new Error(r.error);
      }
    }, editing ? 'A guardar alterações da avaliação...' : 'A registar avaliação de desempenho...');

    if (result.ok) setIsFormOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar a avaliação.');
  };

  const handleHomologate = async (evaluation: TeacherEvaluation) => {
    const confirmed = await showAppConfirm(
      `Homologar a avaliação de ${evaluation.teacherName} (${evaluation.period})? Depois de homologada, a avaliação não pode mais ser editada ou eliminada.`,
      { title: 'Homologar Avaliação', variant: 'warning', confirmLabel: 'Homologar' }
    );
    if (!confirmed) return;
    await run(() => {
      dbService.homologateTeacherEvaluation(evaluation.id);
    }, `A homologar avaliação de ${evaluation.teacherName}...`);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteTeacherEvaluation(target.id);
    }, `A eliminar avaliação de ${target.teacherName}...`);
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">RECURSOS HUMANOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">AVALIAÇÃO DE DESEMPENHO</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            AVALIAÇÃO DO DOCENTE
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Critérios de assiduidade, cumprimento de prazos e aproveitamento são pré-calculados a partir dos dados já lançados no sistema; os critérios qualitativos são preenchidos pelo avaliador.
          </p>
        </div>

        {acl.can('rh.avaliacao.manage') && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">rate_review</span>
            <span>NOVA AVALIAÇÃO</span>
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Avaliações', value: evaluations.length, icon: 'insights' },
          { label: 'Homologadas', value: evaluations.filter((e) => e.status === 'homologada').length, icon: 'verified' },
          { label: 'Rascunhos', value: evaluations.filter((e) => e.status === 'rascunho').length, icon: 'edit_note' },
          {
            label: 'Nota Média',
            value: evaluations.length ? (evaluations.reduce((s, e) => s + e.finalScore, 0) / evaluations.length).toFixed(2) : '—',
            icon: 'star'
          }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-[#0b1f3a] flex items-center justify-center rounded-lg shrink-0">
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por professor ou período..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
            <option value="all">Todos os Estados</option>
            <option value="rascunho">Rascunho</option>
            <option value="concluida">Concluída</option>
            <option value="homologada">Homologada</option>
          </select>
          <select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
            <option value="all">Todas as Classificações</option>
            {(Object.keys(CLASSIFICATION_META) as EvaluationClassification[]).map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_META[c].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Professor</th>
                <th className="py-3.5 px-3 text-white">Período</th>
                <th className="py-3.5 px-3 text-white">Nota Final</th>
                <th className="py-3.5 px-3 text-white">Classificação</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhuma avaliação registada ou encontrada. Clique em "NOVA AVALIAÇÃO" para começar.
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a]">{ev.teacherName}</div>
                      <div className="text-[11px] text-slate-500">{ev.department || '—'}</div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">{ev.period}</td>
                    <td className="py-3.5 px-3 font-mono font-bold text-[#0b1f3a]">{ev.finalScore.toFixed(2)} / 5</td>
                    <td className="py-3.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CLASSIFICATION_META[ev.classification].badge}`}>
                        {CLASSIFICATION_META[ev.classification].label}
                      </span>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${EVALUATION_STATUS_META[ev.status].badge}`}>
                        {EVALUATION_STATUS_META[ev.status].label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewing(ev)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer" title="Ver avaliação">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {acl.can('rh.avaliacao.manage') && ev.status !== 'homologada' && (
                          <button onClick={() => openEdit(ev)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer" title="Editar avaliação">
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                        )}
                        {acl.can('rh.avaliacao.manage') && ev.status === 'concluida' && (
                          <button onClick={() => handleHomologate(ev)} className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer" title="Homologar avaliação">
                            <span className="material-symbols-outlined text-[18px]">verified</span>
                          </button>
                        )}
                        {acl.can('rh.avaliacao.manage') && ev.status !== 'homologada' && (
                          <button onClick={() => setDeleting(ev)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer" title="Eliminar avaliação">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={filtered.length} page={pgFiltered} onPageChange={setPgFiltered} />
        </div>
      </div>

      {/* Modal: Ver Avaliação */}
      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={viewing.teacherName}
              subtitle={`${viewing.period} · ${viewing.evaluatorName}`}
              icon="insights"
              badge={CLASSIFICATION_META[viewing.classification].label}
              onClose={() => setViewing(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
                <span className="font-bold text-slate-700 uppercase text-[11px]">Nota Final</span>
                <span className="font-mono font-extrabold text-2xl text-[#0b1f3a]">{viewing.finalScore.toFixed(2)} / 5</span>
              </div>
              <div className="space-y-2">
                {viewing.criteria.map((c) => (
                  <div key={c.key} className="border-b border-slate-100 pb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-700 font-semibold">
                        {c.label} {c.auto && <span className="text-[10px] text-slate-400">(automático)</span>}
                      </span>
                      <span className="font-mono font-bold text-[#0b1f3a]">{c.score.toFixed(1)} / 5</span>
                    </div>
                    {c.note && <p className="text-[11px] text-slate-500 mt-0.5 break-words">{c.note}</p>}
                  </div>
                ))}
              </div>
              {(
                [
                  ['Pontos Fortes', viewing.strengths],
                  ['Áreas a Melhorar', viewing.areasToImprove],
                  ['Plano de Desenvolvimento', viewing.developmentPlan]
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="uppercase font-bold text-[10px] tracking-wide text-slate-500 block mb-1">{k}</span>
                    <p className="text-slate-800 whitespace-pre-wrap break-words">{v}</p>
                  </div>
                ))}
              <p className="text-[10px] text-slate-400 pt-2">
                Avaliado em {new Date(viewing.evaluationDate).toLocaleDateString('pt-PT')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nova/Editar Avaliação */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setIsFormOpen(false); }}>
          <div className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={editing ? 'Editar Avaliação' : 'Nova Avaliação de Desempenho'}
              subtitle="Recursos Humanos · Avaliação de Desempenho Docente"
              icon="rate_review"
              onClose={() => setIsFormOpen(false)}
            />
            <form onSubmit={(e) => e.preventDefault()} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchableSelect
                  label="Professor *"
                  options={teacherOptions}
                  value={teacherId}
                  onChange={handlePickTeacher}
                  placeholder="Selecione o professor"
                  disabled={!!editing}
                />
                <div>
                  <label className={labelCls}>Período *</label>
                  <input
                    type="text"
                    list="period-suggestions"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    placeholder="Ex: 1º Trimestre"
                    className={inputCls}
                  />
                  <datalist id="period-suggestions">
                    {PERIOD_SUGGESTIONS.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
              </div>

              {criteria.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <SectionTitle icon="checklist">Critérios de Avaliação (0 a 5)</SectionTitle>
                    <span className="text-[11px] font-bold text-slate-500 shrink-0 ml-2">Peso total: 100%</span>
                  </div>
                  <div className="space-y-3">
                    {criteria.map((c) => (
                      <div key={c.key} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start border-b border-slate-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-700">{c.label}</span>
                            <span className="text-[10px] text-slate-400">peso {c.weight}%</span>
                            {c.auto && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">AUTO</span>}
                          </div>
                          {c.auto ? (
                            <p className="text-[11px] text-slate-500 mt-0.5">{c.note}</p>
                          ) : (
                            <input
                              type="text"
                              value={c.note || ''}
                              onChange={(e) => updateCriterionNote(c.key, e.target.value)}
                              placeholder="Nota / observação (opcional)"
                              className="w-full mt-1 h-8 px-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-[11px]"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="range"
                            min={0}
                            max={5}
                            step={0.5}
                            value={c.score}
                            onChange={(e) => updateCriterionScore(c.key, Number(e.target.value))}
                            className="w-28"
                          />
                          <span className="font-mono font-bold text-[#0b1f3a] w-10 text-right">{c.score.toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <span className="font-bold text-slate-700 uppercase text-[11px]">Nota Final Calculada</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-extrabold text-xl text-[#0b1f3a]">{liveFinalScore.toFixed(2)} / 5</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CLASSIFICATION_META[liveClassification].badge}`}>
                        {CLASSIFICATION_META[liveClassification].label}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <SectionTitle icon="edit_note">Observações Qualitativas</SectionTitle>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className={labelCls}>Pontos Fortes</label>
                    <textarea rows={2} value={strengths} onChange={(e) => setStrengths(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
                  </div>
                  <div>
                    <label className={labelCls}>Áreas a Melhorar</label>
                    <textarea rows={2} value={areasToImprove} onChange={(e) => setAreasToImprove(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
                  </div>
                  <div>
                    <label className={labelCls}>Plano de Desenvolvimento</label>
                    <textarea rows={2} value={developmentPlan} onChange={(e) => setDevelopmentPlan(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs resize-none" />
                  </div>
                </div>
              </div>

              {formError && (
                <Notice tone="error" icon="error">
                  <span>{formError}</span>
                </Notice>
              )}

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-300">
                <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300">
                  Cancelar
                </button>
                <button type="button" onClick={handleSubmit('rascunho')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                  Guardar Rascunho
                </button>
                <button type="button" onClick={handleSubmit('concluida')} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>CONCLUIR AVALIAÇÃO</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Eliminar */}
      {deleting && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Eliminar Avaliação" icon="warning" onClose={() => setDeleting(null)} />
            <div className="p-6">
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">Eliminar avaliação de "{deleting.teacherName}"?</h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                A avaliação referente a {deleting.period} será removida permanentemente.
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
