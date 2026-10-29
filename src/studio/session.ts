/**
 * Lógica pura do Estúdio de Documentos (sem React): separadores, escolha de modelos, montagem do
 * contexto dos cartões/diplomas e do contexto dos documentos de fluxo. Fica fora da vista para
 * poder ser testada em Node.
 */
import type { AcademicDocType } from '../utils/academicProcesses';
import type { CardCtx, CardModel } from './cards';
import type { FeeCell } from './cardsHtml';
import { CARD_MODELS, staffFields, studentFields } from './cards';
import type { StaffPerson, StudioData, StudioLevel } from './data';
import { levelOfGrade } from './data';
import type { FlowCtx, FlowExtras, FlowModel } from './flow';
import { FLOW_MODELS, buildFlow, defaultExtras } from './flow';
import { classNumber, dataPorExtenso } from './format';

export type StudioTab = 'estudante' | 'funcionario' | 'transporte' | 'diploma' | 'certificado' | 'declaracao' | 'historico';

export interface TabInfo { id: StudioTab; label: string; icon: string; person: 'aluno' | 'funcionario'; output: 'PPTX' | 'DOCX' | 'PDF' }

export const STUDIO_TABS: TabInfo[] = [
  { id: 'estudante', label: 'Cartão de Estudante', icon: 'badge', person: 'aluno', output: 'PPTX' },
  { id: 'funcionario', label: 'Crachá de Funcionário', icon: 'id_card', person: 'funcionario', output: 'PPTX' },
  { id: 'transporte', label: 'Transporte Escolar', icon: 'directions_bus', person: 'aluno', output: 'PPTX' },
  { id: 'diploma', label: 'Diplomas', icon: 'workspace_premium', person: 'aluno', output: 'PPTX' },
  { id: 'certificado', label: 'Certificados', icon: 'verified', person: 'aluno', output: 'DOCX' },
  { id: 'declaracao', label: 'Declarações', icon: 'description', person: 'aluno', output: 'DOCX' },
  { id: 'historico', label: 'Histórico Académico', icon: 'history_edu', person: 'aluno', output: 'PDF' }
];

export const isCardTab = (t: StudioTab) => t === 'estudante' || t === 'funcionario' || t === 'transporte' || t === 'diploma';
export const isFlowTab = (t: StudioTab) => t === 'certificado' || t === 'declaracao';

/** Tipo do registo oficial (numeração CERT-/DECL-/DIPL-/CART-/HIST-) correspondente ao separador. */
export function docTypeOfTab(tab: StudioTab, withGrades = false): AcademicDocType {
  switch (tab) {
    case 'certificado': return 'certificado';
    case 'declaracao': return withGrades ? 'declaracao_com_notas' : 'declaracao_sem_notas';
    case 'diploma': return 'diploma';
    case 'historico': return 'historico_academico';
    case 'transporte': return 'cartao_transporte';
    default: return 'cartao_estudante';
  }
}

/** Modelos de cartão/diploma do separador; para estudantes, primeiro os do nível do aluno. */
export function cardModelsFor(tab: StudioTab, level?: StudioLevel): CardModel[] {
  if (!isCardTab(tab)) return [];
  const all = CARD_MODELS.filter((m) => m.kind === tab);
  if (tab !== 'estudante' || !level) return all;
  const own = all.filter((m) => m.level === level || m.level === 'todos');
  // Níveis sem modelos próprios (técnico, EJA) usam os do II Ciclo.
  const pool = own.length ? own : all.filter((m) => m.level === 'iiciclo');
  return pool.length ? pool : all;
}

/** Modelos de certificado ou declaração; os do nível do aluno vêm primeiro. */
export function flowModelsFor(tab: StudioTab, level?: StudioLevel): FlowModel[] {
  const kind = tab === 'certificado' ? 'certificado' : tab === 'declaracao' ? 'declaracao' : null;
  if (!kind) return [];
  const all = FLOW_MODELS.filter((m) => m.kind === kind);
  return [...all].sort((a, b) => Number(b.level === level) - Number(a.level === level));
}

/** Modelo sugerido para um aluno: o primeiro do seu nível (ou o primeiro da lista). */
export function suggestedModelId(tab: StudioTab, data: StudioData | null): string {
  const level = data ? levelOfGrade(data.enrollment.grade) : undefined;
  if (isCardTab(tab)) return cardModelsFor(tab, level)[0]?.id || '';
  if (isFlowTab(tab)) {
    const list = flowModelsFor(tab, level);
    const n = data?.enrollment.classNum ?? null;
    const exact = n != null ? list.find((m) => m.level === level && m.classes.includes(n)) : undefined;
    return (exact || list[0])?.id || '';
  }
  return '';
}

export const outorgaPadrao = (d: StudioData, year: string): string =>
  `por ter concluído com aproveitamento a ${d.enrollment.grade || 'classe respectiva'}${d.enrollment.curso ? ` do curso de ${d.enrollment.curso}` : ''} no ano lectivo ${year}, conferindo-lhe todos os direitos, prerrogativas e honras inerentes ao título.`;

export interface CardCtxInput {
  data: StudioData | null;
  staff?: StaffPerson | null;
  year: string;
  verifyValue: string;
  rota?: string;
  registo?: string;
  /** Texto de outorga/data já editados pelo utilizador (senão usa o padrão). */
  outorga?: string;
  dataEmissao?: string;
  /** Propinas mês a mês (verso Talão de Propinas). */
  fees?: FeeCell[];
  /** Transporte: meses (1–12) com mensalidade validada. */
  transpPaid?: number[];
}

/** Contexto que os modelos de cartão/crachá/diploma recebem (dados da pessoa já formatados). */
export function buildCardCtx(tab: StudioTab, i: CardCtxInput): CardCtx | null {
  const d = i.data;
  if (tab === 'funcionario') {
    if (!i.staff || !d) return null;
    return { school: d.school, f: staffFields(i.staff, i.year), verifyValue: i.verifyValue, level: 'iiciclo', year: i.year };
  }
  // Cartão de transporte de um docente/funcionário: os campos do cartão (classe, turma, processo)
  // passam a dizer departamento, cargo e nº de funcionário, e os rótulos acompanham.
  if (tab === 'transporte' && i.staff) {
    if (!d) return null;
    const sf = staffFields(i.staff, i.year);
    const f: Record<string, string> = {
      ...sf,
      classe: sf.depto,
      turma: sf.cargo,
      proc: sf.numero,
      rota: i.rota || '',
      lPessoa: i.staff.kind === 'docente' ? 'DOCENTE' : 'FUNCIONÁRIO',
      lClasse: 'DEPARTAMENTO / CARGO',
      lProc: i.staff.kind === 'docente' ? 'Nº AGENTE' : 'Nº FUNCIONÁRIO'
    };
    return { school: d.school, f, verifyValue: i.verifyValue, level: 'iiciclo', year: i.year, transpPaid: i.transpPaid };
  }
  if (!d) return null;
  const level = levelOfGrade(d.enrollment.grade);
  const f = studentFields(d, i.year, level);
  f.rota = i.rota || '';
  f.validade = (i.year.split(/\D+/)[1] || i.year || '').trim();
  f.outorga = i.outorga ?? outorgaPadrao(d, i.year);
  f.dataEmissao = i.dataEmissao ?? `${d.school.city ? d.school.city + ', ' : ''}${dataPorExtenso(new Date())}`;
  f.registo = i.registo || '';
  return { school: d.school, f, verifyValue: i.verifyValue, level, year: i.year, fees: i.fees, transpPaid: i.transpPaid };
}

export interface FlowBuildInput {
  data: StudioData;
  model: FlowModel;
  year: string;
  classNum?: number | null;
  extras: FlowExtras;
  page?: Parameters<typeof buildFlow>[2];
}

/** Constrói o documento de fluxo com a classe certa (a escolhida, a do aluno ou a primeira do modelo). */
export function buildFlowDoc(i: FlowBuildInput) {
  const cls = i.classNum ?? i.data.enrollment.classNum ?? i.model.classes[0] ?? null;
  const safe = cls != null && i.model.classes.length && !i.model.classes.includes(cls) ? i.model.classes[0] : cls;
  const ctx: FlowCtx = { data: i.data, classNum: safe, year: i.year, extras: i.extras };
  return buildFlow(i.model, ctx, i.page);
}

export { defaultExtras, classNumber };

/** Anos lectivos para o selector: o do aluno + os do histórico, do mais recente para o mais antigo. */
export function yearOptions(d: StudioData | null, current: string): string[] {
  const set = new Set<string>([current, ...(d?.history || []).map((h) => h.year)].filter(Boolean));
  return [...set].sort((a, b) => b.localeCompare(a));
}
