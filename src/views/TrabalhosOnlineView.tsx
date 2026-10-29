import React, { useMemo, useState } from 'react';
import { SchoolDatabase, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { getSubjectsForClass } from '../utils/classSubjects';
import { getAllocatedClassIdsForUser } from '../utils/teacherSubjects';
import {
  Assignment, SUBMISSION_STATE_META, assignmentProgress, isSafeHttpUrl, submissionState
} from '../utils/elearning';
import { FormModal } from '../components/FormModal';
import { IconButton } from '../components/IconButton';
import {
  Badge, Banner, Empty, Kpis, PageHeader, fmtDateTime, inputCls, labelCls, textareaCls, useOperation
} from '../components/portalUi';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
}

const RULE = 'ead.manage';

const STATUS_META: Record<Assignment['status'], { label: string; tone: string }> = {
  rascunho: { label: 'Rascunho', tone: 'bg-slate-200 text-slate-700' },
  publicado: { label: 'Publicado', tone: 'bg-emerald-100 text-emerald-800' },
  fechado: { label: 'Fechado', tone: 'bg-amber-100 text-amber-800' }
};

const emptyForm = {
  id: '', classId: '', subjectName: '', title: '', instructions: '', dueAt: '', maxGrade: '20',
  allowLate: false, externalLink: '', status: 'rascunho' as Assignment['status']
};

export const TrabalhosOnlineView: React.FC<Props> = ({ db, currentUser, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const { message, setMessage, run } = useOperation(currentUserRole);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // O professor só trabalha com as turmas a que está atribuído; a direção vê todas.
  const allowedClassIds = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const classes = useMemo(
    () => (db.classes || []).filter((c) => !allowedClassIds || allowedClassIds.has(String(c.id))),
    [db.classes, allowedClassIds]
  );
  const assignments = useMemo(
    () => (db.assignments || []).filter((a) => !allowedClassIds || allowedClassIds.has(String(a.classId))),
    [db.assignments, allowedClassIds]
  );
  const { page: pgAssignments, setPage: setPgAssignments, pageItems: visibleAssignments } = usePagedList(assignments, [assignments.length]);
  const submissions = db.assignmentSubmissions || [];
  const now = Date.now();

  const classForForm = classes.find((c) => String(c.id) === form.classId);
  const subjectOptions = classForForm ? getSubjectsForClass(db, classForForm) : [];

  const edit = (a: Assignment) => {
    setForm({
      id: a.id, classId: String(a.classId), subjectName: a.subjectName, title: a.title, instructions: a.instructions,
      dueAt: a.dueAt, maxGrade: String(a.maxGrade), allowLate: a.allowLate, externalLink: a.externalLink || '', status: a.status
    });
    setMessage(null);
    setFormOpen(true);
  };

  const save = async () => {
    const ok = await run(
      () => dbService.saveAssignment({
        id: form.id || undefined,
        classId: form.classId,
        subjectName: form.subjectName,
        teacherId: String(currentUser.id),
        title: form.title,
        instructions: form.instructions,
        dueAt: form.dueAt,
        maxGrade: Number(form.maxGrade),
        allowLate: form.allowLate,
        externalLink: form.externalLink.trim() || undefined,
        status: form.status
      }),
      'A guardar trabalho...', RULE, form.status === 'publicado' ? 'Trabalho guardado e aberto aos alunos da turma.' : 'Trabalho guardado.'
    );
    if (ok) { setForm(emptyForm); setFormOpen(false); }
  };

  const published = assignments.filter((a) => a.status === 'publicado').length;
  const toGrade = submissions.filter((s) => s.grade === undefined && assignments.some((a) => a.id === s.assignmentId)).length;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="GESTÃO DE ENSINO A DISTÂNCIA"
        title="TRABALHOS ONLINE"
        description="Publique trabalhos com prazo; os alunos entregam por aqui e a correção é feita no mesmo lugar."
        actions={<IconButton variant="solid" icon="add" label="Novo trabalho" disabled={!canManage} onClick={() => { setMessage(null); setForm(emptyForm); setFormOpen(true); }} />}
      />
      <Kpis items={[
        { label: 'Trabalhos', value: assignments.length },
        { label: 'Abertos a entregas', value: published },
        { label: 'Entregas por corrigir', value: toGrade, tone: toGrade > 0 ? 'warn' : 'default' },
        { label: 'Turmas', value: classes.length }
      ]} />
      <Banner message={message} />

      {formOpen && (
        <FormModal title={form.id ? 'Editar Trabalho' : 'Novo Trabalho Online'} subtitle="Trabalhos Online" icon="assignment" onClose={() => { setFormOpen(false); setForm(emptyForm); }} onSubmit={save} submitLabel={form.id ? 'Guardar alterações' : 'Guardar trabalho'} submitDisabled={!canManage} widthClass="max-w-4xl">
          <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Turma *</label>
            <select className={inputCls} value={form.classId} onChange={(e) => { set('classId', e.target.value); set('subjectName', ''); }}>
              <option value="">Escolha...</option>
              {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Disciplina *</label>
            {subjectOptions.length > 0 ? (
              <select className={inputCls} value={form.subjectName} onChange={(e) => set('subjectName', e.target.value)}>
                <option value="">Escolha...</option>
                {subjectOptions.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input className={inputCls} value={form.subjectName} onChange={(e) => set('subjectName', e.target.value)} placeholder={form.classId ? 'Sem atribuição: escreva a disciplina' : 'Escolha primeiro a turma'} />
            )}
          </div>
          <div className="md:col-span-2"><label className={labelCls}>Título *</label><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="md:col-span-4"><label className={labelCls}>Instruções</label><textarea className={textareaCls} rows={3} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} /></div>
          <div><label className={labelCls}>Prazo *</label><input className={inputCls} type="datetime-local" value={form.dueAt} onChange={(e) => set('dueAt', e.target.value)} /></div>
          <div><label className={labelCls}>Nota máxima</label><input className={inputCls} type="number" min={1} value={form.maxGrade} onChange={(e) => set('maxGrade', e.target.value)} /></div>
          <div>
            <label className={labelCls}>Estado</label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as Assignment['status'])}>
              <option value="rascunho">Rascunho (os alunos não veem)</option>
              <option value="publicado">Publicado (aberto a entregas)</option>
              <option value="fechado">Fechado</option>
            </select>
          </div>
          <div className="flex items-end"><label className="text-xs text-slate-700 flex items-center gap-2 h-10"><input type="checkbox" checked={form.allowLate} onChange={(e) => set('allowLate', e.target.checked)} />Aceitar entregas atrasadas</label></div>
          <div className="md:col-span-4">
            <label className={labelCls}>Ligação externa (sala virtual, vídeo, pasta de materiais)</label>
            <input className={inputCls} value={form.externalLink} onChange={(e) => set('externalLink', e.target.value)} placeholder="https://..." />
          </div>
          </div>
          <Banner message={message && !message.ok ? message : null} />
        </FormModal>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {assignments.length === 0 ? <Empty text="Ainda não há trabalhos. Use «Novo trabalho»." /> : (
          <><table className="w-full text-xs">
            <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
              <tr><th className="text-left px-3 py-2">Trabalho</th><th className="text-left px-3 py-2">Turma · Disciplina</th><th className="text-left px-3 py-2">Prazo</th><th className="text-left px-3 py-2">Estado</th><th className="text-left px-3 py-2">Entregas</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleAssignments.map((a) => {
                const roster = getStudentsForClass(String(a.classId), db.students || []).map((s) => String(s.id));
                const p = assignmentProgress(a, roster, submissions, now);
                return (
                  <React.Fragment key={a.id}>
                    <tr className={openId === a.id ? 'bg-slate-50' : ''}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{a.title}</td>
                      <td className="px-3 py-2 text-slate-600">{a.className} · {a.subjectName}</td>
                      <td className="px-3 py-2">{fmtDateTime(a.dueAt)}</td>
                      <td className="px-3 py-2"><Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge></td>
                      <td className="px-3 py-2">{p.delivered}/{p.total}{p.late ? <span className="text-orange-700"> ({p.late} atras.)</span> : null}{p.missing ? <span className="text-red-700"> · {p.missing} em falta</span> : null}{p.average !== null ? <span className="text-slate-500"> · média {p.average}</span> : null}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton icon={openId === a.id ? 'expand_less' : 'inbox'} label={openId === a.id ? 'Fechar entregas' : 'Ver entregas'} onClick={() => setOpenId(openId === a.id ? null : a.id)} />
                          <IconButton icon="edit" tone="info" label="Editar" disabled={!canManage} onClick={() => edit(a)} />
                          {a.status === 'rascunho' && <IconButton icon="publish" tone="success" label="Publicar" disabled={!canManage} onClick={() => run(() => { dbService.setAssignmentStatus(a.id, 'publicado'); return { success: true }; }, 'A publicar...', RULE, 'Trabalho publicado.')} />}
                          {a.status === 'publicado' && <IconButton icon="lock" label="Fechar a novas entregas" disabled={!canManage} onClick={() => run(() => { dbService.setAssignmentStatus(a.id, 'fechado'); return { success: true }; }, 'A fechar...', RULE, 'Trabalho fechado a novas entregas.')} />}
                        </div>
                      </td>
                    </tr>
                    {openId === a.id && (
                      <tr><td colSpan={6} className="px-3 py-3 bg-slate-50"><SubmissionsPanel db={db} assignment={a} canManage={canManage} run={run} /></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table><TablePagination total={assignments.length} page={pgAssignments} onPageChange={setPgAssignments} /></>
        )}
      </div>
    </div>
  );
};

function SubmissionsPanel({ db, assignment, canManage, run }: {
  db: SchoolDatabase; assignment: Assignment; canManage: boolean;
  run: ReturnType<typeof useOperation>['run'];
}) {
  const roster = getStudentsForClass(String(assignment.classId), db.students || []);
  const { page: pgRoster, setPage: setPgRoster, pageItems: visibleRoster } = usePagedList(roster, [roster.length]);
  const subs = db.assignmentSubmissions || [];
  const [draft, setDraft] = useState<Record<string, { grade: string; feedback: string }>>({});
  const now = Date.now();

  if (roster.length === 0) return <Empty text="Esta turma ainda não tem alunos matriculados." />;

  return (
    <div className="overflow-x-auto">
      {assignment.instructions && <p className="text-xs text-slate-600 mb-2 whitespace-pre-line"><strong>Instruções:</strong> {assignment.instructions}</p>}
      <table className="w-full text-xs">
        <thead className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider text-left">
          <tr><th className="text-left py-1.5 pr-3">Aluno</th><th className="text-left py-1.5 pr-3">Estado</th><th className="text-left py-1.5 pr-3">Entrega</th><th className="text-left py-1.5 pr-3">Nota (0–{assignment.maxGrade})</th><th className="text-left py-1.5 pr-3">Comentário</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {visibleRoster.map((st) => {
            const sub = subs.find((s) => s.assignmentId === assignment.id && String(s.studentId) === String(st.id));
            const state = submissionState(assignment, sub, now);
            const meta = SUBMISSION_STATE_META[state];
            const d = draft[st.id] ?? { grade: sub?.grade !== undefined ? String(sub.grade) : '', feedback: sub?.feedback || '' };
            return (
              <tr key={st.id} className="align-top">
                <td className="py-2 pr-3 font-semibold text-slate-800">{st.name}</td>
                <td className="py-2 pr-3"><Badge tone={meta.badge}>{meta.label}</Badge></td>
                <td className="py-2 pr-3 max-w-xs">
                  {sub ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-400">{fmtDateTime(sub.submittedAt.slice(0, 16))} (UTC)</p>
                      {sub.text && <p className="whitespace-pre-line text-slate-700">{sub.text}</p>}
                      {sub.link && (isSafeHttpUrl(sub.link)
                        ? <a href={sub.link} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{sub.link}</a>
                        : <span className="text-red-700">Ligação inválida</span>)}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2 pr-3">
                  {sub ? <input className={`${inputCls} w-20`} type="number" min={0} max={assignment.maxGrade} step="0.5" value={d.grade} onChange={(e) => setDraft((x) => ({ ...x, [st.id]: { ...d, grade: e.target.value } }))} /> : null}
                </td>
                <td className="py-2 pr-3">
                  {sub ? <input className={inputCls} value={d.feedback} onChange={(e) => setDraft((x) => ({ ...x, [st.id]: { ...d, feedback: e.target.value } }))} /> : null}
                </td>
                <td className="py-2">
                  {sub && (
                    <IconButton icon={sub.grade !== undefined ? 'task_alt' : 'grading'} tone="success" label={sub.grade !== undefined ? 'Atualizar correção' : 'Corrigir'} disabled={!canManage || d.grade === ''}
                      onClick={() => run(() => dbService.gradeAssignmentSubmission(sub.id, Number(d.grade), d.feedback), 'A guardar correção...', RULE, 'Correção guardada.')} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TablePagination total={roster.length} page={pgRoster} onPageChange={setPgRoster} />
      <p className="text-[10px] text-slate-400 mt-2">A nota deste trabalho não entra automaticamente na pauta: lance-a em «Lançar Notas» se contar para a avaliação.</p>
    </div>
  );
}
