/**
 * Pré-escolar e primário (passo 6): avaliação descritiva/qualitativa por competências,
 * caderneta e relatório. Sem notas numéricas: cada competência recebe um nível.
 * Lógica pura e testável.
 */

export type CompetencyLevel = 'nao_observado' | 'iniciado' | 'em_desenvolvimento' | 'consolidado' | 'superado';

export const LEVEL_META: Record<CompetencyLevel, { label: string; short: string; score: number; badge: string }> = {
  nao_observado: { label: 'Ainda não observado', short: '—', score: 0, badge: 'bg-slate-100 text-slate-600' },
  iniciado: { label: 'Iniciado', short: 'I', score: 1, badge: 'bg-amber-100 text-amber-800' },
  em_desenvolvimento: { label: 'Em desenvolvimento', short: 'D', score: 2, badge: 'bg-blue-100 text-blue-800' },
  consolidado: { label: 'Consolidado', short: 'C', score: 3, badge: 'bg-emerald-100 text-emerald-800' },
  superado: { label: 'Superado', short: 'S', score: 4, badge: 'bg-violet-100 text-violet-800' }
};

export interface CompetencyArea {
  id: string;
  name: string;
  competencies: Array<{ id: string; name: string }>;
}

/** Áreas por defeito. A escola pode adaptá-las (guardadas em Configurações quando houver ecrã). */
export const DEFAULT_PRESCHOOL_AREAS: CompetencyArea[] = [
  { id: 'lingua', name: 'Linguagem e comunicação', competencies: [
    { id: 'oral', name: 'Expressa-se oralmente com clareza' },
    { id: 'escuta', name: 'Escuta e compreende histórias' },
    { id: 'pre_escrita', name: 'Pré-escrita e reconhecimento de letras' } ] },
  { id: 'matematica', name: 'Pensamento lógico-matemático', competencies: [
    { id: 'contagem', name: 'Conta e reconhece números' },
    { id: 'formas', name: 'Reconhece formas e cores' } ] },
  { id: 'motora', name: 'Desenvolvimento motor', competencies: [
    { id: 'grossa', name: 'Motricidade global' },
    { id: 'fina', name: 'Motricidade fina (pegar no lápis, recortar)' } ] },
  { id: 'social', name: 'Desenvolvimento pessoal e social', competencies: [
    { id: 'regras', name: 'Respeita regras e rotinas' },
    { id: 'partilha', name: 'Partilha e coopera com os colegas' },
    { id: 'autonomia', name: 'Autonomia (higiene, alimentação)' } ] }
];

export const DEFAULT_PRIMARY_AREAS: CompetencyArea[] = [
  { id: 'portugues', name: 'Língua Portuguesa', competencies: [
    { id: 'leitura', name: 'Lê com fluência e compreensão' },
    { id: 'escrita', name: 'Escreve textos simples com correção' },
    { id: 'oralidade', name: 'Participa em conversas e apresentações' } ] },
  { id: 'matematica', name: 'Matemática', competencies: [
    { id: 'numeros', name: 'Opera com números e resolve problemas' },
    { id: 'geometria', name: 'Reconhece figuras e medidas' } ] },
  { id: 'estudo_meio', name: 'Estudo do Meio', competencies: [
    { id: 'natureza', name: 'Compreende o meio natural e social' } ] },
  { id: 'expressoes', name: 'Educação Manual, Plástica e Musical', competencies: [
    { id: 'criatividade', name: 'Demonstra criatividade e empenho' } ] },
  { id: 'atitudes', name: 'Atitudes e comportamento', competencies: [
    { id: 'responsabilidade', name: 'Responsabilidade e assiduidade' },
    { id: 'convivio', name: 'Relação com colegas e professores' } ] }
];

/** Pré-escolar e 1.ª a 6.ª classe (primário angolano: iniciação + 1.ª–6.ª). */
export function isEarlyYearsGrade(grade: string): boolean {
  const g = (grade || '').toLowerCase();
  if (/inicia|pr[eé]|creche|jardim|infantil|pr[eé]-escolar/.test(g)) return true;
  const m = /(\d{1,2})\s*[.ºªa]*\s*classe/.exec(g);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 6;
}

export function defaultAreasForGrade(grade: string): CompetencyArea[] {
  const g = (grade || '').toLowerCase();
  return /inicia|pr[eé]|creche|jardim|infantil/.test(g) ? DEFAULT_PRESCHOOL_AREAS : DEFAULT_PRIMARY_AREAS;
}

export interface DescriptiveAssessment {
  id: string;
  academicYear: string;
  trimester: '1' | '2' | '3';
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  /** competencyId (qualificado pela área: "area.competencia") → nível */
  levels: Record<string, CompetencyLevel>;
  /** Pontos fortes, dificuldades e recomendações — texto livre do professor. */
  strengths?: string;
  needs?: string;
  recommendations?: string;
  /** Comentário/assinatura do encarregado na caderneta. */
  guardianAck?: { at: string; by: string; comment?: string };
  status: 'rascunho' | 'publicado';
  teacherName: string;
  updatedAt: string;
}

export const competencyKey = (areaId: string, competencyId: string) => `${areaId}.${competencyId}`;

export interface AssessmentSummary {
  evaluated: number;
  total: number;
  counts: Record<CompetencyLevel, number>;
  /** Média de 0–4 apenas sobre o que já foi observado. */
  average: number | null;
  /** Competências em nível "iniciado" — pedem apoio. */
  needsSupport: string[];
}

export function summarizeAssessment(areas: CompetencyArea[], levels: Record<string, CompetencyLevel>): AssessmentSummary {
  const counts: Record<CompetencyLevel, number> = { nao_observado: 0, iniciado: 0, em_desenvolvimento: 0, consolidado: 0, superado: 0 };
  const needsSupport: string[] = [];
  let total = 0, sum = 0, evaluated = 0;
  for (const area of areas) {
    for (const c of area.competencies) {
      total += 1;
      const level = levels[competencyKey(area.id, c.id)] || 'nao_observado';
      counts[level] += 1;
      if (level !== 'nao_observado') { evaluated += 1; sum += LEVEL_META[level].score; }
      if (level === 'iniciado') needsSupport.push(c.name);
    }
  }
  return { evaluated, total, counts, average: evaluated > 0 ? Math.round((sum / evaluated) * 100) / 100 : null, needsSupport };
}

/** Só se publica uma avaliação completa e com comentário do professor. */
export function publishBlockers(areas: CompetencyArea[], a: Pick<DescriptiveAssessment, 'levels' | 'strengths'>): string[] {
  const s = summarizeAssessment(areas, a.levels);
  const errors: string[] = [];
  if (s.evaluated < s.total) errors.push(`Faltam ${s.total - s.evaluated} competência(s) por avaliar.`);
  if (!(a.strengths || '').trim()) errors.push('Escreva pelo menos o comentário sobre os pontos fortes do aluno.');
  return errors;
}

/** Texto do relatório por competências (para imprimir ou enviar ao encarregado). */
export function buildDescriptiveReport(areas: CompetencyArea[], a: DescriptiveAssessment): string {
  const lines: string[] = [`Relatório descritivo — ${a.studentName} (${a.className}), ${a.trimester}.º trimestre ${a.academicYear}`, ''];
  for (const area of areas) {
    lines.push(area.name);
    for (const c of area.competencies) {
      const level = a.levels[competencyKey(area.id, c.id)] || 'nao_observado';
      lines.push(`  • ${c.name}: ${LEVEL_META[level].label}`);
    }
  }
  if (a.strengths) lines.push('', `Pontos fortes: ${a.strengths}`);
  if (a.needs) lines.push(`Dificuldades: ${a.needs}`);
  if (a.recommendations) lines.push(`Recomendações: ${a.recommendations}`);
  lines.push('', `Professor(a): ${a.teacherName}`);
  return lines.join('\n');
}
