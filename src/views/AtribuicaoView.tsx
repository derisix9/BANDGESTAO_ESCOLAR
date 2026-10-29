import React, { useMemo, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppAlert, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { getAvailableGrades, getCycleForGrade, isUpperLevelGrade, normalizeGradeKey } from '../utils/educationSubsystems';
import { institutionAcademicYears } from '../utils/academicYear';
import { coursesForGradeOf, planBulkAssignments, summarizeBulkPlan } from '../utils/bulkAssignment';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface AtribuicaoViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

const normalizeText = (text?: string): string =>
  (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const AtribuicaoView: React.FC<AtribuicaoViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('professores.assign');

  const yearOptions = useMemo(
    () => institutionAcademicYears(db.settings, (db.subjectAssignments || []).map((a) => a.academicYear)),
    [db.settings, db.subjectAssignments]
  );
  const currentYear = db.settings?.currentAcademicYear || yearOptions[0];

  const gradeOptions = useMemo(() => getAvailableGrades(db.settings?.selectedSubsystems), [db.settings?.selectedSubsystems]);

  const [year, setYear] = useState(currentYear);
  const [grade, setGrade] = useState(gradeOptions[0] || '');
  const upperLevel = isUpperLevelGrade(grade);

  const coursesForGrade = useMemo(() => {
    if (!upperLevel) return [];
    return (db.courses || []).filter(
      (c) => c.status === 'ativo' && (!c.grades || c.grades.length === 0 || c.grades.some((g) => normalizeGradeKey(g) === normalizeGradeKey(grade)))
    );
  }, [db.courses, upperLevel, grade]);

  const [courseName, setCourseName] = useState<string>('');
  const effectiveCourseName = upperLevel ? courseName : '';

  // Mantém o curso selecionado coerente quando a classe muda.
  React.useEffect(() => {
    if (!upperLevel) {
      setCourseName('');
    } else if (coursesForGrade.length > 0 && !coursesForGrade.some((c) => c.name === courseName)) {
      setCourseName(coursesForGrade[0].name);
    } else if (coursesForGrade.length === 0) {
      setCourseName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, upperLevel, coursesForGrade]);

  const cycleForGrade = getCycleForGrade(grade);

  // Disciplinas elegíveis: do ciclo desta classe; quando há curso, soma-se
  // Tronco Comum + as disciplinas específicas daquele curso/área.
  const subjectOptionsList = useMemo(() => {
    const all = db.subjects || [];
    return all.filter((s) => {
      // A disciplina não está ligada a um ciclo: serve todos os níveis de ensino.
      if (!upperLevel) return true;
      const area = normalizeText(s.area);
      return (!area || area === 'tronco comum' || area === normalizeText(effectiveCourseName));
    });
  }, [db.subjects, cycleForGrade, upperLevel, effectiveCourseName]);

  const subjectSelectOptions = useMemo(
    () => subjectOptionsList.map((s) => ({ value: s.id, label: s.name, sublabel: s.area })),
    [subjectOptionsList]
  );

  const teacherSelectOptions = useMemo(
    () => (db.teachers || []).map((t) => ({ value: t.id, label: t.name, sublabel: t.department })),
    [db.teachers]
  );

  const assignments = useMemo(
    () =>
      (db.subjectAssignments || []).filter((a) => {
        if (a.academicYear !== year) return false;
        if (normalizeGradeKey(a.grade) !== normalizeGradeKey(grade)) return false;
        const courseKey = normalizeText(effectiveCourseName);
        const assignmentCourseKey = normalizeText(a.courseName);
        if (courseKey || assignmentCourseKey) return courseKey === assignmentCourseKey;
        return true;
      }),
    [db.subjectAssignments, year, grade, effectiveCourseName]
  );
  const { page: pgAssignments, setPage: setPgAssignments, pageItems: visibleAssignments } = usePagedList(assignments, [assignments.length]);

  // Turmas desta Classe (+ Curso, quando aplicável) — para permitir restringir a que
  // turmas concretas esta atribuição se aplica, em vez de assumir sempre "todas".
  const turmasForGrade = useMemo(() => {
    if (!grade) return [];
    return (db.classes || []).filter((c) => {
      if (normalizeGradeKey(c.grade) !== normalizeGradeKey(grade)) return false;
      if (upperLevel && effectiveCourseName) return normalizeText(c.area) === normalizeText(effectiveCourseName);
      return true;
    });
  }, [db.classes, grade, upperLevel, effectiveCourseName]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  // Vazio = "Todas as turmas" (comportamento por omissão).
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [formError, setFormError] = useState('');

  // ---- Atribuição em massa: 1 professor × várias disciplinas × várias classes (× cursos) ----
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSubjectIds, setBulkSubjectIds] = useState<string[]>([]);
  const [bulkGrades, setBulkGrades] = useState<string[]>([]);
  const [bulkCourseNames, setBulkCourseNames] = useState<string[]>([]);
  const [bulkReplace, setBulkReplace] = useState(false);
  const [bulkSubjectQuery, setBulkSubjectQuery] = useState('');

  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const bulkAnyUpper = bulkGrades.some((g) => isUpperLevelGrade(g));
  const bulkCourseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    bulkGrades
      .filter((g) => isUpperLevelGrade(g))
      .forEach((g) => coursesForGradeOf(db.courses, g).forEach((c) => seen.set(c.name, c.name)));
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [bulkGrades, db.courses]);

  const bulkSubjectsVisible = useMemo(() => {
    const q = normalizeText(bulkSubjectQuery);
    return (db.subjects || [])
      .filter((s) => !q || normalizeText(s.name).includes(q) || normalizeText(s.area).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [db.subjects, bulkSubjectQuery]);

  const bulkPlan = useMemo(
    () =>
      planBulkAssignments({
        year,
        teacherId,
        subjects: (db.subjects || []).filter((s) => bulkSubjectIds.includes(s.id)),
        grades: bulkGrades,
        courseNames: bulkCourseNames,
        courses: db.courses || [],
        existing: db.subjectAssignments || [],
        replaceExisting: bulkReplace
      }),
    [year, teacherId, db.subjects, db.courses, db.subjectAssignments, bulkSubjectIds, bulkGrades, bulkCourseNames, bulkReplace]
  );
  const bulkCounts = useMemo(() => summarizeBulkPlan(bulkPlan.items), [bulkPlan]);

  const allTurmasSelected = selectedClassIds.length === 0;
  const toggleAllTurmas = () => setSelectedClassIds([]);
  const toggleTurma = (classId: string) => {
    setSelectedClassIds((prev) => {
      if (prev.includes(classId)) return prev.filter((id) => id !== classId);
      return [...prev, classId];
    });
  };

  const openAdd = () => {
    setBulkMode(false);
    setBulkSubjectIds([]);
    setBulkGrades(grade ? [grade] : []);
    setBulkCourseNames(effectiveCourseName ? [effectiveCourseName] : []);
    setBulkReplace(false);
    setBulkSubjectQuery('');
    setEditingId(null);
    setSubjectId('');
    setTeacherId('');
    setSelectedClassIds([]);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (assignmentId: string) => {
    const a = assignments.find((x) => x.id === assignmentId);
    if (!a) return;
    setBulkMode(false);
    setEditingId(a.id);
    setSubjectId(a.subjectId);
    setTeacherId(a.teacherId);
    setSelectedClassIds(a.classIds && a.classIds.length > 0 ? a.classIds.map(String) : []);
    setFormError('');
    setFormOpen(true);
  };

  const run = async (action: () => void, loadingMessage: string, successMessage?: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: 'professores.assign', userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const subject = subjectOptionsList.find((s) => s.id === subjectId);
    const teacher = (db.teachers || []).find((t) => t.id === teacherId);
    if (bulkMode && !editingId) {
      await submitBulk(teacher);
      return;
    }
    if (!grade) {
      setFormError('Selecione a Classe.');
      return;
    }
    if (upperLevel && !effectiveCourseName) {
      setFormError('Selecione o Curso.');
      return;
    }
    if (!subject) {
      setFormError('Selecione a disciplina.');
      return;
    }
    if (!teacher) {
      setFormError('Selecione o professor responsável.');
      return;
    }
    if (!allTurmasSelected && selectedClassIds.length === 0) {
      setFormError('Selecione pelo menos uma turma, ou "Todas as turmas".');
      return;
    }

    let err = '';
    const result = await run(
      () => {
        if (editingId) {
          const r = dbService.updateSubjectAssignment(editingId, {
            academicYear: year,
            grade,
            courseId: undefined,
            courseName: effectiveCourseName || undefined,
            subjectId: subject.id,
            subjectName: subject.name,
            teacherId: teacher.id,
            teacherName: teacher.name,
            classIds: allTurmasSelected ? undefined : selectedClassIds
          });
          if (!r.success) {
            err = r.error || '';
            throw new Error(err);
          }
        } else {
          const r = dbService.addSubjectAssignment({
            academicYear: year,
            grade,
            courseName: effectiveCourseName || undefined,
            subjectId: subject.id,
            subjectName: subject.name,
            teacherId: teacher.id,
            teacherName: teacher.name,
            classIds: allTurmasSelected ? undefined : selectedClassIds
          });
          if (!r.success) {
            err = r.error || '';
            throw new Error(err);
          }
        }
      },
      editingId ? 'A guardar atribuição...' : 'A atribuir disciplina...',
      editingId ? 'Atribuição atualizada!' : 'Disciplina atribuída!'
    );
    if (result.ok) setFormOpen(false);
    else setFormError(err || result.error || 'Não foi possível guardar.');
  };

  const submitBulk = async (teacher?: { id: string; name: string }) => {
    if (!teacher) return setFormError('Selecione o professor responsável.');
    if (bulkSubjectIds.length === 0) return setFormError('Selecione pelo menos uma disciplina.');
    if (bulkGrades.length === 0) return setFormError('Selecione pelo menos uma classe.');
    if (bulkAnyUpper && bulkPlan.gradesWithoutCourse.length > 0) {
      return setFormError(`Selecione o(s) curso(s) para: ${bulkPlan.gradesWithoutCourse.join(', ')}.`);
    }
    const actionable = bulkPlan.items.filter((i) => i.action === 'create' || i.action === 'replace');
    if (actionable.length === 0) {
      return setFormError('Nada para atribuir: as combinações escolhidas já existem, não são elegíveis ou pertencem a outro professor (marque "Substituir professor").');
    }

    const ok = await showAppConfirm(
      `Atribuir ${bulkCounts.create} disciplina(s) nova(s)${bulkCounts.replace ? ` e substituir o professor em ${bulkCounts.replace}` : ''} a ${teacher.name}?`,
      { title: 'Atribuição em massa', confirmLabel: 'Atribuir' }
    );
    if (!ok) return;

    let created = 0;
    let replaced = 0;
    const failures: string[] = [];
    const result = await run(
      () => {
        for (const item of actionable) {
          if (item.action === 'create') {
            const r = dbService.addSubjectAssignment({
              academicYear: year,
              grade: item.grade,
              courseName: item.courseName,
              subjectId: item.subjectId,
              subjectName: item.subjectName,
              teacherId: teacher.id,
              teacherName: teacher.name
            });
            if (r.success) created += 1;
            else failures.push(`${item.subjectName} (${item.grade}${item.courseName ? ' · ' + item.courseName : ''}): ${r.error || 'erro'}`);
          } else if (item.existingId) {
            const r = dbService.updateSubjectAssignment(item.existingId, { teacherId: teacher.id, teacherName: teacher.name });
            if (r.success) replaced += 1;
            else failures.push(`${item.subjectName} (${item.grade}): ${r.error || 'erro'}`);
          }
        }
      },
      'A atribuir disciplinas em massa...',
      'Atribuição em massa concluída!'
    );
    if (!result.ok) return setFormError(result.error || 'Não foi possível concluir a atribuição em massa.');
    setFormOpen(false);
    const skipped = bulkCounts.unchanged + bulkCounts.exists + bulkCounts.ineligible;
    showAppAlert(
      `${created} atribuição(ões) criada(s)${replaced ? `, ${replaced} com professor substituído` : ''}.` +
        (skipped ? ` ${skipped} ignorada(s) (já atribuídas ou fora do curso).` : '') +
        (failures.length ? `\n\nFalharam:\n${failures.join('\n')}` : ''),
      { title: 'Atribuição em massa', variant: failures.length ? 'warning' : 'info' }
    );
  };

  const remove = async (id: string, subjectName: string) => {
    const ok = await showAppConfirm(`Remover a atribuição da disciplina "${subjectName}" a esta ${upperLevel ? 'Classe/Curso' : 'Classe'}?`, {
      title: 'Remover Atribuição',
      variant: 'error',
      confirmLabel: 'Remover'
    });
    if (!ok) return;
    await run(() => {
      const r = dbService.deleteSubjectAssignment(id);
      if (!r.success) throw new Error(r.error);
    }, 'A remover...', 'Atribuição removida.');
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SECRETARIA ACADÉMICA</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">ATRIBUIÇÃO</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">ATRIBUIÇÃO DE DISCIPLINA</h1>
        </div>
        {canManage && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>CADASTRAR</span>
          </button>
        )}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>Ano Letivo</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Classe *</label>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
            <option value="">Selecione...</option>
            {gradeOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        {upperLevel && (
          <div>
            <label className={labelCls}>Curso *</label>
            <select value={courseName} onChange={(e) => setCourseName(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
              {coursesForGrade.length === 0 && <option value="">Sem cursos cadastrados para esta classe</option>}
              {coursesForGrade.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
       
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Disciplina</th>
                <th className="py-3.5 px-3">Professor Responsável</th>
                <th className="py-3.5 px-3">Turmas</th>
                {canManage && <th className="py-3.5 px-4 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!grade ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="py-12 text-center text-slate-400">Selecione uma Classe para ver as disciplinas atribuídas.</td>
                </tr>
              ) : upperLevel && !effectiveCourseName ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="py-12 text-center text-slate-400">Selecione um Curso para ver/atribuir as disciplinas.</td>
                </tr>
              ) : assignments.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="py-12 text-center text-slate-400">
                    Ainda não há disciplinas atribuídas a esta {upperLevel ? 'Classe/Curso' : 'Classe'}.
                  </td>
                </tr>
              ) : (
                visibleAssignments.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-[#0b1f3a]">{a.subjectName}</td>
                    <td className="py-3 px-3 text-slate-700">{a.teacherName}</td>
                    <td className="py-3 px-3 text-slate-600">
                      {!a.classIds || a.classIds.length === 0 ? (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] uppercase">
                          Todas
                        </span>
                      ) : (
                        <span className="text-[11px]">
                          {a.classIds
                            .map((id) => (db.classes || []).find((c) => String(c.id) === String(id))?.name || id)
                            .join(', ')}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(a.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer" title="Editar">
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button onClick={() => remove(a.id, a.subjectName)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-slate-100 cursor-pointer" title="Remover">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination total={assignments.length} page={pgAssignments} onPageChange={setPgAssignments} />
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form onSubmit={submitForm} className={`bg-white ${bulkMode ? 'max-w-3xl' : 'max-w-lg'} w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]`}>
            <FormModalHeader
              title={editingId ? 'Editar Atribuição' : bulkMode ? 'Atribuição em Massa' : 'Atribuir Disciplina'}
              subtitle={bulkMode ? `Um professor · várias disciplinas · várias classes · ${year}` : `${grade}${effectiveCourseName ? ` · ${effectiveCourseName}` : ''} · ${year}`}
              icon="assignment_ind"
              onClose={() => setFormOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {!editingId && (
                <div className="grid grid-cols-2 border border-slate-300 text-[11px] font-bold uppercase">
                  <button type="button" onClick={() => setBulkMode(false)} className={`py-2 cursor-pointer ${!bulkMode ? 'bg-[#0b1f3a] text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                    Uma disciplina
                  </button>
                  <button type="button" onClick={() => setBulkMode(true)} className={`py-2 cursor-pointer ${bulkMode ? 'bg-[#0b1f3a] text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                    Em massa
                  </button>
                </div>
              )}
              {formError && <Notice tone="error">{formError}</Notice>}

              {bulkMode && !editingId ? (
                <>
                  <div>
                    <label className={labelCls}>Professor Responsável *</label>
                    <SearchableSelect options={teacherSelectOptions} value={teacherId} onChange={(v) => setTeacherId(v)} placeholder="Selecione o professor..." />
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className={labelCls}>Classes * ({bulkGrades.length})</label>
                        <button type="button" className="text-[10px] font-bold text-[#0b1f3a] hover:underline cursor-pointer mb-1"
                          onClick={() => setBulkGrades(bulkGrades.length === gradeOptions.length ? [] : [...gradeOptions])}>
                          {bulkGrades.length === gradeOptions.length ? 'Limpar' : 'Todas'}
                        </button>
                      </div>
                      <div className="border border-slate-300 divide-y divide-slate-200 max-h-56 overflow-y-auto">
                        {gradeOptions.map((g) => (
                          <label key={g} className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-slate-50">
                            <input type="checkbox" checked={bulkGrades.includes(g)} onChange={() => setBulkGrades((prev) => toggleIn(prev, g))} />
                            <span className="text-slate-700">{g}</span>
                          </label>
                        ))}
                      </div>
                      
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label className={labelCls}>Disciplinas * ({bulkSubjectIds.length})</label>
                        <button type="button" className="text-[10px] font-bold text-[#0b1f3a] hover:underline cursor-pointer mb-1"
                          onClick={() => {
                            const ids = bulkSubjectsVisible.map((x) => x.id);
                            const allOn = ids.length > 0 && ids.every((id) => bulkSubjectIds.includes(id));
                            setBulkSubjectIds((prev) => (allOn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
                          }}>
                          Todas / Limpar visíveis
                        </button>
                      </div>
                      <input value={bulkSubjectQuery} onChange={(e) => setBulkSubjectQuery(e.target.value)} placeholder="Pesquisar disciplina..." className={`${inputCls} mb-1`} />
                      <div className="border border-slate-300 divide-y divide-slate-200 max-h-48 overflow-y-auto">
                        {bulkSubjectsVisible.length === 0 ? (
                          <div className="px-3 py-2 text-slate-400">Nenhuma disciplina encontrada.</div>
                        ) : (
                          bulkSubjectsVisible.map((sj) => (
                            <label key={sj.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-slate-50">
                              <input type="checkbox" checked={bulkSubjectIds.includes(sj.id)} onChange={() => setBulkSubjectIds((prev) => toggleIn(prev, sj.id))} />
                              <span className="text-slate-700">{sj.name}</span>
                              {sj.area && <span className="ml-auto text-[10px] text-slate-400">{sj.area}</span>}
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {bulkAnyUpper && (
                    <div>
                      <label className={labelCls}>Cursos (10.ª classe em diante) *</label>
                      {bulkCourseOptions.length === 0 ? (
                        <div className="px-3 py-2 border border-slate-300 text-slate-400">Sem cursos activos para as classes escolhidas.</div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {bulkCourseOptions.map((c) => (
                            <label key={c} className={`flex items-center gap-2 px-3 py-1.5 border cursor-pointer select-none ${bulkCourseNames.includes(c) ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                              <input type="checkbox" className="hidden" checked={bulkCourseNames.includes(c)} onChange={() => setBulkCourseNames((prev) => toggleIn(prev, c))} />
                              <span className="font-semibold">{c}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      <p className="mt-1 text-[11px] text-slate-500">Disciplinas específicas de outro curso são ignoradas automaticamente (só entram Tronco Comum e as do próprio curso).</p>
                    </div>
                  )}

                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input type="checkbox" className="mt-0.5" checked={bulkReplace} onChange={(e) => setBulkReplace(e.target.checked)} />
                    <span className="text-slate-700">
                      <strong>Substituir o professor</strong> onde a disciplina já esteja atribuída a outro docente (por omissão, essas ficam como estão).
                    </span>
                  </label>

                  <div className="p-3 bg-slate-50 border border-slate-300 text-slate-700 flex flex-wrap gap-x-5 gap-y-1">
                    <span><strong className="text-emerald-700">{bulkCounts.create}</strong> a criar</span>
                    <span><strong className="text-amber-700">{bulkCounts.replace}</strong> a substituir professor</span>
                    <span><strong className="text-slate-500">{bulkCounts.unchanged + bulkCounts.exists}</strong> já atribuídas (ignoradas)</span>
                    <span><strong className="text-slate-500">{bulkCounts.ineligible}</strong> fora do curso (ignoradas)</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className={labelCls}>Disciplina *</label>
                    <SearchableSelect
                      options={subjectSelectOptions}
                      value={subjectId}
                      onChange={(v) => setSubjectId(v)}
                      placeholder="Selecione a disciplina..."
                      emptyMessage="Nenhuma disciplina do ciclo/curso desta classe encontrada."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Professor Responsável *</label>
                    <SearchableSelect options={teacherSelectOptions} value={teacherId} onChange={(v) => setTeacherId(v)} placeholder="Selecione o professor..." />
                  </div>
                  <div>
                    <label className={labelCls}>Turmas onde vai lecionar *</label>
                    <div className="border border-slate-300 divide-y divide-slate-200 max-h-48 overflow-y-auto">
                      <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 cursor-pointer select-none">
                        <input type="checkbox" checked={allTurmasSelected} onChange={toggleAllTurmas} />
                        <span className="font-bold text-slate-700">Todas as turmas ({turmasForGrade.length})</span>
                      </label>
                      {turmasForGrade.length === 0 ? (
                        <div className="px-3 py-2 text-slate-400">Nenhuma turma cadastrada para esta Classe{effectiveCourseName ? '/Curso' : ''}.</div>
                      ) : (
                        turmasForGrade.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-slate-50">
                            <input type="checkbox" checked={!allTurmasSelected && selectedClassIds.includes(String(c.id))} onChange={() => toggleTurma(String(c.id))} />
                            <span className="text-slate-700">{c.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                 
                </>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
                {bulkMode && !editingId ? 'Atribuir em massa' : 'Atribuir'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
