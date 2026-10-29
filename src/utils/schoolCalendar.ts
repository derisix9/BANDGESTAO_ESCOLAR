import { SchoolCalendarEvent, InstitutionSettings, TrimesterSchedule } from '../types';
import { academicYearStart, parsePtDate } from './academicYear';

/**
 * Calendário Escolar — lógica pura (sem React) para montar o calendário a partir da mesma
 * fonte da "Agenda Institucional & Eventos Próximos" do Dashboard (`db.events`), acrescida
 * das datas que já estão em Configurações > Ano Letivo (trimestres, provas, conselhos de
 * notas e feriados oficiais). Nada é gravado aqui: é só leitura.
 */

export type CalendarCategory = 'feriado' | 'exame' | 'reuniao' | 'evento' | 'letivo';

export interface CalendarCategoryMeta {
  label: string;
  color: string;
  /** Prioridade ao pintar um dia com vários eventos (menor = mais forte). */
  rank: number;
}

export const CALENDAR_CATEGORIES: Record<CalendarCategory, CalendarCategoryMeta> = {
  feriado: { label: 'Feriado Oficial', color: '#059669', rank: 0 },
  exame: { label: 'Avaliação & Provas', color: '#7c3aed', rank: 1 },
  reuniao: { label: 'Conselho / Reunião', color: '#2563eb', rank: 2 },
  letivo: { label: 'Período Letivo', color: '#0b1f3a', rank: 3 },
  evento: { label: 'Atividade Geral', color: '#d97706', rank: 4 }
};

export const CALENDAR_CATEGORY_ORDER: CalendarCategory[] = ['feriado', 'exame', 'reuniao', 'letivo', 'evento'];

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
export const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export interface CalendarEntry {
  id: string;
  title: string;
  description?: string;
  /** Datas ISO (AAAA-MM-DD); `endIso === startIso` para eventos de um só dia. */
  startIso: string;
  endIso: string;
  time?: string;
  category: CalendarCategory;
  /** 'agenda' = Agenda Institucional do Dashboard; 'configuracoes' = Ano Letivo. */
  source: 'agenda' | 'configuracoes';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Converte as várias formas de data já usadas no sistema para AAAA-MM-DD (ou null). */
export function parseToIso(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();

  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validIso(+m[1], +m[2] - 1, +m[3]);

  m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return validIso(+m[3], +m[2] - 1, +m[1]);

  const pt = parsePtDate(text);
  if (pt) return toIso(pt.getFullYear(), pt.getMonth(), pt.getDate());
  return null;
}

function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return toIso(y, m, d);
}

export function isoToParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

export function formatIsoPt(iso: string): string {
  const { y, m, d } = isoToParts(iso);
  return `${pad(d)}/${pad(m + 1)}/${y}`;
}

export function todayIso(reference: Date = new Date()): string {
  return toIso(reference.getFullYear(), reference.getMonth(), reference.getDate());
}

/** Ano Lectivo (Setembro–Agosto) a que pertence uma data. */
export function academicYearOfIso(iso: string): string {
  const { y, m } = isoToParts(iso);
  const start = m >= 8 ? y : y - 1;
  return `${start}/${start + 1}`;
}

export function normalizeCategory(raw?: string): CalendarCategory {
  const c = String(raw || '').toLowerCase();
  if (c === 'feriado' || c === 'exame' || c === 'reuniao' || c === 'letivo') return c;
  return 'evento';
}

/** Eventos da Agenda Institucional: os que não têm data válida ficam fora do calendário. */
export function agendaToEntries(events: SchoolCalendarEvent[]): { entries: CalendarEntry[]; invalid: number } {
  const entries: CalendarEntry[] = [];
  let invalid = 0;
  events.forEach((evt) => {
    const iso = parseToIso(evt.date);
    if (!iso) {
      invalid += 1;
      return;
    }
    entries.push({
      id: `agenda-${evt.id}`,
      title: evt.title,
      description: evt.description,
      startIso: iso,
      endIso: iso,
      time: evt.time,
      category: normalizeCategory(evt.category),
      source: 'agenda'
    });
  });
  return { entries, invalid };
}

const TRIM_LABEL = ['1.º', '2.º', '3.º'];

/** Datas do Ano Lectivo definidas em Configurações (trimestres, provas, conselhos, feriados). */
export function settingsToEntries(
  settings: Partial<InstitutionSettings> | undefined,
  academicYear: string
): CalendarEntry[] {
  if (!settings) return [];
  const isCurrent = settings.currentAcademicYear === academicYear;
  const schedules = isCurrent
    ? settings.trimesterSchedules
    : settings.academicYearHistory?.find((h) => h.academicYear === academicYear)?.trimesterSchedules;

  const out: CalendarEntry[] = [];
  const add = (e: Omit<CalendarEntry, 'source'>) => out.push({ ...e, source: 'configuracoes' });

  if (schedules) {
    (['t1', 't2', 't3'] as const).forEach((key, idx) => {
      const t: TrimesterSchedule | undefined = schedules[key];
      if (!t) return;
      const label = TRIM_LABEL[idx];
      const start = t.startDateIso || parseToIso(t.startDate);
      const end = t.endDateIso || parseToIso(t.endDate);
      const examStart = t.examStartDateIso || null;
      const examEnd = t.examEndDateIso || examStart;
      const council = t.gradesCouncilDateIso || parseToIso(t.gradesCouncilDate);

      if (start) add({ id: `cfg-${key}-inicio`, title: `Início do ${label} Trimestre`, startIso: start, endIso: start, category: 'letivo' });
      if (end) add({ id: `cfg-${key}-fim`, title: `Fim do ${label} Trimestre`, startIso: end, endIso: end, category: 'letivo' });
      if (examStart) {
        add({
          id: `cfg-${key}-provas`,
          title: `Provas do ${label} Trimestre`,
          description: t.examPeriod || undefined,
          startIso: examStart,
          endIso: examEnd && examEnd >= examStart ? examEnd : examStart,
          category: 'exame'
        });
      }
      if (council) add({ id: `cfg-${key}-conselho`, title: `Conselho de Notas do ${label} Trimestre`, startIso: council, endIso: council, category: 'reuniao' });
    });
  }

  if (isCurrent) {
    (settings.academicHolidays || []).forEach((h) => {
      const iso = parseToIso(h.date);
      if (iso) add({ id: `cfg-feriado-${h.id}`, title: h.name, startIso: iso, endIso: iso, category: 'feriado' });
    });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export interface BuiltCalendar {
  entries: CalendarEntry[];
  /** Eventos da Agenda que não puderam ser posicionados por não terem data válida. */
  invalidAgendaEvents: number;
}

/** Junta Agenda + Configurações do Ano Lectivo pedido, sem duplicar o que já esteja na Agenda. */
export function buildCalendar(
  events: SchoolCalendarEvent[],
  settings: Partial<InstitutionSettings> | undefined,
  academicYear: string,
  includeSettings = true
): BuiltCalendar {
  const start = academicYearStart(academicYear);
  const windowStart = toIso(start, 8, 1);
  const windowEnd = toIso(start + 1, 7, 31);
  const inWindow = (e: CalendarEntry) => e.endIso >= windowStart && e.startIso <= windowEnd;

  const agenda = agendaToEntries(events || []);
  const fromAgenda = agenda.entries.filter(inWindow);
  const seen = new Set(fromAgenda.map((e) => `${e.startIso}|${norm(e.title)}`));

  const fromSettings = includeSettings
    ? settingsToEntries(settings, academicYear).filter(inWindow).filter((e) => !seen.has(`${e.startIso}|${norm(e.title)}`))
    : [];

  const entries = [...fromAgenda, ...fromSettings].sort(
    (a, b) => a.startIso.localeCompare(b.startIso) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title)
  );
  return { entries, invalidAgendaEvents: agenda.invalid };
}

export function entriesOnDay(entries: CalendarEntry[], iso: string): CalendarEntry[] {
  return entries.filter((e) => e.startIso <= iso && iso <= e.endIso);
}

export function entriesInMonth(entries: CalendarEntry[], y: number, m: number): CalendarEntry[] {
  const first = toIso(y, m, 1);
  const last = toIso(y, m, new Date(y, m + 1, 0).getDate());
  return entries.filter((e) => e.endIso >= first && e.startIso <= last);
}

export interface MonthCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isWeekend: boolean;
}

/** Semanas (segunda a domingo) que cobrem o mês; dias fora do mês vêm marcados. */
export function getMonthMatrix(y: number, m: number): MonthCell[][] {
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // segunda = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < total; i++) {
    const dt = new Date(y, m, 1 - offset + i);
    const col = i % 7;
    const cell: MonthCell = {
      iso: toIso(dt.getFullYear(), dt.getMonth(), dt.getDate()),
      day: dt.getDate(),
      inMonth: dt.getMonth() === m && dt.getFullYear() === y,
      isWeekend: col >= 5
    };
    if (col === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }
  return weeks;
}

/** Meses do Ano Lectivo: o período de atividade configurado, ou Setembro–Julho por omissão. */
export function getAcademicYearMonths(
  settings: Partial<InstitutionSettings> | undefined,
  academicYear: string,
  entries: CalendarEntry[]
): Array<{ y: number; m: number }> {
  const start = academicYearStart(academicYear);
  let from = { y: start, m: 8 };
  let to = { y: start + 1, m: 6 };

  let startIso: string | undefined;
  let endIso: string | undefined;
  if (settings?.currentAcademicYear === academicYear) {
    startIso = parseToIso(settings.academicPeriodStartIso) || undefined;
    endIso = parseToIso(settings.academicPeriodEndIso) || undefined;
  } else {
    const h = settings?.academicYearHistory?.find((x) => x.academicYear === academicYear);
    startIso = parseToIso(h?.periodStartIso) || undefined;
    endIso = parseToIso(h?.periodEndIso) || undefined;
  }
  if (startIso) { const p = isoToParts(startIso); from = { y: p.y, m: p.m }; }
  if (endIso) { const p = isoToParts(endIso); to = { y: p.y, m: p.m }; }

  // Nunca deixar de fora um mês que tenha eventos (ex.: Agosto).
  entries.forEach((e) => {
    const s = isoToParts(e.startIso);
    if (s.y * 12 + s.m < from.y * 12 + from.m) from = { y: s.y, m: s.m };
    if (s.y * 12 + s.m > to.y * 12 + to.m) to = { y: s.y, m: s.m };
  });

  const months: Array<{ y: number; m: number }> = [];
  let cur = from.y * 12 + from.m;
  const end = to.y * 12 + to.m;
  while (cur <= end && months.length < 14) {
    months.push({ y: Math.floor(cur / 12), m: cur % 12 });
    cur += 1;
  }
  return months;
}

/** Categoria "dominante" de um dia (para pintar o calendário anual em miniatura). */
export function dominantCategory(dayEntries: CalendarEntry[]): CalendarCategory | null {
  if (dayEntries.length === 0) return null;
  return dayEntries.reduce((best, e) =>
    CALENDAR_CATEGORIES[e.category].rank < CALENDAR_CATEGORIES[best].rank ? e.category : best
  , dayEntries[0].category);
}
