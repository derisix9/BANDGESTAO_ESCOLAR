/**
 * Receita do documento emitido no Estúdio: o suficiente para voltar a desenhar exactamente o mesmo
 * documento (modelo, textos editados, fundo, arredondamento, imagens escolhidas pelo utilizador).
 * É guardada no registo oficial (Processos Académicos → Documentos Académicos) e usada na reimpressão.
 * As imagens por omissão (brasão e logótipo da escola) não se guardam: são recarregadas na hora.
 */
import type { StudioState } from './state';
import { initialState } from './state';

const DEFAULT_SLOTS = ['brasao', 'logo'];

export interface SnapshotOverride { studentId?: string; staffIds?: string[]; docEdits?: Record<string, string> }

export function snapshotFromState(s: StudioState, o: SnapshotOverride = {}): Record<string, any> {
  const images: Record<string, string> = {};
  for (const [slot, src] of Object.entries(s.images)) {
    if (!src) continue;
    if (DEFAULT_SLOTS.includes(slot) && !s.pickedSlots.includes(slot)) continue;
    images[slot] = src;
  }
  return {
    v: 1, tab: s.tab, modelId: s.modelId, studentId: o.studentId ?? s.studentId, staffIds: o.staffIds ?? s.staffIds,
    year: s.year, classNum: s.classNum, extras: s.extras, page: s.page, sides: s.sides, orientation: s.orientation, backSide: s.backSide, purpose: s.purpose,
    rota: s.rota, registo: s.registo, outorga: s.outorga, dataEmissao: s.dataEmissao, trimestres: s.trimestres,
    bg: s.bg, radius: s.radius, modelEdits: s.modelEdits, docEdits: o.docEdits ?? s.docEdits, images
  };
}

/** Estado do Estúdio reconstruído a partir da receita (sempre em modo "um só documento"). */
export function stateFromSnapshot(snap: Record<string, any>, issued: { id: string; number: string; code: string; at: string }): StudioState {
  const base = initialState(String(snap.year || ''));
  return {
    ...base, ...snap, images: { ...(snap.images || {}) }, scope: 'aluno', classId: '',
    batchIssued: snap.tab === 'funcionario' && snap.staffIds?.[0]
      ? { [String(snap.staffIds[0])]: issued }
      : snap.tab === 'transporte' && snap.transportKey
        ? { [String(snap.transportKey)]: issued }
        : {},
    issued, pickedSlots: Object.keys(snap.images || {})
  } as StudioState;
}
