import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SchoolDatabase, Student, UserRole, Matricula } from '../../types';
import type {
  IncomingTransferRequest, StudentTransfer, TransferInstitutionRef, TransferKind, TransferredSubjectGrades
} from '../../types/processos';
import type { InstitutionSummary } from '../../types';
import { dbService } from '../../services/db';
import { BtnIcon, IconButton } from '../IconButton';
import { runGlobalOperation } from '../../context/OperationContext';
import { useAccessControl } from '../../hooks/useAccessControl';
import { SearchableSelect } from '../SearchableSelect';
import { FormModal } from '../FormModal';
import { MatriculaModal } from '../MatriculaModal';
import {
  applyEquivalences, applySubjectMapping, buildTransferGuideHtml, canonSubject, dependencyLimitCheck,
  matchSubjectsToDestination, needsManualEquivalence, normSubject, outstandingInvoices,
  pendingDependencies, sumOutstanding, type DestSubjectRef, type OriginSubjectGrade, type SubjectDecisions, type SubjectMatch
} from '../../utils/transfers';
import { TablePagination, usePagedList } from '../TablePagination';
import { Notice } from '../Notice';
import { printWhenReady } from '../../utils/printWindow';

const RULE = 'transferencias.manage';
const inputCls = 'w-full h-10 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';

type Result = { success: boolean; error?: string };
type Msg = { ok: boolean; text: string } | null;

const TRANSFER_LABEL: Record<TransferKind, string> = {
  transferencia_saida: 'Transferência de saída',
  transferencia_entrada: 'Transferência de entrada',
  equivalencia: 'Equivalência de disciplinas',
  anulacao_matricula: 'Anulação de matrícula'
};
const KIND_COLOR: Record<TransferKind, string> = {
  transferencia_saida: 'bg-amber-50 text-amber-800 border-amber-200',
  transferencia_entrada: 'bg-sky-50 text-sky-800 border-sky-200',
  equivalencia: 'bg-violet-50 text-violet-800 border-violet-200',
  anulacao_matricula: 'bg-red-50 text-red-700 border-red-200'
};

function useAsyncRunner(role: UserRole) {
  const [message, setMessage] = useState<Msg>(null);
  const run = async <T extends Result>(fn: () => Promise<T> | T, loading: string, okText: string | ((r: T) => string)): Promise<T> => {
    let result = { success: false, error: 'Operação não executada.' } as T;
    try {
      await runGlobalOperation(async () => {
        result = await fn();
        if (!result.success) throw new Error(result.error || 'Não foi possível concluir.');
      }, { loadingMessage: loading, requiredRule: RULE, userRole: role, resolveSuccessText: () => (typeof okText === 'function' ? okText(result) : okText) });
    } catch (err: any) {
      result = { success: false, error: err?.message || 'Sem permissão para esta operação.' } as T;
    }
    // O sucesso é confirmado só pelo diálogo global (carregamento → visto animado): sem faixa verde.
    setMessage(result.success ? null : { ok: false, text: result.error || 'Não foi possível concluir.' });
    return result;
  };
  return { message, setMessage, run };
}

const Banner = ({ message }: { message: Msg }) => message ? <Notice tone={message.ok ? 'success' : 'error'}>{message.text}</Notice> : null;
const Empty = ({ text }: { text: string }) => <p className="text-xs text-slate-400 font-semibold py-10 text-center">{text}</p>;
const studentOptions = (students: Student[]) => students.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.procNumber} · ${s.className || s.grade || 'sem turma'}` }));
const isActive = (s: Student) => s.status !== 'transferred' && s.studentSituation !== 'Inactivo';
const kz = (n: number) => `${Math.round(n).toLocaleString('pt-PT')} Kz`;

export function printTransferGuide(t: StudentTransfer, db: SchoolDatabase) {
  if (!t.package) return false;
  const st = db.settings;
  const html = buildTransferGuideHtml(t.package, { name: st?.schoolName || 'Instituição de Ensino', address: st?.address, nif: st?.nif, phone: st?.phone }, t.otherSchool || '—', `${window.location.origin}/pauta/insignia_angola.png`);
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  printWhenReady(w);
  return true;
}

// ---------------------------------------------------------------------------
// Escolha da instituição: conhecida (pesquisável, autopreenchimento) ou desconhecida (manual)
// ---------------------------------------------------------------------------
function InstitutionPicker({ label, value, onChange, known, disabled }: {
  label: string; value: TransferInstitutionRef | null; onChange: (v: TransferInstitutionRef | null) => void; known: InstitutionSummary[]; disabled?: boolean;
}) {
  const kind = value?.kind || 'conhecida';
  const options = known.map((i) => ({ value: i.id, label: i.name, sublabel: i.adminEmail || undefined, icon: 'school' }));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-[11px] font-bold text-slate-600">
        <span>{label}</span>
        <label className="flex items-center gap-1 cursor-pointer"><input type="radio" disabled={disabled} checked={kind === 'conhecida'} onChange={() => onChange({ kind: 'conhecida', name: '' })} /> Escola do sistema</label>
        <label className="flex items-center gap-1 cursor-pointer"><input type="radio" disabled={disabled} checked={kind === 'desconhecida'} onChange={() => onChange({ kind: 'desconhecida', name: '' })} /> Outra escola (manual)</label>
      </div>
      {kind === 'conhecida' ? (
        <SearchableSelect
          options={options}
          value={value?.institutionId || ''}
          disabled={disabled}
          onChange={(id) => { const i = known.find((k) => k.id === id); onChange(i ? { kind: 'conhecida', institutionId: i.id, name: i.name } : { kind: 'conhecida', name: '' }); }}
          placeholder="Pesquisar escola registada no sistema"
          emptyMessage={'Nenhuma outra escola registada no sistema. Use "Outra escola (manual)".'}
          helperText="Os dados do aluno seguem automaticamente para a caixa de entrada desta escola."
        />
      ) : (
        <input className={inputCls} disabled={disabled} value={value?.name || ''} onChange={(e) => onChange({ kind: 'desconhecida', name: e.target.value })} placeholder="Nome da escola (preenchimento manual)" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------
function TransferOutModal({ db, role, known, onClose, onDone }: { db: SchoolDatabase; role: UserRole; known: InstitutionSummary[]; onClose: () => void; onDone: (m: Msg, t?: StudentTransfer) => void }) {
  const { run } = useAsyncRunner(role);
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [institution, setInstitution] = useState<TransferInstitutionRef | null>({ kind: 'conhecida', name: '' });
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const owed = useMemo(
    () => (studentId ? outstandingInvoices(db.invoices || [], studentId, new Date().toISOString().slice(0, 10)) : []),
    [db.invoices, studentId]
  );
  const student = (db.students || []).find((s) => String(s.id) === studentId);
  const blocked = owed.length > 0;

  const submit = async () => {
    setError('');
    if (!institution) return;
    const r = await run(() => dbService.transferOutStudent({ studentId, date, reason, institution }), 'A transferir aluno...', 'Aluno transferido.');
    if (!r.success) { setError(r.error || ''); return; }
    onDone({ ok: true, text: r.deliveryWarning || (institution.kind === 'conhecida' ? 'Aluno transferido, vaga libertada e dados entregues à escola de destino.' : 'Aluno transferido e vaga libertada. Imprima a Guia de Transferência.') }, r.transfer);
  };

  return (
    <FormModal title="Transferir aluno (saída)" subtitle="O aluno deixa a escola" icon="logout" onClose={onClose} onSubmit={submit} submitLabel="Transferir e gerar guia"
      submitDisabled={!studentId || blocked || !confirm || !institution?.name?.trim()}>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2"><SearchableSelect label="Aluno" options={studentOptions((db.students || []).filter(isActive))} value={studentId} onChange={setStudentId} placeholder="Pesquisar aluno activo" /></div>
        <div><label className={labelCls}>Data</label><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <InstitutionPicker label="Escola de destino" value={institution} onChange={setInstitution} known={known} />
      <div><label className={labelCls}>Motivo</label><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: mudança de residência pedida pelo encarregado" /></div>
      {blocked && (
        <Notice tone="error">
          <div className="font-bold">Transferência bloqueada: {owed.length} {owed.length === 1 ? 'fatura em atraso' : 'faturas em atraso'} ({kz(sumOutstanding(owed))}).</div>
          <ul className="list-disc pl-4">{owed.slice(0, 5).map((i) => <li key={String(i.id)}>{i.description || i.invoiceNumber} — {kz(i.totalAmountKz)}</li>)}{owed.length > 5 && <li>e mais {owed.length - 5}...</li>}</ul>
          <div>Regularize em Propinas e volte a tentar.</div>
        </Notice>
      )}
      {student && !blocked && (
        <label className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>Confirmo: a matrícula passa a <b>Transferido</b>, o aluno fica <b>Inactivo</b> e liberta a vaga em {student.className || student.grade || 'a sua turma'}. Será emitida a Guia de Transferência com as notas dos trimestres avaliados.</span>
        </label>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Equivalência de disciplinas na entrada: o sistema reconhece sozinho as iguais
// (ex.: "LINGUA PORTUGUESA" = "Língua Portuguesa"); o que sobrar decide-se aqui.
// ---------------------------------------------------------------------------
const KEEP_ORIGIN = '__keep__';
const destKey = (d: DestSubjectRef) => String(d.id ?? d.name);

function SubjectEquivalenceModal({ matches, destSubjects, schoolName, onClose, onConfirm }: {
  matches: SubjectMatch[]; destSubjects: DestSubjectRef[]; schoolName: string; onClose: () => void;
  onConfirm: (decisions: SubjectDecisions, remember: boolean) => void;
}) {
  const manual = matches.filter((m) => m.kind === 'suggested' || m.kind === 'none');
  const auto = matches.filter((m) => m.kind === 'exact' || m.kind === 'rule');
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(manual.map((m) => [m.origin, m.kind === 'suggested' && m.dest ? destKey(m.dest) : ''])));
  const [remember, setRemember] = useState(true);
  const options = useMemo(() => [
    { value: KEEP_ORIGIN, label: 'Sem equivalência — manter o nome de origem', icon: 'link_off' },
    ...destSubjects.map((d) => ({ value: destKey(d), label: d.name, sublabel: d.code || undefined }))
  ], [destSubjects]);
  const pending = manual.filter((m) => !choice[m.origin]).length;

  const confirm = () => {
    const decisions: SubjectDecisions = {};
    manual.forEach((m) => {
      const v = choice[m.origin];
      decisions[m.origin] = v === KEEP_ORIGIN ? null : destSubjects.find((d) => destKey(d) === v) || null;
    });
    onConfirm(decisions, remember);
  };

  return (
    <FormModal title="Equivalência de disciplinas" subtitle={`Disciplinas de ${schoolName || 'outra escola'} que o sistema não reconheceu nesta escola`} icon="sync_alt"
      widthClass="max-w-3xl" onClose={onClose} onSubmit={confirm} submitLabel="Confirmar equivalências" submitDisabled={pending > 0}
      submitTitle={pending > 0 ? `Falta decidir ${pending} disciplina(s)` : undefined}>
      <p className="text-[11px] text-slate-500">
        Para cada disciplina de origem, pesquise e escolha a disciplina desta escola que lhe corresponde. As notas passam para a disciplina escolhida.
        Se não existir correspondência, escolha “Sem equivalência” e a disciplina mantém o nome de origem.
      </p>
      <div className="space-y-2">
        <div className="hidden md:grid grid-cols-[1fr_24px_1.3fr] gap-3 text-[10px] font-bold uppercase text-slate-500 px-1">
          <span>Disciplina de origem</span><span /><span>Disciplina nesta escola</span>
        </div>
        {manual.map((m) => (
          <div key={m.origin} className="grid md:grid-cols-[1fr_24px_1.3fr] gap-2 md:gap-3 items-start p-3 border border-slate-200 rounded-lg">
            <div className="pt-2.5">
              <div className="font-bold text-sm text-[#0b1f3a]">{m.origin}</div>
              {m.kind === 'suggested' && m.dest && (
                <div className="mt-0.5 text-[10px] font-semibold text-amber-700">Sugestão do sistema ({Math.round((m.score || 0) * 100)}% semelhante) — confirme</div>
              )}
              {m.kind === 'none' && <div className="mt-0.5 text-[10px] text-slate-400">Sem correspondência automática</div>}
            </div>
            <span className="material-symbols-outlined text-slate-400 hidden md:block pt-2.5 text-[20px]">arrow_forward</span>
            <SearchableSelect options={options} value={choice[m.origin] || ''} placeholder="Pesquisar disciplina desta escola"
              emptyMessage="Nenhuma disciplina encontrada nesta escola."
              onChange={(v) => setChoice((c) => ({ ...c, [m.origin]: v }))} />
          </div>
        ))}
      </div>
      {auto.length > 0 && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px]">
          <b>{auto.length} disciplina(s) reconhecida(s) automaticamente:</b>{' '}
          {auto.map((m) => (m.origin.trim() === m.dest?.name ? m.origin : `${m.origin} → ${m.dest?.name}`)).join('; ')}
        </div>
      )}
      <label className="flex items-start gap-2 text-[11px] text-slate-700 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Memorizar estas equivalências na tabela de equivalências, para que em futuras transferências o sistema as reconheça sozinho.</span>
      </label>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Entrada: cadastro do aluno + notas de origem + matrícula por transferência
// ---------------------------------------------------------------------------
interface Intake {
  name: string; birthDate: string; gender: string; biNumber: string; nationality: string; birthPlace: string; address: string;
  studentPhone: string; email: string; guardianName: string; guardianRelation: string; guardianPhone: string; guardianEmail: string; guardianNif: string;
}
const emptyIntake = (): Intake => ({ name: '', birthDate: '', gender: '', biNumber: '', nationality: 'Angolana', birthPlace: '', address: '', studentPhone: '', email: '', guardianName: '', guardianRelation: '', guardianPhone: '', guardianEmail: '', guardianNif: '' });

function intakeFromRequest(req: IncomingTransferRequest): Intake {
  const s = req.package.student;
  return {
    name: s.name || '', birthDate: s.birthDate || '', gender: s.gender || '', biNumber: s.biNumber || '', nationality: s.nationality || 'Angolana', birthPlace: s.birthPlace || '',
    address: s.address || '', studentPhone: s.studentPhone || '', email: s.email || '', guardianName: s.guardianName || '', guardianRelation: s.guardianRelation || '',
    guardianPhone: s.guardianPhone || '', guardianEmail: s.guardianEmail || '', guardianNif: s.guardianNif || ''
  };
}

function findDuplicate(students: Student[], f: Intake): Student | undefined {
  const bi = f.biNumber.trim().toUpperCase();
  return students.find((s) => (bi && String(s.biNumber || s.citizenCard || '').trim().toUpperCase() === bi) || (normSubject(s.name) === normSubject(f.name) && s.birthDate === f.birthDate));
}

function EntryWizard({ db, role, known, request, onClose, onDone }: {
  db: SchoolDatabase; role: UserRole; known: InstitutionSummary[]; request?: IncomingTransferRequest; onClose: () => void; onDone: (m: Msg) => void;
}) {
  const { run } = useAsyncRunner(role);
  const fromRequest = Boolean(request);
  const [institution, setInstitution] = useState<TransferInstitutionRef | null>(
    request ? { kind: 'conhecida', institutionId: request.fromInstitutionId, name: request.package.fromInstitutionName } : { kind: 'desconhecida', name: '' }
  );
  const [guide, setGuide] = useState(request?.package.guideNumber || '');
  const [date, setDate] = useState(request?.package.date || new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(request?.package.reason || '');
  const [intake, setIntake] = useState<Intake>(request ? intakeFromRequest(request) : emptyIntake());
  const [grades, setGrades] = useState<TransferredSubjectGrades[]>(request ? request.package.trimesterGrades : []);
  const [dupOk, setDupOk] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Student | null>(null);
  const [equiv, setEquiv] = useState<SubjectMatch[] | null>(null);
  const finalGradesRef = useRef<TransferredSubjectGrades[]>([]);
  const savedRef = useRef(false);
  const dup = findDuplicate(db.students || [], intake);
  const set = (k: keyof Intake) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setIntake({ ...intake, [k]: e.target.value });
  const locked = fromRequest; // escola conhecida: formulário autopreenchido só para ver e confirmar

  const setGrade = (i: number, patch: Partial<TransferredSubjectGrades>) => setGrades(grades.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const num = (v: string): number | '' => (v === '' ? '' : Number(v));

  const goMatricula = () => {
    setError('');
    if (!institution?.name?.trim()) return setError('Indique a escola de origem.');
    if (!guide.trim()) return setError('Indique o número da Guia de Transferência.');
    if (!intake.name.trim() || !intake.birthDate) return setError('Indique pelo menos o nome e a data de nascimento do aluno.');
    if (!intake.guardianName.trim()) return setError('Indique o nome do encarregado de educação.');
    if (dup && !dupOk) return setError(`Já existe um aluno com estes dados (${dup.name}, processo ${dup.procNumber}). Confirme abaixo que é outra pessoa para continuar.`);
    const gradeErr = grades.find((g) => [g.mt1, g.mt2, g.mt3].some((v) => v !== '' && v !== undefined && (Number(v) < 0 || Number(v) > 20)));
    if (gradeErr) return setError(`Nota fora de 0–20 em "${gradeErr.subjectName || 'disciplina sem nome'}".`);
    // Disciplinas: o sistema reconhece as iguais; o que não reconhecer abre a decisão manual.
    const named = grades.filter((g) => g.subjectName.trim());
    const destSubjects: DestSubjectRef[] = (db.subjects || []).map((x) => ({ id: String(x.id), name: x.name, code: x.code }));
    if (named.length === 0 || destSubjects.length === 0) return createStudentWith(named);
    const uniq = Array.from(new Map(named.map((g) => [canonSubject(g.subjectName), g.subjectName.trim()])).values());
    const matches = matchSubjectsToDestination(uniq, destSubjects, db.subjectEquivalences || []);
    if (needsManualEquivalence(matches)) { setEquiv(matches); return; }
    createStudentWith(applySubjectMapping(named, matches));
  };

  const createStudentWith = (finalGrades: TransferredSubjectGrades[]) => {
    finalGradesRef.current = finalGrades;
    try {
      const student = dbService.addStudent({
        ...intake,
        email: intake.email || `${intake.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@sem-email.local`,
        nif: '', citizenCard: intake.biNumber, classId: '', className: '', section: '', cycle: '', grade: '',
        guardianNif: intake.guardianNif,
        monthlyTuitionKz: 0, financialStatus: 'regular', status: 'pending',
        previousSchool: institution!.name.trim(), academicSituation: 'Transferência de entrada',
        docBiCopy: 'Pendente', docCertificate: 'Pendente', disciplineGrades: []
      } as any);
      savedRef.current = false;
      setCreated(student);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível cadastrar o aluno.');
    }
  };

  const confirmEquivalences = (decisions: SubjectDecisions, remember: boolean) => {
    const matches = equiv || [];
    if (remember) {
      Object.entries(decisions).forEach(([origin, dest]) => {
        if (dest) dbService.addSubjectEquivalence({ originSubject: origin, originPlan: institution?.name, destSubject: dest.name });
      });
    }
    setEquiv(null);
    createStudentWith(applySubjectMapping(grades.filter((g) => g.subjectName.trim()), matches, decisions));
  };

  const closeMatricula = () => {
    if (!savedRef.current && created) {
      // Matrícula cancelada: não deixar um aluno "fantasma" sem matrícula.
      dbService.deleteStudent(created.id);
      setCreated(null);
      setError('Matrícula cancelada: o cadastro do aluno foi desfeito. Pode rever os dados e tentar de novo.');
    }
  };

  const onMatriculaSaved = async (m: Matricula) => {
    savedRef.current = true;
    const r = await run(() => dbService.completeTransferEntry({
      studentId: String(created!.id), matriculaId: m.id, institution: institution!, guideNumber: guide, date, reason, grades: finalGradesRef.current, requestId: request?.id
    }), 'A concluir transferência...', 'Matrícula por transferência concluída.');
    onDone(r.success ? { ok: true, text: `${intake.name} matriculado(a) por transferência. Notas anteriores importadas e marcadas como "Transferência".` } : { ok: false, text: r.error || 'A matrícula foi criada, mas o processo de transferência não ficou completo.' });
  };

  if (created) {
    return <MatriculaModal db={db} student={created} transfer={{ schoolName: institution!.name, guideNumber: guide }} onClose={() => { closeMatricula(); if (savedRef.current) onClose(); }} onSaved={onMatriculaSaved} />;
  }

  return (
    <>
    <FormModal title="Nova Matrícula por Transferência" subtitle={fromRequest ? `Pedido recebido de ${request!.package.fromInstitutionName}: reveja e confirme` : 'Aluno vindo de outra escola (passo 1 de 2: cadastro)'} icon="login" widthClass="max-w-4xl"
      onClose={onClose} onSubmit={goMatricula} submitLabel="Cadastrar aluno e continuar para a matrícula">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2"><InstitutionPicker label="Escola de origem" value={institution} onChange={setInstitution} known={known} disabled={locked} /></div>
        <div><label className={labelCls}>N.º da Guia de Transferência</label><input className={inputCls} value={guide} disabled={locked} onChange={(e) => setGuide(e.target.value)} placeholder="Ex.: GT-2026-0012" /></div>
        <div><label className={labelCls}>Data da transferência</label><input type="date" className={inputCls} value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Motivo</label><input className={inputCls} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} /></div>
      </div>

      <h3 className="text-xs font-bold text-[#0b1f3a] uppercase border-b border-slate-200 pb-1 pt-2">Cadastro do aluno {locked && <span className="text-slate-400 normal-case font-normal">(dados enviados pela escola de origem — só para ver e confirmar)</span>}</h3>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2"><label className={labelCls}>Nome completo</label><input className={inputCls} disabled={locked} value={intake.name} onChange={set('name')} /></div>
        <div><label className={labelCls}>Data de nascimento</label><input type="date" className={inputCls} disabled={locked} value={intake.birthDate} onChange={set('birthDate')} /></div>
        <div><label className={labelCls}>Sexo</label><select className={inputCls} disabled={locked} value={intake.gender} onChange={set('gender')}><option value="">—</option><option>Masculino</option><option>Feminino</option></select></div>
        <div><label className={labelCls}>BI / Cédula</label><input className={inputCls} disabled={locked} value={intake.biNumber} onChange={set('biNumber')} /></div>
        <div><label className={labelCls}>Nacionalidade</label><input className={inputCls} disabled={locked} value={intake.nationality} onChange={set('nationality')} /></div>
        <div><label className={labelCls}>Naturalidade</label><input className={inputCls} disabled={locked} value={intake.birthPlace} onChange={set('birthPlace')} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Morada</label><input className={inputCls} disabled={locked} value={intake.address} onChange={set('address')} /></div>
        <div><label className={labelCls}>Telefone do aluno</label><input className={inputCls} disabled={locked} value={intake.studentPhone} onChange={set('studentPhone')} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Encarregado de educação</label><input className={inputCls} disabled={locked} value={intake.guardianName} onChange={set('guardianName')} /></div>
        <div><label className={labelCls}>Parentesco</label><input className={inputCls} disabled={locked} value={intake.guardianRelation} onChange={set('guardianRelation')} /></div>
        <div><label className={labelCls}>Telefone do encarregado</label><input className={inputCls} disabled={locked} value={intake.guardianPhone} onChange={set('guardianPhone')} /></div>
        <div><label className={labelCls}>E-mail do encarregado</label><input className={inputCls} disabled={locked} value={intake.guardianEmail} onChange={set('guardianEmail')} /></div>
        <div><label className={labelCls}>NIF do encarregado</label><input className={inputCls} disabled={locked} value={intake.guardianNif} onChange={set('guardianNif')} /></div>
      </div>
      <p className="text-[11px] text-slate-400">Os restantes campos da ficha (documentos, saúde, filiação...) completam-se depois em Alunos.</p>

      <h3 className="text-xs font-bold text-[#0b1f3a] uppercase border-b border-slate-200 pb-1 pt-2">Notas dos trimestres já concluídos na escola de origem</h3>
      <p className="text-[11px] text-slate-500">Servem para calcular a Média de Frequência no fim do ano. Entram marcadas como "Transferência".</p>
      <div className="space-y-2">
        {grades.map((g, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_70px_auto] gap-2 items-center">
            <input className={inputCls} disabled={locked} value={g.subjectName} onChange={(e) => setGrade(i, { subjectName: e.target.value })} placeholder="Disciplina" />
            {(['mt1', 'mt2', 'mt3'] as const).map((k, n) => (
              <input key={k} type="number" min={0} max={20} step="0.1" className={inputCls} disabled={locked} value={g[k] === undefined ? '' : g[k]} onChange={(e) => setGrade(i, { [k]: num(e.target.value) })} placeholder={`${n + 1}.º`} />
            ))}
            {!locked && <IconButton icon="delete" tone="danger" label="Remover disciplina" onClick={() => setGrades(grades.filter((_, idx) => idx !== i))} />}
          </div>
        ))}
        {!locked && <button type="button" className={btnGhost} onClick={() => setGrades([...grades, { subjectName: '', mt1: '', mt2: '', mt3: '' }])}><BtnIcon n="add" /> Disciplina</button>}
        {locked && grades.length === 0 && <p className="text-[11px] text-slate-400">A escola de origem não enviou notas trimestrais.</p>}
      </div>

      {dup && (
        <label className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={dupOk} onChange={(e) => setDupOk(e.target.checked)} />
          <span>Já existe <b>{dup.name}</b> (processo {dup.procNumber}, {isActive(dup) ? 'activo' : 'inactivo'}) com BI ou nome e data de nascimento iguais. Confirmo que se trata de outra pessoa.</span>
        </label>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </FormModal>
    {equiv && (
      <SubjectEquivalenceModal matches={equiv} schoolName={institution?.name || ''}
        destSubjects={(db.subjects || []).map((x) => ({ id: String(x.id), name: x.name, code: x.code }))}
        onClose={() => setEquiv(null)} onConfirm={confirmEquivalences} />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Estado do processo (coluna "Em processo"): só as saídas têm resposta da escola de destino.
type ProcState = { label: string; cls: string; hint?: string };
function processState(t: StudentTransfer, decision?: { status: string; decisionNote?: string; decidedAt?: string }): ProcState {
  if (t.kind === 'anulacao_matricula') return { label: '—', cls: 'text-slate-400' };
  if (t.kind === 'transferencia_entrada') return { label: 'Concluída', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', hint: 'Aluno matriculado nesta escola' };
  // Saída
  if (t.otherInstitution?.kind !== 'conhecida') {
    return { label: 'Escola desconhecida', cls: 'bg-slate-100 text-slate-700 border-slate-300', hint: 'Escola que não usa o Bandmed: sem confirmação automática. Entregue a Guia em mão.' };
  }
  if (t.deliveryStatus === 'falhou') return { label: 'Entrega falhou', cls: 'bg-red-50 text-red-700 border-red-200', hint: 'Use "Reenviar à escola".' };
  switch (decision?.status) {
    case 'aceite': return { label: 'Aceite', cls: 'bg-sky-50 text-sky-800 border-sky-200', hint: 'A escola de destino aceitou o pedido.' };
    case 'concluida': return { label: 'Aceite · matriculado', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', hint: 'O aluno já foi matriculado na escola de destino.' };
    case 'recusada': return { label: 'Rejeitada', cls: 'bg-red-50 text-red-700 border-red-200', hint: decision.decisionNote ? `Motivo: ${decision.decisionNote}` : 'A escola de destino rejeitou o pedido.' };
    default: return { label: 'Em processo', cls: 'bg-amber-50 text-amber-800 border-amber-200', hint: 'A aguardar resposta da escola de destino.' };
  }
}

// Caixa de entrada
// ---------------------------------------------------------------------------
const REQ_COLOR: Record<IncomingTransferRequest['status'], string> = {
  pendente: 'bg-amber-50 text-amber-800 border-amber-200', aceite: 'bg-sky-50 text-sky-800 border-sky-200',
  recusada: 'bg-red-50 text-red-700 border-red-200', concluida: 'bg-emerald-50 text-emerald-800 border-emerald-200'
};

function InboxTab({ requests, error, can, role, onOpen, setMsg }: {
  requests: IncomingTransferRequest[]; error: string; can: boolean; role: UserRole; onOpen: (r: IncomingTransferRequest) => void; setMsg: (m: Msg) => void;
}) {
  const { run } = useAsyncRunner(role);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const decide = async (id: string, accept: boolean) => {
    const r = await run(() => dbService.decideIncomingTransfer(id, accept, note), accept ? 'A aceitar...' : 'A recusar...', accept ? 'Pedido aceite: abra-o para rever e matricular.' : 'Pedido recusado.');
    setMsg(r.success ? { ok: true, text: accept ? 'Pedido aceite: abra-o para rever e matricular.' : 'Pedido recusado.' } : { ok: false, text: r.error || '' });
    if (r.success) { setRejecting(null); setNote(''); }
  };
  if (error) return <Notice tone="error">{error}</Notice>;
  if (requests.length === 0) return <Empty text="Nenhum pedido de transferência recebido de outras escolas." />;
  return (
    <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
      {requests.map((r) => (
        <div key={r.id} className="p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-bold text-sm text-[#0b1f3a]">{r.package.student.name}</div>
              <div className="text-slate-500">Vem de <b>{r.package.fromInstitutionName}</b> · {r.package.grade} · guia {r.package.guideNumber} · {new Date(r.package.date).toLocaleDateString('pt-PT')}</div>
              <div className="text-slate-500">Motivo: {r.package.reason}</div>
              <div className="text-[10px] text-slate-400">{r.package.trimesterGrades.length} disciplina(s) com notas trimestrais · recebido em {new Date(r.createdAt).toLocaleString('pt-PT')}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 border font-bold text-[10px] uppercase ${REQ_COLOR[r.status]}`}>{r.status}</span>
              {r.status === 'pendente' && <>
                <button className={btnPrimary} disabled={!can} onClick={() => decide(r.id, true)}><BtnIcon n="check" /> Aceitar</button>
                <button className={btnGhost} disabled={!can} onClick={() => setRejecting(rejecting === r.id ? null : r.id)}><BtnIcon n="block" /> Recusar</button>
              </>}
              {r.status === 'aceite' && <button className={btnPrimary} disabled={!can} onClick={() => onOpen(r)}><BtnIcon n="how_to_reg" /> Rever e matricular</button>}
            </div>
          </div>
          {r.decisionNote && <div className="text-[11px] text-slate-500">Nota: {r.decisionNote}</div>}
          {rejecting === r.id && (
            <div className="flex gap-2"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo da recusa (ex.: sem vagas na classe)" /><button className={btnPrimary} onClick={() => decide(r.id, false)}><BtnIcon n="check" /> Confirmar recusa</button></div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equivalências por disciplina e dependências
// ---------------------------------------------------------------------------
function EquivalenciasTab({ db, role, can }: { db: SchoolDatabase; role: UserRole; can: boolean }) {
  const { message, run } = useAsyncRunner(role);
  const [origin, setOrigin] = useState('');
  const [plan, setPlan] = useState('');
  const [dest, setDest] = useState('');
  const [studentId, setStudentId] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [gradesText, setGradesText] = useState('');
  const [missingText, setMissingText] = useState('');
  const [missingGrade, setMissingGrade] = useState('');
  const [maxDeps, setMaxDeps] = useState(2);
  const rules = db.subjectEquivalences || [];
  const { page: pgRules, setPage: setPgRules, pageItems: visibleRules } = usePagedList(rules, [rules.length]);
  const deps = db.studentDependencies || [];
  const { page: pgDeps, setPage: setPgDeps, pageItems: visibleDeps } = usePagedList(deps, [deps.length]);
  const subjectOpts = (db.subjects || []).map((s) => ({ value: s.name, label: s.name, sublabel: s.code }));

  const subjects: OriginSubjectGrade[] = gradesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, g] = l.split(/[;:]/).map((x) => x.trim());
    const n = Number(String(g ?? '').replace(',', '.'));
    return { subjectName: name, grade: g !== undefined && g !== '' && Number.isFinite(n) ? n : undefined };
  });
  const destMissing = missingText.split('\n').map((l) => l.trim()).filter(Boolean);
  const preview = useMemo(() => applyEquivalences(subjects, rules, destMissing), [gradesText, missingText, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = studentId ? pendingDependencies(deps, studentId).length : 0;
  const limit = dependencyLimitCheck(pending, preview.missingForDependency.length, maxDeps);

  return (
    <div className="space-y-5">
      <Banner message={message} />
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Tabela de equivalências</h2>
        <div className="grid md:grid-cols-4 gap-3 items-end">
          <div><label className={labelCls}>Disciplina de origem</label><input className={inputCls} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ex.: Informática Aplicada" /></div>
          <div><label className={labelCls}>Plano / país de origem</label><input className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Ex.: Ensino Técnico" /></div>
          <div><SearchableSelect label="Disciplina de destino" options={subjectOpts} value={dest} onChange={setDest} allowCustom placeholder="Escolher ou escrever" /></div>
          <button className={btnPrimary} disabled={!can || !origin.trim() || !dest.trim()} onClick={async () => {
            const r = await run(() => dbService.addSubjectEquivalence({ originSubject: origin, originPlan: plan, destSubject: dest }), 'A guardar...', 'Equivalência guardada.');
            if (r.success) { setOrigin(''); setDest(''); }
          }}><BtnIcon n="add" /> Adicionar</button>
        </div>
        {rules.length === 0 ? <Empty text="Ainda sem equivalências." /> : (
          <><table className="w-full text-xs"><thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-2">Origem</th><th className="p-2">Plano</th><th className="p-2">Destino</th><th className="p-2" /></tr></thead>
            <tbody>{visibleRules.map((e) => <tr key={e.id} className="border-t border-slate-100"><td className="p-2 font-semibold">{e.originSubject}</td><td className="p-2 text-slate-500">{e.originPlan || '—'}</td><td className="p-2">→ {e.destSubject}</td><td className="p-2 text-right"><IconButton icon="delete" tone="danger" label="Remover equivalência" disabled={!can} onClick={() => dbService.removeSubjectEquivalence(e.id)} /></td></tr>)}</tbody></table><TablePagination total={rules.length} page={pgRules} onPageChange={setPgRules} /></>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Aplicar equivalências</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2"><SearchableSelect label="Aluno" options={studentOptions(db.students || [])} value={studentId} onChange={setStudentId} placeholder="Pesquisar aluno" /></div>
          <div><label className={labelCls}>Origem (plano / escola / país)</label><input className={inputCls} value={originLabel} onChange={(e) => setOriginLabel(e.target.value)} placeholder="Ex.: Técnico de Informática" /></div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div><label className={labelCls}></label><textarea className={`${inputCls} h-28 py-2`} value={gradesText} onChange={(e) => setGradesText(e.target.value)} placeholder={'Língua Portuguesa; 14\nInformática Aplicada; 15'} /></div>
          <div><label className={labelCls}></label><textarea className={`${inputCls} h-28 py-2`} value={missingText} onChange={(e) => setMissingText(e.target.value)} placeholder="Filosofia" /></div>
        </div>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div><label className={labelCls}>Classe das disciplinas em falta</label><input className={inputCls} value={missingGrade} onChange={(e) => setMissingGrade(e.target.value)} placeholder="Ex.: 10ª Classe" /></div>
          <div><label className={labelCls}>Limite legal de disciplinas em atraso</label><input type="number" min={0} className={inputCls} value={maxDeps} onChange={(e) => setMaxDeps(Math.max(0, Number(e.target.value)))} /></div>
        </div>
        {subjects.length > 0 && (
          <div className="text-xs border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-1">
            <div className="text-emerald-700"><b>{preview.recognized.length}</b> reconhecida(s): {preview.recognized.map((r) => `${r.originSubject} → ${r.destSubject}${r.grade !== undefined ? ` (${r.grade})` : ''}`).join('; ') || '—'}</div>
            {preview.unmapped.length > 0 && <div className="text-amber-700"><b>{preview.unmapped.length}</b> sem equivalência (não copiadas): {preview.unmapped.map((u) => u.subjectName).join(', ')}</div>}
            <div className={limit.allowed ? 'text-slate-700' : 'text-red-700 font-bold'}><b>{preview.missingForDependency.length}</b> em atraso (dependência): {preview.missingForDependency.join(', ') || '—'}{pending > 0 ? ` · já tem ${pending} pendente(s)` : ''}</div>
            {!limit.allowed && <div className="text-red-700 font-bold">{limit.message}</div>}
          </div>
        )}
        <button className={btnPrimary} disabled={!can || !studentId || subjects.length === 0 || !originLabel.trim() || !limit.allowed} onClick={async () => {
          const r = await run(() => dbService.applyStudentEquivalences({ studentId, originLabel, subjects, destPlanSubjects: destMissing, missingFromGrade: missingGrade, maxDependencies: maxDeps }),
            'A aplicar equivalências...', (x) => `${x.recognized} nota(s) aproveitada(s) como "Equivalência"; ${x.dependencies} disciplina(s) em atraso inscrita(s).`);
          if (r.success) { setGradesText(''); setMissingText(''); }
        }}><BtnIcon n="rule" /> Aplicar equivalências</button>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-bold text-[#0b1f3a]">Disciplinas em atraso</h2>
        {deps.length === 0 ? <Empty text="Nenhum aluno com disciplinas em atraso." /> : (
          <><table className="w-full text-xs"><thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-2">Aluno</th><th className="p-2">Disciplina</th><th className="p-2">Classe</th><th className="p-2">Estado</th><th className="p-2" /></tr></thead>
            <tbody>{visibleDeps.map((d) => <tr key={d.id} className="border-t border-slate-100"><td className="p-2 font-semibold">{d.studentName}</td><td className="p-2">{d.subjectName}</td><td className="p-2 text-slate-500">{d.fromGrade || '—'}</td>
              <td className="p-2"><span className={d.status === 'pendente' ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>{d.status === 'pendente' ? 'Pendente' : 'Regularizada'}</span></td>
              <td className="p-2 text-right">{d.status === 'pendente' && <IconButton icon="task_alt" tone="success" label="Marcar regularizada" disabled={!can} onClick={() => dbService.resolveDependency(d.id)} />}</td></tr>)}</tbody></table><TablePagination total={deps.length} page={pgDeps} onPageChange={setPgDeps} /></>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel principal
// ---------------------------------------------------------------------------
type Sub = 'processos' | 'caixa' | 'equivalencias';

export function TransferenciasPanel({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const can = acl.can(RULE);
  const { message, setMessage, run } = useAsyncRunner(role);
  const [sub, setSub] = useState<Sub>('processos');
  const [known, setKnown] = useState<InstitutionSummary[]>([]);
  const [inbox, setInbox] = useState<IncomingTransferRequest[]>([]);
  const [inboxError, setInboxError] = useState('');
  const [modal, setModal] = useState<null | 'saida' | 'entrada' | 'anulacao'>(null);
  const [reviewing, setReviewing] = useState<IncomingTransferRequest | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Anulação
  const [annStudent, setAnnStudent] = useState('');
  const [annReason, setAnnReason] = useState('');
  const [annConfirm, setAnnConfirm] = useState(false);

  useEffect(() => { let alive = true; dbService.loadKnownInstitutions().then((l) => { if (alive) setKnown(l); }); return () => { alive = false; }; }, []);
  useEffect(() => dbService.subscribeIncomingTransfers((list, err) => { setInbox(list); setInboxError(err || ''); }), []);
  // Decisão da escola de destino nas transferências de saída (actualiza sozinha enquanto o painel está aberto).
  const [sentDecisions, setSentDecisions] = useState<Record<string, { status: string; decisionNote?: string; decidedAt?: string; decidedBy?: string }>>({});
  useEffect(() => {
    let alive = true;
    const load = () => { dbService.loadSentTransferDecisions().then((d) => { if (alive) setSentDecisions(d); }).catch(() => { /* sem ligação: mantém o último estado */ }); };
    load();
    const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [(db.studentTransfers || []).length]);

  const list: StudentTransfer[] = db.studentTransfers || [];
  const shown = list.filter((t) => !filter.trim() || `${t.code} ${t.studentName} ${TRANSFER_LABEL[t.kind]} ${t.otherSchool || ''} ${t.guideNumber || ''}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const { page: pgShown, setPage: setPgShown, pageItems: visibleShown } = usePagedList(shown, [shown.length]);
  const pendingCount = inbox.filter((r) => r.status === 'pendente').length;

  const tab = (id: Sub, label: string, badge?: number) => (
    <button key={id} onClick={() => setSub(id)} className={`px-3 h-9 text-xs font-bold rounded-lg border ${sub === id ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
      {label}{badge ? <span className="ml-2 px-1.5 rounded-full bg-red-600 text-white text-[10px]">{badge}</span> : null}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{tab('processos', 'Processos')}{tab('caixa', 'Caixa de entrada', pendingCount)}{tab('equivalencias', 'Equivalências e dependências')}</div>
      {pendingCount > 0 && sub !== 'caixa' && (
        <div className="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 flex items-center justify-between">
          <span>{pendingCount === 1 ? 'Há 1 pedido de transferência de outra escola à espera de decisão.' : `Há ${pendingCount} pedidos de transferência de outras escolas à espera de decisão.`}</span>
          <button className={btnGhost} onClick={() => setSub('caixa')}><BtnIcon n="inbox" /> Ver pedidos</button>
        </div>
      )}
      <Banner message={message} />

      {sub === 'processos' && (
        <>
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <input className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Pesquisar por código, guia, aluno, tipo ou escola" />
            <div className="flex gap-2 shrink-0">
              <IconButton variant="solid" icon="logout" label="Transferir aluno (saída)" disabled={!can} disabledTitle={acl.denyMessage(RULE)} onClick={() => setModal('saida')} />
              <IconButton variant="solid" icon="login" label="Matrícula por transferência" disabled={!can} disabledTitle={acl.denyMessage(RULE)} onClick={() => setModal('entrada')} />
              <IconButton variant="solid" tone="danger" icon="block" label="Anular matrícula" disabled={!can} disabledTitle={acl.denyMessage(RULE)} onClick={() => { setAnnStudent(''); setAnnReason(''); setAnnConfirm(false); setModal('anulacao'); }} />
            </div>
          </div>
          {shown.length === 0 ? <Empty text="Sem processos registados." /> : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Código</th><th className="p-3">Tipo</th><th className="p-3">Aluno</th><th className="p-3">Data</th><th className="p-3">Escola / Guia / Motivo</th><th className="p-3">Em processo</th><th className="p-3" /></tr></thead>
                <tbody>
                  {visibleShown.map((t) => (
                    <React.Fragment key={t.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="p-3 font-mono font-bold">{t.code}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 border font-bold text-[10px] uppercase whitespace-nowrap ${KIND_COLOR[t.kind]}`}>{TRANSFER_LABEL[t.kind]}</span></td>
                        <td className="p-3 font-semibold">{t.studentName}</td>
                        <td className="p-3 whitespace-nowrap">{new Date(t.date).toLocaleDateString('pt-PT')}</td>
                        <td className="p-3 text-slate-600">
                          {t.otherSchool ? <b>{t.otherSchool}</b> : null}{t.otherInstitution?.kind === 'conhecida' && <span className="ml-1 text-[10px] text-sky-700">(no sistema)</span>}
                          {t.guideNumber ? <span className="font-mono"> · {t.guideNumber}</span> : null}{t.otherSchool || t.guideNumber ? ' · ' : ''}{t.reason}
                          {t.kind === 'transferencia_saida' && t.deliveryStatus === 'entregue' && <span className="ml-2 text-emerald-700 font-bold">entregue à escola</span>}
                          {t.kind === 'transferencia_saida' && t.deliveryStatus === 'falhou' && <span className="ml-2 text-red-700 font-bold">entrega falhou</span>}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {(() => { const ps = processState(t, t.deliveredRequestId ? sentDecisions[t.deliveredRequestId] : undefined); return (
                            <span title={ps.hint} className={`px-2 py-0.5 border font-bold text-[10px] uppercase ${ps.cls}`}>{ps.label}</span>
                          ); })()}
                          {t.kind === 'transferencia_saida' && t.deliveredRequestId && sentDecisions[t.deliveredRequestId]?.status === 'recusada' && sentDecisions[t.deliveredRequestId]?.decisionNote && (
                            <div className="mt-1 text-[10px] text-red-700 whitespace-normal max-w-[220px]">Motivo: {sentDecisions[t.deliveredRequestId].decisionNote}</div>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {t.kind === 'transferencia_saida' && t.package && <IconButton icon="print" label="Guia de Transferência (PDF)" onClick={() => { if (!printTransferGuide(t, db)) setMessage({ ok: false, text: 'O navegador bloqueou a janela da guia. Permita pop-ups e tente de novo.' }); }} />}
                          {t.kind === 'transferencia_saida' && t.deliveryStatus === 'falhou' && t.otherInstitution?.kind === 'conhecida' && (
                            <IconButton icon="send" label="Reenviar à escola" disabled={!can} onClick={() => run(() => dbService.resendTransfer(t.id), 'A reenviar...', 'Dados entregues à escola de destino.')} />
                          )}
                          <IconButton icon={open === t.id ? 'expand_less' : 'history'} label={open === t.id ? 'Fechar histórico' : 'Ver histórico'} onClick={() => setOpen(open === t.id ? null : t.id)} />
                        </td>
                      </tr>
                      {open === t.id && (
                        <tr className="bg-slate-50"><td colSpan={7} className="p-3 space-y-1">
                          <div>Classe/turma à data: <b>{t.historySnapshot.grade}</b> · {t.historySnapshot.className} · {t.historySnapshot.academicYear}</div>
                          <div>Matrículas: {t.historySnapshot.enrollments.length === 0 ? 'nenhuma registada' : t.historySnapshot.enrollments.map((e) => `${e.academicYear} (${e.numeroMatricula}${e.status ? `, ${e.status}` : ''})`).join('; ')}</div>
                          {t.package && t.package.trimesterGrades.length > 0 && <div>Notas enviadas: {t.package.trimesterGrades.map((g) => `${g.subjectName} (${[g.mt1, g.mt2, g.mt3].map((v) => v || '—').join('/')})`).join('; ')}</div>}
                          {t.equivalences && <div>Equivalências: {t.equivalences.map((e) => `${e.subjectName}${e.destSubject ? ` → ${e.destSubject}` : e.recognized ? '' : ' (sem equivalência)'}${e.originGrade !== undefined ? ` (${e.originGrade})` : ''}`).join('; ')}</div>}
                          <div className="text-[10px] text-slate-400">Registado por {t.createdBy} em {new Date(t.createdAt).toLocaleString('pt-PT')}</div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <TablePagination total={shown.length} page={pgShown} onPageChange={setPgShown} />
            </div>
          )}
        </>
      )}

      {sub === 'caixa' && <InboxTab requests={inbox} error={inboxError} can={can} role={role} onOpen={setReviewing} setMsg={setMessage} />}
      {sub === 'equivalencias' && <EquivalenciasTab db={db} role={role} can={can} />}

      {modal === 'saida' && <TransferOutModal db={db} role={role} known={known} onClose={() => setModal(null)} onDone={(m, t) => { setModal(null); setMessage(m); if (t && !printTransferGuide(t, db)) setMessage({ ok: false, text: `${m?.text || ''} A janela da guia foi bloqueada: use o botão de impressão na lista.` }); }} />}
      {modal === 'entrada' && <EntryWizard db={db} role={role} known={known} onClose={() => setModal(null)} onDone={(m) => { setModal(null); setMessage(m); }} />}
      {reviewing && <EntryWizard db={db} role={role} known={known} request={reviewing} onClose={() => setReviewing(null)} onDone={(m) => { setReviewing(null); setMessage(m); }} />}
      {modal === 'anulacao' && (
        <FormModal title="Anular matrícula" subtitle="A matrícula do ano corrente passa a cancelada" icon="block" onClose={() => setModal(null)} submitLabel="Anular" submitDisabled={!annStudent || !annConfirm}
          onSubmit={async () => {
            const r = await run(() => dbService.registerStudentTransfer({ kind: 'anulacao_matricula', studentId: annStudent, date: new Date().toISOString().slice(0, 10), reason: annReason }), 'A anular...', 'Matrícula anulada; a vaga ficou livre.');
            if (r.success) setModal(null);
          }}>
          <SearchableSelect label="Aluno" options={studentOptions((db.students || []).filter(isActive))} value={annStudent} onChange={setAnnStudent} placeholder="Pesquisar aluno activo" />
          <div><label className={labelCls}>Motivo</label><input className={inputCls} value={annReason} onChange={(e) => setAnnReason(e.target.value)} /></div>
          <label className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-0.5" checked={annConfirm} onChange={(e) => setAnnConfirm(e.target.checked)} /><span>Confirmo: a matrícula do ano corrente passa a cancelada e o aluno sai das pautas.</span></label>
        </FormModal>
      )}
    </div>
  );
}
