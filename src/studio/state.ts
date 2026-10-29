/**
 * Estado do Estúdio de Documentos (sem React, sem base de dados): um reducer puro, para poder ser
 * testado em Node. A vista só despacha acções; quem calcula o que fica no ecrã é `assemble.ts`.
 *
 * Edições de texto:
 *  - scope 'model' → valem para todas as pessoas do mesmo modelo (ex.: cabeçalho, lema);
 *  - scope 'doc'   → valem só para a pessoa/documento actual (ex.: nome, nota) e são largadas
 *                    quando muda a pessoa, o modelo, o ano ou a classe.
 */
import type { FlowExtras, PageStyle } from './flow';
import type { ImageSlots } from './images';
import type { BgStyle } from './bg';
import { DEFAULT_BG } from './bg';
import type { StudioTab } from './session';
import type { CardOrientation, CardSide } from './cards';

export type Sides = 'frente' | 'verso' | 'ambos';
export type EditScope = 'model' | 'doc';

export interface IssuedInfo { id: string; number: string; code: string; at: string }

export interface StudioState {
  tab: StudioTab;
  /** Aluno seleccionado (separadores de aluno). */
  studentId: string;
  /** Funcionários seleccionados para o crachá (podem ser vários). */
  staffIds: string[];
  year: string;
  modelId: string;
  classNum: number | null;
  extras: FlowExtras | null;
  page: Partial<PageStyle>;
  sides: Sides;
  /** Posição do cartão/crachá: horizontal, vertical ou (null) a do modelo. */
  orientation: CardOrientation | null;
  /** Cartão de estudante: verso padrão (normas + QR) ou Talão de Propinas. */
  backSide: CardSide;
  purpose: string;
  rota: string;
  registo: string;
  outorga: string | null;
  dataEmissao: string | null;
  trimestres: boolean;
  images: ImageSlots;
  /** Imagens escolhidas pelo utilizador (as restantes são as por omissão: brasão e logótipo). */
  pickedSlots: string[];
  /** Fundo personalizado dos cartões/diplomas (cor, gradiente ou imagem de folha inteira). */
  bg: BgStyle;
  /** Arredondamento dos cantos dos cartões em mm (null = o do modelo). Só apresentação. */
  radius: number | null;
  modelEdits: Record<string, string>;
  docEdits: Record<string, string>;
  /** 'aluno' = um só aluno; 'turma' = todos os alunos de uma turma (cartões, 8 por folha A4). */
  scope: 'aluno' | 'turma';
  classId: string;
  /** Registos oficiais já criados para cada aluno da turma (lote). */
  batchIssued: Record<string, IssuedInfo>;
  /** Último registo oficial criado para o que está no ecrã (limpo quando algo muda). */
  issued: IssuedInfo | null;
}

export const initialState = (year = ''): StudioState => ({
  tab: 'estudante', studentId: '', staffIds: [], year, modelId: '', classNum: null, extras: null, page: {},
  sides: 'ambos', orientation: null, backSide: 'padrao', purpose: '', rota: '', registo: '', outorga: null, dataEmissao: null, trimestres: false,
  images: {}, pickedSlots: [], bg: DEFAULT_BG, radius: null, modelEdits: {}, docEdits: {}, scope: 'aluno', classId: '', batchIssued: {}, issued: null
});

export type StudioAction =
  | { type: 'tab'; tab: StudioTab; modelId: string }
  | { type: 'student'; id: string; modelId: string; classNum: number | null; extras: FlowExtras | null }
  | { type: 'staff'; ids: string[] }
  | { type: 'model'; modelId: string; classNum?: number | null }
  | { type: 'year'; year: string }
  | { type: 'class'; classNum: number | null }
  | { type: 'extras'; patch: Partial<FlowExtras> }
  | { type: 'page'; patch: Partial<PageStyle> }
  | { type: 'sides'; sides: Sides }
  | { type: 'orientation'; orientation: CardOrientation | null }
  | { type: 'backSide'; side: CardSide }
  | { type: 'field'; field: 'purpose' | 'rota' | 'registo' | 'outorga' | 'dataEmissao'; value: string | null }
  | { type: 'trimestres'; on: boolean }
  | { type: 'image'; slot: string; src?: string; user?: boolean }
  | { type: 'bg'; patch: Partial<BgStyle> }
  | { type: 'radius'; radius: number | null }
  | { type: 'edit'; id: string; text: string; scope: EditScope }
  | { type: 'resetEdits' }
  | { type: 'scope'; scope: 'aluno' | 'turma' }
  | { type: 'classId'; classId: string }
  | { type: 'batchIssued'; map: Record<string, IssuedInfo> }
  | { type: 'issued'; info: IssuedInfo | null };

/** Muda o que o documento diz: o registo oficial anterior deixa de corresponder ao ecrã. */
const dirty = (s: StudioState, patch: Partial<StudioState>): StudioState => ({ ...s, ...patch, issued: null, batchIssued: {} });

export function studioReducer(s: StudioState, a: StudioAction): StudioState {
  switch (a.type) {
    case 'tab':
      return s.tab === a.tab ? s : dirty(s, { tab: a.tab, modelId: a.modelId, classNum: null, page: {}, modelEdits: {}, docEdits: {}, outorga: null, dataEmissao: null });
    case 'student':
      return dirty(s, { studentId: a.id, modelId: a.modelId, classNum: a.classNum, extras: a.extras, page: {}, docEdits: {}, outorga: null, dataEmissao: null, purpose: '' });
    case 'staff':
      return dirty(s, { staffIds: [...new Set(a.ids)], docEdits: {} });
    case 'model':
      return a.modelId === s.modelId ? s : dirty(s, { modelId: a.modelId, classNum: a.classNum ?? s.classNum, page: {}, modelEdits: {}, docEdits: {} });
    case 'year':
      return a.year === s.year ? s : dirty(s, { year: a.year, docEdits: {}, outorga: null, dataEmissao: null });
    case 'class':
      return a.classNum === s.classNum ? s : dirty(s, { classNum: a.classNum, docEdits: {} });
    case 'extras':
      return dirty(s, { extras: s.extras ? { ...s.extras, ...a.patch } : null });
    case 'page':
      return dirty(s, { page: { ...s.page, ...a.patch } });
    case 'sides':
      return s.sides === a.sides ? s : { ...s, sides: a.sides };
    case 'orientation':
      // Só apresentação: o registo emitido continua válido.
      return s.orientation === a.orientation ? s : { ...s, orientation: a.orientation };
    case 'backSide':
      return s.backSide === a.side ? s : { ...s, backSide: a.side };
    case 'field':
      return dirty(s, { [a.field]: a.value } as Partial<StudioState>);
    case 'trimestres':
      return dirty(s, { trimestres: a.on });
    case 'image': {
      const images = { ...s.images };
      if (a.src) images[a.slot] = a.src; else delete images[a.slot];
      const pickedSlots = a.user && !s.pickedSlots.includes(a.slot) ? [...s.pickedSlots, a.slot] : s.pickedSlots;
      return { ...s, images, pickedSlots };
    }
    case 'bg':
      // O fundo é só apresentação: não muda o texto nem o número — o registo emitido continua válido.
      return { ...s, bg: { ...s.bg, ...a.patch } };
    case 'radius':
      // Só apresentação (como o fundo): o registo emitido continua válido.
      return { ...s, radius: a.radius };
    case 'edit': {
      const key = a.scope === 'model' ? 'modelEdits' : 'docEdits';
      return dirty(s, { [key]: { ...s[key], [a.id]: a.text } } as Partial<StudioState>);
    }
    case 'resetEdits':
      return dirty(s, { modelEdits: {}, docEdits: {} });
    case 'scope':
      return s.scope === a.scope ? s : dirty(s, { scope: a.scope, docEdits: {} });
    case 'classId':
      return a.classId === s.classId ? s : dirty(s, { classId: a.classId, docEdits: {} });
    case 'batchIssued':
      return { ...s, batchIssued: a.map };
    case 'issued':
      return { ...s, issued: a.info };
  }
}

/** Edições a aplicar no ecrã/exportação: as do modelo e, por cima, as do documento actual. */
export const overridesOf = (s: StudioState): Record<string, string> => ({ ...s.modelEdits, ...s.docEdits });

export const hasEdits = (s: StudioState): boolean => Object.keys(s.modelEdits).length + Object.keys(s.docEdits).length > 0;
