/**
 * Destaque animado de cards ao passar o rato.
 *
 *  - Card com borda COLORIDA  → fundo passa a 100 % da cor da borda; texto branco ou escuro (o que contrastar).
 *  - Card com borda BRANCA / PRETA / cinzenta (ou sem borda) → fundo azul do menu lateral (#12498a) e texto branco.
 *  - Ícone com fundo (kpi-icon) → troca para o par inverso, para continuar visível nos temas claro e escuro.
 *
 * A função só calcula as cores e liga a classe `card-hl-on`; a animação ("o card cresce em relação aos outros")
 * está em src/styles/card-highlight.css. Ao sair o rato tudo volta ao normal.
 *
 * Alvos: `.kpi-card`, `.card-hl`, `[data-card-hl]` e, automaticamente, qualquer "card de estatística" de qualquer secção
 * (caixa com borda arredondada, tamanho de card, sem formulários/tabelas, com irmãos parecidos na mesma grelha).
 * Para excluir um card: `data-card-hl="off"`.
 */

export type RGBA = { r: number; g: number; b: number; a: number };

export function parseCssColor(value: string | null | undefined): RGBA | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

/** Azul do menu lateral (mesmo valor de --lv-ink / --bm-field-bg). */
export const SIDEBAR_BLUE = '#12498a';

const toCss = (c: RGBA) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

/** Põe `top` por cima de `base` (base opaca). */
export function composite(top: RGBA, base: RGBA): RGBA {
  const a = top.a + base.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * base.a * (1 - top.a)) / a;
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a };
}

export function luminance(c: RGBA): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Branco, preto e cinzentos (pouca saturação) contam como "neutros". */
export function isNeutralColor(c: RGBA): boolean {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 24;
}

export interface HighlightInput {
  /** Cor da borda (null/transparente/largura 0 = sem borda). */
  border: RGBA | null;
  /** Cor do texto do card. */
  text: RGBA;
  /** Fundo efectivo (opaco) do card, já composto com o que está por baixo. */
  background: RGBA;
}

export function pickHighlightColors(i: HighlightInput): { bg: string; fg: string; mode: 'color' | 'invert' } {
  const b = i.border;
  if (b && b.a >= 0.05 && !isNeutralColor(b)) {
    const bg: RGBA = { ...b, a: 1 };
    // Texto com o maior contraste sobre a cor da borda (branco ou azul-noite).
    const L = luminance(bg);
    const whiteContrast = 1.05 / (L + 0.05);
    const darkContrast = (L + 0.05) / (0.006 + 0.05);
    const fg = darkContrast > whiteContrast ? '#0b1220' : '#ffffff';
    return { bg: toCss(bg), fg, mode: 'color' };
  }
  // Cards neutros (borda branca/preta/cinzenta ou sem borda): ao passar o rato ficam com o azul do menu lateral
  // e texto branco (antes inverticam para preto).
  return { bg: SIDEBAR_BLUE, fg: '#ffffff', mode: 'invert' };
}

function effectiveBackground(el: HTMLElement): RGBA {
  const dark = document.documentElement.getAttribute('data-color-mode') === 'dark';
  let base: RGBA = dark ? { r: 11, g: 18, b: 32, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  const layers: RGBA[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = parseCssColor(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
  }
  for (let i = layers.length - 1; i >= 0; i--) base = composite(layers[i], base);
  return { ...base, a: 1 };
}

export function readHighlightInput(el: HTMLElement): HighlightInput {
  const cs = getComputedStyle(el);
  const width = parseFloat(cs.borderTopWidth) || 0;
  const border = width > 0 && cs.borderTopStyle !== 'none' ? parseCssColor(cs.borderTopColor) : null;
  const text = parseCssColor(cs.color) || { r: 15, g: 23, b: 42, a: 1 };
  return { border, text, background: effectiveBackground(el) };
}

const DEFAULT_SELECTOR = '.kpi-card, .card-hl, [data-card-hl]:not([data-card-hl="off"])';
const TRANSITION =
  'transform .32s cubic-bezier(.34,1.56,.64,1), background-color .22s ease, color .22s ease, border-color .22s ease, box-shadow .32s ease, opacity .25s ease, filter .25s ease';

// ---------------------------------------------------------------------------
// Deteção automática de cards (secções que não usam a classe .kpi-card)
// ---------------------------------------------------------------------------
const NOT_CARD_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'FORM', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'LI', 'UL', 'OL', 'SELECT', 'INPUT', 'TEXTAREA', 'OPTION', 'LABEL', 'SVG']);

function classSimilarity(a: Element, b: Element): number {
  const A = new Set(Array.from(a.classList)); const B = new Set(Array.from(b.classList));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** Irmãos "do mesmo grupo" (mesma etiqueta e classes parecidas): os outros cards da grelha. */
function cardGroup(el: HTMLElement): HTMLElement[] {
  const parent = el.parentElement;
  if (!parent) return [];
  return (Array.from(parent.children) as HTMLElement[]).filter((o) => o !== el && o.tagName === el.tagName && classSimilarity(el, o) >= 0.5);
}

export function isStatCard(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.classList.contains('card-hl-on')) return true;
  if (NOT_CARD_TAGS.has(el.tagName.toUpperCase())) return false;
  if (el.closest('[data-card-hl="off"], table, nav, aside')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 110 || r.width > 560 || r.height < 52 || r.height > 260) return false;
  const cs = getComputedStyle(el);
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => (parseFloat((cs as any)[`border${side}Width`]) || 0) > 0 && (cs as any)[`border${side}Style`] !== 'none');
  if (!hasBorder || (parseFloat(cs.borderTopLeftRadius) || 0) < 6) return false;
  if ((el.textContent || '').trim().length > 200) return false;
  if (el.querySelector('input, select, textarea, table, form, canvas')) return false;
  return cardGroup(el).length >= 1;
}

function findCard(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-card-hl="off"]')) return null;
  let n: Element | null = target;
  for (let depth = 0; n && n !== document.body && depth < 8; depth++, n = n.parentElement) {
    if (n.matches(selector)) return n as HTMLElement;
    if (isStatCard(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aplicar / remover (estilos inline com !important: ganham a qualquer folha de estilo do tema claro/escuro)
// ---------------------------------------------------------------------------
type Touched = Array<[HTMLElement, string]>;
const touchedBy = new WeakMap<HTMLElement, Touched>();
const peersBy = new WeakMap<HTMLElement, HTMLElement[]>();

function put(el: HTMLElement, prop: string, value: string, list: Touched) {
  el.style.setProperty(prop, value, 'important');
  list.push([el, prop]);
}

function ensureMotion(el: HTMLElement) {
  if (!el.style.transition) { el.style.transition = TRANSITION; el.setAttribute('data-hl-t', '1'); }
  if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; el.setAttribute('data-hl-p', '1'); }
}

/** Caixas de ícone: elemento com glifo/ícone dentro e fundo ou borda próprios (o "ícone com fundo e borda"). */
function findIconBoxes(card: HTMLElement): HTMLElement[] {
  const boxes = new Set<HTMLElement>();
  card.querySelectorAll('.material-symbols-outlined, svg, i[class*="fa"]').forEach((g) => {
    const box = g.parentElement;
    if (!box || box === card) return;
    const cs = getComputedStyle(box);
    const bg = parseCssColor(cs.backgroundColor);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    if ((bg && bg.a > 0.05) || bw > 0) boxes.add(box);
  });
  return Array.from(boxes);
}

/** Activa/desactiva o destaque num card (exportada para usar à mão). */
export function setCardHighlight(el: HTMLElement, on: boolean): void {
  if (!on) {
    el.classList.remove('card-hl-on');
    el.style.removeProperty('--hl-bg');
    el.style.removeProperty('--hl-fg');
    (touchedBy.get(el) || []).forEach(([n, prop]) => n.style.removeProperty(prop));
    touchedBy.delete(el);
    (peersBy.get(el) || []).forEach((p) => p.classList.remove('card-hl-peer'));
    peersBy.delete(el);
    return;
  }
  if (el.classList.contains('card-hl-on')) return;
  const { bg, fg } = pickHighlightColors(readHighlightInput(el));
  const touched: Touched = [];
  ensureMotion(el);
  el.style.setProperty('--hl-bg', bg);
  el.style.setProperty('--hl-fg', fg);

  const iconBoxes = findIconBoxes(el);
  const inIcon = (n: Element) => iconBoxes.some((b) => b === n || b.contains(n));

  // texto e filhos
  el.querySelectorAll<HTMLElement>('*').forEach((n) => {
    if (inIcon(n) || n.matches('.kpi-tag-green, .kpi-tag-red')) return;
    const cs = getComputedStyle(n);
    const nbg = parseCssColor(cs.backgroundColor);
    if (n.classList.contains('kpi-chip')) { put(n, 'background-color', fg, touched); put(n, 'color', bg, touched); return; }
    if (nbg && nbg.a > 0.05) return;                         // etiquetas/barras com cor própria mantêm-se
    put(n, 'color', fg, touched);
    if ((parseFloat(cs.borderTopWidth) || 0) > 0) put(n, 'border-top-color', fg, touched);
  });

  // ícones: par de cores contrário ao do card, para ficarem sempre visíveis (claro e escuro)
  iconBoxes.forEach((box) => {
    if (!box.style.transition) { box.style.transition = TRANSITION; touched.push([box, 'transition']); }
    put(box, 'background-color', fg, touched);
    put(box, 'color', bg, touched);
    put(box, 'border-color', fg, touched);
    put(box, 'transform', 'scale(1.12) rotate(-6deg)', touched);
    box.querySelectorAll<HTMLElement>('*').forEach((g) => put(g, 'color', bg, touched));
  });

  el.classList.add('card-hl-on');
  // inline também no próprio card (vence regras !important do tema)
  put(el, 'background-color', bg, touched);
  put(el, 'color', fg, touched);
  put(el, 'border-color', bg, touched);
  touchedBy.set(el, touched);

  // vizinhos recuam
  const peers = cardGroup(el).concat(Array.from(el.parentElement?.children || []).filter((o): o is HTMLElement => o instanceof HTMLElement && o !== el && o.matches(DEFAULT_SELECTOR)));
  const uniq = Array.from(new Set(peers));
  uniq.forEach((p) => { ensureMotion(p); p.classList.add('card-hl-peer'); });
  peersBy.set(el, uniq);
}

let installed = false;

/** Liga o destaque a todos os cards (inclusive os criados mais tarde) com um único conjunto de ouvintes. */
export function installCardHighlight(selector: string = DEFAULT_SELECTOR): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  let active: HTMLElement | null = null;

  const over = (e: Event) => {
    const card = findCard(e.target, selector);
    if (!card) return;
    const from = (e as MouseEvent).relatedTarget as Node | null;
    if (from && card.contains(from)) return;          // continua dentro do mesmo card
    if (active && active !== card) setCardHighlight(active, false);
    active = card;
    setCardHighlight(card, true);
  };
  const out = (e: Event) => {
    if (!active) return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (to && active.contains(to)) return;
    setCardHighlight(active, false);
    active = null;
  };

  document.addEventListener('mouseover', over);
  document.addEventListener('mouseout', out);
  document.addEventListener('focusin', over);
  document.addEventListener('focusout', out);
  window.addEventListener('blur', out);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mouseout', out);
    document.removeEventListener('focusin', over);
    document.removeEventListener('focusout', out);
    window.removeEventListener('blur', out);
    installed = false;
  };
}
