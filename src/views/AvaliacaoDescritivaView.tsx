import React, { useMemo, useState } from 'react';
import { SchoolDatabase, Student, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { getAllocatedClassIdsForUser } from '../utils/teacherSubjects';
import { getFallbackAcademicYear } from '../utils/academicYear';
import {
  CompetencyLevel, DescriptiveAssessment, LEVEL_META, buildDescriptiveReport, competencyKey, defaultAreasForGrade,
  isEarlyYearsGrade, publishBlockers, summarizeAssessment
} from '../utils/earlyYears';
import { Badge, Banner, Empty, PageHeader, btnGhost, btnPrimary, inputCls, labelCls, textareaCls, useOperation } from '../components/portalUi';
import { Notice } from '../components/Notice';
import { printWhenReady } from '../utils/printWindow';

interface Props {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
}

const RULE = 'descritiva.manage';
const LEVELS = Object.keys(LEVEL_META) as CompetencyLevel[];

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Abre o relatório numa janela própria, pronto para imprimir. */
export function printDescriptiveReport(schoolName: string, report: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(
    `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Relatório descritivo</title>` +
    `<style>body{font-family:Georgia,serif;margin:48px;color:#111}h1{font-size:18px;text-align:center}pre{white-space:pre-wrap;font:14px/1.7 Georgia,serif}</style></head>` +
    `<body><h1>${escapeHtml(schoolName)}</h1><pre>${escapeHtml(report)}</pre></body></html>`
  );
  w.document.close();
  printWhenReady(w);
}

export const AvaliacaoDescritivaView: React.FC<Props> = ({ db, currentUser, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can(RULE);
  const academicYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();
  const [classId, setClassId] = useState('');
  const [trimester, setTrimester] = useState<'1' | '2' | '3'>((db.settings?.currentTrimester as '1' | '2' | '3') || '1');
  const [studentId, setStudentId] = useState('');

  const allowed = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const classes = useMemo(
    () => (db.classes || []).filter((c) => isEarlyYearsGrade(c.grade || c.name) && (!allowed || allowed.has(String(c.id)))),
    [db.classes, allowed]
  );
  const roster = classId ? getStudentsForClass(classId, db.students || []).filter((s) => isEarlyYearsGrade(s.grade || '')) : [];
  const student = roster.find((s) => String(s.id) === studentId);
  const all = db.descriptiveAssessments || [];
  const forTrimester = (id: string) => all.find((d) => String(d.studentId) === String(id) && d.trimester === trimester && d.academicYear === academicYear);
  const publishedCount = roster.filter((s) => forTrimester(s.id)?.status === 'publicado').length;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="GESTÃO PRÉ-ESCOLAR E PRIMÁRIO"
        title="AVALIAÇÃO DESCRITIVA"
        description="Avalie cada competência por nível e publique quando terminar. O encarregado só vê depois da publicação."
      />
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label className={labelCls}>Turma (pré-escolar e 1.ª–6.ª classe)</label>
          <select className={inputCls} value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(''); }}>
            <option value="">Escolha...</option>
            {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Trimestre</label>
          <select className={inputCls} value={trimester} onChange={(e) => setTrimester(e.target.value as '1' | '2' | '3')}>
            <option value="1">1.º trimestre</option><option value="2">2.º trimestre</option><option value="3">3.º trimestre</option>
          </select>
        </div>
        <p className="text-[11px] text-slate-500">{classId ? `${publishedCount}/${roster.length} publicadas` : `Ano letivo ${academicYear}`}</p>
      </div>
      {classes.length === 0 && <Empty text="Não há turmas de pré-escolar ou do primário a que tenha acesso." />}
      {classId && roster.length === 0 && <Empty text="Esta turma ainda não tem alunos." />}
      {roster.length > 0 && (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
            {roster.map((s) => {
              const a = forTrimester(s.id);
              return (
                <button key={s.id} type="button" onClick={() => setStudentId(String(s.id))}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 ${String(s.id) === studentId ? 'bg-slate-100' : ''}`}>
                  <span className="text-xs font-semibold text-slate-800">{s.name}</span>
                  {a ? <Badge tone={a.status === 'publicado' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>{a.status === 'publicado' ? 'Publicada' : 'Rascunho'}</Badge> : <Badge tone="bg-slate-100 text-slate-500">Por fazer</Badge>}
                </button>
              );
            })}
          </div>
          <div>
            {student
              ? <AssessmentForm key={`${student.id}-${trimester}-${academicYear}`} db={db} student={student} trimester={trimester} existing={forTrimester(student.id)} canManage={canManage} role={currentUserRole} />
              : <Empty text="Escolha um aluno na lista." />}
          </div>
        </div>
      )}
    </div>
  );
};

function AssessmentForm({ db, student, trimester, existing, canManage, role }: {
  db: SchoolDatabase; student: Student; trimester: '1' | '2' | '3'; existing?: DescriptiveAssessment; canManage: boolean; role: UserRole;
}) {
  const { message, run } = useOperation(role);
  const areas = useMemo(() => defaultAreasForGrade(student.grade || ''), [student.grade]);
  const [levels, setLevels] = useState<Record<string, CompetencyLevel>>(existing?.levels || {});
  const [strengths, setStrengths] = useState(existing?.strengths || '');
  const [needs, setNeeds] = useState(existing?.needs || '');
  const [recommendations, setRecommendations] = useState(existing?.recommendations || '');
  const summary = summarizeAssessment(areas, levels);
  const blockers = publishBlockers(areas, { levels, strengths });
  const published = existing?.status === 'publicado';

  const save = (publish: boolean) =>
    run(
      () => dbService.saveDescriptiveAssessment({ studentId: String(student.id), trimester, levels, strengths, needs, recommendations, publish }),
      publish ? 'A publicar avaliação...' : 'A guardar rascunho...', RULE,
      publish ? 'Avaliação publicada: o encarregado já a pode consultar.' : 'Rascunho guardado.'
    );

  const preview = () => {
    const draft: DescriptiveAssessment = {
      id: existing?.id || 'previa', academicYear: existing?.academicYear || db.settings?.currentAcademicYear || '', trimester,
      studentId: String(student.id), studentName: student.name, classId: student.classId, className: student.className,
      levels, strengths, needs, recommendations, status: existing?.status || 'rascunho', teacherName: existing?.teacherName || '', updatedAt: ''
    };
    printDescriptiveReport(db.settings?.schoolName || 'Instituição de Ensino', buildDescriptiveReport(areas, draft));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-slate-900 text-sm">{student.name}</p>
          <p className="text-[11px] text-slate-500">{student.className} · {trimester}.º trimestre · {summary.evaluated}/{summary.total} competências avaliadas{summary.average !== null ? ` · nível médio ${summary.average}/4` : ''}</p>
        </div>
        {published && <Badge tone="bg-emerald-100 text-emerald-800">Publicada</Badge>}
      </div>
      <Banner message={message} />
      {areas.map((area) => (
        <div key={area.id} className="border border-slate-200 rounded-lg">
          <p className="px-3 py-2 bg-slate-50 text-xs font-bold text-slate-700 rounded-t-lg">{area.name}</p>
          <div className="divide-y divide-slate-100">
            {area.competencies.map((c) => {
              const key = competencyKey(area.id, c.id);
              return (
                <div key={c.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-700 flex-1 min-w-[200px]">{c.name}</span>
                  <div className="flex gap-1.5" role="radiogroup" aria-label={c.name}>
                    {LEVELS.map((lv) => (
                      <button key={lv} type="button" role="radio" aria-checked={(levels[key] || 'nao_observado') === lv} disabled={!canManage}
                        title={LEVEL_META[lv].label}
                        onClick={() => setLevels((x) => ({ ...x, [key]: lv }))}
                        data-gr-choice={lv}
                        className="min-w-[34px] h-8 px-2 text-[11px]">
                        {LEVEL_META[lv].short}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-slate-400">— não observado · I iniciado · D em desenvolvimento · C consolidado · S superado</p>
      <div className="grid md:grid-cols-3 gap-3">
        <div><label className={labelCls}>Pontos fortes *</label><textarea className={textareaCls} rows={4} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
        <div><label className={labelCls}>Dificuldades</label><textarea className={textareaCls} rows={4} value={needs} onChange={(e) => setNeeds(e.target.value)} /></div>
        <div><label className={labelCls}>Recomendações à família</label><textarea className={textareaCls} rows={4} value={recommendations} onChange={(e) => setRecommendations(e.target.value)} /></div>
      </div>
      {blockers.length > 0 && <Notice tone="warn">Para publicar: {blockers.join(' ')}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btnGhost} onClick={preview}>Imprimir relatório</button>
        {!published && <button type="button" className={btnGhost} disabled={!canManage} onClick={() => save(false)}>Guardar rascunho</button>}
        <button type="button" className={btnPrimary} disabled={!canManage || blockers.length > 0} onClick={() => save(true)}>{published ? 'Republicar alterações' : 'Publicar'}</button>
      </div>
    </div>
  );
}
