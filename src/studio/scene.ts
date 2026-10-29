/**
 * "Cena" = desenho em milímetros feito de primitivas (rect, texto, imagem, linha, QR). A mesma cena
 * alimenta a pré-visualização HTML (editável), a impressão e o PPTX (formas e caixas de texto nativas,
 * editáveis no PowerPoint). Por isso cartões, crachás e diplomas têm exactamente o mesmo desenho
 * em todos os formatos.
 */
export type Fill = string; // #rrggbb
export interface Base { id?: string }

export interface PRect extends Base { k: 'rect'; x: number; y: number; w: number; h: number; fill?: Fill; fill2?: Fill; /** Ângulo do gradiente em graus (CSS: 0 = para cima, 90 = para a direita). Por omissão 135. */ ang?: number; stroke?: Fill; sw?: number; r?: number; opacity?: number; dash?: boolean }
export interface PEllipse extends Base { k: 'ellipse'; x: number; y: number; w: number; h: number; fill?: Fill; stroke?: Fill; sw?: number; opacity?: number }
export interface PLine extends Base { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Fill; sw?: number; dash?: boolean }
export interface PText extends Base {
  k: 'text'; x: number; y: number; w: number; h: number; text: string;
  size: number; // pt
  bold?: boolean; italic?: boolean; color?: Fill; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom';
  font?: 'serif' | 'sans' | 'mono'; spacing?: number; caps?: boolean; editable?: boolean; shrink?: boolean; lineH?: number;
  /** "model" = parte do modelo (cabeçalho, rótulos); "doc" = dados deste aluno/pessoa. */
  scope?: 'model' | 'doc';
}
/** `slot` identifica a imagem substituível: brasao | logo | foto | selo | fundo | assinatura. */
export interface PImage extends Base { k: 'image'; x: number; y: number; w: number; h: number; slot: string; opacity?: number; round?: boolean; r?: number; fit?: 'cover' | 'contain' | 'stretch'; stroke?: Fill; sw?: number }
export interface PQr extends Base { k: 'qr'; x: number; y: number; w: number; h: number; value: string; fg?: Fill; bg?: Fill }

export type Prim = PRect | PEllipse | PLine | PText | PImage | PQr;

export interface Scene {
  w: number; h: number; prims: Prim[]; bleed?: number;
  /** Raio (mm) dos cantos do cartão; 0 = quadrado. Omitido = o do modelo. */
  radius?: number;
}

/** Máximo útil: metade do lado menor de um cartão CR80 (54 mm). */
export const MAX_CARD_RADIUS = 14;

/**
 * Aplica o arredondamento escolhido ao cartão: a moldura e as faixas encostadas aos cantos passam a
 * usar o mesmo raio, e a própria cena recorta nesse raio (ecrã e impressão).
 */
export function applyRadius(scene: Scene, radius: number): Scene {
  const r = Math.max(0, Math.min(MAX_CARD_RADIUS, radius));
  const prims = scene.prims.map((p): Prim => {
    if (p.k !== 'rect') return p;
    const full = p.w >= scene.w - 1.2 && p.x <= 0.5;
    const touchesTop = p.y <= 0.5, touchesBottom = p.y + p.h >= scene.h - 0.5;
    if (!full || !(touchesTop || touchesBottom)) return p;
    // moldura/fundo de cartão inteiro, ou faixa de cabeçalho/rodapé: acompanha o canto
    return { ...p, r: r || undefined };
  });
  return { ...scene, prims, radius: r };
}

/** Largura aproximada (mm) de um texto, para encolher automaticamente linhas longas (nomes). */
const t0 = (s: string) => s === s.toUpperCase() && /[A-ZÀ-Ý]/.test(s);
export function estimateTextWidthMm(text: string, sizePt: number, bold = false, caps = false): number {
  const factor = (bold ? 0.58 : 0.5) + (caps || t0(text) ? 0.07 : 0);
  const t = caps ? text.toUpperCase() : text;
  return t.length * sizePt * 0.3528 * factor;
}

export function fitSize(p: PText): number {
  if (!p.shrink) return p.size;
  const need = estimateTextWidthMm(p.text, p.size, p.bold, p.caps);
  if (need <= p.w) return p.size;
  return Math.max(5, +(p.size * (p.w / need)).toFixed(2));
}

export const FONT_STACK: Record<NonNullable<PText['font']>, string> = {
  serif: "'Times New Roman', Times, serif",
  sans: "Arial, Helvetica, sans-serif",
  mono: "'Courier New', Courier, monospace"
};
export const PPT_FONT: Record<NonNullable<PText['font']>, string> = { serif: 'Times New Roman', sans: 'Arial', mono: 'Courier New' };

export const stripTags = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
