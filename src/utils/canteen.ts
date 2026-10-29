import {
  AllergenKey,
  CanteenMenu,
  CanteenServiceEntry,
  CanteenServiceRecord,
  CanteenSubscription,
  CanteenSubscriptionStatus,
  MealType,
  Student,
  Weekday
} from '../types';
import { isoToDate, toIso } from './academicCalendar';

/**
 * REFEITÓRIO — regras de negócio (sem React nem Firebase).
 *
 *   Ementa (data + refeição)  ─┐
 *   Inscrição do aluno         ├─→ Previsão do dia → Serviço (o que se serviu) → Relatório mensal
 *   Alergias / restrições     ─┘        └─→ ALERTA quando a ementa tem um alergénio a que um inscrito reage
 *
 * • O refeitório funciona de segunda a sexta.
 * • Uma ementa por (data, refeição); uma inscrição não cancelada por aluno e ano letivo.
 * • Só alunos com matrícula ativa se inscrevem.
 * • O serviço não se regista para datas futuras; voltar a registar a mesma
 *   data/refeição atualiza o registo (não cria duplicados).
 * • As alergias são dado de saúde: ficam na inscrição e só chegam a quem gere o refeitório.
 * • Não há preços aqui: a cobrança de refeições não é inventada por este módulo.
 */

export const MEAL_TYPES: MealType[] = ['pequeno_almoco', 'almoco', 'lanche'];

export const MEAL_META: Record<MealType, { label: string; icon: string; badge: string }> = {
  pequeno_almoco: { label: 'Pequeno-almoço', icon: 'free_breakfast', badge: 'bg-amber-100 text-amber-800' },
  almoco: { label: 'Almoço', icon: 'lunch_dining', badge: 'bg-emerald-100 text-emerald-800' },
  lanche: { label: 'Lanche', icon: 'bakery_dining', badge: 'bg-violet-100 text-violet-800' }
};

export const SCHOOL_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];

export const ALLERGEN_KEYS: AllergenKey[] = [
  'gluten',
  'leite',
  'ovos',
  'amendoim',
  'frutos_casca_rija',
  'soja',
  'peixe',
  'crustaceos',
  'moluscos',
  'aipo',
  'mostarda',
  'sesamo',
  'sulfitos',
  'tremoco'
];

export const ALLERGEN_LABELS: Record<AllergenKey, string> = {
  gluten: 'Glúten',
  leite: 'Leite / Lactose',
  ovos: 'Ovos',
  amendoim: 'Amendoim (ginguba)',
  frutos_casca_rija: 'Frutos de casca rija',
  soja: 'Soja',
  peixe: 'Peixe',
  crustaceos: 'Crustáceos',
  moluscos: 'Moluscos',
  aipo: 'Aipo',
  mostarda: 'Mostarda',
  sesamo: 'Sésamo',
  sulfitos: 'Sulfitos',
  tremoco: 'Tremoço'
};

export const SUBSCRIPTION_STATUS_META: Record<CanteenSubscriptionStatus, { label: string; badge: string }> = {
  ativa: { label: 'Ativa', badge: 'bg-emerald-100 text-emerald-800' },
  suspensa: { label: 'Suspensa', badge: 'bg-amber-100 text-amber-800' },
  cancelada: { label: 'Cancelada', badge: 'bg-slate-100 text-slate-500' }
};

// ---------------------------------------------------------------------------
// Datas (sempre ISO local, sem fusos)
// ---------------------------------------------------------------------------

export const isIsoDate = (value?: string): boolean => !!value && isoToDate(value) !== null;

/** 0 = Domingo, 1 = Segunda ... 6 = Sábado. */
export function weekdayOf(iso: string): number {
  const d = isoToDate(iso);
  return d ? d.getDay() : -1;
}

export function isSchoolDay(iso: string): boolean {
  const w = weekdayOf(iso);
  return w >= 1 && w <= 5;
}

export function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Segunda-feira da semana a que a data pertence. */
export function mondayOf(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return iso;
  const w = d.getDay();
  return addDaysIso(iso, w === 0 ? -6 : 1 - w);
}

/** Segunda a sexta da semana da data dada. */
export function weekDates(iso: string): string[] {
  const monday = mondayOf(iso);
  return [0, 1, 2, 3, 4].map((n) => addDaysIso(monday, n));
}

export function monthOf(iso: string): string {
  return (iso || '').slice(0, 7);
}

const clean = (v?: string) => {
  const t = (v || '').trim();
  return t ? t : undefined;
};

const uniqueKeys = <T extends string>(list: T[] | undefined, allowed: readonly T[]): T[] =>
  Array.from(new Set(list || [])).filter((k): k is T => allowed.includes(k));

// ---------------------------------------------------------------------------
// Ementas
// ---------------------------------------------------------------------------

export type MenuInput = Omit<CanteenMenu, 'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>;

export function normalizeMenuFields(input: MenuInput): MenuInput {
  return {
    date: (input.date || '').trim(),
    mealType: input.mealType,
    mainDish: (input.mainDish || '').trim(),
    sideDish: clean(input.sideDish),
    soup: clean(input.soup),
    dessert: clean(input.dessert),
    drink: clean(input.drink),
    allergens: uniqueKeys(input.allergens, ALLERGEN_KEYS),
    notes: clean(input.notes)
  };
}

export function findMenu(menus: CanteenMenu[], date: string, mealType: MealType): CanteenMenu | undefined {
  return menus.find((m) => m.date === date && m.mealType === mealType);
}

export function validateMenu(input: MenuInput, menus: CanteenMenu[], ignoreId?: string): string[] {
  const errors: string[] = [];
  if (!isIsoDate(input.date)) errors.push('Indique a data da refeição.');
  else if (!isSchoolDay(input.date)) errors.push('O refeitório só funciona de segunda a sexta-feira.');
  if (!MEAL_TYPES.includes(input.mealType)) errors.push('Selecione a refeição.');
  if (!input.mainDish) errors.push('Indique o prato principal.');
  const dup = menus.find((m) => m.id !== ignoreId && m.date === input.date && m.mealType === input.mealType);
  if (dup) errors.push('Já existe uma ementa para esta data e refeição — edite-a em vez de criar outra.');
  return errors;
}

/**
 * Cópia da ementa de uma semana para outra: só preenche as células vazias da
 * semana de destino (nunca substitui uma ementa já feita).
 */
export function planWeekCopy(menus: CanteenMenu[], fromMonday: string, toMonday: string): MenuInput[] {
  const fromDates = new Set(weekDates(fromMonday));
  const offset = Math.round(((isoToDate(toMonday)?.getTime() ?? 0) - (isoToDate(mondayOf(fromMonday))?.getTime() ?? 0)) / 86400000);
  const out: MenuInput[] = [];
  for (const m of menus) {
    if (!fromDates.has(m.date)) continue;
    const date = addDaysIso(m.date, offset);
    if (findMenu(menus, date, m.mealType)) continue;
    out.push(
      normalizeMenuFields({
        date,
        mealType: m.mealType,
        mainDish: m.mainDish,
        sideDish: m.sideDish,
        soup: m.soup,
        dessert: m.dessert,
        drink: m.drink,
        allergens: m.allergens,
        notes: m.notes
      })
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inscrições
// ---------------------------------------------------------------------------

export type SubscriptionInput = Omit<
  CanteenSubscription,
  'id' | 'code' | 'status' | 'statusReason' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'studentName' | 'studentProcNumber' | 'className'
>;

export function normalizeSubscriptionFields(input: SubscriptionInput): SubscriptionInput {
  return {
    studentId: input.studentId,
    academicYear: (input.academicYear || '').trim(),
    meals: MEAL_TYPES.filter((m) => (input.meals || []).includes(m)),
    weekdays: SCHOOL_WEEKDAYS.filter((d) => (input.weekdays || []).includes(d)),
    startDate: (input.startDate || '').trim(),
    endDate: clean(input.endDate),
    allergies: uniqueKeys(input.allergies, ALLERGEN_KEYS),
    dietaryNotes: clean(input.dietaryNotes)
  };
}

export function validateSubscription(
  input: SubscriptionInput,
  student: Student | undefined,
  subscriptions: CanteenSubscription[],
  ignoreId?: string
): string[] {
  const errors: string[] = [];
  if (!student) errors.push('Selecione o aluno.');
  else if (student.status !== 'active') errors.push('Só alunos com matrícula ativa se podem inscrever no refeitório.');
  if (!input.academicYear) errors.push('Indique o ano letivo.');
  if (input.meals.length === 0) errors.push('Selecione pelo menos uma refeição.');
  if (input.weekdays.length === 0) errors.push('Selecione pelo menos um dia da semana.');
  if (!isIsoDate(input.startDate)) errors.push('Indique a data de início.');
  if (input.endDate) {
    if (!isIsoDate(input.endDate)) errors.push('Data de fim inválida.');
    else if (isIsoDate(input.startDate) && input.endDate < input.startDate) errors.push('A data de fim não pode ser anterior à de início.');
  }
  const dup = subscriptions.find(
    (s) => s.id !== ignoreId && s.studentId === input.studentId && s.academicYear === input.academicYear && s.status !== 'cancelada'
  );
  if (dup) errors.push(`O aluno já tem a inscrição ${dup.code} (${SUBSCRIPTION_STATUS_META[dup.status].label}) neste ano letivo.`);
  return errors;
}

/** Código sequencial: REF-0001. Nunca repete. */
export function generateSubscriptionCode(existingCodes: Array<string | undefined> = []): string {
  let max = 0;
  for (const code of existingCodes) {
    if (!code || !code.startsWith('REF-')) continue;
    const n = parseInt(code.slice(4), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `REF-${String(max + 1).padStart(4, '0')}`;
}

/** A inscrição dá direito a esta refeição neste dia? */
export function subscriptionCovers(sub: CanteenSubscription, date: string, mealType: MealType): boolean {
  if (sub.status !== 'ativa') return false;
  if (!isIsoDate(date) || date < sub.startDate) return false;
  if (sub.endDate && date > sub.endDate) return false;
  const w = weekdayOf(date) as Weekday;
  return (sub.weekdays || []).includes(w) && (sub.meals || []).includes(mealType);
}

/** Inscrições que contam para (data, refeição) — a base da previsão e do registo. */
export function expectedDiners(subs: CanteenSubscription[], date: string, mealType: MealType): CanteenSubscription[] {
  return subs
    .filter((s) => subscriptionCovers(s, date, mealType))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt'));
}

export function forecastForDate(subs: CanteenSubscription[], date: string): Record<MealType, number> {
  const out = {} as Record<MealType, number>;
  for (const m of MEAL_TYPES) out[m] = expectedDiners(subs, date, m).length;
  return out;
}

// ---------------------------------------------------------------------------
// Alergénios
// ---------------------------------------------------------------------------

export interface AllergenAlert {
  subscription: CanteenSubscription;
  allergens: AllergenKey[];
}

/** Alergénios em comum entre uma ementa e as alergias de um aluno. */
export function sharedAllergens(menu: Pick<CanteenMenu, 'allergens'> | undefined, allergies: AllergenKey[] | undefined): AllergenKey[] {
  if (!menu) return [];
  const mine = new Set(allergies || []);
  return (menu.allergens || []).filter((a) => mine.has(a));
}

/** Inscritos esperados nessa refeição a quem a ementa do dia pode fazer mal. */
export function allergenAlerts(menu: CanteenMenu | undefined, subs: CanteenSubscription[]): AllergenAlert[] {
  if (!menu) return [];
  return expectedDiners(subs, menu.date, menu.mealType)
    .map((subscription) => ({ subscription, allergens: sharedAllergens(menu, subscription.allergies) }))
    .filter((a) => a.allergens.length > 0);
}

export const allergenLabelList = (keys: AllergenKey[] | undefined): string =>
  (keys || []).map((k) => ALLERGEN_LABELS[k] || k).join(', ');

// ---------------------------------------------------------------------------
// Serviço diário
// ---------------------------------------------------------------------------

export function findServiceRecord(records: CanteenServiceRecord[], date: string, mealType: MealType): CanteenServiceRecord | undefined {
  return records.find((r) => r.date === date && r.mealType === mealType);
}

/**
 * Linhas iniciais do registo: se já existe registo, mostra-o (e junta quem se
 * inscreveu depois); senão, todos os inscritos esperados começam como «servida»
 * e o operador só desmarca quem faltou.
 */
export function buildServiceEntries(
  subs: CanteenSubscription[],
  date: string,
  mealType: MealType,
  existing?: CanteenServiceRecord
): CanteenServiceEntry[] {
  const expected = expectedDiners(subs, date, mealType);
  if (!existing) {
    return expected.map((s) => ({ studentId: s.studentId, studentName: s.studentName, status: 'servida' as const }));
  }
  const known = new Set((existing.entries || []).map((e) => e.studentId));
  const late = expected
    .filter((s) => !known.has(s.studentId))
    .map((s) => ({ studentId: s.studentId, studentName: s.studentName, status: 'servida' as const }));
  return [...(existing.entries || []).map((e) => ({ ...e })), ...late];
}

export function validateServiceRecord(
  date: string,
  mealType: MealType,
  entries: CanteenServiceEntry[],
  todayIso: string
): string[] {
  const errors: string[] = [];
  if (!isIsoDate(date)) return ['Indique a data do serviço.'];
  if (!isSchoolDay(date)) errors.push('O refeitório só funciona de segunda a sexta-feira.');
  if (date > todayIso) errors.push('Não se pode registar o serviço de uma data que ainda não chegou.');
  if (!MEAL_TYPES.includes(mealType)) errors.push('Selecione a refeição.');
  if (entries.length === 0) errors.push('Não há alunos neste serviço — inscreva alunos ou acrescente uma refeição avulsa.');
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.studentId)) {
      errors.push(`${e.studentName} aparece duas vezes no registo.`);
      break;
    }
    seen.add(e.studentId);
  }
  return errors;
}

export interface ServiceCounts {
  served: number;
  absent: number;
  extra: number;
}

export function countEntries(entries: CanteenServiceEntry[]): ServiceCounts {
  let served = 0;
  let absent = 0;
  let extra = 0;
  for (const e of entries || []) {
    if (e.status === 'servida') {
      served++;
      if (e.extra) extra++;
    } else absent++;
  }
  return { served, absent, extra };
}

// ---------------------------------------------------------------------------
// Relatório mensal
// ---------------------------------------------------------------------------

export interface MonthlyStudentRow {
  studentId: string;
  studentName: string;
  served: number;
  absent: number;
  extra: number;
}

export interface MonthlyDayRow {
  date: string;
  byMeal: Record<MealType, ServiceCounts>;
}

export interface MonthlyReport {
  month: string;
  days: MonthlyDayRow[];
  students: MonthlyStudentRow[];
  totals: ServiceCounts;
  byMeal: Record<MealType, ServiceCounts>;
}

const emptyCounts = (): ServiceCounts => ({ served: 0, absent: 0, extra: 0 });

export function buildMonthlyReport(records: CanteenServiceRecord[], month: string): MonthlyReport {
  const inMonth = records.filter((r) => monthOf(r.date) === month);
  const byMeal = {} as Record<MealType, ServiceCounts>;
  for (const m of MEAL_TYPES) byMeal[m] = emptyCounts();
  const totals = emptyCounts();
  const dayMap = new Map<string, MonthlyDayRow>();
  const studentMap = new Map<string, MonthlyStudentRow>();

  for (const r of inMonth) {
    let day = dayMap.get(r.date);
    if (!day) {
      day = { date: r.date, byMeal: {} as Record<MealType, ServiceCounts> };
      for (const m of MEAL_TYPES) day.byMeal[m] = emptyCounts();
      dayMap.set(r.date, day);
    }
    const c = countEntries(r.entries);
    for (const target of [day.byMeal[r.mealType], byMeal[r.mealType], totals]) {
      target.served += c.served;
      target.absent += c.absent;
      target.extra += c.extra;
    }
    for (const e of r.entries || []) {
      let row = studentMap.get(e.studentId);
      if (!row) {
        row = { studentId: e.studentId, studentName: e.studentName, served: 0, absent: 0, extra: 0 };
        studentMap.set(e.studentId, row);
      }
      if (e.status === 'servida') {
        row.served++;
        if (e.extra) row.extra++;
      } else row.absent++;
    }
  }

  return {
    month,
    days: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    students: Array.from(studentMap.values()).sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt')),
    totals,
    byMeal
  };
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

export function monthlyReportToCsv(report: MonthlyReport): string {
  const header = ['Aluno', 'Refeições Servidas', 'Ausências', 'Refeições Avulsas'];
  const rows = report.students.map((s) => [s.studentName, String(s.served), String(s.absent), String(s.extra)]);
  return toCsv([header, ...rows, ['TOTAL', String(report.totals.served), String(report.totals.absent), String(report.totals.extra)]]);
}

export function subscriptionsToCsv(subs: CanteenSubscription[]): string {
  const header = ['Código', 'Nº Processo', 'Aluno', 'Classe / Turma', 'Ano Letivo', 'Estado', 'Refeições', 'Dias', 'Início', 'Fim', 'Alergias', 'Notas'];
  const days: Record<number, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex' };
  const rows = subs.map((s) => [
    s.code,
    s.studentProcNumber,
    s.studentName,
    s.className || '',
    s.academicYear,
    SUBSCRIPTION_STATUS_META[s.status].label,
    (s.meals || []).map((m) => MEAL_META[m].label).join(' + '),
    (s.weekdays || []).map((d) => days[d]).join(' '),
    s.startDate,
    s.endDate || '',
    allergenLabelList(s.allergies),
    s.dietaryNotes || ''
  ]);
  return toCsv([header, ...rows]);
}
