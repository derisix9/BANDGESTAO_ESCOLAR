import React, { useMemo, useState } from 'react';
import { ClassRoom, SchoolDatabase, Student, UserRole } from '../types';
import type { ClassCouncilRecord, ClassCouncilStudentEntry } from '../types/processos';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { SearchableSelect } from '../components/SearchableSelect';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { getSubjectsForClass } from '../utils/classSubjects';
import { normalizeGradeRules } from '../utils/pautaCalculations';
import {
  AcademicDocType,
  CouncilDecision,
  DEFAULT_RECOVERY_RULES,
  DOC_LABEL
} from '../utils/academicProcesses';
import { CouncilContext, buildCouncilEntry, buildCouncilStudentSummary } from '../utils/councilGrades';
import { resolveCourseDurationYears } from '../utils/recursoRules';
import { CouncilStudentGradesModal } from '../components/CouncilStudentGradesModal';
import { FormModal } from '../components/FormModal';
import { BtnIcon, IconButton } from '../components/IconButton';
import { reprintIssuedDocument } from '../studio/reprint';
import { TransferenciasPanel } from '../components/transfers/TransferenciasPanel';
import { FormModalHeader } from '../components/FormModalHeader';
import { ORIGIN_LABEL, processDocsByStudent, printProcessDoc, viewProcessDoc, type ProcessDoc } from '../utils/studentProcessDocs';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

export type ProcessosSection = 'documentos_academicos' | 'transferencias' | 'conselho_turma' | 'recuperacao_recurso';

interface Props {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  section: ProcessosSection;
}

const inputCls = 'w-full h-10 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg';
const labelCls = 'block text-[11px] font-bold text-slate-600 mb-1';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg hover:bg-[#12315c] active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed';

type Result = { success: boolean; error?: string };

function useRunner(role: UserRole) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Result, loading: string, rule: string, okText: string) => {
    let result: Result = { success: false, error: 'Operação não executada.' };
    try {
      // Se a operação devolver success:false lança o motivo real: o diálogo mostra «Operação Não Realizada»
      // e nunca um «sucesso» falso. O sucesso é confirmado só pelo diálogo global (sem faixa verde).
      await runGlobalOperation(
        () => { result = fn(); if (!result.success) throw new Error(result.error || 'Não foi possível concluir.'); },
        { loadingMessage: loading, requiredRule: rule, userRole: role, resolveSuccessText: () => okText }
      );
    } catch (err: any) {
      result = { success: false, error: err?.message || 'Sem permissão para esta operação.' };
    }
    setMessage(result.success ? null : { ok: false, text: result.error || 'Não foi possível concluir.' });
    return result;
  };
  return { message, setMessage, run };
}

function Banner({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <div className={`px-3 py-2 rounded-lg text-xs font-semibold ${message.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
      {message.text}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 font-semibold py-10 text-center">{text}</p>;
}

function studentOptions(students: Student[]) {
  return students.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.procNumber} · ${s.className || s.grade}` }));
}

function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ---------------------------------------------------------------------------
// 1. Documentos académicos
// ---------------------------------------------------------------------------
function DocumentosTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, setMessage, run } = useRunner(role);
  const [printing, setPrinting] = useState('');
  const [filter, setFilter] = useState('');
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [mode, setMode] = useState<'emitidos' | 'processos'>('emitidos');
  const [processOf, setProcessOf] = useState<string | null>(null);
  const docs = db.academicDocuments || [];
  const processes = useMemo(() => processDocsByStudent(db), [db.students, db.admissions]); // eslint-disable-line react-hooks/exhaustive-deps
  const processShown = processes.filter(({ student }) => !filter.trim() || `${student.name} ${student.procNumber} ${student.className || ''}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const { page: pgProcessShown, setPage: setPgProcessShown, pageItems: visibleProcessShown } = usePagedList(processShown, [processShown.length]);
  const processEntry = processOf ? processes.find((p) => String(p.student.id) === processOf) : undefined;
  const { page: pgDocs, setPage: setPgDocs, pageItems: visibleDocs } = usePagedList(processEntry?.docs ?? [], [processEntry?.docs.length ?? 0]);
  const fileAction = (fn: () => boolean, okMsg?: string) => {
    setMessage(fn() ? null : { ok: false, text: okMsg || 'Não foi possível abrir o ficheiro. Se o navegador bloqueou a janela, permita pop-ups; se o ficheiro não existe neste dispositivo, sincronize e tente de novo.' });
  };
  const canVoid = acl.can('documentos.anular');
  const shown = docs.filter((d) => !filter.trim() || `${d.number} ${d.studentName} ${d.studentProcNumber}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const { page: pgShown, setPage: setPgShown, pageItems: visibleShown } = usePagedList(shown, [shown.length]);
  const issuedCount = docs.filter((d) => d.status !== 'anulado').length;
  const voidedCount = docs.length - issuedCount;
  const voidDoc = voidId ? docs.find((d) => d.id === voidId) : undefined;

  /** Reimprime o documento tal como foi emitido no Estúdio; os antigos (sem receita) usam o modelo simples. */
  const printDoc = async (d: (typeof docs)[number]) => {
    setPrinting(d.id);
    try {
      const r = await reprintIssuedDocument(d, db);
      setMessage(r.ok ? null : { ok: false, text: r.error || 'Não foi possível imprimir.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Não foi possível imprimir.' });
    } finally { setPrinting(''); }
  };
  const submitVoid = async () => {
    if (!voidDoc) return;
    const r = await run(() => dbService.voidAcademicDocument(voidDoc.id, voidReason), 'A anular...', 'documentos.anular', 'Documento anulado. O número fica reservado.');
    if (r.success) setVoidId(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Total</p><p className="text-xl font-bold text-[#0b1f3a]">{docs.length}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Emitidos</p><p className="text-xl font-bold text-emerald-700">{issuedCount}</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Anulados</p><p className="text-xl font-bold text-red-700">{voidedCount}</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex gap-2 shrink-0">
          {([['emitidos', 'Documentos emitidos'], ['processos', 'Processos dos alunos']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setMode(id)} className={`px-3 h-10 text-xs font-bold rounded-lg border ${mode === id ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        <input className={inputCls} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={mode === 'emitidos' ? 'Pesquisar por número, aluno ou processo' : 'Pesquisar aluno, n.º de processo ou turma'} />
      </div>
      <Banner message={message} />
      {mode === 'processos' ? (
        processShown.length === 0 ? <Empty text="Nenhum aluno encontrado." /> : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Processo</th><th className="p-3">Aluno</th><th className="p-3">Turma</th><th className="p-3">Documentos anexados</th><th className="p-3" /></tr></thead>
              <tbody>
                {visibleProcessShown.map(({ student, docs: files }) => (
                  <tr key={student.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="p-3 font-mono font-bold">{student.procNumber}</td>
                    <td className="p-3 font-semibold">{student.name}</td>
                    <td className="p-3 text-slate-600">{student.className || student.grade || '—'}</td>
                    <td className="p-3">{files.length === 0 ? <span className="text-slate-400">Nenhum</span> : <span className="font-bold text-[#0b1f3a]">{files.length}</span>}</td>
                    <td className="p-3 text-right"><IconButton icon="folder_open" label="Ver documentos do processo" disabled={files.length === 0} disabledTitle="Este aluno não tem documentos anexados" onClick={() => setProcessOf(String(student.id))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={processShown.length} page={pgProcessShown} onPageChange={setPgProcessShown} />
          </div>
        )
      ) : shown.length === 0 ? <Empty text="Ainda não há documentos emitidos." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Número</th><th className="p-3">Tipo</th><th className="p-3">Aluno / Professor / Funcionário</th><th className="p-3">Emitido</th><th className="p-3">Estado</th><th className="p-3" /></tr></thead>
            <tbody>
              {visibleShown.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="p-3 font-mono font-bold">{d.number}</td>
                  <td className="p-3">{DOC_LABEL[d.type]}</td>
                  <td className="p-3">{d.studentName}<div className="text-[10px] text-slate-400">{d.personKind === 'professor' ? 'Professor' : d.personKind === 'funcionario' ? 'Funcionário' : 'Aluno'} · {d.studentProcNumber}</div></td>
                  <td className="p-3">{new Date(d.issuedAt).toLocaleDateString('pt-PT')}</td>
                  <td className="p-3">{d.status === 'anulado' ? <span className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 font-bold text-[10px] uppercase">Anulado</span> : <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] uppercase">Emitido</span>}</td>
                  <td className="p-3"><div className="flex items-center gap-1 justify-end">
                    <IconButton icon="print" label="Imprimir documento emitido" disabled={printing === d.id} onClick={() => printDoc(d)} />
                    {d.status === 'emitido' && <IconButton icon="block" tone="danger" label="Anular" disabled={!canVoid} disabledTitle={acl.denyMessage('documentos.anular')} onClick={() => { setVoidId(d.id); setVoidReason(''); }} />}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination total={shown.length} page={pgShown} onPageChange={setPgShown} />
        </div>
      )}

      {processEntry && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) setProcessOf(null); }}>
          <div className="bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader title={processEntry.student.name} subtitle={`Processo ${processEntry.student.procNumber} · documentos do aluno`} icon="folder_open" onClose={() => setProcessOf(null)} />
            <div className="flex-1 overflow-y-auto p-6 text-xs">
              <table className="w-full">
                <thead className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] tracking-wider text-left"><tr><th className="p-2">Documento</th><th className="p-2">Origem</th><th className="p-2">Ficheiro</th><th className="p-2" /></tr></thead>
                <tbody>
                  {visibleDocs.map((f: ProcessDoc) => (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="p-2 font-semibold">{f.label}</td>
                      <td className="p-2 text-slate-600">{ORIGIN_LABEL[f.origin]}</td>
                      <td className="p-2 text-slate-500 break-all">{f.fileName}{!f.dataUrl && <div className="text-amber-700">Indisponível neste dispositivo (sincronize).</div>}</td>
                      <td className="p-2"><div className="flex items-center gap-1 justify-end">
                        <IconButton icon="visibility" label="Ver documento" disabled={!f.dataUrl} onClick={() => fileAction(() => viewProcessDoc(f))} />
                        <IconButton icon="print" label="Imprimir documento" disabled={!f.dataUrl} onClick={() => fileAction(() => printProcessDoc(f, processEntry.student.name))} />
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={processEntry.docs.length} page={pgDocs} onPageChange={setPgDocs} />
              <Banner message={message && !message.ok ? message : null} />
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex justify-end">
              <button type="button" onClick={() => setProcessOf(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {voidDoc && (
        <FormModal title={`Anular ${voidDoc.number}`} subtitle={`${DOC_LABEL[voidDoc.type]} · ${voidDoc.studentName}`} icon="block" onClose={() => setVoidId(null)} onSubmit={submitVoid} submitLabel="Confirmar anulação" submitDisabled={!voidReason.trim()} widthClass="max-w-xl">
          <div>
            <label className={labelCls}>Motivo da anulação (obrigatório)</label>
            <input className={inputCls} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus />
            <p className="text-[11px] text-slate-500 mt-2">O número do documento fica reservado e a anulação fica registada.</p>
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Conselho de turma
// ---------------------------------------------------------------------------
const DECISION_LABEL: Record<CouncilDecision, string> = { aprovado: 'Aprovado', reprovado: 'Reprovado', condicional: 'Condicional' };
const DECISION_COLOR: Record<CouncilDecision, string> = { aprovado: 'text-emerald-700', reprovado: 'text-red-700', condicional: 'text-amber-700' };

function ConselhoTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, run } = useRunner(role);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<ClassCouncilStudentEntry[] | null>(null);
  const { page: pgEntries, setPage: setPgEntries, pageItems: visibleEntries } = usePagedList(entries ?? [], [entries?.length ?? 0]);
  const [gradesFor, setGradesFor] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const canManage = acl.can('conselho.manage');
  const canHomologate = acl.can('conselho.homologar');
  const year = db.settings?.currentAcademicYear || '';
  const classes: ClassRoom[] = db.classes || [];
  const cls = classes.find((c) => String(c.id) === classId);
  const saved: ClassCouncilRecord | undefined = (db.classCouncils || []).find((c) => c.classId === classId && c.academicYear === year);
  const locked = saved?.status === 'homologado';

  // Mesmas regras e mesmas notas do lançamento (Mini-Pauta → Pauta Final).
  const gradeRules = useMemo(() => normalizeGradeRules(db.settings?.gradeRules as any), [db.settings?.gradeRules]);
  const students = useMemo(() => (cls ? getStudentsForClass(String(cls.id), db.students || [], cls.name) : []), [cls, db.students]);
  const ctx: CouncilContext | null = useMemo(() => (cls ? { cls, subjects: getSubjectsForClass(db, cls), rules: gradeRules, currentTrimester: db.settings?.currentTrimester, courseDurationYears: resolveCourseDurationYears(db.courses, cls), attendanceSheets: db.attendanceSheets || [], academicYear: cls.academicYear || db.settings?.currentAcademicYear } : null), [cls, db, gradeRules]);
  const miniStore = classId ? (db.miniPautasStore?.[classId] as Record<string, any[]> | undefined) : undefined;

  const entriesFromGrades = (existing?: ClassCouncilStudentEntry[]): ClassCouncilStudentEntry[] => {
    if (!ctx) return [];
    return students.map((st) =>
      buildCouncilEntry(st, buildCouncilStudentSummary({ student: st, ctx, miniStore }), existing?.find((e) => e.studentId === String(st.id)))
    );
  };

  const load = () => {
    if (!cls || !ctx) return;
    // Conselho homologado: fica exatamente como foi decidido. Rascunho: refaz a proposta com as notas
    // de agora, mantendo as decisões manuais e as justificações já escritas.
    if (saved?.status === 'homologado') { setEntries(saved.entries); setDate(saved.date); return; }
    if (saved) setDate(saved.date);
    setEntries(entriesFromGrades(saved?.entries));
  };

  const update = (i: number, patch: Partial<ClassCouncilStudentEntry>) =>
    setEntries((cur) => (cur ? cur.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) : cur));
  const incompleteCount = entries?.filter((e) => e.incomplete || e.reasons.some((r) => r.startsWith('Faltam notas'))).length ?? 0;

  const student = gradesFor ? students.find((s) => String(s.id) === gradesFor) : undefined;
  const readOnlyReason = locked ? 'Conselho homologado: as notas já não podem ser alteradas.' : !canManage ? acl.denyMessage('conselho.manage') : undefined;

  // Grava as notas do boletim (Mini-Pauta + notas do aluno + Pauta Final) e regista a alteração no conselho.
  const saveStudentGrades = async (rows: Record<string, any>, reason: string): Promise<boolean> => {
    if (!student || !cls || !ctx || !entries) return false;
    const result = await run(() => {
      const applied = dbService.applyCouncilStudentGrades({ classId, studentId: String(student.id), rows, reason });
      if (!applied.success) return applied;
      const fresh = dbService.getDb();
      const freshStudent = (fresh.students || []).find((s) => String(s.id) === String(student.id)) || student;
      const freshStore = fresh.miniPautasStore?.[classId] as Record<string, any[]> | undefined;
      const summary = buildCouncilStudentSummary({ student: freshStudent, ctx, miniStore: freshStore });
      const nextEntries = entries.map((e) => (e.studentId === String(student.id) ? buildCouncilEntry(freshStudent, summary, e) : e));
      setEntries(nextEntries);
      return dbService.saveClassCouncil({ classId, date, entries: nextEntries, gradeChanges: applied.changes });
    }, 'A gravar notas no conselho...', 'conselho.manage', 'Notas gravadas no conselho. A Mini-Pauta e a Pauta Final foram atualizadas.');
    return result.success;
  };

  const changes = saved?.gradeChanges || [];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2"><SearchableSelect label="Turma" options={classes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.grade }))} value={classId} onChange={(v) => { setClassId(v); setEntries(null); setGradesFor(null); }} placeholder="Selecione a turma" /></div>
        <div><label className={labelCls}>Data do conselho</label><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} disabled={locked} /></div>
        <button className={btnPrimary} disabled={!classId} onClick={load}><BtnIcon n={saved ? 'folder_open' : 'auto_awesome'} /> {saved ? 'Abrir conselho' : 'Gerar proposta'}</button>
      </div>
      <Banner message={message} />
      {locked && <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Conselho homologado por {saved?.homologatedBy}. Já não pode ser alterado.</div>}
      {entries && incompleteCount > 0 && !locked && <Notice tone="warn">{incompleteCount} aluno(s) com notas por lançar (disciplina ou trimestre em falta): a proposta deles é provisória. Use «Notas» para as atribuir aqui, ou escreva uma justificação, antes de homologar.</Notice>}
      {entries && entries.length === 0 && <Empty text="Esta turma não tem alunos." />}
      {entries && entries.length > 0 && (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Aluno</th><th className="p-3">Negativas no ano</th><th className="p-3">Proposta</th><th className="p-3">Decisão</th><th className="p-3">Justificação</th><th className="p-3">Notas</th></tr></thead>
              <tbody>
                {visibleEntries.map((e, i) => {
                  const differs = e.decision !== e.proposed;
                  const count = e.negativeCount ?? e.negatives.length;
                  return (
                    <tr key={e.studentId} className="border-t border-slate-100 align-top">
                      <td className="p-3 font-semibold">{e.studentName}<div className="text-[10px] text-slate-400 font-normal max-w-xs">{e.reasons.join(' ')}</div></td>
                      <td className="p-3">
                        {count === 0 ? <span className="text-emerald-700 font-semibold">0 · nenhuma</span> : (
                          <>
                            <span className="font-bold text-red-700">{count} disciplina{count === 1 ? '' : 's'}</span>
                            <ul className="mt-0.5 space-y-0.5">
                              {e.negatives.map((n) => (
                                <li key={n.subjectId}>{n.subjectName} <span className="font-mono text-red-600">({n.grade})</span>{n.isKey && <span className="ml-1 text-[10px] font-bold text-[#7a0c0c]">chave</span>}{n.recovered && <span className="ml-1 text-[10px] font-bold text-emerald-700">recuperada</span>}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                      <td className={`p-3 font-bold ${DECISION_COLOR[e.proposed]}`}>{DECISION_LABEL[e.proposed]}</td>
                      <td className="p-3">
                        <select className={inputCls} value={e.decision} disabled={locked || !canManage} onChange={(ev) => update(i, { decision: ev.target.value as CouncilDecision })}>
                          {(Object.keys(DECISION_LABEL) as CouncilDecision[]).map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
                        </select>
                      </td>
                      <td className="p-3"><input className={`${inputCls} ${(differs || e.incomplete) && !(e.justification || '').trim() ? 'border-red-400' : ''}`} disabled={locked || !canManage} value={e.justification || ''} onChange={(ev) => update(i, { justification: ev.target.value })} placeholder={differs ? 'Obrigatória: decisão difere da proposta' : e.incomplete ? 'Obrigatória se as notas ficarem por lançar' : 'Opcional'} /></td>
                      <td className="p-3">
                        <IconButton icon={locked || !canManage ? 'visibility' : 'grading'} label={locked || !canManage ? 'Ver notas do aluno' : 'Atribuir notas'} tone="primary" onClick={() => setGradesFor(e.studentId)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination total={entries.length} page={pgEntries} onPageChange={setPgEntries} />
          </div>
          {!locked && (
            <div className="flex justify-end gap-2">
              <button className={btnGhost} disabled={!canManage} title={canManage ? undefined : acl.denyMessage('conselho.manage')} onClick={() => run(() => dbService.saveClassCouncil({ classId, date, entries }), 'A guardar...', 'conselho.manage', 'Rascunho do conselho guardado.')}><BtnIcon n="save" /> Guardar rascunho</button>
              <button className={btnPrimary} disabled={!canHomologate || !saved} title={!canHomologate ? acl.denyMessage('conselho.homologar') : !saved ? 'Guarde o rascunho antes de homologar.' : undefined}
                onClick={() => saved && run(() => dbService.homologateClassCouncil(saved.id), 'A homologar...', 'conselho.homologar', 'Conselho homologado. Os processos de recuperação foram abertos.')}><BtnIcon n="verified" /> Homologar</button>
            </div>
          )}

          {changes.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl">
              <button type="button" className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-800" onClick={() => setShowChanges((v) => !v)} aria-expanded={showChanges}>
                <span>Notas atribuídas ou alteradas neste conselho ({changes.length})</span>
                <span className="material-symbols-outlined text-[18px]">{showChanges ? 'expand_less' : 'expand_more'}</span>
              </button>
              {showChanges && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-2">Data</th><th className="p-2">Aluno</th><th className="p-2">Disciplina</th><th className="p-2">Campo</th><th className="p-2">De</th><th className="p-2">Para</th><th className="p-2">Por</th><th className="p-2">Motivo</th></tr></thead>
                    <tbody>
                      {[...changes].reverse().map((c) => (
                        <tr key={c.id} className="border-t border-slate-100">
                          <td className="p-2 whitespace-nowrap">{new Date(c.at).toLocaleString('pt-PT')}</td>
                          <td className="p-2">{c.studentName}</td>
                          <td className="p-2">{c.subjectName}</td>
                          <td className="p-2">{c.label}</td>
                          <td className="p-2 font-mono">{c.from === '' ? '—' : c.from}</td>
                          <td className="p-2 font-mono font-bold">{c.to === '' ? '—' : c.to}</td>
                          <td className="p-2">{c.by}</td>
                          <td className="p-2 text-slate-500">{c.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {student && ctx && (
        <CouncilStudentGradesModal
          student={student}
          ctx={ctx}
          miniStore={miniStore}
          readOnly={locked || !canManage}
          readOnlyReason={readOnlyReason}
          onClose={() => setGradesFor(null)}
          onSave={saveStudentGrades}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Recuperação e exames de recurso
// ---------------------------------------------------------------------------
const STAGE_LABEL = { inscrito: 'Inscrito', recuperacao: 'Em recuperação', exame_recurso: 'Exame de recurso', concluido: 'Concluído' } as const;

function RecuperacaoTab({ db, role }: { db: SchoolDatabase; role: UserRole }) {
  const acl = useAccessControl(role);
  const { message, run } = useRunner(role);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const can = acl.can('recuperacao.manage');
  const year = db.settings?.currentAcademicYear || '';
  const [stageFilter, setStageFilter] = useState<'todos' | keyof typeof STAGE_LABEL>('todos');
  const records = useMemo(() => (db.recoveryRecords || []).filter((r) => r.academicYear === year && (stageFilter === 'todos' || r.stage === stageFilter)), [db.recoveryRecords, year, stageFilter]);
  const { page: pgRecords, setPage: setPgRecords, pageItems: visibleRecords } = usePagedList(records, [records.length]);

  const saveGrade = (id: string, field: 'recoveryGrade' | 'appealExamGrade') => {
    const raw = drafts[`${id}:${field}`];
    if (raw === undefined || raw.trim() === '') return;
    const n = Number(raw.replace(',', '.'));
    run(() => dbService.setRecoveryGrades(id, { [field]: n }), 'A lançar nota...', 'recuperacao.manage', 'Nota lançada.');
    setDrafts((d) => ({ ...d, [`${id}:${field}`]: '' }));
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Os processos abrem sozinhos quando o conselho de turma homologa uma transição condicional. Nota mínima de aprovação: {DEFAULT_RECOVERY_RULES.passingGrade}. A recuperação vem antes do exame de recurso, que só abre se a recuperação continuar negativa.</p>
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-bold text-slate-600">Fase</label>
        <select className={`${inputCls} max-w-[220px]`} value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)}>
          <option value="todos">Todas</option>
          {(Object.keys(STAGE_LABEL) as Array<keyof typeof STAGE_LABEL>).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      <Banner message={message} />
      {records.length === 0 ? <Empty text="Sem processos de recuperação neste ano letivo." /> : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left"><tr><th className="p-3">Aluno</th><th className="p-3">Disciplina</th><th className="p-3">Nota original</th><th className="p-3">Fase</th><th className="p-3">Recuperação</th><th className="p-3">Exame de recurso</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>
              {visibleRecords.map((r) => {
                const done = r.stage === 'concluido';
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{r.studentName}<div className="text-[10px] text-slate-400 font-normal">{r.className}</div></td>
                    <td className="p-3">{r.subjectName}</td>
                    <td className="p-3">{r.originalGrade}</td>
                    <td className="p-3">{STAGE_LABEL[r.stage]}</td>
                    <td className="p-3">{typeof r.recoveryGrade === 'number' ? r.recoveryGrade : (
                      <span className="flex gap-1"><input className={`${inputCls} w-16`} disabled={!can || done} value={drafts[`${r.id}:recoveryGrade`] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [`${r.id}:recoveryGrade`]: e.target.value }))} /><IconButton icon="check" tone="success" label="Guardar nota de recuperação" disabled={!can || done} onClick={() => saveGrade(r.id, 'recoveryGrade')} /></span>)}</td>
                    <td className="p-3">{typeof r.appealExamGrade === 'number' ? r.appealExamGrade : r.stage === 'exame_recurso' ? (
                      <span className="flex gap-1"><input className={`${inputCls} w-16`} disabled={!can} value={drafts[`${r.id}:appealExamGrade`] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [`${r.id}:appealExamGrade`]: e.target.value }))} /><IconButton icon="check" tone="success" label="Guardar nota do exame de recurso" disabled={!can} onClick={() => saveGrade(r.id, 'appealExamGrade')} /></span>) : '—'}</td>
                    <td className={`p-3 font-bold ${r.outcome === 'aprovado' ? 'text-emerald-700' : r.outcome === 'reprovado' ? 'text-red-700' : 'text-slate-500'}`}>{r.outcome === 'pendente' ? 'Pendente' : r.outcome === 'aprovado' ? 'Aprovado' : 'Reprovado'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={records.length} page={pgRecords} onPageChange={setPgRecords} />
        </div>
      )}
    </div>
  );
}

const TITLES: Record<ProcessosSection, { title: string; subtitle: string }> = {
  documentos_academicos: { title: 'DOCUMENTOS EMITIDOS', subtitle: 'Certificados, declarações, diplomas, cartões e históricos, com numeração de processo e anulação rastreada.' },
  transferencias: { title: 'PROCESSOS DE TRANSFERÊNCIAS', subtitle: 'Saídas e entradas, equivalências por disciplina e disciplinas em atraso.' },
  conselho_turma: { title: 'CONSELHO DE TURMA', subtitle: 'Proposta automática de transição por turma' },
  recuperacao_recurso: { title: 'RECUPERAÇÃO E EXAME DE RECURSO', subtitle: 'Fluxo do secundário para alunos em transição condicional.' }
};

export const ProcessosAcademicosView: React.FC<Props> = ({ db, currentUserRole, section }) => {
  const head = TITLES[section];
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#0b1f3a]">{head.title}</h1>
        <p className="text-xs text-slate-500">{head.subtitle}</p>
      </div>
      {section === 'documentos_academicos' && <DocumentosTab db={db} role={currentUserRole} />}
      {section === 'transferencias' && <TransferenciasPanel db={db} role={currentUserRole} />}
      {section === 'conselho_turma' && <ConselhoTab db={db} role={currentUserRole} />}
      {section === 'recuperacao_recurso' && <RecuperacaoTab db={db} role={currentUserRole} />}
    </div>
  );
};
