import React, { useEffect, useMemo, useState } from 'react';
import {
  AllergenKey,
  CanteenMenu,
  CanteenServiceEntry,
  CanteenServiceRecord,
  CanteenSubscription,
  CanteenSubscriptionStatus,
  MealType,
  SchoolDatabase,
  UserRole,
  Weekday
} from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppAlert, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { institutionAcademicYears } from '../utils/academicYear';
import { nextAcademicYearLabel, toIso } from '../utils/academicCalendar';
import { WEEKDAY_LABELS, WEEKDAY_SHORT } from '../utils/extracurriculars';
import {
  ALLERGEN_KEYS,
  ALLERGEN_LABELS,
  MEAL_META,
  MEAL_TYPES,
  SCHOOL_WEEKDAYS,
  SUBSCRIPTION_STATUS_META,
  addDaysIso,
  allergenAlerts,
  allergenLabelList,
  buildMonthlyReport,
  buildServiceEntries,
  countEntries,
  expectedDiners,
  findMenu,
  findServiceRecord,
  forecastForDate,
  isSchoolDay,
  mondayOf,
  monthOf,
  monthlyReportToCsv,
  planWeekCopy,
  subscriptionsToCsv,
  weekDates,
  weekdayOf
} from '../utils/canteen';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface RefeitorioViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const areaCls = 'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

// Referências estáveis: um `|| []` novo a cada render dispararia os efeitos em ciclo.
const EMPTY_MENUS: CanteenMenu[] = [];
const EMPTY_SUBS: CanteenSubscription[] = [];
const EMPTY_RECORDS: CanteenServiceRecord[] = [];

type Tab = 'servico' | 'ementas' | 'inscricoes' | 'relatorio';

const formatDate = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const formatDayShort = (iso: string) => {
  const w = weekdayOf(iso);
  const label = w >= 1 && w <= 6 ? WEEKDAY_SHORT[w as Weekday] : '';
  const [, m, d] = iso.split('-');
  return `${label} ${d}/${m}`;
};

const formatMonth = (month: string) => {
  const [y, m] = month.split('-');
  const names = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const idx = Number(m) - 1;
  return names[idx] ? `${names[idx]} de ${y}` : month;
};

const downloadCsv = (content: string, filename: string) => {
  // BOM: sem ele o Excel abre os acentos (ç, ã, é...) desfeitos.
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** Último dia útil (seg–sex) até à data dada — o ponto de partida do serviço diário. */
const lastSchoolDay = (iso: string): string => {
  let d = iso;
  for (let i = 0; i < 7 && !isSchoolDay(d); i++) d = addDaysIso(d, -1);
  return d;
};

// ---------------------------------------------------------------------------
// Pequenos componentes
// ---------------------------------------------------------------------------

function ChipGroup<T extends string | number>({
  options,
  selected,
  onToggle,
  tone = 'navy'
}: {
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
  tone?: 'navy' | 'red';
}) {
  const on = tone === 'red' ? 'bg-red-700 text-white border-red-700' : 'bg-[#0b1f3a] text-white border-[#0b1f3a]';
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onToggle(o.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${
              active ? on : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const toggleIn = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

const AllergenTags: React.FC<{ keys: AllergenKey[] | undefined; tone?: 'red' | 'amber' }> = ({ keys, tone = 'amber' }) => (
  <>
    {(keys || []).map((k) => (
      <span
        key={k}
        className={`px-1.5 py-px rounded text-[10px] font-bold ${tone === 'red' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
      >
        {ALLERGEN_LABELS[k] || k}
      </span>
    ))}
  </>
);

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------

type MenuForm = {
  id?: string;
  date: string;
  mealType: MealType;
  mainDish: string;
  soup: string;
  sideDish: string;
  dessert: string;
  drink: string;
  allergens: AllergenKey[];
  notes: string;
};

const emptyMenuForm = (date: string, mealType: MealType): MenuForm => ({
  date,
  mealType,
  mainDish: '',
  soup: '',
  sideDish: '',
  dessert: '',
  drink: '',
  allergens: [],
  notes: ''
});

const menuFormFrom = (m: CanteenMenu): MenuForm => ({
  id: m.id,
  date: m.date,
  mealType: m.mealType,
  mainDish: m.mainDish,
  soup: m.soup || '',
  sideDish: m.sideDish || '',
  dessert: m.dessert || '',
  drink: m.drink || '',
  allergens: [...(m.allergens || [])],
  notes: m.notes || ''
});

type SubForm = {
  id?: string;
  studentId: string;
  academicYear: string;
  meals: MealType[];
  weekdays: Weekday[];
  startDate: string;
  endDate: string;
  allergies: AllergenKey[];
  dietaryNotes: string;
};

const emptySubForm = (academicYear: string, startDate: string): SubForm => ({
  studentId: '',
  academicYear,
  meals: ['almoco'],
  weekdays: [...SCHOOL_WEEKDAYS],
  startDate,
  endDate: '',
  allergies: [],
  dietaryNotes: ''
});

const subFormFrom = (s: CanteenSubscription): SubForm => ({
  id: s.id,
  studentId: s.studentId,
  academicYear: s.academicYear,
  meals: [...(s.meals || [])],
  weekdays: [...(s.weekdays || [])],
  startDate: s.startDate,
  endDate: s.endDate || '',
  allergies: [...(s.allergies || [])],
  dietaryNotes: s.dietaryNotes || ''
});

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export const RefeitorioView: React.FC<RefeitorioViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('refeitorio.manage');
  // As alergias são dado de saúde: só quem gere o refeitório as vê.
  const canSeeHealth = canManage;

  const todayIso = toIso(new Date());
  const yearOptions = useMemo(
    () => institutionAcademicYears(db.settings, (db.canteenSubscriptions || []).map((s) => s.academicYear)),
    [db.settings, db.canteenSubscriptions]
  );
  const currentYear = db.settings?.currentAcademicYear || yearOptions[0];

  const menus = db.canteenMenus || EMPTY_MENUS;
  const subs = db.canteenSubscriptions || EMPTY_SUBS;
  const records = db.canteenServices || EMPTY_RECORDS;

  const [tab, setTab] = useState<Tab>('servico');

  const run = async (action: () => void, rule: string, loadingMessage: string, successMessage?: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  // =========================================================================
  // SERVIÇO DIÁRIO
  // =========================================================================

  const [svcDate, setSvcDate] = useState(lastSchoolDay(todayIso));
  const [svcMeal, setSvcMeal] = useState<MealType>('almoco');
  const [entries, setEntries] = useState<CanteenServiceEntry[]>([]);
  const { page: pgEntries, setPage: setPgEntries, pageItems: visibleEntries } = usePagedList(entries, [entries.length]);
  const [dirty, setDirty] = useState(false);
  const [svcErrors, setSvcErrors] = useState<string[]>([]);
  const [extraStudentId, setExtraStudentId] = useState('');

  const svcMenu = findMenu(menus, svcDate, svcMeal);
  const svcRecord = findServiceRecord(records, svcDate, svcMeal);

  // Reconstrói as linhas ao mudar de data/refeição e quando as inscrições ou o registo mudam
  // (ex.: sincronização). Com marcações por guardar não mexe em nada: nunca se perde trabalho a meio.
  useEffect(() => {
    if (dirty) return;
    setEntries(buildServiceEntries(subs, svcDate, svcMeal, svcRecord));
    setSvcErrors([]);
    setExtraStudentId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svcDate, svcMeal, svcRecord, subs]);

  const svcSubsByStudent = useMemo(() => {
    const map = new Map<string, CanteenSubscription>();
    subs.forEach((s) => {
      if (s.status === 'ativa' && !map.has(s.studentId)) map.set(s.studentId, s);
    });
    return map;
  }, [subs]);

  const alerts = useMemo(() => (canSeeHealth ? allergenAlerts(svcMenu, subs) : []), [svcMenu, subs, canSeeHealth]);
  const alertByStudent = useMemo(() => {
    const map = new Map<string, AllergenKey[]>();
    alerts.forEach((a) => map.set(a.subscription.studentId, a.allergens));
    return map;
  }, [alerts]);

  const expectedCount = expectedDiners(subs, svcDate, svcMeal).length;
  const counts = countEntries(entries);
  const svcIsFuture = svcDate > todayIso;

  const extraOptions = useMemo(() => {
    const inList = new Set(entries.map((e) => e.studentId));
    return (db.students || [])
      .filter((s) => s.status === 'active' && !inList.has(s.id))
      .map((s) => ({ value: s.id, label: s.name, sublabel: `${s.procNumber}${s.className ? ' · ' + s.className : ''}` }));
  }, [db.students, entries]);

  const setEntryStatus = (studentId: string, status: CanteenServiceEntry['status']) => {
    setEntries((list) => list.map((e) => (e.studentId === studentId ? { ...e, status } : e)));
    setDirty(true);
  };
  const markAllServed = () => {
    setEntries((list) => list.map((e) => ({ ...e, status: 'servida' as const })));
    setDirty(true);
  };
  const addExtra = () => {
    const student = (db.students || []).find((s) => s.id === extraStudentId);
    if (!student) return;
    setEntries((list) => [...list, { studentId: student.id, studentName: student.name, status: 'servida', extra: true }]);
    setExtraStudentId('');
    setDirty(true);
  };
  const removeExtra = (studentId: string) => {
    setEntries((list) => list.filter((e) => e.studentId !== studentId));
    setDirty(true);
  };

  const saveService = async () => {
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = dbService.saveCanteenServiceRecord(svcDate, svcMeal, entries);
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'refeitorio.manage',
      'A registar serviço...',
      svcRecord ? 'Registo atualizado!' : 'Serviço registado!'
    );
    if (result.ok) {
      setDirty(false);
      setSvcErrors([]);
    } else setSvcErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const changeSvcDate = async (next: string) => {
    if (dirty) {
      const ok = await showAppConfirm('Há marcações por guardar. Mudar de data ou refeição descarta-as.', {
        title: 'Alterações por guardar',
        variant: 'warning',
        confirmLabel: 'Descartar'
      });
      if (!ok) return;
      setDirty(false);
    }
    setSvcDate(next);
  };
  const changeSvcMeal = async (next: MealType) => {
    if (next === svcMeal) return;
    if (dirty) {
      const ok = await showAppConfirm('Há marcações por guardar. Mudar de data ou refeição descarta-as.', {
        title: 'Alterações por guardar',
        variant: 'warning',
        confirmLabel: 'Descartar'
      });
      if (!ok) return;
      setDirty(false);
    }
    setSvcMeal(next);
  };

  const svcWeekday = weekdayOf(svcDate);
  const svcWeekdayLabel = svcWeekday >= 1 && svcWeekday <= 6 ? WEEKDAY_LABELS[svcWeekday as Weekday] : svcWeekday === 0 ? 'Domingo' : '';

  const forecastToday = useMemo(() => forecastForDate(subs, svcDate), [subs, svcDate]);

  // =========================================================================
  // EMENTAS
  // =========================================================================

  const [weekAnchor, setWeekAnchor] = useState(mondayOf(todayIso));
  const days = useMemo(() => weekDates(weekAnchor), [weekAnchor]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuForm, setMenuForm] = useState<MenuForm>(emptyMenuForm(todayIso, 'almoco'));
  const [menuErrors, setMenuErrors] = useState<string[]>([]);

  const openMenu = (date: string, meal: MealType) => {
    const existing = findMenu(menus, date, meal);
    setMenuForm(existing ? menuFormFrom(existing) : emptyMenuForm(date, meal));
    setMenuErrors([]);
    setMenuOpen(true);
  };
  const setMenuField = <K extends keyof MenuForm>(key: K, value: MenuForm[K]) => setMenuForm((f) => ({ ...f, [key]: value }));

  const submitMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = dbService.saveCanteenMenu({ ...menuForm } as any);
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'refeitorio.manage',
      'A guardar ementa...',
      menuForm.id ? 'Ementa atualizada!' : 'Ementa criada!'
    );
    if (result.ok) setMenuOpen(false);
    else setMenuErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const removeMenu = async () => {
    if (!menuForm.id) return;
    const ok = await showAppConfirm(`Eliminar a ementa de ${formatDate(menuForm.date)} (${MEAL_META[menuForm.mealType].label})?`, {
      title: 'Eliminar Ementa',
      variant: 'error',
      confirmLabel: 'Eliminar'
    });
    if (!ok) return;
    const result = await run(
      () => {
        const r = dbService.deleteCanteenMenu(menuForm.id!);
        if (!r.success) throw new Error(r.error);
      },
      'refeitorio.manage',
      'A eliminar ementa...',
      'Ementa eliminada.'
    );
    if (result.ok) setMenuOpen(false);
  };

  /** Copia as ementas de uma semana para outra, sem substituir nenhuma ementa já feita. */
  const copyWeek = async (fromMonday: string, toMonday: string) => {
    const plan = planWeekCopy(menus, fromMonday, toMonday);
    if (plan.length === 0) {
      showAppAlert('Não há ementas para copiar: a semana de origem está vazia ou a de destino já está toda preenchida.', {
        title: 'Copiar Semana',
        variant: 'info'
      });
      return;
    }
    const ok = await showAppConfirm(
      `Copiar ${plan.length} ementa(s) da semana de ${formatDate(fromMonday)} para a semana de ${formatDate(toMonday)}? As ementas já existentes não são substituídas.`,
      { title: 'Copiar Semana', variant: 'info', confirmLabel: 'Copiar' }
    );
    if (!ok) return;
    await run(
      () => {
        for (const item of plan) {
          const r = dbService.saveCanteenMenu(item as any);
          if (!r.success) throw new Error(r.errors?.length ? r.errors.join(' ') : r.error);
        }
      },
      'refeitorio.manage',
      'A copiar ementas...',
      `${plan.length} ementa(s) copiada(s)!`
    );
  };

  // =========================================================================
  // INSCRIÇÕES
  // =========================================================================

  const [subSearch, setSubSearch] = useState('');
  const [subYear, setSubYear] = useState(currentYear);
  const [subStatus, setSubStatus] = useState<'all' | CanteenSubscriptionStatus>('all');

  const [subOpen, setSubOpen] = useState(false);
  const [subForm, setSubForm] = useState<SubForm>(emptySubForm(currentYear, todayIso));
  const [subErrors, setSubErrors] = useState<string[]>([]);

  const filteredSubs = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return subs
      .filter((s) => subYear === 'all' || s.academicYear === subYear)
      .filter((s) => subStatus === 'all' || s.status === subStatus)
      .filter((s) => !q || s.studentName.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.studentProcNumber.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [subs, subSearch, subYear, subStatus]);
  const { page: pgFilteredSubs, setPage: setPgFilteredSubs, pageItems: visibleFilteredSubs } = usePagedList(filteredSubs, [filteredSubs.length]);

  const subCounts = useMemo(() => {
    const map: Record<string, number> = {};
    subs.filter((s) => subYear === 'all' || s.academicYear === subYear).forEach((s) => (map[s.status] = (map[s.status] || 0) + 1));
    return map;
  }, [subs, subYear]);

  const studentOptions = useMemo(() => {
    // Só alunos sem inscrição não cancelada nesse ano letivo (na edição, o próprio aluno).
    const taken = new Set(
      subs.filter((s) => s.status !== 'cancelada' && s.academicYear === subForm.academicYear && s.id !== subForm.id).map((s) => s.studentId)
    );
    return (db.students || [])
      .filter((s) => s.status === 'active' && !taken.has(s.id))
      .map((s) => ({ value: s.id, label: s.name, sublabel: `${s.procNumber}${s.className ? ' · ' + s.className : ''}` }));
  }, [db.students, subs, subForm.academicYear, subForm.id]);

  const openAddSub = () => {
    setSubForm(emptySubForm(subYear !== 'all' ? subYear : currentYear, todayIso));
    setSubErrors([]);
    setSubOpen(true);
  };
  const openEditSub = (s: CanteenSubscription) => {
    setSubForm(subFormFrom(s));
    setSubErrors([]);
    setSubOpen(true);
  };
  const setSubField = <K extends keyof SubForm>(key: K, value: SubForm[K]) => setSubForm((f) => ({ ...f, [key]: value }));

  const submitSub = async (e: React.FormEvent) => {
    e.preventDefault();
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = dbService.saveCanteenSubscription({ ...subForm } as any);
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'refeitorio.manage',
      subForm.id ? 'A guardar inscrição...' : 'A inscrever aluno...',
      subForm.id ? 'Inscrição atualizada!' : 'Aluno inscrito no refeitório!'
    );
    if (result.ok) setSubOpen(false);
    else setSubErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const changeSubStatus = async (s: CanteenSubscription, to: CanteenSubscriptionStatus) => {
    const verb = to === 'suspensa' ? 'Suspender' : to === 'cancelada' ? 'Cancelar' : 'Reativar';
    const ok = await showAppConfirm(
      to === 'cancelada'
        ? `Cancelar a inscrição ${s.code} de ${s.studentName}? Deixa de contar nas previsões e não pode ser reativada.`
        : `${verb} a inscrição ${s.code} de ${s.studentName}?`,
      { title: `${verb} Inscrição`, variant: to === 'cancelada' ? 'error' : 'warning', confirmLabel: verb }
    );
    if (!ok) return;
    await run(
      () => {
        const r = dbService.changeCanteenSubscriptionStatus(s.id, to);
        if (!r.success) throw new Error(r.error);
      },
      'refeitorio.manage',
      'A atualizar inscrição...',
      `Inscrição: ${SUBSCRIPTION_STATUS_META[to].label}.`
    );
  };

  const removeSub = async (s: CanteenSubscription) => {
    const ok = await showAppConfirm(`Eliminar a inscrição ${s.code} de ${s.studentName}? Esta ação não pode ser desfeita.`, {
      title: 'Eliminar Inscrição',
      variant: 'error',
      confirmLabel: 'Eliminar'
    });
    if (!ok) return;
    await run(
      () => {
        const r = dbService.deleteCanteenSubscription(s.id);
        if (!r.success) throw new Error(r.error);
      },
      'refeitorio.manage',
      'A eliminar inscrição...',
      'Inscrição eliminada.'
    );
  };

  const exportSubs = () => {
    const list = canSeeHealth ? filteredSubs : filteredSubs.map((s) => ({ ...s, allergies: [], dietaryNotes: undefined }));
    downloadCsv(subscriptionsToCsv(list), `refeitorio_inscricoes_${subYear === 'all' ? 'todos' : subYear.replace('/', '-')}.csv`);
  };

  // =========================================================================
  // RELATÓRIO MENSAL
  // =========================================================================

  const [month, setMonth] = useState(monthOf(todayIso));
  const report = useMemo(() => buildMonthlyReport(records, month), [records, month]);
  const { page: pgStudents, setPage: setPgStudents, pageItems: visibleStudents } = usePagedList(report.students, [report.students.length]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const TABS: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'servico', label: 'Serviço Diário', icon: 'restaurant' },
    { key: 'ementas', label: 'Ementas', icon: 'menu_book' },
    { key: 'inscricoes', label: 'Inscrições', icon: 'how_to_reg' },
    { key: 'relatorio', label: 'Relatório Mensal', icon: 'summarize' }
  ];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">GESTÃO DO REFEITÓRIO</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">REFEITÓRIO</h1>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 -mb-px ${
              tab === t.key ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ======================= SERVIÇO DIÁRIO ======================= */}
      {tab === 'servico' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={labelCls}>Data</label>
                <input type="date" value={svcDate} onChange={(e) => e.target.value && changeSvcDate(e.target.value)} className={`${inputCls} w-40`} />
              </div>
              <div className="flex gap-1">
                {MEAL_TYPES.map((m) => (
                  <button
                    key={m}
                    onClick={() => changeSvcMeal(m)}
                    className={`flex items-center gap-1 px-3 h-9 text-[11px] font-bold cursor-pointer rounded-lg ${
                      svcMeal === m ? 'bg-[#0b1f3a] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">{MEAL_META[m].icon}</span>
                    {MEAL_META[m].label}
                    <span className={`font-mono text-[10px] ${svcMeal === m ? 'text-blue-200' : 'text-slate-400'}`}>{forecastToday[m]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              <span className="font-bold text-slate-700">{svcWeekdayLabel}</span> · {formatDate(svcDate)} · previsão:{' '}
              <span className="font-mono font-bold text-[#0b1f3a]">{expectedCount}</span> refeição(ões)
            </div>
          </div>

          {!isSchoolDay(svcDate) && (
            <Notice tone="warn">O refeitório só funciona de segunda a sexta-feira — escolha um dia útil.</Notice>
          )}

          {/* Alerta de alergénios: caixa de aviso global (mesma natureza do «Tudo sincronizado»), a vermelho. */}
          {alerts.length > 0 && (
            <Notice
              tone="error"
              icon="warning"
              title={`Alerta de alergénios — ${alerts.length} aluno(s) em risco`}
              resetKey={`alergenios-${svcDate}-${svcMeal}-${alerts.map((a) => a.subscription.id).join(',')}`}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {alerts.map((a) => (
                  <div key={a.subscription.id}>
                    <strong>{a.subscription.studentName}</strong>
                    {a.subscription.className ? ` (${a.subscription.className})` : ''} — {(a.allergens as string[]).map((k) => (ALLERGEN_LABELS as Record<string, string>)[k] || k).join(', ')}
                    {a.subscription.dietaryNotes ? ` · ${a.subscription.dietaryNotes}` : ''}
                  </div>
                ))}
                <div style={{ opacity: 0.9 }}>Prepare uma alternativa para estes alunos antes de servir.</div>
              </div>
            </Notice>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 text-xs">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${MEAL_META[svcMeal].badge}`}>
                <span className="material-symbols-outlined text-[12px]">{MEAL_META[svcMeal].icon}</span>
                {MEAL_META[svcMeal].label}
              </span>
              <span className="font-bold text-slate-700 uppercase text-[11px] tracking-wide">Ementa do dia</span>
            </div>
            {svcMenu ? (
              <div className="space-y-1">
                <div className="text-sm font-bold text-[#0b1f3a]">{svcMenu.mainDish}</div>
                <div className="text-slate-600">
                  {[svcMenu.soup && `Sopa: ${svcMenu.soup}`, svcMenu.sideDish && `Acompanhamento: ${svcMenu.sideDish}`, svcMenu.dessert && `Sobremesa: ${svcMenu.dessert}`, svcMenu.drink && `Bebida: ${svcMenu.drink}`]
                    .filter(Boolean)
                    .join(' · ') || 'Sem mais pratos indicados.'}
                </div>
                {(svcMenu.allergens || []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-slate-500">Contém:</span>
                    <AllergenTags keys={svcMenu.allergens || []} />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-400">
                Sem ementa registada para esta data e refeição.
                {canManage && (
                  <button onClick={() => { setTab('ementas'); setWeekAnchor(mondayOf(svcDate)); openMenu(svcDate, svcMeal); }} className="ml-2 font-bold text-[#0b1f3a] hover:underline cursor-pointer">
                    Criar ementa
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Esperados</div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{expectedCount}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Servidas</div>
              <div className="font-mono text-xl font-extrabold text-emerald-700 mt-1 leading-none">{counts.served}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ausentes</div>
              <div className="font-mono text-xl font-extrabold text-amber-700 mt-1 leading-none">{counts.absent}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Avulsas</div>
              <div className="font-mono text-xl font-extrabold text-violet-700 mt-1 leading-none">{counts.extra}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="text-xs">
                <span className="font-bold text-slate-800 uppercase text-[11px] tracking-wide">Registo de serviço</span>
                {svcRecord && (
                  <span className="ml-2 text-slate-500">
                    já registado por {svcRecord.updatedBy || svcRecord.createdBy}
                  </span>
                )}
                {dirty && <span className="ml-2 text-amber-700 font-bold">· alterações por guardar</span>}
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={markAllServed} disabled={entries.length === 0} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-[11px] cursor-pointer">
                    Marcar todos servidos
                  </button>
                  <button
                    onClick={saveService}
                    disabled={!dirty && !!svcRecord}
                    className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:hover:bg-[#0b1f3a] text-white font-bold text-xs cursor-pointer"
                    title={svcIsFuture ? 'Não se pode registar o serviço de uma data que ainda não chegou.' : undefined}
                  >
                    {svcRecord ? 'Atualizar Registo' : 'Registar Serviço'}
                  </button>
                </div>
              )}
            </div>

            {svcIsFuture && (
              <div className="px-4 pt-3">
                <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600 text-xs">
                  Data futura: vê-se a previsão, mas o serviço só se regista a partir do próprio dia.
                </div>
              </div>
            )}
            {svcErrors.length > 0 && (
              <div className="px-4 pt-3">
                <Notice tone="error">
                  {svcErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4">Aluno</th>
                    <th className="py-3.5 px-3">Origem</th>
                    <th className="py-3.5 px-3 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-10 text-center text-slate-400">
                        Nenhum aluno inscrito para esta refeição neste dia. Inscreva alunos no separador «Inscrições» ou acrescente uma refeição avulsa.
                      </td>
                    </tr>
                  ) : (
                    visibleEntries.map((en) => {
                      const risk = alertByStudent.get(en.studentId);
                      const sub = svcSubsByStudent.get(en.studentId);
                      return (
                        <tr key={en.studentId} className={en.status === 'ausente' ? 'bg-slate-50/70' : ''}>
                          <td className="py-2 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`font-semibold ${en.status === 'ausente' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{en.studentName}</span>
                              {risk && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-red-100 text-red-800 text-[10px] font-bold" title={allergenLabelList(risk)}>
                                  <span className="material-symbols-outlined text-[12px]">warning</span>
                                  {allergenLabelList(risk)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-slate-500">
                            {en.extra ? (
                              <span className="px-1.5 py-px rounded bg-violet-100 text-violet-800 text-[10px] font-bold">Avulsa · sem inscrição</span>
                            ) : sub ? (
                              <span className="font-mono text-[11px]">{sub.code}</span>
                            ) : (
                              <span className="text-[11px]">Inscrição já não ativa</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                disabled={!canManage}
                                onClick={() => setEntryStatus(en.studentId, 'servida')}
                                className={`px-2.5 h-7 text-[11px] font-bold rounded cursor-pointer disabled:cursor-default ${
                                  en.status === 'servida' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                              >
                                Servida
                              </button>
                              <button
                                disabled={!canManage}
                                onClick={() => setEntryStatus(en.studentId, 'ausente')}
                                className={`px-2.5 h-7 text-[11px] font-bold rounded cursor-pointer disabled:cursor-default ${
                                  en.status === 'ausente' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                              >
                                Ausente
                              </button>
                              {canManage && en.extra && (
                                <button onClick={() => removeExtra(en.studentId)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer" title="Remover refeição avulsa">
                                  <span className="material-symbols-outlined text-[16px]">close</span>
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
              <TablePagination total={entries.length} page={pgEntries} onPageChange={setPgEntries} />
            </div>

            {canManage && isSchoolDay(svcDate) && (
              <div className="p-4 border-t border-slate-100 bg-slate-50/60">
                <div className="font-bold text-[11px] uppercase tracking-wide text-slate-700 mb-1.5">Refeição avulsa (aluno sem inscrição)</div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <SearchableSelect
                      options={extraOptions}
                      value={extraStudentId}
                      onChange={(v) => setExtraStudentId(v)}
                      placeholder="Pesquise o aluno..."
                      emptyMessage="Nenhum aluno ativo disponível"
                    />
                  </div>
                  <button onClick={addExtra} disabled={!extraStudentId} className="px-4 h-9 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:hover:bg-[#0b1f3a] text-white font-bold text-xs cursor-pointer">
                    Acrescentar
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">Alunos avulsos não têm alergias registadas — confirme com o encarregado antes de servir.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= EMENTAS ======================= */}
      {tab === 'ementas' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekAnchor(addDaysIso(weekAnchor, -7))} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer" title="Semana anterior">
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <div className="text-xs font-bold text-[#0b1f3a] min-w-[210px] text-center">
                Semana de {formatDate(days[0])} a {formatDate(days[4])}
              </div>
              <button onClick={() => setWeekAnchor(addDaysIso(weekAnchor, 7))} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer" title="Semana seguinte">
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
              <button onClick={() => setWeekAnchor(mondayOf(todayIso))} className="px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 cursor-pointer">
                Esta semana
              </button>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => copyWeek(addDaysIso(weekAnchor, -7), weekAnchor)} className="flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-[#0b1f3a] cursor-pointer">
                  <span className="material-symbols-outlined text-[15px]">content_copy</span> Copiar da semana anterior
                </button>
                <button onClick={() => copyWeek(weekAnchor, addDaysIso(weekAnchor, 7))} className="flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-[#0b1f3a] cursor-pointer">
                  <span className="material-symbols-outlined text-[15px]">content_copy</span> Copiar para a seguinte
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[860px]">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3 w-32">Refeição</th>
                  {days.map((d) => (
                    <th key={d} className={`py-3 px-3 ${d === todayIso ? 'bg-[#7a0c0c]' : ''}`}>{formatDayShort(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {MEAL_TYPES.map((meal) => (
                  <tr key={meal}>
                    <td className="py-3 px-3 align-top">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${MEAL_META[meal].badge}`}>
                        <span className="material-symbols-outlined text-[12px]">{MEAL_META[meal].icon}</span>
                        {MEAL_META[meal].label}
                      </span>
                    </td>
                    {days.map((d) => {
                      const m = findMenu(menus, d, meal);
                      return (
                        <td key={d} className="p-1.5 align-top">
                          <button
                            onClick={() => (canManage || m) && openMenu(d, meal)}
                            className={`w-full min-h-[64px] text-left p-2 rounded-lg border transition-colors cursor-pointer ${
                              m ? 'border-slate-200 bg-slate-50 hover:border-[#0b1f3a]' : 'border-dashed border-slate-300 hover:border-[#0b1f3a] text-slate-300'
                            }`}
                          >
                            {m ? (
                              <>
                                <div className="font-bold text-slate-800 leading-tight">{m.mainDish}</div>
                                {(m.allergens || []).length > 0 && (
                                  <div className="flex flex-wrap gap-0.5 mt-1">
                                    <AllergenTags keys={m.allergens || []} />
                                  </div>
                                )}
                              </>
                            ) : canManage ? (
                              <span className="flex items-center gap-1 text-[11px]">
                                <span className="material-symbols-outlined text-[14px]">add</span> Adicionar
                              </span>
                            ) : (
                              <span className="text-[11px]">—</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======================= INSCRIÇÕES ======================= */}
      {tab === 'inscricoes' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="grid grid-cols-3 gap-2 w-full md:max-w-md">
              {(Object.keys(SUBSCRIPTION_STATUS_META) as CanteenSubscriptionStatus[]).map((st) => {
                const active = subStatus === st;
                return (
                  <button
                    key={st}
                    onClick={() => setSubStatus(active ? 'all' : st)}
                    className={`text-left bg-white border rounded-xl p-3 transition-colors cursor-pointer ${
                      active ? 'border-[#0b1f3a] ring-1 ring-[#0b1f3a]' : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 truncate">{SUBSCRIPTION_STATUS_META[st].label}</div>
                    <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{subCounts[st] || 0}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={exportSubs}
                disabled={filteredSubs.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                <span>EXPORTAR CSV</span>
              </button>
              {canManage && (
                <button onClick={openAddSub} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  <span>NOVA INSCRIÇÃO</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
              <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
              <input
                type="text"
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                placeholder="Pesquisar aluno, nº de processo ou código..."
                className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none text-xs text-slate-800 placeholder:text-slate-400"
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <select value={subYear} onChange={(e) => setSubYear(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
                <option value="all">Todos os Anos Letivos</option>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-xs text-slate-400 font-mono">{filteredSubs.length} inscrição(ões)</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4">Aluno</th>
                    <th className="py-3.5 px-3">Refeições e Dias</th>
                    <th className="py-3.5 px-3">Período</th>
                    {canSeeHealth && <th className="py-3.5 px-3">Alergias</th>}
                    <th className="py-3.5 px-3">Estado</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSubs.length === 0 ? (
                    <tr>
                      <td colSpan={canSeeHealth ? 6 : 5} className="py-12 text-center text-slate-400">
                        {subs.length === 0 ? 'Ainda não há inscrições. Clique em "NOVA INSCRIÇÃO" para inscrever o primeiro aluno.' : 'Nenhuma inscrição corresponde aos filtros.'}
                      </td>
                    </tr>
                  ) : (
                    visibleFilteredSubs.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#0b1f3a]">{s.studentName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{s.code} · {s.studentProcNumber}{s.className ? ` · ${s.className}` : ''}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          <div>{(s.meals || []).map((m) => MEAL_META[m].label).join(' + ')}</div>
                          <div className="text-[11px] text-slate-500">{(s.weekdays || []).map((d) => WEEKDAY_SHORT[d]).join(' ')}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {formatDate(s.startDate)} → {s.endDate ? formatDate(s.endDate) : 'sem fim'}
                          <div className="text-[11px] text-slate-400">{s.academicYear}</div>
                        </td>
                        {canSeeHealth && (
                          <td className="py-3 px-3">
                            {(s.allergies || []).length > 0 ? (
                              <div className="flex flex-wrap gap-0.5 max-w-[220px]"><AllergenTags keys={s.allergies} tone="red" /></div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                            {s.dietaryNotes && <div className="text-[10px] text-slate-500 italic mt-0.5 max-w-[220px] truncate" title={s.dietaryNotes}>{s.dietaryNotes}</div>}
                          </td>
                        )}
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${SUBSCRIPTION_STATUS_META[s.status].badge}`}>{SUBSCRIPTION_STATUS_META[s.status].label}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              {s.status !== 'cancelada' && (
                                <button onClick={() => openEditSub(s)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer" title="Editar">
                                  <span className="material-symbols-outlined text-[18px]">edit</span>
                                </button>
                              )}
                              {s.status === 'ativa' && (
                                <button onClick={() => changeSubStatus(s, 'suspensa')} className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-slate-100 cursor-pointer" title="Suspender">
                                  <span className="material-symbols-outlined text-[18px]">pause_circle</span>
                                </button>
                              )}
                              {s.status === 'suspensa' && (
                                <button onClick={() => changeSubStatus(s, 'ativa')} className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 cursor-pointer" title="Reativar">
                                  <span className="material-symbols-outlined text-[18px]">play_circle</span>
                                </button>
                              )}
                              {s.status !== 'cancelada' && (
                                <button onClick={() => changeSubStatus(s, 'cancelada')} className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-slate-100 cursor-pointer" title="Cancelar inscrição">
                                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                                </button>
                              )}
                              <button onClick={() => removeSub(s)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 cursor-pointer" title="Eliminar">
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <TablePagination total={filteredSubs.length} page={pgFilteredSubs} onPageChange={setPgFilteredSubs} />
            </div>
          </div>
        </div>
      )}

      {/* ======================= RELATÓRIO MENSAL ======================= */}
      {tab === 'relatorio' && (
        <div className="flex flex-col gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <label className={labelCls}>Mês</label>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputCls} w-44`} />
            </div>
            <button
              onClick={() => downloadCsv(monthlyReportToCsv(report), `refeitorio_relatorio_${month}.csv`)}
              disabled={report.students.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>EXPORTAR CSV</span>
            </button>
          </div>

          {report.days.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 text-xs">
              Sem serviço registado em {formatMonth(month)}.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Servidas</div>
                  <div className="font-mono text-xl font-extrabold text-emerald-700 mt-1 leading-none">{report.totals.served}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ausências</div>
                  <div className="font-mono text-xl font-extrabold text-amber-700 mt-1 leading-none">{report.totals.absent}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Avulsas</div>
                  <div className="font-mono text-xl font-extrabold text-violet-700 mt-1 leading-none">{report.totals.extra}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dias com serviço</div>
                  <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{report.days.length}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 font-bold text-[11px] uppercase tracking-wide text-slate-700">Por dia (servidas)</div>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                          <th className="py-3.5 px-4">Dia</th>
                          {MEAL_TYPES.map((m) => <th key={m} className="py-3.5 px-3 text-center">{MEAL_META[m].label}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.days.map((d) => (
                          <tr key={d.date}>
                            <td className="py-2 px-3 font-semibold text-slate-700">{formatDayShort(d.date)}</td>
                            {MEAL_TYPES.map((m) => (
                              <td key={m} className="py-2 px-3 text-center font-mono">
                                {d.byMeal[m].served + d.byMeal[m].absent === 0 ? <span className="text-slate-300">—</span> : d.byMeal[m].served}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 font-bold">
                          <td className="py-2 px-3">Total</td>
                          {MEAL_TYPES.map((m) => <td key={m} className="py-2 px-3 text-center font-mono">{report.byMeal[m].served}</td>)}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 font-bold text-[11px] uppercase tracking-wide text-slate-700">Por aluno</div>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                          <th className="py-3.5 px-4">Aluno</th>
                          <th className="py-3.5 px-3 text-center">Servidas</th>
                          <th className="py-3.5 px-3 text-center">Ausências</th>
                          <th className="py-3.5 px-3 text-center">Avulsas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleStudents.map((s) => (
                          <tr key={s.studentId}>
                            <td className="py-2 px-3 font-semibold text-slate-800">{s.studentName}</td>
                            <td className="py-2 px-3 text-center font-mono">{s.served}</td>
                            <td className="py-2 px-3 text-center font-mono">{s.absent}</td>
                            <td className="py-2 px-3 text-center font-mono">{s.extra}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <TablePagination total={report.students.length} page={pgStudents} onPageChange={setPgStudents} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- Modal: ementa ---------------- */}
      {menuOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}>
          <form onSubmit={submitMenu} className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={menuForm.id ? 'Editar Ementa' : 'Nova Ementa'}
              subtitle={`${formatDayShort(menuForm.date)} — ${MEAL_META[menuForm.mealType].label}`}
              icon="restaurant_menu"
              onClose={() => setMenuOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {menuErrors.length > 0 && (
                <Notice tone="error">
                  {menuErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              )}
              {!canManage && <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600">Só leitura: não tem permissão para editar ementas.</div>}
              <fieldset disabled={!canManage} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Data *</label>
                    <input type="date" value={menuForm.date} onChange={(e) => setMenuField('date', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Refeição *</label>
                    <select value={menuForm.mealType} onChange={(e) => setMenuField('mealType', e.target.value as MealType)} className={inputCls}>
                      {MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_META[m].label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Prato Principal *</label>
                  <input value={menuForm.mainDish} onChange={(e) => setMenuField('mainDish', e.target.value)} className={inputCls} placeholder="Ex.: Arroz com frango grelhado" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Sopa</label>
                    <input value={menuForm.soup} onChange={(e) => setMenuField('soup', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Acompanhamento</label>
                    <input value={menuForm.sideDish} onChange={(e) => setMenuField('sideDish', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Sobremesa</label>
                    <input value={menuForm.dessert} onChange={(e) => setMenuField('dessert', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Bebida</label>
                    <input value={menuForm.drink} onChange={(e) => setMenuField('drink', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Alergénios presentes na refeição</label>
                  <ChipGroup
                    tone="red"
                    options={ALLERGEN_KEYS.map((k) => ({ value: k, label: ALLERGEN_LABELS[k] }))}
                    selected={menuForm.allergens}
                    onToggle={(k) => setMenuField('allergens', toggleIn(menuForm.allergens, k))}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Estes alergénios geram alerta para os alunos inscritos que reagem a eles.</p>
                </div>
                <div>
                  <label className={labelCls}>Notas</label>
                  <textarea value={menuForm.notes} onChange={(e) => setMenuField('notes', e.target.value)} rows={2} className={areaCls} />
                </div>
              </fieldset>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-between gap-3">
              <div>
                {canManage && menuForm.id && (
                  <button type="button" onClick={removeMenu} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs cursor-pointer">Eliminar</button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setMenuOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">{canManage ? 'Cancelar' : 'Fechar'}</button>
                {canManage && <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar</button>}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: inscrição ---------------- */}
      {subOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setSubOpen(false); }}>
          <form onSubmit={submitSub} className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={subForm.id ? 'Editar Inscrição' : 'Nova Inscrição'} subtitle="Refeitório" icon="how_to_reg" onClose={() => setSubOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {subErrors.length > 0 && (
                <Notice tone="error">
                  {subErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Aluno *</label>
                  {subForm.id ? (
                    <input value={subs.find((s) => s.id === subForm.id)?.studentName || ''} disabled className={`${inputCls} bg-slate-100`} />
                  ) : (
                    <SearchableSelect
                      options={studentOptions}
                      value={subForm.studentId}
                      onChange={(v) => setSubField('studentId', v)}
                      placeholder="Pesquise o aluno pelo nome ou nº de processo..."
                      emptyMessage="Nenhum aluno ativo disponível"
                    />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Ano Letivo *</label>
                  <select value={subForm.academicYear} onChange={(e) => setSubField('academicYear', e.target.value)} className={inputCls}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Refeições *</label>
                <ChipGroup
                  options={MEAL_TYPES.map((m) => ({ value: m, label: MEAL_META[m].label }))}
                  selected={subForm.meals}
                  onToggle={(m) => setSubField('meals', toggleIn(subForm.meals, m))}
                />
              </div>
              <div>
                <label className={labelCls}>Dias da Semana *</label>
                <ChipGroup
                  options={SCHOOL_WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] }))}
                  selected={subForm.weekdays}
                  onToggle={(d) => setSubField('weekdays', toggleIn(subForm.weekdays, d))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Data de Início *</label>
                  <input type="date" value={subForm.startDate} onChange={(e) => setSubField('startDate', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Data de Fim</label>
                  <input type="date" value={subForm.endDate} min={subForm.startDate || undefined} onChange={(e) => setSubField('endDate', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <label className={labelCls}>Alergias e restrições alimentares</label>
                <ChipGroup
                  tone="red"
                  options={ALLERGEN_KEYS.map((k) => ({ value: k, label: ALLERGEN_LABELS[k] }))}
                  selected={subForm.allergies}
                  onToggle={(k) => setSubField('allergies', toggleIn(subForm.allergies, k))}
                />
                <p className="text-[11px] text-slate-500 mt-1">Dado de saúde: só é visível para quem gere o refeitório.</p>
              </div>
              <div>
                <label className={labelCls}>Notas alimentares</label>
                <textarea value={subForm.dietaryNotes} onChange={(e) => setSubField('dietaryNotes', e.target.value)} rows={2} className={areaCls} placeholder="Ex.: dieta sem carne de porco, intolerância à lactose..." />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setSubOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
