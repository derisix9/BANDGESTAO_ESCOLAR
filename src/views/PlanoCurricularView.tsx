import React, { useMemo, useState } from 'react';
import { CurriculumPlan, CurriculumUnit, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { getAvailableGrades } from '../utils/educationSubsystems';
import { getSubjectsForGrade } from '../utils/classSubjects';
import { institutionAcademicYears } from '../utils/academicYear';
import { nextAcademicYearLabel } from '../utils/academicCalendar';
import {
  CURRICULUM_STATUS_META,
  TRIMESTER_LABELS,
  TRIMESTERS,
  TrimesterKey,
  UNIT_STATUS_META,
  capacityByTrimester,
  capacityWarnings,
  delayedUnits,
  expectedCoverage,
  missingCoverage,
  normalizeUnit,
  planProgress,
  plansToCsv,
  unitStatus
} from '../utils/curriculum';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface PlanoCurricularViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const areaCls = 'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

type PlanForm = {
  academicYear: string;
  subjectName: string;
  grade: string;
  weeklyHours: string;
  generalObjectives: string;
  methodology: string;
  evaluationCriteria: string;
  bibliography: string;
  units: CurriculumUnit[];
};

const emptyForm = (academicYear: string): PlanForm => ({
  academicYear,
  subjectName: '',
  grade: '',
  weeklyHours: '',
  generalObjectives: '',
  methodology: '',
  evaluationCriteria: '',
  bibliography: '',
  units: []
});

const formFromPlan = (p: CurriculumPlan): PlanForm => ({
  academicYear: p.academicYear,
  subjectName: p.subjectName,
  grade: p.grade,
  weeklyHours: String(p.weeklyHours || ''),
  generalObjectives: p.generalObjectives || '',
  methodology: p.methodology || '',
  evaluationCriteria: p.evaluationCriteria || '',
  bibliography: p.bibliography || '',
  units: (p.units || []).map((u) => ({ ...u }))
});

const newUnit = (trimester: TrimesterKey): CurriculumUnit =>
  normalizeUnit({ trimester }, `unit-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`);

export const PlanoCurricularView: React.FC<PlanoCurricularViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('curriculo.manage');
  const canApprove = acl.can('curriculo.approve');

  const yearOptions = useMemo(
    () => institutionAcademicYears(db.settings, (db.curriculumPlans || []).map((p) => p.academicYear)),
    [db.settings, db.curriculumPlans]
  );
  const currentYear = db.settings?.currentAcademicYear || yearOptions[0];
  const defaultYear = currentYear;
  const gradeOptions = useMemo(() => getAvailableGrades(db.settings?.selectedSubsystems), [db.settings?.selectedSubsystems]);

  const plans = db.curriculumPlans || [];

  const [yearFilter, setYearFilter] = useState(defaultYear);
  const [gradeFilter, setGradeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CurriculumPlan['status']>('all');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CurriculumPlan | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm(defaultYear));
  // Disciplinas da Classe selecionada no formulário, a partir da Atribuição
  // (Secretaria Académica → Atribuição) — em vez da lista completa de
  // disciplinas da instituição, para não sugerir disciplinas de outras
  // Classes/Cursos. `allowCustom` no SearchableSelect continua a permitir
  // escrever uma disciplina nova enquanto a Atribuição dessa Classe não
  // estiver completa.
  const subjectOptions = useMemo(
    () => getSubjectsForGrade(db, form.grade).map((s) => ({ value: s.name, label: s.name, sublabel: s.area })),
    [db, form.grade]
  );
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [activeTrimester, setActiveTrimester] = useState<TrimesterKey>('1');

  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = plans.find((p) => p.id === viewingId) || null;
  const [progressUnit, setProgressUnit] = useState<CurriculumUnit | null>(null);
  const [progressValue, setProgressValue] = useState('');
  const [progressNotes, setProgressNotes] = useState('');
  const [progressError, setProgressError] = useState('');

  const [cloneTarget, setCloneTarget] = useState<CurriculumPlan | null>(null);
  const [cloneYear, setCloneYear] = useState('');
  const [cloneGrade, setCloneGrade] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans
      .filter((p) => yearFilter === 'all' || p.academicYear === yearFilter)
      .filter((p) => gradeFilter === 'all' || p.grade === gradeFilter)
      .filter((p) => statusFilter === 'all' || p.status === statusFilter)
      .filter((p) => !q || p.subjectName.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.grade.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [plans, yearFilter, gradeFilter, statusFilter, search]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const coverage = useMemo(() => {
    const targets = expectedCoverage(db.classes || [], db.subjects || [], yearFilter === 'all' ? defaultYear : yearFilter);
    const missing = missingCoverage(targets, plans, yearFilter === 'all' ? defaultYear : yearFilter);
    return { total: targets.length, missing };
  }, [db.classes, db.subjects, plans, yearFilter, defaultYear]);

  const counts = useMemo(() => {
    const inYear = plans.filter((p) => yearFilter === 'all' || p.academicYear === yearFilter);
    const map: Record<string, number> = {};
    inYear.forEach((p) => (map[p.status] = (map[p.status] || 0) + 1));
    return { total: inYear.length, map };
  }, [plans, yearFilter]);

  const run = async (action: () => void, rule: string, loadingMessage: string, successMessage?: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(yearFilter !== 'all' ? yearFilter : defaultYear));
    setFormErrors([]);
    setActiveTrimester('1');
    setFormOpen(true);
  };
  const openEdit = (p: CurriculumPlan) => {
    setEditing(p);
    setForm(formFromPlan(p));
    setFormErrors([]);
    setActiveTrimester('1');
    setFormOpen(true);
  };

  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addUnit = () => set('units', [...form.units, newUnit(activeTrimester)]);
  const updateUnit = (id: string, patch: Partial<CurriculumUnit>) =>
    set('units', form.units.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  const removeUnit = (id: string) => set('units', form.units.filter((u) => u.id !== id));

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    let errs: string[] = [];
    const payload = {
      id: editing?.id,
      academicYear: form.academicYear,
      subjectName: form.subjectName,
      grade: form.grade,
      weeklyHours: Number(form.weeklyHours) || 0,
      generalObjectives: form.generalObjectives,
      methodology: form.methodology,
      evaluationCriteria: form.evaluationCriteria,
      bibliography: form.bibliography,
      units: form.units
    };
    const result = await run(
      () => {
        const r = dbService.saveCurriculumPlan(payload as any);
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'curriculo.manage',
      editing ? 'A guardar plano...' : 'A criar plano...',
      editing ? 'Plano atualizado!' : 'Plano criado!'
    );
    if (result.ok) setFormOpen(false);
    else setFormErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const approve = async (p: CurriculumPlan) => {
    const ok = await showAppConfirm(`Aprovar o plano ${p.code} (${p.subjectName}, ${p.grade})? Passa a poder registar-se o progresso leccionado.`, {
      title: 'Aprovar Plano',
      confirmLabel: 'Aprovar'
    });
    if (!ok) return;
    let err = '';
    await run(
      () => {
        const r = dbService.approveCurriculumPlan(p.id);
        if (!r.success) {
          err = (r.errors?.length ? r.errors.join(' ') : r.error) || '';
          throw new Error(err);
        }
      },
      'curriculo.approve',
      'A aprovar plano...',
      'Plano aprovado!'
    );
  };

  const reopen = async (p: CurriculumPlan) => {
    const ok = await showAppConfirm(`Reabrir o plano ${p.code}? Fica em Rascunho e precisa de nova aprovação (o progresso já registado mantém-se).`, {
      title: 'Reabrir Plano',
      variant: 'warning',
      confirmLabel: 'Reabrir'
    });
    if (!ok) return;
    await run(() => {
      const r = dbService.reopenCurriculumPlan(p.id);
      if (!r.success) throw new Error(r.error);
    }, 'curriculo.approve', 'A reabrir plano...', 'Plano reaberto.');
  };

  const archive = async (p: CurriculumPlan) => {
    const ok = await showAppConfirm(`Arquivar o plano ${p.code}?`, { title: 'Arquivar Plano', confirmLabel: 'Arquivar' });
    if (!ok) return;
    await run(() => {
      const r = dbService.archiveCurriculumPlan(p.id);
      if (!r.success) throw new Error(r.error);
    }, 'curriculo.approve', 'A arquivar plano...', 'Plano arquivado.');
  };

  const remove = async (p: CurriculumPlan) => {
    const ok = await showAppConfirm(`Eliminar o rascunho ${p.code}? Esta ação não pode ser desfeita.`, {
      title: 'Eliminar Plano',
      variant: 'error',
      confirmLabel: 'Eliminar'
    });
    if (!ok) return;
    const result = await run(() => {
      const r = dbService.deleteCurriculumPlan(p.id);
      if (!r.success) throw new Error(r.error);
    }, 'curriculo.manage', 'A eliminar plano...', 'Plano eliminado.');
    if (result.ok) setViewingId(null);
  };

  const openProgress = (unit: CurriculumUnit) => {
    setProgressUnit(unit);
    setProgressValue(String(unit.deliveredLessons || 0));
    setProgressNotes(unit.notes || '');
    setProgressError('');
  };

  const submitProgress = async () => {
    if (!viewing || !progressUnit) return;
    let err = '';
    const result = await run(
      () => {
        const r = dbService.registerUnitProgress(viewing.id, progressUnit.id, {
          deliveredLessons: Number(progressValue) || 0,
          notes: progressNotes
        });
        if (!r.success) {
          err = r.error || '';
          throw new Error(err);
        }
      },
      'curriculo.manage',
      'A registar progresso...',
      'Progresso registado!'
    );
    if (result.ok) setProgressUnit(null);
    else setProgressError(err || result.error || 'Não foi possível registar.');
  };

  const submitClone = async () => {
    if (!cloneTarget) return;
    let err = '';
    const result = await run(
      () => {
        const r = dbService.clonePlanTo(cloneTarget.id, { academicYear: cloneYear, grade: cloneGrade });
        if (!r.success) {
          err = (r.errors?.length ? r.errors.join(' ') : r.error) || '';
          throw new Error(err);
        }
      },
      'curriculo.manage',
      'A copiar plano...',
      'Plano copiado!'
    );
    if (result.ok) setCloneTarget(null);
  };

  const exportCsv = () => {
    // BOM: sem ele o Excel abre os acentos (ç, ã, é...) desfeitos.
    const blob = new Blob(['\uFEFF' + plansToCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plano_curricular_${yearFilter === 'all' ? 'todos' : yearFilter.replace('/', '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const capRows = useMemo(
    () => capacityByTrimester(form.units, Number(form.weeklyHours) || 0, (db.settings as any)?.trimesterSchedules),
    [form.units, form.weeklyHours, db.settings]
  );
  const capWarnings = useMemo(
    () => capacityWarnings(form.units, Number(form.weeklyHours) || 0, (db.settings as any)?.trimesterSchedules),
    [form.units, form.weeklyHours, db.settings]
  );

  const viewingDelays = useMemo(
    () => (viewing ? delayedUnits(viewing, (db.settings as any)?.trimesterSchedules, new Date().toISOString().slice(0, 10)) : []),
    [viewing, db.settings]
  );

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">PLANO CURRICULAR E CONTEÚDOS</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">PLANOS CURRICULARES</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="tems-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>EXPORTAR CSV</span>
          </button>
          {canManage && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>NOVO PLANO</span>
            </button>
          )}
        </div>
      </div>

      {coverage.missing.length > 0 && (
        <Notice tone="warn" icon="warning">
          <div>
            <strong>{coverage.missing.length}</strong> combinação(ões) disciplina/classe sem plano em {yearFilter === 'all' ? defaultYear : yearFilter}:{' '}
            {coverage.missing.slice(0, 6).map((t) => `${t.subject.name} (${t.grade})`).join('; ')}
            {coverage.missing.length > 6 ? '…' : ''}
          </div>
        </Notice>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(Object.keys(CURRICULUM_STATUS_META) as CurriculumPlan['status'][]).map((st) => {
          const meta = CURRICULUM_STATUS_META[st];
          const active = statusFilter === st;
          return (
            <button
              key={st}
              onClick={() => setStatusFilter(active ? 'all' : st)}
              className={`text-left bg-white border rounded-xl p-3 transition-colors cursor-pointer ${
                active ? 'border-[#0b1f3a] ring-1 ring-[#0b1f3a]' : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5 text-slate-500">
                <span className="material-symbols-outlined text-[16px]">{meta.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide truncate">{meta.label}</span>
              </div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{counts.map[st] || 0}</div>
            </button>
          );
        })}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar disciplina, código ou classe..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
            <option value="all">Todos os Anos Letivos</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
            <option value="all">Todas as Classes</option>
            {gradeOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400 font-mono">{filtered.length} de {counts.total}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Plano</th>
                <th className="py-3.5 px-3">Classe</th>
                <th className="py-3.5 px-3">Tempos/Semana</th>
                <th className="py-3.5 px-3">Progresso</th>
                <th className="py-3.5 px-3">Estado</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    {plans.length === 0 ? 'Ainda não há planos. Clique em "NOVO PLANO" para criar o primeiro.' : 'Nenhum plano corresponde aos filtros.'}
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((p) => {
                  const meta = CURRICULUM_STATUS_META[p.status];
                  const prog = planProgress(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <button onClick={() => setViewingId(p.id)} className="font-bold text-[#0b1f3a] hover:underline text-left cursor-pointer">
                          {p.subjectName}
                        </button>
                        <div className="text-[11px] text-slate-500 font-mono">{p.code} · {p.academicYear}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">{p.grade}</td>
                      <td className="py-3 px-3 text-slate-700 font-mono">{p.weeklyHours}</td>
                      <td className="py-3 px-3">
                        <div className="w-24 h-1.5 bg-slate-200 rounded overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${prog.percent}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{prog.percent}% · {prog.completedUnits}/{prog.units} unidades</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${meta.badge}`}>
                          <span className="material-symbols-outlined text-[12px]">{meta.icon}</span>
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setViewingId(p.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title="Ver plano">
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                          </button>
                          {canManage && p.status === 'rascunho' && (
                            <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer" title="Editar">
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                          )}
                          {canApprove && p.status === 'rascunho' && (
                            <button onClick={() => approve(p)} className="px-2.5 h-7 rounded-lg bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-[11px] cursor-pointer">
                              Aprovar
                            </button>
                          )}
                          {canApprove && p.status === 'aprovado' && (
                            <button onClick={() => reopen(p)} className="px-2.5 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] cursor-pointer">
                              Reabrir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination total={filtered.length} page={pgFiltered} onPageChange={setPgFiltered} />
        </div>
      </div>

      {/* ---------------- Modal: formulário ---------------- */}
      {formOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form onSubmit={submitForm} className="bg-white max-w-4xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={editing ? `Editar Plano ${editing.code}` : 'Novo Plano Curricular'} subtitle="Plano Curricular & Conteúdos" icon="auto_stories" onClose={() => setFormOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {formErrors.length > 0 && (
                <Notice tone="error">
                  {formErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              )}
              {capWarnings.length > 0 && (
                <Notice tone="warn">
                  {capWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </Notice>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Ano Letivo *</label>
                  <select value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)} className={inputCls}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Classe *</label>
                  <select value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inputCls}>
                    <option value="">Selecione...</option>
                    {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tempos Letivos / Semana *</label>
                  <input type="number" min={1} max={20} value={form.weeklyHours} onChange={(e) => set('weeklyHours', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Disciplina *</label>
                <SearchableSelect
                  options={subjectOptions}
                  value={form.subjectName}
                  onChange={(v) => set('subjectName', v)}
                  allowCustom
                  placeholder="Selecione ou escreva a disciplina..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Objetivos Gerais</label>
                  <textarea value={form.generalObjectives} onChange={(e) => set('generalObjectives', e.target.value)} rows={2} className={areaCls} />
                </div>
                <div>
                  <label className={labelCls}>Metodologia</label>
                  <textarea value={form.methodology} onChange={(e) => set('methodology', e.target.value)} rows={2} className={areaCls} />
                </div>
                <div>
                  <label className={labelCls}>Critérios de Avaliação</label>
                  <textarea value={form.evaluationCriteria} onChange={(e) => set('evaluationCriteria', e.target.value)} rows={2} className={areaCls} />
                </div>
                <div>
                  <label className={labelCls}>Bibliografia</label>
                  <textarea value={form.bibliography} onChange={(e) => set('bibliography', e.target.value)} rows={2} className={areaCls} />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">Unidades por Trimestre</span>
                  <button type="button" onClick={addUnit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-[11px] cursor-pointer">
                    <span className="material-symbols-outlined text-[14px]">add</span> Nova Unidade
                  </button>
                </div>
                <div className="flex gap-1 mb-3">
                  {TRIMESTERS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setActiveTrimester(t)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                        activeTrimester === t ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {TRIMESTER_LABELS[t]} ({form.units.filter((u) => u.trimester === t).length})
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {form.units.filter((u) => u.trimester === activeTrimester).length === 0 && (
                    <div className="text-center py-6 text-slate-400 border border-dashed border-slate-300 rounded-xl">Sem unidades neste trimestre.</div>
                  )}
                  {form.units
                    .filter((u) => u.trimester === activeTrimester)
                    .map((u) => (
                      <div key={u.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={u.title}
                            onChange={(e) => updateUnit(u.id, { title: e.target.value })}
                            placeholder="Título da unidade *"
                            className={`${inputCls} flex-1`}
                          />
                          <input
                            type="number"
                            min={1}
                            value={u.plannedLessons || ''}
                            onChange={(e) => updateUnit(u.id, { plannedLessons: Number(e.target.value) || 0 })}
                            placeholder="Tempos"
                            className={`${inputCls} w-24`}
                            title="Tempos letivos previstos"
                          />
                          <button type="button" onClick={() => removeUnit(u.id)} className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                        <textarea
                          value={u.contents || ''}
                          onChange={(e) => updateUnit(u.id, { contents: e.target.value })}
                          placeholder="Conteúdos programáticos..."
                          rows={2}
                          className={areaCls}
                        />
                      </div>
                    ))}
                </div>
              </div>

              {capRows.some((r) => r.weeks > 0) && (
                <div className="grid grid-cols-3 gap-2">
                  {capRows.map((r) => (
                    <div key={r.trimester} className={`p-2 rounded-lg border text-center ${r.over ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="text-[10px] font-bold uppercase text-slate-500">{TRIMESTER_LABELS[r.trimester]}</div>
                      <div className="text-sm font-mono font-bold">{r.planned} / {r.capacity}</div>
                      <div className="text-[10px] text-slate-400">{r.weeks} semanas</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: ver plano ---------------- */}
      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setViewingId(null); }}>
          <div className="bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={`${viewing.subjectName} — ${viewing.grade}`} subtitle={`${viewing.code} · ${viewing.academicYear}`} icon="auto_stories" onClose={() => setViewingId(null)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${CURRICULUM_STATUS_META[viewing.status].badge}`}>
                {CURRICULUM_STATUS_META[viewing.status].label}
              </div>
              {viewingDelays.length > 0 && (
                <Notice tone="error">
                  <strong>{viewingDelays.length} unidade(s) atrasada(s)</strong> — trimestre já terminado sem conclusão:{' '}
                  {viewingDelays.map((d) => d.unit.title).join('; ')}.
                </Notice>
              )}
              {TRIMESTERS.map((t) => {
                const units = (viewing.units || []).filter((u) => u.trimester === t);
                if (units.length === 0) return null;
                return (
                  <div key={t}>
                    <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wide mb-1.5">{TRIMESTER_LABELS[t]}</div>
                    <div className="space-y-1.5">
                      {units.map((u) => {
                        const st = unitStatus(u);
                        return (
                          <div key={u.id} className="border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">{u.title}</div>
                              <div className="text-[10px] text-slate-500">{u.deliveredLessons}/{u.plannedLessons} tempos</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${UNIT_STATUS_META[st].badge}`}>{UNIT_STATUS_META[st].label}</span>
                              {canManage && viewing.status === 'aprovado' && (
                                <button onClick={() => openProgress(u)} className="p-1 text-slate-400 hover:text-[#0b1f3a] cursor-pointer" title="Registar progresso">
                                  <span className="material-symbols-outlined text-[16px]">edit_note</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    onClick={() => {
                      setCloneTarget(viewing);
                      setCloneYear(yearOptions.includes(nextAcademicYearLabel(viewing.academicYear)) ? nextAcademicYearLabel(viewing.academicYear) : '');
                      setCloneGrade(viewing.grade);
                    }}
                    className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
                  >
                    Copiar para...
                  </button>
                )}
                {canApprove && viewing.status !== 'arquivado' && (
                  <button onClick={() => archive(viewing)} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer">Arquivar</button>
                )}
                {canManage && viewing.status === 'rascunho' && (
                  <button onClick={() => remove(viewing)} className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-800 font-bold text-xs cursor-pointer">Eliminar</button>
                )}
              </div>
              <button onClick={() => setViewingId(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Modal: registar progresso ---------------- */}
      {progressUnit && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setProgressUnit(null); }}>
          <div className="bg-white max-w-md w-full shadow-2xl border border-slate-400 flex flex-col">
            <FormModalHeader title="Registar Progresso" subtitle={progressUnit.title} icon="edit_note" onClose={() => setProgressUnit(null)} />
            <div className="p-6 space-y-3 text-xs">
              {progressError && <Notice tone="error">{progressError}</Notice>}
              <div>
                <label className={labelCls}>Tempos Leccionados (previstos: {progressUnit.plannedLessons})</label>
                <input type="number" min={0} max={progressUnit.plannedLessons} value={progressValue} onChange={(e) => setProgressValue(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notas</label>
                <textarea value={progressNotes} onChange={(e) => setProgressNotes(e.target.value)} rows={2} className={areaCls} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button onClick={() => setProgressUnit(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button onClick={submitProgress} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Modal: copiar plano ---------------- */}
      {cloneTarget && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setCloneTarget(null); }}>
          <div className="bg-white max-w-md w-full shadow-2xl border border-slate-400 flex flex-col">
            <FormModalHeader title="Copiar Plano" subtitle={cloneTarget.code} icon="content_copy" onClose={() => setCloneTarget(null)} />
            <div className="p-6 space-y-3 text-xs">
              <div>
                <label className={labelCls}>Ano Letivo de destino</label>
                <select value={cloneYear} onChange={(e) => setCloneYear(e.target.value)} className={inputCls}>
                  <option value="">Seleccionar ano letivo…</option>
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Classe de destino</label>
                <select value={cloneGrade} onChange={(e) => setCloneGrade(e.target.value)} className={inputCls}>
                  {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <p className="text-slate-500">A estrutura e os conteúdos são copiados; o progresso leccionado fica a zero.</p>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button onClick={() => setCloneTarget(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button onClick={submitClone} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Copiar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
