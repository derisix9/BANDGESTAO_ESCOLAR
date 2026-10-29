import React, { useMemo, useState } from 'react';
import { SchoolDatabase, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { getSubjectsForClass } from '../utils/classSubjects';
import { getAllocatedClassIdsForUser } from '../utils/teacherSubjects';
import {
  LessonPlan, LessonPlanAttachment, LessonSummaryEntry, TeachingMaterial, PLAN_ATTACHMENT_ACCEPT, PLAN_ATTACHMENT_MAX_BYTES,
  attachmentKind, formatFileSize, mondayOf, validatePlanAttachment
} from '../utils/teacherWork';
import { isSafeHttpUrl } from '../utils/elearning';
import { FormModal } from '../components/FormModal';
import { BTN_ACTION, BtnIcon, IconButton } from '../components/IconButton';
import { findTrimesterKeyForDate } from '../utils/academicYear';
import { toISO } from '../utils/libraryLoans';
import {
  Badge, Banner, Empty, PageHeader, fmtDate, inputCls, labelCls, textareaCls, useOperation
} from '../components/portalUi';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { safeDownloadHref } from '../utils/safeFiles';

export type ProfessorSection = 'professor_plano_aulas' | 'professor_sumarios' | 'professor_materiais';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
  section: ProfessorSection;
}

const RULE = 'professor.trabalho.manage';
const REVIEW_RULE = 'professor.planos.review';

const PLAN_STATUS: Record<LessonPlan['status'], { label: string; tone: string }> = {
  rascunho: { label: 'Rascunho', tone: 'bg-slate-200 text-slate-700' },
  submetido: { label: 'Submetido', tone: 'bg-blue-100 text-blue-800' },
  aprovado: { label: 'Aprovado', tone: 'bg-emerald-100 text-emerald-800' },
  devolvido: { label: 'Devolvido', tone: 'bg-amber-100 text-amber-800' }
};

/** Turma + disciplina, limitadas às turmas do professor (a direção vê todas). */
function useClassSubject(db: SchoolDatabase, currentUser: User) {
  const allowed = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const classes = useMemo(() => (db.classes || []).filter((c) => !allowed || allowed.has(String(c.id))), [db.classes, allowed]);
  const subjectsOf = (classId: string) => {
    const c = classes.find((x) => String(x.id) === classId);
    return c ? getSubjectsForClass(db, c) : [];
  };
  return { classes, subjectsOf };
}

function ClassSubjectFields({ classes, subjectsOf, classId, subjectName, onClass, onSubject }: {
  classes: ReturnType<typeof useClassSubject>['classes']; subjectsOf: (id: string) => Array<{ id: string; name: string }>;
  classId: string; subjectName: string; onClass: (v: string) => void; onSubject: (v: string) => void;
}) {
  const subjects = classId ? subjectsOf(classId) : [];
  return (
    <>
      <div>
        <label className={labelCls}>Turma *</label>
        <select className={inputCls} value={classId} onChange={(e) => { onClass(e.target.value); onSubject(''); }}>
          <option value="">Escolha...</option>
          {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Disciplina *</label>
        {subjects.length > 0 ? (
          <select className={inputCls} value={subjectName} onChange={(e) => onSubject(e.target.value)}>
            <option value="">Escolha...</option>
            {subjects.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        ) : (
          <input className={inputCls} value={subjectName} onChange={(e) => onSubject(e.target.value)} placeholder={classId ? 'Sem atribuição: escreva a disciplina' : 'Escolha primeiro a turma'} />
        )}
      </div>
    </>
  );
}


// ---------------------------------------------------------------------------
// Filtros (Plano de aulas, Sumários e Materiais de apoio)
// ---------------------------------------------------------------------------
export interface WorkFilters { teacherId: string; subject: string; classId: string; trimester: string; text: string }
const NO_FILTERS: WorkFilters = { teacherId: '', subject: '', classId: '', trimester: '', text: '' };

/** Campos de cada registo que os filtros comparam. `trimester` vazio = sem trimestre conhecido. */
interface FilterKey { teacherId: string; teacherName: string; classId: string; className: string; subjectName: string; trimester: string; text: string }

const norm = (v: string) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function matchesFilters(k: FilterKey, f: WorkFilters): boolean {
  if (f.teacherId && String(k.teacherId) !== f.teacherId) return false;
  if (f.subject && norm(k.subjectName) !== norm(f.subject)) return false;
  if (f.classId && String(k.classId) !== f.classId) return false;
  if (f.trimester) {
    if (f.trimester === 'none' ? k.trimester !== '' : k.trimester !== f.trimester) return false;
  }
  if (f.text.trim() && !norm(k.text).includes(norm(f.text))) return false;
  return true;
}

function WorkFiltersBar({ keys, filters, onChange, showTeacher, textLabel, shown }: {
  keys: FilterKey[]; filters: WorkFilters; onChange: (f: WorkFilters) => void; showTeacher: boolean; textLabel: string; shown: number;
}) {
  const teachers = useMemo(() => {
    const m = new Map<string, string>();
    keys.forEach((k) => { if (k.teacherId) m.set(String(k.teacherId), k.teacherName || String(k.teacherId)); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
  }, [keys]);
  const subjects = useMemo(() => [...new Set(keys.map((k) => k.subjectName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')), [keys]);
  const classesOpts = useMemo(() => {
    const m = new Map<string, string>();
    keys.forEach((k) => { if (k.classId) m.set(String(k.classId), k.className || String(k.classId)); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt', { numeric: true }));
  }, [keys]);
  const hasNoTrimester = keys.some((k) => !k.trimester);
  const active = Object.values(filters).some((v) => v !== '');
  const set = (k: keyof WorkFilters, v: string) => onChange({ ...filters, [k]: v });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2" role="search" aria-label="Filtros">
      <div className={`grid gap-3 sm:grid-cols-2 ${showTeacher ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {showTeacher && (
          <div>
            <label className={labelCls}>Professor</label>
            <select className={inputCls} value={filters.teacherId} onChange={(e) => set('teacherId', e.target.value)}>
              <option value="">Todos</option>
              {teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>Disciplina</label>
          <select className={inputCls} value={filters.subject} onChange={(e) => set('subject', e.target.value)}>
            <option value="">Todas</option>
            {subjects.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Turma</label>
          <select className={inputCls} value={filters.classId} onChange={(e) => set('classId', e.target.value)}>
            <option value="">Todas</option>
            {classesOpts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Trimestre</label>
          <select className={inputCls} value={filters.trimester} onChange={(e) => set('trimester', e.target.value)}>
            <option value="">Todos</option>
            <option value="1">1.º</option>
            <option value="2">2.º</option>
            <option value="3">3.º</option>
            {hasNoTrimester && <option value="none">Sem trimestre definido</option>}
          </select>
        </div>
        <div>
          <label className={labelCls}>{textLabel}</label>
          <input className={inputCls} type="search" value={filters.text} onChange={(e) => set('text', e.target.value)} placeholder="Pesquisar..." />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{shown} de {keys.length} {keys.length === 1 ? 'registo' : 'registos'}</span>
        {active && <button type="button" className={BTN_ACTION} onClick={() => onChange(NO_FILTERS)}><BtnIcon n="filter_alt_off" /> Limpar filtros</button>}
      </div>
    </div>
  );
}

const NO_MATCH = 'Nada encontrado com estes filtros.'

export const PortalProfessorView: React.FC<Props> = ({ db, currentUser, currentUserRole, section }) => {
  if (section === 'professor_sumarios') return <SumariosTab db={db} currentUser={currentUser} role={currentUserRole} />;
  if (section === 'professor_materiais') return <MateriaisTab db={db} currentUser={currentUser} role={currentUserRole} />;
  return <PlanosTab db={db} currentUser={currentUser} role={currentUserRole} />;
};

// ---------------------------------------------------------------------------
// Plano de aulas
// ---------------------------------------------------------------------------
const emptyPlan = { id: '', classId: '', subjectName: '', trimester: '1' as '1' | '2' | '3', weekStart: '', topic: '', objectives: '', activities: '', resources: '', evaluation: '' };

/** Texto longo sem espaços (ex.: "DDDD…") parte-se em vez de sair do cartão. */
const WRAP = 'whitespace-pre-line break-words [overflow-wrap:anywhere] min-w-0';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
    reader.readAsDataURL(file);
  });
}

function AttachmentLink({ attachment }: { attachment: LessonPlanAttachment }) {
  return (
    <a
      href={safeDownloadHref(attachment.dataUrl)}
      download={attachment.name}
      className="inline-flex items-center gap-2 max-w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs text-[#0b1f3a] font-semibold hover:bg-slate-100"
    >
      <span className="material-symbols-outlined text-[18px] shrink-0">description</span>
      <span className="truncate">{attachment.name}</span>
      <span className="text-[10px] text-slate-500 font-normal shrink-0">{attachmentKind(attachment.name)} · {formatFileSize(attachment.size)}</span>
    </a>
  );
}

function PlanosTab({ db, currentUser, role }: { db: SchoolDatabase; currentUser: User; role: UserRole }) {
  const acl = useAccessControl(role);
  const canWrite = acl.can(RULE);
  const canReview = acl.can(REVIEW_RULE);
  const { message, setMessage, run } = useOperation(role);
  const { classes, subjectsOf } = useClassSubject(db, currentUser);
  const [form, setForm] = useState({ ...emptyPlan, trimester: ((db.settings?.currentTrimester as '1' | '2' | '3') || '1') });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'formulario' | 'ficheiro'>('formulario');
  const [attachment, setAttachment] = useState<LessonPlanAttachment | undefined>(undefined);
  const [fileError, setFileError] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const set = <K extends keyof typeof emptyPlan>(k: K, v: (typeof emptyPlan)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [filters, setFilters] = useState<WorkFilters>(NO_FILTERS);
  const allPlans = (db.lessonPlans || [])
    .filter((p) => canReview || String(p.teacherId) === String(currentUser.id))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  const planKey = (p: LessonPlan): FilterKey => ({ teacherId: String(p.teacherId), teacherName: p.teacherName, classId: String(p.classId), className: p.className, subjectName: p.subjectName, trimester: p.trimester || '', text: p.topic });
  const planKeys = allPlans.map(planKey);
  const plans = allPlans.filter((p) => matchesFilters(planKey(p), filters));
  const { page: pgPlans, setPage: setPgPlans, pageItems: visiblePlans } = usePagedList(plans, [plans.length]);

  const pickFile = async (file?: File | null) => {
    setFileError('');
    if (!file) return;
    const err = validatePlanAttachment({ name: file.name, size: file.size });
    if (err) { setFileError(err); return; }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAttachment({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl });
      // O tema costuma coincidir com o nome do ficheiro; só sugere se ainda estiver vazio.
      setForm((f) => (f.topic.trim() ? f : { ...f, topic: file.name.replace(/\.[^.]+$/, '') }));
    } catch (e: any) {
      setFileError(e?.message || 'Não foi possível ler o ficheiro.');
    }
  };

  const closeForm = () => { setOpen(false); setAttachment(undefined); setFileError(''); setMode('formulario'); };

  const save = async () => {
    const asFile = mode === 'ficheiro';
    if (asFile && !attachment) { setFileError('Escolha o ficheiro do plano.'); return; }
    const ok = await run(
      () => dbService.saveLessonPlan({
        id: form.id || undefined, teacherId: String(currentUser.id), classId: form.classId, subjectName: form.subjectName,
        trimester: form.trimester, weekStart: form.weekStart ? mondayOf(form.weekStart) : '', topic: form.topic,
        objectives: asFile ? '' : form.objectives, activities: asFile ? '' : form.activities,
        resources: asFile ? undefined : form.resources || undefined, evaluation: asFile ? undefined : form.evaluation || undefined,
        attachment: asFile ? attachment : undefined
      }),
      'A guardar plano...', RULE, 'Plano guardado como rascunho.'
    );
    if (ok) { closeForm(); setForm({ ...emptyPlan, trimester: form.trimester }); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PORTAL DO PROFESSOR"
        title="PLANOS DE AULAS"
        description={canReview
          ? 'Aprove ou devolva os planos enviados pelos professores.'
          : 'Prepare o plano da semana e acompanhe a aprovação da direção.'}
        actions={<IconButton variant="solid" icon="add" label="CADASTRAR" showText disabled={!canWrite} onClick={() => { setMessage(null); setForm({ ...emptyPlan, trimester: form.trimester }); setAttachment(undefined); setFileError(''); setMode('formulario'); setOpen(true); }} />}
      />
      <Banner message={message} />
      {open && (
        <FormModal title={form.id ? 'Editar Plano de Aulas' : 'Novo Plano de Aulas'} subtitle="Plano de Aulas" icon="event_note" onClose={closeForm} onSubmit={save} submitLabel="Guardar rascunho" submitDisabled={!canWrite} widthClass="max-w-4xl">
          <div className="grid md:grid-cols-4 gap-3">
          <ClassSubjectFields classes={classes} subjectsOf={subjectsOf} classId={form.classId} subjectName={form.subjectName} onClass={(v) => set('classId', v)} onSubject={(v) => set('subjectName', v)} />
          <div><label className={labelCls}>Trimestre</label>
            <select className={inputCls} value={form.trimester} onChange={(e) => set('trimester', e.target.value as '1' | '2' | '3')}><option value="1">1.º</option><option value="2">2.º</option><option value="3">3.º</option></select></div>
          <div><label className={labelCls}>Semana (qualquer dia dela) *</label><input className={inputCls} type="date" value={form.weekStart} onChange={(e) => set('weekStart', e.target.value)} />
            {form.weekStart && <p className="text-[10px] text-slate-400 mt-0.5">Semana de segunda-feira, {fmtDate(mondayOf(form.weekStart))}</p>}</div>
          <div className="md:col-span-4"><label className={labelCls}>Tema *</label><input className={inputCls} value={form.topic} onChange={(e) => set('topic', e.target.value)} /></div>
          <div className="md:col-span-4 flex flex-wrap gap-2" role="tablist" aria-label="Como quer entregar o plano">
            {([['formulario', 'Preencher formulário', 'edit_note'], ['ficheiro', 'Carregar documento (PDF, Word ou Excel)', 'upload_file']] as const).map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
                className={`h-9 px-3 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 ${mode === id ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                <span className="material-symbols-outlined text-[16px]">{icon}</span>{label}
              </button>
            ))}
          </div>
          {mode === 'ficheiro' ? (
            <div className="md:col-span-4 space-y-2">
              <label className={labelCls}>Ficheiro do plano de aulas *</label>
              <input type="file" accept={PLAN_ATTACHMENT_ACCEPT} className="block w-full text-xs text-slate-700 file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:text-[11px] file:font-bold file:cursor-pointer"
                onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              <p className="text-[10px] text-slate-400">PDF, Word ou Excel, até {Math.round(PLAN_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.</p>
              {attachment && <AttachmentLink attachment={attachment} />}
              {fileError && <p role="alert" className="text-[11px] font-semibold text-red-700">{fileError}</p>}
            </div>
          ) : (
            <>
              <div className="md:col-span-2"><label className={labelCls}>Objetivos *</label><textarea className={textareaCls} rows={3} value={form.objectives} onChange={(e) => set('objectives', e.target.value)} /></div>
              <div className="md:col-span-2"><label className={labelCls}>Atividades *</label><textarea className={textareaCls} rows={3} value={form.activities} onChange={(e) => set('activities', e.target.value)} /></div>
              <div className="md:col-span-2"><label className={labelCls}>Recursos</label><textarea className={textareaCls} rows={2} value={form.resources} onChange={(e) => set('resources', e.target.value)} /></div>
              <div className="md:col-span-2"><label className={labelCls}>Avaliação</label><textarea className={textareaCls} rows={2} value={form.evaluation} onChange={(e) => set('evaluation', e.target.value)} /></div>
            </>
          )}
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
      {allPlans.length > 0 && <WorkFiltersBar keys={planKeys} filters={filters} onChange={setFilters} showTeacher={canReview} textLabel="Tema" shown={plans.length} />}
      {allPlans.length === 0 ? <Empty text="Ainda não há planos de aulas." /> : plans.length === 0 ? <Empty text={NO_MATCH} /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="px-3 py-2">Semana</th><th className="px-3 py-2">Tema</th><th className="px-3 py-2">Turma · Disciplina</th><th className="px-3 py-2">Trim.</th>{canReview && <th className="px-3 py-2">Professor</th>}<th className="px-3 py-2">Conteúdo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visiblePlans.map((p) => (
                <React.Fragment key={p.id}>
                  <tr className="align-top hover:bg-slate-50/60">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.weekStart)}</td>
                    <td className={`px-3 py-2 font-semibold text-slate-800 ${WRAP}`}>{p.topic}</td>
                    <td className="px-3 py-2">{p.className} · {p.subjectName}</td>
                    <td className="px-3 py-2">{p.trimester}.º</td>
                    {canReview && <td className="px-3 py-2">{p.teacherName}</td>}
                    <td className="px-3 py-2 min-w-[14rem]">
                      {p.attachment ? <AttachmentLink attachment={p.attachment} /> : (
                        <div className={`space-y-0.5 text-slate-700 ${WRAP}`}>
                          <p><strong>Objetivos:</strong> {p.objectives}</p>
                          <p><strong>Atividades:</strong> {p.activities}</p>
                          {p.resources && <p><strong>Recursos:</strong> {p.resources}</p>}
                          {p.evaluation && <p><strong>Avaliação:</strong> {p.evaluation}</p>}
                        </div>
                      )}
                      {p.reviewerNote && <p className={`mt-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-amber-900 ${WRAP}`}><strong>{p.reviewedBy || 'Direção'}:</strong> {p.reviewerNote}</p>}
                    </td>
                    <td className="px-3 py-2"><Badge tone={PLAN_STATUS[p.status].tone}>{PLAN_STATUS[p.status].label}</Badge></td>
                    <td className="px-3 py-2">
              <div className="flex flex-wrap justify-end gap-1">
                {(p.status === 'rascunho' || p.status === 'devolvido') && (
                  <>
                    <IconButton icon="edit" tone="info" label="Editar" disabled={!canWrite} onClick={() => { setForm({ id: p.id, classId: String(p.classId), subjectName: p.subjectName, trimester: p.trimester, weekStart: p.weekStart, topic: p.topic, objectives: p.objectives, activities: p.activities, resources: p.resources || '', evaluation: p.evaluation || '' }); setAttachment(p.attachment); setFileError(''); setMessage(null); setMode(p.attachment ? 'ficheiro' : 'formulario'); setOpen(true); }} />
                    <IconButton icon="send" tone="success" label="Enviar à direção" disabled={!canWrite} onClick={() => run(() => dbService.transitionLessonPlan(p.id, 'submeter'), 'A submeter...', RULE, 'Plano enviado à direção.')} />
                    <IconButton icon="delete" tone="danger" label="Apagar" disabled={!canWrite} onClick={() => run(() => dbService.deleteLessonPlan(p.id), 'A apagar...', RULE, 'Plano apagado.')} />
                  </>
                )}
                {canReview && p.status === 'submetido' && (
                  <>
                    <IconButton icon="check_circle" tone="success" label="Aprovar" onClick={() => run(() => dbService.transitionLessonPlan(p.id, 'aprovar', undefined, true), 'A aprovar...', REVIEW_RULE, 'Plano aprovado.')} />
                    <IconButton icon="undo" tone="danger" label="Devolver" onClick={() => { setNoteFor(noteFor === p.id ? null : p.id); setNote(''); }} />
                  </>
                )}
              </div>
                    </td>
                  </tr>
                  {noteFor === p.id && (
                    <tr className="bg-slate-50/70"><td colSpan={canReview ? 8 : 7} className="px-3 py-2">
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><label className={labelCls}>O que deve ser corrigido *</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
                        <IconButton icon="check" tone="success" label="Confirmar" disabled={!note.trim()} onClick={async () => { if (await run(() => dbService.transitionLessonPlan(p.id, 'devolver', note, true), 'A devolver...', REVIEW_RULE, 'Plano devolvido ao professor.')) setNoteFor(null); }} />
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <TablePagination total={plans.length} page={pgPlans} onPageChange={setPgPlans} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sumários
// ---------------------------------------------------------------------------
function SumariosTab({ db, currentUser, role }: { db: SchoolDatabase; currentUser: User; role: UserRole }) {
  const acl = useAccessControl(role);
  const canWrite = acl.can(RULE);
  const canSeeAll = acl.can(REVIEW_RULE);
  const { message, setMessage, run } = useOperation(role);
  const { classes, subjectsOf } = useClassSubject(db, currentUser);
  const [open, setOpen] = useState(false);
  const blank = { id: '', classId: '', subjectName: '', date: toISO(new Date()), topic: '', summary: '', homework: '' };
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [filters, setFilters] = useState<WorkFilters>(NO_FILTERS);
  const allEntries: LessonSummaryEntry[] = (db.lessonSummaries || [])
    .filter((e) => canSeeAll || String(e.teacherId) === String(currentUser.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.lessonNumber - a.lessonNumber));
  // O sumário não guarda trimestre: deduz-se da data da aula, pelas datas de Configurações → Ano Letivo.
  const entryKey = (e: LessonSummaryEntry): FilterKey => ({ teacherId: String(e.teacherId), teacherName: e.teacherName, classId: String(e.classId), className: e.className, subjectName: e.subjectName, trimester: findTrimesterKeyForDate(db.settings as any, e.date) || '', text: e.topic });
  const entryKeys = allEntries.map(entryKey);
  const entries = allEntries.filter((e) => matchesFilters(entryKey(e), filters));
  const { page: pgEntries, setPage: setPgEntries, pageItems: visibleEntries } = usePagedList(entries, [entries.length]);

  const save = async () => {
    const ok = await run(
      () => dbService.saveLessonSummary({ id: form.id || undefined, classId: form.classId, subjectName: form.subjectName, date: form.date, topic: form.topic, summary: form.summary, homework: form.homework || undefined }),
      'A guardar sumário...', RULE, 'Sumário guardado.'
    );
    if (ok) { setForm({ ...blank, classId: form.classId, subjectName: form.subjectName }); setOpen(false); }
  };
  const openNew = () => { setMessage(null); setForm({ ...blank, classId: form.classId, subjectName: form.subjectName }); setOpen(true); };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PORTAL DO PROFESSOR"
        title="SUMÁRIOS DAS AULAS"
        description="Registe o que foi lecionado em cada aula. Os sumários numeram-se automaticamente por disciplina."
        actions={<IconButton variant="solid" icon="add" label="CADASTRAR" showText disabled={!canWrite} onClick={openNew} />}
      />
      <Banner message={message} />
      {open && (
        <FormModal title={form.id ? 'Editar Sumário' : 'Novo Sumário'} subtitle="Sumários das Aulas" icon="menu_book" onClose={() => { setOpen(false); setForm(blank); }} onSubmit={save} submitLabel={form.id ? 'Guardar alterações' : 'Registar sumário'} submitDisabled={!canWrite} widthClass="max-w-4xl">
      <div className="grid md:grid-cols-4 gap-3">
        <ClassSubjectFields classes={classes} subjectsOf={subjectsOf} classId={form.classId} subjectName={form.subjectName} onClass={(v) => set('classId', v)} onSubject={(v) => set('subjectName', v)} />
        <div><label className={labelCls}>Data da aula *</label><input className={inputCls} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
        <div><label className={labelCls}>Tema *</label><input className={inputCls} value={form.topic} onChange={(e) => set('topic', e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Sumário *</label><textarea className={textareaCls} rows={3} value={form.summary} onChange={(e) => set('summary', e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Trabalho de casa</label><textarea className={textareaCls} rows={3} value={form.homework} onChange={(e) => set('homework', e.target.value)} /></div>
      </div>
      <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
      {allEntries.length > 0 && <WorkFiltersBar keys={entryKeys} filters={filters} onChange={setFilters} showTeacher={canSeeAll} textLabel="Tema" shown={entries.length} />}
      {allEntries.length === 0 ? <Empty text="Ainda não há sumários registados." /> : entries.length === 0 ? <Empty text={NO_MATCH} /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Turma · Disciplina</th><th className="text-left px-3 py-2">Aula</th><th className="text-left px-3 py-2">Tema e sumário</th>{canSeeAll && <th className="text-left px-3 py-2">Professor</th>}<th className="px-3 py-2 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleEntries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2">{e.className} · {e.subjectName}</td>
                  <td className="px-3 py-2 font-mono">{e.lessonNumber}</td>
                  <td className="px-3 py-2"><p className={`font-semibold text-slate-800 ${WRAP}`}>{e.topic}</p><p className={`text-slate-600 ${WRAP}`}>{e.summary}</p>{e.homework && <p className={`text-slate-500 mt-1 ${WRAP}`}><em>TPC:</em> {e.homework}</p>}</td>
                  {canSeeAll && <td className="px-3 py-2">{e.teacherName}</td>}
                  <td className="px-3 py-2 text-right">
                    {String(e.teacherId) === String(currentUser.id)
                      ? <IconButton icon="edit" tone="info" label="Editar" disabled={!canWrite} onClick={() => { setMessage(null); setForm({ id: e.id, classId: String(e.classId), subjectName: e.subjectName, date: e.date, topic: e.topic, summary: e.summary, homework: e.homework || '' }); setOpen(true); }} />
                      : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination total={entries.length} page={pgEntries} onPageChange={setPgEntries} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Materiais de apoio
// ---------------------------------------------------------------------------
function MateriaisTab({ db, currentUser, role }: { db: SchoolDatabase; currentUser: User; role: UserRole }) {
  const acl = useAccessControl(role);
  const canWrite = acl.can(RULE);
  const canSeeAll = acl.can(REVIEW_RULE);
  const { message, setMessage, run } = useOperation(role);
  const { classes, subjectsOf } = useClassSubject(db, currentUser);
  const [open, setOpen] = useState(false);
  const blank = { classId: '', subjectName: '', title: '', description: '', link: '', visibleToStudents: true };
  const [form, setForm] = useState(blank);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [filters, setFilters] = useState<WorkFilters>(NO_FILTERS);
  const allMaterials: TeachingMaterial[] = (db.teachingMaterials || []).filter((m) => canSeeAll || String(m.teacherId) === String(currentUser.id));
  // O material não guarda trimestre: deduz-se da data em que foi adicionado.
  const materialKey = (m: TeachingMaterial): FilterKey => ({ teacherId: String(m.teacherId), teacherName: m.teacherName, classId: String(m.classId), className: m.className, subjectName: m.subjectName, trimester: findTrimesterKeyForDate(db.settings as any, (m.createdAt || '').slice(0, 10)) || '', text: m.title });
  const materialKeys = allMaterials.map(materialKey);
  const materials = allMaterials.filter((m) => matchesFilters(materialKey(m), filters));
  const { page: pgMaterials, setPage: setPgMaterials, pageItems: visibleMaterials } = usePagedList(materials, [materials.length]);

  const save = async () => {
    const ok = await run(
      () => dbService.saveTeachingMaterial({ classId: form.classId, subjectName: form.subjectName, title: form.title, description: form.description || undefined, link: form.link, visibleToStudents: form.visibleToStudents }),
      'A guardar material...', RULE, form.visibleToStudents ? 'Material guardado e visível aos alunos.' : 'Material guardado (visível só para si).'
    );
    if (ok) { setForm({ ...blank, classId: form.classId, subjectName: form.subjectName }); setOpen(false); }
  };
  const openNew = () => { setMessage(null); setForm({ ...blank, classId: form.classId, subjectName: form.subjectName }); setOpen(true); };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PORTAL DO PROFESSOR"
        title="MATERIAIS DE APOIO"
        description="Guarde aqui as ligações (Drive, OneDrive…) dos seus materiais. Os alunos só veem os que marcar como visíveis."
        actions={<IconButton variant="solid" icon="add" label="CADASTRAR" showText disabled={!canWrite} onClick={openNew} />}
      />
      <Banner message={message} />
      {open && (
        <FormModal title="Novo Material de Apoio" subtitle="Materiais de Apoio" icon="folder_open" onClose={() => setOpen(false)} onSubmit={save} submitLabel="Adicionar material" submitDisabled={!canWrite} widthClass="max-w-3xl">
      <div className="grid md:grid-cols-4 gap-3">
        <ClassSubjectFields classes={classes} subjectsOf={subjectsOf} classId={form.classId} subjectName={form.subjectName} onClass={(v) => set('classId', v)} onSubject={(v) => set('subjectName', v)} />
        <div className="md:col-span-2"><label className={labelCls}>Título *</label><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Ligação *</label><input className={inputCls} value={form.link} onChange={(e) => set('link', e.target.value)} placeholder="https://..." /></div>
        <div className="md:col-span-2"><label className={labelCls}>Descrição</label><input className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
        <label className="text-xs text-slate-700 flex items-center gap-2 md:col-span-4"><input type="checkbox" checked={form.visibleToStudents} onChange={(e) => set('visibleToStudents', e.target.checked)} />Visível aos alunos da turma</label>
      </div>
      <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
      {allMaterials.length > 0 && <WorkFiltersBar keys={materialKeys} filters={filters} onChange={setFilters} showTeacher={canSeeAll} textLabel="Título" shown={materials.length} />}
      {allMaterials.length === 0 ? <Empty text="Ainda não há materiais." /> : materials.length === 0 ? <Empty text={NO_MATCH} /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="px-3 py-2">Título</th><th className="px-3 py-2">Turma · Disciplina</th>{canSeeAll && <th className="px-3 py-2">Professor</th>}<th className="px-3 py-2">Data</th><th className="px-3 py-2">Ligação</th><th className="px-3 py-2">Visibilidade</th><th className="px-3 py-2 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleMaterials.map((m) => (
                <tr key={m.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-3 py-2"><p className="font-semibold text-slate-800">{m.title}</p>{m.description && <p className="text-[11px] text-slate-500">{m.description}</p>}</td>
                  <td className="px-3 py-2">{m.className} · {m.subjectName}</td>
                  {canSeeAll && <td className="px-3 py-2">{m.teacherName}</td>}
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.createdAt)}</td>
                  <td className="px-3 py-2 max-w-[16rem]">{isSafeHttpUrl(m.link)
                    ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{m.link}</a>
                    : <span className="text-red-700">Ligação inválida</span>}</td>
                  <td className="px-3 py-2"><Badge tone={m.visibleToStudents ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>{m.visibleToStudents ? 'Visível aos alunos' : 'Interno'}</Badge></td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-1">
                    {isSafeHttpUrl(m.link) && <IconButton icon="open_in_new" tone="primary" label="Abrir ligação" onClick={() => window.open(m.link, '_blank', 'noopener,noreferrer')} />}
                    {(canSeeAll || String(m.teacherId) === String(currentUser.id)) && (
                      <IconButton icon="delete" tone="danger" label="Remover" disabled={!canWrite} onClick={() => run(() => { dbService.deleteTeachingMaterial(m.id); return { success: true }; }, 'A remover...', RULE, 'Material removido.')} />
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination total={materials.length} page={pgMaterials} onPageChange={setPgMaterials} />
        </div>
      )}
    </div>
  );
}
