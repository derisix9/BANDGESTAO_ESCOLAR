import React, { useMemo, useState } from 'react';
import type { ExamEnrollment, NationalExam, NationalExamStatus, SchoolDatabase, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { AppConfirmModal } from '../components/AppConfirmModal';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Badge, Banner, ErrorLine, Kpis, ModalShell, PageHeader, THEAD, TH, TD, areaCls, btnGhost, btnPrimary, fmtDate, inputCls, labelCls, todayIso } from '../components/moduleUi';
import { EXAM_MAX_SCORE, EXAM_PASS_MARK, SUGGESTED_EXAM_GRADES, eligibleStudents, gradeKey, resultOf, summarizeExam } from '../utils/nationalExams';

const RULE = 'exames.manage';
const STATUS_LABEL: Record<NationalExamStatus, string> = { agendado: 'Agendado', realizado: 'Realizado', cancelado: 'Cancelado' };
const STATUS_TONE: Record<NationalExamStatus, string> = { agendado: 'bg-sky-50 text-sky-700', realizado: 'bg-emerald-50 text-emerald-700', cancelado: 'bg-slate-100 text-slate-500' };

interface Props { db: SchoolDatabase; currentUserRole: UserRole }

export const ExamesNacionaisView: React.FC<Props> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const exams = db.nationalExams || [];
  const enrollments = db.examEnrollments || [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string; grade: string; subject: string; date: string; startTime: string; room: string; notes: string; status: NationalExamStatus } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NationalExam | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});

  const sorted = useMemo(() => [...exams].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '')), [exams]);
  const { page, setPage, pageItems } = usePagedList(sorted, [sorted.length]);
  const selected = exams.find((e) => e.id === selectedId) || null;
  const selEnroll = useMemo(
    () => enrollments.filter((e) => e.examId === selectedId && e.status !== 'anulado').sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt')),
    [enrollments, selectedId]
  );
  const eligible = useMemo(() => (selected ? eligibleStudents(selected, db.students || [], db.classes || [], enrollments) : []), [selected, db.students, db.classes, enrollments]);
  const summaries = useMemo(() => {
    const m = new Map<string, ReturnType<typeof summarizeExam>>();
    for (const e of exams) m.set(e.id, summarizeExam(enrollments.filter((x) => x.examId === e.id)));
    return m;
  }, [exams, enrollments]);

  const grades = useMemo(() => {
    const set = new Map<string, string>();
    for (const g of [...SUGGESTED_EXAM_GRADES, ...(db.classes || []).map((c) => c.grade)]) if (g && !set.has(gradeKey(g))) set.set(gradeKey(g), g);
    return [...set.values()].sort((a, b) => Number(gradeKey(a)) - Number(gradeKey(b)));
  }, [db.classes]);
  const subjectNames = useMemo(() => [...new Set(((db as any).subjects || []).map((s: any) => s.name).filter(Boolean))] as string[], [db]);

  const upcoming = exams.filter((e) => e.status === 'agendado' && e.date >= todayIso()).length;
  const totalEnrolled = enrollments.filter((e) => e.status !== 'anulado').length;
  const all = summarizeExam(enrollments);

  const run = async (fn: () => { success: boolean; error?: string } & Record<string, any>, loading: string, okText?: (r: any) => string) => {
    setMsg(null);
    try {
      let result: any;
      await runGlobalOperation(
        () => { result = fn(); if (!result.success) throw new Error(result.error || 'Operação falhou.'); },
        { loadingMessage: loading, requiredRule: RULE, userRole: currentUserRole, resolveSuccessText: okText ? () => okText(result) : undefined }
      );
      // O sucesso é confirmado só pelo diálogo global (carregamento → visto animado): sem faixa verde.
    } catch (e: any) { setMsg({ tone: 'error', text: e?.message || 'Não foi possível concluir.' }); }
  };

  const saveForm = async () => {
    if (!form) return;
    setFormError(null);
    try {
      await runGlobalOperation(() => {
        const r = dbService.saveNationalExam({ ...form, startTime: form.startTime || undefined });
        if (!r.success) throw new Error(r.error);
      }, { loadingMessage: 'A guardar exame...', requiredRule: RULE, userRole: currentUserRole });
      setForm(null);
    } catch (e: any) { setFormError(e?.message || 'Não foi possível guardar.'); }
  };

  const openNew = () => { setFormError(null); setForm({ name: '', grade: grades[0] || '', subject: '', date: todayIso(), startTime: '', room: '', notes: '', status: 'agendado' }); };
  const openEdit = (e: NationalExam) => { setFormError(null); setForm({ id: e.id, name: e.name, grade: e.grade, subject: e.subject, date: e.date, startTime: e.startTime || '', room: e.room || '', notes: e.notes || '', status: e.status }); };

  const saveScore = (en: ExamEnrollment) => {
    const raw = scores[en.id];
    if (raw === undefined || raw === '') return;
    void run(() => dbService.setExamResult(en.id, { score: raw }), 'A lançar nota...');
    setScores((s) => { const n = { ...s }; delete n[en.id]; return n; });
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <PageHeader
        kicker="PEDAGÓGICO" title="Exames Nacionais"
        subtitle="Calendário dos exames, inscrição dos alunos por classe e lançamento dos resultados (escala 0–20)."
        right={canManage ? <button className={btnPrimary} onClick={openNew}><span className="material-symbols-outlined text-[18px]">add</span>Novo exame</button> : undefined}
      />
      {msg && <Banner tone={msg.tone === 'error' ? 'error' : 'info'} icon={msg.tone === 'error' ? 'error' : 'check_circle'}>{msg.text}</Banner>}
      <Kpis items={[
        { label: 'Exames agendados', value: upcoming, icon: 'event' },
        { label: 'Alunos inscritos', value: totalEnrolled, icon: 'how_to_reg' },
        { label: 'Resultados lançados', value: all.classificados, icon: 'grading' },
        { label: 'Taxa de aprovação', value: all.taxaAprovacao !== null ? `${all.taxaAprovacao}%` : '—', icon: 'insights' }
      ]} />

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100"><h3 className="font-headline text-sm font-bold text-[#0b1f3a]">Calendário</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className={THEAD}>
              <th className={TH}>Data</th><th className={TH}>Hora</th><th className={TH}>Classe</th><th className={TH}>Disciplina</th><th className={TH}>Sala</th>
              <th className={TH}>Estado</th><th className={`${TH} text-center`}>Inscritos</th><th className={`${TH} text-center`}>Aprovação</th><th className={`${TH} text-right`}>Acções</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-400">Ainda não há exames no calendário.</td></tr>}
              {pageItems.map((e) => {
                const s = summaries.get(e.id)!;
                return (
                  <tr key={e.id} className={`hover:bg-slate-50 ${selectedId === e.id ? 'bg-slate-50' : ''}`}>
                    <td className={`${TD} font-semibold`}>{fmtDate(e.date)}</td>
                    <td className={TD}>{e.startTime || '—'}</td>
                    <td className={TD}>{e.grade}</td>
                    <td className={`${TD} font-semibold text-slate-900`}>{e.subject}</td>
                    <td className={TD}>{e.room || '—'}</td>
                    <td className={TD}><Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge></td>
                    <td className={`${TD} text-center font-mono`}>{s.inscritos}</td>
                    <td className={`${TD} text-center font-mono`}>{s.taxaAprovacao !== null ? `${s.taxaAprovacao}%` : '—'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => setSelectedId(selectedId === e.id ? null : e.id)} title={selectedId === e.id ? 'Fechar inscritos' : 'Ver inscritos'} aria-label={selectedId === e.id ? 'Fechar inscritos' : 'Ver inscritos'}><span className="material-symbols-outlined text-[18px]">{selectedId === e.id ? 'visibility_off' : 'visibility'}</span></button>
                      {canManage && <><button type="button" onClick={() => openEdit(e)} title="Editar exame" aria-label="Editar exame"><span className="material-symbols-outlined text-[18px]">edit</span></button><button type="button" onClick={() => setDeleting(e)} title="Eliminar exame" aria-label="Eliminar exame"><span className="material-symbols-outlined text-[18px]">delete</span></button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination total={sorted.length} page={page} onPageChange={setPage} />
        </div>
      </div>

      {selected && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="font-headline text-sm font-bold text-[#0b1f3a]">{selected.subject} — {selected.grade} · {fmtDate(selected.date)}</h3>
              <p className="text-[11px] text-slate-500">Aprova com {EXAM_PASS_MARK} ou mais valores (escala 0–{EXAM_MAX_SCORE}). {eligible.length} aluno(s) elegível(is) por inscrever.</p>
            </div>
            {canManage && selected.status !== 'cancelado' && (
              <button className={btnPrimary} disabled={eligible.length === 0}
                onClick={() => void run(() => dbService.enrollStudentsInExam(selected.id), 'A inscrever alunos...', (r) => `${r.enrolled} aluno(s) inscrito(s).`)}>
                <span className="material-symbols-outlined text-[18px]">group_add</span>Inscrever turma ({eligible.length})
              </button>
            )}
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0"><tr className={THEAD}><th className={TH}>Aluno</th><th className={TH}>Turma</th><th className={`${TH} text-center`}>Nota (0–{EXAM_MAX_SCORE})</th><th className={TH}>Resultado</th><th className={`${TH} text-right`}>Acções</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {selEnroll.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nenhum aluno inscrito neste exame.</td></tr>}
                {selEnroll.map((en) => {
                  const r = resultOf(en);
                  return (
                    <tr key={en.id} className="hover:bg-slate-50">
                      <td className={`${TD} font-semibold text-slate-900`}>{en.studentName}</td>
                      <td className={TD}>{en.className || '—'}</td>
                      <td className={`${TD} text-center`}>
                        {canManage ? (
                          <input type="number" min={0} max={EXAM_MAX_SCORE} step="0.1" disabled={en.status === 'faltou'}
                            value={scores[en.id] ?? (typeof en.score === 'number' ? String(en.score) : '')}
                            onChange={(e) => setScores((s) => ({ ...s, [en.id]: e.target.value }))}
                            onBlur={() => saveScore(en)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-20 h-8 px-2 border border-slate-300 text-center font-mono text-xs disabled:bg-slate-100" />
                        ) : (en.score ?? '—')}
                      </td>
                      <td className={TD}>
                        <Badge tone={r === 'aprovado' ? 'bg-emerald-50 text-emerald-700' : r === 'reprovado' ? 'bg-red-50 text-red-700' : r === 'faltou' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}>
                          {r === 'aprovado' ? 'Aprovado' : r === 'reprovado' ? 'Reprovado' : r === 'faltou' ? 'Faltou' : 'Por lançar'}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {canManage && <>
                          <button type="button" onClick={() => void run(() => dbService.setExamResult(en.id, { absent: true }), 'A registar falta...')} title="Registar falta" aria-label="Registar falta"><span className="material-symbols-outlined text-[18px]">person_alert</span></button>
                          <button type="button" onClick={() => void run(() => dbService.cancelExamEnrollment(en.id), 'A anular inscrição...')} title="Anular inscrição" aria-label="Anular inscrição"><span className="material-symbols-outlined text-[18px]">cancel</span></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {form && (
        <ModalShell>
          <FormModalHeader title={form.id ? 'Editar Exame' : 'Novo Exame'} subtitle="Calendário dos exames nacionais" icon="event_note" onClose={() => setForm(null)} />
          <div className="p-6 space-y-3 overflow-y-auto">
            <ErrorLine message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Classe</label>
                <select className={inputCls} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
                  {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                </select></div>
              <div><label className={labelCls}>Disciplina</label>
                <input className={inputCls} list="exam-subjects" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                <datalist id="exam-subjects">{subjectNames.map((n) => <option key={n} value={n} />)}</datalist></div>
              <div><label className={labelCls}>Data</label><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><label className={labelCls}>Hora</label><input type="time" className={inputCls} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
              <div><label className={labelCls}>Sala / local</label><input className={inputCls} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></div>
              <div><label className={labelCls}>Estado</label>
                <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as NationalExamStatus })}>
                  {(Object.keys(STATUS_LABEL) as NationalExamStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select></div>
            </div>
            <div><label className={labelCls}>Designação (opcional)</label><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Exame Nacional — 1.ª época" /></div>
            <div><label className={labelCls}>Notas</label><textarea className={areaCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <p className="text-[11px] text-slate-500">As classes sugeridas são as de fim de ciclo; confirme no calendário oficial do MED deste ano.</p>
            <div className="flex justify-end gap-2 pt-2"><button className={btnGhost} onClick={() => setForm(null)}>Cancelar</button><button className={btnPrimary} onClick={() => void saveForm()}>Guardar</button></div>
          </div>
        </ModalShell>
      )}

      <AppConfirmModal isOpen={!!deleting} title="Eliminar exame" variant="error" confirmLabel="Eliminar"
        message={`Eliminar "${deleting?.subject} — ${deleting?.grade}" e as suas inscrições? Não pode ser revertido.`}
        onConfirm={() => { const id = deleting!.id; setDeleting(null); if (selectedId === id) setSelectedId(null); void run(() => dbService.deleteNationalExam(id), 'A eliminar exame...'); }}
        onCancel={() => setDeleting(null)} />
    </div>
  );
};
