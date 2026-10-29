import React, { useMemo, useState } from 'react';
import { SchoolDatabase, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { resolveOwnStudent } from '../utils/portalIdentity';
import { SUBMISSION_STATE_META, isPastDue, isSafeHttpUrl, submissionState } from '../utils/elearning';
import { Badge, Banner, Empty, PageHeader, btnPrimary, fmtDateTime, inputCls, labelCls, textareaCls, useOperation } from '../components/portalUi';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
}

export const MeusTrabalhosView: React.FC<Props> = ({ db, currentUser, currentUserRole }) => {
  const { message, run } = useOperation(currentUserRole);
  const student = useMemo(() => resolveOwnStudent(db.students || [], currentUser), [db.students, currentUser]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { text: string; link: string }>>({});

  if (!student) {
    return <Empty text="Não foi possível associar a sua conta a uma ficha de aluno. Peça à secretaria para confirmar o seu número de processo." />;
  }

  const now = Date.now();
  const mine = (db.assignments || [])
    .filter((a) => String(a.classId) === String(student.classId) && a.status !== 'rascunho')
    .sort((a, b) => (a.dueAt < b.dueAt ? 1 : -1));
  const subs = (db.assignmentSubmissions || []).filter((s) => String(s.studentId) === String(student.id));
  const materials = (db.teachingMaterials || []).filter((m) => String(m.classId) === String(student.classId) && m.visibleToStudents);

  const open = (id: string) => {
    setOpenId(openId === id ? null : id);
    const existing = subs.find((s) => s.assignmentId === id);
    setDrafts((d) => (d[id] ? d : { ...d, [id]: { text: existing?.text || '', link: existing?.link || '' } }));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Portal do aluno"
        title="Meus Trabalhos"
        description={`Trabalhos da turma ${student.className || student.grade}. Pode entregar texto ou uma ligação para o ficheiro (Drive, OneDrive…). Enquanto o professor não corrigir e o prazo o permitir, pode voltar a entregar.`}
      />
      <Banner message={message} />
      {mine.length === 0 ? <Empty text="Ainda não há trabalhos publicados para a sua turma." /> : (
        <div className="space-y-3">
          {mine.map((a) => {
            const sub = subs.find((s) => s.assignmentId === a.id);
            const state = submissionState(a, sub, now);
            const meta = SUBMISSION_STATE_META[state];
            const closed = a.status === 'fechado' || (isPastDue(a, now) && !a.allowLate);
            const d = drafts[a.id] || { text: '', link: '' };
            return (
              <div key={a.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{a.title}</p>
                    <p className="text-[11px] text-slate-500">{a.subjectName} · Prof. {a.teacherName} · Prazo {fmtDateTime(a.dueAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.badge}>{meta.label}</Badge>
                    {sub?.grade !== undefined && <Badge tone="bg-emerald-100 text-emerald-800">{sub.grade} / {a.maxGrade}</Badge>}
                    <button type="button" className="text-[11px] font-bold text-[#0b1f3a] underline cursor-pointer" onClick={() => open(a.id)}>{openId === a.id ? 'Fechar' : 'Abrir'}</button>
                  </div>
                </div>
                {openId === a.id && (
                  <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    {a.instructions && <p className="text-xs text-slate-700 whitespace-pre-line">{a.instructions}</p>}
                    {a.externalLink && isSafeHttpUrl(a.externalLink) && (
                      <a href={a.externalLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 underline break-all">Abrir sala/material do professor</a>
                    )}
                    {sub?.feedback && <p className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-900"><strong>Comentário do professor:</strong> {sub.feedback}</p>}
                    {sub?.grade !== undefined ? (
                      <p className="text-[11px] text-slate-500">Este trabalho já foi corrigido e não pode ser alterado.</p>
                    ) : closed ? (
                      <p className="text-[11px] font-semibold text-red-700">{a.status === 'fechado' ? 'O professor fechou as entregas.' : 'O prazo terminou e este trabalho não aceita entregas atrasadas.'}</p>
                    ) : (
                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                          <label className={labelCls}>Resposta</label>
                          <textarea className={textareaCls} rows={4} value={d.text} onChange={(e) => setDrafts((x) => ({ ...x, [a.id]: { ...d, text: e.target.value } }))} />
                        </div>
                        <div className="md:col-span-2">
                          <label className={labelCls}>Ligação para o ficheiro (opcional)</label>
                          <input className={inputCls} value={d.link} onChange={(e) => setDrafts((x) => ({ ...x, [a.id]: { ...d, link: e.target.value } }))} placeholder="https://..." />
                        </div>
                        <div className="md:col-span-2 flex items-center justify-between">
                          <p className="text-[11px] text-slate-500">{isPastDue(a, now) ? 'Atenção: o prazo terminou; a entrega ficará marcada como atrasada.' : sub ? `Última entrega: ${fmtDateTime(sub.submittedAt.slice(0, 16))} (UTC).` : 'Ainda não entregou.'}</p>
                          <button type="button" className={btnPrimary} disabled={!d.text.trim() && !d.link.trim()}
                            onClick={() => run(() => dbService.submitAssignment(a.id, String(student.id), { text: d.text, link: d.link }), 'A enviar entrega...', undefined, 'Entrega registada.')}>
                            {sub ? 'Reenviar' : 'Entregar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {materials.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="font-bold text-slate-900 text-sm mb-2">Materiais de apoio da turma</p>
          <ul className="divide-y divide-slate-100">
            {materials.map((m) => (
              <li key={m.id} className="py-2 text-xs">
                <p className="font-semibold text-slate-800">{m.title} <span className="font-normal text-slate-500">· {m.subjectName} · Prof. {m.teacherName}</span></p>
                {m.description && <p className="text-slate-600">{m.description}</p>}
                {isSafeHttpUrl(m.link)
                  ? <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">{m.link}</a>
                  : <span className="text-red-700">Ligação inválida</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
