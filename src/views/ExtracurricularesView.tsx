import React, { useMemo, useState } from 'react';
import {
  ActivityAttendanceStatus,
  ActivityCategory,
  ActivityScheduleSlot,
  ActivityStatus,
  ExtracurricularActivity,
  SchoolDatabase,
  UserRole,
  Weekday
} from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppAlert, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { getAvailableGrades } from '../utils/educationSubsystems';
import { institutionAcademicYears } from '../utils/academicYear';
import { nextAcademicYearLabel, toIso } from '../utils/academicCalendar';
import {
  ACTIVITY_STATUS_META,
  ACTIVITY_STATUS_ORDER,
  ATTENDANCE_META,
  CATEGORY_META,
  ENROLLMENT_STATUS_META,
  WEEKDAYS,
  WEEKDAY_LABELS,
  activeEnrollments,
  activitiesToCsv,
  allowedActivityTransitions,
  checkEnrollment,
  describeResourceConflict,
  findResourceConflicts,
  formatSchedule,
  isLiveEnrollment,
  normalizeActivityFields,
  participantsToCsv,
  sessionRoster,
  studentAttendance,
  summarizeActivity,
  uniqueParticipants,
  vacancies,
  waitlist
} from '../utils/extracurriculars';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface ExtracurricularesViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
}

const inputCls = 'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const areaCls = 'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

type ActivityForm = {
  name: string;
  category: ActivityCategory;
  description: string;
  academicYear: string;
  coordinatorId: string;
  coordinatorName: string;
  venue: string;
  schedule: ActivityScheduleSlot[];
  startDate: string;
  endDate: string;
  capacity: string;
  allowedGrades: string[];
};

const emptyForm = (academicYear: string): ActivityForm => ({
  name: '',
  category: 'desporto',
  description: '',
  academicYear,
  coordinatorId: '',
  coordinatorName: '',
  venue: '',
  schedule: [{ weekday: 3, start: '14:00', end: '15:30' }],
  startDate: '',
  endDate: '',
  capacity: '',
  allowedGrades: []
});

const formFromActivity = (a: ExtracurricularActivity): ActivityForm => ({
  name: a.name,
  category: a.category,
  description: a.description || '',
  academicYear: a.academicYear,
  coordinatorId: a.coordinatorId || '',
  coordinatorName: a.coordinatorName,
  venue: a.venue,
  schedule: (a.schedule || []).map((s) => ({ ...s })),
  startDate: a.startDate || '',
  endDate: a.endDate || '',
  capacity: String(a.capacity || ''),
  allowedGrades: [...(a.allowedGrades || [])]
});

const formatDate = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/** Transição → texto do botão (o estado de destino nem sempre é o melhor rótulo de ação). */
const TRANSITION_ACTION: Record<ActivityStatus, { label: string; icon: string; tone: string }> = {
  planeada: { label: 'Repor como Planeada', icon: 'event_note', tone: 'bg-slate-500 hover:bg-slate-600' },
  inscricoes_abertas: { label: 'Abrir Inscrições', icon: 'how_to_reg', tone: 'bg-blue-600 hover:bg-blue-700' },
  em_curso: { label: 'Iniciar Atividade', icon: 'play_circle', tone: 'bg-emerald-600 hover:bg-emerald-700' },
  encerrada: { label: 'Encerrar', icon: 'task_alt', tone: 'bg-slate-600 hover:bg-slate-700' },
  cancelada: { label: 'Cancelar Atividade', icon: 'cancel', tone: 'bg-red-600 hover:bg-red-700' }
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

const safeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();

type DetailTab = 'inscritos' | 'sessoes' | 'resumo';

export const ExtracurricularesView: React.FC<ExtracurricularesViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('extracurriculares.manage');

  const yearOptions = useMemo(
    () => institutionAcademicYears(db.settings, (db.extracurricularActivities || []).map((a) => a.academicYear)),
    [db.settings, db.extracurricularActivities]
  );
  const currentYear = db.settings?.currentAcademicYear || yearOptions[0];
  const gradeOptions = useMemo(() => getAvailableGrades(db.settings?.selectedSubsystems), [db.settings?.selectedSubsystems]);
  const teacherOptions = useMemo(
    () => (db.teachers || []).map((t) => ({ value: t.name, label: t.name, sublabel: t.department })),
    [db.teachers]
  );

  const activities = db.extracurricularActivities || [];
  const todayIso = toIso(new Date());

  // ---- filtros ----
  const [yearFilter, setYearFilter] = useState(currentYear);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ActivityCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ActivityStatus>('all');
  const [search, setSearch] = useState('');

  // ---- formulário da atividade ----
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExtracurricularActivity | null>(null);
  const [form, setForm] = useState<ActivityForm>(emptyForm(currentYear));
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // ---- detalhe ----
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = activities.find((a) => a.id === viewingId) || null;
  const [tab, setTab] = useState<DetailTab>('inscritos');
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrollAuthorized, setEnrollAuthorized] = useState(false);

  // ---- sessão de presenças ----
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionDate, setSessionDate] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [sessionMarks, setSessionMarks] = useState<Record<string, ActivityAttendanceStatus>>({});
  const [sessionErrors, setSessionErrors] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities
      .filter((a) => yearFilter === 'all' || a.academicYear === yearFilter)
      .filter((a) => categoryFilter === 'all' || a.category === categoryFilter)
      .filter((a) => statusFilter === 'all' || a.status === statusFilter)
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.code.toLowerCase().includes(q) ||
          a.coordinatorName.toLowerCase().includes(q) ||
          a.venue.toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activities, yearFilter, categoryFilter, statusFilter, search]);
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const inYear = useMemo(
    () => activities.filter((a) => yearFilter === 'all' || a.academicYear === yearFilter),
    [activities, yearFilter]
  );
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    inYear.forEach((a) => (map[a.status] = (map[a.status] || 0) + 1));
    return map;
  }, [inYear]);
  const participants = useMemo(() => uniqueParticipants(inYear.filter((a) => a.status !== 'cancelada')), [inYear]);

  const run = async (action: () => void, rule: string, loadingMessage: string, successMessage?: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  // ---------------------------------------------------------------------------
  // Formulário da atividade
  // ---------------------------------------------------------------------------

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(yearFilter !== 'all' ? yearFilter : currentYear));
    setFormErrors([]);
    setFormOpen(true);
  };
  const openEdit = (a: ExtracurricularActivity) => {
    setEditing(a);
    setForm(formFromActivity(a));
    setFormErrors([]);
    setFormOpen(true);
  };
  const setField = <K extends keyof ActivityForm>(key: K, value: ActivityForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const updateSlot = (index: number, patch: Partial<ActivityScheduleSlot>) =>
    setField('schedule', form.schedule.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const addSlot = () => setField('schedule', [...form.schedule, { weekday: 1 as Weekday, start: '14:00', end: '15:30' }]);
  const removeSlot = (index: number) => setField('schedule', form.schedule.filter((_, i) => i !== index));
  const toggleGrade = (g: string) =>
    setField('allowedGrades', form.allowedGrades.includes(g) ? form.allowedGrades.filter((x) => x !== g) : [...form.allowedGrades, g]);

  const buildPayload = () => ({
    id: editing?.id,
    name: form.name,
    category: form.category,
    description: form.description,
    academicYear: form.academicYear,
    coordinatorId: form.coordinatorId || undefined,
    coordinatorName: form.coordinatorName,
    venue: form.venue,
    schedule: form.schedule,
    startDate: form.startDate,
    endDate: form.endDate,
    capacity: Number(form.capacity) || 0,
    allowedGrades: form.allowedGrades
  });

  // Conflitos de local/coordenador em tempo real (o serviço também os recusa ao guardar).
  const liveConflicts = useMemo(() => {
    if (!formOpen) return [];
    const fields = normalizeActivityFields(buildPayload() as any);
    if (!fields.venue && !fields.coordinatorName) return [];
    return findResourceConflicts(fields, activities, editing?.id).map(describeResourceConflict);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, form, activities, editing]);

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = dbService.saveExtracurricularActivity(buildPayload() as any);
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'extracurriculares.manage',
      editing ? 'A guardar atividade...' : 'A criar atividade...',
      editing ? 'Atividade atualizada!' : 'Atividade criada!'
    );
    if (result.ok) setFormOpen(false);
    else setFormErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const removeActivity = async (a: ExtracurricularActivity) => {
    const ok = await showAppConfirm(`Eliminar a atividade ${a.code} (${a.name})? Esta ação não pode ser desfeita.`, {
      title: 'Eliminar Atividade',
      variant: 'error',
      confirmLabel: 'Eliminar'
    });
    if (!ok) return;
    const result = await run(
      () => {
        const r = dbService.deleteExtracurricularActivity(a.id);
        if (!r.success) throw new Error(r.error);
      },
      'extracurriculares.manage',
      'A eliminar atividade...',
      'Atividade eliminada.'
    );
    if (result.ok && viewingId === a.id) setViewingId(null);
  };

  const changeStatus = async (a: ExtracurricularActivity, to: ActivityStatus) => {
    const meta = ACTIVITY_STATUS_META[to];
    const isCancel = to === 'cancelada';
    const isClose = to === 'encerrada';
    const ok = await showAppConfirm(
      isCancel
        ? `Cancelar a atividade ${a.code} (${a.name})? Passa a estado final e deixa de aceitar inscrições e presenças.`
        : isClose
          ? `Encerrar a atividade ${a.code} (${a.name})? Passa a estado final e deixa de aceitar inscrições e presenças.`
          : `Passar a atividade ${a.code} para «${meta.label}»?`,
      {
        title: TRANSITION_ACTION[to].label,
        variant: isCancel ? 'error' : 'warning',
        confirmLabel: 'Confirmar'
      }
    );
    if (!ok) return;
    await run(
      () => {
        const r = dbService.changeActivityStatus(a.id, to);
        if (!r.success) throw new Error(r.error);
      },
      'extracurriculares.manage',
      'A atualizar estado...',
      `Atividade: ${meta.label}.`
    );
  };

  // ---------------------------------------------------------------------------
  // Inscrições
  // ---------------------------------------------------------------------------

  const openDetail = (a: ExtracurricularActivity, initialTab: DetailTab = 'inscritos') => {
    setViewingId(a.id);
    setTab(initialTab);
    setEnrollStudentId('');
    setEnrollAuthorized(false);
  };

  const enrollOptions = useMemo(() => {
    if (!viewing) return [];
    const taken = new Set((viewing.enrollments || []).filter(isLiveEnrollment).map((e) => e.studentId));
    return (db.students || [])
      .filter((s) => s.status === 'active' && !taken.has(s.id))
      .map((s) => ({
        value: s.id,
        label: s.name,
        sublabel: `${s.procNumber}${s.className ? ' · ' + s.className : s.grade ? ' · ' + s.grade : ''}`
      }));
  }, [viewing, db.students]);

  const enrollCheck = useMemo(() => {
    if (!viewing || !enrollStudentId) return null;
    const student = (db.students || []).find((s) => s.id === enrollStudentId);
    return checkEnrollment(viewing, student, { activities, timetable: db.timetable });
  }, [viewing, enrollStudentId, db.students, db.timetable, activities]);

  const submitEnroll = async () => {
    if (!viewing || !enrollStudentId) return;
    const waitlisted = !!enrollCheck?.waitlisted;
    const result = await run(
      () => {
        const r = dbService.enrollStudentInActivity(viewing.id, enrollStudentId, { guardianAuthorized: enrollAuthorized });
        if (!r.success) throw new Error(r.errors?.length ? r.errors.join(' ') : r.error);
      },
      'extracurriculares.manage',
      'A inscrever aluno...',
      waitlisted ? 'Aluno colocado na lista de espera.' : 'Inscrição efetuada!'
    );
    if (result.ok) {
      setEnrollStudentId('');
      setEnrollAuthorized(false);
    }
  };

  const cancelEnrollment = async (a: ExtracurricularActivity, enrollmentId: string, studentName: string) => {
    const ok = await showAppConfirm(`Cancelar a inscrição de ${studentName} em «${a.name}»?`, {
      title: 'Cancelar Inscrição',
      variant: 'warning',
      confirmLabel: 'Cancelar Inscrição'
    });
    if (!ok) return;
    let promoted: string | undefined;
    const result = await run(
      () => {
        const r = dbService.cancelActivityEnrollment(a.id, enrollmentId);
        if (!r.success) throw new Error(r.error);
        promoted = r.promoted;
      },
      'extracurriculares.manage',
      'A cancelar inscrição...',
      'Inscrição cancelada.'
    );
    if (result.ok && promoted) {
      showAppAlert(`${promoted} estava em lista de espera e passou a inscrito(a).`, { title: 'Lista de Espera', variant: 'info' });
    }
  };

  // ---------------------------------------------------------------------------
  // Sessões e presenças
  // ---------------------------------------------------------------------------

  const openNewSession = (a: ExtracurricularActivity) => {
    const used = new Set((a.sessions || []).map((s) => s.date));
    let date = todayIso;
    if (used.has(date) || (a.startDate && date < a.startDate) || (a.endDate && date > a.endDate)) date = '';
    setSessionId(undefined);
    setSessionDate(date);
    setSessionNotes('');
    setSessionMarks({});
    setSessionErrors([]);
    setSessionOpen(true);
  };

  const openEditSession = (a: ExtracurricularActivity, id: string) => {
    const s = (a.sessions || []).find((x) => x.id === id);
    if (!s) return;
    const marks: Record<string, ActivityAttendanceStatus> = {};
    (s.entries || []).forEach((e) => (marks[e.studentId] = e.status));
    setSessionId(s.id);
    setSessionDate(s.date);
    setSessionNotes(s.notes || '');
    setSessionMarks(marks);
    setSessionErrors([]);
    setSessionOpen(true);
  };

  const sessionRosterList = useMemo(
    () => (viewing && sessionOpen && sessionDate ? sessionRoster(viewing, sessionDate, sessionId) : []),
    [viewing, sessionOpen, sessionDate, sessionId]
  );

  const markAll = (status: ActivityAttendanceStatus) => {
    const marks: Record<string, ActivityAttendanceStatus> = {};
    sessionRosterList.forEach((e) => (marks[e.studentId] = status));
    setSessionMarks(marks);
  };

  const submitSession = async () => {
    if (!viewing) return;
    if (sessionRosterList.length === 0) {
      setSessionErrors(['Não há inscritos ativos nesta data para registar presenças.']);
      return;
    }
    const entries = sessionRosterList.map((e) => ({
      studentId: e.studentId,
      studentName: e.studentName,
      status: sessionMarks[e.studentId] || ('P' as ActivityAttendanceStatus)
    }));
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = dbService.saveActivitySession(viewing.id, { id: sessionId, date: sessionDate, notes: sessionNotes, entries });
        if (!r.success) {
          errs = r.errors?.length ? r.errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'extracurriculares.manage',
      'A guardar presenças...',
      'Presenças registadas!'
    );
    if (result.ok) setSessionOpen(false);
    else setSessionErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const removeSession = async (a: ExtracurricularActivity, id: string, date: string) => {
    const ok = await showAppConfirm(`Eliminar a sessão de ${formatDate(date)}? As presenças dessa data perdem-se.`, {
      title: 'Eliminar Sessão',
      variant: 'error',
      confirmLabel: 'Eliminar'
    });
    if (!ok) return;
    await run(
      () => {
        const r = dbService.deleteActivitySession(a.id, id);
        if (!r.success) throw new Error(r.error);
      },
      'extracurriculares.manage',
      'A eliminar sessão...',
      'Sessão eliminada.'
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const renderStatusBadge = (status: ActivityStatus) => {
    const meta = ACTIVITY_STATUS_META[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${meta.badge}`}>
        <span className="material-symbols-outlined text-[12px]">{meta.icon}</span>
        {meta.label}
      </span>
    );
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">ACTIVIDADES DA ESCOLA</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">ACTIVIDADES EXTRACURRICULARES</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => downloadCsv(activitiesToCsv(filtered), `atividades_extracurriculares_${yearFilter === 'all' ? 'todos' : yearFilter.replace('/', '-')}.csv`)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm"
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
              <span>NOVA ATIVIDADE</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {ACTIVITY_STATUS_ORDER.map((st) => {
          const meta = ACTIVITY_STATUS_META[st];
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
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{counts[st] || 0}</div>
            </button>
          );
        })}
        <div data-card-hl className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="material-symbols-outlined text-[16px]">groups</span>
            <span className="text-[10px] font-bold uppercase tracking-wide truncate">Participantes</span>
          </div>
          <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{participants}</div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar atividade, código, coordenador ou local..."
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
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
            <option value="all">Todas as Categorias</option>
            {(Object.keys(CATEGORY_META) as ActivityCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_META[c].label}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400 font-mono">{filtered.length} de {inYear.length}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Atividade</th>
                <th className="py-3.5 px-3">Horário e Local</th>
                <th className="py-3.5 px-3">Ocupação</th>
                <th className="py-3.5 px-3">Assiduidade</th>
                <th className="py-3.5 px-3">Estado</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    {activities.length === 0
                      ? 'Ainda não há atividades. Clique em "NOVA ATIVIDADE" para criar a primeira.'
                      : 'Nenhuma atividade corresponde aos filtros.'}
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((a) => {
                  const cat = CATEGORY_META[a.category] || CATEGORY_META.outra;
                  const sum = summarizeActivity(a);
                  const isFinal = ACTIVITY_STATUS_META[a.status].final;
                  return (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <button onClick={() => openDetail(a)} className="font-bold text-[#0b1f3a] hover:underline text-left cursor-pointer">
                          {a.name}
                        </button>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-slate-500 font-mono">{a.code}</span>
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-bold ${cat.badge}`}>
                            <span className="material-symbols-outlined text-[11px]">{cat.icon}</span>
                            {cat.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        <div>{formatSchedule(a.schedule)}</div>
                        <div className="text-[11px] text-slate-500">{a.venue} · {a.coordinatorName}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="w-24 h-1.5 bg-slate-200 rounded overflow-hidden">
                          <div className={`h-full ${sum.occupancy >= 100 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${sum.occupancy}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {sum.active}/{sum.capacity}
                          {sum.waiting > 0 && <span className="text-amber-700 font-semibold"> · {sum.waiting} em espera</span>}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700">
                        {sum.attendanceRate === null ? <span className="text-slate-300">—</span> : `${sum.attendanceRate}%`}
                        <div className="text-[10px] text-slate-400 font-sans">{sum.sessions} sessão(ões)</div>
                      </td>
                      <td className="py-3 px-3">{renderStatusBadge(a.status)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openDetail(a)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title="Ver inscritos e presenças">
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                          </button>
                          {canManage && !isFinal && (
                            <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer" title="Editar">
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                          )}
                          {canManage && (a.enrollments || []).length === 0 && (
                            <button onClick={() => removeActivity(a)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 cursor-pointer" title="Eliminar (sem inscrições)">
                              <span className="material-symbols-outlined text-[18px]">delete</span>
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

      {/* ---------------- Modal: formulário da atividade ---------------- */}
      {formOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form onSubmit={submitForm} className="bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={editing ? `Editar ${editing.code}` : 'Nova Atividade Extracurricular'} subtitle="Atividades Extracurriculares" icon="sports_soccer" onClose={() => setFormOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {formErrors.length > 0 && (
                <Notice tone="error">
                  {formErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              )}
              {liveConflicts.length > 0 && (
                <Notice tone="warn">
                  {liveConflicts.slice(0, 4).map((c, i) => <div key={i}>⚠ {c}</div>)}
                  <div className="text-[11px] text-amber-800/80 pt-1">Corrija o horário, o local ou o coordenador para poder guardar.</div>
                </Notice>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Nome da Atividade *</label>
                  <input value={form.name} onChange={(e) => setField('name', e.target.value)} className={inputCls} placeholder="Ex.: Clube de Xadrez" />
                </div>
                <div>
                  <label className={labelCls}>Ano Letivo *</label>
                  <select value={form.academicYear} onChange={(e) => setField('academicYear', e.target.value)} className={inputCls}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Categoria *</label>
                  <select value={form.category} onChange={(e) => setField('category', e.target.value as ActivityCategory)} className={inputCls}>
                    {(Object.keys(CATEGORY_META) as ActivityCategory[]).map((c) => (
                      <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Capacidade (alunos) *</label>
                  <input type="number" min={1} value={form.capacity} onChange={(e) => setField('capacity', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Coordenador / Monitor *</label>
                  <SearchableSelect
                    options={teacherOptions}
                    value={form.coordinatorName}
                    onChange={(v) => {
                      const teacher = (db.teachers || []).find((t) => t.name === v);
                      setForm((f) => ({ ...f, coordinatorName: v, coordinatorId: teacher?.id || '' }));
                    }}
                    allowCustom
                    placeholder="Professor ou monitor externo..."
                  />
                </div>
                <div>
                  <label className={labelCls}>Local *</label>
                  <input value={form.venue} onChange={(e) => setField('venue', e.target.value)} className={inputCls} placeholder="Ex.: Pavilhão, Sala de Artes" />
                </div>
                <div>
                  <label className={labelCls}>Data de Início</label>
                  <input type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Data de Fim</label>
                  <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => setField('endDate', e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">Horário Semanal *</span>
                  <button type="button" onClick={addSlot} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-[11px] cursor-pointer">
                    <span className="material-symbols-outlined text-[14px]">add</span> Adicionar Horário
                  </button>
                </div>
                <div className="space-y-2">
                  {form.schedule.length === 0 && (
                    <div className="text-center py-4 text-slate-400 border border-dashed border-slate-300 rounded-xl">Sem horários — adicione pelo menos um.</div>
                  )}
                  {form.schedule.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select value={s.weekday} onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) as Weekday })} className={`${inputCls} flex-1`}>
                        {WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_LABELS[w]}</option>)}
                      </select>
                      <input type="time" value={s.start} onChange={(e) => updateSlot(i, { start: e.target.value })} className={`${inputCls} w-28`} />
                      <span className="text-slate-400">–</span>
                      <input type="time" value={s.end} onChange={(e) => updateSlot(i, { end: e.target.value })} className={`${inputCls} w-28`} />
                      <button type="button" onClick={() => removeSlot(i)} className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer" title="Remover horário">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">Classes Admitidas</span>
                <p className="text-slate-500 mt-0.5 mb-2">Sem nenhuma selecionada, a atividade fica aberta a todas as classes.</p>
                <div className="flex flex-wrap gap-1.5">
                  {gradeOptions.map((g) => {
                    const on = form.allowedGrades.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGrade(g)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${
                          on ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={labelCls}>Descrição</label>
                <textarea value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} className={areaCls} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: detalhe da atividade ---------------- */}
      {viewing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setViewingId(null); }}>
          <div className="bg-white max-w-4xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={viewing.name} subtitle={`${viewing.code} · ${viewing.academicYear}`} icon="sports_soccer" onClose={() => setViewingId(null)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {(() => {
                const sum = summarizeActivity(viewing);
                const meta = ACTIVITY_STATUS_META[viewing.status];
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {renderStatusBadge(viewing.status)}
                      <span className="text-slate-600">{formatSchedule(viewing.schedule)}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{viewing.venue}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">Coord.: {viewing.coordinatorName}</span>
                    </div>
                    <div className="text-slate-500">
                      Período: {viewing.startDate || viewing.endDate ? `${formatDate(viewing.startDate)} a ${formatDate(viewing.endDate)}` : 'todo o ano letivo'} ·{' '}
                      Classes: {(viewing.allowedGrades || []).length ? viewing.allowedGrades.join(', ') : 'todas'}
                    </div>
                    {viewing.description && <p className="text-slate-600 whitespace-pre-wrap break-words">{viewing.description}</p>}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2.5 border border-slate-200 rounded-lg">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Inscritos</div>
                        <div className="font-mono text-lg font-extrabold text-[#0b1f3a]">{sum.active}/{sum.capacity}</div>
                      </div>
                      <div className="p-2.5 border border-slate-200 rounded-lg">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Vagas</div>
                        <div className="font-mono text-lg font-extrabold text-[#0b1f3a]">{vacancies(viewing)}</div>
                      </div>
                      <div className="p-2.5 border border-slate-200 rounded-lg">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Lista de Espera</div>
                        <div className="font-mono text-lg font-extrabold text-[#0b1f3a]">{sum.waiting}</div>
                      </div>
                      <div className="p-2.5 border border-slate-200 rounded-lg">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Assiduidade</div>
                        <div className="font-mono text-lg font-extrabold text-[#0b1f3a]">{sum.attendanceRate === null ? '—' : `${sum.attendanceRate}%`}</div>
                      </div>
                    </div>
                    {!meta.acceptsEnrollments && !meta.final && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600">
                        A atividade está «{meta.label}»: só aceita inscrições depois de «Inscrições Abertas» ou «Em Curso».
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="flex gap-1 border-b border-slate-200">
                {([
                  ['inscritos', 'Inscritos'],
                  ['sessoes', 'Sessões e Presenças'],
                  ['resumo', 'Assiduidade por Aluno']
                ] as Array<[DetailTab, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 -mb-px ${
                      tab === key ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* ---- Tab: inscritos ---- */}
              {tab === 'inscritos' && (
                <div className="space-y-3">
                  {canManage && ACTIVITY_STATUS_META[viewing.status].acceptsEnrollments && (
                    <div className="p-3 border border-slate-200 rounded-xl bg-slate-50/60 space-y-2">
                      <div className="font-bold text-[11px] uppercase tracking-wide text-slate-700">Inscrever Aluno</div>
                      <SearchableSelect
                        options={enrollOptions}
                        value={enrollStudentId}
                        onChange={(v) => setEnrollStudentId(v)}
                        placeholder="Pesquise o aluno pelo nome ou nº de processo..."
                        emptyMessage="Nenhum aluno ativo disponível"
                      />
                      {enrollCheck && enrollCheck.errors.length > 0 && (
                        <Notice tone="error">
                          {enrollCheck.errors.map((e, i) => <div key={i}>• {e}</div>)}
                        </Notice>
                      )}
                      {enrollCheck && enrollCheck.warnings.length > 0 && (
                        <Notice tone="warn">
                          {enrollCheck.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                        </Notice>
                      )}
                      <label className="flex items-start gap-2 cursor-pointer text-slate-700">
                        <input type="checkbox" checked={enrollAuthorized} onChange={(e) => setEnrollAuthorized(e.target.checked)} className="mt-0.5" />
                        <span>O encarregado de educação autorizou a participação do aluno nesta atividade.</span>
                      </label>
                      <button
                        onClick={submitEnroll}
                        disabled={!enrollStudentId || !enrollAuthorized || (enrollCheck?.errors.length || 0) > 0}
                        className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:hover:bg-[#0b1f3a] text-white font-bold text-xs cursor-pointer"
                      >
                        {enrollCheck?.waitlisted ? 'Colocar em Lista de Espera' : 'Inscrever'}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[11px] uppercase tracking-wide text-slate-700">
                      {(viewing.enrollments || []).filter(isLiveEnrollment).length} inscrição(ões) ativa(s) ou em espera
                    </span>
                    <button
                      onClick={() => downloadCsv(participantsToCsv(viewing), `participantes_${safeName(viewing.name)}.csv`)}
                      disabled={(viewing.enrollments || []).length === 0}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-[11px] cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">download</span> Exportar participantes
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                          <th className="py-2 px-3">Aluno</th>
                          <th className="py-2 px-3">Turma</th>
                          <th className="py-2 px-3">Estado</th>
                          <th className="py-2 px-3">Inscrição</th>
                          <th className="py-2 px-3 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(viewing.enrollments || []).length === 0 ? (
                          <tr><td colSpan={5} className="py-6 text-center text-slate-400">Ainda não há inscrições.</td></tr>
                        ) : (
                          (() => {
                            const queue = waitlist(viewing).map((e) => e.id);
                            return [...(viewing.enrollments || [])]
                              .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt'))
                              .map((e) => {
                                const em = ENROLLMENT_STATUS_META[e.status];
                                const pos = queue.indexOf(e.id);
                                return (
                                  <tr key={e.id} className={e.status === 'cancelada' ? 'opacity-50' : ''}>
                                    <td className="py-2 px-3">
                                      <div className="font-semibold text-slate-800">{e.studentName}</div>
                                      <div className="text-[10px] text-slate-500 font-mono">{e.studentProcNumber}</div>
                                    </td>
                                    <td className="py-2 px-3 text-slate-600">{e.className || e.grade || '—'}</td>
                                    <td className="py-2 px-3">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${em.badge}`}>{em.label}{pos >= 0 ? ` (${pos + 1}.º)` : ''}</span>
                                    </td>
                                    <td className="py-2 px-3 text-slate-500">{formatDate(e.enrolledAt)}</td>
                                    <td className="py-2 px-3 text-right">
                                      {canManage && isLiveEnrollment(e) && !ACTIVITY_STATUS_META[viewing.status].final && (
                                        <button
                                          onClick={() => cancelEnrollment(viewing, e.id, e.studentName)}
                                          className="text-[11px] font-bold text-red-700 hover:underline cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              });
                          })()
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ---- Tab: sessões ---- */}
              {tab === 'sessoes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[11px] uppercase tracking-wide text-slate-700">{(viewing.sessions || []).length} sessão(ões) registada(s)</span>
                    {canManage && (
                      <button
                        onClick={() => openNewSession(viewing)}
                        disabled={viewing.status !== 'em_curso'}
                        title={viewing.status !== 'em_curso' ? 'As presenças só se registam com a atividade «Em Curso».' : undefined}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:hover:bg-[#0b1f3a] text-white font-bold text-[11px] cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">add</span> Nova Sessão
                      </button>
                    )}
                  </div>
                  {viewing.status !== 'em_curso' && viewing.status !== 'encerrada' && viewing.status !== 'cancelada' && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-600">Inicie a atividade («Em Curso») para registar presenças.</div>
                  )}
                  <div className="space-y-1.5">
                    {(viewing.sessions || []).length === 0 ? (
                      <div className="text-center py-6 text-slate-400 border border-dashed border-slate-300 rounded-xl">Ainda não há sessões.</div>
                    ) : (
                      [...(viewing.sessions || [])]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((s) => {
                          const p = s.entries.filter((e) => e.status === 'P').length;
                          const fj = s.entries.filter((e) => e.status === 'FJ').length;
                          const fi = s.entries.filter((e) => e.status === 'FI').length;
                          return (
                            <div key={s.id} className="border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-800">{formatDate(s.date)}</div>
                                <div className="text-[10px] text-slate-500">
                                  <span className="text-emerald-700 font-semibold">{p} P</span> · <span className="text-amber-700 font-semibold">{fj} FJ</span> · <span className="text-red-700 font-semibold">{fi} FI</span>
                                  {s.notes ? ` · ${s.notes}` : ''}
                                </div>
                              </div>
                              {canManage && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => openEditSession(viewing, s.id)} disabled={viewing.status !== 'em_curso'} className="p-1 text-slate-400 hover:text-[#0b1f3a] disabled:opacity-30 cursor-pointer" title="Editar presenças">
                                    <span className="material-symbols-outlined text-[18px]">edit_note</span>
                                  </button>
                                  <button onClick={() => removeSession(viewing, s.id, s.date)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer" title="Eliminar sessão">
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              )}

              {/* ---- Tab: resumo por aluno ---- */}
              {tab === 'resumo' && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                        <th className="py-2 px-3">Aluno</th>
                        <th className="py-2 px-3 text-center">Presenças</th>
                        <th className="py-2 px-3 text-center">Faltas Just.</th>
                        <th className="py-2 px-3 text-center">Faltas Injust.</th>
                        <th className="py-2 px-3 text-right">Assiduidade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeEnrollments(viewing).length === 0 ? (
                        <tr><td colSpan={5} className="py-6 text-center text-slate-400">Sem inscritos ativos.</td></tr>
                      ) : (
                        [...activeEnrollments(viewing)]
                          .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt'))
                          .map((e) => {
                            const st = studentAttendance(viewing, e.studentId);
                            const low = st.rate !== null && st.rate < 75;
                            return (
                              <tr key={e.id}>
                                <td className="py-2 px-3 font-semibold text-slate-800">{e.studentName}</td>
                                <td className="py-2 px-3 text-center font-mono">{st.present}</td>
                                <td className="py-2 px-3 text-center font-mono">{st.justified}</td>
                                <td className="py-2 px-3 text-center font-mono">{st.unjustified}</td>
                                <td className={`py-2 px-3 text-right font-mono font-bold ${low ? 'text-red-700' : 'text-slate-700'}`}>
                                  {st.rate === null ? '—' : `${st.rate}%`}
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {canManage &&
                  allowedActivityTransitions(viewing.status).map((to) => (
                    <button
                      key={to}
                      onClick={() => changeStatus(viewing, to)}
                      className={`flex items-center gap-1 px-3 py-2 text-white font-bold text-[11px] cursor-pointer ${TRANSITION_ACTION[to].tone}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">{TRANSITION_ACTION[to].icon}</span>
                      {TRANSITION_ACTION[to].label}
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                {canManage && !ACTIVITY_STATUS_META[viewing.status].final && (
                  <button onClick={() => { const a = viewing; setViewingId(null); openEdit(a); }} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                    Editar
                  </button>
                )}
                <button onClick={() => setViewingId(null)} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Modal: sessão de presenças ---------------- */}
      {viewing && sessionOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setSessionOpen(false); }}>
          <div className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={sessionId ? 'Editar Sessão' : 'Nova Sessão'} subtitle={`${viewing.name} — presenças`} icon="fact_check" onClose={() => setSessionOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {sessionErrors.length > 0 && (
                <Notice tone="error">
                  {sessionErrors.map((e, i) => <div key={i}>• {e}</div>)}
                </Notice>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Data da Sessão *</label>
                  <input
                    type="date"
                    value={sessionDate}
                    max={todayIso}
                    min={viewing.startDate || undefined}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Notas</label>
                  <input value={sessionNotes} onChange={(e) => setSessionNotes(e.target.value)} className={inputCls} placeholder="Opcional" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[11px] uppercase tracking-wide text-slate-700">{sessionRosterList.length} aluno(s)</span>
                <button type="button" onClick={() => markAll('P')} disabled={sessionRosterList.length === 0} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-[11px] cursor-pointer">
                  Marcar todos presentes
                </button>
              </div>
              <div className="space-y-1.5">
                {!sessionDate ? (
                  <div className="text-center py-6 text-slate-400 border border-dashed border-slate-300 rounded-xl">Escolha a data para ver os alunos.</div>
                ) : sessionRosterList.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 border border-dashed border-slate-300 rounded-xl">Não há inscritos ativos nesta data.</div>
                ) : (
                  sessionRosterList.map((e) => {
                    const current = sessionMarks[e.studentId] || 'P';
                    return (
                      <div key={e.id} className="border border-slate-200 rounded-lg p-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 truncate">{e.studentName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{e.studentProcNumber}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(['P', 'FJ', 'FI'] as ActivityAttendanceStatus[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              title={ATTENDANCE_META[st].label}
                              onClick={() => setSessionMarks((m) => ({ ...m, [e.studentId]: st }))}
                              className={`w-9 h-7 text-[11px] font-bold rounded cursor-pointer ${
                                current === st
                                  ? st === 'P'
                                    ? 'bg-emerald-600 text-white'
                                    : st === 'FJ'
                                      ? 'bg-amber-500 text-white'
                                      : 'bg-red-600 text-white'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button onClick={() => setSessionOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Cancelar</button>
              <button onClick={submitSession} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Guardar Presenças</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
