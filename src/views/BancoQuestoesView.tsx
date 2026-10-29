import React, { useMemo, useState } from 'react';
import {
  ExamPaper,
  ExamPaperItem,
  ExamPaperType,
  ExamQuestion,
  QuestionDifficulty,
  QuestionOption,
  QuestionStatus,
  QuestionType,
  SchoolDatabase,
  User,
  UserRole
} from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation, showAppConfirm } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { getAvailableGrades, normalizeGradeKey } from '../utils/educationSubsystems';
import { getAvailableSubjectsForUser, getAllocatedClassIdsForUser, filterSubjectsForUser } from '../utils/teacherSubjects';
import { getAssignedSubjectsForGrade, getSubjectsForClass } from '../utils/classSubjects';
import {
  DEFAULT_TARGET_POINTS,
  DIFFICULTY_META,
  EXAM_PAPER_TYPE_LABELS,
  EXAM_STATUS_META,
  QUESTION_STATUS_META,
  QUESTION_TYPE_META,
  autoSelectQuestions,
  canViewPaper,
  canViewQuestion,
  countQuestionUsage,
  distributePoints,
  emptyOptions,
  formatPoints,
  normalizeQuestionFields,
  normalizeText,
  optionLetter,
  paperStats,
  paperTypeNeedsApproval,
  pointsMatchTarget,
  resolveItemQuestion,
  sumPoints,
  validatePaperForPublish,
  validateQuestion
} from '../utils/questionBank';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface BancoQuestoesViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const areaCls =
  'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

type QForm = {
  subjectName: string;
  grade: string;
  topic: string;
  trimester: '' | '1' | '2' | '3';
  type: QuestionType;
  difficulty: QuestionDifficulty;
  statement: string;
  options: QuestionOption[];
  correctBoolean: boolean | null;
  expectedAnswer: string;
  defaultPoints: string;
  approveNow: boolean;
};

const emptyQForm = (subjectName = '', grade = ''): QForm => ({
  subjectName,
  grade,
  topic: '',
  trimester: '',
  type: 'escolha_multipla',
  difficulty: 'media',
  statement: '',
  options: emptyOptions(4),
  correctBoolean: null,
  expectedAnswer: '',
  defaultPoints: '1',
  approveNow: false
});

const qFormFromQuestion = (q: ExamQuestion): QForm => ({
  subjectName: q.subjectName,
  grade: q.grade,
  topic: q.topic || '',
  trimester: q.trimester || '',
  type: q.type,
  difficulty: q.difficulty,
  statement: q.statement,
  options: q.type === 'escolha_multipla' && q.options?.length ? q.options.map((o) => ({ ...o })) : emptyOptions(4),
  correctBoolean: typeof q.correctBoolean === 'boolean' ? q.correctBoolean : null,
  expectedAnswer: q.expectedAnswer || '',
  defaultPoints: String(q.defaultPoints),
  approveNow: false
});

function qPayload(f: QForm) {
  return {
    subjectName: f.subjectName,
    grade: f.grade,
    topic: f.topic.trim() || undefined,
    trimester: f.trimester || undefined,
    type: f.type,
    difficulty: f.difficulty,
    statement: f.statement,
    options: f.options,
    correctBoolean: f.correctBoolean === null ? undefined : f.correctBoolean,
    expectedAnswer: f.expectedAnswer,
    defaultPoints: Number(String(f.defaultPoints).replace(',', '.'))
  };
}

type PForm = {
  id?: string;
  title: string;
  type: ExamPaperType;
  subjectName: string;
  grade: string;
  trimester: '1' | '2' | '3';
  examDate: string;
  durationMinutes: string;
  targetPoints: string;
  instructions: string;
  items: ExamPaperItem[];
};

const emptyPForm = (subjectName = '', grade = ''): PForm => ({
  title: '',
  type: 'teste',
  subjectName,
  grade,
  trimester: '1',
  examDate: '',
  durationMinutes: '60',
  targetPoints: String(DEFAULT_TARGET_POINTS),
  instructions: 'Leia atentamente as seguintes questões e responde com clareza:',
  items: []
});

const fmtDate = (iso?: string) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// ---------------------------------------------------------------------------
// Documento imprimível: prova (para o aluno) e guia de correção (para o docente)
// ---------------------------------------------------------------------------
const PaperDocument: React.FC<{
  paper: ExamPaper;
  questionsById: Map<string, ExamQuestion>;
  mode: 'prova' | 'guia';
  db: SchoolDatabase;
}> = ({ paper, questionsById, mode, db }) => {
  const guide = mode === 'guia';
  const total = sumPoints(paper.items);
  return (
    <div className="p-8 space-y-4 text-slate-900 text-[12px] leading-relaxed">
      <div className="border-b-2 border-[#0b1f3a] pb-3 flex items-center gap-3 print-break-avoid">
        <div className="w-12 h-12 border border-slate-300 p-0.5 flex items-center justify-center shrink-0">
          <img src={db.settings?.logoUrl || '/school_emblem.png'} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black tracking-wide text-[#0b1f3a] uppercase">{db.settings?.schoolName}</h1>
          <p className="text-[11px] text-slate-500">
            {EXAM_PAPER_TYPE_LABELS[paper.type]} · {paper.subjectName} · {paper.grade} · {paper.trimester}º Trimestre · {paper.academicYear}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono font-black text-[#0b1f3a]">{paper.code}</div>
          {guide && <div className="text-[10px] font-bold uppercase text-[#7a0c0c]">Guia de correção — confidencial</div>}
        </div>
      </div>

      <h2 className="text-center text-sm font-black uppercase tracking-wide print-break-avoid">{paper.title}</h2>

      {!guide && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] print-break-avoid">
          <div className="border-b border-slate-400 pb-0.5">Nome: <span className="text-slate-300">____________________________</span></div>
          <div className="border-b border-slate-400 pb-0.5">Nº: <span className="text-slate-300">_____</span> &nbsp; Turma: <span className="text-slate-300">_______</span></div>
          <div className="border-b border-slate-400 pb-0.5">Data: {paper.examDate ? fmtDate(paper.examDate) : '____/____/______'}</div>
          <div className="border-b border-slate-400 pb-0.5">Duração: {paper.durationMinutes} min · Cotação: {formatPoints(total)} valores</div>
        </div>
      )}
      {guide && (
        <p className="text-[11px] text-slate-600">
          Duração: {paper.durationMinutes} min · Total: {formatPoints(total)} valores · Autor: {paper.authorName}
        </p>
      )}

      {paper.instructions && !guide && (
        <p className="p-2 border border-slate-300 bg-slate-50 text-[11px] print-break-avoid">
          <strong>Instruções:</strong> {paper.instructions}
        </p>
      )}

      <ol className="space-y-4">
        {paper.items.map((item, idx) => {
          const q = resolveItemQuestion(item, questionsById, paper.status);
          if (!q) {
            return (
              <li key={item.questionId} className="print-break-avoid text-red-700">
                {idx + 1}. [Questão indisponível no banco]
              </li>
            );
          }
          return (
            <li key={item.questionId} className="print-break-avoid">
              <div className="flex gap-2">
                <span className="font-bold">{idx + 1}.</span>
                <div className="flex-1">
                  <div className="flex justify-between gap-3">
                    <span className="whitespace-pre-wrap break-words min-w-0 flex-1">{q.statement}</span>
                    <span className="font-bold text-[11px] whitespace-nowrap shrink-0">({formatPoints(item.points)} val.)</span>
                  </div>

                  {q.type === 'escolha_multipla' && (
                    <ul className="mt-1.5 space-y-0.5">
                      {(q.options || []).map((o, i) => (
                        <li key={o.id} className={`break-words ${guide && o.isCorrect ? 'font-bold text-emerald-800' : ''}`}>
                          {optionLetter(i)}) {o.text} {guide && o.isCorrect ? '✔' : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.type === 'verdadeiro_falso' && (
                    <div className="mt-1.5">
                      {guide ? (
                        <span className="font-bold text-emerald-800">Resposta: {q.correctBoolean ? 'Verdadeiro' : 'Falso'}</span>
                      ) : (
                        <span>( &nbsp;) Verdadeiro &nbsp;&nbsp;&nbsp; ( &nbsp;) Falso</span>
                      )}
                    </div>
                  )}
                  {q.type === 'resposta_curta' &&
                    (guide ? (
                      <div className="mt-1.5 font-bold text-emerald-800 break-words">Resposta esperada: {q.expectedAnswer}</div>
                    ) : (
                      <div className="mt-2 border-b border-slate-400 h-5" />
                    ))}
                  {q.type === 'desenvolvimento' &&
                    (guide ? (
                      <div className="mt-1.5 p-2 border border-emerald-300 bg-emerald-50 text-emerald-900 whitespace-pre-wrap break-words">
                        <strong>Critérios de correção:</strong> {q.expectedAnswer}
                      </div>
                    ) : (
                      <div className="mt-2 space-y-3">
                        {[0, 1, 2, 3].map((n) => (
                          <div key={n} className="border-b border-slate-300 h-4" />
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="text-right text-[11px] font-bold border-t border-slate-300 pt-2 print-break-avoid">
        Total: {formatPoints(total)} valores
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vista principal
// ---------------------------------------------------------------------------
export const BancoQuestoesView: React.FC<BancoQuestoesViewProps> = ({ db, currentUserRole, currentUser }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('banco_questoes.manage');
  const canApprove = acl.can('banco_questoes.approve');
  const canSeeAll = acl.can('banco_questoes.manage_all');
  const userId = currentUser?.id || db.currentUser?.id || '';
  const access = { canManageAll: canSeeAll, canApprove };

  const subjects = useMemo(() => getAvailableSubjectsForUser(db, currentUser), [db, currentUser]);
  const subjectNames = useMemo(
    () => Array.from(new Set(subjects.map((s) => s.name))).sort((a, b) => a.localeCompare(b, 'pt')),
    [subjects]
  );

  // Um Professor só pode etiquetar questões/provas nas Classes onde está
  // efetivamente alocado — nunca em qualquer Classe da instituição.
  const allocatedClassIds = useMemo(() => getAllocatedClassIdsForUser(db, currentUser), [db, currentUser]);
  const teacherAllowedGrades = useMemo(() => {
    if (!allocatedClassIds) return null; // não é professor: sem restrição
    // Professor sem nenhuma turma atribuída: conjunto vazio (nenhuma Classe disponível).
    const grades = new Set<string>();
    (db.classes || []).forEach((c) => {
      if (allocatedClassIds.has(String(c.id)) && c.grade) grades.add(c.grade);
    });
    return grades;
  }, [db.classes, allocatedClassIds]);

  const allGradeOptions = useMemo(() => getAvailableGrades(db.settings?.selectedSubsystems), [db.settings?.selectedSubsystems]);
  const gradeOptions = useMemo(() => {
    if (!teacherAllowedGrades) return allGradeOptions;
    return allGradeOptions.filter((g) => teacherAllowedGrades.has(g));
  }, [allGradeOptions, teacherAllowedGrades]);
  const academicYear = db.settings?.currentAcademicYear || '';

  // Disciplinas oferecidas no formulário para uma Classe específica: só as
  // realmente ATRIBUÍDAS a essa Classe na Secretaria Académica → Atribuição,
  // restritas ainda às disciplinas deste utilizador quando for Professor.
  // Sem Classe selecionada, cai para a lista geral do utilizador (subjectNames)
  // para não bloquear o preenchimento antes de escolher a Classe. Uma Classe
  // sem Atribuição preenchida devolve lista vazia — nunca mistura disciplinas
  // de outra Classe.
  const subjectNamesForGrade = React.useCallback(
    (grade: string): string[] => {
      if (!grade) return subjectNames;
      if (currentUser?.role === 'professor') {
        // Professor: união, por cada turma SUA desta Classe, das disciplinas
        // atribuídas a essa turma que ele efetivamente leciona.
        const names = new Set<string>();
        (db.classes || []).forEach((c) => {
          if (c.grade !== grade) return;
          if (allocatedClassIds && !allocatedClassIds.has(String(c.id))) return;
          filterSubjectsForUser(getSubjectsForClass(db, c), db, currentUser, c.id).forEach((sub) => names.add(sub.name));
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt'));
      }
      const assigned = getAssignedSubjectsForGrade(db, grade).map((s) => s.name);
      if (canSeeAll) return assigned.sort((a, b) => a.localeCompare(b, 'pt'));
      const mySubjectKeys = new Set(subjectNames.map((n) => normalizeText(n)));
      return assigned.filter((n) => mySubjectKeys.has(normalizeText(n))).sort((a, b) => a.localeCompare(b, 'pt'));
    },
    [db, subjectNames, canSeeAll, currentUser, allocatedClassIds]
  );

  const ctx = useMemo(
    () => ({
      userId,
      canSeeAll,
      subjectKeys: canSeeAll ? null : new Set(subjectNames.map((n) => normalizeText(n)))
    }),
    [userId, canSeeAll, subjectNames]
  );

  const allQuestions = db.questions || [];
  const allPapers = db.examPapers || [];
  const questions = useMemo(() => allQuestions.filter((q) => canViewQuestion(q, ctx)), [allQuestions, ctx]);
  const papers = useMemo(() => allPapers.filter((p) => canViewPaper(p, ctx)), [allPapers, ctx]);
  const questionsById = useMemo(() => new Map(allQuestions.map((q) => [q.id, q])), [allQuestions]);

  const [tab, setTab] = useState<'questoes' | 'provas'>('questoes');
  const [search, setSearch] = useState('');
  const [fSubject, setFSubject] = useState('all');
  const [fGrade, setFGrade] = useState('all');
  const [fType, setFType] = useState<'all' | QuestionType>('all');
  const [fDiff, setFDiff] = useState<'all' | QuestionDifficulty>('all');
  const [fStatus, setFStatus] = useState<'all' | QuestionStatus>('all');
  const [onlyMine, setOnlyMine] = useState(false);

  const [qOpen, setQOpen] = useState(false);
  const [qEditing, setQEditing] = useState<ExamQuestion | null>(null);
  const [qForm, setQForm] = useState<QForm>(emptyQForm());
  const [qErrors, setQErrors] = useState<string[]>([]);

  const [pOpen, setPOpen] = useState(false);
  const [pForm, setPForm] = useState<PForm>(emptyPForm());
  const [pReadOnly, setPReadOnly] = useState(false);
  const [pError, setPError] = useState('');
  const [pickerText, setPickerText] = useState('');
  const [pickerDrafts, setPickerDrafts] = useState(false);
  const [auto, setAuto] = useState({ facil: 2, media: 2, dificil: 1 });
  const [autoNote, setAutoNote] = useState('');

  const [printing, setPrinting] = useState<{ paper: ExamPaper; mode: 'prova' | 'guia' } | null>(null);

  // ---- utilitários -------------------------------------------------------
  const run = async (action: () => void, rule: string, loadingMessage: string, successMessage?: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  const canEditQuestion = (q: ExamQuestion) => canManage && (q.authorId === userId || canSeeAll);
  const canEditPaper = (p: ExamPaper) => canManage && (p.authorId === userId || canSeeAll);

  // ---- questões ----------------------------------------------------------
  const filteredQuestions = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions
      .filter((q) => fSubject === 'all' || q.subjectName === fSubject)
      .filter((q) => fGrade === 'all' || q.grade === fGrade)
      .filter((q) => fType === 'all' || q.type === fType)
      .filter((q) => fDiff === 'all' || q.difficulty === fDiff)
      .filter((q) => fStatus === 'all' || q.status === fStatus)
      .filter((q) => !onlyMine || q.authorId === userId)
      .filter((q) => !s || q.statement.toLowerCase().includes(s) || q.code.toLowerCase().includes(s) || (q.topic || '').toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [questions, fSubject, fGrade, fType, fDiff, fStatus, onlyMine, search, userId]);
  const { page: pgFilteredQuestions, setPage: setPgFilteredQuestions, pageItems: visibleFilteredQuestions } = usePagedList(filteredQuestions, [filteredQuestions.length]);

  const openNewQuestion = () => {
    setQEditing(null);
    setQForm(emptyQForm(subjectNames.length === 1 ? subjectNames[0] : '', ''));
    setQErrors([]);
    setQOpen(true);
  };
  const openEditQuestion = (q: ExamQuestion) => {
    setQEditing(q);
    setQForm(qFormFromQuestion(q));
    setQErrors([]);
    setQOpen(true);
  };

  const liveQErrors = useMemo(() => validateQuestion(normalizeQuestionFields(qPayload(qForm) as any)), [qForm]);

  const submitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (liveQErrors.length > 0) return setQErrors(liveQErrors);
    let failure = '';
    const result = await run(
      () => {
        const payload = qPayload(qForm) as any;
        const r = qEditing
          ? dbService.updateQuestion(qEditing.id, payload, access)
          : dbService.addQuestion(payload, { canApprove, approveNow: qForm.approveNow });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      'banco_questoes.manage',
      'A guardar questão...',
      qEditing ? 'Questão atualizada!' : 'Questão guardada!'
    );
    if (result.ok) setQOpen(false);
    else setQErrors([failure || result.error || 'Não foi possível guardar.']);
  };

  const changeQuestionStatus = (q: ExamQuestion, status: QuestionStatus, msg: string) =>
    run(
      () => {
        const r = dbService.setQuestionStatus(q.id, status, access);
        if (!r.success) throw new Error(r.error);
      },
      status === 'aprovada' ? 'banco_questoes.approve' : 'banco_questoes.manage',
      'A atualizar questão...',
      msg
    );

  const duplicateQuestion = (q: ExamQuestion) =>
    run(
      () => {
        const r = dbService.duplicateQuestion(q.id);
        if (!r.success) throw new Error(r.error);
      },
      'banco_questoes.manage',
      'A duplicar questão...',
      'Cópia criada como rascunho.'
    );

  const deleteQuestion = async (q: ExamQuestion) => {
    const ok = await showAppConfirm(`Eliminar a questão ${q.code}? Esta ação não pode ser desfeita.`, {
      title: 'Eliminar Questão',
      variant: 'error',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
    await run(
      () => {
        const res = dbService.deleteQuestion(q.id, access);
        if (!res.success) throw new Error(res.error);
      },
      'banco_questoes.manage',
      'A eliminar questão...',
      'Questão eliminada.'
    );
  };

  // ---- provas ------------------------------------------------------------
  const openNewPaper = () => {
    setPForm(emptyPForm(subjectNames.length === 1 ? subjectNames[0] : '', ''));
    setPReadOnly(false);
    setPError('');
    setAutoNote('');
    setPickerText('');
    setPOpen(true);
  };
  const openPaper = (p: ExamPaper) => {
    setPForm({
      id: p.id,
      title: p.title,
      type: p.type,
      subjectName: p.subjectName,
      grade: p.grade,
      trimester: p.trimester,
      examDate: p.examDate || '',
      durationMinutes: String(p.durationMinutes),
      targetPoints: String(p.targetPoints),
      instructions: p.instructions || '',
      items: p.items.map((i) => ({ ...i }))
    });
    setPReadOnly(p.status !== 'rascunho' || !canEditPaper(p));
    setPError('');
    setAutoNote('');
    setPickerText('');
    setPOpen(true);
  };

  const target = Number(String(pForm.targetPoints).replace(',', '.')) || DEFAULT_TARGET_POINTS;
  const paperCurrentStatus = allPapers.find((p) => p.id === pForm.id)?.status || 'rascunho';

  const pool = useMemo(
    () =>
      questions.filter(
        (q) =>
          q.status !== 'arquivada' &&
          normalizeText(q.subjectName) === normalizeText(pForm.subjectName) &&
          normalizeGradeKey(q.grade) === normalizeGradeKey(pForm.grade)
      ),
    [questions, pForm.subjectName, pForm.grade]
  );
  const approvedPool = useMemo(() => pool.filter((q) => q.status === 'aprovada'), [pool]);
  const usedIds = useMemo(() => new Set(pForm.items.map((i) => i.questionId)), [pForm.items]);
  const pickerList = useMemo(() => {
    const s = pickerText.trim().toLowerCase();
    return pool
      .filter((q) => !usedIds.has(q.id))
      .filter((q) => pickerDrafts || q.status === 'aprovada')
      .filter((q) => !s || q.statement.toLowerCase().includes(s) || (q.topic || '').toLowerCase().includes(s))
      .slice(0, 60);
  }, [pool, usedIds, pickerText, pickerDrafts]);

  const publishProblems = useMemo(
    () =>
      validatePaperForPublish(
        {
          title: pForm.title,
          subjectName: pForm.subjectName,
          grade: pForm.grade,
          durationMinutes: Number(pForm.durationMinutes),
          targetPoints: target,
          items: pForm.items
        },
        questionsById
      ),
    [pForm, target, questionsById]
  );

  const addQuestionToPaper = (q: ExamQuestion) =>
    setPForm((f) => ({ ...f, items: [...f.items, { questionId: q.id, points: q.defaultPoints }] }));
  const removeItem = (id: string) => setPForm((f) => ({ ...f, items: f.items.filter((i) => i.questionId !== id) }));
  const moveItem = (idx: number, dir: -1 | 1) =>
    setPForm((f) => {
      const items = f.items.slice();
      const j = idx + dir;
      if (j < 0 || j >= items.length) return f;
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...f, items };
    });
  const setItemPoints = (id: string, raw: string) =>
    setPForm((f) => ({
      ...f,
      items: f.items.map((i) => (i.questionId === id ? { ...i, points: Number(raw.replace(',', '.')) || 0 } : i))
    }));
  const distribute = () => setPForm((f) => ({ ...f, items: distributePoints(f.items, target) }));

  const runAuto = () => {
    const res = autoSelectQuestions(approvedPool, auto, pForm.items.map((i) => i.questionId));
    if (res.selected.length === 0) {
      setAutoNote('O banco não tem questões aprovadas suficientes para este pedido.');
      return;
    }
    setPForm((f) => {
      const merged = [...f.items, ...res.selected.map((q) => ({ questionId: q.id, points: q.defaultPoints }))];
      return { ...f, items: distributePoints(merged, target) };
    });
    const missing = res.shortfall.facil + res.shortfall.media + res.shortfall.dificil;
    setAutoNote(
      missing > 0
        ? `Faltam ${missing} questão(ões) aprovadas (fácil ${res.shortfall.facil}, média ${res.shortfall.media}, difícil ${res.shortfall.dificil}). Cotações redistribuídas para ${formatPoints(target)} valores.`
        : `Adicionadas ${res.selected.length} questões; cotações redistribuídas para ${formatPoints(target)} valores.`
    );
  };

  const paperInput = () => ({
    id: pForm.id,
    title: pForm.title,
    subjectName: pForm.subjectName,
    grade: pForm.grade,
    type: pForm.type,
    academicYear: allPapers.find((p) => p.id === pForm.id)?.academicYear || academicYear,
    trimester: pForm.trimester,
    examDate: pForm.examDate,
    durationMinutes: Number(pForm.durationMinutes),
    targetPoints: target,
    instructions: pForm.instructions,
    items: pForm.items
  });

  const savePaper = async (publish: boolean) => {
    let failure = '';
    let savedId = pForm.id;
    const result = await run(
      () => {
        const saved = dbService.saveExamPaper(paperInput(), access);
        if (!saved.success) {
          failure = saved.error || '';
          throw new Error(saved.error);
        }
        savedId = saved.paper!.id;
        if (publish) {
          const pub = dbService.publishExamPaper(savedId, access);
          if (!pub.success) {
            failure = pub.error || '';
            // A prova fica gravada como rascunho; só a publicação falhou.
            throw new Error(pub.error);
          }
        }
      },
      'banco_questoes.manage',
      publish ? 'A publicar prova...' : 'A guardar rascunho...',
      publish ? 'Prova publicada! Já não pode ser alterada.' : 'Rascunho guardado.'
    );
    if (result.ok) {
      setPOpen(false);
    } else {
      if (savedId && !pForm.id) setPForm((f) => ({ ...f, id: savedId }));
      setPError(failure || result.error || 'Não foi possível guardar a prova.');
    }
  };

  const confirmPublish = async () => {
    const ok = await showAppConfirm(
      'Ao publicar, a prova fica congelada: as questões são copiadas e nenhuma edição posterior ao banco a altera. Só poderá duplicá-la ou arquivá-la. Publicar agora?',
      { title: 'Publicar Prova', variant: 'info', confirmLabel: 'Publicar', cancelLabel: 'Voltar' }
    );
    if (ok) savePaper(true);
  };

  const paperAction = (fn: () => { success: boolean; error?: string }, loading: string, done: string) =>
    run(
      () => {
        const r = fn();
        if (!r.success) throw new Error(r.error);
      },
      'banco_questoes.manage',
      loading,
      done
    );

  const deletePaper = async (p: ExamPaper) => {
    const ok = await showAppConfirm(`Eliminar a prova ${p.code} — ${p.title}?`, {
      title: 'Eliminar Prova',
      variant: 'error',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar'
    });
    if (ok) paperAction(() => dbService.deleteExamPaper(p.id, access), 'A eliminar prova...', 'Prova eliminada.');
  };

  const restricted = paperTypeNeedsApproval(pForm.type);
  const cannotPublishReason =
    restricted && !canApprove ? 'Exames finais, de recurso e de acesso só podem ser publicados pela Direção / Administração.' : '';

  // ---- render ------------------------------------------------------------
  const chip = (cls: string, text: string) => <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cls}`}>{text}</span>;

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">BANCO DE QUESTÕES</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">QUESTÕES E PROVAS</h1>
          <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">
            {canSeeAll
              ? 'Vê e gere todo o banco. Aprove as questões antes de entrarem numa prova publicada.'
              : 'Vê as suas questões e as questões aprovadas das disciplinas que leciona. Os rascunhos dos colegas são confidenciais.'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={tab === 'questoes' ? openNewQuestion : openNewPaper}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">{tab === 'questoes' ? 'add_circle' : 'post_add'}</span>
            <span>{tab === 'questoes' ? 'NOVA QUESTÃO' : 'NOVA PROVA'}</span>
          </button>
        )}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3 no-print">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1 border-b border-slate-200">
            {(
              [
                ['questoes', `Questões (${questions.length})`],
                ['provas', `Provas (${papers.length})`]
              ] as ['questoes' | 'provas', string][]
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 -mb-px ${tab === k ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
            <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'questoes' ? 'Pesquisar enunciado, código ou tema...' : 'Pesquisar prova, código ou disciplina...'}
              className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none text-xs text-slate-800 placeholder:text-slate-400"
            />
          </div>
        </div>
        {tab === 'questoes' && (
          <div className="flex flex-wrap items-center gap-2">
            {[
              { v: fSubject, s: setFSubject, all: 'Todas as Disciplinas', opts: Array.from(new Set(questions.map((q) => q.subjectName))).sort() },
              { v: fGrade, s: setFGrade, all: 'Todas as Classes', opts: gradeOptions }
            ].map((f, i) => (
              <select key={i} value={f.v} onChange={(e) => f.s(e.target.value)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
                <option value="all">{f.all}</option>
                {f.opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ))}
            <select value={fType} onChange={(e) => setFType(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
              <option value="all">Todos os Tipos</option>
              {Object.entries(QUESTION_TYPE_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
            <select value={fDiff} onChange={(e) => setFDiff(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
              <option value="all">Toda a Dificuldade</option>
              {Object.entries(DIFFICULTY_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as any)} className="h-9 px-3 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 border-0">
              <option value="all">Todos os Estados</option>
              {Object.entries(QUESTION_STATUS_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Só as minhas
            </label>
            <span className="ml-auto text-xs text-slate-400 font-mono">{filteredQuestions.length} questão(ões)</span>
          </div>
        )}
      </div>

      {/* ---------------- Lista de questões ---------------- */}
      {tab === 'questoes' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden no-print">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-4">Questão</th>
                  <th className="py-3.5 px-3">Disciplina / Classe</th>
                  <th className="py-3.5 px-3">Tipo</th>
                  <th className="py-3.5 px-3">Dific.</th>
                  <th className="py-3.5 px-3">Estado</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQuestions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      {questions.length === 0
                        ? 'O banco ainda não tem questões. Clique em "NOVA QUESTÃO" para começar.'
                        : 'Nenhuma questão corresponde aos filtros.'}
                    </td>
                  </tr>
                ) : (
                  visibleFilteredQuestions.map((q) => {
                    const used = countQuestionUsage(q.id, allPapers);
                    return (
                      <tr key={q.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 max-w-md">
                          <div className="text-slate-800 font-semibold line-clamp-2">{q.statement}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {q.code} · {formatPoints(q.defaultPoints)} val.
                            {q.topic ? ` · ${q.topic}` : ''} · {q.authorName}
                            {used > 0 ? ` · em ${used} prova(s)` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          {q.subjectName}
                          <div className="text-[11px] text-slate-400">{q.grade}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-slate-400">{QUESTION_TYPE_META[q.type].icon}</span>
                            {QUESTION_TYPE_META[q.type].label}
                          </span>
                        </td>
                        <td className="py-3 px-3">{chip(DIFFICULTY_META[q.difficulty].badge, DIFFICULTY_META[q.difficulty].label)}</td>
                        <td className="py-3 px-3">{chip(QUESTION_STATUS_META[q.status].badge, QUESTION_STATUS_META[q.status].label)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {canApprove && q.status === 'rascunho' && (
                              <button onClick={() => changeQuestionStatus(q, 'aprovada', 'Questão aprovada.')} className="px-2.5 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer mr-1">
                                Aprovar
                              </button>
                            )}
                            {canEditQuestion(q) && (
                              <button onClick={() => openEditQuestion(q)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-slate-100 cursor-pointer" title="Editar">
                                <span className="material-symbols-outlined text-[18px]">edit</span>
                              </button>
                            )}
                            {canManage && (
                              <button onClick={() => duplicateQuestion(q)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title="Duplicar como rascunho">
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                              </button>
                            )}
                            {canEditQuestion(q) && q.status !== 'arquivada' && (
                              <button onClick={() => changeQuestionStatus(q, 'arquivada', 'Questão arquivada.')} className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-slate-100 cursor-pointer" title="Arquivar">
                                <span className="material-symbols-outlined text-[18px]">archive</span>
                              </button>
                            )}
                            {canEditQuestion(q) && q.status === 'arquivada' && (
                              <button onClick={() => changeQuestionStatus(q, 'rascunho', 'Questão restaurada como rascunho.')} className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 cursor-pointer" title="Restaurar como rascunho">
                                <span className="material-symbols-outlined text-[18px]">unarchive</span>
                              </button>
                            )}
                            {canEditQuestion(q) && (
                              <button onClick={() => deleteQuestion(q)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer" title="Eliminar">
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <TablePagination total={filteredQuestions.length} page={pgFilteredQuestions} onPageChange={setPgFilteredQuestions} />
          </div>
        </div>
      )}

      {/* ---------------- Lista de provas ---------------- */}
      {tab === 'provas' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden no-print">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-4">Prova</th>
                  <th className="py-3.5 px-3">Disciplina / Classe</th>
                  <th className="py-3.5 px-3">Composição</th>
                  <th className="py-3.5 px-3">Estado</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {papers.filter((p) => {
                  const s = search.trim().toLowerCase();
                  return !s || p.title.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || p.subjectName.toLowerCase().includes(s);
                }).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      Ainda não há provas. Clique em "NOVA PROVA" para montar uma a partir do banco.
                    </td>
                  </tr>
                ) : (
                  papers
                    .filter((p) => {
                      const s = search.trim().toLowerCase();
                      return !s || p.title.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || p.subjectName.toLowerCase().includes(s);
                    })
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((p) => {
                      const st = paperStats(p, questionsById);
                      const okPoints = pointsMatchTarget(p.items, p.targetPoints);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <button onClick={() => openPaper(p)} className="font-bold text-[#0b1f3a] hover:underline text-left cursor-pointer">
                              {p.title}
                            </button>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {p.code} · {EXAM_PAPER_TYPE_LABELS[p.type]} · {p.trimester}º Trim. · {p.authorName}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-700">
                            {p.subjectName}
                            <div className="text-[11px] text-slate-400">{p.grade}</div>
                          </td>
                          <td className="py-3 px-3 text-slate-700">
                            {st.total} questões ·{' '}
                            <span className={okPoints ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>{formatPoints(st.points)}/{formatPoints(p.targetPoints)} val.</span>
                            <div className="text-[11px] text-slate-400">
                              {st.byDifficulty.facil}F · {st.byDifficulty.media}M · {st.byDifficulty.dificil}D · {p.durationMinutes} min
                            </div>
                          </td>
                          <td className="py-3 px-3">{chip(EXAM_STATUS_META[p.status].badge, EXAM_STATUS_META[p.status].label)}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <button onClick={() => openPaper(p)} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title={p.status === 'rascunho' && canEditPaper(p) ? 'Editar' : 'Ver'}>
                                <span className="material-symbols-outlined text-[18px]">{p.status === 'rascunho' && canEditPaper(p) ? 'edit' : 'visibility'}</span>
                              </button>
                              <button onClick={() => setPrinting({ paper: p, mode: 'prova' })} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title="Imprimir prova">
                                <span className="material-symbols-outlined text-[18px]">print</span>
                              </button>
                              <button onClick={() => setPrinting({ paper: p, mode: 'guia' })} className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 cursor-pointer" title="Guia de correção">
                                <span className="material-symbols-outlined text-[18px]">task_alt</span>
                              </button>
                              {canManage && (
                                <button onClick={() => paperAction(() => dbService.duplicateExamPaper(p.id), 'A duplicar prova...', 'Cópia criada como rascunho.')} className="p-1.5 rounded-lg text-slate-500 hover:text-[#0b1f3a] hover:bg-slate-100 cursor-pointer" title="Duplicar como rascunho">
                                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                </button>
                              )}
                              {canEditPaper(p) && p.status !== 'arquivada' && (
                                <button onClick={() => paperAction(() => dbService.archiveExamPaper(p.id, access), 'A arquivar prova...', 'Prova arquivada.')} className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-slate-100 cursor-pointer" title="Arquivar">
                                  <span className="material-symbols-outlined text-[18px]">archive</span>
                                </button>
                              )}
                              {canEditPaper(p) && p.status !== 'publicada' && (
                                <button onClick={() => deletePaper(p)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer" title="Eliminar">
                                  <span className="material-symbols-outlined text-[18px]">delete</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- Modal: questão ---------------- */}
      {qOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 no-print"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQOpen(false);
          }}
        >
          <form onSubmit={submitQuestion} className="bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title={qEditing ? `Editar Questão ${qEditing.code}` : 'Nova Questão'}
              subtitle={QUESTION_TYPE_META[qForm.type].hint}
              icon="quiz"
              onClose={() => setQOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {qErrors.length > 0 && (
                <Notice tone="error">
                  {qErrors.map((e) => (
                    <div key={e}>• {e}</div>
                  ))}
                </Notice>
              )}
              {qEditing?.status === 'aprovada' && !canApprove && (
                <Notice tone="warn">
                  Esta questão está aprovada. Se a guardar com alterações, volta a <strong>rascunho</strong> e precisa de nova aprovação.
                </Notice>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Disciplina *</label>
                  <select value={qForm.subjectName} onChange={(e) => setQForm({ ...qForm, subjectName: e.target.value })} className={inputCls}>
                    <option value="">{qForm.grade ? 'Selecione...' : 'Selecione primeiro a Classe...'}</option>
                    {(() => {
                      const opts = subjectNamesForGrade(qForm.grade);
                      const list = qForm.subjectName && !opts.includes(qForm.subjectName) ? [qForm.subjectName, ...opts] : opts;
                      return list.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ));
                    })()}
                  </select>
                  {qForm.grade && subjectNamesForGrade(qForm.grade).length === 0 && (
                    <p className="mt-1 text-[10px] text-amber-700 font-semibold">
                      Esta Classe ainda não tem disciplinas atribuídas na Secretaria Académica → Atribuição.
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Classe *</label>
                  <select
                    value={qForm.grade}
                    onChange={(e) => {
                      const newGrade = e.target.value;
                      const validSubjects = subjectNamesForGrade(newGrade);
                      setQForm({
                        ...qForm,
                        grade: newGrade,
                        subjectName: validSubjects.includes(qForm.subjectName) ? qForm.subjectName : ''
                      });
                    }}
                    className={inputCls}
                  >
                    <option value="">Selecione...</option>
                    {(qForm.grade && !gradeOptions.includes(qForm.grade) ? [qForm.grade, ...gradeOptions] : gradeOptions).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Trimestre</label>
                  <select value={qForm.trimester} onChange={(e) => setQForm({ ...qForm, trimester: e.target.value as any })} className={inputCls}>
                    <option value="">Todos</option>
                    <option value="1">1º</option>
                    <option value="2">2º</option>
                    <option value="3">3º</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Tema / conteúdo</label>
                  <input value={qForm.topic} onChange={(e) => setQForm({ ...qForm, topic: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Tipo *</label>
                  <select value={qForm.type} onChange={(e) => setQForm({ ...qForm, type: e.target.value as QuestionType })} className={inputCls}>
                    {Object.entries(QUESTION_TYPE_META).map(([k, m]) => (
                      <option key={k} value={k}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Dificuldade</label>
                    <select value={qForm.difficulty} onChange={(e) => setQForm({ ...qForm, difficulty: e.target.value as QuestionDifficulty })} className={inputCls}>
                      {Object.entries(DIFFICULTY_META).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Cotação</label>
                    <input inputMode="decimal" value={qForm.defaultPoints} onChange={(e) => setQForm({ ...qForm, defaultPoints: e.target.value })} className={inputCls} />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>Enunciado *</label>
                <textarea value={qForm.statement} onChange={(e) => setQForm({ ...qForm, statement: e.target.value })} rows={3} className={areaCls} />
              </div>

              {qForm.type === 'escolha_multipla' && (
                <div className="space-y-2">
                  <label className={labelCls}>Alternativas (marque a correta)</label>
                  {qForm.options.map((o, i) => (
                    <div key={o.id} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correct-option"
                        checked={o.isCorrect}
                        onChange={() => setQForm({ ...qForm, options: qForm.options.map((x, j) => ({ ...x, isCorrect: j === i })) })}
                        title="Alternativa correta"
                      />
                      <span className="font-bold text-slate-500 w-4">{optionLetter(i)}</span>
                      <input
                        value={o.text}
                        onChange={(e) => setQForm({ ...qForm, options: qForm.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                        className={inputCls}
                        placeholder={`Alternativa ${optionLetter(i)}`}
                      />
                      {qForm.options.length > 2 && (
                        <button type="button" onClick={() => setQForm({ ...qForm, options: qForm.options.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-700 cursor-pointer" title="Remover alternativa">
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      )}
                    </div>
                  ))}
                  {qForm.options.length < 6 && (
                    <button
                      type="button"
                      onClick={() => setQForm({ ...qForm, options: [...qForm.options, { id: `opt-${Date.now()}`, text: '', isCorrect: false }] })}
                      className="text-[#0b1f3a] font-bold hover:underline cursor-pointer"
                    >
                      + Adicionar alternativa
                    </button>
                  )}
                </div>
              )}

              {qForm.type === 'verdadeiro_falso' && (
                <div>
                  <label className={labelCls}>A afirmação é *</label>
                  <div className="flex items-center gap-6">
                    {[
                      [true, 'Verdadeira'],
                      [false, 'Falsa']
                    ].map(([v, l]) => (
                      <label key={String(v)} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="tf" checked={qForm.correctBoolean === v} onChange={() => setQForm({ ...qForm, correctBoolean: v as boolean })} />
                        {l as string}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(qForm.type === 'resposta_curta' || qForm.type === 'desenvolvimento') && (
                <div>
                  <label className={labelCls}>{qForm.type === 'resposta_curta' ? 'Resposta esperada *' : 'Critérios de correção / resposta modelo *'}</label>
                  <textarea value={qForm.expectedAnswer} onChange={(e) => setQForm({ ...qForm, expectedAnswer: e.target.value })} rows={3} className={areaCls} />
                </div>
              )}

              {!qEditing && canApprove && (
                <label className="flex items-center gap-2 text-slate-700 font-semibold cursor-pointer">
                  <input type="checkbox" checked={qForm.approveNow} onChange={(e) => setQForm({ ...qForm, approveNow: e.target.checked })} />
                  Aprovar já (fica disponível para provas)
                </label>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setQOpen(false)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                Cancelar
              </button>
              <button type="submit" className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer">
                {qEditing ? 'Guardar Alterações' : 'Guardar Questão'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: montar / ver prova ---------------- */}
      {pOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4 no-print"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPOpen(false);
          }}
        >
          <div className="bg-white max-w-6xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[96vh]">
            <FormModalHeader
              title={pForm.id ? pForm.title || 'Prova' : 'Nova Prova'}
              subtitle={pReadOnly ? 'Só de leitura' : 'Monte a prova a partir do banco · as cotações somam o total da prova'}
              icon="assignment"
              badge={pForm.id ? EXAM_STATUS_META[paperCurrentStatus].label : undefined}
              onClose={() => setPOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-5 text-xs space-y-4">
              {pError && <Notice tone="error">{pError}</Notice>}

              <fieldset disabled={pReadOnly} className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="col-span-2 lg:col-span-3">
                  <label className={labelCls}>Título *</label>
                  <input value={pForm.title} onChange={(e) => setPForm({ ...pForm, title: e.target.value })} className={inputCls} placeholder="Ex.: 1º Teste de Matemática" />
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <label className={labelCls}>Tipo</label>
                  <select value={pForm.type} onChange={(e) => setPForm({ ...pForm, type: e.target.value as ExamPaperType })} className={inputCls}>
                    {Object.entries(EXAM_PAPER_TYPE_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1 lg:col-span-1">
                  <label className={labelCls}>Trimestre</label>
                  <select value={pForm.trimester} onChange={(e) => setPForm({ ...pForm, trimester: e.target.value as any })} className={inputCls}>
                    <option value="1">1º</option>
                    <option value="2">2º</option>
                    <option value="3">3º</option>
                  </select>
                </div>
                <div className="col-span-1">
                  <label className={labelCls}>Data</label>
                  <input type="date" value={pForm.examDate} onChange={(e) => setPForm({ ...pForm, examDate: e.target.value })} className={inputCls} />
                </div>
                <div className="col-span-2 lg:col-span-2">
                  <label className={labelCls}>Disciplina *</label>
                  <select
                    value={pForm.subjectName}
                    onChange={(e) => setPForm({ ...pForm, subjectName: e.target.value })}
                    disabled={pForm.items.length > 0}
                    title={pForm.items.length > 0 ? 'Remova as questões para mudar a disciplina' : undefined}
                    className={inputCls}
                  >
                    <option value="">{pForm.grade ? 'Selecione...' : 'Selecione primeiro a Classe...'}</option>
                    {(() => {
                      const opts = subjectNamesForGrade(pForm.grade);
                      const list = pForm.subjectName && !opts.includes(pForm.subjectName) ? [pForm.subjectName, ...opts] : opts;
                      return list.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
                <div className="col-span-2 lg:col-span-2">
                  <label className={labelCls}>Classe *</label>
                  <select
                    value={pForm.grade}
                    onChange={(e) => {
                      const newGrade = e.target.value;
                      const validSubjects = subjectNamesForGrade(newGrade);
                      setPForm({
                        ...pForm,
                        grade: newGrade,
                        subjectName: validSubjects.includes(pForm.subjectName) ? pForm.subjectName : ''
                      });
                    }}
                    disabled={pForm.items.length > 0}
                    title={pForm.items.length > 0 ? 'Remova as questões para mudar a classe' : undefined}
                    className={inputCls}
                  >
                    <option value="">Selecione...</option>
                    {(pForm.grade && !gradeOptions.includes(pForm.grade) ? [pForm.grade, ...gradeOptions] : gradeOptions).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Duração (min)</label>
                  <input inputMode="numeric" value={pForm.durationMinutes} onChange={(e) => setPForm({ ...pForm, durationMinutes: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Total (valores)</label>
                  <input inputMode="decimal" value={pForm.targetPoints} onChange={(e) => setPForm({ ...pForm, targetPoints: e.target.value })} className={inputCls} />
                </div>
                <div className="col-span-2 lg:col-span-6">
                  <label className={labelCls}>Instruções ao aluno</label>
                  <input value={pForm.instructions} onChange={(e) => setPForm({ ...pForm, instructions: e.target.value })} className={inputCls} />
                </div>
              </fieldset>

              <div className={`grid gap-4 ${pReadOnly ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
                {/* Questões da prova */}
                <div className="border border-slate-200">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[#0b1f3a] uppercase text-[11px]">Questões da prova ({pForm.items.length})</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-bold ${pointsMatchTarget(pForm.items, target) ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatPoints(sumPoints(pForm.items))} / {formatPoints(target)} val.
                      </span>
                      {!pReadOnly && pForm.items.length > 0 && (
                        <button type="button" onClick={distribute} className="px-2.5 h-7 bg-slate-200 hover:bg-slate-300 text-[#0b1f3a] font-bold cursor-pointer" title="Reescala as cotações, mantendo as proporções">
                          Distribuir p/ {formatPoints(target)}
                        </button>
                      )}
                    </div>
                  </div>
                  {pForm.items.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      {pReadOnly ? 'Sem questões.' : 'Escolha questões do banco (à direita) ou use a seleção automática.'}
                    </div>
                  ) : (
                    <ol className="divide-y divide-slate-100">
                      {pForm.items.map((item, idx) => {
                        const q = pReadOnly
                          ? resolveItemQuestion(item, questionsById, paperCurrentStatus)
                          : questionsById.get(item.questionId);
                        return (
                          <li key={item.questionId} className="px-3 py-2 flex items-start gap-2">
                            <span className="font-bold text-slate-500 w-5 pt-1">{idx + 1}.</span>
                            <div className="flex-1 min-w-0">
                              <div className={`line-clamp-2 ${q ? 'text-slate-800' : 'text-red-700 font-semibold'}`}>
                                {q ? q.statement : 'Questão já não existe no banco — remova-a.'}
                              </div>
                              {q && (
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {q.code} · {QUESTION_TYPE_META[q.type].label} · {DIFFICULTY_META[q.difficulty].label}
                                  {q.status !== 'aprovada' && !pReadOnly ? ' · NÃO APROVADA' : ''}
                                </div>
                              )}
                            </div>
                            {pReadOnly ? (
                              <span className="font-mono font-bold pt-1">{formatPoints(item.points)}</span>
                            ) : (
                              <>
                                <input
                                  inputMode="decimal"
                                  value={String(item.points).replace('.', ',')}
                                  onChange={(e) => setItemPoints(item.questionId, e.target.value)}
                                  className="w-14 h-8 px-2 border border-slate-300 text-right font-mono"
                                  title="Cotação (valores)"
                                />
                                <div className="flex flex-col">
                                  <button type="button" onClick={() => moveItem(idx, -1)} className="text-slate-400 hover:text-[#0b1f3a] cursor-pointer leading-none" title="Subir">
                                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                                  </button>
                                  <button type="button" onClick={() => moveItem(idx, 1)} className="text-slate-400 hover:text-[#0b1f3a] cursor-pointer leading-none" title="Descer">
                                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                                  </button>
                                </div>
                                <button type="button" onClick={() => removeItem(item.questionId)} className="text-slate-400 hover:text-red-700 cursor-pointer pt-1" title="Remover da prova">
                                  <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>

                {/* Banco (escolha) */}
                {!pReadOnly && (
                  <div className="border border-slate-200 flex flex-col">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 space-y-2">
                      <div className="font-bold text-[#0b1f3a] uppercase text-[11px]">Banco — {pForm.subjectName || 'escolha a disciplina'} · {pForm.grade || 'e a classe'}</div>
                      {pForm.subjectName && pForm.grade ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-600">Seleção automática:</span>
                            {(['facil', 'media', 'dificil'] as QuestionDifficulty[]).map((lv) => (
                              <label key={lv} className="flex items-center gap-1">
                                {DIFFICULTY_META[lv].label}
                                <input
                                  type="number"
                                  min={0}
                                  value={auto[lv]}
                                  onChange={(e) => setAuto({ ...auto, [lv]: Math.max(0, Number(e.target.value) || 0) })}
                                  className="w-12 h-7 px-1 border border-slate-300 text-center font-mono"
                                />
                              </label>
                            ))}
                            <button type="button" onClick={runAuto} className="px-3 h-7 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold cursor-pointer">
                              Escolher ao acaso
                            </button>
                          </div>
                          {autoNote && <div className="text-[11px] text-slate-600">{autoNote}</div>}
                          <div className="flex items-center gap-3">
                            <input
                              value={pickerText}
                              onChange={(e) => setPickerText(e.target.value)}
                              placeholder="Filtrar por enunciado ou tema..."
                              className="flex-1 h-8 px-2 border border-slate-300"
                            />
                            <label className="flex items-center gap-1 text-slate-600 cursor-pointer whitespace-nowrap">
                              <input type="checkbox" checked={pickerDrafts} onChange={(e) => setPickerDrafts(e.target.checked)} />
                              incluir rascunhos
                            </label>
                          </div>
                        </>
                      ) : (
                        <div className="text-slate-500">Indique a disciplina e a classe para listar as questões.</div>
                      )}
                    </div>
                    <ul className="divide-y divide-slate-100 overflow-y-auto max-h-80">
                      {pForm.subjectName && pForm.grade && pickerList.length === 0 && (
                        <li className="p-6 text-center text-slate-400">
                          {approvedPool.length === 0
                            ? 'Não há questões aprovadas para esta disciplina e classe.'
                            : 'Sem mais questões para adicionar com este filtro.'}
                        </li>
                      )}
                      {pickerList.map((q) => (
                        <li key={q.id} className="px-3 py-2 flex items-start gap-2 hover:bg-slate-50">
                          <div className="flex-1 min-w-0">
                            <div className="text-slate-800 line-clamp-2">{q.statement}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {q.code} · {QUESTION_TYPE_META[q.type].label} · {DIFFICULTY_META[q.difficulty].label} · {formatPoints(q.defaultPoints)} val.
                              {q.status !== 'aprovada' ? ' · RASCUNHO' : ''}
                            </div>
                          </div>
                          <button type="button" onClick={() => addQuestionToPaper(q)} className="px-2.5 h-7 bg-slate-100 hover:bg-slate-200 text-[#0b1f3a] font-bold cursor-pointer shrink-0">
                            + Adicionar
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {!pReadOnly && publishProblems.length > 0 && pForm.items.length > 0 && (
                <Notice tone="warn">
                  <div className="font-bold">Para publicar falta:</div>
                  {publishProblems.map((p) => (
                    <div key={p}>• {p}</div>
                  ))}
                </Notice>
              )}
              {!pReadOnly && cannotPublishReason && <div className="p-3 bg-slate-50 border border-slate-200 text-slate-600">{cannotPublishReason}</div>}
            </div>

            <div className="px-5 py-3 bg-slate-100 border-t border-slate-300 flex flex-wrap items-center justify-between gap-3">
              <div className="text-slate-500 text-[11px]">
                {pForm.id ? `${allPapers.find((p) => p.id === pForm.id)?.code || ''}` : 'A prova será criada como rascunho.'}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPOpen(false)} className="px-4 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                  {pReadOnly ? 'Fechar' : 'Cancelar'}
                </button>
                {!pReadOnly && (
                  <>
                    <button type="button" onClick={() => savePaper(false)} className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-[#0b1f3a] font-bold text-xs cursor-pointer">
                      Guardar Rascunho
                    </button>
                    <button
                      type="button"
                      onClick={confirmPublish}
                      disabled={publishProblems.length > 0 || !!cannotPublishReason}
                      title={publishProblems[0] || cannotPublishReason || undefined}
                      className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer"
                    >
                      Publicar Prova
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Prova / guia imprimível ---------------- */}
      {printing && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-start justify-center p-3 sm:p-4 printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block">
          <div className="printable-document printable-portrait bg-white max-w-3xl w-full shadow-2xl border border-slate-400 flex flex-col my-4 print:my-0 print:border-none print:shadow-none">
            <div className="px-6 py-3 bg-[#0b1f3a] text-white flex items-center justify-between no-print">
              <span className="font-bold text-sm">
                {printing.mode === 'prova' ? 'Prova para o aluno' : 'Guia de correção (confidencial)'}
                {printing.paper.status === 'rascunho' ? ' — RASCUNHO' : ''}
              </span>
              <button onClick={() => setPrinting(null)} className="text-slate-300 hover:text-white cursor-pointer" title="Fechar">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <PaperDocument paper={printing.paper} questionsById={questionsById} mode={printing.mode} db={db} />
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3 no-print">
              <button
                onClick={() => {
                  window.focus();
                  window.print();
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>Imprimir
              </button>
              <button onClick={() => setPrinting(null)} className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
