import {
  ExamPaper,
  ExamPaperItem,
  ExamPaperType,
  ExamQuestion,
  QuestionDifficulty,
  QuestionOption,
  QuestionStatus,
  QuestionType
} from '../types';

/**
 * BANCO DE QUESTÕES / EXAMES — regras de negócio (sem React nem Firebase).
 *
 * Questão (banco) → Prova (montada a partir do banco). Uma Prova publicada
 * guarda uma cópia congelada de cada questão, por isso editar o banco depois
 * nunca altera uma prova que já foi impressa/aplicada.
 */

export const QUESTION_TYPE_META: Record<QuestionType, { label: string; icon: string; hint: string }> = {
  escolha_multipla: {
    label: 'Escolha Múltipla',
    icon: 'checklist',
    hint: '2 a 6 alternativas, com exatamente uma correta.'
  },
  verdadeiro_falso: { label: 'Verdadeiro / Falso', icon: 'rule', hint: 'Afirmação a classificar como V ou F.' },
  resposta_curta: { label: 'Resposta Curta', icon: 'short_text', hint: 'Resposta de uma palavra, número ou frase.' },
  desenvolvimento: { label: 'Desenvolvimento', icon: 'notes', hint: 'Resposta extensa, corrigida por critérios.' }
};

export const DIFFICULTY_META: Record<QuestionDifficulty, { label: string; badge: string }> = {
  facil: { label: 'Fácil', badge: 'bg-emerald-100 text-emerald-800' },
  media: { label: 'Média', badge: 'bg-amber-100 text-amber-800' },
  dificil: { label: 'Difícil', badge: 'bg-red-100 text-red-800' }
};

export const QUESTION_STATUS_META: Record<QuestionStatus, { label: string; badge: string }> = {
  rascunho: { label: 'Rascunho', badge: 'bg-slate-200 text-slate-700' },
  aprovada: { label: 'Aprovada', badge: 'bg-emerald-100 text-emerald-800' },
  arquivada: { label: 'Arquivada', badge: 'bg-slate-100 text-slate-500' }
};

export const EXAM_PAPER_TYPE_LABELS: Record<ExamPaperType, string> = {
  teste: 'Teste de Avaliação',
  prova_trimestral: 'Prova Trimestral',
  exame_recurso: 'Exame de Recurso',
  exame_final: 'Exame Final',
  exame_acesso: 'Exame de Acesso / Admissão'
};

export const EXAM_STATUS_META = {
  rascunho: { label: 'Rascunho', badge: 'bg-slate-200 text-slate-700' },
  publicada: { label: 'Publicada', badge: 'bg-emerald-100 text-emerald-800' },
  arquivada: { label: 'Arquivada', badge: 'bg-slate-100 text-slate-500' }
} as const;

/** Escala angolana: as provas somam 20 valores. */
export const DEFAULT_TARGET_POINTS = 20;

const POINTS_EPSILON = 0.005;

export function normalizeText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 1,5 (pt-PT); inteiros sem casas decimais. */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString().replace('.', ',');
}

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface QuestionDraft {
  subjectName: string;
  grade: string;
  type: QuestionType;
  statement: string;
  options?: QuestionOption[];
  correctBoolean?: boolean | null;
  expectedAnswer?: string;
  defaultPoints: number;
}

/** Devolve a lista de erros (vazia = válida). */
export function validateQuestion(q: QuestionDraft): string[] {
  const errors: string[] = [];
  if (!q.subjectName.trim()) errors.push('Escolha a disciplina.');
  if (!q.grade.trim()) errors.push('Escolha a classe.');
  if (q.statement.trim().length < 5) errors.push('Escreva o enunciado da questão.');
  if (!Number.isFinite(q.defaultPoints) || q.defaultPoints <= 0 || q.defaultPoints > 20) {
    errors.push('A cotação sugerida deve estar entre 0,25 e 20 valores.');
  }

  if (q.type === 'escolha_multipla') {
    const filled = (q.options || []).filter((o) => o.text.trim());
    if (filled.length < 2) errors.push('A escolha múltipla precisa de pelo menos 2 alternativas preenchidas.');
    if (filled.length > 6) errors.push('A escolha múltipla admite no máximo 6 alternativas.');
    const correct = filled.filter((o) => o.isCorrect).length;
    if (correct !== 1) errors.push('Marque exatamente uma alternativa como correta.');
    const texts = filled.map((o) => normalizeText(o.text));
    if (new Set(texts).size !== texts.length) errors.push('Existem alternativas repetidas.');
  }

  if (q.type === 'verdadeiro_falso' && typeof q.correctBoolean !== 'boolean') {
    errors.push('Indique se a afirmação é Verdadeira ou Falsa.');
  }

  if ((q.type === 'resposta_curta' || q.type === 'desenvolvimento') && !(q.expectedAnswer || '').trim()) {
    errors.push(
      q.type === 'resposta_curta'
        ? 'Indique a resposta esperada.'
        : 'Indique os critérios de correção / resposta modelo.'
    );
  }
  return errors;
}

/** Remove alternativas vazias e garante ids estáveis. */
export function cleanOptions(options: QuestionOption[] = []): QuestionOption[] {
  return options
    .filter((o) => o.text.trim())
    .map((o, i) => ({ id: o.id || `opt-${i + 1}`, text: o.text.trim(), isCorrect: !!o.isCorrect }));
}

export function sumPoints(items: Array<Pick<ExamPaperItem, 'points'>>): number {
  return roundPoints(items.reduce((sum, i) => sum + (Number(i.points) || 0), 0));
}

export function pointsMatchTarget(items: Array<Pick<ExamPaperItem, 'points'>>, target: number): boolean {
  return Math.abs(sumPoints(items) - target) < POINTS_EPSILON;
}

/**
 * Reescala as cotações, mantendo as proporções, para somarem exatamente `target`.
 * Se todas forem 0, distribui por igual. A diferença de arredondamento (cêntimos
 * de valor) vai para a questão de maior cotação.
 */
export function distributePoints<T extends Pick<ExamPaperItem, 'points'>>(items: T[], target: number): T[] {
  if (items.length === 0) return items;
  const weights = items.map((i) => (Number(i.points) > 0 ? Number(i.points) : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const base = totalWeight > 0 ? weights : items.map(() => 1);
  const baseTotal = base.reduce((a, b) => a + b, 0);

  const scaled = base.map((w) => roundPoints((w * target) / baseTotal));
  const diff = roundPoints(target - scaled.reduce((a, b) => a + b, 0));
  if (Math.abs(diff) >= POINTS_EPSILON) {
    let biggest = 0;
    scaled.forEach((v, i) => {
      if (v > scaled[biggest]) biggest = i;
    });
    scaled[biggest] = roundPoints(scaled[biggest] + diff);
  }
  return items.map((item, i) => ({ ...item, points: scaled[i] }));
}

export interface AutoSelectRequest {
  facil: number;
  media: number;
  dificil: number;
}

export interface AutoSelectResult {
  selected: ExamQuestion[];
  /** Quantas questões faltam por dificuldade (o banco não tem suficientes). */
  shortfall: AutoSelectRequest;
}

/**
 * Escolhe questões ao acaso do banco, respeitando a quantidade pedida por
 * dificuldade e ignorando as já usadas na prova. `random` é injetável (testes).
 */
export function autoSelectQuestions(
  pool: ExamQuestion[],
  request: AutoSelectRequest,
  excludeIds: string[] = [],
  random: () => number = Math.random
): AutoSelectResult {
  const excluded = new Set(excludeIds);
  const shuffle = <T,>(list: T[]): T[] => {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const selected: ExamQuestion[] = [];
  const shortfall: AutoSelectRequest = { facil: 0, media: 0, dificil: 0 };
  (['facil', 'media', 'dificil'] as QuestionDifficulty[]).forEach((level) => {
    const wanted = Math.max(0, Math.floor(request[level] || 0));
    const candidates = shuffle(pool.filter((q) => q.difficulty === level && !excluded.has(q.id)));
    const picked = candidates.slice(0, wanted);
    selected.push(...picked);
    shortfall[level] = wanted - picked.length;
  });
  return { selected, shortfall };
}

/**
 * Questão a mostrar/imprimir para um item da prova. Provas publicadas usam a
 * cópia congelada; rascunhos usam sempre a versão atual do banco.
 */
export function resolveItemQuestion(
  item: ExamPaperItem,
  questionsById: Map<string, ExamQuestion>,
  paperStatus: ExamPaper['status']
): ExamQuestion | undefined {
  if (paperStatus !== 'rascunho' && item.snapshot) return item.snapshot;
  return questionsById.get(item.questionId) || item.snapshot;
}

export interface PublishCheckInput {
  title: string;
  subjectName: string;
  grade: string;
  durationMinutes: number;
  targetPoints: number;
  items: ExamPaperItem[];
}

/** Problemas que impedem publicar a prova (vazio = pode publicar). */
export function validatePaperForPublish(
  paper: PublishCheckInput,
  questionsById: Map<string, ExamQuestion>
): string[] {
  const problems: string[] = [];
  if (!paper.title.trim()) problems.push('A prova não tem título.');
  if (!paper.subjectName.trim() || !paper.grade.trim()) problems.push('Indique a disciplina e a classe da prova.');
  if (!Number.isFinite(paper.durationMinutes) || paper.durationMinutes < 5) {
    problems.push('Indique a duração da prova (mínimo 5 minutos).');
  }
  if (paper.items.length === 0) problems.push('A prova não tem questões.');

  const missing = paper.items.filter((i) => !questionsById.has(i.questionId)).length;
  if (missing > 0) problems.push(`${missing} questão(ões) já não existem no banco — remova-as da prova.`);

  const unapproved = paper.items.filter((i) => {
    const q = questionsById.get(i.questionId);
    return q && q.status !== 'aprovada';
  }).length;
  if (unapproved > 0) {
    problems.push(`${unapproved} questão(ões) ainda não estão aprovadas — só questões aprovadas entram numa prova publicada.`);
  }

  if (paper.items.some((i) => !(Number(i.points) > 0))) {
    problems.push('Todas as questões precisam de uma cotação superior a 0.');
  }
  if (!pointsMatchTarget(paper.items, paper.targetPoints)) {
    problems.push(
      `As cotações somam ${formatPoints(sumPoints(paper.items))} valores; a prova deve somar ${formatPoints(paper.targetPoints)}.`
    );
  }
  return problems;
}

export interface PaperStats {
  total: number;
  byType: Record<QuestionType, number>;
  byDifficulty: Record<QuestionDifficulty, number>;
  points: number;
}

export function paperStats(paper: Pick<ExamPaper, 'items' | 'status'>, questionsById: Map<string, ExamQuestion>): PaperStats {
  const byType: Record<QuestionType, number> = {
    escolha_multipla: 0,
    verdadeiro_falso: 0,
    resposta_curta: 0,
    desenvolvimento: 0
  };
  const byDifficulty: Record<QuestionDifficulty, number> = { facil: 0, media: 0, dificil: 0 };
  for (const item of paper.items) {
    const q = resolveItemQuestion(item, questionsById, paper.status);
    if (!q) continue;
    byType[q.type] += 1;
    byDifficulty[q.difficulty] += 1;
  }
  return { total: paper.items.length, byType, byDifficulty, points: sumPoints(paper.items) };
}

/** Quantas provas (qualquer estado) usam esta questão. */
export function countQuestionUsage(questionId: string, papers: ExamPaper[]): number {
  return papers.filter((p) => p.items.some((i) => i.questionId === questionId)).length;
}

export interface QuestionVisibilityContext {
  userId: string;
  /** Admin/Direção: veem e gerem todo o banco. */
  canSeeAll: boolean;
  /** Disciplinas (normalizadas) do docente; null quando não se aplica. */
  subjectKeys: Set<string> | null;
}

/**
 * Confidencialidade do banco: um docente vê as suas próprias questões e as
 * questões aprovadas das disciplinas que leciona — nunca rascunhos de colegas.
 */
export function canViewQuestion(q: ExamQuestion, ctx: QuestionVisibilityContext): boolean {
  if (ctx.canSeeAll) return true;
  if (q.authorId === ctx.userId) return true;
  if (q.status !== 'aprovada') return false;
  return !!ctx.subjectKeys && ctx.subjectKeys.has(normalizeText(q.subjectName));
}

/** Mesma lógica para as provas: o docente vê as suas e as publicadas das suas disciplinas. */
export function canViewPaper(p: ExamPaper, ctx: QuestionVisibilityContext): boolean {
  if (ctx.canSeeAll) return true;
  if (p.authorId === ctx.userId) return true;
  if (p.status !== 'publicada') return false;
  return !!ctx.subjectKeys && ctx.subjectKeys.has(normalizeText(p.subjectName));
}

/** Tipos de prova que só quem aprova (Direção/Administração) pode publicar. */
export const RESTRICTED_PAPER_TYPES: ExamPaperType[] = ['exame_recurso', 'exame_final', 'exame_acesso'];

export function paperTypeNeedsApproval(type: ExamPaperType): boolean {
  return RESTRICTED_PAPER_TYPES.includes(type);
}

/** Código sequencial por ano letivo: PROVA-2026/2027-0001. Nunca repete. */
export function generateExamPaperCode(academicYear: string, existingCodes: Array<string | undefined> = []): string {
  const prefix = `PROVA-${academicYear}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Quatro alternativas vazias, para o formulário de escolha múltipla. */
export function emptyOptions(count = 4): QuestionOption[] {
  return Array.from({ length: count }, (_, i) => ({ id: `opt-${i + 1}`, text: '', isCorrect: false }));
}

/**
 * Normaliza uma questão antes de a gravar: só mantém os campos que fazem
 * sentido para o tipo (uma questão V/F não deve arrastar alternativas antigas
 * de quando era escolha múltipla, por exemplo).
 */
export function normalizeQuestionFields<T extends QuestionDraft>(q: T): T {
  const base = { ...q, statement: q.statement.trim(), subjectName: q.subjectName.trim(), grade: q.grade.trim() };
  if (q.type === 'escolha_multipla') {
    return { ...base, options: cleanOptions(q.options), correctBoolean: undefined, expectedAnswer: undefined };
  }
  if (q.type === 'verdadeiro_falso') {
    return { ...base, options: undefined, correctBoolean: q.correctBoolean, expectedAnswer: undefined };
  }
  return {
    ...base,
    options: undefined,
    correctBoolean: undefined,
    expectedAnswer: (q.expectedAnswer || '').trim()
  };
}

/** Código sequencial da questão: QST-0001. Nunca repete. */
export function generateQuestionCode(existingCodes: Array<string | undefined> = []): string {
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith('QST-')) continue;
    const n = parseInt(code.slice(4), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `QST-${String(max + 1).padStart(4, '0')}`;
}
