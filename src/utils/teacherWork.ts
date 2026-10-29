/**
 * Portal do professor (passo 5): plano de aulas, sumários e materiais.
 * Lógica pura e testável.
 */

/** Ficheiro (PDF, Word ou Excel) anexado a um plano de aulas. Guardado em base64 (data URL). */
export interface LessonPlanAttachment {
  name: string;
  mimeType: string;
  /** Tamanho original em bytes. */
  size: number;
  /** data:<mime>;base64,... */
  dataUrl: string;
}

export const PLAN_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const PLAN_ATTACHMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx'] as const;
export const PLAN_ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function attachmentExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec((name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** Tipo legível do ficheiro anexado: PDF, Word ou Excel. */
export function attachmentKind(name: string): 'PDF' | 'Word' | 'Excel' | 'Ficheiro' {
  const ext = attachmentExtension(name);
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'Word';
  if (ext === 'xls' || ext === 'xlsx') return 'Excel';
  return 'Ficheiro';
}

export function validatePlanAttachment(file: { name: string; size: number }): string | null {
  const ext = attachmentExtension(file.name);
  if (!(PLAN_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) return 'Só são aceites ficheiros PDF, Word (.doc/.docx) ou Excel (.xls/.xlsx).';
  if (!file.size) return 'O ficheiro está vazio.';
  if (file.size > PLAN_ATTACHMENT_MAX_BYTES) return `O ficheiro excede o limite de ${Math.round(PLAN_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`;
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface LessonPlan {
  id: string;
  academicYear: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  subjectName: string;
  trimester: '1' | '2' | '3';
  /** Semana a que se refere: AAAA-MM-DD da segunda-feira. */
  weekStart: string;
  topic: string;
  /** Vazio quando o plano é um ficheiro carregado (ver `attachment`). */
  objectives: string;
  activities: string;
  resources?: string;
  evaluation?: string;
  /** Plano carregado como documento (PDF, Word ou Excel) em vez de preenchido no formulário. */
  attachment?: LessonPlanAttachment;
  status: 'rascunho' | 'submetido' | 'aprovado' | 'devolvido';
  reviewerNote?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonSummaryEntry {
  id: string;
  academicYear: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  subjectName: string;
  /** AAAA-MM-DD */
  date: string;
  /** Nº da aula na sequência da disciplina. */
  lessonNumber: number;
  topic: string;
  summary: string;
  homework?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TeachingMaterial {
  id: string;
  academicYear: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  subjectName: string;
  title: string;
  description?: string;
  /** Ligação http(s) para o ficheiro (Drive, OneDrive…). */
  link: string;
  visibleToStudents: boolean;
  createdAt: string;
}

export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // segunda = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function validateLessonPlan(p: Pick<LessonPlan, 'classId' | 'subjectName' | 'topic' | 'objectives' | 'activities' | 'weekStart'> & { attachment?: LessonPlanAttachment }): string[] {
  const e: string[] = [];
  if (!p.classId) e.push('Escolha a turma.');
  if (!p.subjectName.trim()) e.push('Indique a disciplina.');
  if (!p.weekStart) e.push('Indique a semana.');
  if (!p.topic.trim()) e.push('Indique o tema da aula.');
  if (p.attachment) {
    // Plano em ficheiro: o documento substitui os objetivos e as atividades.
    const err = validatePlanAttachment({ name: p.attachment.name, size: p.attachment.size });
    if (err) e.push(err);
    if (!/^data:[^;,]+;base64,/.test(p.attachment.dataUrl || '')) e.push('O ficheiro não foi carregado corretamente.');
  } else {
    if (!p.objectives.trim()) e.push('Indique os objetivos.');
    if (!p.activities.trim()) e.push('Descreva as atividades.');
  }
  return e;
}

/** Transições permitidas: o professor submete; a direção aprova ou devolve com nota. */
export function planTransition(
  plan: LessonPlan,
  action: 'submeter' | 'aprovar' | 'devolver',
  actor: { name: string; isManager: boolean },
  note?: string
): { ok: true; plan: LessonPlan } | { ok: false; error: string } {
  if (action === 'submeter') {
    if (plan.status !== 'rascunho' && plan.status !== 'devolvido') return { ok: false, error: 'Só se submetem planos em rascunho ou devolvidos.' };
    return { ok: true, plan: { ...plan, status: 'submetido', reviewerNote: undefined } };
  }
  if (!actor.isManager) return { ok: false, error: 'Só a direção/coordenação pode aprovar ou devolver planos.' };
  if (plan.status !== 'submetido') return { ok: false, error: 'O plano não está submetido.' };
  if (action === 'devolver' && !(note || '').trim()) return { ok: false, error: 'Ao devolver, escreva o que deve ser corrigido.' };
  return { ok: true, plan: { ...plan, status: action === 'aprovar' ? 'aprovado' : 'devolvido', reviewerNote: note?.trim() || undefined, reviewedBy: actor.name } };
}

export function validateSummary(s: Pick<LessonSummaryEntry, 'classId' | 'subjectName' | 'date' | 'topic' | 'summary'>): string[] {
  const e: string[] = [];
  if (!s.classId) e.push('Escolha a turma.');
  if (!s.subjectName.trim()) e.push('Indique a disciplina.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) e.push('Indique a data da aula.');
  if (!s.topic.trim()) e.push('Indique o tema.');
  if (s.summary.trim().length < 10) e.push('O sumário é demasiado curto.');
  return e;
}

/** Próximo número de aula para a turma+disciplina. */
export function nextLessonNumber(entries: LessonSummaryEntry[], classId: string, subjectName: string, academicYear: string): number {
  const nums = entries
    .filter((e) => e.classId === classId && e.subjectName === subjectName && e.academicYear === academicYear)
    .map((e) => e.lessonNumber);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

export function validateMaterial(m: Pick<TeachingMaterial, 'classId' | 'title' | 'link' | 'subjectName'>): string[] {
  const e: string[] = [];
  if (!m.classId) e.push('Escolha a turma.');
  if (!m.subjectName.trim()) e.push('Indique a disciplina.');
  if (!m.title.trim()) e.push('Indique o título.');
  try {
    const u = new URL((m.link || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('proto');
  } catch {
    e.push('A ligação tem de começar por http:// ou https://.');
  }
  return e;
}

// ---------------------------------------------------------------------------
// Sumário diário -> Assiduidade (Sumário da Aula · registo legal dos conteúdos)
// ---------------------------------------------------------------------------

function norm(v?: string | null): string {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/** Sumários registados (secção Sumários) para a turma + disciplina + dia, por ordem de aula. */
export function findSummariesForLesson(
  entries: LessonSummaryEntry[] | undefined,
  classId: string,
  subjectName: string,
  date: string
): LessonSummaryEntry[] {
  return (entries || [])
    .filter((e) => String(e.classId) === String(classId) && norm(e.subjectName) === norm(subjectName) && e.date === date)
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
}

/** Texto que aparece em Assiduidade → Sumário da Aula, a partir do que o professor registou em Sumários. */
export function formatSummaryForAttendance(list: LessonSummaryEntry[]): string {
  return list
    .map((e) => {
      const head = `Aula n.º ${e.lessonNumber} • ${e.topic.trim()}`;
      const body = e.summary.trim();
      const tpc = e.homework?.trim() ? `\nTPC: ${e.homework.trim()}` : '';
      return `${head}\n${body}${tpc}`;
    })
    .join('\n\n');
}
