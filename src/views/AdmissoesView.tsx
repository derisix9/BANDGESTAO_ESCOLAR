import React, { useMemo, useState } from 'react';
import {
  Admission,
  AdmissionAssessmentType,
  AdmissionComplaint,
  AdmissionDocument,
  AdmissionSource,
  AdmissionStatus,
  SchoolDatabase,
  User,
  UserRole
} from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppConfirm, showAppAlert } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { getAvailableGrades } from '../utils/educationSubsystems';
import { institutionAcademicYears } from '../utils/academicYear';
import { nextAcademicYearLabel } from '../utils/academicCalendar';
import { TablePagination, usePagedList } from '../components/TablePagination';
import {
  ADMISSION_ASSESSMENT_LABELS,
  ADMISSION_SOURCE_LABELS,
  ADMISSION_STATUS_META,
  ADMISSION_STATUS_ORDER,
  DECISION_STATUSES,
  admissionsToCsv,
  ageOn,
  allowedTransitions,
  computeVacancies,
  documentsProgress,
  emptyDocuments,
  findDuplicateAdmission,
  findDuplicateStudent,
  pendingDocuments,
  openAttachment
} from '../utils/admissions';
import { Notice } from '../components/Notice';

interface AdmissoesViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
  /** Depois de converter, leva a Secretaria à Matrícula do novo aluno. */
  onNavigateToMatriculas?: (studentId: string) => void;
}

type AdmissionForm = {
  academicYear: string;
  source: AdmissionSource;
  name: string;
  gender: 'Masculino' | 'Feminino';
  birthDate: string;
  nationality: string;
  birthPlace: string;
  biNumber: string;
  address: string;
  phone: string;
  email: string;
  specialNeedsNote: string;
  desiredGrade: string;
  desiredCourse: string;
  desiredShift: string;
  previousSchool: string;
  lastCompletedGrade: string;
  previousResult: '' | NonNullable<Admission['previousResult']>;
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  guardianEmail: string;
  guardianNif: string;
  fatherName: string;
  motherName: string;
  documents: AdmissionDocument[];
  assessmentType: '' | AdmissionAssessmentType;
  assessmentDate: string;
  assessmentTime: string;
  assessmentScore: string;
  assessmentNotes: string;
};

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const areaCls =
  'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
    <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
    <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{children}</span>
  </div>
);

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-PT') : '—');

const RESULTS: NonNullable<Admission['previousResult']>[] = [
  'Primeira Matrícula',
  'Aprovado',
  'Reprovado',
  'Transferido',
  'Desistente'
];
const SHIFTS = ['Manhã', 'Tarde', 'Integral', 'Pós-Laboral', 'Noite'];

const emptyForm = (academicYear: string): AdmissionForm => ({
  academicYear,
  source: 'presencial',
  name: '',
  gender: 'Masculino',
  birthDate: '',
  nationality: 'Angolana',
  birthPlace: '',
  biNumber: '',
  address: '',
  phone: '',
  email: '',
  specialNeedsNote: '',
  desiredGrade: '',
  desiredCourse: '',
  desiredShift: '',
  previousSchool: '',
  lastCompletedGrade: '',
  previousResult: '',
  guardianName: '',
  guardianRelation: '',
  guardianPhone: '',
  guardianEmail: '',
  guardianNif: '',
  fatherName: '',
  motherName: '',
  documents: emptyDocuments(),
  assessmentType: '',
  assessmentDate: '',
  assessmentTime: '',
  assessmentScore: '',
  assessmentNotes: ''
});

const formFromAdmission = (a: Admission): AdmissionForm => ({
  academicYear: a.academicYear,
  source: a.source,
  name: a.name,
  gender: a.gender,
  birthDate: a.birthDate,
  nationality: a.nationality || 'Angolana',
  birthPlace: a.birthPlace || '',
  biNumber: a.biNumber || '',
  address: a.address || '',
  phone: a.phone || '',
  email: a.email || '',
  specialNeedsNote: a.specialNeedsNote || '',
  desiredGrade: a.desiredGrade,
  desiredCourse: a.desiredCourse || '',
  desiredShift: a.desiredShift || '',
  previousSchool: a.previousSchool || '',
  lastCompletedGrade: a.lastCompletedGrade || '',
  previousResult: a.previousResult || '',
  guardianName: a.guardianName,
  guardianRelation: a.guardianRelation || '',
  guardianPhone: a.guardianPhone,
  guardianEmail: a.guardianEmail || '',
  guardianNif: a.guardianNif || '',
  fatherName: a.fatherName || '',
  motherName: a.motherName || '',
  documents: (a.documents || []).map((d) => ({ ...d })),
  assessmentType: a.assessmentType || '',
  assessmentDate: a.assessmentDate || '',
  assessmentTime: a.assessmentTime || '',
  assessmentScore: a.assessmentScore !== undefined && a.assessmentScore !== null ? String(a.assessmentScore) : '',
  assessmentNotes: a.assessmentNotes || ''
});

const clean = (v: string) => (v && v.trim() ? v.trim() : undefined);

function payloadFromForm(f: AdmissionForm) {
  const score = f.assessmentScore.trim() === '' ? undefined : Number(f.assessmentScore.replace(',', '.'));
  return {
    academicYear: f.academicYear,
    source: f.source,
    name: f.name.trim(),
    gender: f.gender,
    birthDate: f.birthDate,
    nationality: f.nationality.trim() || 'Angolana',
    birthPlace: clean(f.birthPlace),
    biNumber: clean(f.biNumber)?.toUpperCase(),
    address: clean(f.address),
    phone: clean(f.phone),
    email: clean(f.email),
    specialNeedsNote: clean(f.specialNeedsNote),
    desiredGrade: f.desiredGrade,
    desiredCourse: clean(f.desiredCourse),
    desiredShift: clean(f.desiredShift),
    previousSchool: clean(f.previousSchool),
    lastCompletedGrade: clean(f.lastCompletedGrade),
    previousResult: f.previousResult || undefined,
    guardianName: f.guardianName.trim(),
    guardianRelation: f.guardianRelation.trim(),
    guardianPhone: f.guardianPhone.trim(),
    guardianEmail: clean(f.guardianEmail),
    guardianNif: clean(f.guardianNif),
    fatherName: clean(f.fatherName),
    motherName: clean(f.motherName),
    documents: f.documents,
    assessmentType: f.assessmentType || undefined,
    assessmentDate: clean(f.assessmentDate),
    assessmentTime: clean(f.assessmentTime),
    assessmentScore: score as number | undefined,
    assessmentNotes: clean(f.assessmentNotes)
  };
}

export const AdmissoesView: React.FC<AdmissoesViewProps> = ({ db, currentUserRole, onNavigateToMatriculas }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('admissoes.manage');
  const canDecide = acl.can('admissoes.decide');
  const canCreateStudent = acl.can('alunos.create');

  const yearOptions = useMemo(
    () => institutionAcademicYears(db.settings, (db.admissions || []).map((a) => a.academicYear)),
    [db.settings, db.admissions]
  );
  const currentYear = db.settings?.currentAcademicYear || yearOptions[0];
  // Candidaturas abrem para o ano seguinte, mas só se esse ano já estiver cadastrado.
  const defaultYear = yearOptions.includes(nextAcademicYearLabel(currentYear)) ? nextAcademicYearLabel(currentYear) : currentYear;
  const gradeOptions = useMemo(() => getAvailableGrades(db.settings?.selectedSubsystems), [db.settings?.selectedSubsystems]);

  const admissions = db.admissions || [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdmissionStatus>('all');
  const [yearFilter, setYearFilter] = useState<string>(defaultYear);
  const [gradeFilter, setGradeFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Admission | null>(null);
  const [form, setForm] = useState<AdmissionForm>(emptyForm(defaultYear));
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = admissions.find((a) => a.id === viewingId) || null;

  const [statusTarget, setStatusTarget] = useState<{ admission: Admission; to: AdmissionStatus } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusAssessment, setStatusAssessment] = useState<{ type: AdmissionAssessmentType; date: string }>({
    type: 'teste',
    date: ''
  });
  const [statusError, setStatusError] = useState('');
  const [printing, setPrinting] = useState<Admission | null>(null);

  // ---- Pré-Matrícula Online (link público) --------------------------------
  const publicLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    const inst = dbService.activeInstitutionId;
    return `${base}?pre-matricula=1${inst && inst !== 'inst_bandmed' ? `&inst=${encodeURIComponent(inst)}` : ''}`;
  }, [db.settings?.institutionId]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [pendingOnlineCount, setPendingOnlineCount] = useState<number | null>(null);
  const [checkingOnline, setCheckingOnline] = useState(false);

  const refreshPendingOnlineCount = async () => {
    setPendingOnlineCount(await dbService.countPendingOnlineAdmissionRequests());
  };

  // Verifica, ao abrir a secção, se há Pré-Matrículas Online por importar.
  React.useEffect(() => {
    if (canManage) void refreshPendingOnlineCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  // ---- Reclamações dos candidatos (rejeitados ou nota 0–9) ----
  const [complaintsOpen, setComplaintsOpen] = useState(false);
  const [complaints, setComplaints] = useState<AdmissionComplaint[] | null>(null);
  const [complaintBusy, setComplaintBusy] = useState<string | null>(null);

  const loadComplaints = async () => setComplaints(await dbService.getAdmissionComplaints());
  React.useEffect(() => {
    if (canManage) void loadComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);
  const openComplaints = async () => {
    setLinkOpen(false);
    setComplaintsOpen(true);
    await loadComplaints();
  };
  const toggleComplaintResolved = async (c: AdmissionComplaint) => {
    setComplaintBusy(c.id);
    try {
      await dbService.setAdmissionComplaintResolved(c.id, !c.resolved);
      await loadComplaints();
    } finally {
      setComplaintBusy(null);
    }
  };
  const removeComplaint = async (c: AdmissionComplaint) => {
    const ok = await showAppConfirm('A reclamação será eliminada definitivamente.', { title: 'Eliminar reclamação?', variant: 'warning', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    setComplaintBusy(c.id);
    try {
      await dbService.deleteAdmissionComplaint(c.id);
      await loadComplaints();
    } finally {
      setComplaintBusy(null);
    }
  };
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answerComplaint = async (c: AdmissionComplaint) => {
    const text = (answers[c.id] ?? c.response ?? '').trim();
    setComplaintBusy(c.id);
    try {
      const r = await dbService.answerAdmissionComplaint(c.id, text);
      if (!r.success) showAppAlert(r.error || 'Não foi possível guardar a resposta.', { title: 'Resposta', variant: 'warning' });
      await loadComplaints();
    } finally {
      setComplaintBusy(null);
    }
  };
  const pendingComplaints = (complaints || []).filter((c) => !c.resolved).length;

  // ---- Modal do link: copiar, bloquear candidaturas, eliminar, estatísticas ----
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCfg, setLinkCfg] = useState<{ blocked?: boolean; deleted?: boolean; complaintsBlocked?: boolean } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');

  const openLinkModal = async () => {
    setLinkOpen(true);
    setLinkError('');
    setLinkCfg(null);
    void refreshPendingOnlineCount();
    setLinkCfg(await dbService.fetchPublicAdmissionConfig());
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      showAppAlert(publicLink, { title: 'Link da Pré-Matrícula Online', variant: 'info' });
    }
  };

  const changeLinkState = async (patch: { blocked?: boolean; deleted?: boolean; complaintsBlocked?: boolean }) => {
    setLinkBusy(true);
    setLinkError('');
    try {
      const r = await dbService.setPublicAdmissionConfig(patch);
      if (!r.success) setLinkError(r.error || 'Não foi possível guardar.');
      setLinkCfg(await dbService.fetchPublicAdmissionConfig());
    } finally {
      setLinkBusy(false);
    }
  };

  const handleDeleteLink = async () => {
    const ok = await showAppConfirm(
      'Depois de eliminar o link, ninguém consegue abrir o formulário nem a consulta. As candidaturas já recebidas não são apagadas. Pode reativar o link mais tarde.',
      { title: 'Eliminar link da Pré-Matrícula?', variant: 'warning', confirmLabel: 'Eliminar link', cancelLabel: 'Cancelar' }
    );
    if (ok) await changeLinkState({ deleted: true });
  };

  const onlineStats = useMemo(() => {
    const online = admissions.filter((a) => a.source === 'online');
    const by = (st: AdmissionStatus[]) => online.filter((a) => st.includes(a.status)).length;
    return {
      imported: online.length,
      pending: pendingOnlineCount ?? 0,
      total: online.length + (pendingOnlineCount ?? 0),
      analysis: by(['recebida', 'em_analise', 'avaliacao_agendada', 'lista_espera']),
      accepted: by(['aprovada', 'convertida']),
      rejected: by(['rejeitada', 'desistiu'])
    };
  }, [admissions, pendingOnlineCount]);

  // ---- Importação por fases (50 de cada vez) -----------------------------
  const [importState, setImportState] = useState<null | {
    running: boolean; total: number; phase: number; imported: number; duplicates: number; processed: number; errors: string[];
  }>(null);

  const handleImportOnline = async () => {
    if (!canManage || importState?.running) return;
    setCheckingOnline(true);
    try {
      const total = await dbService.countPendingOnlineAdmissionRequests();
      setPendingOnlineCount(total);
      if (total === 0) {
        showAppAlert('Não há novas Pré-Matrículas Online por importar neste momento.', { title: 'Nada a Importar', variant: 'info' });
        return;
      }
      setImportState({ running: true, total, phase: 0, imported: 0, duplicates: 0, processed: 0, errors: [] });
      try {
        const r = await dbService.importPendingOnlineAdmissionRequests((p) =>
          setImportState((st) => (st ? { ...st, phase: p.phase, imported: p.imported, duplicates: p.duplicates, processed: p.processed } : st))
        );
        setImportState((st) => (st ? { ...st, running: false, imported: r.imported, duplicates: r.duplicates, errors: r.errors } : st));
      } catch (e: any) {
        setImportState((st) => (st ? { ...st, running: false, errors: [e?.message || 'A importação foi interrompida. As candidaturas já importadas ficam guardadas; volte a importar para continuar.'] } : st));
      }
    } finally {
      setCheckingOnline(false);
      void refreshPendingOnlineCount();
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return admissions
      .filter((a) => yearFilter === 'all' || a.academicYear === yearFilter)
      .filter((a) => statusFilter === 'all' || a.status === statusFilter)
      .filter((a) => gradeFilter === 'all' || a.desiredGrade === gradeFilter)
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.code.toLowerCase().includes(q) ||
          a.guardianName.toLowerCase().includes(q) ||
          (a.biNumber || '').toLowerCase().includes(q) ||
          a.guardianPhone.includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [admissions, yearFilter, statusFilter, gradeFilter, search]);
  const { page, setPage, pageItems: visibleAdmissions } = usePagedList(filtered, [yearFilter, statusFilter, gradeFilter, search]);

  const countsInYear = useMemo(() => {
    const inYear = admissions.filter((a) => yearFilter === 'all' || a.academicYear === yearFilter);
    const map: Record<string, number> = {};
    inYear.forEach((a) => (map[a.status] = (map[a.status] || 0) + 1));
    return { total: inYear.length, map };
  }, [admissions, yearFilter]);

  // ---- operações ---------------------------------------------------------
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
    setFormOpen(true);
  };
  const openEdit = (a: Admission) => {
    setEditing(a);
    setForm(formFromAdmission(a));
    setFormErrors([]);
    setFormOpen(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = payloadFromForm(form);
    let errs: string[] = [];
    const result = await run(
      () => {
        const r = editing ? dbService.updateAdmission(editing.id, payload as any) : dbService.addAdmission(payload as any);
        if (!r.success) {
          errs = (r as any).errors?.length ? (r as any).errors : [r.error || 'Não foi possível guardar.'];
          throw new Error(errs[0]);
        }
      },
      'admissoes.manage',
      editing ? 'A guardar candidatura...' : 'A registar candidatura...',
      editing ? 'Candidatura atualizada!' : 'Candidatura registada!'
    );
    if (result.ok) setFormOpen(false);
    else setFormErrors(errs.length ? errs : [result.error || 'Não foi possível guardar.']);
  };

  const toggleDocument = async (a: Admission, key: string) => {
    const documents = a.documents.map((d) => (d.key === key ? { ...d, delivered: !d.delivered } : d));
    await run(
      () => {
        const r = dbService.updateAdmission(a.id, { documents });
        if (!r.success) throw new Error(r.error);
      },
      'admissoes.manage',
      'A atualizar documentos...',
      'Documentos atualizados.'
    );
  };

  const ruleForStatus = (to: AdmissionStatus) => (DECISION_STATUSES.includes(to) ? 'admissoes.decide' : 'admissoes.manage');

  const openStatus = (admission: Admission, to: AdmissionStatus) => {
    setStatusTarget({ admission, to });
    setStatusReason('');
    setStatusError('');
    setStatusAssessment({
      type: admission.assessmentType || 'teste',
      date: admission.assessmentDate || ''
    });
  };

  const submitStatus = async () => {
    if (!statusTarget) return;
    const { admission, to } = statusTarget;

    // Aprovar sem vagas livres é uma decisão consciente: pergunta-se ANTES de executar.
    let allowOverCapacity = false;
    if (to === 'aprovada') {
      const v = computeVacancies(db.classes || [], admissions, admission.desiredGrade, admission.academicYear, admission.id);
      if (v.classesCount > 0 && v.available <= 0) {
        const ok = await showAppConfirm(
          `Não há vagas livres em ${admission.desiredGrade} para ${admission.academicYear} (capacidade ${v.capacity}, ocupadas ${v.enrolled}, já prometidas ${v.reserved}).\n\nAprovar mesmo assim? Fica registado que a aprovação excede a capacidade.`,
          { title: 'Sem vagas livres', confirmLabel: 'Aprovar mesmo assim', cancelLabel: 'Voltar' }
        );
        if (!ok) return;
        allowOverCapacity = true;
      }
    }

    let failure = '';
    const result = await run(
      () => {
        const r = dbService.changeAdmissionStatus(admission.id, to, {
          reason: statusReason,
          allowOverCapacity,
          assessment: to === 'avaliacao_agendada' ? statusAssessment : undefined
        });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      ruleForStatus(to),
      'A atualizar estado da candidatura...',
      `Candidatura: ${ADMISSION_STATUS_META[to].label}.`
    );
    if (result.ok) setStatusTarget(null);
    else setStatusError(failure || result.error || 'Não foi possível alterar o estado.');
  };

  const convert = async (a: Admission) => {
    if (!canCreateStudent) {
      acl.guard('alunos.create', () => undefined);
      return;
    }
    const ok = await showAppConfirm(
      `Criar a ficha de aluno de ${a.name} a partir da candidatura ${a.code}? A turma, a propina e a situação financeira ficam para a Matrícula, que é o passo seguinte.`,
      { title: 'Converter em Aluno', variant: 'info', confirmLabel: 'Converter', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    let studentId = '';
    const result = await run(
      () => {
        const r = dbService.convertAdmissionToStudent(a.id);
        if (!r.success) throw new Error(r.error);
        studentId = r.student!.id;
      },
      'admissoes.manage',
      'A criar a ficha do aluno...',
      'Candidatura convertida em aluno!'
    );
    if (result.ok) {
      setViewingId(null);
      if (studentId && onNavigateToMatriculas) onNavigateToMatriculas(studentId);
    }
  };

  const remove = async (a: Admission) => {
    const ok = await showAppConfirm(`Eliminar a candidatura ${a.code} de ${a.name}? Esta ação não pode ser desfeita.`, {
      title: 'Eliminar Candidatura',
      variant: 'error',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
    const result = await run(
      () => {
        const r = dbService.deleteAdmission(a.id);
        if (!r.success) throw new Error(r.error);
      },
      'admissoes.manage',
      'A eliminar candidatura...',
      'Candidatura eliminada.'
    );
    if (result.ok) setViewingId(null);
  };

  const exportCsv = () => {
    const blob = new Blob([admissionsToCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admissoes_${yearFilter === 'all' ? 'todos' : yearFilter.replace('/', '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ---- painéis derivados do formulário ---------------------------------------
  const formVacancies = useMemo(
    () => (form.desiredGrade ? computeVacancies(db.classes || [], admissions, form.desiredGrade, form.academicYear, editing?.id) : null),
    [db.classes, admissions, form.desiredGrade, form.academicYear, editing?.id]
  );
  const formAge = ageOn(form.birthDate);
  const duplicateStudent = useMemo(
    () =>
      form.name.trim() && form.birthDate
        ? findDuplicateStudent(db.students || [], { name: form.name, birthDate: form.birthDate, biNumber: form.biNumber })
        : undefined,
    [db.students, form.name, form.birthDate, form.biNumber]
  );
  const duplicateAdmission = useMemo(
    () =>
      form.name.trim() && form.birthDate
        ? findDuplicateAdmission(admissions, { name: form.name, birthDate: form.birthDate, biNumber: form.biNumber, academicYear: form.academicYear }, editing?.id)
        : undefined,
    [admissions, form.name, form.birthDate, form.biNumber, form.academicYear, editing?.id]
  );

  const set = <K extends keyof AdmissionForm>(key: K, value: AdmissionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  // ---- render ------------------------------------------------------------
  const isConvertible = (a: Admission) => a.status === 'aprovada';

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">PRÉ-MATRÍCULAS</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            CANDIDATURAS
          </h1>
          
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {canManage && (
            <button
              onClick={openLinkModal}
              title="Abre a gestão do link de Pré-Matrícula Online: copiar, bloquear candidaturas, eliminar o link e ver estatísticas."
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">link</span>
              <span>LINK</span>
            </button>
          )}
          {canManage && (
            <button
              onClick={handleImportOnline}
              disabled={checkingOnline}
              title="Verifica e importa as Pré-Matrículas submetidas online pelos candidatos/encarregados, transformando-as em candidaturas nesta lista."
              className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              <span>IMPORTAR</span>
              {!!pendingOnlineCount && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#b91c1c] text-white text-[10px] font-black flex items-center justify-center border border-white">
                  {pendingOnlineCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0b1f3a] font-bold text-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>EXPORTAR</span>
          </button>
          {canManage && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span>CADASTRAR</span>
            </button>
          )}
        </div>
      </div>

      {/* Resumo por estado */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 no-print">
        {ADMISSION_STATUS_ORDER.map((st) => {
          const meta = ADMISSION_STATUS_META[st];
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
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] mt-1 leading-none">{countsInYear.map[st] || 0}</div>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3 no-print">
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar candidato, código, encarregado, B.I. ou telefone..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0"
          >
            <option value="all">Todos os Anos Letivos</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0"
          >
            <option value="all">Todas as Classes</option>
            {gradeOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400 font-mono">
            {filtered.length} de {countsInYear.total}
          </span>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden no-print">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Candidato</th>
                <th className="py-3.5 px-3">Classe Pretendida</th>
                <th className="py-3.5 px-3">Encarregado</th>
                <th className="py-3.5 px-3">Documentos</th>
                <th className="py-3.5 px-3">Avaliação</th>
                <th className="py-3.5 px-3">Estado</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    {admissions.length === 0
                      ? 'Ainda não há candidaturas. Clique em "NOVA CANDIDATURA" para registar a primeira.'
                      : 'Nenhuma candidatura corresponde aos filtros.'}
                  </td>
                </tr>
              ) : (
                visibleAdmissions.map((a) => {
                  const meta = ADMISSION_STATUS_META[a.status];
                  const docs = documentsProgress(a);
                  const age = ageOn(a.birthDate);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <button onClick={() => setViewingId(a.id)} className="font-bold text-[#0b1f3a] hover:underline text-left cursor-pointer">
                          {a.name}
                        </button>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {a.code}
                          {age !== null ? ` · ${age} anos` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {a.desiredGrade}
                        <div className="text-[11px] text-slate-400">{a.academicYear}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-800 font-semibold">{a.guardianName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{a.guardianPhone}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            docs.total > 0 && docs.delivered === docs.total ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {docs.delivered}/{docs.total}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {a.assessmentScore !== undefined && a.assessmentScore !== null ? (
                          <span className="font-mono font-bold">{a.assessmentScore} val.</span>
                        ) : a.assessmentDate ? (
                          <span className="text-violet-700">{fmtDate(a.assessmentDate)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${meta.badge}`}>
                          <span className="material-symbols-outlined text-[12px]">{meta.icon}</span>
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewingId(a.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer"
                            title="Ver ficha da candidatura"
                          >
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                          </button>
                          {canManage && a.status !== 'convertida' && (
                            <button
                              onClick={() => openEdit(a)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer"
                              title="Editar candidatura"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                          )}
                          {canManage && isConvertible(a) && (
                            <button
                              onClick={() => convert(a)}
                              className="px-2.5 h-7 rounded-lg bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-[11px] cursor-pointer"
                              title="Criar a ficha de aluno"
                            >
                              Converter
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
          <TablePagination total={filtered.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {/* ---------------- Modal: formulário ---------------- */}
      {formOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 no-print"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFormOpen(false);
          }}
        >
          <form onSubmit={submitForm} className="bg-white max-w-4xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={editing ? `Editar Candidatura ${editing.code}` : 'Nova Candidatura'}
              subtitle="Pré-matrícula · ainda não cria o aluno"
              icon="how_to_reg"
              onClose={() => setFormOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {formErrors.length > 0 && (
                <Notice tone="error">
                  {formErrors.map((e) => (
                    <div key={e}>• {e}</div>
                  ))}
                </Notice>
              )}
              {duplicateStudent && (
                <Notice tone="warn">
                  <strong>{duplicateStudent.name}</strong> já está cadastrado(a) como aluno (nº {duplicateStudent.procNumber}). Para um
                  aluno da escola use "Matrículas".
                </Notice>
              )}
              {duplicateAdmission && (
                <Notice tone="warn">
                  Já existe a candidatura <strong>{duplicateAdmission.code}</strong> (
                  {ADMISSION_STATUS_META[duplicateAdmission.status].label}) para este candidato neste ano letivo.
                </Notice>
              )}

              <section className="space-y-3">
                <SectionTitle icon="school">Vaga pretendida</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className={labelCls}>Ano letivo *</label>
                    <select value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)} className={inputCls}>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Classe pretendida *</label>
                    <select value={form.desiredGrade} onChange={(e) => set('desiredGrade', e.target.value)} className={inputCls}>
                      <option value="">Selecione...</option>
                      {gradeOptions.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Curso / Área</label>
                    <input value={form.desiredCourse} onChange={(e) => set('desiredCourse', e.target.value)} className={inputCls} list="adm-cursos-escola" />
                    <datalist id="adm-cursos-escola">
                      {(db.courses || []).filter((c) => c.status !== 'inativo').map((c) => (
                        <option key={c.id} value={c.name} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className={labelCls}>Turno</label>
                    <select value={form.desiredShift} onChange={(e) => set('desiredShift', e.target.value)} className={inputCls}>
                      <option value="">Sem preferência</option>
                      {SHIFTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {formVacancies && (
                  <div
                    className={`p-3 border text-[11px] ${
                      formVacancies.classesCount === 0
                        ? 'bg-slate-50 border-slate-200 text-slate-600'
                        : formVacancies.available > 0
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    {formVacancies.classesCount === 0 ? (
                      <>Ainda não há turmas de {form.desiredGrade} criadas para {form.academicYear}. As vagas serão decididas pela Direção.</>
                    ) : (
                      <>
                        <strong>{formVacancies.available}</strong> vaga(s) disponível(eis) em {form.desiredGrade} — {formVacancies.classesCount}{' '}
                        turma(s), capacidade {formVacancies.capacity}, {formVacancies.enrolled} aluno(s), {formVacancies.reserved} já
                        prometida(s) a candidaturas aprovadas.
                      </>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <SectionTitle icon="person">Candidato</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome completo *</label>
                    <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Género *</label>
                    <select value={form.gender} onChange={(e) => set('gender', e.target.value as any)} className={inputCls}>
                      <option value="Masculino">Masculino</option>
                      <option value="Feminino">Feminino</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Data de nascimento *</label>
                    <input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} className={inputCls} />
                    {formAge !== null && formAge >= 0 && <span className="text-[11px] text-slate-500">{formAge} anos</span>}
                  </div>
                  <div>
                    <label className={labelCls}>Nacionalidade</label>
                    <input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Naturalidade</label>
                    <input value={form.birthPlace} onChange={(e) => set('birthPlace', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>B.I. / Cédula</label>
                    <input value={form.biNumber} onChange={(e) => set('biNumber', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone</label>
                    <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>E-mail</label>
                    <input value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Morada</label>
                    <input value={form.address} onChange={(e) => set('address', e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={labelCls}>Necessidades educativas especiais / saúde (se aplicável)</label>
                    <input value={form.specialNeedsNote} onChange={(e) => set('specialNeedsNote', e.target.value)} className={inputCls} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="history_edu">Proveniência escolar</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Escola de proveniência</label>
                    <input value={form.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Última classe concluída</label>
                    <input value={form.lastCompletedGrade} onChange={(e) => set('lastCompletedGrade', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Resultado</label>
                    <select value={form.previousResult} onChange={(e) => set('previousResult', e.target.value as any)} className={inputCls}>
                      <option value="">—</option>
                      {RESULTS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="family_restroom">Encarregado de Educação</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome completo *</label>
                    <input value={form.guardianName} onChange={(e) => set('guardianName', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Parentesco</label>
                    <input
                      value={form.guardianRelation}
                      onChange={(e) => set('guardianRelation', e.target.value)}
                      className={inputCls}
                      placeholder="Pai, Mãe, Tio..."
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Telefone *</label>
                    <input value={form.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>E-mail</label>
                    <input value={form.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>NIF</label>
                    <input value={form.guardianNif} onChange={(e) => set('guardianNif', e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-1">
                    <label className={labelCls}>Nome do pai</label>
                    <input value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome da mãe</label>
                    <input value={form.motherName} onChange={(e) => set('motherName', e.target.value)} className={inputCls} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="folder_open">Documentos entregues</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {form.documents.map((d) => (
                    <label key={d.key} className="flex items-center gap-2 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={d.delivered}
                        onChange={() => set('documents', form.documents.map((x) => (x.key === d.key ? { ...x, delivered: !x.delivered } : x)))}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <SectionTitle icon="fact_check">Avaliação de admissão (opcional)</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className={labelCls}>Tipo</label>
                    <select value={form.assessmentType} onChange={(e) => set('assessmentType', e.target.value as any)} className={inputCls}>
                      <option value="">Sem avaliação</option>
                      {Object.entries(ADMISSION_ASSESSMENT_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Data</label>
                    <input type="date" value={form.assessmentDate} onChange={(e) => set('assessmentDate', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Hora</label>
                    <input type="time" value={form.assessmentTime} onChange={(e) => set('assessmentTime', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Nota (0–20)</label>
                    <input
                      inputMode="decimal"
                      value={form.assessmentScore}
                      onChange={(e) => set('assessmentScore', e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className={labelCls}>Observações da avaliação</label>
                    <textarea value={form.assessmentNotes} onChange={(e) => set('assessmentNotes', e.target.value)} rows={2} className={areaCls} />
                  </div>
                </div>
              </section>

              <section>
                <label className={labelCls}>Como chegou à escola</label>
                <select value={form.source} onChange={(e) => set('source', e.target.value as AdmissionSource)} className={`${inputCls} sm:w-72`}>
                  {Object.entries(ADMISSION_SOURCE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </section>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                Cancelar
              </button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
                {editing ? 'Guardar Alterações' : 'Registar Candidatura'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: ficha da candidatura ---------------- */}
      {viewing && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 no-print"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewingId(null);
          }}
        >
          <div className="bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={viewing.name}
              subtitle={`${viewing.code} · ${viewing.desiredGrade} · ${viewing.academicYear}`}
              icon="how_to_reg"
              badge={ADMISSION_STATUS_META[viewing.status].label}
              onClose={() => setViewingId(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                {(
                  [
                    ['Data de nascimento', `${fmtDate(viewing.birthDate)}${ageOn(viewing.birthDate) !== null ? ` (${ageOn(viewing.birthDate)} anos)` : ''}`],
                    ['Género', viewing.gender],
                    ['Nacionalidade', viewing.nationality],
                    ['B.I. / Cédula', viewing.biNumber],
                    ['Telefone', viewing.phone],
                    ['E-mail', viewing.email],
                    ['Escola de proveniência', viewing.previousSchool],
                    ['Última classe', viewing.lastCompletedGrade],
                    ['Resultado', viewing.previousResult],
                    ['Encarregado', `${viewing.guardianName}${viewing.guardianRelation ? ' (' + viewing.guardianRelation + ')' : ''}`],
                    ['Telefone do Encarregado', viewing.guardianPhone],
                    ['E-mail do Encarregado', viewing.guardianEmail],
                    ['Origem', ADMISSION_SOURCE_LABELS[viewing.source]],
                    ['Registada em', fmtDateTime(viewing.createdAt)],
                    ['Registada por', viewing.createdBy]
                  ] as [string, string | undefined][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                    <div className="text-slate-800 font-semibold break-words">{value || '—'}</div>
                  </div>
                ))}
              </div>
              {viewing.specialNeedsNote && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900">
                  <strong>Necessidades especiais / saúde:</strong>
                  <p className="mt-1 whitespace-pre-wrap break-words">{viewing.specialNeedsNote}</p>
                </div>
              )}

              {(viewing.assessmentType || viewing.assessmentDate || viewing.assessmentScore !== undefined) && (
                <div className="p-3 bg-violet-50 border border-violet-200 text-violet-900">
                  <strong>Avaliação:</strong> {viewing.assessmentType ? ADMISSION_ASSESSMENT_LABELS[viewing.assessmentType] : 'Avaliação'}
                  {viewing.assessmentDate && ` · ${fmtDate(viewing.assessmentDate)}${viewing.assessmentTime ? ' às ' + viewing.assessmentTime : ''}`}
                  {viewing.assessmentScore !== undefined && viewing.assessmentScore !== null && ` · nota ${viewing.assessmentScore}/20`}
                  {viewing.assessmentNotes && <p className="mt-1 whitespace-pre-wrap break-words">{viewing.assessmentNotes}</p>}
                </div>
              )}

              {viewing.decidedAt && (
                <div className="p-3 bg-slate-50 border border-slate-200 text-slate-700">
                  <strong>Decisão:</strong> {ADMISSION_STATUS_META[viewing.status].label} por {viewing.decidedBy} em {fmtDateTime(viewing.decidedAt)}
                  {viewing.decisionNotes && <p className="mt-1 whitespace-pre-wrap break-words">Motivo: {viewing.decisionNotes}</p>}
                </div>
              )}

              <div>
                <SectionTitle icon="folder_open">
                  Documentos ({documentsProgress(viewing).delivered}/{documentsProgress(viewing).total})
                </SectionTitle>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {viewing.documents.map((d) => (
                    <li key={d.key}>
                      <label className={`flex items-center gap-2 ${canManage && viewing.status !== 'convertida' ? 'cursor-pointer' : ''}`}>
                        <input
                          type="checkbox"
                          checked={d.delivered}
                          disabled={!canManage || viewing.status === 'convertida'}
                          onChange={() => toggleDocument(viewing, d.key)}
                        />
                        <span className={d.delivered ? 'text-slate-800' : 'text-amber-800 font-semibold'}>{d.label}</span>
                      </label>
                      {d.attachment && (
                        <div className="ml-6 mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span className="material-symbols-outlined text-[14px] text-[#0b1f3a]">
                            {d.attachment.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}
                          </span>
                          <span className="min-w-0 break-all">{d.attachment.fileName}</span>
                          {d.attachment.dataUrl ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openAttachment(d.attachment!)}
                                data-tone="primary"
                                className="px-2 py-0.5 text-white text-[11px] font-bold cursor-pointer"
                              >
                                Ver
                              </button>
                              <button
                                type="button"
                                onClick={() => openAttachment(d.attachment!, true)}
                                data-tone="primary"
                                className="px-2 py-0.5 text-white text-[11px] font-bold cursor-pointer"
                              >
                                Descarregar
                              </button>
                            </>
                          ) : (
                            <span className="text-amber-700">Pré-visualização indisponível neste dispositivo (sincronize).</span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <SectionTitle icon="timeline">Histórico</SectionTitle>
                <ol className="mt-2 space-y-1.5">
                  {[...(viewing.history || [])].reverse().map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-slate-400 font-mono shrink-0">{fmtDateTime(h.at)}</span>
                      <span className="text-slate-700">
                        {h.text} <span className="text-slate-400">— {h.by}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {viewing.studentId && (
                <div className="p-3 bg-[#0b1f3a] text-white flex flex-wrap items-center justify-between gap-2">
                  <span>Convertida em aluno em {fmtDateTime(viewing.convertedAt)} por {viewing.convertedBy}.</span>
                  {onNavigateToMatriculas && (
                    <button
                      onClick={() => onNavigateToMatriculas(viewing.studentId!)}
                      className="px-3 h-7 bg-white text-[#0b1f3a] font-bold cursor-pointer"
                    >
                      Ir para Matrícula
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {allowedTransitions(viewing.status)
                  .filter((to) => to !== 'convertida')
                  .map((to) => {
                    const allowed = acl.can(ruleForStatus(to));
                    return (
                      <button
                        key={to}
                        disabled={!allowed}
                        title={allowed ? undefined : acl.denyMessage(ruleForStatus(to))}
                        onClick={() => openStatus(viewing, to)}
                        data-tone={to === 'aprovada' ? 'success' : to === 'rejeitada' || to === 'desistiu' ? 'danger' : 'primary'}
                        className="px-3 h-8 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-white"
                      >
                        {ADMISSION_STATUS_META[to].label}
                      </button>
                    );
                  })}
                {canManage && isConvertible(viewing) && (
                  <button onClick={() => convert(viewing)} className="px-3 h-8 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white text-[11px] font-bold cursor-pointer">
                    Converter em Aluno
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setPrinting(viewing)}
                  data-tone="primary"
                  className="flex items-center gap-1 px-3 h-8 text-white text-[11px] font-bold cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">print</span>Comprovativo
                </button>
                <button
                  onClick={() => setViewingId(null)}
                  data-tone="grey"
                  className="px-3 h-8 text-white text-[11px] font-bold cursor-pointer"
                >
                  Fechar
                </button>
                {canManage && viewing.status !== 'convertida' && (
                  <>
                    <button onClick={() => remove(viewing)} data-tone="danger" className="px-3 h-8 text-white text-[11px] font-bold cursor-pointer">
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Modal: mudar estado ---------------- */}
      {statusTarget && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-3 sm:p-6 no-print"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStatusTarget(null);
          }}
        >
          <div className="bg-white max-w-md w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={`${ADMISSION_STATUS_META[statusTarget.admission.status].label} → ${ADMISSION_STATUS_META[statusTarget.to].label}`}
              subtitle={`${statusTarget.admission.name} · ${statusTarget.admission.code}`}
              icon={ADMISSION_STATUS_META[statusTarget.to].icon}
              onClose={() => setStatusTarget(null)}
            />
            <div className="p-6 space-y-4 text-xs overflow-y-auto">
              {statusError && <Notice tone="error">{statusError}</Notice>}
              {statusTarget.to === 'avaliacao_agendada' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Tipo *</label>
                    <select
                      value={statusAssessment.type}
                      onChange={(e) => setStatusAssessment({ ...statusAssessment, type: e.target.value as AdmissionAssessmentType })}
                      className={inputCls}
                    >
                      {Object.entries(ADMISSION_ASSESSMENT_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Data *</label>
                    <input
                      type="date"
                      value={statusAssessment.date}
                      onChange={(e) => setStatusAssessment({ ...statusAssessment, date: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
              {DECISION_STATUSES.includes(statusTarget.to) && (
                <div className="p-3 bg-slate-50 border border-slate-200 text-slate-600">
                  Esta decisão fica registada com o seu nome, a data e o motivo.
                </div>
              )}
              <div>
                <label className={labelCls}>
                  {statusTarget.to === 'rejeitada' ? 'Motivo da rejeição *' : 'Observações (opcional)'}
                </label>
                <textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} rows={3} className={areaCls} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button onClick={() => setStatusTarget(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                Cancelar
              </button>
              <button onClick={submitStatus} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Reclamações dos candidatos ---------------- */}
      {complaintsOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-3 sm:p-4 no-print" onClick={(e) => { if (e.target === e.currentTarget) setComplaintsOpen(false); }}>
          <div className="bg-white max-w-2xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title="Reclamações dos candidatos" subtitle="Candidatos rejeitados ou com nota de 0 a 9" icon="report" onClose={() => setComplaintsOpen(false)} />
            <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
              {complaints === null ? (
                <p className="text-slate-400 text-center py-8">A carregar…</p>
              ) : complaints.length === 0 ? (
                <p className="text-slate-400 text-center py-8">Ainda não há reclamações.</p>
              ) : (
                complaints.map((c) => (
                  <div key={c.id} className={`border p-4 space-y-2 ${c.resolved ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-[#0b1f3a] text-sm break-words">{c.candidateName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{c.code || c.ref}{c.academicYear ? ` · ${c.academicYear}` : ''}</div>
                      </div>
                      <span className={`px-2 py-0.5 font-bold text-[10px] uppercase ${c.resolved ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{c.resolved ? 'Resolvida' : 'Pendente'}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                      {c.status && <span>Estado: <b>{ADMISSION_STATUS_META[c.status as AdmissionStatus]?.label || c.status}</b></span>}
                      {typeof c.assessmentScore === 'number' && <span>Nota: <b>{c.assessmentScore}/20</b></span>}
                      {c.contactPhone && <span>Contacto: <b>{c.contactPhone}</b></span>}
                      <span>Enviada em: <b>{fmtDateTime(c.submittedAt)}</b></span>
                    </div>
                    <div><span className="font-bold uppercase text-[10px] text-slate-500">Motivo</span><div className="font-semibold text-slate-800">{c.reason}</div></div>
                    <div><span className="font-bold uppercase text-[10px] text-slate-500">Descrição</span><p className="whitespace-pre-wrap break-words text-slate-700">{c.description}</p></div>
                    <div>
                      <span className="font-bold uppercase text-[10px] text-slate-500">Resposta ao candidato</span>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={answers[c.id] ?? c.response ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
                        placeholder="Escreva a resposta que o candidato verá na Consulta…"
                        className="w-full mt-1 px-3 py-2 bg-white border border-slate-300 text-xs focus:outline-none focus:border-[#0b1f3a]"
                      />
                      {c.respondedAt && <div className="text-[10px] text-slate-400">Respondida por {c.respondedBy || '—'} em {fmtDateTime(c.respondedAt)}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button disabled={complaintBusy === c.id || !(answers[c.id] ?? c.response ?? '').trim()} onClick={() => answerComplaint(c)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold cursor-pointer">
                        {c.response ? 'Atualizar resposta' : 'Enviar resposta'}
                      </button>
                      <button disabled={complaintBusy === c.id} onClick={() => toggleComplaintResolved(c)} className="px-3 py-1.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 text-white font-bold cursor-pointer">
                        {c.resolved ? 'Reabrir' : 'Marcar como resolvida'}
                      </button>
                      <button disabled={complaintBusy === c.id} onClick={() => removeComplaint(c)} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-[#7a0c0c] font-bold cursor-pointer disabled:opacity-40">Eliminar</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex justify-end">
              <button onClick={() => setComplaintsOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Link da Pré-Matrícula Online ---------------- */}
      {linkOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-3 sm:p-4 no-print" onClick={(e) => { if (e.target === e.currentTarget) setLinkOpen(false); }}>
          <div className="bg-white max-w-xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title="Gestão do Link " subtitle="Partilhe, libere, bloqueie ou elimine o acesso dos candidatos" icon="link" onClose={() => setLinkOpen(false)} />
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold uppercase text-[11px] text-slate-600">Link para os candidatos</span>
                  {linkCfg === null ? null : linkCfg.deleted ? (
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-bold text-[10px] uppercase">Eliminado</span>
                  ) : linkCfg.blocked ? (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] uppercase">Candidaturas bloqueadas</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">Ativo</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input readOnly value={publicLink} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 h-10 px-3 bg-slate-50 border border-slate-300 text-slate-700 font-mono text-[11px]" />
                  <button onClick={handleCopyLink} className="flex items-center gap-1.5 px-4 h-10 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer shrink-0">
                    <span className="material-symbols-outlined text-[16px]">{copiedLink ? 'check' : 'content_copy'}</span>
                    {copiedLink ? 'Copiado!' : 'Copiar link'}
                  </button>
                </div>
                
              </div>

              <div>
                <div className="font-bold uppercase text-[11px] text-slate-600 mb-2">Estatísticas das candidaturas online</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['Total de inscritos', onlineStats.total, 'text-[#0b1f3a]'],
                    ['Por importar', onlineStats.pending, onlineStats.pending > 0 ? 'text-[#b91c1c]' : 'text-slate-500'],
                    ['Importados', onlineStats.imported, 'text-[#0b1f3a]'],
                    ['Em análise / espera', onlineStats.analysis, 'text-blue-700'],
                    ['Aceites', onlineStats.accepted, 'text-emerald-700'],
                    ['Rejeitados / desistências', onlineStats.rejected, 'text-red-700']
                  ] as [string, number, string][]).map(([k, v, c]) => (
                    <div key={k} className="border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase text-slate-400 leading-tight">{k}</div>
                      <div className={`text-xl font-black mt-1 ${c}`}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-[11px] text-slate-600"> Caixa de Reclamações dos candidatos</span>
                  {linkCfg === null ? null : linkCfg.complaintsBlocked ? (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] uppercase">Bloqueadas</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">Liberadas</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={linkBusy || linkCfg === null || !linkCfg?.complaintsBlocked} onClick={() => changeLinkState({ complaintsBlocked: false })} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">lock_open</span>
                    Liberar
                  </button>
                  <button disabled={linkBusy || linkCfg === null || !!linkCfg?.complaintsBlocked} onClick={() => changeLinkState({ complaintsBlocked: true })} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">lock</span>
                    Bloquear
                  </button>
                </div>
                
                <button onClick={openComplaints} className="relative w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-xs cursor-pointer">
                  <span className="material-symbols-outlined text-[18px]">report</span>
                  Ver e responder às reclamações
                  {pendingComplaints > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#b91c1c] text-white text-[10px] font-black flex items-center justify-center">{pendingComplaints}</span>}
                </button>
              </div>

              {linkError && <Notice tone="error">{linkError}</Notice>}

              <div className="border-t border-slate-200 pt-4 space-y-2">
                {linkCfg?.deleted ? (
                  <button disabled={linkBusy} onClick={() => changeLinkState({ deleted: false, blocked: false })} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 text-white font-bold text-xs cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                    Reativar link
                  </button>
                ) : (
                  <>
				  <span className="font-bold uppercase text-[11px] text-slate-600">Restrição do Link dos candidatos</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button disabled={linkBusy || linkCfg === null || !linkCfg?.blocked} onClick={() => changeLinkState({ blocked: false })} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer">
                        <span className="material-symbols-outlined text-[18px]">lock_open</span>
                        Liberar
                      </button>
                      <button disabled={linkBusy || linkCfg === null || !!linkCfg?.blocked} onClick={() => changeLinkState({ blocked: true })} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer">
                        <span className="material-symbols-outlined text-[18px]">lock</span>
                        Bloquear
                      </button>
                    </div>
                   
                    <button disabled={linkBusy || linkCfg === null} onClick={handleDeleteLink} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 disabled:opacity-40 text-[#7a0c0c] border border-red-200 font-bold text-xs cursor-pointer">
                      <span className="material-symbols-outlined text-[18px]">link_off</span>
                      Eliminar
                    </button>
                    
                  </>
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex justify-end">
              <button onClick={() => setLinkOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Importação por fases ---------------- */}
      {importState && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-3 sm:p-4 no-print">
          <div className="bg-white max-w-md w-full shadow-2xl border border-slate-400 flex flex-col">
            <FormModalHeader title="Importar Pré-Matrículas Online" subtitle="As candidaturas entram na área de Admissão, 50 de cada vez" icon="sync" onClose={() => { if (!importState.running) setImportState(null); }} />
            <div className="p-6 space-y-4 text-xs">
              {(() => {
                const pct = importState.total > 0 ? Math.min(100, Math.round((importState.processed / importState.total) * 100)) : 0;
                const phases = Math.max(1, Math.ceil(importState.total / 50));
                return (
                  <>
                    <div className="flex items-center justify-between font-bold text-[#0b1f3a]">
                      <span>{importState.running ? `A importar a fase ${Math.min(importState.phase + 1, phases)} de ${phases}…` : importState.errors.length > 0 ? 'Importação terminada com avisos' : 'Importação concluída'}</span>
                      <span>{importState.running ? pct : 100}%</span>
                    </div>
                    <div className="h-3 bg-slate-200 overflow-hidden"><div className={`h-full transition-all ${importState.running ? 'bg-[#0b1f3a]' : importState.errors.length ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${importState.running ? pct : 100}%` }} /></div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] font-bold uppercase text-slate-400">Importadas</div><div className="text-lg font-black text-emerald-700">{importState.imported}</div></div>
                      <div className="border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] font-bold uppercase text-slate-400">Duplicadas</div><div className="text-lg font-black text-amber-700">{importState.duplicates}</div></div>
                      <div className="border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] font-bold uppercase text-slate-400">Total</div><div className="text-lg font-black text-[#0b1f3a]">{importState.total}</div></div>
                    </div>
                    {importState.errors.length > 0 && (
                      <ul className="max-h-32 overflow-y-auto p-2 bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                        {importState.errors.map((er, i) => <li key={i}>• {er}</li>)}
                      </ul>
                    )}
                    {importState.running && <p className="text-[11px] text-slate-500">Não feche esta janela até terminar.</p>}
                  </>
                );
              })()}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex justify-end">
              <button disabled={importState.running} onClick={() => setImportState(null)} className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 text-white font-bold text-xs cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Comprovativo imprimível ---------------- */}
      {printing && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-start justify-center p-3 sm:p-4 printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block">
          <div className="printable-document printable-portrait bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col my-4 print:my-0 print:border-none print:shadow-none">
            <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between no-print">
              <span className="font-bold text-sm">Comprovativo de Pré-Matrícula</span>
              <button onClick={() => setPrinting(null)} className="text-slate-300 hover:text-white cursor-pointer" title="Fechar">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-8 space-y-4 text-slate-800 text-xs">
              <div className="border-b-2 border-[#0b1f3a] pb-3 flex items-center gap-3 print-break-avoid">
                <div className="w-12 h-12 border border-slate-300 p-0.5 flex items-center justify-center shrink-0">
                  <img src={db.settings?.logoUrl || '/school_emblem.png'} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                </div>
                <div>
                  <h1 className="text-base font-black tracking-wide text-[#0b1f3a] uppercase">{db.settings?.schoolName}</h1>
                  <p className="text-[11px] text-slate-500">
                    {db.settings?.subTitle || `NIF: ${db.settings?.nif || '—'} • ${db.settings?.province || ''}, Angola`}
                  </p>
                </div>
              </div>
              <div className="flex items-end justify-between print-break-avoid">
                <div>
                  <div className="text-[10px] font-bold text-sky-800 tracking-wider uppercase">Ano Letivo {printing.academicYear}</div>
                  <h2 className="text-base font-black tracking-tight uppercase">Comprovativo de Pré-Matrícula</h2>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Código</div>
                  <div className="font-mono font-black text-base text-[#0b1f3a]">{printing.code}</div>
                </div>
              </div>

              <table className="w-full border border-slate-300 print-break-avoid">
                <tbody>
                  {(
                    [
                      ['Candidato', printing.name],
                      ['Data de nascimento', fmtDate(printing.birthDate)],
                      ['Classe pretendida', `${printing.desiredGrade}${printing.desiredCourse ? ' · ' + printing.desiredCourse : ''}`],
                      ['Escola de proveniência', printing.previousSchool || '—'],
                      ['Encarregado de Educação', `${printing.guardianName}${printing.guardianRelation ? ' (' + printing.guardianRelation + ')' : ''}`],
                      ['Contacto do Encarregado', printing.guardianPhone],
                      [
                        'Avaliação de admissão',
                        printing.assessmentDate
                          ? `${printing.assessmentType ? ADMISSION_ASSESSMENT_LABELS[printing.assessmentType] : 'Avaliação'} em ${fmtDate(printing.assessmentDate)}${printing.assessmentTime ? ' às ' + printing.assessmentTime : ''}`
                          : 'A informar pela Secretaria'
                      ],
                      ['Estado da candidatura', ADMISSION_STATUS_META[printing.status].label]
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <tr key={k} className="border-b border-slate-200">
                      <td className="py-1.5 px-3 bg-slate-50 font-bold uppercase text-[10px] text-slate-600 w-1/3">{k}</td>
                      <td className="py-1.5 px-3 font-semibold">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="print-break-avoid">
                <div className="font-bold uppercase text-[11px] text-[#0b1f3a] mb-1">Documentos</div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                  {printing.documents.map((d) => (
                    <li key={d.key} className="flex items-center gap-1.5">
                      <span>{d.delivered ? '☑' : '☐'}</span>
                      <span>{d.label}</span>
                    </li>
                  ))}
                </ul>
                {pendingDocuments(printing).length > 0 && (
                  <p className="mt-2 p-2 border border-amber-300 bg-amber-50 text-amber-900">
                    <strong>Em falta:</strong> {pendingDocuments(printing).map((d) => d.label).join('; ')}.
                  </p>
                )}
              </div>

              <p className="text-[11px] text-slate-600 border-t border-slate-200 pt-3">
                Este comprovativo atesta a receção da candidatura. <strong>Não garante a atribuição de vaga</strong>: a matrícula só se
                considera efetuada após a aprovação da candidatura e a formalização da Matrícula na Secretaria.
              </p>

              <div className="grid grid-cols-2 gap-10 pt-8 print-break-avoid">
                <div className="text-center">
                  <div className="border-t border-slate-500 pt-1 text-[10px] uppercase font-bold text-slate-600">A Secretaria</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Emitido em {new Date().toLocaleDateString('pt-PT')}</div>
                </div>
                <div className="text-center">
                  <div className="border-t border-slate-500 pt-1 text-[10px] uppercase font-bold text-slate-600">O Encarregado de Educação</div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3 no-print">
              <button
                onClick={() => {
                  window.focus();
                  window.print();
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                Imprimir
              </button>
              <button onClick={() => setPrinting(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
