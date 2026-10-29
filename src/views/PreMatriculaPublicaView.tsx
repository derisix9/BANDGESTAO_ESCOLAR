import React, { useEffect, useMemo, useState } from 'react';
import { dbService } from '../services/db';
import { getAvailableGrades } from '../utils/educationSubsystems';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { nextAcademicYearLabel } from '../utils/academicCalendar';
import { compressImageFile } from '../utils/imageCompressor';
import { ATTACHMENT_LIMITS, DEFAULT_ADMISSION_DOCUMENTS, REQUIRED_ADMISSION_DOCS, formatBytes } from '../utils/admissions';
import { ageOn } from '../utils/admissions';
import { PUBLIC_STATUS_TEXT, buildInscriptionSheetHtml, canComplain } from '../utils/publicAdmission';
import { ADMISSION_COMPLAINT_REASONS } from '../types';
import type { AdmissionComplaint, PublicAdmissionConfig, PublicAdmissionDocument, PublicAdmissionStatus } from '../types';
import { Notice } from '../components/Notice';
import { printWhenReady } from '../utils/printWindow';

/**
 * Formulário público de Pré-Matrícula Online.
 *
 * Acedido sem qualquer autenticação (link partilhado pela escola — ver botão
 * "Link Pré-Matrícula Online" em Serviços → Admissões).
 * Recolhe exatamente os mesmos dados que a Secretaria preenche manualmente
 * nessa secção, MENOS os campos de avaliação (nota/data de teste), que só
 * fazem sentido depois de a candidatura ser recebida internamente.
 *
 * A submissão não escreve nos dados internos da escola: fica guardada num nó
 * próprio, só de escrita pública (RPC public_admission_submit, migração 0009), e só passa a ser
 * uma candidatura normal quando a Secretaria a importa em Admissões — ponto
 * em que todos os dados passam a residir mesmo na secção Pré-Matrícula.
 */

interface PublicForm {
  academicYear: string;
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
  previousResult: '' | 'Aprovado' | 'Reprovado' | 'Transferido' | 'Desistente' | 'Primeira Matrícula';
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  guardianEmail: string;
  guardianNif: string;
  fatherName: string;
  motherName: string;
}

const inputCls =
  'w-full h-11 px-3.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg text-sm placeholder:text-slate-400 focus:bg-white focus:border-[#0b1f3a] focus:ring-2 focus:ring-[#0b1f3a]/15 focus:outline-none transition-all';
const areaCls =
  'w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg text-sm placeholder:text-slate-400 focus:bg-white focus:border-[#0b1f3a] focus:ring-2 focus:ring-[#0b1f3a]/15 focus:outline-none transition-all';
const labelCls = 'block font-semibold text-slate-600 mb-1.5 text-[11px] uppercase tracking-wider';
const RESULTS: PublicForm['previousResult'][] = ['Primeira Matrícula', 'Aprovado', 'Reprovado', 'Transferido', 'Desistente'];
const SHIFTS = ['Manhã', 'Tarde', 'Integral', 'Pós-Laboral', 'Noite'];

const emptyForm = (academicYear: string): PublicForm => ({
  academicYear,
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
  motherName: ''
});

const clean = (v: string) => (v && v.trim() ? v.trim() : undefined);

const Section: React.FC<{ step: number; icon: string; title: string; hint?: string; children: React.ReactNode }> = ({ step, icon, title, hint, children }) => (
  <section className="bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-shadow p-5 sm:p-7 flex flex-col gap-4">
    <header className="flex items-center gap-3 pb-3 border-b border-slate-100">
      <div className="relative shrink-0">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0b1f3a] to-[#12315c] text-white flex items-center justify-center shadow-sm">
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        </div>
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#7a0c0c] text-white text-[10px] font-bold flex items-center justify-center shadow">
          {step}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="font-headline font-bold text-slate-900 text-sm sm:text-base tracking-tight">{title}</h2>
        
      </div>
    </header>
    {children}
  </section>
);

export const PreMatriculaPublicaView: React.FC<{ schoolName?: string }> = ({ schoolName }) => {
  // Anos lectivos cadastrados na instituição (publicados pelo admin); sem eles, só o ano pela data.
  const [publicYears, setPublicYears] = useState<{ current: string; years: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    dbService.fetchPublicAcademicYears().then((r) => { if (alive) setPublicYears(r); });
    return () => { alive = false; };
  }, []);
  const yearOptions = useMemo(
    () => (publicYears ? [...publicYears.years].sort().reverse() : [getFallbackAcademicYear()]),
    [publicYears]
  );
  const currentYear = publicYears?.current || yearOptions[0];
  const nextYear = nextAcademicYearLabel(currentYear);
  const defaultYear = yearOptions.includes(nextYear) ? nextYear : currentYear;
  useEffect(() => {
    setForm((f) => (yearOptions.includes(f.academicYear) ? f : { ...f, academicYear: defaultYear }));
  }, [yearOptions, defaultYear]);
  const gradeOptions = useMemo(() => getAvailableGrades(), []);

  const [form, setForm] = useState<PublicForm>(emptyForm(defaultYear));
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [publicRef, setPublicRef] = useState('');
  const [tab, setTab] = useState<'candidatura' | 'consultar'>('candidatura');
  const [cfg, setCfg] = useState<PublicAdmissionConfig | null>(null);
  // Cursos ativos cadastrados na escola (publicados no estado do link público).
  const courseOptions = useMemo(() => (cfg?.courses || []).filter((c) => c && c.name), [cfg]);
  // Reclamação (candidato rejeitado ou com nota 0–9)
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [cmpReason, setCmpReason] = useState('');
  const [cmpText, setCmpText] = useState('');
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpError, setCmpError] = useState('');
  const [cmpSent, setCmpSent] = useState(false);
  const [cmpExisting, setCmpExisting] = useState<AdmissionComplaint | null>(null);
  const [step, setStep] = useState(1);
  // Protecção contra duplo clique: o 2.º clique em "Próximo" caía no botão "Enviar" (que aparece no mesmo
  // sítio) e a candidatura seguia sem documentos. O envio só arma ~1,5 s depois de chegar à última fase.
  const [sendArmed, setSendArmed] = useState(false);
  // Consulta
  const [cId, setCId] = useState('');
  const [cDob, setCDob] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState('');
  const [cRecord, setCRecord] = useState<PublicAdmissionStatus | null>(null);
  useEffect(() => {
    let alive = true;
    dbService.fetchPublicAdmissionConfig().then((c) => {
      if (!alive) return;
      setCfg(c);
      if (c.blocked && !c.deleted) setTab('consultar');
    });
    return () => { alive = false; };
  }, []);
  // Documentos anexados no ato da inscrição (opcionais), por chave de documento.
  const [files, setFiles] = useState<Record<string, PublicAdmissionDocument>>({});
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof PublicForm>(key: K, value: PublicForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const setFileError = (key: string, msg: string) => setFileErrors((f) => ({ ...f, [key]: msg }));

  const handlePickFile = async (key: string, label: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // permite voltar a escolher o mesmo ficheiro
    if (!file) return;
    setFileError(key, '');

    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isImage && !isPdf) {
      setFileError(key, 'Formato não suportado. Envie uma fotografia (JPG/PNG) ou um PDF.');
      return;
    }
    if (isPdf && file.size > ATTACHMENT_LIMITS.pdfMaxBytes) {
      setFileError(
        key,
        `O PDF tem ${formatBytes(file.size)} — o máximo é ${formatBytes(ATTACHMENT_LIMITS.pdfMaxBytes)}. Envie antes uma fotografia do documento.`
      );
      return;
    }
    if (isImage && file.size > ATTACHMENT_LIMITS.imageMaxInputBytes) {
      setFileError(key, 'A imagem é demasiado grande (máx. 15 MB).');
      return;
    }

    setFileBusy(key);
    try {
      const dataUrl = await compressImageFile(
        file,
        ATTACHMENT_LIMITS.imageMaxSide,
        ATTACHMENT_LIMITS.imageMaxSide,
        ATTACHMENT_LIMITS.imageQuality
      );
      if (!dataUrl || dataUrl.length > ATTACHMENT_LIMITS.maxDataUrlChars) {
        setFileError(key, 'Não foi possível reduzir este ficheiro. Tente uma imagem mais leve.');
        return;
      }
      const others = (Object.values(files) as PublicAdmissionDocument[])
        .filter((f) => f.key !== key)
        .reduce((sum, f) => sum + f.dataUrl.length, 0);
      if (others + dataUrl.length > ATTACHMENT_LIMITS.maxTotalChars) {
        setFileError(key, 'O total de anexos é demasiado grande. Remova algum anexo ou entregue-o depois na Secretaria.');
        return;
      }
      const mimeType = isImage ? 'image/jpeg' : 'application/pdf';
      setFiles((f) => ({
        ...f,
        [key]: { key, label, fileName: file.name, mimeType, size: file.size, dataUrl }
      }));
    } catch {
      setFileError(key, 'Não foi possível ler o ficheiro. Tente novamente.');
    } finally {
      setFileBusy(null);
    }
  };

  const removeFile = (key: string) => {
    setFiles((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
    setFileError(key, '');
  };

  const STEPS = [
    { n: 1, label: 'Vaga', icon: 'school' },
    { n: 2, label: 'Candidato', icon: 'person' },
    { n: 3, label: 'Escola', icon: 'history_edu' },
    { n: 4, label: 'Encarregado', icon: 'family_restroom' },
    { n: 5, label: 'Documentos', icon: 'attach_file' }
  ];
  const LAST = STEPS.length;
  useEffect(() => {
    setSendArmed(false);
    if (step < LAST) return;
    const t = window.setTimeout(() => setSendArmed(true), 1500);
    return () => window.clearTimeout(t);
  }, [step, LAST]);
  const emailRe = /^\S+@\S+\.\S+$/;

  /** Valida só os campos da fase actual, antes de avançar. */
  const validateStep = (n: number): string[] => {
    const e: string[] = [];
    if (n === 1) {
      if (!form.academicYear.trim()) e.push('Indique o ano letivo pretendido.');
      if (!form.desiredGrade.trim()) e.push('Escolha a classe pretendida.');
    }
    if (n === 2) {
      if (form.name.trim().split(/\s+/).filter(Boolean).length < 2) e.push('Indique o nome completo (nome e apelido) do candidato.');
      const age = ageOn(form.birthDate);
      if (!form.birthDate) e.push('Indique a data de nascimento do candidato.');
      else if (age === null) e.push('A data de nascimento não é válida.');
      else if (age < 0) e.push('A data de nascimento não pode estar no futuro.');
      else if (age > 60) e.push('A data de nascimento indicada resulta numa idade superior a 60 anos — confirme-a.');
      if (form.email.trim() && !emailRe.test(form.email.trim())) e.push('O e-mail do candidato não é válido.');
    }
    if (n === 4) {
      if (!form.guardianName.trim()) e.push('Indique o nome do Encarregado de Educação.');
      if (!form.guardianRelation.trim()) e.push('Indique o grau de parentesco do Encarregado.');
      if (!form.guardianPhone.trim()) e.push('Indique um telefone de contacto do Encarregado.');
      if (form.guardianEmail.trim() && !emailRe.test(form.guardianEmail.trim())) e.push('O e-mail do Encarregado não é válido.');
    }
    if (n === 5) {
      // B.I. e certificado são obrigatórios; os restantes documentos continuam opcionais.
      for (const d of DEFAULT_ADMISSION_DOCUMENTS) {
        if (REQUIRED_ADMISSION_DOCS.includes(d.key) && !files[d.key]) e.push(`Anexe o documento obrigatório: ${d.label}.`);
      }
    }
    return e;
  };

  const scrollTop = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const goNext = () => {
    const e = validateStep(step);
    setErrors(e);
    if (e.length > 0) return scrollTop();
    setStep((x) => Math.min(LAST, x + 1));
    scrollTop();
  };
  const goPrev = () => { setErrors([]); setStep((x) => Math.max(1, x - 1)); scrollTop(); };

  // O envio só acontece por clique deliberado em "Enviar" (ver `sendCandidatura`). O <form> nunca
  // submete sozinho: Enter / troca de botão nas fases anteriores apenas avança de fase.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < LAST) goNext();
  };

  const sendCandidatura = async (ev?: React.MouseEvent) => {
    if (step < LAST || submitting || !sendArmed) return;
    if (ev && (ev.detail > 1 || !ev.isTrusted)) return; // duplo clique / clique sintético não enviam
    for (let n = 1; n <= LAST; n++) {
      const err = validateStep(n);
      if (err.length > 0) { setErrors(err); setStep(n); return scrollTop(); }
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const result = await dbService.submitPublicAdmissionRequest({
        academicYear: form.academicYear,
        name: form.name.trim(),
        gender: form.gender,
        birthDate: form.birthDate,
        nationality: form.nationality.trim() || 'Angolana',
        birthPlace: clean(form.birthPlace),
        biNumber: clean(form.biNumber)?.toUpperCase(),
        address: clean(form.address),
        phone: clean(form.phone),
        email: clean(form.email),
        specialNeedsNote: clean(form.specialNeedsNote),
        desiredGrade: form.desiredGrade,
        desiredCourse: clean(form.desiredCourse),
        desiredShift: clean(form.desiredShift),
        previousSchool: clean(form.previousSchool),
        lastCompletedGrade: clean(form.lastCompletedGrade),
        previousResult: form.previousResult || undefined,
        guardianName: form.guardianName.trim(),
        guardianRelation: form.guardianRelation.trim(),
        guardianPhone: form.guardianPhone.trim(),
        guardianEmail: clean(form.guardianEmail),
        guardianNif: clean(form.guardianNif),
        fatherName: clean(form.fatherName),
        motherName: clean(form.motherName),
        documents: Object.values(files).length > 0 ? Object.values(files) : undefined
      } as any);
      if (result.success) {
        setPublicRef(result.publicRef || '');
        setDone(true);
      } else {
        setErrors(result.errors?.length ? result.errors : [result.error || 'Não foi possível enviar a candidatura.']);
        scrollTop();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCError('');
    setCRecord(null);
    setCBusy(true);
    try {
      const r = await dbService.lookupPublicAdmission(cId, cDob);
      if (r.success && r.record) {
        setCRecord(r.record);
        setCmpExisting(null);
        // Reclamação já feita (só se as reclamações estiverem liberadas).
        if (canComplain(r.record) && !cfg?.complaintsBlocked) {
          setCmpExisting(await dbService.fetchPublicAdmissionComplaint(r.record.rk));
        }
      }
      else setCError(r.error || 'Não foi possível consultar.');
    } finally {
      setCBusy(false);
    }
  };

  const printSheet = (rec: PublicAdmissionStatus) => {
    const w = window.open('', '_blank');
    if (!w) { setCError('O navegador bloqueou a janela de impressão. Permita pop-ups e tente de novo.'); return; }
    w.document.write(buildInscriptionSheetHtml(rec, { name: displaySchoolName, logo: cfg?.logoUrl || undefined }));
    w.document.close();
    printWhenReady(w);
  };

  const resetForm = () => {
    setForm(emptyForm(defaultYear));
    setFiles({});
    setFileErrors({});
    setErrors([]);
    setStep(1);
    setPublicRef('');
    setDone(false);
  };

  const tone: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-red-50 text-[#7a0c0c] border-red-200'
  };

  const displaySchoolName = cfg?.schoolName || schoolName || 'Complexo Escolar';

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1f3a] via-[#0e2a50] to-[#eff4ff] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center flex flex-col items-center gap-4 border border-slate-100">{children}</div>
    </div>
  );

  if (cfg === null) {
    return shell(<span className="material-symbols-outlined text-[40px] text-slate-300 animate-pulse">hourglass_top</span>);
  }

  if (cfg.deleted) {
    return shell(
      <>
        <div className="w-20 h-20 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
          <span className="material-symbols-outlined text-[44px]">link_off</span>
        </div>
        <h1 className="font-headline text-xl font-extrabold text-[#0b1f3a]">Link não disponível</h1>
        <p className="text-sm text-slate-500 leading-relaxed">As candidaturas online desta instituição já terminaram. Para qualquer informação, contacte a Secretaria da escola.</p>
      </>
    );
  }

  if (done) {
    return shell(
      <>
        <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 text-emerald-600 flex items-center justify-center">
          <span className="material-symbols-outlined text-[44px]">check_circle</span>
        </div>
        <div>
          <h1 className="font-headline text-2xl font-extrabold text-[#0b1f3a] tracking-tight">Candidatura enviada!</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Recebemos a pré-matrícula de <strong className="text-slate-700">{form.name}</strong> para o ano letivo{' '}
            <strong className="text-slate-700">{form.academicYear}</strong>. A Secretaria vai analisar os dados e entra em contacto através do telefone ou e-mail indicados.
          </p>
        </div>
        {publicRef && (
          <div className="w-full rounded-2xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">O seu nº de Pré-Matrícula</div>
            <div className="font-mono text-2xl font-black text-[#0b1f3a] tracking-wider mt-1">{publicRef}</div>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">Guarde este número. Com ele e a data de nascimento do candidato pode consultar o estado da candidatura.</p>
          </div>
        )}
        <div className="w-full h-px bg-slate-100" />
        <div className="flex flex-wrap gap-2 justify-center">
          {publicRef && (
            <button type="button" onClick={() => { setCId(publicRef); setCDob(form.birthDate); setCRecord(null); setCError(''); setTab('consultar'); resetForm(); }} className="px-5 py-3 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">search</span>
              Consultar estado
            </button>
          )}
          <button type="button" onClick={() => { setTab('candidatura'); resetForm(); }} className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-xs cursor-pointer transition-colors flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Nova candidatura
          </button>
        </div>
      </>
    );
  }

  const Field: React.FC<{ k: string; v?: string }> = ({ k, v }) =>
    v ? (
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k}</div>
        <div className="text-sm font-semibold text-slate-800 break-words">{v}</div>
      </div>
    ) : null;
  const fmt = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '');

  return (
    <div className="pm-page min-h-screen bg-[#eef2f9]">
      {/* Cabeçalho institucional */}
      <div className="pm-hero relative text-white overflow-hidden">
        <div className="relative max-w-3xl mx-auto px-4 pt-10 pb-16 sm:pt-14 sm:pb-20 flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-2xl p-2 shadow-lg flex items-center justify-center">
            {cfg.logoUrl ? (
              <img src={cfg.logoUrl} alt={`Logótipo de ${displaySchoolName}`} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            ) : (
              <span className="material-symbols-outlined text-[36px] sm:text-[44px] text-[#0b1f3a]">school</span>
            )}
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">{displaySchoolName}</span>
          <h1 className="font-headline text-3xl sm:text-4xl font-extrabold tracking-tight">CANDIDATURAS ONLINE</h1>
          <p className="text-xs sm:text-sm text-blue-100/90 max-w-lg leading-relaxed">
            Garanta a vaga do seu educando sem sair de casa, ou consulte o estado de uma candidatura já enviada.
          </p>
          <div className="pm-tabs flex items-center justify-center gap-2 mt-2 bg-white border border-white/40 rounded-2xl p-1.5 shadow-sm">
            {([['candidatura', 'edit_note', 'Candidatura'], ['consultar', 'manage_search', 'Consultar']] as const).map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => { setTab(id); setErrors([]); }}
                className={`pm-tab flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs uppercase tracking-wide cursor-pointer transition-colors ${tab === id ? 'pm-tab-active bg-[#0b1f3a] text-white font-extrabold shadow' : 'pm-tab-idle text-black font-extrabold hover:bg-slate-100'}`}
              >
                <span className="material-symbols-outlined text-[18px]">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'candidatura' && cfg.blocked && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-8 pb-12 relative z-10">
          <div className="bg-white border border-amber-200 rounded-2xl shadow-sm p-8 text-center flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[40px] text-amber-600">lock</span>
            <h2 className="font-headline text-lg font-extrabold text-[#0b1f3a]">Candidaturas encerradas</h2>
            <p className="text-sm text-slate-500 max-w-md">De momento a escola não está a receber novas candidaturas online. Se já enviou a sua, pode consultar o estado no separador “Consultar”.</p>
            <button type="button" onClick={() => setTab('consultar')} className="mt-1 px-5 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Ir para Consultar</button>
          </div>
        </div>
      )}

      {tab === 'candidatura' && !cfg.blocked && (
        <form onSubmit={handleSubmit} className="max-w-6xl mx-auto px-4 sm:px-6 -mt-8 pb-12 flex flex-col gap-5 relative z-10">
          {/* Indicador de fases */}
          <nav className="bg-white border border-slate-200/80 rounded-2xl shadow-sm px-3 py-3 sm:px-5" aria-label="Fases da candidatura">
            <ol className="flex items-center justify-between gap-1">
              {STEPS.map((st, i) => {
                const state = st.n < step ? 'done' : st.n === step ? 'current' : 'todo';
                return (
                  <li key={st.n} className="flex items-center flex-1 last:flex-none min-w-0">
                    <div className="flex flex-col items-center gap-1 min-w-0">
                      <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${state === 'done' ? 'bg-emerald-600 border-emerald-600 text-white' : state === 'current' ? 'bg-[#0b1f3a] border-[#0b1f3a] text-white' : 'bg-white border-slate-300 text-slate-400'}`}>
                        {state === 'done' ? <span className="material-symbols-outlined text-[18px]">check</span> : st.n}
                      </span>
                      <span className={`hidden sm:block text-[10px] font-bold uppercase tracking-wide truncate ${state === 'todo' ? 'text-slate-400' : 'text-[#0b1f3a]'}`}>{st.label}</span>
                    </div>
                    {i < STEPS.length - 1 && <span className={`flex-1 h-0.5 mx-1.5 sm:mx-2 rounded ${st.n < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
                  </li>
                );
              })}
            </ol>
            <p className="sm:hidden text-center text-[11px] font-bold uppercase tracking-wide text-[#0b1f3a] mt-2">Fase {step} de {LAST} · {STEPS[step - 1].label}</p>
          </nav>

          {errors.length > 0 && (
            <Notice tone="error">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[11px]">
                <span className="material-symbols-outlined text-[16px]">error</span>
                Verifique os campos abaixo
              </span>
              {errors.map((err, i) => (
                <span key={i}>• {err}</span>
              ))}
            </Notice>
          )}

          {step === 1 && (
          <Section step={1} icon="school" title="Vaga Pretendida" hint="Ano letivo, classe e turno">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Ano Letivo *</label>
              <select className={inputCls} value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Classe Pretendida *</label>
              <select className={inputCls} value={form.desiredGrade} onChange={(e) => set('desiredGrade', e.target.value)} required>
                <option value="">Selecione…</option>
                {gradeOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Turno Pretendido</label>
              <select className={inputCls} value={form.desiredShift} onChange={(e) => set('desiredShift', e.target.value)}>
                <option value="">Sem preferência</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Curso / Área (se aplicável)</label>
            {courseOptions.length > 0 ? (
              <select className={inputCls} value={form.desiredCourse} onChange={(e) => set('desiredCourse', e.target.value)}>
                <option value="">Não se aplica / sem preferência</option>
                {courseOptions.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {/* Valor antigo (ex.: rascunho) que já não consta da lista continua visível. */}
                {form.desiredCourse && !courseOptions.some((c) => c.name === form.desiredCourse) && (
                  <option value={form.desiredCourse}>{form.desiredCourse}</option>
                )}
              </select>
            ) : (
              <input className={inputCls} placeholder="Ex.: Ciências Físicas e Biológicas" value={form.desiredCourse} onChange={(e) => set('desiredCourse', e.target.value)} />
            )}
          </div>
        </Section>
          )}

          {step === 2 && (
          <Section step={2} icon="person" title="Dados do Candidato" hint="Identificação do aluno">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome Completo *</label>
              <input className={inputCls} placeholder="Nome tal como está no Bilhete de Identidade" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Género *</label>
              <select className={inputCls} value={form.gender} onChange={(e) => set('gender', e.target.value as any)}>
                <option value="Masculino">Masculino</option>
                <option value="Feminino">Feminino</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Data de Nascimento *</label>
              <input type="date" className={inputCls} value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Nacionalidade</label>
              <input className={inputCls} value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Naturalidade</label>
              <input className={inputCls} placeholder="Província / Município de nascimento" value={form.birthPlace} onChange={(e) => set('birthPlace', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Nº do B.I. (se tiver)</label>
              <input className={inputCls} value={form.biNumber} onChange={(e) => set('biNumber', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Telefone de Contacto</label>
              <input className={inputCls} placeholder="9XX XXX XXX" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Endereço</label>
              <input className={inputCls} placeholder="Bairro, rua e ponto de referência" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>E-mail do Candidato</label>
              <input type="email" className={inputCls} placeholder="exemplo@email.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Necessidades Especiais / Observações de Saúde</label>
              <textarea rows={2} className={areaCls} placeholder="Alergias, medicação, mobilidade… (opcional)" value={form.specialNeedsNote} onChange={(e) => set('specialNeedsNote', e.target.value)} />
            </div>
          </div>
        </Section>
          )}

          {step === 3 && (
          <Section step={3} icon="history_edu" title="Proveniência Escolar" hint="De onde vem o candidato">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Escola Anterior</label>
              <input className={inputCls} value={form.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Última Classe Concluída</label>
              <input className={inputCls} value={form.lastCompletedGrade} onChange={(e) => set('lastCompletedGrade', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Situação</label>
              <select className={inputCls} value={form.previousResult} onChange={(e) => set('previousResult', e.target.value as any)}>
                <option value="">— Não indicado —</option>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
          )}

          {step === 4 && (
          <Section step={4} icon="family_restroom" title="Encarregado de Educação" hint="Quem responde pelo aluno">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Nome Completo *</label>
              <input className={inputCls} value={form.guardianName} onChange={(e) => set('guardianName', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Grau de Parentesco *</label>
              <input
                className={inputCls}
                placeholder="Pai, Mãe, Tio(a)…"
                value={form.guardianRelation}
                onChange={(e) => set('guardianRelation', e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Telefone de Contacto *</label>
              <input className={inputCls} placeholder="9XX XXX XXX" value={form.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>E-mail</label>
              <input type="email" className={inputCls} placeholder="exemplo@email.com" value={form.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>NIF</label>
              <input className={inputCls} value={form.guardianNif} onChange={(e) => set('guardianNif', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Nome do Pai</label>
              <input className={inputCls} value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Nome da Mãe</label>
              <input className={inputCls} value={form.motherName} onChange={(e) => set('motherName', e.target.value)} />
            </div>
          </div>
        </Section>
          )}

          {step === 5 && (
          <Section step={5} icon="attach_file" title="Documentos" hint="Obrigatórios: B.I. e certificado. Os restantes são opcionais e pode entregá-los depois na Secretaria">
          <div className="flex flex-col gap-3">
            {DEFAULT_ADMISSION_DOCUMENTS.map((d) => {
              const f = files[d.key];
              const busy = fileBusy === d.key;
              return (
                <div
                  key={d.key}
                  className={`rounded-xl border p-3.5 flex flex-col gap-2 transition-colors ${
                    f ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 min-w-0 break-words">
                      {d.label}{' '}
                      {REQUIRED_ADMISSION_DOCS.includes(d.key)
                        ? <span className="text-red-600" title="Obrigatório">*</span>
                        : <span className="text-[10px] font-medium text-slate-400">(opcional)</span>}
                    </span>
                    {f && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-700">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        Anexado
                      </span>
                    )}
                  </div>
                  {f ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">
                        {f.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}
                      </span>
                      <span className="min-w-0 break-all">{f.fileName}</span>
                      <span className="text-slate-400">({formatBytes(f.dataUrl.length * 0.75)})</span>
                      <button
                        type="button"
                        onClick={() => removeFile(d.key)}
                        className="ml-auto px-2.5 py-1 rounded-lg border border-red-200 text-[#7a0c0c] font-bold hover:bg-red-50 cursor-pointer transition-colors"
                      >
                        Remover
                      </button>
                    </div>
                  ) : (
                    <label
                      className={`inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg border-2 border-dashed border-slate-300 text-xs font-bold text-[#0b1f3a] bg-white cursor-pointer hover:border-[#0b1f3a] hover:bg-slate-50 transition-all ${
                        busy ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{busy ? 'hourglass_top' : 'upload_file'}</span>
                      <span>{busy ? 'A processar…' : 'Escolher ficheiro ou tirar foto'}</span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => handlePickFile(d.key, d.label, e)}
                      />
                    </label>
                  )}
                  {fileErrors[d.key] && <span className="text-[11px] font-semibold text-[#7a0c0c]">{fileErrors[d.key]}</span>}
                </div>
              );
            })}
          </div>
        </Section>
          )}

          {/* Navegação entre fases */}
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button type="button" onClick={goPrev} disabled={submitting} className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-[#0b1f3a] font-extrabold text-sm uppercase tracking-wide cursor-pointer transition-colors">
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                Anterior
              </button>
            )}
            {step < LAST ? (
              <button key="btn-next" type="button" onClick={goNext} className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-[#0b1f3a] to-[#12315c] hover:from-[#7a0c0c] hover:to-[#8f1010] text-white font-extrabold text-sm uppercase tracking-wide cursor-pointer transition-all shadow-lg">
                Próximo
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
              </button>
            ) : (
              <button key="btn-send" type="button" onClick={sendCandidatura} disabled={submitting || !!fileBusy || !sendArmed} className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-[#0b1f3a] to-[#12315c] hover:from-[#7a0c0c] hover:to-[#8f1010] disabled:opacity-60 text-white font-extrabold text-sm uppercase tracking-wide cursor-pointer transition-all shadow-lg flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[20px]">{submitting ? 'hourglass_top' : 'send'}</span>
                <span>{submitting ? 'A ENVIAR…' : 'ENVIAR CANDIDATURA'}</span>
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            Os seus dados servem apenas para o processo de admissão desta instituição.
          </p>
        </form>
      )}

      {tab === 'consultar' && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-8 pb-12 flex flex-col gap-5 relative z-10">
          <form onSubmit={handleLookup} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 sm:p-7 flex flex-col gap-4">
            <header className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0b1f3a] to-[#12315c] text-white flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-[22px]">manage_search</span>
              </div>
              <div>
                <h2 className="font-headline font-bold text-slate-900 text-sm sm:text-base tracking-tight">Consultar candidatura</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Use o nº do B.I. ou o nº de Pré-Matrícula, e a data de nascimento do candidato</p>
              </div>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Nº do B.I. ou nº de Pré-Matrícula *</label>
                <input className={inputCls} placeholder="Ex.: 001234567LA045 ou PM-7K3Q9XAB" value={cId} onChange={(e) => setCId(e.target.value)} required />
              </div>
              <div>
                <label className={labelCls}>Data de nascimento do candidato *</label>
                <input type="date" className={inputCls} value={cDob} onChange={(e) => setCDob(e.target.value)} required />
              </div>
            </div>
            {cError && (
              <Notice tone="error" icon="error">
                {cError}
              </Notice>
            )}
            <button type="submit" disabled={cBusy} className="py-3.5 rounded-xl bg-gradient-to-r from-[#0b1f3a] to-[#12315c] hover:from-[#7a0c0c] hover:to-[#8f1010] disabled:opacity-60 text-white font-extrabold text-sm uppercase tracking-wide cursor-pointer transition-all flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[20px]">{cBusy ? 'hourglass_top' : 'search'}</span>
              {cBusy ? 'A CONSULTAR…' : 'CONSULTAR'}
            </button>
          </form>

          {cRecord && (() => {
            const meta = PUBLIC_STATUS_TEXT[cRecord.status] || PUBLIC_STATUS_TEXT.recebida;
            const hasScore = typeof cRecord.assessmentScore === 'number';
            return (
              <section className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-5 sm:p-7 flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row gap-5">
                  <div className="w-28 h-36 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0 mx-auto sm:mx-0">
                    {cRecord.photo ? <img src={cRecord.photo} alt="Fotografia do candidato" className="w-full h-full object-cover" /> : <span className="material-symbols-outlined text-[44px] text-slate-300">account_circle</span>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{cRecord.code ? 'Código da candidatura' : 'Nº de Pré-Matrícula'}</div>
                    <div className="font-mono text-xl font-black text-[#0b1f3a]">{cRecord.code || cRecord.ref}</div>
                    <h3 className="font-headline text-lg font-extrabold text-slate-900 break-words">{cRecord.name}</h3>
                    <span className={`self-start inline-flex items-center px-3 py-1 rounded-full border text-[11px] font-extrabold uppercase tracking-wide ${tone[meta.tone]}`}>{meta.label}</span>
                    <p className="text-xs text-slate-500 leading-relaxed">{meta.message}</p>
                    {cRecord.status === 'rejeitada' && (
                      <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#7a0c0c] leading-relaxed">
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5">Motivo</div>
                        <p className="whitespace-pre-wrap break-words font-semibold">
                          {cRecord.decisionNotes || 'Não foi indicado um motivo. Contacte a Secretaria para mais informações.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={`rounded-xl border p-4 ${hasScore ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nota de admissão</div>
                    <div className="text-2xl font-black text-[#0b1f3a] mt-1">{hasScore ? <>{cRecord.assessmentScore}<span className="text-sm font-bold text-slate-400"> / 20</span></> : <span className="text-sm font-semibold text-slate-400">Ainda não atribuída</span>}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nº de matrícula</div>
                    <div className="text-sm font-black text-[#0b1f3a] mt-1 font-mono">{cRecord.matriculaNumber || <span className="font-sans font-semibold text-slate-400">Ainda sem matrícula</span>}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Avaliação</div>
                    <div className="text-sm font-black text-[#0b1f3a] mt-1">{cRecord.assessmentDate ? fmt(cRecord.assessmentDate) : <span className="font-semibold text-slate-400">Sem data marcada</span>}</div>
                    {cRecord.assessmentDate && (
                      <div className="text-xs font-bold text-slate-600 mt-0.5 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        Hora: {cRecord.assessmentTime || <span className="font-semibold text-slate-400">Não indicada</span>}
                      </div>
                    )}
                    {cRecord.assessmentNotes && (
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Observações da avaliação</div>
                        <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap break-words">{cRecord.assessmentNotes}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#0b1f3a] border-b border-slate-100 pb-1.5 mb-3">Dados pessoais</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                    <Field k="Data de nascimento" v={fmt(cRecord.birthDate)} />
                    <Field k="Género" v={cRecord.gender} />
                    <Field k="Nacionalidade" v={cRecord.nationality} />
                    <Field k="Naturalidade" v={cRecord.birthPlace} />
                    <Field k="Nº do B.I." v={cRecord.biNumber} />
                    <Field k="Telefone" v={cRecord.phone} />
                    <Field k="E-mail" v={cRecord.email} />
                    <Field k="Endereço" v={cRecord.address} />
                  </div>
                </div>
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#0b1f3a] border-b border-slate-100 pb-1.5 mb-3">Candidatura</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                    <Field k="Ano letivo" v={cRecord.academicYear} />
                    <Field k="Classe pretendida" v={cRecord.desiredGrade} />
                    <Field k="Curso / Área" v={cRecord.desiredCourse} />
                    <Field k="Turno" v={cRecord.desiredShift} />
                    <Field k="Escola anterior" v={cRecord.previousSchool} />
                    <Field k="Última classe concluída" v={cRecord.lastCompletedGrade} />
                    <Field k="Encarregado de Educação" v={`${cRecord.guardianName}${cRecord.guardianRelation ? ` (${cRecord.guardianRelation})` : ''}`} />
                    <Field k="Contacto do Encarregado" v={cRecord.guardianPhone} />
                    <Field k="Nº de Pré-Matrícula" v={cRecord.ref} />
                  </div>
                </div>

                {canComplain(cRecord) && !cfg.complaintsBlocked && cmpExisting && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3 text-xs">
                    <div className="flex items-center gap-2 text-amber-900 font-extrabold uppercase tracking-wide text-[11px]">
                      <span className="material-symbols-outlined text-[18px]">task_alt</span>
                      Reclamação efectuada
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Motivo da reclamação</div>
                      <div className="font-semibold text-slate-800">{cmpExisting.reason}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Descrição da reclamação</div>
                      <p className="text-slate-700 whitespace-pre-wrap break-words">{cmpExisting.description}</p>
                      <div className="text-[10px] text-slate-400 mt-1">Enviada em {fmt(cmpExisting.submittedAt)}</div>
                    </div>
                    <div className={`rounded-lg border p-3 ${cmpExisting.response ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Resposta da reclamação</div>
                      {cmpExisting.response ? (
                        <>
                          <p className="text-slate-800 whitespace-pre-wrap break-words mt-0.5">{cmpExisting.response}</p>
                          {cmpExisting.respondedAt && <div className="text-[10px] text-slate-400 mt-1">Respondida em {fmt(cmpExisting.respondedAt)}</div>}
                        </>
                      ) : (
                        <p className="text-slate-400 font-semibold mt-0.5">Ainda sem resposta. A Secretaria está a analisar.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => printSheet(cRecord)} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-extrabold text-xs uppercase tracking-wide cursor-pointer transition-colors">
                    <span className="material-symbols-outlined text-[18px]">print</span>
                    Imprimir ficha de inscrição
                  </button>
                  {canComplain(cRecord) && !cfg.complaintsBlocked && !cmpExisting && (
                    <button type="button" onClick={() => { setCmpReason(''); setCmpText(''); setCmpError(''); setCmpSent(false); setComplaintOpen(true); }} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-[#7a0c0c] font-extrabold text-xs uppercase tracking-wide cursor-pointer transition-colors">
                      <span className="material-symbols-outlined text-[18px]">report</span>
                      Reclamação
                    </button>
                  )}
                  <button type="button" onClick={() => { setCRecord(null); setCId(''); setCDob(''); }} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-xs cursor-pointer transition-colors">
                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                    Nova consulta
                  </button>
                </div>
              </section>
            );
          })()}
        </div>
      )}

      {complaintOpen && cRecord && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !cmpBusy) setComplaintOpen(false); }}>
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <header className="flex items-center gap-3 px-5 py-4 bg-[#0b1f3a] text-white">
              <span className="material-symbols-outlined text-[22px]">report</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-headline font-bold text-sm tracking-tight">Reclamação</h3>
                <p className="text-[11px] text-blue-100 truncate">{cRecord.name} · {cRecord.code || cRecord.ref}</p>
              </div>
              <button type="button" onClick={() => !cmpBusy && setComplaintOpen(false)} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center cursor-pointer" aria-label="Fechar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </header>
            {cmpSent ? (
              <div className="p-8 flex flex-col items-center text-center gap-3">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border-4 border-emerald-100 text-emerald-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[36px]">check_circle</span>
                </div>
                <h4 className="font-headline text-lg font-extrabold text-[#0b1f3a]">Reclamação enviada</h4>
                <p className="text-sm text-slate-500 leading-relaxed">A Secretaria vai analisar a sua reclamação e entra em contacto através do telefone ou e-mail indicados na candidatura.</p>
                <button type="button" onClick={() => setComplaintOpen(false)} className="mt-2 px-6 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">Fechar</button>
              </div>
            ) : (
              <form
                className="p-5 flex flex-col gap-4 overflow-y-auto"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCmpError('');
                  setCmpBusy(true);
                  try {
                    const r = await dbService.submitPublicAdmissionComplaint(cRecord, { reason: cmpReason, description: cmpText });
                    if (r.success) {
                      setCmpSent(true);
                      setCmpExisting(await dbService.fetchPublicAdmissionComplaint(cRecord.rk));
                    }
                    else setCmpError(r.error || 'Não foi possível enviar a reclamação.');
                  } finally {
                    setCmpBusy(false);
                  }
                }}
              >
                <div>
                  <label className={labelCls}>Motivo da reclamação *</label>
                  <select className={inputCls} value={cmpReason} onChange={(e) => setCmpReason(e.target.value)} required>
                    <option value="">Selecione…</option>
                    {ADMISSION_COMPLAINT_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Descrição da reclamação *</label>
                  <textarea rows={5} maxLength={2000} className={areaCls} placeholder="Explique com detalhe o que pretende reclamar…" value={cmpText} onChange={(e) => setCmpText(e.target.value)} required />
                  <div className="text-[10px] text-slate-400 text-right mt-1">{cmpText.length}/2000</div>
                </div>
                {cmpError && (
                  <Notice tone="error" icon="error">
                    {cmpError}
                  </Notice>
                )}
                <div className="flex gap-2 justify-end">
                  <button type="button" disabled={cmpBusy} onClick={() => setComplaintOpen(false)} className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold text-xs cursor-pointer disabled:opacity-60">Cancelar</button>
                  <button type="submit" disabled={cmpBusy} className="px-5 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-60 text-white font-extrabold text-xs uppercase tracking-wide cursor-pointer flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">{cmpBusy ? 'hourglass_top' : 'send'}</span>
                    {cmpBusy ? 'A ENVIAR…' : 'ENVIAR RECLAMAÇÃO'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
