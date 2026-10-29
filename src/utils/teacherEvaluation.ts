import { EvaluationClassification, SchoolDatabase, Teacher, TeacherEvaluationCriterionScore } from '../types';
import { computeTeacherPerformance } from './teacherPerformance';

/**
 * Avaliação de Desempenho Docente — critérios pré-preenchidos com indicadores
 * REAIS (assiduidade, pautas homologadas, aproveitamento dos alunos), calculados
 * em teacherPerformance.ts a partir de dados já lançados no sistema, combinados
 * com critérios qualitativos que o avaliador preenche manualmente (0 a 5).
 *
 * Nenhum critério "automático" é inventado: quando não há dados suficientes
 * (ex.: professor sem chamadas registadas), o critério entra com nota 0 e uma
 * nota explicando "Sem dados suficientes", para o avaliador ajustar.
 */

export interface CriterionTemplate {
  key: string;
  label: string;
  weight: number;
  auto: boolean;
}

/** Pesos somam 100. Os 4 primeiros critérios são calculados automaticamente. */
export const EVALUATION_CRITERIA_TEMPLATE: CriterionTemplate[] = [
  { key: 'assiduidade', label: 'Assiduidade nas Aulas (chamadas registadas)', weight: 20, auto: true },
  { key: 'pautas_homologadas', label: 'Cumprimento de Prazos (Pautas Homologadas)', weight: 15, auto: true },
  { key: 'aproveitamento', label: 'Aproveitamento dos Alunos (Taxa de Aprovação)', weight: 15, auto: true },
  { key: 'media_disciplina', label: 'Média das Notas Lançadas na(s) Disciplina(s)', weight: 10, auto: true },
  { key: 'dominio_cientifico', label: 'Domínio Científico e Pedagógico dos Conteúdos', weight: 15, auto: false },
  { key: 'relacao_pedagogica', label: 'Relação com Alunos e Encarregados de Educação', weight: 10, auto: false },
  { key: 'trabalho_equipa', label: 'Trabalho em Equipa e Participação Institucional', weight: 10, auto: false },
  { key: 'pontualidade_entrega', label: 'Pontualidade na Entrega de Documentos Pedagógicos', weight: 5, auto: false }
];

function clampScore(v: number): number {
  return Math.max(0, Math.min(5, Math.round(v * 10) / 10));
}

/** Converte uma percentagem (0-100) numa nota de 0 a 5. */
function scoreFromPercent(percent: number | null): { score: number; note?: string } {
  if (percent === null) return { score: 0, note: 'Sem dados suficientes no sistema para calcular automaticamente.' };
  return { score: clampScore((percent / 100) * 5) };
}

/** Constrói os critérios pré-preenchidos para uma avaliação nova deste professor. */
export function buildDefaultCriteria(teacher: Teacher, db: SchoolDatabase): TeacherEvaluationCriterionScore[] {
  const metrics = computeTeacherPerformance(teacher, db);

  return EVALUATION_CRITERIA_TEMPLATE.map((tpl): TeacherEvaluationCriterionScore => {
    if (!tpl.auto) {
      return { key: tpl.key, label: tpl.label, score: 0, weight: tpl.weight, auto: false };
    }

    switch (tpl.key) {
      case 'assiduidade': {
        const { score, note } = scoreFromPercent(metrics.attendanceRatePercent);
        return {
          key: tpl.key,
          label: tpl.label,
          score,
          weight: tpl.weight,
          auto: true,
          note: note || `Assiduidade real registada: ${metrics.attendanceRatePercent}%.`
        };
      }
      case 'pautas_homologadas': {
        const { score, note } = scoreFromPercent(metrics.timelyGradesPercent);
        return {
          key: tpl.key,
          label: tpl.label,
          score,
          weight: tpl.weight,
          auto: true,
          note: note || `${metrics.timelyGradesPercent}% das turmas/disciplinas atribuídas já têm pauta homologada.`
        };
      }
      case 'aproveitamento': {
        const { score, note } = scoreFromPercent(metrics.averageApprovalRatePercent);
        return {
          key: tpl.key,
          label: tpl.label,
          score,
          weight: tpl.weight,
          auto: true,
          note: note || `Taxa de aprovação real (MFD ≥ 10): ${metrics.averageApprovalRatePercent}%.`
        };
      }
      case 'media_disciplina': {
        if (metrics.averageDisciplineGrade === null) {
          return {
            key: tpl.key,
            label: tpl.label,
            score: 0,
            weight: tpl.weight,
            auto: true,
            note: 'Sem dados suficientes no sistema para calcular automaticamente.'
          };
        }
        // Escala angolana de notas é 0-20; converte proporcionalmente para 0-5.
        const score = clampScore((metrics.averageDisciplineGrade / 20) * 5);
        return {
          key: tpl.key,
          label: tpl.label,
          score,
          weight: tpl.weight,
          auto: true,
          note: `Média real lançada: ${metrics.averageDisciplineGrade} valores.`
        };
      }
      default:
        return { key: tpl.key, label: tpl.label, score: 0, weight: tpl.weight, auto: tpl.auto };
    }
  });
}

/** Nota final ponderada (0 a 5), a partir dos pesos de cada critério. */
export function computeFinalScore(criteria: TeacherEvaluationCriterionScore[]): number {
  const totalWeight = criteria.reduce((sum, c) => sum + (c.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  const weightedSum = criteria.reduce((sum, c) => sum + (c.score || 0) * (c.weight || 0), 0);
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export function classifyScore(finalScore: number): EvaluationClassification {
  if (finalScore >= 4.5) return 'excelente';
  if (finalScore >= 3.5) return 'muito_bom';
  if (finalScore >= 2.5) return 'bom';
  if (finalScore >= 1.5) return 'satisfatorio';
  return 'insuficiente';
}

export const CLASSIFICATION_META: Record<EvaluationClassification, { label: string; badge: string }> = {
  excelente: { label: 'Excelente', badge: 'bg-emerald-100 text-emerald-800' },
  muito_bom: { label: 'Muito Bom', badge: 'bg-teal-100 text-teal-800' },
  bom: { label: 'Bom', badge: 'bg-blue-100 text-blue-800' },
  satisfatorio: { label: 'Satisfatório', badge: 'bg-amber-100 text-amber-800' },
  insuficiente: { label: 'Insuficiente', badge: 'bg-red-100 text-red-800' }
};

export const EVALUATION_STATUS_META: Record<string, { label: string; badge: string }> = {
  rascunho: { label: 'Rascunho', badge: 'bg-slate-200 text-slate-600' },
  concluida: { label: 'Concluída', badge: 'bg-blue-100 text-blue-800' },
  homologada: { label: 'Homologada', badge: 'bg-emerald-100 text-emerald-800' }
};
