/**
 * Exporta cartões, crachás, cartões de transporte e diplomas para PowerPoint (.pptx).
 *  - Cartões CR80 horizontais: 8 por folha A4 vertical (2 × 4).
 *  - Cartões CR80 verticais:   8 por folha A4 horizontal (4 × 2).
 *  - Frente e verso em diapositivos seguidos; o verso vem com as colunas espelhadas para a
 *    impressão frente-e-verso alinhar ao cortar.
 *  - Diplomas: um por diapositivo, A4 paisagem.
 * Todas as formas e caixas de texto são nativas (editáveis no PowerPoint).
 */
import PptxGenJS from 'pptxgenjs';
import QRCode from 'qrcode';
import type { Prim, PText, Scene } from './scene';
import { PPT_FONT, fitSize } from './scene';

export interface PptxOptions {
  /** Cenas por pessoa: cada item é um cartão (frente, verso). */
  items: Array<{ front: Scene; back?: Scene }>;
  sides: 'frente' | 'verso' | 'ambos';
  /** Imagens por slot (data URL). A foto é por pessoa: `photos[i]`. */
  images: Record<string, string | undefined>;
  photos?: Array<string | undefined>;
  overrides?: Record<string, string>;
  /** Índice da pessoa a quem se aplicam as edições de texto "doc" (as de modelo aplicam-se a todos). */
  docIndex?: number;
  cutMarks?: boolean;
  gap?: number;
  title?: string;
  /** Ajusta a imagem ao rectângulo (corte "cover"/redondo) – no browser usa canvas. */
  fit?: (dataUrl: string, wMm: number, hMm: number, o: { round?: boolean; fit?: 'cover' | 'contain' | 'stretch'; opacity?: number; jpeg?: boolean }) => Promise<string>;
  /** Gera o gradiente como imagem (formas com `fill2`). Sem isto, o gradiente sai como cor lisa. */
  gradient?: (wMm: number, hMm: number, c1: string, c2: string, angle: number) => string;
}

const IN = (mm: number) => mm / 25.4;
const A4 = { p: { w: 210, h: 297 }, l: { w: 297, h: 210 } };

function color(c?: string): { color: string; transparency?: number } | undefined {
  if (!c) return undefined;
  const h = c.replace('#', '');
  if (h.length === 8) return { color: h.slice(0, 6).toUpperCase(), transparency: Math.round((1 - parseInt(h.slice(6), 16) / 255) * 100) };
  return { color: (h.length === 3 ? h.split('').map((x) => x + x).join('') : h).toUpperCase() };
}

async function qrData(value: string): Promise<string> {
  return QRCode.toDataURL(value || 'x', { margin: 0, width: 300, errorCorrectionLevel: 'M' });
}

async function drawScene(pptx: PptxGenJS, slide: PptxGenJS.Slide, scene: Scene, ox: number, oy: number, o: PptxOptions, index: number, mirrorKey: string) {
  const X = (v: number) => IN(ox + v), Y = (v: number) => IN(oy + v), L = IN;
  for (const p of scene.prims) {
    if (p.k === 'ellipse' && p.id === 'deco-ring') continue; // anéis decorativos: só no ecrã/impressão (cortados ao cartão)
    if (p.k === 'rect') {
      // Gradiente (fill + fill2): o PowerPoint não recebe gradientes por aqui, sai como imagem.
      if (p.fill && p.fill2 && o.gradient) {
        slide.addImage({
          data: o.gradient(p.w, p.h, p.fill, p.fill2, p.ang ?? 135), x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h),
          transparency: Math.round((1 - (p.opacity ?? 1)) * 100)
        } as any);
        if (p.stroke) {
          const s0 = color(p.stroke)!;
          slide.addShape(pptx.ShapeType.rect, { x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h), fill: { color: 'FFFFFF', transparency: 100 }, line: { color: s0.color, width: Math.max(0.25, (p.sw ?? 0.3) * 2.835) } } as any);
        }
        continue;
      }
      const f = color(p.fill), s = color(p.stroke);
      const op = p.opacity ?? 1;
      slide.addShape(p.r && p.r > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
        x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h),
        fill: f ? { color: f.color, transparency: Math.max(f.transparency ?? 0, Math.round((1 - op) * 100)) } : { color: 'FFFFFF', transparency: 100 },
        line: s ? { color: s.color, width: Math.max(0.25, (p.sw ?? 0.3) * 2.835), dashType: p.dash ? 'dash' : 'solid' } : { type: 'none' },
        rectRadius: p.r ? Math.min(0.5, p.r / Math.min(p.w, p.h)) : undefined
      } as any);
    } else if (p.k === 'ellipse') {
      const f = color(p.fill), s = color(p.stroke);
      slide.addShape(pptx.ShapeType.ellipse, {
        x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h),
        fill: f ? { color: f.color, transparency: Math.round((1 - (p.opacity ?? 1)) * 100) } : { color: 'FFFFFF', transparency: 100 },
        line: s ? { color: s.color, width: Math.max(0.25, (p.sw ?? 0.3) * 2.835) } : { type: 'none' }
      } as any);
    } else if (p.k === 'line') {
      const s = color(p.stroke)!;
      const x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2);
      slide.addShape(pptx.ShapeType.line, { x: X(x), y: Y(y), w: L(Math.abs(p.x2 - p.x1)), h: L(Math.abs(p.y2 - p.y1)), line: { color: s.color, width: Math.max(0.25, (p.sw ?? 0.3) * 2.835), dashType: p.dash ? 'sysDot' : 'solid' } } as any);
    } else if (p.k === 'text') {
      const raw = !p.id ? undefined : p.scope === 'model' ? o.overrides?.[p.id] : index === (o.docIndex ?? 0) ? o.overrides?.[p.id] : undefined;
      const text = (raw ?? p.text) || '';
      if (!text.trim()) continue;
      const t: PText = { ...p, text };
      const c = color(p.color);
      slide.addText(p.caps ? text.toUpperCase() : text, {
        x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h), fontFace: PPT_FONT[p.font || 'sans'], fontSize: fitSize(t), bold: p.bold, italic: p.italic,
        color: c?.color || '111111', transparency: c?.transparency, align: p.align || 'left', valign: p.valign || 'middle', margin: 0, wrap: !p.shrink,
        charSpacing: p.spacing, lineSpacingMultiple: p.lineH || 1, fit: 'none'
      } as any);
    } else if (p.k === 'image') {
      let src = p.slot === 'foto' ? o.photos?.[index] : o.images[p.slot];
      if (!src) continue;
      if (o.fit) src = await o.fit(src, p.w, p.h, { round: p.round, fit: p.fit, opacity: p.opacity });
      slide.addImage({ data: src, x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h), transparency: o.fit ? 0 : Math.round((1 - (p.opacity ?? 1)) * 100), altText: p.slot } as any);
    } else if (p.k === 'qr') {
      slide.addImage({ data: await qrData(p.value), x: X(p.x), y: Y(p.y), w: L(p.w), h: L(p.h), altText: 'QR de validação' } as any);
    }
  }
}

export async function buildCardsPptx(o: PptxOptions): Promise<Uint8Array> {
  const first = o.items[0]?.front;
  if (!first) throw new Error('Sem cartões para exportar.');
  const pptx = new PptxGenJS();
  const isDiploma = first.w >= 200;
  const vertical = !isDiploma && first.h > first.w;
  const page = isDiploma || vertical ? A4.l : A4.p;
  pptx.defineLayout({ name: 'A4', width: IN(page.w), height: IN(page.h) });
  pptx.layout = 'A4';
  pptx.title = o.title || 'Estúdio de Documentos';
  pptx.author = 'Sistema de Gestão Escolar';

  const gap = o.gap ?? 6;
  const cols = isDiploma ? 1 : vertical ? 4 : 2;
  const rows = isDiploma ? 1 : vertical ? 2 : 4;
  const per = cols * rows;
  const cw = isDiploma ? first.w : first.w, ch = isDiploma ? first.h : first.h;
  const gridW = cols * cw + (cols - 1) * gap, gridH = rows * ch + (rows - 1) * gap;
  const mx = (page.w - gridW) / 2, my = (page.h - gridH) / 2;

  const wantFront = o.sides !== 'verso';
  const wantBack = o.sides !== 'frente' && !isDiploma;
  const sheets = Math.ceil(o.items.length / per);

  for (let s = 0; s < sheets; s++) {
    const chunk = o.items.slice(s * per, s * per + per);
    for (const side of ['front', 'back'] as const) {
      if (side === 'front' && !wantFront) continue;
      if (side === 'back' && !wantBack) continue;
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      for (let i = 0; i < chunk.length; i++) {
        const r = Math.floor(i / cols);
        let c = i % cols;
        if (side === 'back') c = cols - 1 - c; // espelhado para frente-e-verso
        const x = mx + c * (cw + gap), y = my + r * (ch + gap);
        const scene = side === 'front' ? chunk[i].front : chunk[i].back;
        if (!scene) continue;
        await drawScene(pptx, slide, scene, x, y, o, s * per + i, side);
        if (o.cutMarks !== false && !isDiploma) {
          slide.addShape(pptx.ShapeType.rect, { x: IN(x), y: IN(y), w: IN(cw), h: IN(ch), fill: { color: 'FFFFFF', transparency: 100 }, line: { color: 'B0B0B0', width: 0.25, dashType: 'dash' } } as any);
        }
      }
      slide.addText(side === 'front' ? `Frente · folha ${s + 1}/${sheets}` : `Verso (espelhado) · folha ${s + 1}/${sheets}`, { x: IN(4), y: IN(page.h - 6), w: IN(80), h: IN(4), fontSize: 6, color: '999999', margin: 0 } as any);
    }
  }
  const out = await pptx.write({ outputType: 'uint8array' } as any);
  return out as Uint8Array;
}
