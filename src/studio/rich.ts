/**
 * Texto formatado mínimo (negrito, itálico, sublinhado, cor, quebra de linha) partilhado entre a
 * pré-visualização, o DOCX e o PPTX. Guardamos HTML restrito e convertemo-lo em "runs".
 */
import { esc } from './format';

export interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; mono?: boolean; br?: boolean }

export const b = (s: string) => `<b>${esc(s)}</b>`;
export const red = (s: string) => `<b><span style="color:#C00000">${esc(s)}</span></b>`;
export const mono = (s: string) => `<b><span style="font-family:'Courier New'">${esc(s)}</span></b>`;
export const t = (s: string) => esc(s);

const hex = (c: string) => {
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(c);
  if (m) return m[1].length === 3 ? m[1].split('').map((x) => x + x).join('').toUpperCase() : m[1].toUpperCase();
  const rgb = /rgb\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(c);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
};

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** HTML restrito → lista de runs (sem DOM, corre também em Node). */
export function parseRuns(html: string): Run[] {
  const out: Run[] = [];
  const stack: Array<{ tag: string; r: Partial<Run> }> = [];
  const cur = (): Partial<Run> => stack.reduce((acc, s) => ({ ...acc, ...s.r }), {} as Partial<Run>);
  const re = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    const tok = m[0];
    if (tok[0] !== '<') { const text = decode(tok); if (text) out.push({ text, ...cur() }); continue; }
    const closing = tok[1] === '/';
    const tag = /<\/?([a-zA-Z0-9]+)/.exec(tok)![1].toLowerCase();
    if (tag === 'br') { out.push({ text: '\n', br: true }); continue; }
    if (closing) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.splice(i, 1); break; } continue; }
    if (/\/>$/.test(tok)) continue;
    const r: Partial<Run> = {};
    if (tag === 'b' || tag === 'strong') r.bold = true;
    if (tag === 'i' || tag === 'em') r.italic = true;
    if (tag === 'u') r.underline = true;
    const style = /style="([^"]*)"/i.exec(tok)?.[1] || '';
    const colorAttr = /color="([^"]*)"/i.exec(tok)?.[1];
    const col = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1] || colorAttr;
    if (col) r.color = hex(col);
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) r.bold = true;
    if (/font-style\s*:\s*italic/i.test(style)) r.italic = true;
    if (/text-decoration[^;]*underline/i.test(style)) r.underline = true;
    if (/font-family[^;]*(courier|mono)/i.test(style)) r.mono = true;
    if (tag === 'div' || tag === 'p') { if (out.length && !out[out.length - 1].br) out.push({ text: '\n', br: true }); }
    stack.push({ tag, r });
  }
  return out;
}

export function htmlToText(html: string): string {
  return parseRuns(html).map((r) => r.text).join('');
}

/**
 * Limpa o HTML produzido pelo contentEditable (div, font, estilos soltos…) para o subconjunto
 * acima. No browser usa o DOM; fora dele cai num filtro por expressão regular.
 */
export function sanitizeHtml(raw: string): string {
  const runs = parseRuns(raw);
  let out = '';
  for (const r of runs) {
    if (r.br) { out += '<br>'; continue; }
    let s = esc(r.text);
    if (r.color) s = `<span style="color:#${r.color}">${s}</span>`;
    if (r.mono) s = `<span style="font-family:'Courier New'">${s}</span>`;
    if (r.underline) s = `<u>${s}</u>`;
    if (r.italic) s = `<i>${s}</i>`;
    if (r.bold) s = `<b>${s}</b>`;
    out += s;
  }
  return out.replace(/(<br>)+$/, '');
}
