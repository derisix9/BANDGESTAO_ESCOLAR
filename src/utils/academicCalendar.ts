/**
 * Utilitários de calendário escolar: conversão entre o formato de data usado nas
 * Configurações ("02 Set 2026") e o formato ISO exigido pelos campos
 * <input type="date"> ("2026-09-02"), cálculo automático de semanas úteis e
 * determinação automática do Trimestre e do Ano Letivo em vigor a partir das
 * datas definidas — sem qualquer botão manual de "definir como ativo".
 */

import { parsePtDate } from './academicYear';

export const PT_MONTHS_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

/** Separador usado nos intervalos apresentados ("02 Set 2026 — 31 Jul 2027"). */
export const RANGE_SEPARATOR = ' — ';

/** Converte "2026-09-02" em "02 Set 2026". Devolve '' se a data for inválida. */
export function isoToPtDate(iso?: string | null): string {
  if (!iso) return '';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11) return '';
  return `${String(day).padStart(2, '0')} ${PT_MONTHS_SHORT[month]} ${year}`;
}

/** Converte "02 Set 2026" em "2026-09-02". Devolve '' se não for interpretável. */
export function ptDateToIso(pt?: string | null): string {
  const parsed = parsePtDate(pt);
  if (!parsed) return '';
  return toIso(parsed);
}

/** Converte um objeto Date em "AAAA-MM-DD" (hora local, sem deslocação de fuso). */
export function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Data de hoje em ISO, à meia-noite local. */
export function todayIso(reference: Date = new Date()): string {
  return toIso(reference);
}

/** Converte "AAAA-MM-DD" num Date local à meia-noite; null se inválido. */
export function isoToDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Aceita uma data em ISO ("2026-09-02") ou no formato português ("02 Set 2026")
 * e devolve sempre ISO — usado para ler valores gravados antes desta versão.
 */
export function anyDateToIso(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return ptDateToIso(trimmed);
}

/**
 * Conta as SEMANAS ÚTEIS de um intervalo: número de dias úteis (segunda a sexta)
 * entre as duas datas, inclusive, a dividir por cinco e arredondado. É este o
 * valor mostrado em "Semanas Úteis do Trimestre" e em "Semanas Letivas", agora
 * sempre calculado e nunca escrito à mão.
 */
export function countSchoolWeeks(startIso?: string | null, endIso?: string | null): number {
  const start = isoToDate(anyDateToIso(startIso));
  const end = isoToDate(anyDateToIso(endIso));
  if (!start || !end || end.getTime() < start.getTime()) return 0;

  let businessDays = 0;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) businessDays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(businessDays / 5);
}

/** Texto pronto a mostrar: "14 Semanas Úteis" / "38 Semanas Letivas". */
export function formatWeeksLabel(weeks: number, noun = 'Semanas Úteis'): string {
  if (!weeks) return '';
  const singular = noun.replace('Semanas', 'Semana');
  return `${weeks} ${weeks === 1 ? singular : noun}`;
}

/** Extrai o número de semanas de textos como "14 Semanas Úteis" ou "14". */
export function parseWeeksLabel(label?: string | number | null): number {
  if (typeof label === 'number') return Number.isFinite(label) ? label : 0;
  const parsed = parseInt(String(label ?? '').trim(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Monta "02 Set 2026 — 31 Jul 2027" a partir de duas datas ISO. */
export function formatPeriodRange(startIso?: string | null, endIso?: string | null): string {
  const start = isoToPtDate(anyDateToIso(startIso));
  const end = isoToPtDate(anyDateToIso(endIso));
  if (!start || !end) return start || end || '';
  return `${start}${RANGE_SEPARATOR}${end}`;
}

/** Lê "02 Set 2026 — 31 Jul 2027" (ou com "-", "–") e devolve as duas datas ISO. */
export function parsePeriodRange(text?: string | null): { startIso: string; endIso: string } {
  if (!text) return { startIso: '', endIso: '' };
  const parts = text.split(/\s[—–-]\s/);
  if (parts.length < 2) return { startIso: anyDateToIso(text), endIso: '' };
  return { startIso: anyDateToIso(parts[0]), endIso: anyDateToIso(parts[1]) };
}

export interface TrimesterRange {
  startDate?: string;
  endDate?: string;
  startDateIso?: string;
  endDateIso?: string;
}

export interface TrimesterSchedulesLike {
  t1?: TrimesterRange;
  t2?: TrimesterRange;
  t3?: TrimesterRange;
}

/** Devolve o intervalo ISO efetivo de um trimestre (preferindo os campos ISO novos). */
export function trimesterRangeIso(range?: TrimesterRange): { startIso: string; endIso: string } {
  return {
    startIso: anyDateToIso(range?.startDateIso || range?.startDate),
    endIso: anyDateToIso(range?.endDateIso || range?.endDate)
  };
}

/**
 * Determina, apenas a partir das datas configuradas, qual o Trimestre em vigor
 * numa determinada data. A passagem é automática: enquanto a data estiver dentro
 * do intervalo de um trimestre, é esse que está em curso; assim que um trimestre
 * termina, o dia seguinte já pertence ao trimestre seguinte (mesmo que este só
 * comece formalmente mais tarde — o período intermédio são férias/pausas, mas o
 * sistema já opera no trimestre que se segue). Devolve null quando não há datas
 * suficientes configuradas para decidir.
 */
export function resolveActiveTrimester(
  schedules: TrimesterSchedulesLike | undefined,
  reference: Date = new Date()
): '1' | '2' | '3' | null {
  if (!schedules) return null;
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();

  const keys: Array<['1' | '2' | '3', 't1' | 't2' | 't3']> = [
    ['1', 't1'],
    ['2', 't2'],
    ['3', 't3']
  ];

  const ranges = keys.map(([num, key]) => {
    const { startIso, endIso } = trimesterRangeIso(schedules[key]);
    const start = isoToDate(startIso);
    const end = isoToDate(endIso);
    return { num, start: start ? start.getTime() : null, end: end ? end.getTime() : null };
  });

  // 1. Dentro do intervalo de um trimestre.
  for (const r of ranges) {
    if (r.start !== null && r.end !== null && today >= r.start && today <= r.end) {
      return r.num;
    }
  }

  // 2. Antes do início do 1.º Trimestre configurado.
  const first = ranges[0];
  if (first.start !== null && today < first.start) return '1';

  // 3. Depois do fim de um trimestre: passa automaticamente para o seguinte.
  let resolved: '1' | '2' | '3' | null = null;
  for (const r of ranges) {
    if (r.end !== null && today > r.end) {
      resolved = r.num === '1' ? '2' : r.num === '2' ? '3' : '3';
    }
  }
  return resolved;
}

/** Extrai os dois anos de um rótulo "2026/2027". */
export function splitAcademicYear(label?: string | null): { first: number; second: number } | null {
  const match = (label || '').trim().match(/^(\d{4})\s*\/\s*(\d{2,4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const secondRaw = match[2];
  const second = secondRaw.length === 2 ? Number(String(first).slice(0, 2) + secondRaw) : Number(secondRaw);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return { first, second };
}

/** "2026/2027" -> "2027/2028". */
export function nextAcademicYearLabel(label?: string | null): string {
  const parts = splitAcademicYear(label);
  if (!parts) {
    const y = new Date().getFullYear();
    return `${y}/${y + 1}`;
  }
  return `${parts.first + 1}/${parts.second + 1}`;
}

/**
 * Período de atividade proposto por omissão para um ano letivo: 1 de Setembro do
 * primeiro ano a 31 de Julho do segundo (calendário do MED de Angola). É o
 * intervalo aplicado automaticamente quando o sistema abre um novo ano letivo, e
 * pode depois ser ajustado pelo Administrador no calendário.
 */
export function defaultPeriodForAcademicYear(label: string): { startIso: string; endIso: string } {
  const parts = splitAcademicYear(label);
  if (!parts) return { startIso: '', endIso: '' };
  return {
    startIso: `${parts.first}-09-01`,
    endIso: `${parts.second}-07-31`
  };
}

/** Rótulo do ano letivo deduzido de um intervalo de datas ("2026/2027"). */
export function academicYearLabelFromRange(startIso?: string | null, endIso?: string | null): string {
  const start = isoToDate(anyDateToIso(startIso));
  const end = isoToDate(anyDateToIso(endIso));
  if (!start) return '';
  const first = start.getFullYear();
  const second = end ? end.getFullYear() : first + 1;
  return `${first}/${second === first ? first + 1 : second}`;
}

/**
 * Datas propostas para os três trimestres de um ano letivo, repartindo o período
 * de atividade em três blocos equilibrados. Servem apenas de ponto de partida
 * quando o sistema abre automaticamente um novo ano letivo — o Administrador
 * ajusta depois cada data no calendário.
 */
export function proposeTrimesterDates(
  startIso: string,
  endIso: string
): Array<{ startIso: string; endIso: string }> {
  const start = isoToDate(startIso);
  const end = isoToDate(endIso);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return [
      { startIso: '', endIso: '' },
      { startIso: '', endIso: '' },
      { startIso: '', endIso: '' }
    ];
  }

  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const block = Math.floor(totalDays / 3);

  const at = (offsetDays: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + offsetDays);
    return toIso(d);
  };

  return [
    { startIso: toIso(start), endIso: at(block - 1) },
    { startIso: at(block), endIso: at(block * 2 - 1) },
    { startIso: at(block * 2), endIso: toIso(end) }
  ];
}
