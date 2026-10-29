import React from 'react';
import type { Scene } from '../scene';
import type { ImageSlots } from '../images';
import { MM_PX, SceneView } from './SceneView';

export interface CardSheetsProps {
  items: Array<{ front: Scene; back?: Scene }>;
  photos: Array<string | undefined>;
  images: ImageSlots;
  overrides: Record<string, string>;
  sides: 'frente' | 'verso' | 'ambos';
  /** Em lote (turma) só os textos do modelo são editáveis: os dados de cada aluno vêm do sistema. */
  batch?: boolean;
  onEdit?: (id: string, text: string, scope: 'model' | 'doc') => void;
  onPickImage?: (slot: string) => void;
  /** 1 = tamanho real (impressão); menos = miniatura no ecrã. */
  zoom?: number;
  gap?: number;
}

/** Geometria da folha A4: 2×4 (cartão horizontal, A4 vertical) ou 4×2 (cartão vertical, A4 horizontal). Cenas grandes (diploma A4) saem 1 por folha. */
export function sheetGeometry(scene: Scene, gap = 6) {
  if (scene.w >= 200 || scene.h >= 200) {
    return { page: { w: scene.w, h: scene.h }, cols: 1, rows: 1, per: 1, mx: 0, my: 0, gap, vertical: false };
  }
  const vertical = scene.h > scene.w;
  const page = vertical ? { w: 297, h: 210 } : { w: 210, h: 297 };
  const cols = vertical ? 4 : 2, rows = vertical ? 2 : 4;
  const gridW = cols * scene.w + (cols - 1) * gap, gridH = rows * scene.h + (rows - 1) * gap;
  return { page, cols, rows, per: cols * rows, mx: (page.w - gridW) / 2, my: (page.h - gridH) / 2, gap, vertical };
}

const lockDoc = (s: Scene): Scene => ({ ...s, prims: s.prims.map((p) => (p.k === 'text' && p.scope !== 'model' ? { ...p, editable: false } : p)) });

export const CardSheets: React.FC<CardSheetsProps> = ({ items, photos, images, overrides, sides, batch, onEdit, onPickImage, zoom = 1, gap = 6 }) => {
  if (!items.length) return null;
  const g = sheetGeometry(items[0].front, gap);
  const mm = MM_PX * zoom;
  const sheets = Math.ceil(items.length / g.per);
  const pages: Array<{ side: 'front' | 'back'; sheet: number }> = [];
  for (let s = 0; s < sheets; s++) {
    if (sides !== 'verso') pages.push({ side: 'front', sheet: s });
    if (sides !== 'frente' && items.some((it) => it.back)) pages.push({ side: 'back', sheet: s });
  }
  return (
    <div className="flex flex-col items-center gap-5">
      {pages.map((pg, pi) => {
        const chunk = items.slice(pg.sheet * g.per, pg.sheet * g.per + g.per);
        return (
          <div key={pi} className="studio-paper" style={{ position: 'relative', width: g.page.w * mm, height: g.page.h * mm, background: '#fff', boxShadow: '0 6px 22px rgba(15,23,42,.22)', breakAfter: 'page', flexShrink: 0 }}>
            {chunk.map((it, i) => {
              const scene = pg.side === 'front' ? it.front : it.back;
              if (!scene) return null;
              const r = Math.floor(i / g.cols);
              let c = i % g.cols;
              if (pg.side === 'back') c = g.cols - 1 - c; // espelhado: o verso alinha ao imprimir frente-e-verso
              const idx = pg.sheet * g.per + i;
              return (
                <div key={i} style={{ position: 'absolute', left: (g.mx + c * (scene.w + g.gap)) * mm, top: (g.my + r * (scene.h + g.gap)) * mm, outline: '0.25px dashed #b0b0b0' }}>
                  <SceneView scene={batch ? lockDoc(scene) : scene} images={images} photo={photos[idx] || images.foto} overrides={overrides} onEdit={onEdit} onPickImage={onPickImage} zoom={zoom} chrome={false} />
                </div>
              );
            })}
            <div data-no-print style={{ position: 'absolute', left: 4 * mm, bottom: 2 * mm, fontSize: 9, color: '#999', fontFamily: 'Arial' }}>
              {pg.side === 'front' ? 'Frente' : 'Verso (espelhado)'} · folha {pg.sheet + 1}/{sheets}
            </div>
          </div>
        );
      })}
    </div>
  );
};
