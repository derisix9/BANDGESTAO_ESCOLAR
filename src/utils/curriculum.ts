import { ClassRoom, CurriculumPlan, CurriculumPlanStatus, CurriculumUnit, Subject } from '../types';
import { countSchoolWeeks, isoToDate, trimesterRangeIso, TrimesterSchedulesLike } from './academicCalendar';
import { getCycleForGrade, normalizeGradeKey } from './educationSubsystems';

/**
 * PLANO CURRICULAR & CONTEÚDOS — regras de negócio (sem React nem Firebase).
 *
 * Um Plano é o programa anual de UMA disciplina numa classe, num ano letivo,
 * dividido em unidades por trimestre. Ciclo de vida:
 *
 *   Rascunho → Aprovado (pela Direção) → Arquivado
 *
 * • Só um plano em Rascunho tem a estrutura editável.
 * • Só um plano Aprovado regista tempos leccionados (acompanhamento).
 * • Reabrir um plano aprovado devolve-o a Rascunho, sem perder o que já foi
 *   leccionado, mas a aprovação tem de ser dada outra vez.
 *
 * A carga horária (tempos de 45 min) confronta-se com o calendário REAL das
 * Configurações: tempos por semana × semanas úteis de cada trimestre. Nada é
 * inventado — sem datas configuradas, o aviso simplesmente não aparece.
 */

export type TrimesterKey = '1' | '2' | '3';
export const TRIMESTERS: TrimesterKey[] = ['1', '2', '3'];

export const CURRICULUM_STATUS_META: Record<CurriculumPlanStatus, { label: string; icon: string; badge: string }> = {
  rascunho: { label: 'Rascunho', icon: 'edit_note', badge: 'bg-slate-200 text-slate-700' },
  aprovado: { label: 'Aprovado', icon: 'verified', badge: 'bg-emerald-100 text-emerald-800' },
  arquivado: { label: 'Arquivado', icon: 'inventory_2', badge: 'bg-slate-100 text-slate-500' }
};

export type UnitStatus = 'pendente' | 'em_curso' | 'concluida';

export const UNIT_STATUS_META: Record<UnitStatus, { label: string; badge: string; bar: string }> = {
  pendente: { label: 'Por iniciar', badge: 'bg-slate-200 text-slate-700', bar: 'bg-slate-300' },
  em_curso: { label: 'Em curso', badge: 'bg-blue-100 text-blue-800', bar: 'bg-blue-500' },
  concluida: { label: 'Concluída', badge: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500' }
};

export const TRIMESTER_LABELS: Record<TrimesterKey, string> = {
  '1': '1.º Trimestre',
  '2': '2.º Trimestre',
  '3': '3.º Trimestre'
};

export function normalizeText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inteiro >= 0; qualquer coisa inválida vira 0. */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function unitStatus(unit: Pick<CurriculumUnit, 'plannedLessons' | 'deliveredLessons'>): UnitStatus {
  const planned = toCount(unit.plannedLessons);
  const delivered = toCount(unit.deliveredLessons);
  if (delivered <= 0) return 'pendente';
  if (planned > 0 && delivered >= planned) return 'concluida';
  return 'em_curso';
}

// ---------------------------------------------------------------------------
// Normalização e validação
// ---------------------------------------------------------------------------

export type PlanInput = Omit<
  CurriculumPlan,
  'id' | 'code' | 'status' | 'authorId' | 'authorName' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'approvedBy' | 'approvedAt'
>;

const clean = (v?: string) => {
  const t = (v || '').trim();
  return t ? t : undefined;
};

export function normalizeUnit(u: Partial<CurriculumUnit> & { id?: string }, fallbackId: string): CurriculumUnit {
  const planned = toCount(u.plannedLessons);
  // Não se corta aqui: um "leccionado" acima do "previsto" tem de chegar à
  // validação, que avisa o utilizador — em vez de alterar o valor em silêncio.
  const delivered = toCount(u.deliveredLessons);
  const trimester: TrimesterKey = u.trimester === '2' || u.trimester === '3' ? u.trimester : '1';
  return {
    id: u.id || fallbackId,
    title: (u.title || '').trim(),
    trimester,
    contents: clean(u.contents),
    objectives: clean(u.objectives),
    plannedLessons: planned,
    deliveredLessons: delivered,
    completedAt: planned > 0 && delivered >= planned ? u.completedAt : undefined,
    notes: clean(u.notes)
  };
}

export function normalizePlanFields(input: PlanInput): PlanInput {
  return {
    academicYear: (input.academicYear || '').trim(),
    subjectId: input.subjectId || undefined,
    subjectName: (input.subjectName || '').trim(),
    grade: (input.grade || '').trim(),
    weeklyHours: toCount(input.weeklyHours),
    generalObjectives: clean(input.generalObjectives),
    methodology: clean(input.methodology),
    evaluationCriteria: clean(input.evaluationCriteria),
    bibliography: clean(input.bibliography),
    units: (input.units || []).map((u, i) => normalizeUnit(u, `unit-${Date.now()}-${i}`))
  };
}

/** Erros que impedem GUARDAR (rascunho). */
export function validatePlan(plan: PlanInput): string[] {
  const errors: string[] = [];
  if (!plan.academicYear) errors.push('Indique o ano letivo.');
  if (!plan.subjectName) errors.push('Selecione a disciplina.');
  if (!plan.grade) errors.push('Selecione a classe.');
  if (!plan.weeklyHours || plan.weeklyHours < 1) errors.push('Indique os tempos letivos por semana (mínimo 1).');
  else if (plan.weeklyHours > 20) errors.push('Os tempos letivos por semana não podem passar de 20.');

  (plan.units || []).forEach((u, i) => {
    const n = i + 1;
    if (!u.title) errors.push(`Unidade ${n}: falta o título.`);
    if (!u.plannedLessons || u.plannedLessons < 1) errors.push(`Unidade ${n}: indique os tempos letivos previstos (mínimo 1).`);
    if (u.deliveredLessons > u.plannedLessons) {
      errors.push(`Unidade ${n}: os tempos leccionados (${u.deliveredLessons}) excedem os previstos (${u.plannedLessons}).`);
    }
  });
  return errors;
}

/** Erros que impedem APROVAR (além dos de guardar). */
export function validatePlanForApproval(plan: PlanInput): string[] {
  const errors = validatePlan(plan);
  if ((plan.units || []).length === 0) errors.push('Adicione pelo menos uma unidade antes de aprovar o plano.');
  const missingContents = (plan.units || []).filter((u) => !u.contents).length;
  if (missingContents > 0) {
    errors.push(`${missingContents} unidade(s) sem conteúdos programáticos — preencha-os antes de aprovar.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Progresso
// ---------------------------------------------------------------------------

export interface Progress {
  planned: number;
  delivered: number;
  /** 0–100, inteiro. */
  percent: number;
  units: number;
  completedUnits: number;
}

export function computeProgress(units: CurriculumUnit[]): Progress {
  let planned = 0;
  let delivered = 0;
  let completedUnits = 0;
  for (const u of units) {
    const p = toCount(u.plannedLessons);
    planned += p;
    // Nunca conta mais do que o previsto: um excesso não "compensa" outra unidade.
    delivered += Math.min(toCount(u.deliveredLessons), p);
    if (unitStatus(u) === 'concluida') completedUnits += 1;
  }
  return {
    planned,
    delivered,
    percent: planned > 0 ? Math.round((delivered / planned) * 100) : 0,
    units: units.length,
    completedUnits
  };
}

export function planProgress(plan: Pick<CurriculumPlan, 'units'>): Progress {
  return computeProgress(plan.units || []);
}

export function trimesterProgress(plan: Pick<CurriculumPlan, 'units'>, trimester: TrimesterKey): Progress {
  return computeProgress((plan.units || []).filter((u) => u.trimester === trimester));
}

// ---------------------------------------------------------------------------
// Capacidade do calendário e atrasos
// ---------------------------------------------------------------------------

/** Semanas úteis de cada trimestre, a partir das datas das Configurações. */
export function trimesterWeeks(schedules: TrimesterSchedulesLike | undefined): Record<TrimesterKey, number> {
  const out: Record<TrimesterKey, number> = { '1': 0, '2': 0, '3': 0 };
  if (!schedules) return out;
  (['1', '2', '3'] as TrimesterKey[]).forEach((k) => {
    const range = (schedules as any)[`t${k}`];
    const { startIso, endIso } = trimesterRangeIso(range);
    const computed = countSchoolWeeks(startIso, endIso);
    out[k] = computed > 0 ? computed : Number(range?.weeksCountNumber) > 0 ? Number(range.weeksCountNumber) : 0;
  });
  return out;
}

export interface CapacityRow {
  trimester: TrimesterKey;
  weeks: number;
  capacity: number;
  planned: number;
  over: boolean;
}

/** Tempos previstos vs. tempos que o calendário permite, por trimestre. */
export function capacityByTrimester(
  units: CurriculumUnit[],
  weeklyHours: number,
  schedules: TrimesterSchedulesLike | undefined
): CapacityRow[] {
  const weeks = trimesterWeeks(schedules);
  return TRIMESTERS.map((t) => {
    const planned = units.filter((u) => u.trimester === t).reduce((sum, u) => sum + toCount(u.plannedLessons), 0);
    const capacity = weeks[t] * toCount(weeklyHours);
    return { trimester: t, weeks: weeks[t], capacity, planned, over: capacity > 0 && planned > capacity };
  });
}

export function capacityWarnings(
  units: CurriculumUnit[],
  weeklyHours: number,
  schedules: TrimesterSchedulesLike | undefined
): string[] {
  return capacityByTrimester(units, weeklyHours, schedules)
    .filter((r) => r.over)
    .map(
      (r) =>
        `${TRIMESTER_LABELS[r.trimester]}: ${r.planned} tempos previstos para uma capacidade de ${r.capacity} (${r.weeks} semanas × ${weeklyHours}).`
    );
}

export interface DelayedUnit {
  unit: CurriculumUnit;
  missing: number;
}

/** Unidades de trimestres já terminados que ficaram por concluir. */
export function delayedUnits(
  plan: Pick<CurriculumPlan, 'units' | 'status'>,
  schedules: TrimesterSchedulesLike | undefined,
  todayIso: string
): DelayedUnit[] {
  if (plan.status !== 'aprovado' || !schedules) return [];
  const today = isoToDate(todayIso);
  if (!today) return [];
  const ended = new Set<TrimesterKey>();
  (['1', '2', '3'] as TrimesterKey[]).forEach((k) => {
    const end = isoToDate(trimesterRangeIso((schedules as any)[`t${k}`]).endIso);
    if (end && today.getTime() > end.getTime()) ended.add(k);
  });
  return (plan.units || [])
    .filter((u) => ended.has(u.trimester) && unitStatus(u) !== 'concluida')
    .map((u) => ({ unit: u, missing: Math.max(0, toCount(u.plannedLessons) - toCount(u.deliveredLessons)) }));
}

// ---------------------------------------------------------------------------
// Duplicados, códigos e cobertura
// ---------------------------------------------------------------------------

/** Um plano ativo (não arquivado) por disciplina + classe + ano letivo. */
export function findDuplicatePlan(
  plans: CurriculumPlan[],
  key: { academicYear: string; subjectName: string; grade: string },
  ignoreId?: string
): CurriculumPlan | undefined {
  return plans.find(
    (p) =>
      p.id !== ignoreId &&
      p.status !== 'arquivado' &&
      p.academicYear === key.academicYear &&
      normalizeText(p.subjectName) === normalizeText(key.subjectName) &&
      normalizeGradeKey(p.grade) === normalizeGradeKey(key.grade)
  );
}

/** Código sequencial por ano letivo: PLC-2026/2027-0001. Nunca repete. */
export function generatePlanCode(academicYear: string, existingCodes: Array<string | undefined> = []): string {
  const prefix = `PLC-${academicYear}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith(prefix)) continue;
    const n = parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export interface CoverageTarget {
  subject: Subject;
  grade: string;
}

/**
 * Pares (disciplina, classe) que DEVERIAM ter plano: cada disciplina aplica-se
 * às classes do seu ciclo que têm turma no ano letivo. Só usa dados reais
 * (turmas e disciplinas cadastradas).
 */
export function expectedCoverage(classes: ClassRoom[], subjects: Subject[], academicYear: string): CoverageTarget[] {
  const grades = new Map<string, string>();
  for (const c of classes) {
    if (c.academicYear && c.academicYear !== academicYear) continue;
    if (!c.grade) continue;
    const key = normalizeGradeKey(c.grade);
    if (!grades.has(key)) grades.set(key, c.grade);
  }
  const out: CoverageTarget[] = [];
  for (const grade of grades.values()) {
    const cycle = normalizeText(getCycleForGrade(grade));
    for (const subject of subjects) {
      // Disciplinas sem ciclo (novo modelo) aplicam-se a todos os níveis de ensino.
      if (subject.cycle && normalizeText(subject.cycle) !== cycle) continue;
      out.push({ subject, grade });
    }
  }
  return out.sort(
    (a, b) => a.grade.localeCompare(b.grade, 'pt', { numeric: true }) || a.subject.name.localeCompare(b.subject.name, 'pt')
  );
}

export function missingCoverage(targets: CoverageTarget[], plans: CurriculumPlan[], academicYear: string): CoverageTarget[] {
  return targets.filter(
    (t) => !findDuplicatePlan(plans, { academicYear, subjectName: t.subject.name, grade: t.grade })
  );
}

/**
 * Base para copiar um plano para outro ano letivo/classe: mantém estrutura e
 * conteúdos, zera o progresso e remove as datas de conclusão.
 */
export function clonePlanInput(plan: CurriculumPlan, target: { academicYear: string; grade: string }): PlanInput {
  const stamp = Date.now();
  return {
    academicYear: target.academicYear,
    subjectId: plan.subjectId,
    subjectName: plan.subjectName,
    grade: target.grade,
    weeklyHours: plan.weeklyHours,
    generalObjectives: plan.generalObjectives,
    methodology: plan.methodology,
    evaluationCriteria: plan.evaluationCriteria,
    bibliography: plan.bibliography,
    units: (plan.units || []).map((u, i) => ({
      ...u,
      id: `unit-${stamp}-${i}`,
      deliveredLessons: 0,
      completedAt: undefined
    }))
  };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV com ponto e vírgula (Excel pt-PT): uma linha por unidade. */
export function plansToCsv(plans: CurriculumPlan[]): string {
  const header = [
    'Código',
    'Ano Letivo',
    'Disciplina',
    'Classe',
    'Estado',
    'Trimestre',
    'Unidade',
    'Tempos Previstos',
    'Tempos Leccionados',
    'Estado da Unidade'
  ];
  const rows: string[][] = [];
  for (const p of plans) {
    const statusLabel = CURRICULUM_STATUS_META[p.status].label;
    if ((p.units || []).length === 0) {
      rows.push([p.code, p.academicYear, p.subjectName, p.grade, statusLabel, '', '', '', '', '']);
      continue;
    }
    for (const u of p.units) {
      rows.push([
        p.code,
        p.academicYear,
        p.subjectName,
        p.grade,
        statusLabel,
        TRIMESTER_LABELS[u.trimester],
        u.title,
        String(u.plannedLessons),
        String(u.deliveredLessons),
        UNIT_STATUS_META[unitStatus(u)].label
      ]);
    }
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
