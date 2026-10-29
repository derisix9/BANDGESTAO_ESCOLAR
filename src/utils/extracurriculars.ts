import {
  ActivityAttendanceStatus,
  ActivityCategory,
  ActivityEnrollment,
  ActivityEnrollmentStatus,
  ActivityScheduleSlot,
  ActivityStatus,
  ExtracurricularActivity,
  Student,
  TimetableEntry,
  Weekday
} from '../types';
import { isoToDate } from './academicCalendar';
import { normalizeGradeKey } from './educationSubsystems';

/**
 * ATIVIDADES EXTRACURRICULARES — regras de negócio (sem React nem Firebase).
 *
 * Atividade (por ano letivo) → Inscrições dos alunos → Sessões com presenças.
 *
 *   Planeada → Inscrições Abertas → Em Curso → Encerrada        (Cancelada: de qualquer estado não final)
 *
 * • Só se inscreve com a atividade em "Inscrições Abertas" ou "Em Curso".
 * • Sem vaga, a inscrição entra em Lista de Espera (nunca ultrapassa a capacidade).
 * • É obrigatória a autorização do encarregado de educação.
 * • Um aluno não pode estar em duas atividades sobrepostas; o mesmo espaço e o
 *   mesmo coordenador também não podem estar em dois sítios ao mesmo tempo.
 * • Presenças só se registam com a atividade Em Curso, em datas que já passaram.
 */

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado'
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb'
};

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6];

const TIMETABLE_DAY_TO_WEEKDAY: Record<string, Weekday> = {
  'segunda-feira': 1,
  'terça-feira': 2,
  'terca-feira': 2,
  'quarta-feira': 3,
  'quinta-feira': 4,
  'sexta-feira': 5
};

export const CATEGORY_META: Record<ActivityCategory, { label: string; icon: string; badge: string }> = {
  desporto: { label: 'Desporto', icon: 'sports_soccer', badge: 'bg-emerald-100 text-emerald-800' },
  artes: { label: 'Artes Plásticas & Teatro', icon: 'palette', badge: 'bg-pink-100 text-pink-800' },
  musica_danca: { label: 'Música & Dança', icon: 'music_note', badge: 'bg-violet-100 text-violet-800' },
  ciencia_tecnologia: { label: 'Ciência & Tecnologia', icon: 'science', badge: 'bg-blue-100 text-blue-800' },
  linguas_leitura: { label: 'Línguas & Leitura', icon: 'menu_book', badge: 'bg-amber-100 text-amber-800' },
  cidadania: { label: 'Cidadania & Voluntariado', icon: 'volunteer_activism', badge: 'bg-teal-100 text-teal-800' },
  outra: { label: 'Outra', icon: 'interests', badge: 'bg-slate-200 text-slate-700' }
};

export const ACTIVITY_STATUS_META: Record<
  ActivityStatus,
  { label: string; icon: string; badge: string; acceptsEnrollments: boolean; final: boolean }
> = {
  planeada: { label: 'Planeada', icon: 'event_note', badge: 'bg-slate-200 text-slate-700', acceptsEnrollments: false, final: false },
  inscricoes_abertas: {
    label: 'Inscrições Abertas',
    icon: 'how_to_reg',
    badge: 'bg-blue-100 text-blue-800',
    acceptsEnrollments: true,
    final: false
  },
  em_curso: { label: 'Em Curso', icon: 'play_circle', badge: 'bg-emerald-100 text-emerald-800', acceptsEnrollments: true, final: false },
  encerrada: { label: 'Encerrada', icon: 'task_alt', badge: 'bg-slate-100 text-slate-500', acceptsEnrollments: false, final: true },
  cancelada: { label: 'Cancelada', icon: 'cancel', badge: 'bg-red-100 text-red-800', acceptsEnrollments: false, final: true }
};

export const ACTIVITY_STATUS_ORDER: ActivityStatus[] = ['planeada', 'inscricoes_abertas', 'em_curso', 'encerrada', 'cancelada'];

const ACTIVITY_TRANSITIONS: Record<ActivityStatus, ActivityStatus[]> = {
  planeada: ['inscricoes_abertas', 'em_curso', 'cancelada'],
  inscricoes_abertas: ['em_curso', 'cancelada'],
  em_curso: ['encerrada', 'cancelada'],
  encerrada: [],
  cancelada: []
};

export function allowedActivityTransitions(from: ActivityStatus): ActivityStatus[] {
  return ACTIVITY_TRANSITIONS[from] || [];
}

export function canTransitionActivity(from: ActivityStatus, to: ActivityStatus): boolean {
  return allowedActivityTransitions(from).includes(to);
}

export const ENROLLMENT_STATUS_META: Record<ActivityEnrollmentStatus, { label: string; badge: string }> = {
  ativa: { label: 'Inscrito', badge: 'bg-emerald-100 text-emerald-800' },
  lista_espera: { label: 'Lista de Espera', badge: 'bg-amber-100 text-amber-800' },
  concluida: { label: 'Concluída', badge: 'bg-slate-200 text-slate-700' },
  cancelada: { label: 'Cancelada', badge: 'bg-slate-100 text-slate-500' }
};

export const ATTENDANCE_META: Record<ActivityAttendanceStatus, { label: string; badge: string }> = {
  P: { label: 'Presente', badge: 'bg-emerald-100 text-emerald-800' },
  FJ: { label: 'Falta justificada', badge: 'bg-amber-100 text-amber-800' },
  FI: { label: 'Falta injustificada', badge: 'bg-red-100 text-red-800' }
};

// ---------------------------------------------------------------------------
// Tempo e períodos
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value?: string): boolean {
  return !!value && TIME_RE.test(value);
}

export function toMinutes(value: string): number {
  const m = TIME_RE.exec(value || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function slotsOverlap(a: ActivityScheduleSlot, b: ActivityScheduleSlot): boolean {
  if (a.weekday !== b.weekday) return false;
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

export function formatSlot(slot: ActivityScheduleSlot): string {
  return `${WEEKDAY_SHORT[slot.weekday]} ${slot.start}–${slot.end}`;
}

export function formatSchedule(schedule: ActivityScheduleSlot[] | undefined): string {
  const list = schedule || [];
  return list.length ? list.map(formatSlot).join(' · ') : 'Sem horário';
}

/** Períodos sem datas valem para o ano inteiro; só se separam se ambos tiverem datas que não se tocam. */
export function periodsOverlap(
  a: { startDate?: string; endDate?: string },
  b: { startDate?: string; endDate?: string }
): boolean {
  const aStart = a.startDate || '0000-01-01';
  const aEnd = a.endDate || '9999-12-31';
  const bStart = b.startDate || '0000-01-01';
  const bEnd = b.endDate || '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}

const datePart = (iso?: string) => (iso || '').slice(0, 10);

// ---------------------------------------------------------------------------
// Validação da atividade
// ---------------------------------------------------------------------------

export type ActivityInput = Omit<
  ExtracurricularActivity,
  'id' | 'code' | 'status' | 'enrollments' | 'sessions' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'
>;

export const MAX_CAPACITY = 500;

const clean = (v?: string) => {
  const t = (v || '').trim();
  return t ? t : undefined;
};

export function normalizeActivityFields(input: ActivityInput): ActivityInput {
  const capacityNumber = Number(String(input.capacity ?? '').replace(',', '.'));
  return {
    name: (input.name || '').trim(),
    category: input.category,
    description: clean(input.description),
    academicYear: (input.academicYear || '').trim(),
    coordinatorId: input.coordinatorId || undefined,
    coordinatorName: (input.coordinatorName || '').trim(),
    venue: (input.venue || '').trim(),
    schedule: (input.schedule || []).map((s) => ({ weekday: Number(s.weekday) as Weekday, start: s.start, end: s.end })),
    startDate: clean(input.startDate),
    endDate: clean(input.endDate),
    capacity: Number.isFinite(capacityNumber) ? Math.floor(capacityNumber) : 0,
    allowedGrades: (input.allowedGrades || []).filter(Boolean)
  };
}

export function validateActivity(input: ActivityInput): string[] {
  const errors: string[] = [];
  if (!input.name || input.name.length < 3) errors.push('Indique o nome da atividade (mínimo 3 letras).');
  if (!input.category || !CATEGORY_META[input.category]) errors.push('Selecione a categoria.');
  if (!input.academicYear) errors.push('Indique o ano letivo.');
  if (!input.coordinatorName) errors.push('Indique o coordenador / monitor responsável.');
  if (!input.venue) errors.push('Indique o local da atividade.');
  if (!input.capacity || input.capacity < 1) errors.push('A capacidade tem de ser de pelo menos 1 aluno.');
  else if (input.capacity > MAX_CAPACITY) errors.push(`A capacidade não pode passar de ${MAX_CAPACITY} alunos.`);

  if (!input.schedule || input.schedule.length === 0) {
    errors.push('Adicione pelo menos um horário (dia e hora).');
  } else {
    input.schedule.forEach((s, i) => {
      const n = i + 1;
      if (!WEEKDAYS.includes(s.weekday)) errors.push(`Horário ${n}: dia da semana inválido.`);
      else if (!isValidTime(s.start) || !isValidTime(s.end)) errors.push(`Horário ${n}: indique a hora de início e de fim.`);
      else if (toMinutes(s.end) <= toMinutes(s.start)) errors.push(`Horário ${n}: a hora de fim tem de ser depois da de início.`);
    });
    const valid = input.schedule.filter((s) => WEEKDAYS.includes(s.weekday) && isValidTime(s.start) && isValidTime(s.end));
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        if (slotsOverlap(valid[i], valid[j])) {
          errors.push(`Os horários ${formatSlot(valid[i])} e ${formatSlot(valid[j])} sobrepõem-se.`);
        }
      }
    }
  }

  if (input.startDate && !isoToDate(input.startDate)) errors.push('Data de início inválida.');
  if (input.endDate && !isoToDate(input.endDate)) errors.push('Data de fim inválida.');
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    errors.push('A data de fim não pode ser anterior à de início.');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Conflitos de espaço e de coordenador
// ---------------------------------------------------------------------------

export interface ResourceConflict {
  kind: 'local' | 'coordenador';
  other: ExtracurricularActivity;
  slot: ActivityScheduleSlot;
}

const sameText = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') ===
    b.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Atividades que já ocupam o mesmo local ou o mesmo coordenador à mesma hora. */
export function findResourceConflicts(
  candidate: Pick<ExtracurricularActivity, 'academicYear' | 'venue' | 'coordinatorId' | 'coordinatorName' | 'schedule' | 'startDate' | 'endDate'>,
  others: ExtracurricularActivity[],
  ignoreId?: string
): ResourceConflict[] {
  const out: ResourceConflict[] = [];
  for (const other of others) {
    if (other.id === ignoreId) continue;
    if (other.academicYear !== candidate.academicYear) continue;
    if (ACTIVITY_STATUS_META[other.status].final) continue;
    if (!periodsOverlap(candidate, other)) continue;

    const sameVenue = sameText(candidate.venue, other.venue);
    const sameCoordinator =
      (!!candidate.coordinatorId && candidate.coordinatorId === other.coordinatorId) ||
      sameText(candidate.coordinatorName, other.coordinatorName);
    if (!sameVenue && !sameCoordinator) continue;

    for (const mine of candidate.schedule || []) {
      for (const theirs of other.schedule || []) {
        if (!slotsOverlap(mine, theirs)) continue;
        if (sameVenue) out.push({ kind: 'local', other, slot: theirs });
        if (sameCoordinator) out.push({ kind: 'coordenador', other, slot: theirs });
      }
    }
  }
  return out;
}

export function describeResourceConflict(c: ResourceConflict): string {
  const what = c.kind === 'local' ? 'O local já está ocupado' : 'O coordenador já está ocupado';
  return `${what} por «${c.other.name}» (${c.other.code}) — ${formatSlot(c.slot)}.`;
}

// ---------------------------------------------------------------------------
// Inscrições
// ---------------------------------------------------------------------------

export const isActiveEnrollment = (e: ActivityEnrollment) => e.status === 'ativa';
export const isLiveEnrollment = (e: ActivityEnrollment) => e.status === 'ativa' || e.status === 'lista_espera';

export function activeEnrollments(activity: Pick<ExtracurricularActivity, 'enrollments'>): ActivityEnrollment[] {
  return (activity.enrollments || []).filter(isActiveEnrollment);
}

export function waitlist(activity: Pick<ExtracurricularActivity, 'enrollments'>): ActivityEnrollment[] {
  return (activity.enrollments || [])
    .filter((e) => e.status === 'lista_espera')
    .sort((a, b) => a.enrolledAt.localeCompare(b.enrolledAt));
}

export function vacancies(activity: Pick<ExtracurricularActivity, 'enrollments' | 'capacity'>): number {
  return Math.max(0, (activity.capacity || 0) - activeEnrollments(activity).length);
}

export function isGradeAllowed(activity: Pick<ExtracurricularActivity, 'allowedGrades'>, grade?: string): boolean {
  const allowed = activity.allowedGrades || [];
  if (allowed.length === 0) return true;
  const key = normalizeGradeKey(grade || '');
  return !!key && allowed.some((g) => normalizeGradeKey(g) === key);
}

/** Conflitos do aluno com OUTRAS atividades em que já está inscrito (ou em espera). */
export function findStudentActivityConflicts(
  studentId: string,
  candidate: Pick<ExtracurricularActivity, 'id' | 'academicYear' | 'schedule' | 'startDate' | 'endDate'>,
  all: ExtracurricularActivity[]
): Array<{ other: ExtracurricularActivity; slot: ActivityScheduleSlot }> {
  const out: Array<{ other: ExtracurricularActivity; slot: ActivityScheduleSlot }> = [];
  for (const other of all) {
    if (other.id === candidate.id) continue;
    if (other.academicYear !== candidate.academicYear) continue;
    if (ACTIVITY_STATUS_META[other.status].final) continue;
    if (!(other.enrollments || []).some((e) => e.studentId === studentId && isLiveEnrollment(e))) continue;
    if (!periodsOverlap(candidate, other)) continue;
    for (const mine of candidate.schedule || []) {
      for (const theirs of other.schedule || []) {
        if (slotsOverlap(mine, theirs)) out.push({ other, slot: theirs });
      }
    }
  }
  return out;
}

/** Aulas da turma do aluno que coincidem com o horário da atividade (apenas aviso). */
export function findTimetableClashes(
  student: Pick<Student, 'classId'>,
  schedule: ActivityScheduleSlot[],
  timetable: TimetableEntry[]
): TimetableEntry[] {
  if (!student.classId) return [];
  const out: TimetableEntry[] = [];
  for (const entry of timetable || []) {
    if (entry.classId !== student.classId) continue;
    const weekday = TIMETABLE_DAY_TO_WEEKDAY[(entry.dayOfWeek || '').toLowerCase()];
    if (!weekday || !isValidTime(entry.timeStart) || !isValidTime(entry.timeEnd)) continue;
    const lesson: ActivityScheduleSlot = { weekday, start: entry.timeStart, end: entry.timeEnd };
    if ((schedule || []).some((slot) => slotsOverlap(slot, lesson))) out.push(entry);
  }
  return out;
}

export interface EnrollmentCheck {
  errors: string[];
  warnings: string[];
  /** Sem vaga: a inscrição entra em lista de espera. */
  waitlisted: boolean;
}

export function checkEnrollment(
  activity: ExtracurricularActivity,
  student: Student | undefined,
  ctx: { activities: ExtracurricularActivity[]; timetable?: TimetableEntry[] }
): EnrollmentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!student) return { errors: ['Selecione o aluno.'], warnings, waitlisted: false };

  if (!ACTIVITY_STATUS_META[activity.status].acceptsEnrollments) {
    errors.push(`A atividade está «${ACTIVITY_STATUS_META[activity.status].label}» — não aceita inscrições.`);
  }
  if (student.status !== 'active') errors.push('Só alunos com matrícula ativa se podem inscrever.');
  if (!isGradeAllowed(activity, student.grade)) {
    errors.push(`Esta atividade é para: ${(activity.allowedGrades || []).join(', ')}. O aluno é de ${student.grade || 'classe não definida'}.`);
  }
  const existing = (activity.enrollments || []).find((e) => e.studentId === student.id && isLiveEnrollment(e));
  if (existing) {
    errors.push(
      existing.status === 'ativa' ? 'O aluno já está inscrito nesta atividade.' : 'O aluno já está na lista de espera desta atividade.'
    );
  }
  for (const c of findStudentActivityConflicts(student.id, activity, ctx.activities)) {
    errors.push(`Horário sobreposto com «${c.other.name}» (${c.other.code}) — ${formatSlot(c.slot)}.`);
  }
  for (const entry of findTimetableClashes(student, activity.schedule, ctx.timetable || [])) {
    warnings.push(`Coincide com a aula de ${entry.subject} (${entry.dayOfWeek}, ${entry.timeStart}–${entry.timeEnd}).`);
  }
  const waitlisted = vacancies(activity) === 0;
  if (waitlisted && errors.length === 0) {
    warnings.push('Sem vagas: a inscrição entra na lista de espera.');
  }
  return { errors, warnings, waitlisted };
}

// ---------------------------------------------------------------------------
// Sessões e presenças
// ---------------------------------------------------------------------------

/** Alunos que podem constar na presença de uma data: inscritos ativos desde essa data. */
export function sessionRoster(activity: Pick<ExtracurricularActivity, 'enrollments' | 'sessions'>, date: string, sessionId?: string): ActivityEnrollment[] {
  const existing = sessionId ? (activity.sessions || []).find((s) => s.id === sessionId) : undefined;
  const inSession = new Set((existing?.entries || []).map((e) => e.studentId));
  return (activity.enrollments || [])
    .filter((e) => inSession.has(e.studentId) || (e.status === 'ativa' && datePart(e.enrolledAt) <= date))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt'));
}

export function validateSessionDate(
  activity: ExtracurricularActivity,
  date: string,
  todayIso: string,
  ignoreSessionId?: string
): string[] {
  const errors: string[] = [];
  if (!date || !isoToDate(date)) return ['Indique a data da sessão.'];
  if (activity.status !== 'em_curso') errors.push('As presenças só se registam com a atividade «Em Curso».');
  if (date > todayIso) errors.push('Não se pode registar a presença de uma data que ainda não chegou.');
  if (activity.startDate && date < activity.startDate) errors.push('A data é anterior ao início da atividade.');
  if (activity.endDate && date > activity.endDate) errors.push('A data é posterior ao fim da atividade.');
  if ((activity.sessions || []).some((s) => s.date === date && s.id !== ignoreSessionId)) {
    errors.push('Já existe uma sessão registada nesta data — edite-a em vez de criar outra.');
  }
  return errors;
}

export interface AttendanceStats {
  present: number;
  justified: number;
  unjustified: number;
  total: number;
  /** 0–100, inteiro; null quando ainda não há sessões registadas. */
  rate: number | null;
}

export function studentAttendance(activity: Pick<ExtracurricularActivity, 'sessions'>, studentId: string): AttendanceStats {
  let present = 0;
  let justified = 0;
  let unjustified = 0;
  for (const s of activity.sessions || []) {
    const entry = (s.entries || []).find((e) => e.studentId === studentId);
    if (!entry) continue;
    if (entry.status === 'P') present++;
    else if (entry.status === 'FJ') justified++;
    else unjustified++;
  }
  const total = present + justified + unjustified;
  return { present, justified, unjustified, total, rate: total > 0 ? Math.round((present / total) * 100) : null };
}

export interface ActivitySummary {
  active: number;
  waiting: number;
  capacity: number;
  vacancies: number;
  /** 0–100 */
  occupancy: number;
  sessions: number;
  /** Assiduidade média (0–100) ou null sem sessões. */
  attendanceRate: number | null;
}

export function summarizeActivity(activity: ExtracurricularActivity): ActivitySummary {
  const active = activeEnrollments(activity).length;
  const capacity = activity.capacity || 0;
  let present = 0;
  let total = 0;
  for (const s of activity.sessions || []) {
    for (const e of s.entries || []) {
      total++;
      if (e.status === 'P') present++;
    }
  }
  return {
    active,
    waiting: waitlist(activity).length,
    capacity,
    vacancies: Math.max(0, capacity - active),
    occupancy: capacity > 0 ? Math.min(100, Math.round((active / capacity) * 100)) : 0,
    sessions: (activity.sessions || []).length,
    attendanceRate: total > 0 ? Math.round((present / total) * 100) : null
  };
}

/** Alunos distintos com pelo menos uma inscrição ativa nas atividades dadas. */
export function uniqueParticipants(activities: ExtracurricularActivity[]): number {
  const ids = new Set<string>();
  for (const a of activities) for (const e of activeEnrollments(a)) ids.add(e.studentId);
  return ids.size;
}

// ---------------------------------------------------------------------------
// Códigos e exportação
// ---------------------------------------------------------------------------

/** Código sequencial por ano letivo: ATV-2026/2027-0001. Nunca repete. */
export function generateActivityCode(academicYear: string, existingCodes: Array<string | undefined> = []): string {
  const prefix = `ATV-${academicYear}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

export function activitiesToCsv(activities: ExtracurricularActivity[]): string {
  const header = ['Código', 'Atividade', 'Categoria', 'Ano Letivo', 'Estado', 'Coordenador', 'Local', 'Horário', 'Capacidade', 'Inscritos', 'Lista de Espera', 'Sessões', 'Assiduidade %'];
  const rows = activities.map((a) => {
    const s = summarizeActivity(a);
    return [
      a.code,
      a.name,
      CATEGORY_META[a.category]?.label || a.category,
      a.academicYear,
      ACTIVITY_STATUS_META[a.status].label,
      a.coordinatorName,
      a.venue,
      formatSchedule(a.schedule),
      String(a.capacity),
      String(s.active),
      String(s.waiting),
      String(s.sessions),
      s.attendanceRate === null ? '' : String(s.attendanceRate)
    ];
  });
  return toCsv([header, ...rows]);
}

export function participantsToCsv(activity: ExtracurricularActivity): string {
  const header = ['Nº Processo', 'Aluno', 'Classe / Turma', 'Estado', 'Autorização do Encarregado', 'Presenças', 'Faltas Just.', 'Faltas Injust.', 'Assiduidade %'];
  const rows = (activity.enrollments || [])
    .slice()
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt'))
    .map((e) => {
      const st = studentAttendance(activity, e.studentId);
      return [
        e.studentProcNumber,
        e.studentName,
        e.className || e.grade || '',
        ENROLLMENT_STATUS_META[e.status].label,
        e.guardianAuthorized ? 'Sim' : 'Não',
        String(st.present),
        String(st.justified),
        String(st.unjustified),
        st.rate === null ? '' : String(st.rate)
      ];
    });
  return toCsv([header, ...rows]);
}
