import type { GradeTypeKey } from '../types/pauta';
import type { PautaRegime } from './pautaCalculations';

/**
 * Regras de VISUALIZAÇÃO da Mini-Pauta e da Pauta (quais colunas se mostram/ocultam).
 * Nada aqui altera notas: só decide o que aparece. Os cálculos continuam a depender apenas das
 * avaliações marcadas (MAC/NPP/NPT/NEE/NEO/NER/AAV/PCP) da Mini-Pauta, nunca das colunas de média.
 */

/** Mini-Pauta: as médias do trimestre e a média final são sempre visíveis (não se podem desmarcar). */
export const MINIPAUTA_LOCKED_TYPES: GradeTypeKey[] = ['MT1', 'MT2', 'MT3', 'MFD'];

export type PautaMtKey = 'MT1' | 'MT2' | 'MT3';

/** Pauta: só MT1, MT2 e MT3 se podem desmarcar; MFD e MF ficam sempre. */
export const PAUTA_TOGGLEABLE_TYPES: PautaMtKey[] = ['MT1', 'MT2', 'MT3'];

export const isMiniPautaLocked = (key: GradeTypeKey) => MINIPAUTA_LOCKED_TYPES.includes(key);

/** Garante que as colunas fixas da Mini-Pauta estão sempre marcadas. */
export function withMiniPautaLockedTypes(selected: Iterable<GradeTypeKey>): Set<GradeTypeKey> {
  const next = new Set<GradeTypeKey>(selected);
  MINIPAUTA_LOCKED_TYPES.forEach((k) => next.add(k));
  return next;
}

/** Marca/desmarca um tipo na Mini-Pauta; MT1/MT2/MT3/MFD são ignorados (continuam marcados). */
export function toggleMiniPautaType(selected: Set<GradeTypeKey>, key: GradeTypeKey): Set<GradeTypeKey> {
  if (isMiniPautaLocked(key)) return withMiniPautaLockedTypes(selected);
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return withMiniPautaLockedTypes(next);
}

/** Marca/desmarca MT1/MT2/MT3 na Pauta (só visualização). */
export function togglePautaMt(visible: Set<PautaMtKey>, key: GradeTypeKey): Set<PautaMtKey> {
  if (!PAUTA_TOGGLEABLE_TYPES.includes(key as PautaMtKey)) return new Set(visible);
  const next = new Set(visible);
  if (next.has(key as PautaMtKey)) next.delete(key as PautaMtKey);
  else next.add(key as PautaMtKey);
  return next;
}

/**
 * Colunas que a Pauta mostra, a partir das MT visíveis: MFD e MF são fixas (e, nas classes de
 * exame, a NER por disciplina continua a aparecer como antes).
 */
export function buildPautaGradeTypes(visibleMts: Iterable<PautaMtKey>, regime: PautaRegime = 'transicao'): Set<GradeTypeKey> {
  const types = new Set<GradeTypeKey>(visibleMts);
  types.add('MFD');
  types.add('MF');
  if (regime === 'exame') types.add('NER');
  return types;
}

/**
 * Com MT1, MT2 e MT3 todas ocultas (só MFD/MF), cada disciplina tem espaço para o NOME COMPLETO;
 * com alguma MT visível usa-se a sigla (impressão e Excel).
 */
export function usesFullSubjectNames(selected: { has: (k: GradeTypeKey) => boolean }): boolean {
  return !selected.has('MT1') && !selected.has('MT2') && !selected.has('MT3');
}

/**
 * Ocultar da listagem (ecrã, impressão e Excel) os alunos desistentes e/ou transferidos.
 * Só esconde linhas: nenhuma nota nem cálculo muda.
 */
export interface RowVisibilityFilter {
  hideDesistentes: boolean;
  hideTransferidos: boolean;
}

export function isPautaRowHidden(
  row: { isDesistente: boolean; isTransferido?: boolean },
  filter: RowVisibilityFilter
): boolean {
  if (row.isTransferido) return filter.hideTransferidos;
  if (row.isDesistente) return filter.hideDesistentes;
  return false;
}

/**
 * Linhas visíveis com o índice ORIGINAL (necessário para editar notas na linha certa) e o
 * número de ordem a mostrar (re-numerado sem buracos).
 */
export function visiblePautaRows<T extends { isDesistente: boolean; isTransferido?: boolean }>(
  rows: T[],
  filter: RowVisibilityFilter
): Array<{ row: T; index: number; displayNum: number }> {
  const out: Array<{ row: T; index: number; displayNum: number }> = [];
  rows.forEach((row, index) => {
    if (isPautaRowHidden(row, filter)) return;
    out.push({ row, index, displayNum: out.length + 1 });
  });
  return out;
}
