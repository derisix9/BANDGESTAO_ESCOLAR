/**
 * Evasão escolar — risco por ALUNO (o painel preditivo só mostra por turma).
 * Junta quatro sinais já existentes no sistema: assiduidade, faltas injustificadas, média e propinas em atraso.
 * Função pura (sem React nem base de dados), por isso testável.
 */
import type { AttendanceSheet, DropoutCaseStatus, DropoutFollowUp, TuitionInvoice as Invoice, Student } from '../types';

export type DropoutLevel = 'alto' | 'medio' | 'baixo';
export type DropoutAlert = 'sem_acompanhamento' | 'acao_atrasada' | 'acompanhamento_parado';

export const DROPOUT_LEVEL_META: Record<DropoutLevel, { label: string; tone: string }> = {
  alto: { label: 'Risco Alto', tone: 'bg-red-50 text-red-700' },
  medio: { label: 'Risco Médio', tone: 'bg-amber-50 text-amber-700' },
  baixo: { label: 'Risco Baixo', tone: 'bg-emerald-50 text-emerald-700' }
};

export const DROPOUT_ALERT_LABEL: Record<DropoutAlert, string> = {
  sem_acompanhamento: 'Sem acompanhamento',
  acao_atrasada: 'Ação combinada em atraso',
  acompanhamento_parado: 'Sem contacto há mais de 30 dias'
};

/** Texto do alerta já com o limite de dias da escola (o texto fixo acima assume os 30 dias por omissão). */
export const dropoutAlertLabel = (alert: DropoutAlert, staleDays: number = STALE_DAYS): string =>
  alert === 'acompanhamento_parado' ? `Sem contacto há mais de ${staleDays} dias` : DROPOUT_ALERT_LABEL[alert];

/**
 * Limites que transformam os sinais em pontos de risco. Os valores por omissão são os que o sistema usava
 * antes de serem configuráveis; cada escola pode ajustá-los (Evasão Escolar → Limites de risco).
 *  - presença: abaixo de attendanceHigh = 3 pontos, abaixo de attendanceMid = 2, abaixo de attendanceLow = 1;
 *  - faltas injustificadas: absencesHigh ou mais = 2 pontos, absencesMid ou mais = 1;
 *  - média: abaixo de averageHigh = 3 pontos, abaixo de averageMid = 2;
 *  - nível: score ≥ scoreHigh = alto, ≥ scoreMedium = médio.
 */
export interface DropoutThresholds {
  attendanceHigh: number; attendanceMid: number; attendanceLow: number;
  absencesHigh: number; absencesMid: number;
  averageHigh: number; averageMid: number;
  scoreHigh: number; scoreMedium: number;
  staleDays: number;
}

export const DEFAULT_DROPOUT_THRESHOLDS: DropoutThresholds = {
  attendanceHigh: 70, attendanceMid: 80, attendanceLow: 90,
  absencesHigh: 10, absencesMid: 5,
  averageHigh: 8, averageMid: 10,
  scoreHigh: 6, scoreMedium: 3,
  staleDays: 30
};

/** Mensagens de erro de uns limites (vazio = válidos). A ordem importa: o "pior" limite tem de ser o mais baixo. */
export function validateDropoutThresholds(t: DropoutThresholds): string[] {
  const errs: string[] = [];
  const nums = Object.values(t);
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return ['Todos os limites têm de ser números iguais ou superiores a zero.'];
  if (!(t.attendanceHigh < t.attendanceMid && t.attendanceMid < t.attendanceLow && t.attendanceLow <= 100)) errs.push('Presença: os limites têm de ir crescendo (ex.: 70, 80, 90) e não passar de 100.');
  if (!(t.absencesMid >= 1 && t.absencesMid < t.absencesHigh)) errs.push('Faltas injustificadas: o limite «médio» tem de ser ao menos 1 e menor que o «alto».');
  if (!(t.averageHigh < t.averageMid && t.averageMid <= 20)) errs.push('Média: o limite «muito baixa» tem de ser menor que o «negativa» (e não passar de 20).');
  if (!(t.scoreMedium >= 1 && t.scoreMedium < t.scoreHigh)) errs.push('Nível de risco: a pontuação «médio» tem de ser ao menos 1 e menor que a «alto».');
  if (!(Number.isInteger(t.staleDays) && t.staleDays >= 1)) errs.push('Dias sem contacto: indique um número inteiro de dias (1 ou mais).');
  return errs;
}

/** Junta o que está gravado com os padrões; se o resultado for inválido, volta aos padrões (nunca rebenta o cálculo). */
export function resolveDropoutThresholds(stored?: Partial<DropoutThresholds> | null): DropoutThresholds {
  const merged: DropoutThresholds = { ...DEFAULT_DROPOUT_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_DROPOUT_THRESHOLDS) as (keyof DropoutThresholds)[]) {
    const v = Number((stored as any)?.[k]);
    if (stored && (stored as any)[k] !== undefined && (stored as any)[k] !== null && (stored as any)[k] !== '' && Number.isFinite(v)) merged[k] = v;
  }
  return validateDropoutThresholds(merged).length ? { ...DEFAULT_DROPOUT_THRESHOLDS } : merged;
}

export const CLOSED_STATUSES: DropoutCaseStatus[] = ['recuperado', 'desistiu', 'transferido'];
/** Dias sem novo registo a partir dos quais um caso aberto de risco fica "parado". */
export const STALE_DAYS = 30;
/** Nº mínimo de registos de chamada para a taxa de presença contar. */
const MIN_SHEETS = 3;

export interface StudentDropoutRisk {
  studentId: string;
  name: string;
  classId: string;
  className: string;
  guardianName: string;
  guardianPhone: string;
  score: number;
  level: DropoutLevel;
  reasons: string[];
  attendanceRate: number | null;
  average: number | null;
  lateInvoices: number;
  lastFollowUp?: DropoutFollowUp;
  caseStatus?: DropoutCaseStatus;
  closed: boolean;
  alert: DropoutAlert | null;
}

export interface DropoutInput {
  students: Student[];
  attendanceSheets: AttendanceSheet[];
  invoices: Invoice[];
  followUps: DropoutFollowUp[];
  /** AAAA-MM-DD (injectável para os testes). */
  today?: string;
  /** Limites da escola; sem isto valem os padrões. */
  thresholds?: Partial<DropoutThresholds> | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

/** O acompanhamento mais recente de cada aluno (por data, depois por criação). */
export function latestFollowUps(list: DropoutFollowUp[]): Map<string, DropoutFollowUp> {
  const out = new Map<string, DropoutFollowUp>();
  for (const f of list) {
    const cur = out.get(f.studentId);
    if (!cur || f.date > cur.date || (f.date === cur.date && (f.createdAt || '') > (cur.createdAt || ''))) out.set(f.studentId, f);
  }
  return out;
}

export function computeDropoutRisk(input: DropoutInput): StudentDropoutRisk[] {
  const today = input.today || iso(new Date());
  const T = resolveDropoutThresholds(input.thresholds);
  const latest = latestFollowUps(input.followUps);

  const att = new Map<string, { present: number; total: number }>();
  for (const sheet of input.attendanceSheets) {
    for (const st of sheet.students || []) {
      const a = att.get(st.studentId) || { present: 0, total: 0 };
      a.total += 1;
      if (st.status === 'P') a.present += 1;
      att.set(st.studentId, a);
    }
  }
  const late = new Map<string, number>();
  for (const inv of input.invoices) {
    if (inv.status === 'atraso') late.set(String(inv.studentId), (late.get(String(inv.studentId)) || 0) + 1);
  }

  const out: StudentDropoutRisk[] = [];
  for (const s of input.students) {
    if (s.status && s.status !== 'active' && s.status !== 'suspended') continue;
    const reasons: string[] = [];
    let score = 0;

    const a = att.get(s.id);
    const rate = a && a.total >= MIN_SHEETS ? Math.round((a.present / a.total) * 1000) / 10 : null;
    let attPts = 0;
    if (rate !== null) {
      if (rate < T.attendanceHigh) attPts = 3; else if (rate < T.attendanceMid) attPts = 2; else if (rate < T.attendanceLow) attPts = 1;
      if (attPts) reasons.push(`Presença de ${rate}%`);
    }
    const abs = Number(s.unexcusedAbsences) || 0;
    const absPts = abs >= T.absencesHigh ? 2 : abs >= T.absencesMid ? 1 : 0;
    if (absPts && attPts < absPts) reasons.push(`${abs} faltas injustificadas`);
    score += Math.max(attPts, absPts);

    const avg = Number(s.currentAverage);
    const hasAvg = Number.isFinite(avg) && avg > 0;
    if (hasAvg) {
      if (avg < T.averageHigh) { score += 3; reasons.push(`Média ${avg.toFixed(1)} (muito baixa)`); }
      else if (avg < T.averageMid) { score += 2; reasons.push(`Média ${avg.toFixed(1)} (negativa)`); }
    }

    const lateN = late.get(String(s.id)) || 0;
    if (lateN > 0) {
      score += lateN >= 3 ? 3 : lateN === 2 ? 2 : 1;
      reasons.push(`${lateN} ${lateN === 1 ? 'propina em atraso' : 'propinas em atraso'}`);
    }

    const level: DropoutLevel = score >= T.scoreHigh ? 'alto' : score >= T.scoreMedium ? 'medio' : 'baixo';
    const last = latest.get(s.id);
    const closed = !!last && CLOSED_STATUSES.includes(last.caseStatus);

    let alert: DropoutAlert | null = null;
    if (level !== 'baixo' && !closed) {
      if (!last) alert = 'sem_acompanhamento';
      else if (last.nextActionDate && last.nextActionDate < today) alert = 'acao_atrasada';
      else if (daysBetween(last.date, today) > T.staleDays) alert = 'acompanhamento_parado';
    }

    out.push({
      studentId: s.id, name: s.name, classId: String(s.classId ?? ''), className: s.className || '',
      guardianName: s.guardianName || '', guardianPhone: s.guardianPhone || '',
      score, level, reasons, attendanceRate: rate, average: hasAvg ? avg : null, lateInvoices: lateN,
      lastFollowUp: last, caseStatus: last?.caseStatus, closed, alert
    });
  }
  const rank = { alto: 0, medio: 1, baixo: 2 } as const;
  return out.sort((x, y) => rank[x.level] - rank[y.level] || y.score - x.score || x.name.localeCompare(y.name, 'pt'));
}

export interface DropoutSummary { alto: number; medio: number; comAlerta: number; emAcompanhamento: number; recuperados: number }

/** Resumo só de casos abertos (um caso recuperado/desistente/transferido deixa de contar como risco). */
export function summarizeRisk(list: StudentDropoutRisk[]): DropoutSummary {
  const open = list.filter((r) => !r.closed);
  return {
    alto: open.filter((r) => r.level === 'alto').length,
    medio: open.filter((r) => r.level === 'medio').length,
    comAlerta: open.filter((r) => r.alert).length,
    emAcompanhamento: list.filter((r) => r.caseStatus === 'em_acompanhamento').length,
    recuperados: list.filter((r) => r.caseStatus === 'recuperado').length
  };
}
