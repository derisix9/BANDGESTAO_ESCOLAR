import React, { useMemo, useState } from 'react';
import {
  BloodType,
  DisciplinaryIncident,
  DisciplinaryMeasureType,
  IncidentCategory,
  IncidentParticipantRole,
  IncidentSeverity,
  MedicalAllergy,
  MedicalOccurrenceType,
  PickupAuthorization,
  PickupAuthorizationKind,
  PickupPersonRelation,
  PickupReason,
  PickupRecord,
  SchoolDatabase,
  Student,
  StudentMedicalRecord,
  UserRole,
  VaccinationStatus
} from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  ALLERGY_SEVERITY_META,
  BLOOD_TYPES,
  BLOOD_TYPE_LABELS,
  DISCIPLINARY_MEASURE_LABELS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_META,
  INCIDENT_STATUS_META,
  MEDICAL_OCCURRENCE_TYPE_LABELS,
  PICKUP_AUTH_KIND_META,
  PICKUP_AUTH_STATUS_META,
  PICKUP_REASON_LABELS,
  PICKUP_RELATION_LABELS,
  VACCINATION_STATUS_LABELS,
  activeAuthorizationsForStudent,
  hasSevereAllergy
} from '../utils/healthSafety';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

export type SaudeSegurancaSection = 'saude_ficha_medica' | 'saude_incidentes' | 'saude_recolha';

interface SaudeSegurancaViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  section?: SaudeSegurancaSection;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const textareaCls =
  'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';
const checkboxRowCls = 'flex items-center gap-2 text-xs text-slate-700 font-semibold';

const todayIso = () => new Date().toISOString().slice(0, 10);
const nowHm = () => new Date().toTimeString().slice(0, 5);
const fmtDate = (iso?: string) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-PT') : '—');
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-PT') : '—');

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${tone}`}>{children}</span>;
}

function SectionHeader({
  subsection,
  title,
  description,
  actions
}: {
  subsection: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SAÚDE & SEGURANÇA</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">{subsection}</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">{title}</h1>
        <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

function KpiGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon: string; tone?: 'default' | 'warn' | 'danger' }> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((k) => {
        const tone =
          k.tone === 'danger' ? 'bg-red-50 text-red-700' : k.tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-[#0b1f3a]';
        return (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${tone}`}>
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder,
  children
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
      <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:border-slate-400/70 focus-within:bg-white transition-colors">
        <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none focus:ring-0 text-xs text-slate-800 placeholder:text-slate-400"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">{children}</div>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  icon,
  badge,
  onClose,
  widthCls = 'max-w-2xl',
  children
}: {
  title: string;
  subtitle?: string;
  icon: string;
  badge?: string;
  onClose: () => void;
  widthCls?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-white ${widthCls} w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]`}>
        <FormModalHeader title={title} subtitle={subtitle} icon={icon} badge={badge} onClose={onClose} />
        {children}
      </div>
    </div>
  );
}

function FormFooter({ error, onCancel, submitLabel, submitIcon = 'save' }: { error?: string; onCancel: () => void; submitLabel: string; submitIcon?: string }) {
  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-200">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
          Cancelar
        </button>
        <button type="submit" className="px-5 py-2.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
          <span className="material-symbols-outlined text-[16px]">{submitIcon}</span>
          <span>{submitLabel}</span>
        </button>
      </div>
    </>
  );
}

function DeleteModal({ title, name, code, extra, onCancel, onConfirm }: { title: string; name: string; code: string; extra?: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
        <FormModalHeader title={title} icon="warning" onClose={onCancel} />
        <div className="p-6">
          <h3 className="font-headline text-lg font-bold text-slate-900 text-center">Eliminar "{name}"?</h3>
          <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
            O registo <span className="font-mono font-bold">{code}</span> será removido da base de dados. {extra}
          </p>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} className="px-5 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors border-none">
            <span className="material-symbols-outlined text-[16px]">delete</span>
            <span>Eliminar</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 1. FICHA MÉDICA DO ALUNO
// =============================================================================

interface AllergyRow extends MedicalAllergy {}
interface ConditionRow {
  name: string;
  notes?: string;
}
interface MedicationRow {
  name: string;
  dosage?: string;
  schedule?: string;
  administeredAtSchool: boolean;
}
interface ContactRow {
  name: string;
  relation: string;
  phone: string;
}

interface MedicalForm {
  studentId: string;
  bloodType: BloodType;
  allergies: AllergyRow[];
  conditions: ConditionRow[];
  medications: MedicationRow[];
  vaccinationStatus: VaccinationStatus;
  vaccinationNotes: string;
  emergencyContacts: ContactRow[];
  physicianName: string;
  physicianPhone: string;
  preferredHealthUnit: string;
  healthInsurance: string;
  healthInsurancePolicy: string;
  emergencyTreatmentConsent: boolean;
  consentGivenBy: string;
  notes: string;
}

const emptyMedicalForm = (): MedicalForm => ({
  studentId: '',
  bloodType: 'desconhecido',
  allergies: [],
  conditions: [],
  medications: [],
  vaccinationStatus: 'desconhecido',
  vaccinationNotes: '',
  emergencyContacts: [{ name: '', relation: '', phone: '' }],
  physicianName: '',
  physicianPhone: '',
  preferredHealthUnit: '',
  healthInsurance: '',
  healthInsurancePolicy: '',
  emergencyTreatmentConsent: false,
  consentGivenBy: '',
  notes: ''
});

function FichaMedicaSection({ db, currentUserRole }: { db: SchoolDatabase; currentUserRole: UserRole }) {
  const acl = useAccessControl(currentUserRole);
  const canView = acl.can('saude.ficha_medica.view') || acl.can('saude.ficha_medica.manage');
  const canManage = acl.can('saude.ficha_medica.manage');

  const students = db.students || [];
  const records = db.medicalRecords || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MedicalForm>(emptyMedicalForm());
  const [formError, setFormError] = useState('');
  const [viewing, setViewing] = useState<StudentMedicalRecord | null>(null);
  const [deleting, setDeleting] = useState<StudentMedicalRecord | null>(null);

  const [occDate, setOccDate] = useState(todayIso());
  const [occTime, setOccTime] = useState(nowHm());
  const [occType, setOccType] = useState<MedicalOccurrenceType>('doenca');
  const [occDescription, setOccDescription] = useState('');
  const [occAction, setOccAction] = useState('');
  const [occGuardianNotified, setOccGuardianNotified] = useState(false);
  const [occReferred, setOccReferred] = useState(false);
  const [occError, setOccError] = useState('');

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const recordByStudentId = useMemo(() => new Map(records.map((r) => [r.studentId, r])), [records]);

  const studentOptionsForNew = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active' && !recordByStudentId.has(s.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: s.name, sublabel: `Nº ${s.procNumber}${s.className ? ' · ' + s.className : ''}` })),
    [students, recordByStudentId]
  );

  const q = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      records
        .filter(
          (r) =>
            !q ||
            r.studentName.toLowerCase().includes(q) ||
            r.studentProcNumber.toLowerCase().includes(q) ||
            (r.className || '').toLowerCase().includes(q)
        )
        .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt')),
    [records, q]
  );
  const { page: pgFiltered, setPage: setPgFiltered, pageItems: visibleFiltered } = usePagedList(filtered, [filtered.length]);

  const severeCount = records.filter((r) => hasSevereAllergy(r)).length;
  const noConsentCount = records.filter((r) => !r.emergencyTreatmentConsent).length;

  const run = async (action: () => void, loadingMessage: string, rule = 'saude.ficha_medica.manage'): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyMedicalForm());
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (r: StudentMedicalRecord) => {
    setEditingId(r.id);
    setForm({
      studentId: r.studentId,
      bloodType: r.bloodType,
      allergies: r.allergies.length ? r.allergies : [],
      conditions: r.conditions.length ? r.conditions : [],
      medications: r.medications.length ? r.medications : [],
      vaccinationStatus: r.vaccinationStatus,
      vaccinationNotes: r.vaccinationNotes || '',
      emergencyContacts: r.emergencyContacts.length ? r.emergencyContacts : [{ name: '', relation: '', phone: '' }],
      physicianName: r.physicianName || '',
      physicianPhone: r.physicianPhone || '',
      preferredHealthUnit: r.preferredHealthUnit || '',
      healthInsurance: r.healthInsurance || '',
      healthInsurancePolicy: r.healthInsurancePolicy || '',
      emergencyTreatmentConsent: r.emergencyTreatmentConsent,
      consentGivenBy: r.consentGivenBy || '',
      notes: r.notes || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openView = (r: StudentMedicalRecord) => {
    dbService.logMedicalRecordView(r);
    setViewing({
      ...r,
      allergies: r.allergies || [],
      conditions: r.conditions || [],
      medications: r.medications || [],
      emergencyContacts: r.emergencyContacts || [],
      occurrences: r.occurrences || []
    });
    setOccDate(todayIso());
    setOccTime(nowHm());
    setOccType('doenca');
    setOccDescription('');
    setOccAction('');
    setOccGuardianNotified(false);
    setOccReferred(false);
    setOccError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      acl.guard('saude.ficha_medica.manage', () => undefined);
      return;
    }
    if (!form.studentId) return setFormError('Selecione o aluno.');
    if (form.emergencyTreatmentConsent && !form.consentGivenBy.trim()) {
      return setFormError('Indique quem deu o consentimento para primeiros socorros.');
    }
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.saveMedicalRecord({
          id: editingId || undefined,
          studentId: form.studentId,
          bloodType: form.bloodType,
          allergies: form.allergies,
          conditions: form.conditions,
          medications: form.medications,
          vaccinationStatus: form.vaccinationStatus,
          vaccinationNotes: form.vaccinationNotes,
          emergencyContacts: form.emergencyContacts,
          physicianName: form.physicianName,
          physicianPhone: form.physicianPhone,
          preferredHealthUnit: form.preferredHealthUnit,
          healthInsurance: form.healthInsurance,
          healthInsurancePolicy: form.healthInsurancePolicy,
          emergencyTreatmentConsent: form.emergencyTreatmentConsent,
          consentGivenBy: form.emergencyTreatmentConsent ? form.consentGivenBy : undefined,
          notes: form.notes
        });
        if (!r.success) {
          failure = r.error || (r.errors && r.errors[0]) || '';
          throw new Error(failure);
        }
      },
      editingId ? 'A guardar alterações da ficha médica...' : 'A registar ficha médica...'
    );
    if (result.ok) setIsFormOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar a ficha médica.');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteMedicalRecord(target.id);
    }, `A eliminar ficha médica de ${target.studentName}...`);
  };

  const handleAddOccurrence = async () => {
    if (!viewing) return;
    if (!canManage) {
      acl.guard('saude.ficha_medica.manage', () => undefined);
      return;
    }
    if (!occDescription.trim()) return setOccError('Descreva a ocorrência.');
    let failure = '';
    const result = await run(() => {
      const r = dbService.addMedicalOccurrence(viewing.id, {
        date: occDate,
        time: occTime,
        type: occType,
        description: occDescription,
        actionTaken: occAction,
        guardianNotified: occGuardianNotified,
        referredToHealthUnit: occReferred
      });
      if (!r.success) {
        failure = r.error || '';
        throw new Error(failure);
      }
      if (r.record) setViewing(r.record);
    }, 'A registar ocorrência de saúde...');
    if (result.ok) {
      setOccDescription('');
      setOccAction('');
      setOccGuardianNotified(false);
      setOccReferred(false);
      setOccError('');
    } else {
      setOccError(failure || result.error || 'Não foi possível registar a ocorrência.');
    }
  };

  const updateAllergy = (idx: number, patch: Partial<AllergyRow>) =>
    setForm({ ...form, allergies: form.allergies.map((a, i) => (i === idx ? { ...a, ...patch } : a)) });
  const updateCondition = (idx: number, patch: Partial<ConditionRow>) =>
    setForm({ ...form, conditions: form.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  const updateMedication = (idx: number, patch: Partial<MedicationRow>) =>
    setForm({ ...form, medications: form.medications.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const updateContact = (idx: number, patch: Partial<ContactRow>) =>
    setForm({ ...form, emergencyContacts: form.emergencyContacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });

  if (!canView) {
    return (
      <div className="flex flex-col w-full gap-6 pb-12">
        <SectionHeader
          subsection="1. Ficha Médica do Aluno"
          title="Ficha Médica do Aluno"
          description="Dado de saúde confidencial."
        />
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-400 text-xs">
          Não tem permissão para consultar fichas médicas. Contacte o Administrador Geral.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <SectionHeader
        subsection="FICHA MÉDICA"
        title="FICHA MÉDICA DO ALUNO"
        description="Tipo sanguíneo, alergias, condições crónicas, medicação e contactos de emergência. Dado de saúde confidencial — cada consulta e alteração fica na trilha de auditoria."
        actions={
          canManage ? (
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">medical_information</span>
              <span>NOVA FICHA</span>
            </button>
          ) : undefined
        }
      />

      <KpiGrid
        items={[
          { label: 'Fichas Registadas', value: records.length, icon: 'medical_information' },
          { label: 'Alergias Graves', value: severeCount, icon: 'warning', tone: severeCount > 0 ? 'danger' : 'default' },
          { label: 'Sem Consentimento de Emergência', value: noConsentCount, icon: 'assignment_late', tone: noConsentCount > 0 ? 'warn' : 'default' },
          { label: 'Alunos Ativos sem Ficha', value: studentOptionsForNew.length, icon: 'person_search' }
        ]}
      />

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Pesquisar por aluno, nº de processo ou turma...">
        <span className="text-xs text-slate-400 font-mono">{filtered.length} registos</span>
      </SearchBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Aluno</th>
                <th className="py-3.5 px-3 text-white">Tipo Sanguíneo</th>
                <th className="py-3.5 px-3 text-white">Alergias</th>
                <th className="py-3.5 px-3 text-white">Vacinação</th>
                <th className="py-3.5 px-3 text-white">Consentimento</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhuma ficha médica registada ou encontrada.
                  </td>
                </tr>
              ) : (
                visibleFiltered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a]">{r.studentName}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Nº {r.studentProcNumber}
                        {r.className ? ` · ${r.className}` : ''}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-slate-700">{BLOOD_TYPE_LABELS[r.bloodType]}</td>
                    <td className="py-3.5 px-3">
                      {r.allergies.length === 0 ? (
                        <span className="text-slate-400">Nenhuma</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {r.allergies.slice(0, 3).map((a, i) => (
                            <Badge key={i} tone={ALLERGY_SEVERITY_META[a.severity].badge}>
                              {a.substance}
                            </Badge>
                          ))}
                          {r.allergies.length > 3 && <span className="text-[11px] text-slate-400">+{r.allergies.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600">{VACCINATION_STATUS_LABELS[r.vaccinationStatus]}</td>
                    <td className="py-3.5 px-3">
                      {r.emergencyTreatmentConsent ? (
                        <Badge tone="bg-emerald-100 text-emerald-800">Dado</Badge>
                      ) : (
                        <Badge tone="bg-amber-100 text-amber-800">Pendente</Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openView(r)} title="Ver ficha completa" className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => openEdit(r)} title="Editar ficha" className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer">
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button onClick={() => setDeleting(r)} title="Eliminar ficha" className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer">
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                          </>
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

      {/* Modal: Ver Ficha + Ocorrências */}
      {viewing && (
        <ModalShell
          title={viewing.studentName}
          subtitle={`Ficha Médica · ${viewing.code}`}
          icon="medical_information"
          badge={BLOOD_TYPE_LABELS[viewing.bloodType]}
          onClose={() => setViewing(null)}
          widthCls="max-w-3xl"
        >
          <div className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Alergias</span>
                {viewing.allergies.length === 0 ? (
                  <span className="text-slate-400">Nenhuma registada</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {viewing.allergies.map((a, i) => (
                      <span
                        key={i}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-normal break-words max-w-full ${ALLERGY_SEVERITY_META[a.severity].badge}`}
                      >
                        {a.substance} ({ALLERGY_SEVERITY_META[a.severity].label}){a.reaction ? ` — ${a.reaction}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Condições Crónicas</span>
                {viewing.conditions.length === 0 ? (
                  <span className="text-slate-400">Nenhuma registada</span>
                ) : (
                  <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                    {viewing.conditions.map((c, i) => (
                      <li key={i} className="break-words">
                        {c.name}
                        {c.notes ? ` — ${c.notes}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Medicação</span>
                {viewing.medications.length === 0 ? (
                  <span className="text-slate-400">Nenhuma registada</span>
                ) : (
                  <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                    {viewing.medications.map((m, i) => (
                      <li key={i} className="break-words">
                        {m.name}
                        {m.dosage ? ` — ${m.dosage}` : ''}
                        {m.schedule ? ` (${m.schedule})` : ''}
                        {m.administeredAtSchool && <span className="ml-1 text-[10px] text-amber-700 font-bold">[Escola administra]</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Contactos de Emergência</span>
                <ul className="text-slate-700 space-y-0.5">
                  {viewing.emergencyContacts.map((c, i) => (
                    <li key={i}>
                      {c.name} ({c.relation}) — <a href={`tel:${c.phone}`} className="font-mono hover:text-[#0b1f3a]">{c.phone}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-slate-100 pt-4">
              {(
                [
                  ['Vacinação', VACCINATION_STATUS_LABELS[viewing.vaccinationStatus]],
                  ['Médico Assistente', viewing.physicianName],
                  ['Unidade de Saúde', viewing.preferredHealthUnit],
                  ['Seguro de Saúde', viewing.healthInsurance]
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="block text-[10px] uppercase font-bold text-slate-500">{k}</span>
                    <span className="text-slate-800">{v}</span>
                  </div>
                ))}
            </div>

            {viewing.notes && (
              <div className="border-t border-slate-100 pt-3">
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Observações</span>
                <p className="text-slate-700 whitespace-pre-wrap break-words">{viewing.notes}</p>
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <div className="flex items-center gap-2 pb-2">
                <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">history</span>
                <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">Ocorrências de Saúde</span>
              </div>
              {viewing.occurrences.length === 0 ? (
                <p className="text-slate-400 mb-3">Nenhuma ocorrência registada.</p>
              ) : (
                <div className="space-y-2 mb-3 max-h-48 overflow-y-auto pr-1">
                  {viewing.occurrences.map((o) => (
                    <div key={o.id} className="border border-slate-200 rounded-lg p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">{MEDICAL_OCCURRENCE_TYPE_LABELS[o.type]}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {fmtDate(o.date)} {o.time || ''}
                        </span>
                      </div>
                      <p className="text-slate-700 mt-1 whitespace-pre-wrap break-words">{o.description}</p>
                      {o.actionTaken && <p className="text-slate-500 mt-0.5 whitespace-pre-wrap break-words">Ação tomada: {o.actionTaken}</p>}
                      <div className="flex gap-2 mt-1.5">
                        {o.guardianNotified && <Badge tone="bg-emerald-100 text-emerald-800">Encarregado notificado</Badge>}
                        {o.referredToHealthUnit && <Badge tone="bg-blue-100 text-blue-800">Encaminhado</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canManage && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className={labelCls}>Data</label>
                      <input type="date" value={occDate} onChange={(e) => setOccDate(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Hora</label>
                      <input type="time" value={occTime} onChange={(e) => setOccTime(e.target.value)} className={inputCls} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>Tipo</label>
                      <select value={occType} onChange={(e) => setOccType(e.target.value as MedicalOccurrenceType)} className={inputCls}>
                        {(Object.keys(MEDICAL_OCCURRENCE_TYPE_LABELS) as MedicalOccurrenceType[]).map((t) => (
                          <option key={t} value={t}>
                            {MEDICAL_OCCURRENCE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Descrição *</label>
                    <textarea rows={2} value={occDescription} onChange={(e) => setOccDescription(e.target.value)} className={textareaCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Ação Tomada</label>
                    <input type="text" value={occAction} onChange={(e) => setOccAction(e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className={checkboxRowCls}>
                      <input type="checkbox" checked={occGuardianNotified} onChange={(e) => setOccGuardianNotified(e.target.checked)} />
                      Encarregado Notificado
                    </label>
                    <label className={checkboxRowCls}>
                      <input type="checkbox" checked={occReferred} onChange={(e) => setOccReferred(e.target.checked)} />
                      Encaminhado para Unidade de Saúde
                    </label>
                  </div>
                  {occError && <Notice tone="error">{occError}</Notice>}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAddOccurrence}
                      className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      <span>Registar Ocorrência</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {/* Modal: Nova/Editar Ficha */}
      {isFormOpen && (
        <ModalShell
          title={editingId ? 'Editar Ficha Médica' : 'Nova Ficha Médica'}
          subtitle="Saúde & Segurança · Ficha Médica do Aluno"
          icon="medical_information"
          onClose={() => setIsFormOpen(false)}
          widthCls="max-w-3xl"
        >
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-5">
            <div>
              <label className={labelCls}>Aluno *</label>
              {editingId ? (
                <input type="text" disabled value={form.studentId ? studentById.get(form.studentId)?.name || '' : ''} className={`${inputCls} bg-slate-100 text-slate-500`} />
              ) : (
                <SearchableSelect
                  options={studentOptionsForNew}
                  value={form.studentId}
                  onChange={(v) => setForm({ ...form, studentId: v })}
                  placeholder="Selecione o aluno..."
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Tipo Sanguíneo</label>
                <select value={form.bloodType} onChange={(e) => setForm({ ...form, bloodType: e.target.value as BloodType })} className={inputCls}>
                  {BLOOD_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {BLOOD_TYPE_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Estado de Vacinação</label>
                <select value={form.vaccinationStatus} onChange={(e) => setForm({ ...form, vaccinationStatus: e.target.value as VaccinationStatus })} className={inputCls}>
                  {(Object.keys(VACCINATION_STATUS_LABELS) as VaccinationStatus[]).map((v) => (
                    <option key={v} value={v}>
                      {VACCINATION_STATUS_LABELS[v]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Alergias */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Alergias</label>
                <button type="button" onClick={() => setForm({ ...form, allergies: [...form.allergies, { substance: '', severity: 'ligeira' }] })} className="text-[11px] font-bold text-[#0b1f3a] hover:text-[#7a0c0c] cursor-pointer">
                  + Adicionar Alergia
                </button>
              </div>
              {form.allergies.map((a, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input type="text" placeholder="Substância (ex.: penicilina)" value={a.substance} onChange={(e) => updateAllergy(idx, { substance: e.target.value })} className={`${inputCls} col-span-5`} />
                  <select value={a.severity} onChange={(e) => updateAllergy(idx, { severity: e.target.value as MedicalAllergy['severity'] })} className={`${inputCls} col-span-3`}>
                    {(['ligeira', 'moderada', 'grave'] as MedicalAllergy['severity'][]).map((s) => (
                      <option key={s} value={s}>
                        {ALLERGY_SEVERITY_META[s].label}
                      </option>
                    ))}
                  </select>
                  <input type="text" placeholder="Reação (opcional)" value={a.reaction || ''} onChange={(e) => updateAllergy(idx, { reaction: e.target.value })} className={`${inputCls} col-span-3`} />
                  <button type="button" onClick={() => setForm({ ...form, allergies: form.allergies.filter((_, i) => i !== idx) })} className="col-span-1 text-slate-400 hover:text-red-700 cursor-pointer flex justify-center">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Condições */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Condições Crónicas</label>
                <button type="button" onClick={() => setForm({ ...form, conditions: [...form.conditions, { name: '' }] })} className="text-[11px] font-bold text-[#0b1f3a] hover:text-[#7a0c0c] cursor-pointer">
                  + Adicionar Condição
                </button>
              </div>
              {form.conditions.map((c, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input type="text" placeholder="Ex.: asma, diabetes" value={c.name} onChange={(e) => updateCondition(idx, { name: e.target.value })} className={`${inputCls} col-span-5`} />
                  <input type="text" placeholder="Observações" value={c.notes || ''} onChange={(e) => updateCondition(idx, { notes: e.target.value })} className={`${inputCls} col-span-6`} />
                  <button type="button" onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== idx) })} className="col-span-1 text-slate-400 hover:text-red-700 cursor-pointer flex justify-center">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Medicação */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Medicação Contínua</label>
                <button type="button" onClick={() => setForm({ ...form, medications: [...form.medications, { name: '', administeredAtSchool: false }] })} className="text-[11px] font-bold text-[#0b1f3a] hover:text-[#7a0c0c] cursor-pointer">
                  + Adicionar Medicação
                </button>
              </div>
              {form.medications.map((m, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input type="text" placeholder="Nome" value={m.name} onChange={(e) => updateMedication(idx, { name: e.target.value })} className={`${inputCls} col-span-3`} />
                  <input type="text" placeholder="Dosagem" value={m.dosage || ''} onChange={(e) => updateMedication(idx, { dosage: e.target.value })} className={`${inputCls} col-span-3`} />
                  <input type="text" placeholder="Horário" value={m.schedule || ''} onChange={(e) => updateMedication(idx, { schedule: e.target.value })} className={`${inputCls} col-span-3`} />
                  <label className="col-span-2 flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                    <input type="checkbox" checked={m.administeredAtSchool} onChange={(e) => updateMedication(idx, { administeredAtSchool: e.target.checked })} />
                    Escola administra
                  </label>
                  <button type="button" onClick={() => setForm({ ...form, medications: form.medications.filter((_, i) => i !== idx) })} className="col-span-1 text-slate-400 hover:text-red-700 cursor-pointer flex justify-center">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Contactos de Emergência */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Contactos de Emergência *</label>
                <button type="button" onClick={() => setForm({ ...form, emergencyContacts: [...form.emergencyContacts, { name: '', relation: '', phone: '' }] })} className="text-[11px] font-bold text-[#0b1f3a] hover:text-[#7a0c0c] cursor-pointer">
                  + Adicionar Contacto
                </button>
              </div>
              {form.emergencyContacts.map((c, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input type="text" placeholder="Nome" value={c.name} onChange={(e) => updateContact(idx, { name: e.target.value })} className={`${inputCls} col-span-4`} />
                  <input type="text" placeholder="Parentesco" value={c.relation} onChange={(e) => updateContact(idx, { relation: e.target.value })} className={`${inputCls} col-span-3`} />
                  <input type="text" placeholder="Telefone" value={c.phone} onChange={(e) => updateContact(idx, { phone: e.target.value })} className={`${inputCls} col-span-4 font-mono`} />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, emergencyContacts: form.emergencyContacts.filter((_, i) => i !== idx) })}
                    className="col-span-1 text-slate-400 hover:text-red-700 cursor-pointer flex justify-center"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Médico Assistente</label>
                <input type="text" value={form.physicianName} onChange={(e) => setForm({ ...form, physicianName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Telefone do Médico</label>
                <input type="text" value={form.physicianPhone} onChange={(e) => setForm({ ...form, physicianPhone: e.target.value })} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Unidade de Saúde Preferencial</label>
                <input type="text" value={form.preferredHealthUnit} onChange={(e) => setForm({ ...form, preferredHealthUnit: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Seguro de Saúde</label>
                <input type="text" value={form.healthInsurance} onChange={(e) => setForm({ ...form, healthInsurance: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nº da Apólice</label>
                <input type="text" value={form.healthInsurancePolicy} onChange={(e) => setForm({ ...form, healthInsurancePolicy: e.target.value })} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Notas de Vacinação</label>
                <input type="text" value={form.vaccinationNotes} onChange={(e) => setForm({ ...form, vaccinationNotes: e.target.value })} className={inputCls} />
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <label className={checkboxRowCls}>
                <input type="checkbox" checked={form.emergencyTreatmentConsent} onChange={(e) => setForm({ ...form, emergencyTreatmentConsent: e.target.checked })} />
                O Encarregado de Educação autoriza primeiros socorros e transporte para uma unidade de saúde em caso de emergência.
              </label>
              {form.emergencyTreatmentConsent && (
                <div>
                  <label className={labelCls}>Consentimento dado por</label>
                  <input type="text" value={form.consentGivenBy} onChange={(e) => setForm({ ...form, consentGivenBy: e.target.value })} className={inputCls} />
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Observações Gerais</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={textareaCls} />
            </div>

            <FormFooter error={formError} onCancel={() => setIsFormOpen(false)} submitLabel={editingId ? 'Guardar Alterações' : 'Registar Ficha'} />
          </form>
        </ModalShell>
      )}

      {deleting && (
        <DeleteModal
          title="Eliminar Ficha"
          name={deleting.studentName}
          code={deleting.code}
          extra="Todo o histórico de ocorrências desta ficha será perdido."
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

// =============================================================================
// 2. INCIDENTES DISCIPLINARES
// =============================================================================

interface ParticipantRow {
  studentId: string;
  role: IncidentParticipantRole;
}

interface IncidentForm {
  academicYear: string;
  date: string;
  time: string;
  location: string;
  category: IncidentCategory;
  categoryOther: string;
  severity: IncidentSeverity;
  description: string;
  reportedBy: string;
  participants: ParticipantRow[];
  guardianNotified: boolean;
  guardianNotifiedDate: string;
  guardianNotifiedChannel: string;
  guardianNotifiedNotes: string;
}

const emptyIncidentForm = (academicYear: string): IncidentForm => ({
  academicYear,
  date: todayIso(),
  time: nowHm(),
  location: '',
  category: 'indisciplina_sala',
  categoryOther: '',
  severity: 'leve',
  description: '',
  reportedBy: '',
  participants: [],
  guardianNotified: false,
  guardianNotifiedDate: '',
  guardianNotifiedChannel: 'telefone',
  guardianNotifiedNotes: ''
});

function IncidentesSection({ db, currentUserRole }: { db: SchoolDatabase; currentUserRole: UserRole }) {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('saude.incidentes.manage');
  const canDecide = acl.can('saude.incidentes.decide');

  const students = db.students || [];
  const incidents = db.disciplinaryIncidents || [];
  const academicYear = db.settings?.currentAcademicYear || todayIso().slice(0, 4);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DisciplinaryIncident['status']>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>('all');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IncidentForm>(emptyIncidentForm(academicYear));
  const [formError, setFormError] = useState('');
  const [participantToAdd, setParticipantToAdd] = useState('');
  const [participantRole, setParticipantRole] = useState<IncidentParticipantRole>('autor');

  const [viewing, setViewing] = useState<DisciplinaryIncident | null>(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpError, setFollowUpError] = useState('');
  const [measureType, setMeasureType] = useState<DisciplinaryMeasureType>('advertencia_oral');
  const [measureDetails, setMeasureDetails] = useState('');
  const [suspensionStart, setSuspensionStart] = useState(todayIso());
  const [suspensionDays, setSuspensionDays] = useState('1');
  const [measureError, setMeasureError] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  const [deleting, setDeleting] = useState<DisciplinaryIncident | null>(null);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const studentOptions = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active' && !form.participants.some((p) => p.studentId === s.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: s.name, sublabel: `Nº ${s.procNumber}${s.className ? ' · ' + s.className : ''}` })),
    [students, form.participants]
  );

  const q = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      incidents
        .filter((i) => statusFilter === 'all' || i.status === statusFilter)
        .filter((i) => severityFilter === 'all' || i.severity === severityFilter)
        .filter(
          (i) =>
            !q ||
            i.code.toLowerCase().includes(q) ||
            i.participants.some((p) => p.studentName.toLowerCase().includes(q)) ||
            INCIDENT_CATEGORY_LABELS[i.category].toLowerCase().includes(q)
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [incidents, statusFilter, severityFilter, q]
  );
  const { page: pgFiltered2, setPage: setPgFiltered2, pageItems: visibleFiltered2 } = usePagedList(filtered, [filtered.length]);

  const openCount = incidents.filter((i) => i.status === 'aberto').length;
  const emAnaliseCount = incidents.filter((i) => i.status === 'em_analise').length;
  const graveThisYear = incidents.filter((i) => i.academicYear === academicYear && i.severity === 'muito_grave').length;

  const run = async (action: () => void, loadingMessage: string, rule = 'saude.incidentes.manage'): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openNew = () => {
    setEditingId(null);
    setForm(emptyIncidentForm(academicYear));
    setParticipantToAdd('');
    setParticipantRole('autor');
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (i: DisciplinaryIncident) => {
    setEditingId(i.id);
    setForm({
      academicYear: i.academicYear,
      date: i.date,
      time: i.time || '',
      location: i.location || '',
      category: i.category,
      categoryOther: i.categoryOther || '',
      severity: i.severity,
      description: i.description,
      reportedBy: i.reportedBy,
      participants: i.participants.map((p) => ({ studentId: p.studentId, role: p.role })),
      guardianNotified: i.guardianNotification.notified,
      guardianNotifiedDate: i.guardianNotification.date || '',
      guardianNotifiedChannel: i.guardianNotification.channel || 'telefone',
      guardianNotifiedNotes: i.guardianNotification.notes || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openView = (i: DisciplinaryIncident) => {
    setViewing({
      ...i,
      participants: i.participants || [],
      followUps: i.followUps || []
    });
    setFollowUpNote('');
    setFollowUpError('');
    setMeasureType('advertencia_oral');
    setMeasureDetails('');
    setSuspensionStart(todayIso());
    setSuspensionDays('1');
    setMeasureError('');
    setArchiveReason('');
  };

  const addParticipant = () => {
    if (!participantToAdd) return;
    setForm({ ...form, participants: [...form.participants, { studentId: participantToAdd, role: participantRole }] });
    setParticipantToAdd('');
  };

  const removeParticipant = (studentId: string) =>
    setForm({ ...form, participants: form.participants.filter((p) => p.studentId !== studentId) });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      acl.guard('saude.incidentes.manage', () => undefined);
      return;
    }
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.saveDisciplinaryIncident({
          id: editingId || undefined,
          academicYear: form.academicYear,
          date: form.date,
          time: form.time || undefined,
          location: form.location,
          category: form.category,
          categoryOther: form.categoryOther,
          severity: form.severity,
          description: form.description,
          reportedBy: form.reportedBy,
          participants: form.participants,
          guardianNotification: {
            notified: form.guardianNotified,
            date: form.guardianNotified ? form.guardianNotifiedDate : undefined,
            channel: form.guardianNotified ? form.guardianNotifiedChannel : undefined,
            notes: form.guardianNotifiedNotes
          }
        });
        if (!r.success) {
          failure = r.error || (r.errors && r.errors[0]) || '';
          throw new Error(failure);
        }
      },
      editingId ? 'A guardar alterações do incidente...' : 'A registar incidente disciplinar...'
    );
    if (result.ok) setIsFormOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar o incidente.');
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deleteDisciplinaryIncident(target.id);
    }, `A eliminar incidente ${target.code}...`);
  };

  const handleAddFollowUp = async () => {
    if (!viewing) return;
    if (!canManage) {
      acl.guard('saude.incidentes.manage', () => undefined);
      return;
    }
    if (!followUpNote.trim()) return setFollowUpError('Escreva uma nota de seguimento.');
    let failure = '';
    const result = await run(() => {
      const r = dbService.addIncidentFollowUp(viewing.id, followUpNote);
      if (!r.success) {
        failure = r.error || '';
        throw new Error(failure);
      }
      const updated = (dbService.getDisciplinaryIncidents() || []).find((i) => i.id === viewing.id);
      if (updated) setViewing(updated);
    }, 'A registar seguimento...');
    if (result.ok) {
      setFollowUpNote('');
      setFollowUpError('');
    } else {
      setFollowUpError(failure || result.error || 'Não foi possível registar o seguimento.');
    }
  };

  const handleDecide = async () => {
    if (!viewing) return;
    if (!canDecide) {
      acl.guard('saude.incidentes.decide', () => undefined);
      return;
    }
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.decideIncidentMeasure(viewing.id, {
          type: measureType,
          details: measureDetails,
          suspensionStart: measureType === 'suspensao' ? suspensionStart : undefined,
          suspensionDays: measureType === 'suspensao' ? Number(suspensionDays) : undefined
        });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(failure);
        }
        const updated = (dbService.getDisciplinaryIncidents() || []).find((i) => i.id === viewing.id);
        if (updated) setViewing(updated);
      },
      'A registar decisão do incidente...',
      'saude.incidentes.decide'
    );
    if (!result.ok) setMeasureError(failure || result.error || 'Não foi possível registar a decisão.');
  };

  const handleArchive = async () => {
    if (!viewing) return;
    const result = await run(() => {
      dbService.archiveDisciplinaryIncident(viewing.id, archiveReason);
    }, 'A arquivar incidente...');
    if (result.ok) setViewing(null);
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <SectionHeader
        subsection="INCIDÊNCIA ESCOLAR"
        title="INCIDENTES DISCIPLINARES"
        description="Registo de ocorrências disciplinares, alunos envolvidos, notificação ao encarregado, seguimento e medida aplicada."
        actions={
          canManage ? (
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">report</span>
              <span>NOVO INCIDENTE</span>
            </button>
          ) : undefined
        }
      />

      <KpiGrid
        items={[
          { label: 'Total de Incidentes', value: incidents.length, icon: 'report' },
          { label: 'Abertos', value: openCount, icon: 'pending_actions', tone: openCount > 0 ? 'warn' : 'default' },
          { label: 'Em Análise', value: emAnaliseCount, icon: 'search' },
          { label: 'Muito Graves (Ano Atual)', value: graveThisYear, icon: 'warning', tone: graveThisYear > 0 ? 'danger' : 'default' }
        ]}
      />

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Pesquisar por código, aluno ou categoria...">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
          <option value="all">Todos os Estados</option>
          {(Object.keys(INCIDENT_STATUS_META) as DisciplinaryIncident['status'][]).map((s) => (
            <option key={s} value={s}>
              {INCIDENT_STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
          <option value="all">Todas as Gravidades</option>
          {(Object.keys(INCIDENT_SEVERITY_META) as IncidentSeverity[]).map((s) => (
            <option key={s} value={s}>
              {INCIDENT_SEVERITY_META[s].label}
            </option>
          ))}
        </select>
      </SearchBar>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                <th className="py-3.5 px-4 text-white">Código & Data</th>
                <th className="py-3.5 px-3 text-white">Categoria</th>
                <th className="py-3.5 px-3 text-white">Envolvidos</th>
                <th className="py-3.5 px-3 text-white">Gravidade</th>
                <th className="py-3.5 px-3 text-white">Estado</th>
                <th className="py-3.5 px-4 text-right text-white">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    Nenhum incidente registado ou encontrado.
                  </td>
                </tr>
              ) : (
                visibleFiltered2.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#0b1f3a] font-mono">{i.code}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{fmtDate(i.date)}</div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">
                      {i.category === 'outro' ? i.categoryOther || 'Outro' : INCIDENT_CATEGORY_LABELS[i.category]}
                    </td>
                    <td className="py-3.5 px-3 text-slate-600 max-w-[220px]">
                      <div className="truncate" title={i.participants.map((p) => p.studentName).join(', ')}>
                        {i.participants.map((p) => p.studentName).join(', ') || '—'}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <Badge tone={INCIDENT_SEVERITY_META[i.severity].badge}>{INCIDENT_SEVERITY_META[i.severity].label}</Badge>
                    </td>
                    <td className="py-3.5 px-3">
                      <Badge tone={INCIDENT_STATUS_META[i.status].badge}>{INCIDENT_STATUS_META[i.status].label}</Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openView(i)} title="Ver incidente" className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {canManage && i.status !== 'decidido' && i.status !== 'arquivado' && (
                          <button onClick={() => openEdit(i)} title="Editar incidente" className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer">
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                        )}
                        {canManage && (
                          <button onClick={() => setDeleting(i)} title="Eliminar incidente" className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer">
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
          <TablePagination total={filtered.length} page={pgFiltered2} onPageChange={setPgFiltered2} />
        </div>
      </div>

      {/* Modal: Ver Incidente */}
      {viewing && (
        <ModalShell
          title={viewing.code}
          subtitle={fmtDate(viewing.date)}
          icon="report"
          badge={INCIDENT_STATUS_META[viewing.status].label}
          onClose={() => setViewing(null)}
          widthCls="max-w-2xl"
        >
          <div className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Categoria</span>
                <span className="text-slate-800 break-words">{viewing.category === 'outro' ? viewing.categoryOther : INCIDENT_CATEGORY_LABELS[viewing.category]}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Gravidade</span>
                <Badge tone={INCIDENT_SEVERITY_META[viewing.severity].badge}>{INCIDENT_SEVERITY_META[viewing.severity].label}</Badge>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Local</span>
                <span className="text-slate-800 break-words">{viewing.location || '—'}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Comunicado por</span>
                <span className="text-slate-800">{viewing.reportedBy}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Ano Letivo</span>
                <span className="text-slate-800">{viewing.academicYear}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500">Encarregado Notificado</span>
                <span className="text-slate-800">{viewing.guardianNotification.notified ? `Sim (${fmtDate(viewing.guardianNotification.date)})` : 'Não'}</span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Envolvidos</span>
              <ul className="text-slate-700 space-y-0.5">
                {viewing.participants.map((p, idx) => (
                  <li key={idx}>
                    {p.studentName} ({p.studentProcNumber}{p.className ? ` · ${p.className}` : ''}) — {p.role === 'autor' ? 'Autor' : p.role === 'vitima' ? 'Vítima' : 'Testemunha'}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Descrição</span>
              <p className="text-slate-700 whitespace-pre-wrap break-words">{viewing.description}</p>
            </div>

            {viewing.measure && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <span className="block text-[10px] uppercase font-bold text-emerald-700 mb-1">Medida Aplicada</span>
                <p className="text-emerald-900 font-semibold">{DISCIPLINARY_MEASURE_LABELS[viewing.measure.type]}</p>
                {viewing.measure.type === 'suspensao' && (
                  <p className="text-emerald-800">
                    {viewing.measure.suspensionDays} dia(s), a partir de {fmtDate(viewing.measure.suspensionStart)}
                  </p>
                )}
                {viewing.measure.details && <p className="text-emerald-800 mt-1 whitespace-pre-wrap break-words">{viewing.measure.details}</p>}
                <p className="text-[11px] text-emerald-700 mt-1">
                  Decidido por {viewing.measure.decidedBy} em {fmtDateTime(viewing.measure.decidedAt)}
                </p>
              </div>
            )}

            <div className="border-t border-slate-200 pt-3">
              <span className="block text-[10px] uppercase font-bold text-slate-500 mb-2">Seguimento</span>
              {viewing.followUps.length === 0 ? (
                <p className="text-slate-400 mb-2">Nenhuma nota de seguimento.</p>
              ) : (
                <div className="space-y-1.5 mb-2 max-h-32 overflow-y-auto pr-1">
                  {viewing.followUps.map((f) => (
                    <div key={f.id} className="border border-slate-200 rounded-lg p-2">
                      <p className="text-slate-700 whitespace-pre-wrap break-words">{f.note}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {f.by} · {fmtDateTime(f.date)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {canManage && viewing.status !== 'decidido' && viewing.status !== 'arquivado' && (
                <div className="flex gap-2">
                  <input type="text" value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} placeholder="Nova nota de seguimento..." className={`${inputCls} flex-1`} />
                  <button type="button" onClick={handleAddFollowUp} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer">
                    Adicionar
                  </button>
                </div>
              )}
              {followUpError && <Notice tone="error">{followUpError}</Notice>}
            </div>

            {canDecide && viewing.status !== 'decidido' && viewing.status !== 'arquivado' && (
              <div className="border-t border-slate-200 pt-3 bg-slate-50 -mx-6 px-6 py-4 space-y-2.5">
                <span className="block text-[10px] uppercase font-bold text-slate-700">Decidir Medida</span>
                <select value={measureType} onChange={(e) => setMeasureType(e.target.value as DisciplinaryMeasureType)} className={inputCls}>
                  {(Object.keys(DISCIPLINARY_MEASURE_LABELS) as DisciplinaryMeasureType[]).map((m) => (
                    <option key={m} value={m}>
                      {DISCIPLINARY_MEASURE_LABELS[m]}
                    </option>
                  ))}
                </select>
                {measureType === 'suspensao' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className={labelCls}>Início da Suspensão</label>
                      <input type="date" value={suspensionStart} onChange={(e) => setSuspensionStart(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Nº de Dias</label>
                      <input type="number" min={1} value={suspensionDays} onChange={(e) => setSuspensionDays(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                )}
                <textarea rows={2} placeholder="Fundamentação da decisão..." value={measureDetails} onChange={(e) => setMeasureDetails(e.target.value)} className={textareaCls} />
                {measureError && <Notice tone="error">{measureError}</Notice>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={handleArchive} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer">
                    Arquivar sem Medida
                  </button>
                  <button type="button" onClick={handleDecide} className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
                    Registar Decisão
                  </button>
                </div>
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {/* Modal: Novo/Editar Incidente */}
      {isFormOpen && (
        <ModalShell
          title={editingId ? 'Editar Incidente' : 'Novo Incidente Disciplinar'}
          subtitle="Saúde & Segurança · Incidentes Disciplinares"
          icon="report"
          onClose={() => setIsFormOpen(false)}
          widthCls="max-w-2xl"
        >
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Data *</label>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Hora</label>
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Local</label>
                <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Categoria *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as IncidentCategory })} className={inputCls}>
                  {(Object.keys(INCIDENT_CATEGORY_LABELS) as IncidentCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {INCIDENT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Gravidade *</label>
                <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as IncidentSeverity })} className={inputCls}>
                  {(Object.keys(INCIDENT_SEVERITY_META) as IncidentSeverity[]).map((s) => (
                    <option key={s} value={s}>
                      {INCIDENT_SEVERITY_META[s].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {form.category === 'outro' && (
              <div>
                <label className={labelCls}>Descreva a Categoria *</label>
                <input type="text" value={form.categoryOther} onChange={(e) => setForm({ ...form, categoryOther: e.target.value })} className={inputCls} />
              </div>
            )}

            <div>
              <label className={labelCls}>Descrição *</label>
              <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={textareaCls} />
            </div>

            <div>
              <label className={labelCls}>Comunicado Por *</label>
              <input type="text" value={form.reportedBy} onChange={(e) => setForm({ ...form, reportedBy: e.target.value })} className={inputCls} placeholder="Nome do docente/funcionário que reportou" />
            </div>

            <div className="space-y-2">
              <label className={labelCls}>Alunos Envolvidos *</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <SearchableSelect options={studentOptions} value={participantToAdd} onChange={setParticipantToAdd} placeholder="Selecione um aluno..." />
                </div>
                <select value={participantRole} onChange={(e) => setParticipantRole(e.target.value as IncidentParticipantRole)} className={`${inputCls} w-40`}>
                  <option value="autor">Autor</option>
                  <option value="vitima">Vítima</option>
                  <option value="testemunha">Testemunha</option>
                </select>
                <button type="button" onClick={addParticipant} className="px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer">
                  + Adicionar
                </button>
              </div>
              {form.participants.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.participants.map((p) => (
                    <span key={p.studentId} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                      {studentById.get(p.studentId)?.name || p.studentId} ({p.role === 'autor' ? 'Autor' : p.role === 'vitima' ? 'Vítima' : 'Testemunha'})
                      <button type="button" onClick={() => removeParticipant(p.studentId)} className="text-slate-400 hover:text-red-700 cursor-pointer">
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <label className={checkboxRowCls}>
                <input type="checkbox" checked={form.guardianNotified} onChange={(e) => setForm({ ...form, guardianNotified: e.target.checked })} />
                O Encarregado de Educação foi notificado
              </label>
              {form.guardianNotified && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelCls}>Data</label>
                    <input type="date" value={form.guardianNotifiedDate} onChange={(e) => setForm({ ...form, guardianNotifiedDate: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Meio</label>
                    <select value={form.guardianNotifiedChannel} onChange={(e) => setForm({ ...form, guardianNotifiedChannel: e.target.value })} className={inputCls}>
                      <option value="telefone">Telefone</option>
                      <option value="presencial">Presencial</option>
                      <option value="escrito">Comunicado Escrito</option>
                      <option value="email">E-mail</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Notas</label>
                    <input type="text" value={form.guardianNotifiedNotes} onChange={(e) => setForm({ ...form, guardianNotifiedNotes: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}
            </div>

            <FormFooter error={formError} onCancel={() => setIsFormOpen(false)} submitLabel={editingId ? 'Guardar Alterações' : 'Registar Incidente'} />
          </form>
        </ModalShell>
      )}

      {deleting && (
        <DeleteModal
          title="Eliminar Incidente"
          name={INCIDENT_CATEGORY_LABELS[deleting.category]}
          code={deleting.code}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

// =============================================================================
// 3. AUTORIZAÇÕES DE RECOLHA
// =============================================================================

interface AuthForm {
  studentId: string;
  kind: PickupAuthorizationKind;
  personName: string;
  relation: PickupPersonRelation;
  relationOther: string;
  phone: string;
  documentNumber: string;
  grantedBy: string;
  grantedVia: PickupAuthorization['grantedVia'];
  validFrom: string;
  validUntil: string;
  notes: string;
}

const emptyAuthForm = (): AuthForm => ({
  studentId: '',
  kind: 'autorizada',
  personName: '',
  relation: 'encarregado',
  relationOther: '',
  phone: '',
  documentNumber: '',
  grantedBy: '',
  grantedVia: 'encarregado',
  validFrom: todayIso(),
  validUntil: '',
  notes: ''
});

interface PickupForm {
  studentId: string;
  date: string;
  time: string;
  authorizationId: string;
  personName: string;
  personRelation: string;
  personDocument: string;
  reason: PickupReason;
  reasonOther: string;
  guardianConfirmedBy: string;
  documentVerified: boolean;
  notes: string;
}

const emptyPickupForm = (): PickupForm => ({
  studentId: '',
  date: todayIso(),
  time: nowHm(),
  authorizationId: '',
  personName: '',
  personRelation: '',
  personDocument: '',
  reason: 'recolha_normal',
  reasonOther: '',
  guardianConfirmedBy: '',
  documentVerified: false,
  notes: ''
});

const GRANTED_VIA_LABELS: Record<PickupAuthorization['grantedVia'], string> = {
  encarregado: 'Encarregado de Educação',
  tribunal: 'Decisão Judicial / Tribunal',
  direcao: 'Direção da Escola',
  outro: 'Outro'
};

function RecolhaSection({ db, currentUserRole }: { db: SchoolDatabase; currentUserRole: UserRole }) {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('saude.recolha.manage');

  const students = db.students || [];
  const authorizations = db.pickupAuthorizations || [];
  const records = db.pickupRecords || [];

  const [tab, setTab] = useState<'autorizacoes' | 'registo'>('autorizacoes');

  // ---- Autorizações ----
  const [searchTerm, setSearchTerm] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | PickupAuthorizationKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PickupAuthorization['status']>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AuthForm>(emptyAuthForm());
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<PickupAuthorization | null>(null);
  const [statusChanging, setStatusChanging] = useState<PickupAuthorization | null>(null);
  const [statusReason, setStatusReason] = useState('');

  // ---- Registo de Saídas ----
  const [isPickupFormOpen, setIsPickupFormOpen] = useState(false);
  const [pickupForm, setPickupForm] = useState<PickupForm>(emptyPickupForm());
  const [pickupError, setPickupError] = useState('');
  const [lastOutcome, setLastOutcome] = useState<PickupRecord | null>(null);
  const [recordSearch, setRecordSearch] = useState('');

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const studentOptions = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: s.name, sublabel: `Nº ${s.procNumber}${s.className ? ' · ' + s.className : ''}` })),
    [students]
  );

  const q = searchTerm.trim().toLowerCase();
  const filteredAuths = useMemo(
    () =>
      authorizations
        .filter((a) => kindFilter === 'all' || a.kind === kindFilter)
        .filter((a) => statusFilter === 'all' || a.status === statusFilter)
        .filter(
          (a) =>
            !q ||
            a.studentName.toLowerCase().includes(q) ||
            a.personName.toLowerCase().includes(q) ||
            a.documentNumber.toLowerCase().includes(q) ||
            a.code.toLowerCase().includes(q)
        )
        .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt')),
    [authorizations, kindFilter, statusFilter, q]
  );
  const { page: pgFilteredAuths, setPage: setPgFilteredAuths, pageItems: visibleFilteredAuths } = usePagedList(filteredAuths, [filteredAuths.length]);

  const rq = recordSearch.trim().toLowerCase();
  const filteredRecords = useMemo(
    () =>
      records
        .filter(
          (r) =>
            !rq ||
            r.studentName.toLowerCase().includes(rq) ||
            r.personName.toLowerCase().includes(rq) ||
            r.personDocument.toLowerCase().includes(rq)
        )
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [records, rq]
  );
  const { page: pgFilteredRecords, setPage: setPgFilteredRecords, pageItems: visibleFilteredRecords } = usePagedList(filteredRecords, [filteredRecords.length]);

  const activeCount = authorizations.filter((a) => a.status === 'ativa' && a.kind === 'autorizada').length;
  const forbiddenCount = authorizations.filter((a) => a.status === 'ativa' && a.kind === 'proibida').length;
  const today = todayIso();
  const pickupsToday = records.filter((r) => r.date === today && r.outcome === 'entregue').length;
  const refusedCount = records.filter((r) => r.outcome === 'recusada').length;

  const run = async (action: () => void, loadingMessage: string, rule = 'saude.recolha.manage'): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  const openNewAuth = () => {
    setEditingId(null);
    setForm(emptyAuthForm());
    setFormError('');
    setIsFormOpen(true);
  };

  const openEditAuth = (a: PickupAuthorization) => {
    setEditingId(a.id);
    setForm({
      studentId: a.studentId,
      kind: a.kind,
      personName: a.personName,
      relation: a.relation,
      relationOther: a.relationOther || '',
      phone: a.phone,
      documentNumber: a.documentNumber,
      grantedBy: a.grantedBy,
      grantedVia: a.grantedVia,
      validFrom: a.validFrom,
      validUntil: a.validUntil || '',
      notes: a.notes || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      acl.guard('saude.recolha.manage', () => undefined);
      return;
    }
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.savePickupAuthorization({
          id: editingId || undefined,
          studentId: form.studentId,
          kind: form.kind,
          personName: form.personName,
          relation: form.relation,
          relationOther: form.relationOther,
          phone: form.phone,
          documentNumber: form.documentNumber,
          grantedBy: form.grantedBy,
          grantedVia: form.grantedVia,
          validFrom: form.validFrom,
          validUntil: form.validUntil || undefined,
          notes: form.notes
        });
        if (!r.success) {
          failure = r.error || (r.errors && r.errors[0]) || '';
          throw new Error(failure);
        }
      },
      editingId ? 'A guardar alterações da autorização...' : 'A registar autorização de recolha...'
    );
    if (result.ok) setIsFormOpen(false);
    else setFormError(failure || result.error || 'Não foi possível guardar a autorização.');
  };

  const handleDeleteAuth = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await run(() => {
      dbService.deletePickupAuthorization(target.id);
    }, `A eliminar autorização de ${target.personName}...`);
  };

  const handleChangeStatus = async (status: PickupAuthorization['status']) => {
    if (!statusChanging) return;
    const target = statusChanging;
    setStatusChanging(null);
    await run(() => {
      dbService.changePickupAuthorizationStatus(target.id, status, statusReason);
    }, 'A atualizar estado da autorização...');
    setStatusReason('');
  };

  const openNewPickup = () => {
    setPickupForm(emptyPickupForm());
    setPickupError('');
    setLastOutcome(null);
    setIsPickupFormOpen(true);
  };

  const handleSubmitPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      acl.guard('saude.recolha.manage', () => undefined);
      return;
    }
    if (!pickupForm.studentId) return setPickupError('Selecione o aluno.');
    let failure = '';
    let outcome: PickupRecord | undefined;
    const result = await run(() => {
      const r = dbService.registerPickup({
        studentId: pickupForm.studentId,
        date: pickupForm.date,
        time: pickupForm.time,
        authorizationId: pickupForm.authorizationId || undefined,
        personName: pickupForm.personName,
        personRelation: pickupForm.personRelation,
        personDocument: pickupForm.personDocument,
        reason: pickupForm.reason,
        reasonOther: pickupForm.reasonOther,
        guardianConfirmedBy: pickupForm.guardianConfirmedBy,
        documentVerified: pickupForm.documentVerified,
        notes: pickupForm.notes
      });
      if (!r.success) {
        failure = r.error || '';
        throw new Error(failure);
      }
      outcome = r.record;
    }, 'A registar saída do aluno...');
    if (result.ok) {
      setIsPickupFormOpen(false);
      if (outcome) setLastOutcome(outcome);
    } else {
      setPickupError(failure || result.error || 'Não foi possível registar a recolha.');
    }
  };

  const activeAuthsForPickupStudent = pickupForm.studentId
    ? activeAuthorizationsForStudent(authorizations, pickupForm.studentId, pickupForm.date).filter((a) => a.kind === 'autorizada')
    : [];

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <SectionHeader
        subsection="AUTORIZAÇÃO"
        title="AUTORIZAÇÕES DE RECOLHA"
        description="Quem pode (ou está proibido de) levar cada aluno à saída, e o registo das saídas efetivamente confirmadas à porta."
        actions={
          canManage ? (
            <>
              <button
                onClick={openNewPickup}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.98] transition-all duration-200 text-[#0b1f3a] font-bold text-xs shadow-xs shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">door_front</span>
                <span>REGISTAR SAÍDA</span>
              </button>
              <button
                onClick={openNewAuth}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all duration-200 text-white font-bold text-xs shadow-sm shrink-0 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">badge</span>
                <span>NOVA AUTORIZAÇÃO</span>
              </button>
            </>
          ) : undefined
        }
      />

      <KpiGrid
        items={[
          { label: 'Autorizações Ativas', value: activeCount, icon: 'badge' },
          { label: 'Restrições Ativas', value: forbiddenCount, icon: 'block', tone: forbiddenCount > 0 ? 'danger' : 'default' },
          { label: 'Recolhas Hoje', value: pickupsToday, icon: 'door_front' },
          { label: 'Recolhas Recusadas', value: refusedCount, icon: 'report', tone: refusedCount > 0 ? 'warn' : 'default' }
        ]}
      />

      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('autorizacoes')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer border-b-2 transition-colors ${
            tab === 'autorizacoes' ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Autorizações & Restrições
        </button>
        <button
          onClick={() => setTab('registo')}
          className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide cursor-pointer border-b-2 transition-colors ${
            tab === 'registo' ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Registo de Saídas
        </button>
      </div>

      {tab === 'autorizacoes' ? (
        <>
          <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Pesquisar por aluno, pessoa, documento ou código...">
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
              <option value="all">Autorizadas e Proibidas</option>
              <option value="autorizada">Só Autorizadas</option>
              <option value="proibida">Só Proibidas</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0 focus:ring-1 focus:ring-[#0b1f3a]">
              <option value="all">Todos os Estados</option>
              {(Object.keys(PICKUP_AUTH_STATUS_META) as PickupAuthorization['status'][]).map((s) => (
                <option key={s} value={s}>
                  {PICKUP_AUTH_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </SearchBar>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3.5 px-4 text-white">Aluno</th>
                    <th className="py-3.5 px-3 text-white">Pessoa</th>
                    <th className="py-3.5 px-3 text-white">Tipo</th>
                    <th className="py-3.5 px-3 text-white">Validade</th>
                    <th className="py-3.5 px-3 text-white">Estado</th>
                    <th className="py-3.5 px-4 text-right text-white">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuths.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                        Nenhuma autorização registada ou encontrada.
                      </td>
                    </tr>
                  ) : (
                    visibleFilteredAuths.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#0b1f3a]">{a.studentName}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">Nº {a.studentProcNumber}{a.className ? ` · ${a.className}` : ''}</div>
                        </td>
                        <td className="py-3.5 px-3 text-slate-700">
                          <div className="font-semibold">{a.personName}</div>
                          <div className="text-[11px] text-slate-500">
                            {a.relation === 'outro' ? a.relationOther || 'Outro' : PICKUP_RELATION_LABELS[a.relation]} · {a.phone}
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          <Badge tone={PICKUP_AUTH_KIND_META[a.kind].badge}>{PICKUP_AUTH_KIND_META[a.kind].label}</Badge>
                        </td>
                        <td className="py-3.5 px-3 text-slate-600">
                          {fmtDate(a.validFrom)} — {a.validUntil ? fmtDate(a.validUntil) : 'Sem termo'}
                        </td>
                        <td className="py-3.5 px-3">
                          <Badge tone={PICKUP_AUTH_STATUS_META[a.status].badge}>{PICKUP_AUTH_STATUS_META[a.status].label}</Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && (
                              <button onClick={() => openEditAuth(a)} title="Editar" className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer">
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                              </button>
                            )}
                            {canManage && a.status === 'ativa' && (
                              <button
                                onClick={() => {
                                  setStatusChanging(a);
                                  setStatusReason('');
                                }}
                                title="Suspender ou Revogar"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[18px]">block</span>
                              </button>
                            )}
                            {canManage && a.status !== 'ativa' && (
                              <button
                                onClick={() => dbService.changePickupAuthorizationStatus(a.id, 'ativa')}
                                title="Reativar"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                              </button>
                            )}
                            {canManage && (
                              <button onClick={() => setDeleting(a)} title="Eliminar" className="p-1.5 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer">
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
              <TablePagination total={filteredAuths.length} page={pgFilteredAuths} onPageChange={setPgFilteredAuths} />
            </div>
          </div>
        </>
      ) : (
        <>
          <SearchBar value={recordSearch} onChange={setRecordSearch} placeholder="Pesquisar por aluno, pessoa ou documento...">
            {canManage && (
              <button
                onClick={openNewPickup}
                className="flex items-center gap-2 px-3 h-9 rounded-lg bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">door_front</span>
                <span>Registar Saída</span>
              </button>
            )}
          </SearchBar>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <th className="py-3.5 px-4 text-white">Data & Hora</th>
                    <th className="py-3.5 px-3 text-white">Aluno</th>
                    <th className="py-3.5 px-3 text-white">Recolhido Por</th>
                    <th className="py-3.5 px-3 text-white">Motivo</th>
                    <th className="py-3.5 px-3 text-white">Resultado</th>
                    <th className="py-3.5 px-4 text-white">Registado Por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                        Nenhuma saída registada ou encontrada.
                      </td>
                    </tr>
                  ) : (
                    visibleFilteredRecords.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#0b1f3a]">{fmtDate(r.date)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{r.time}</div>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-slate-800">{r.studentName}</div>
                          <div className="text-[11px] text-slate-500">Nº {r.studentProcNumber}{r.className ? ` · ${r.className}` : ''}</div>
                        </td>
                        <td className="py-3.5 px-3 text-slate-700">
                          <div className="font-semibold">{r.personName}</div>
                          <div className="text-[11px] text-slate-500">{r.personRelation} · {r.personDocument}</div>
                        </td>
                        <td className="py-3.5 px-3 text-slate-600">
                          {r.reason === 'outro' ? r.reasonOther || 'Outro' : PICKUP_REASON_LABELS[r.reason]}
                        </td>
                        <td className="py-3.5 px-3">
                          {r.outcome === 'entregue' ? (
                            <Badge tone="bg-emerald-100 text-emerald-800">Entregue</Badge>
                          ) : (
                            <Badge tone="bg-red-100 text-red-800">Recusada</Badge>
                          )}
                          {r.outcome === 'recusada' && r.refusalReason && (
                            <div className="mt-1 text-[10px] text-red-700 max-w-[220px]">{r.refusalReason}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">{r.registeredBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <TablePagination total={filteredRecords.length} page={pgFilteredRecords} onPageChange={setPgFilteredRecords} />
            </div>
          </div>
        </>
      )}

      {/* Modal: Nova/Editar Autorização */}
      {isFormOpen && (
        <ModalShell
          title={editingId ? 'Editar Autorização de Recolha' : 'Nova Autorização de Recolha'}
          icon="badge"
          onClose={() => setIsFormOpen(false)}
        >
          <form onSubmit={handleSubmitAuth} className="flex-1 overflow-y-auto p-6 space-y-3.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <label className={labelCls}>Aluno *</label>
                <SearchableSelect
                  options={studentOptions}
                  value={form.studentId}
                  onChange={(v) => setForm({ ...form, studentId: v })}
                  placeholder="Selecione o aluno..."
                  disabled={!!editingId}
                />
              </div>
              <div>
                <label className={labelCls}>Tipo *</label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PickupAuthorizationKind })} className={inputCls}>
                  <option value="autorizada">Autorizada</option>
                  <option value="proibida">Recolha Proibida</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Concedida Via *</label>
                <select value={form.grantedVia} onChange={(e) => setForm({ ...form, grantedVia: e.target.value as PickupAuthorization['grantedVia'] })} className={inputCls}>
                  {(Object.keys(GRANTED_VIA_LABELS) as PickupAuthorization['grantedVia'][]).map((v) => (
                    <option key={v} value={v}>
                      {GRANTED_VIA_LABELS[v]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Nome da Pessoa *</label>
                <input type="text" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Parentesco/Relação *</label>
                <select value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value as PickupPersonRelation })} className={inputCls}>
                  {(Object.keys(PICKUP_RELATION_LABELS) as PickupPersonRelation[]).map((r) => (
                    <option key={r} value={r}>
                      {PICKUP_RELATION_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              {form.relation === 'outro' && (
                <div className="col-span-2">
                  <label className={labelCls}>Descreva a Relação *</label>
                  <input type="text" value={form.relationOther} onChange={(e) => setForm({ ...form, relationOther: e.target.value })} className={inputCls} />
                </div>
              )}
              <div>
                <label className={labelCls}>Telefone *</label>
                <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nº Documento de Identificação *</label>
                <input type="text" value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Válida Desde *</label>
                <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Válida Até (opcional)</label>
                <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Concedida/Solicitada Por *</label>
                <input
                  type="text"
                  value={form.grantedBy}
                  onChange={(e) => setForm({ ...form, grantedBy: e.target.value })}
                  className={inputCls}
                  placeholder="Nome do encarregado de educação, ou referência ao processo judicial/decisão da direção"
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notas</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={textareaCls} rows={2} />
              </div>
            </div>

            <FormFooter error={formError} onCancel={() => setIsFormOpen(false)} submitLabel={editingId ? 'Guardar Alterações' : 'Registar Autorização'} />
          </form>
        </ModalShell>
      )}

      {/* Modal: Registar Saída */}
      {isPickupFormOpen && (
        <ModalShell title="Registar Saída do Aluno" icon="door_front" onClose={() => setIsPickupFormOpen(false)}>
          <form onSubmit={handleSubmitPickup} className="flex-1 overflow-y-auto p-6 space-y-3.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <label className={labelCls}>Aluno *</label>
                <SearchableSelect
                  options={studentOptions}
                  value={pickupForm.studentId}
                  onChange={(v) => setPickupForm({ ...pickupForm, studentId: v, authorizationId: '' })}
                  placeholder="Selecione o aluno..."
                />
              </div>
              {activeAuthsForPickupStudent.length > 0 && (
                <div className="col-span-2">
                  <label className={labelCls}>Pessoa Pré-Autorizada (opcional)</label>
                  <select
                    value={pickupForm.authorizationId}
                    onChange={(e) => {
                      const auth = activeAuthsForPickupStudent.find((a) => a.id === e.target.value);
                      setPickupForm({
                        ...pickupForm,
                        authorizationId: e.target.value,
                        personName: auth?.personName || pickupForm.personName,
                        personRelation: auth ? (auth.relation === 'outro' ? auth.relationOther || 'Outro' : PICKUP_RELATION_LABELS[auth.relation]) : pickupForm.personRelation,
                        personDocument: auth?.documentNumber || pickupForm.personDocument
                      });
                    }}
                    className={inputCls}
                  >
                    <option value="">Selecionar manualmente abaixo...</option>
                    {activeAuthsForPickupStudent.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.personName} ({PICKUP_RELATION_LABELS[a.relation]})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls}>Data *</label>
                <input type="date" value={pickupForm.date} onChange={(e) => setPickupForm({ ...pickupForm, date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Hora *</label>
                <input type="time" value={pickupForm.time} onChange={(e) => setPickupForm({ ...pickupForm, time: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nome de Quem Recolhe *</label>
                <input type="text" value={pickupForm.personName} onChange={(e) => setPickupForm({ ...pickupForm, personName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Parentesco/Relação *</label>
                <input type="text" value={pickupForm.personRelation} onChange={(e) => setPickupForm({ ...pickupForm, personRelation: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Nº Documento Apresentado *</label>
                <input type="text" value={pickupForm.personDocument} onChange={(e) => setPickupForm({ ...pickupForm, personDocument: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Motivo *</label>
                <select value={pickupForm.reason} onChange={(e) => setPickupForm({ ...pickupForm, reason: e.target.value as PickupReason })} className={inputCls}>
                  {(Object.keys(PICKUP_REASON_LABELS) as PickupReason[]).map((r) => (
                    <option key={r} value={r}>
                      {PICKUP_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              {pickupForm.reason === 'outro' && (
                <div className="col-span-2">
                  <label className={labelCls}>Descreva o Motivo *</label>
                  <input type="text" value={pickupForm.reasonOther} onChange={(e) => setPickupForm({ ...pickupForm, reasonOther: e.target.value })} className={inputCls} />
                </div>
              )}
              <div className="col-span-2">
                <label className={labelCls}>Confirmado com o Encarregado Por (opcional)</label>
                <input
                  type="text"
                  value={pickupForm.guardianConfirmedBy}
                  onChange={(e) => setPickupForm({ ...pickupForm, guardianConfirmedBy: e.target.value })}
                  className={inputCls}
                  placeholder="Preencher se houve confirmação telefónica adicional"
                />
              </div>
              <div className="col-span-2">
                <label className={checkboxRowCls}>
                  <input type="checkbox" checked={pickupForm.documentVerified} onChange={(e) => setPickupForm({ ...pickupForm, documentVerified: e.target.checked })} />
                  Documento de identificação verificado presencialmente
                </label>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notas</label>
                <textarea value={pickupForm.notes} onChange={(e) => setPickupForm({ ...pickupForm, notes: e.target.value })} className={textareaCls} rows={2} />
              </div>
            </div>

            <FormFooter error={pickupError} onCancel={() => setIsPickupFormOpen(false)} submitLabel="Registar Saída" submitIcon="door_front" />
          </form>
        </ModalShell>
      )}

      {/* Aviso de Resultado (após registo de saída) */}
      {lastOutcome && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setLastOutcome(null)}
        >
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300" onClick={(e) => e.stopPropagation()}>
            <FormModalHeader
              title={lastOutcome.outcome === 'entregue' ? 'Saída Registada' : 'Recolha Recusada'}
              icon={lastOutcome.outcome === 'entregue' ? 'check_circle' : 'block'}
              onClose={() => setLastOutcome(null)}
            />
            <div className="p-6 text-center">
              <span
                className={`material-symbols-outlined text-[40px] ${lastOutcome.outcome === 'entregue' ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {lastOutcome.outcome === 'entregue' ? 'check_circle' : 'block'}
              </span>
              <h3 className="font-headline text-lg font-bold text-slate-900 mt-2">
                {lastOutcome.studentName} — {lastOutcome.outcome === 'entregue' ? 'entregue a' : 'recolha recusada a'} {lastOutcome.personName}
              </h3>
              {lastOutcome.refusalReason && <p className="text-xs text-red-700 mt-2 leading-relaxed">{lastOutcome.refusalReason}</p>}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end">
              <button onClick={() => setLastOutcome(null)} className="px-4 py-2.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer border-none">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Suspender/Revogar Autorização */}
      {statusChanging && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full shadow-2xl overflow-hidden border border-slate-300">
            <FormModalHeader title="Suspender ou Revogar Autorização" icon="block" onClose={() => setStatusChanging(null)} />
            <div className="p-6 space-y-3">
              <p className="text-xs text-slate-600">
                Autorização de <span className="font-bold">{statusChanging.personName}</span> para recolher{' '}
                <span className="font-bold">{statusChanging.studentName}</span>.
              </p>
              <div>
                <label className={labelCls}>Motivo (opcional)</label>
                <input type="text" value={statusReason} onChange={(e) => setStatusReason(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setStatusChanging(null)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer border border-slate-300">
                Cancelar
              </button>
              <button type="button" onClick={() => handleChangeStatus('suspensa')} className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs cursor-pointer border-none">
                Suspender
              </button>
              <button type="button" onClick={() => handleChangeStatus('revogada')} className="px-4 py-2.5 bg-[#b91c1c] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer border-none">
                Revogar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <DeleteModal
          title="Eliminar Autorização"
          name={deleting.personName}
          code={deleting.code}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDeleteAuth}
        />
      )}
    </div>
  );
}

// =============================================================================
// COMPONENTE PRINCIPAL — dispatcher das 3 subsecções
// =============================================================================

export function SaudeSegurancaView({ db, currentUserRole, section = 'saude_ficha_medica' }: SaudeSegurancaViewProps) {
  if (section === 'saude_incidentes') return <IncidentesSection db={db} currentUserRole={currentUserRole} />;
  if (section === 'saude_recolha') return <RecolhaSection db={db} currentUserRole={currentUserRole} />;
  return <FichaMedicaSection db={db} currentUserRole={currentUserRole} />;
}
