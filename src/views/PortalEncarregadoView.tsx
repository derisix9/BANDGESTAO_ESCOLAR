import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Student, User, UserRole } from '../types';
import { resolveGuardianChildren } from '../utils/guardianLinks';
import { MEETING_STATUS_META, MEETING_TYPE_LABELS, PARTICIPANT_STATUS_META } from '../utils/comunicacao';
import { LEVEL_META, buildDescriptiveReport, defaultAreasForGrade, competencyKey, summarizeAssessment } from '../utils/earlyYears';
import { Badge, Empty, Kpis, PageHeader, btnGhost, fmtDate } from '../components/portalUi';
import { printDescriptiveReport } from './AvaliacaoDescritivaView';
import { TablePagination, usePagedList } from '../components/TablePagination';

export type EncarregadoSection = 'encarregado_faltas' | 'encarregado_comunicados' | 'encarregado_reunioes' | 'encarregado_descritiva';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  section: EncarregadoSection;
}

const ABSENCE_META = {
  FJ: { label: 'Falta justificada', tone: 'bg-blue-100 text-blue-800' },
  FI: { label: 'Falta injustificada', tone: 'bg-red-100 text-red-800' },
  A: { label: 'Atraso', tone: 'bg-amber-100 text-amber-800' }
} as const;

const PRIORITY_TONE: Record<string, string> = {
  urgente: 'bg-red-100 text-red-800',
  alta: 'bg-amber-100 text-amber-800',
  normal: 'bg-blue-100 text-blue-800',
  informativa: 'bg-slate-100 text-slate-700'
};

export const PortalEncarregadoView: React.FC<Props> = ({ db, currentUser, section }) => {
  // Só os educandos a que esta conta tem acesso (vínculos ativos + ficha). Sem vínculo, sem dados.
  const children = useMemo(
    () => resolveGuardianChildren(currentUser, db.students || [], db.guardianLinks || []),
    [currentUser, db.students, db.guardianLinks]
  );
  const [childId, setChildId] = useState('');
  const child: Student | undefined = (children.find((c) => String(c.student.id) === childId) || children[0])?.student;

  const titles: Record<EncarregadoSection, { title: string; description: string }> = {
    encarregado_faltas: { title: 'Faltas do Educando', description: 'Faltas e atrasos registados pelos professores nas folhas de assiduidade.' },
    encarregado_comunicados: { title: 'Comunicados da Escola', description: 'Avisos que a escola dirigiu aos encarregados de educação.' },
    encarregado_reunioes: { title: 'Reuniões', description: 'Reuniões convocadas para o seu educando. O agendamento por iniciativa do encarregado ainda não existe: peça à secretaria.' },
    encarregado_descritiva: { title: 'Avaliação Descritiva', description: 'Relatório por competências do pré-escolar e do primário, depois de publicado pelo professor.' }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Portal do encarregado"
        title={titles[section].title}
        description={titles[section].description}
        actions={children.length > 1 ? (
          <select aria-label="Educando" className="h-10 px-3 border border-slate-300 rounded-lg text-xs bg-white" value={child ? String(child.id) : ''} onChange={(e) => setChildId(e.target.value)}>
            {children.map((c) => <option key={c.student.id} value={String(c.student.id)}>{c.student.name}</option>)}
          </select>
        ) : undefined}
      />
      {section === 'encarregado_comunicados' ? <Comunicados db={db} /> : !child ? (
        <Empty text="Não há nenhum educando associado à sua conta. Peça à secretaria para fazer o vínculo." />
      ) : (
        <>
          <p className="text-xs text-slate-600"><strong>{child.name}</strong> · {child.className || child.grade} · processo {child.procNumber}</p>
          {section === 'encarregado_faltas' && <Faltas db={db} student={child} />}
          {section === 'encarregado_reunioes' && <Reunioes db={db} student={child} />}
          {section === 'encarregado_descritiva' && <Descritiva db={db} student={child} />}
        </>
      )}
    </div>
  );
};

/** Portal do Aluno → Faltas: o próprio aluno vê as suas faltas e atrasos (folhas de assiduidade). */
export const AlunoFaltasView: React.FC<{ db: SchoolDatabase; currentUser: User }> = ({ db, currentUser }) => {
  const student = useMemo(() => {
    const students = db.students || [];
    const proc = (currentUser.processNumber || '').toLowerCase();
    const email = (currentUser.email || '').toLowerCase();
    return (
      (proc ? students.find((s) => (s.procNumber || '').toLowerCase() === proc) : undefined) ||
      (email ? students.find((s) => (s.email || '').toLowerCase() === email) : undefined) ||
      (currentUser.name ? students.find((s) => (s.name || '').toLowerCase().includes(currentUser.name.toLowerCase())) : undefined)
    );
  }, [db.students, currentUser]);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Portal do aluno" title="As minhas Faltas" description="Faltas e atrasos registados pelos professores nas folhas de assiduidade." />
      {!student ? <Empty text="Não foi possível associar a sua conta a uma ficha de aluno." /> : (
        <>
          <p className="text-xs text-slate-600"><strong>{student.name}</strong> · {student.className || student.grade} · processo {student.procNumber}</p>
          <Faltas db={db} student={student} />
        </>
      )}
    </div>
  );
};

function Faltas({ db, student }: { db: SchoolDatabase; student: Student }) {
  const rows = useMemo(() => {
    const out: Array<{ key: string; date: string; subject: string; status: 'FJ' | 'FI' | 'A'; note?: string }> = [];
    for (const sheet of db.attendanceSheets || []) {
      const item = (sheet.students || []).find((s) => String(s.studentId) === String(student.id));
      if (item && item.status !== 'P') out.push({ key: `${sheet.id}-${item.studentId}`, date: sheet.date, subject: sheet.subjectName, status: item.status, note: item.note });
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [db.attendanceSheets, student.id]);
  const { page: pgRows, setPage: setPgRows, pageItems: visibleRows } = usePagedList(rows, [rows.length]);
  const count = (s: 'FJ' | 'FI' | 'A') => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-3">
      <Kpis items={[
        { label: 'Faltas justificadas', value: count('FJ') },
        { label: 'Faltas injustificadas', value: count('FI'), tone: count('FI') > 0 ? 'warn' : 'default' },
        { label: 'Atrasos', value: count('A') },
        { label: 'Total de registos', value: rows.length }
      ]} />
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {rows.length === 0 ? <Empty text="Não há faltas nem atrasos registados para o ano letivo carregado." /> : (
          <><table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase"><tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Disciplina</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Nota</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2">{fmtDate(r.date)}</td><td className="px-3 py-2">{r.subject}</td>
                  <td className="px-3 py-2"><Badge tone={ABSENCE_META[r.status].tone}>{ABSENCE_META[r.status].label}</Badge></td>
                  <td className="px-3 py-2 text-slate-500">{r.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table><TablePagination total={rows.length} page={pgRows} onPageChange={setPgRows} /></>
        )}
      </div>
    </div>
  );
}

function Comunicados({ db }: { db: SchoolDatabase }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const notices = (db.notices || [])
    .filter((n) => !n.targetRoles || n.targetRoles.length === 0 || n.targetRoles.includes('encarregado'))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (notices.length === 0) return <Empty text="Não há comunicados para os encarregados." />;
  return (
    <div className="space-y-3">
      {notices.map((n) => (
        <div key={n.id} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-bold text-sm text-slate-900">{n.title}</p><p className="text-[11px] text-slate-500">{n.author} · {n.date}</p></div>
            <Badge tone={PRIORITY_TONE[n.priority] || PRIORITY_TONE.normal}>{n.priority}</Badge>
          </div>
          <p className="text-xs text-slate-700 mt-2 whitespace-pre-line">{openId === n.id ? n.content : n.excerpt}</p>
          {n.content && n.content !== n.excerpt && (
            <button type="button" className="mt-1 text-[11px] font-bold text-[#0b1f3a] underline cursor-pointer" onClick={() => setOpenId(openId === n.id ? null : n.id)}>{openId === n.id ? 'Ver menos' : 'Ler tudo'}</button>
          )}
        </div>
      ))}
    </div>
  );
}

function Reunioes({ db, student }: { db: SchoolDatabase; student: Student }) {
  const meetings = (db.parentTeacherMeetings || [])
    .filter((m) => m.participants.some((p) => String(p.studentId) === String(student.id)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (meetings.length === 0) return <Empty text="Não há reuniões convocadas para este educando." />;
  return (
    <div className="space-y-3">
      {meetings.map((m) => {
        const mine = m.participants.find((p) => String(p.studentId) === String(student.id));
        return (
          <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-bold text-sm text-slate-900">{m.title}</p>
                <p className="text-[11px] text-slate-500">{MEETING_TYPE_LABELS[m.type]} · Prof. {m.teacherName}{m.className ? ` · ${m.className}` : ''}</p></div>
              <div className="flex gap-1.5">
                <Badge tone={MEETING_STATUS_META[m.status].badge}>{MEETING_STATUS_META[m.status].label}</Badge>
                {mine && <Badge tone={PARTICIPANT_STATUS_META[mine.status].badge}>{PARTICIPANT_STATUS_META[mine.status].label}</Badge>}
              </div>
            </div>
            <p className="text-xs text-slate-700">{fmtDate(m.date)} · {m.startTime}–{m.endTime}{m.location ? ` · ${m.location}` : ''}</p>
            {m.agenda && <p className="text-xs text-slate-600 whitespace-pre-line"><strong>Agenda:</strong> {m.agenda}</p>}
            {m.status === 'cancelada' && m.cancelReason && <p className="text-xs text-red-700">Cancelada: {m.cancelReason}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Descritiva({ db, student }: { db: SchoolDatabase; student: Student }) {
  const areas = useMemo(() => defaultAreasForGrade(student.grade || ''), [student.grade]);
  const items = (db.descriptiveAssessments || [])
    .filter((d) => String(d.studentId) === String(student.id) && d.status === 'publicado')
    .sort((a, b) => (a.academicYear + a.trimester < b.academicYear + b.trimester ? 1 : -1));
  if (items.length === 0) return <Empty text="Ainda não há avaliações descritivas publicadas para este educando." />;
  return (
    <div className="space-y-4">
      {items.map((d) => {
        const sum = summarizeAssessment(areas, d.levels);
        return (
          <div key={d.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-sm text-slate-900">{d.trimester}.º trimestre · {d.academicYear}</p>
              <button type="button" className={btnGhost} onClick={() => printDescriptiveReport(db.settings?.schoolName || 'Instituição de Ensino', buildDescriptiveReport(areas, d))}>Imprimir relatório</button>
            </div>
            <p className="text-[11px] text-slate-500">{sum.evaluated}/{sum.total} competências avaliadas · Prof. {d.teacherName}</p>
            {areas.map((area) => (
              <div key={area.id}>
                <p className="text-xs font-bold text-slate-700 mb-1">{area.name}</p>
                <ul className="space-y-1">
                  {area.competencies.map((c) => {
                    const lv = d.levels[competencyKey(area.id, c.id)] || 'nao_observado';
                    return <li key={c.id} className="flex items-center justify-between gap-2 text-xs text-slate-700"><span>{c.name}</span><Badge tone={LEVEL_META[lv].badge}>{LEVEL_META[lv].label}</Badge></li>;
                  })}
                </ul>
              </div>
            ))}
            {d.strengths && <p className="text-xs"><strong>Pontos fortes:</strong> {d.strengths}</p>}
            {d.needs && <p className="text-xs"><strong>Dificuldades:</strong> {d.needs}</p>}
            {d.recommendations && <p className="text-xs"><strong>Recomendações:</strong> {d.recommendations}</p>}
          </div>
        );
      })}
    </div>
  );
}
