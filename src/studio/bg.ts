/**
 * Fundo personalizado dos cartões, crachás e diplomas: cor lisa, gradiente ou imagem que ocupa a
 * folha toda. É uma transformação pura da Cena (por isso o ecrã, a impressão e o PPTX ficam
 * iguais): o preenchimento de fundo do modelo é retirado (as molduras e faixas ficam) e a nova
 * camada entra por baixo de tudo.
 */
import type { Prim, Scene } from './scene';

export type BgMode = 'modelo' | 'cor' | 'gradiente' | 'imagem';

export interface BgStyle {
  mode: BgMode;
  color: string;
  color2: string;
  /** Ângulo do gradiente, em graus (CSS: 0 = para cima, 90 = para a direita). */
  angle: number;
  /** Imagem: 'cover' preenche tudo cortando o excesso; 'stretch' estica à medida exacta da folha. */
  fit: 'cover' | 'stretch';
  /** Película branca por cima da imagem (0–0.85) para o texto continuar legível. */
  veil: number;
  /** Aplicar também ao verso. */
  back: boolean;
}

export const DEFAULT_BG: BgStyle = {
  mode: 'modelo', color: '#ffffff', color2: '#dbeafe', angle: 135, fit: 'cover', veil: 0.25, back: true
};

export const BG_MODES: Array<{ key: BgMode; label: string; icon: string }> = [
  { key: 'modelo', label: 'Do modelo', icon: 'auto_awesome' },
  { key: 'cor', label: 'Cor lisa', icon: 'palette' },
  { key: 'gradiente', label: 'Gradiente', icon: 'gradient' },
  { key: 'imagem', label: 'Imagem', icon: 'image' }
];

/** Verdadeiro quando o rectângulo cobre (quase) toda a cena: é o fundo do modelo. */
const isFullBleed = (p: Prim, scene: Scene) =>
  p.k === 'rect' && !!p.fill && p.x <= 1 && p.y <= 1 && p.x + p.w >= scene.w - 1 && p.y + p.h >= scene.h - 1;

/**
 * Devolve a cena com o fundo substituído. Com `mode: 'modelo'` (ou no verso, se `back` for falso)
 * a cena sai exactamente como o modelo a desenhou.
 */
export function applyBg(scene: Scene, bg: BgStyle, side: 'front' | 'back' = 'front'): Scene {
  if (bg.mode === 'modelo' || (side === 'back' && !bg.back)) return scene;
  // O rectângulo de fundo do modelo perde só o preenchimento: a moldura (stroke) mantém-se.
  const prims = scene.prims.map((p) => (isFullBleed(p, scene) ? { ...p, fill: undefined, fill2: undefined } : p));
  const layer: Prim[] = [];
  if (bg.mode === 'cor') {
    layer.push({ k: 'rect', x: 0, y: 0, w: scene.w, h: scene.h, fill: bg.color });
  } else if (bg.mode === 'gradiente') {
    layer.push({ k: 'rect', x: 0, y: 0, w: scene.w, h: scene.h, fill: bg.color, fill2: bg.color2, ang: bg.angle });
  } else if (bg.mode === 'imagem') {
    layer.push({ k: 'image', slot: 'fundo', x: 0, y: 0, w: scene.w, h: scene.h, fit: bg.fit });
    if (bg.veil > 0) layer.push({ k: 'rect', x: 0, y: 0, w: scene.w, h: scene.h, fill: '#ffffff', opacity: Math.min(0.85, Math.max(0, bg.veil)) });
  }
  return { ...scene, prims: [...layer, ...prims] };
}
