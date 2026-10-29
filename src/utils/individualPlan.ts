/**
 * PLANO EDUCATIVO INDIVIDUAL (necessidades educativas especiais).
 * Lógica pura, testada em tests/individualPlan.test.ts.
 * Dados sensíveis: o acesso é restrito (ver dataShards.json → individualPlans).
 */
import type { IndividualPlan, IndividualPlanGoal, InclusionNeedCategory, PlanGoalStatus } from '../types';
import { isRealDate } from './nationalExams';

export const NEED_LABELS: Record<InclusionNeedCategory, string> = {
  visual: 'Deficiência visual',
  auditiva: 'Deficiência auditiva',
  motora: 'Deficiência motora',
  intelectual: 'Deficiência intelectual',
  aprendizagem: 'Dificuldades específicas de aprendizagem',
  autismo: 'Perturbação do espectro do autismo',
  comportamental: 'Apoio emocional / comportamental',
  altas_habilidades: 'Altas habilidades / sobredotação',
  outra: 'Outra'
};
export const GOAL_LABELS: Record<PlanGoalStatus, string> = {
  pendente: 'Por iniciar', em_curso: 'Em curso', atingido: 'Atingido', nao_atingido: 'Não atingido'
};

/** AAAA-MM-DD + n meses (fixa o dia ao último dia do mês quando necessário). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(y, m - 1 + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const out = new Date(first.getFullYear(), first.getMonth(), Math.min(d, last));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${out.getFullYear()}-${p(out.getMonth() + 1)}-${p(out.getDate())}`;
}

export function validateIndividualPlan(
  input: { studentId: string; category: string; startDate: string; reviewEveryMonths: number; responsible: string; description: string; goals: Array<Pick<IndividualPlanGoal, 'description' | 'targetDate'>> },
  existing: IndividualPlan[],
  ignoreId?: string
): string[] {
  const errs: string[] = [];
  if (!input.studentId) errs.push('Escolha o aluno.');
  if (!input.category) errs.push('Indique a categoria de necessidade.');
  if (!isRealDate(input.startDate)) errs.push('Indique a data de início.');
  if (!Number.isInteger(input.reviewEveryMonths) || input.reviewEveryMonths < 1 || input.reviewEveryMonths > 12) errs.push('O intervalo de revisão deve ser de 1 a 12 meses.');
  if (!input.responsible?.trim()) errs.push('Indique o responsável pelo plano.');
  if (!input.description?.trim()) errs.push('Descreva as necessidades educativas do aluno.');
  if (!input.goals.length) errs.push('Defina pelo menos um objectivo.');
  input.goals.forEach((g, i) => {
    if (!g.description?.trim()) errs.push(`Objectivo ${i + 1}: falta a descrição.`);
    if (g.targetDate && !isRealDate(g.targetDate)) errs.push(`Objectivo ${i + 1}: data-alvo inválida.`);
    else if (g.targetDate && isRealDate(input.startDate) && g.targetDate < input.startDate) errs.push(`Objectivo ${i + 1}: a data-alvo é anterior ao início do plano.`);
  });
  const dup = existing.find((p) => p.id !== ignoreId && p.studentId === input.studentId && (p.status === 'ativo' || p.status === 'em_revisao' || p.status === 'rascunho'));
  if (dup) errs.push('Este aluno já tem um plano em curso. Encerre-o ou edite-o.');
  return errs;
}

export function planProgress(goals: IndividualPlanGoal[]): number {
  if (!goals.length) return 0;
  return Math.round((goals.filter((g) => g.status === 'atingido').length / goals.length) * 100);
}

export function isReviewOverdue(p: Pick<IndividualPlan, 'status' | 'nextReviewDate'>, todayIso: string): boolean {
  return (p.status === 'ativo' || p.status === 'em_revisao') && !!p.nextReviewDate && p.nextReviewDate < todayIso;
}

export function daysUntil(iso: string, todayIso: string): number {
  const a = new Date(`${todayIso}T00:00:00`).getTime();
  const b = new Date(`${iso}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}
