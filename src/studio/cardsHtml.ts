/**
 * Modelos de cartão fiéis aos desenhos HTML fornecidos (19 modelos, cada um nas duas posições),
 * o verso "Talão de Propinas" (10 meses, RUPE) e as variantes horizontal/vertical dos modelos
 * que só existiam numa posição. Tudo é desenhado em "píxeis do HTML" (cartão horizontal 440 px,
 * vertical 270 px de largura) e convertido para milímetros reais, para que a pré-visualização,
 * a impressão e o PPTX saiam iguais ao desenho original.
 */
import type { Prim, PText, Scene } from './scene';
import { estimateTextWidthMm } from './scene';
import type { CardCtx, CardModel } from './cards';
import { upper } from './format';
import { barOf } from '../utils/publicLink';

const CW = 85.6;
const CH = 53.98;
export type Orient = 'h' | 'v';

interface RO { fill?: string; fill2?: string; ang?: number; stroke?: string; sw?: number; r?: number; op?: number; dash?: boolean }
interface TO {
  bold?: boolean; italic?: boolean; color?: string; align?: 'left' | 'center' | 'right'; font?: 'serif' | 'sans' | 'mono';
  valign?: 'top' | 'middle' | 'bottom'; shrink?: boolean; spacing?: number; caps?: boolean; model?: boolean; h?: number;
  /** Sublinhado (cor): linha por baixo do texto. */ ul?: string; ulDash?: boolean; lineH?: number;
}
interface IO { fit?: 'cover' | 'contain' | 'stretch'; r?: number; round?: boolean; stroke?: string; sw?: number; op?: number }

/** Tela em píxeis do HTML original → Cena em milímetros. */
/** Padrões Code 128 (larguras barra/espaço alternadas), índices 0–106 (106 = fim). */
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
/** Larguras (em módulos) de um símbolo Code 128-B completo: início + dados + controlo + fim. */
export function code128B(text: string): number[] {
  const codes = [104];
  for (const ch of text) { const c = ch.charCodeAt(0); codes.push(c >= 32 && c <= 126 ? c - 32 : 0); }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.flatMap((c) => C128[c].split('').map(Number));
}

export class Cv {
  prims: Prim[] = [];
  readonly W: number;
  readonly H: number;
  readonly k: number;
  constructor(readonly o: Orient) {
    this.k = o === 'h' ? CW / 440 : CH / 270;
    this.W = o === 'h' ? 440 : 270;
    this.H = o === 'h' ? (440 * CH) / CW : (270 * CW) / CH;
  }
  m = (n: number) => +(n * this.k).toFixed(3);
  pt = (px: number) => Math.max(3.4, +(px * this.k * 2.8346).toFixed(2));
  rect(x: number, y: number, w: number, h: number, o: RO = {}) {
    this.prims.push({
      k: 'rect', x: this.m(x), y: this.m(y), w: this.m(w), h: this.m(h), fill: o.fill, fill2: o.fill2, ang: o.ang, stroke: o.stroke,
      sw: o.sw != null ? this.m(o.sw) : undefined, r: o.r != null ? this.m(o.r) : undefined, opacity: o.op, dash: o.dash
    });
    return this;
  }
  ell(x: number, y: number, w: number, h: number, o: RO = {}) {
    this.prims.push({ k: 'ellipse', x: this.m(x), y: this.m(y), w: this.m(w), h: this.m(h), fill: o.fill, stroke: o.stroke, sw: o.sw != null ? this.m(o.sw) : undefined, opacity: o.op });
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1, dash = false) {
    this.prims.push({ k: 'line', x1: this.m(x1), y1: this.m(y1), x2: this.m(x2), y2: this.m(y2), stroke, sw: this.m(sw), dash });
    return this;
  }
  /** Texto: `x,y` = canto superior esquerdo da linha; `px` = corpo em píxeis do HTML. */
  text(id: string, x: number, y: number, w: number, text: string, px: number, o: TO = {}) {
    const h = o.h ?? Math.ceil(px * 1.45);
    const p: PText = {
      k: 'text', id, x: this.m(x), y: this.m(y), w: this.m(w), h: this.m(h), text, size: this.pt(px), bold: o.bold, italic: o.italic,
      color: o.color, align: o.align, valign: o.valign, font: o.font ?? 'sans', shrink: o.shrink, spacing: o.spacing, caps: o.caps,
      lineH: o.lineH, scope: o.model ? 'model' : 'doc', editable: true
    };
    this.prims.push(p);
    if (o.ul && text) {
      const est = estimateTextWidthMm(text, p.size, o.bold, o.caps) / this.k;
      const lw = Math.min(w, est);
      const lx = o.align === 'center' ? x + (w - lw) / 2 : o.align === 'right' ? x + w - lw : x;
      this.line(lx, y + h * 0.92, lx + lw, y + h * 0.92, o.ul, 0.6, o.ulDash);
    }
    return this;
  }
  /** Texto fixo do modelo (cabeçalho, rótulos): vale para todos os alunos. */
  lbl(id: string, x: number, y: number, w: number, text: string, px: number, o: TO = {}) {
    return this.text(id, x, y, w, text, px, { ...o, model: true });
  }
  /** "RÓTULO: valor" na mesma linha. */
  kv(id: string, x: number, y: number, w: number, label: string, value: string, px: number, o: TO & { lc?: string; vc?: string; vb?: boolean; vf?: TO['font']; vShrink?: boolean } = {}) {
    const lw = estimateTextWidthMm(label, this.pt(px), o.bold, false) / this.k + 2.5;
    this.lbl(`${id}-l`, x, y, lw + 2, label, px, { color: o.lc ?? o.color, bold: o.bold, italic: o.italic, font: o.font });
    this.text(id, x + lw, y, Math.max(8, w - lw), value, px, { color: o.vc ?? o.color, bold: o.vb ?? true, font: o.vf ?? o.font, shrink: true, ul: o.ul, ulDash: o.ulDash });
    return this;
  }
  img(slot: string, x: number, y: number, w: number, h: number, o: IO = {}) {
    this.prims.push({
      k: 'image', slot, x: this.m(x), y: this.m(y), w: this.m(w), h: this.m(h), fit: o.fit ?? 'cover', r: o.r != null ? this.m(o.r) : undefined,
      round: o.round, stroke: o.stroke, sw: o.stroke ? this.m(o.sw ?? 1) : undefined, opacity: o.op
    });
    return this;
  }
  /** Moldura + foto 3×4 com cantos arredondados. */
  photo(x: number, y: number, w: number, h: number, o: { border?: string; bw?: number; r?: number; bg?: string } = {}) {
    const bw = o.bw ?? 2;
    this.rect(x, y, w, h, { fill: o.bg ?? '#e2e8f0', stroke: o.border, sw: o.border ? bw : undefined, r: o.r ?? 8 });
    this.img('foto', x + (o.border ? bw : 0), y + (o.border ? bw : 0), w - (o.border ? 2 * bw : 0), h - (o.border ? 2 * bw : 0), { r: Math.max(0, (o.r ?? 8) - (o.border ? bw : 0)) });
    return this;
  }
  qr(x: number, y: number, s: number, value: string, fg?: string, bg?: string) {
    this.prims.push({ k: 'qr', x: this.m(x), y: this.m(y), w: this.m(s), h: this.m(s), value, fg, bg });
    return this;
  }
  /** Bandeira de Angola em miniatura (círculo vermelho/preto com estrela amarela). */
  flag(x: number, y: number, s: number) {
    this.ell(x, y, s, s, { fill: '#c8102e' });
    this.rect(x + s * 0.08, y + s * 0.52, s * 0.84, s * 0.36, { fill: '#111111', r: s * 0.18 });
    this.ell(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4, { fill: '#f6c400' });
    return this;
  }
  /** Código de barras (barras determinísticas a partir de um texto). */
  /** Código de barras Code 128 REAL (subconjunto B) do valor dado, com zonas de silêncio dentro da largura `w`. */
  barcode(x: number, y: number, w: number, h: number, value: string, color: string, op = 1) {
    const widths = code128B(value || 'BANDGEST');
    const total = widths.reduce((a, b) => a + b, 0);
    const mw = w / (total + 16); // 8 módulos de silêncio de cada lado
    let cx = x + 8 * mw, bar = true;
    for (const wd of widths) {
      if (bar) this.rect(cx, y, wd * mw, h, { fill: color, op: op < 1 ? op : undefined });
      cx += wd * mw; bar = !bar;
    }
    return this;
  }
  /** Cartão completo (fundo, gradiente, moldura). */
  base(o: RO = {}) {
    this.rect(0, 0, this.W, this.H, { r: 16, ...o });
    return this;
  }
  slot() { // furo de fita (cartão vertical)
    this.rect((this.W - 32) / 2, 6, 32, 4, { fill: '#000000', op: 0.25, r: 2 });
    return this;
  }
  scene(): Scene {
    return { w: this.o === 'h' ? CW : CH, h: this.o === 'h' ? CH : CW, prims: this.prims };
  }
}

/** Dados do cartão já prontos para os desenhos. */
export interface CardD {
  nome: string; curso: string; classe: string; turma: string; sala: string; ts: string; periodo: string; mat: string; proc: string; bi: string;
  ano: string; val: string; valYear: string; emissao: string; dir: string; escola: string; escolaU: string; sub: string; ctxYear: string; nasc: string;
}
export const dOf = (c: CardCtx): CardD => {
  const f = c.f;
  const val = f.validade ? `12/${f.validade}` : '';
  return {
    nome: f.nome || '', curso: f.curso || f.classe || '', classe: f.classe || '', turma: f.turma || '', sala: f.sala || '',
    ts: [f.turma, f.sala].filter(Boolean).join(' / '), periodo: f.periodo || '', mat: f.matricula || f.proc || '', proc: f.proc || '',
    bi: f.bi || '', ano: f.ano || '', val, valYear: f.validade || '', emissao: f.emissao || '', dir: c.school.directorName || '',
    escola: c.school.name || '', escolaU: upper(c.school.name || ''), sub: c.school.subTitle || c.school.municipality || '', ctxYear: (f.ano || '').split(/\D+/)[0] || '',
    nasc: f.nasc || ''
  };
};
const initial = (s: string) => (s.trim()[0] || 'E').toUpperCase();

// ---------------------------------------------------------------------------------------------
// MODELOS 01–04 (Bita e família): cartão escuro com cabeçalho, grelha de dados e código de barras
// ---------------------------------------------------------------------------------------------
const OS = '#dae2fd', OUT = '#89929b', OSV = '#bfc7d2', BOX = '#131b2e', PRI = '#93ccff', SEC = '#ffb690', TER = '#4edea3';

function bitaH(c: CardCtx, bg: string): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: bg });
  v.ell(12, 12, 32, 32, { fill: PRI, op: 0.2 });
  v.img('logo', 14, 14, 28, 28, { fit: 'contain' });
  v.text('b-inst', 52, 13, 290, d.escolaU, 11, { bold: true, color: OS, shrink: true, model: true });
  v.lbl('b-sub', 52, 28, 290, c.school.decree || d.sub || 'Ensino Superior', 8, { color: OSV, shrink: true });
  v.rect(358, 14, 70, 20, { fill: '#00a572', r: 4 });
  v.lbl('b-badge', 358, 16, 70, 'ESTUDANTE', 9, { bold: true, color: '#00311f', align: 'center' });
  v.rect(12, 64, 96, 128, { fill: '#2d3449', r: 8 });
  v.img('foto', 12, 64, 96, 128, { r: 8 });
  v.rect(120, 64, 308, 36, { fill: BOX, r: 4 });
  v.lbl('b-l1', 128, 67, 200, 'NOME COMPLETO', 8, { color: OUT, spacing: 0.4 });
  v.text('nome', 128, 78, 292, d.nome, 12, { bold: true, color: OS, shrink: true });
  v.rect(120, 104, 152, 32, { fill: BOX, r: 4 });
  v.lbl('b-l2', 128, 106, 140, 'CURSO', 7, { color: OUT });
  v.text('curso', 128, 116, 140, d.curso, 10, { bold: true, color: OS, shrink: true });
  v.rect(276, 104, 152, 32, { fill: BOX, r: 4 });
  v.lbl('b-l3', 284, 106, 140, 'PERÍODO / TURMA', 7, { color: OUT });
  v.text('pt', 284, 116, 140, [d.periodo, d.turma].filter(Boolean).join(' • '), 10, { color: OS, shrink: true });
  const w3 = 100;
  v.rect(120, 140, w3, 30, { fill: BOX, r: 4 });
  v.lbl('b-l4', 126, 142, 90, 'N.º PROCESSO', 7, { color: OUT });
  v.text('proc', 126, 152, 90, d.proc, 10, { bold: true, color: SEC, font: 'mono', shrink: true });
  v.rect(120 + w3 + 4, 140, w3, 30, { fill: BOX, r: 4 });
  v.lbl('b-l5', 126 + w3 + 4, 142, 90, 'B.I. ANGOLA', 7, { color: OUT });
  v.text('bi', 126 + w3 + 4, 152, 90, d.bi, 8, { color: OS, font: 'mono', shrink: true });
  v.rect(120 + 2 * (w3 + 4), 140, w3, 30, { fill: BOX, r: 4 });
  v.lbl('b-l6', 126 + 2 * (w3 + 4), 142, 90, 'ANO LECTIVO', 7, { color: OUT });
  v.text('ano', 126 + 2 * (w3 + 4), 152, 90, d.ano, 9, { bold: true, color: TER, shrink: true });
  v.rect(12, 236, 416, 30, { fill: '#060e20', op: 0.4, r: 4 });
  v.barcode(22, 242, 128, 18, barOf(c.verifyValue), OS);
  v.text('b-leg', 158, 246, 150, `AO-${d.proc.replace(/\D/g, '')}-${d.ctxYear}`, 8, { color: OUT, font: 'mono' });
  v.ell(344, 247, 8, 8, { fill: TER });
  v.lbl('b-mif', 356, 246, 64, 'MIFARE EV1', 8, { color: OSV });
  return v.scene();
}

function bitaV(c: CardCtx, bg: string): Scene {
  const d = dOf(c);
  const v = new Cv('v').base({ fill: bg }).slot();
  v.ell(12, 18, 26, 26, { fill: PRI, op: 0.2 });
  v.img('logo', 14, 20, 22, 22, { fit: 'contain' });
  v.text('b-inst', 44, 18, 214, d.escolaU, 8.5, { bold: true, color: OS, shrink: true, model: true, h: 14 });
  v.lbl('b-sub', 44, 31, 214, c.school.decree || d.sub || 'Ensino Superior', 7, { color: OSV, shrink: true });
  v.rect(95, 54, 80, 16, { fill: '#00a572', r: 4 });
  v.lbl('b-badge', 95, 56, 80, 'ESTUDANTE', 8.5, { bold: true, color: '#00311f', align: 'center' });
  v.rect(87, 80, 96, 128, { fill: '#2d3449', r: 8 });
  v.img('foto', 87, 80, 96, 128, { r: 8 });
  v.rect(12, 216, 246, 34, { fill: BOX, r: 4 });
  v.lbl('b-l1', 20, 219, 200, 'NOME COMPLETO', 7, { color: OUT });
  v.text('nome', 20, 229, 230, d.nome, 11, { bold: true, color: OS, shrink: true });
  v.rect(12, 254, 246, 28, { fill: BOX, r: 4 });
  v.lbl('b-l2', 20, 256, 200, 'CURSO', 7, { color: OUT });
  v.text('curso', 20, 266, 230, d.curso, 9.5, { bold: true, color: OS, shrink: true });
  v.rect(12, 286, 246, 28, { fill: BOX, r: 4 });
  v.lbl('b-l3', 20, 288, 200, 'PERÍODO / TURMA', 7, { color: OUT });
  v.text('pt', 20, 298, 230, [d.periodo, d.turma].filter(Boolean).join(' • '), 9.5, { color: OS, shrink: true });
  const w3 = 79;
  [['b-l4', 'N.º PROCESSO', 'proc', d.proc, SEC, 'mono'], ['b-l5', 'B.I. ANGOLA', 'bi', d.bi, OS, 'mono'], ['b-l6', 'ANO LECTIVO', 'ano', d.ano, TER, 'sans']].forEach(([lid, l, id, val, col, ft], i) => {
    const x = 12 + i * (w3 + 4);
    v.rect(x, 318, w3, 30, { fill: BOX, r: 4 });
    v.lbl(lid, x + 5, 320, w3 - 8, l, 6.5, { color: OUT });
    v.text(id, x + 5, 331, w3 - 8, val, 8.5, { bold: id !== 'bi', color: col, font: ft as TO['font'], shrink: true });
  });
  v.rect(12, 386, 246, 30, { fill: '#060e20', op: 0.4, r: 4 });
  v.barcode(20, 392, 110, 18, barOf(c.verifyValue), OS);
  v.text('b-leg', 138, 396, 116, `AO-${d.proc.replace(/\D/g, '')}-${d.ctxYear}`, 7.5, { color: OUT, font: 'mono' });
  return v.scene();
}

// ---------------------------------------------------------------------------------------------
// VERSO "TALÃO DE PROPINAS" (10 meses: Out → Jul, RUPE) — desenho do HTML do Bita
// ---------------------------------------------------------------------------------------------
export interface FeeCell { m: string; paid: boolean; rec: string }
export const FEE_MONTHS = ['OUT', 'NOV', 'DEZ', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL/EX'];
const TAL_BG = '#222a3d', TAL_CELL = '#060e20';

export function talaoBack(c: CardCtx, o: Orient): Scene {
  const d = dOf(c);
  const fees: FeeCell[] = c.fees && c.fees.length === 10 ? c.fees : FEE_MONTHS.map((m) => ({ m, paid: false, rec: '' }));
  const v = new Cv(o).base({ fill: TAL_BG });
  const yr = (c.f.ano || '').replace(/\s/g, '').replace('-', '/');
  const horiz = o === 'h';
  // faixa magnética
  v.rect(10, 10, v.W - 20, horiz ? 32 : 26, { fill: TAL_CELL, r: 4 });
  v.lbl('t-mag', 22, horiz ? 22 : 17, horiz ? 250 : 120, horiz ? 'HICO 2750 OE MAGNETIC STRIPE TRACK 1/2/3' : 'HICO 2750 OE · TRACK 1/2/3', horiz ? 8 : 6.5, { color: OUT });
  v.lbl('t-enc', horiz ? 300 : 150, horiz ? 22 : 17, horiz ? 120 : 110, 'ENCRYPTED RUPE/SIGFE', horiz ? 8 : 6.5, { color: TER, align: 'right' });
  // título
  if (horiz) {
    v.text('t-tit', 14, 50, 290, `CONTROLO MENSAL DE PROPINAS • ANO LECTIVO ${yr}`, 9, { bold: true, color: SEC, shrink: true });
    v.lbl('t-vis', 300, 51, 126, 'Válido com Carimbo/Visto', 8, { color: OUT, align: 'right' });
  } else {
    v.lbl('t-tit1', 14, 40, 242, 'CONTROLO MENSAL DE PROPINAS', 8.5, { bold: true, color: SEC, shrink: true });
    v.text('t-tit2', 14, 52, 242, `ANO LECTIVO ${yr} · Válido com Carimbo/Visto`, 6.5, { color: OUT, shrink: true });
  }
  // grelha de meses
  const cols = horiz ? 5 : 2;
  const gx = 10, gy = horiz ? 68 : 68, gap = 4;
  const cw = (v.W - 20 - gap * (cols - 1)) / cols;
  const ch = horiz ? 46 : 36;
  fees.forEach((f, i) => {
    const x = gx + (i % cols) * (cw + gap), y = gy + Math.floor(i / cols) * (ch + gap);
    v.rect(x, y, cw, ch, { fill: TAL_CELL, r: 4 });
    v.lbl(`t-m${i}`, x + 5, y + 4, cw / 2, f.m, 8, { bold: true, color: OS });
    v.text(`t-s${i}`, x + cw / 2, y + 4, cw / 2 - 5, f.paid ? 'PAGO' : '—', 8, { bold: f.paid, color: f.paid ? TER : OUT, font: 'mono', align: 'right' });
    v.text(`t-r${i}`, x + 5, y + (horiz ? 17 : 15), cw - 10, f.paid ? `REC: #${f.rec}` : 'RUPE: ____', 6.5, { color: f.paid ? OUT : '#3f4850', shrink: true });
    if (f.paid) {
      v.rect(x + 5, y + ch - 14, cw - 10, 9, { fill: TER, op: 0.2, r: 3 });
      v.lbl(`t-v${i}`, x + 5, y + ch - 14, cw - 10, 'VISTO TES.', 6, { bold: true, color: TER, align: 'center', h: 9 });
    } else {
      v.rect(x + 5, y + ch - 14, cw - 10, 9, { fill: TAL_BG, r: 3 });
    }
  });
  // QR, condições e assinatura
  const py = horiz ? 206 : 276, ph = horiz ? 62 : 142;
  v.rect(10, py, v.W - 20, ph, { fill: TAL_CELL, op: 0.6, r: 4 });
  if (horiz) {
    v.rect(16, py + 7, 48, 48, { fill: '#ffffff', r: 4 });
    v.qr(20, py + 11, 40, c.verifyValue);
    v.lbl('t-term', 72, py + 8, 190, 'Este cartão é pessoal e intransmissível. A apresentação com as propinas regularizadas é indispensável para acesso às aulas, avaliações e biblioteca.', 7, { color: OSV, valign: 'top', lineH: 1.25, h: 34 });
    v.lbl('t-perda', 72, py + 44, 190, 'Perda ou extravio: Secretaria Geral ou WhatsApp do Instituto.', 6.5, { color: OUT, h: 10, shrink: true });
    v.text('t-ass', 318, py + 8, 96, d.dir ? initialsName(d.dir) : '', 8, { italic: true, color: PRI, align: 'center' });
    v.line(318, py + 28, 414, py + 28, '#89929b', 0.8);
    v.lbl('t-dir', 312, py + 32, 108, 'A DIRECÇÃO / TESOURARIA', 6.5, { color: OSV, align: 'center' });
  } else {
    v.rect(18, py + 8, 54, 54, { fill: '#ffffff', r: 4 });
    v.qr(22, py + 12, 46, c.verifyValue);
    v.lbl('t-term', 80, py + 8, 170, 'Este cartão é pessoal e intransmissível. A apresentação com as propinas regularizadas é indispensável para acesso às aulas, avaliações e biblioteca.', 6.5, { color: OSV, valign: 'top', lineH: 1.25, h: 58 });
    v.lbl('t-perda', 18, py + 70, 232, 'Perda ou extravio: Secretaria Geral ou WhatsApp do Instituto.', 6.5, { color: OUT, h: 10, shrink: true });
    v.text('t-ass', 60, py + 94, 150, d.dir ? initialsName(d.dir) : '', 8, { italic: true, color: PRI, align: 'center' });
    v.line(60, py + 112, 210, py + 112, '#89929b', 0.8);
    v.lbl('t-dir', 50, py + 116, 170, 'A DIRECÇÃO / TESOURARIA', 6.5, { color: OSV, align: 'center' });
  }
  return v.scene();
}
/** "Maria dos Santos Neto" → "M. Neto" (como a rubrica do HTML). */
const initialsName = (n: string) => { const p = n.trim().split(/\s+/); return p.length < 2 ? n : `${p[0][0]}. ${p[p.length - 1]}`; };

/** Sigla da instituição para os emblemas dos modelos (ex.: "Instituto Politécnico do Bita" → "IPB"). */
export const siglaOf = (name: string): string => {
  const w = (name || '').split(/\s+/).filter((x) => x.length > 2 && /^[A-ZÀ-Ý]/.test(x));
  return (w.map((x) => x[0]).join('') || (name || 'E')[0]).slice(0, 4).toUpperCase();
};

// ---------- peças comuns do cartão vertical ----------
const vName = (v: Cv, y: number, name: string, px: number, color: string, course?: string, cc?: string, cpx = 8) => {
  v.text('nome', 6, y, v.W - 12, upper(name), px, { bold: true, color, align: 'center', shrink: true });
  if (course !== undefined) v.text('curso', 6, y + px * 1.5 + 2, v.W - 12, course, cpx, { bold: true, color: cc ?? color, align: 'center', shrink: true });
};
const vRows = (v: Cv, y: number, rows: Array<[string, string]>, lc: string, vc: string, o: { px?: number; step?: number; x?: number; w?: number; mono?: boolean } = {}) => {
  const px = o.px ?? 6.5, step = o.step ?? 12, x = o.x ?? 12, w = o.w ?? v.W - 24;
  rows.forEach(([l, val], i) => {
    v.lbl(`vr${i}-l`, x, y + i * step, w / 2, l, px, { color: lc });
    v.text(`vr${i}`, x + w / 2 - 6, y + i * step, w / 2 + 6, val, px, { color: vc, align: 'right', font: o.mono ? 'mono' : 'sans', shrink: true });
  });
};
const vFoot = (v: Cv, o: { fill: string; op?: number; l?: string; r?: string; mid?: string; lc: string; rc?: string; h?: number; lf?: TO['font']; rb?: boolean; rpx?: number }) => {
  const h = o.h ?? 24;
  v.rect(0, v.H - h, v.W, h, { fill: o.fill, op: o.op });
  if (o.l !== undefined) v.text('vf-l', 8, v.H - h + (h - 10) / 2, 130, o.l, 6.5, { color: o.lc, font: o.lf, shrink: true });
  if (o.mid !== undefined) v.text('vf-m', 100, v.H - h + (h - 10) / 2, 70, o.mid, 6.5, { color: o.lc, align: 'center', shrink: true });
  if (o.r !== undefined) v.text('vf-r', 130, v.H - h + (h - 12) / 2, 132, o.r, o.rpx ?? 6.5, { color: o.rc ?? o.lc, align: 'right', bold: o.rb, shrink: true });
};
const vSign = (v: Cv, y: number, label: string, o: { color?: string; dash?: boolean; w?: number; name?: string; lpx?: number; bold?: boolean } = {}) => {
  const w = o.w ?? 96;
  v.lbl('v-dir', 6, y, v.W - 12, label, o.lpx ?? 6, { bold: o.bold ?? true, align: 'center', color: o.color ?? '#000' });
  v.line((v.W - w) / 2, y + 17, (v.W + w) / 2, y + 17, o.color ?? '#000', 0.8, o.dash);
  if (o.name) v.text('v-dirn', 6, y + 19, v.W - 12, o.name, 7.5, { bold: true, font: 'serif', align: 'center', shrink: true });
};

// ---------------------------------------------------------------------------------------------
// MODELOS 05–19 — horizontal
// ---------------------------------------------------------------------------------------------
function m5H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#8a1926', fill2: '#147980', ang: 90 });
  v.photo(10, 10, 76, 92, { border: '#ffffff', bw: 2, r: 8 });
  v.lbl('l-oe', 10, 238, 205, 'ORDEM DOS ECONOMISTAS', 5.5, { color: '#fecdd3', spacing: 0.5 });
  v.kv('proc', 10, 247, 205, 'CÉDULA Nº ', d.mat, 6.5, { color: '#ffffff', font: 'mono' });
  v.text('nome', 10, 257, 205, upper(d.nome), 8.5, { bold: true, color: '#ffffff', shrink: true });
  v.ell(388, 10, 32, 32, { fill: '#ffffff' });
  v.lbl('oe', 388, 18, 32, siglaOf(d.escola).slice(0, 3), 8, { bold: true, color: '#9f1239', align: 'center' });
  const o = { lc: '#cffafe', vc: '#cffafe', vb: false };
  v.kv('curso', 240, 124, 190, 'CURSO: ', upper(d.curso), 6.5, { lc: '#cffafe', vc: '#ffffff' });
  v.kv('ts', 240, 136, 190, 'TURMA/SALA: ', d.ts, 6.5, o);
  v.kv('tp', 240, 148, 190, 'TURNO: ', `${d.periodo} | CLASSE: ${d.classe}`, 6.5, o);
  v.kv('bi', 240, 160, 190, 'B.I.: ', d.bi, 6.5, { ...o, vf: 'mono' });
  v.line(240, 249, 430, 249, '#67e8f9', 0.5);
  v.rect(240, 252, 62, 14, { fill: '#000000', op: 0.3, r: 3 });
  v.lbl('bd', 240, 253, 62, 'ESTUDANTE', 7, { bold: true, color: '#fcd34d', align: 'center' });
  v.kv('val', 330, 254, 100, 'Val: ', d.val, 6.5, { lc: '#cffafe', vc: '#fcd34d', vf: 'mono' });
  return v.scene();
}
function m6H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#0e333b' });
  v.rect(10, 10, 28, 28, { fill: '#22d3ee', fill2: '#99f6e4', ang: 45, r: 6 });
  v.lbl('lg', 10, 15, 28, initial(d.escola).toLowerCase(), 12, { bold: true, color: '#042f2e', align: 'center' });
  v.text('inst', 44, 10, 232, d.escolaU, 7.5, { bold: true, color: '#99f6e4', shrink: true, model: true });
  v.lbl('sub', 44, 21, 232, d.sub || 'Escola', 6, { color: '#5eead4', shrink: true });
  v.lbl('tit', 280, 14, 150, 'CARTÃO DE ESTUDANTE', 8.5, { bold: true, color: '#99f6e4', align: 'right' });
  v.line(300, 29, 430, 29, '#2dd4bf', 0.8);
  v.lbl('l1', 12, 54, 120, 'NOME:', 5.5, { color: '#5eead4' });
  v.text('nome', 12, 62, 316, d.nome, 9.5, { bold: true, color: '#ffffff', shrink: true });
  v.lbl('l2', 12, 80, 120, 'CURSO:', 5.5, { color: '#5eead4' });
  v.text('curso', 12, 88, 316, d.curso, 7, { bold: true, color: '#a5f3fc', shrink: true });
  v.kv('ts', 12, 108, 150, 'Turma/Sala: ', d.ts, 6.5, { lc: '#ccfbf1', vc: '#ccfbf1', vb: false });
  v.kv('tp', 168, 108, 150, 'Turno: ', `${d.periodo} (${d.classe})`, 6.5, { lc: '#ccfbf1', vc: '#ccfbf1', vb: false });
  v.kv('mat', 12, 122, 150, 'Matrícula: ', d.mat, 6.5, { lc: '#ccfbf1', vc: '#ccfbf1', vb: false, vf: 'mono' });
  v.kv('bi', 168, 122, 150, 'B.I.: ', d.bi, 6.5, { lc: '#ccfbf1', vc: '#ccfbf1', vb: false, vf: 'mono' });
  v.photo(346, 56, 82, 98, { border: '#2dd4bf', bw: 1, r: 8, bg: '#0f172a' });
  v.rect(0, v.H - 24, 440, 24, { fill: '#000000', op: 0.4 });
  v.barcode(12, v.H - 18, 96, 12, barOf(c.verifyValue), '#ffffff', 0.9);
  v.text('fy', 200, v.H - 18, 228, `Ano: ${d.ano} | Val: ${d.val}`, 6.5, { color: '#99f6e4', align: 'right' });
  return v.scene();
}
function m7H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#c5e8d8', stroke: '#6ee7b7', sw: 1 });
  v.lbl('dne', 12, 8, 44, 'dne', 16, { bold: true, color: '#065f46' });
  v.lbl('dne2', 54, 10, 110, 'DOCUMENTO NACIONAL\nDO ESTUDANTE', 5.5, { bold: true, color: '#064e3b', lineH: 1.1, h: 16 });
  v.ell(360, 10, 22, 22, { fill: '#fbbf24' });
  v.lbl('em', 360, 14, 22, initial(d.escola), 7, { bold: true, color: '#0f172a', align: 'center' });
  v.lbl('sg', 386, 14, 46, siglaOf(d.escola), 7.5, { bold: true, color: '#1e3a8a', shrink: true });
  v.photo(12, 46, 82, 98, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  v.text('nome', 106, 50, 322, upper(d.nome), 9.5, { bold: true, color: '#0f172a', shrink: true });
  v.text('curso', 106, 64, 322, `${upper(d.curso)} • ${upper(c.f.nivel || '')}`, 7.5, { bold: true, color: '#064e3b', shrink: true });
  v.kv('ts', 106, 80, 322, 'TURMA/SALA: ', d.ts, 7, { color: '#1e293b' });
  v.kv('tp', 106, 92, 322, 'TURNO: ', `${d.periodo} (${d.classe})`, 7, { color: '#1e293b', vb: false });
  v.kv('bi', 106, 104, 322, 'B.I.: ', d.bi, 7, { color: '#1e293b', vf: 'mono' });
  v.kv('mat', 106, 116, 322, 'COD. USO: ', d.mat, 7, { color: '#1e293b', vf: 'mono' });
  v.line(0, v.H - 26, 440, v.H - 26, '#6ee7b7', 0.6);
  v.kv('val', 12, v.H - 19, 200, 'Validade: ', d.val, 7, { color: '#1e293b', vc: '#064e3b', vf: 'mono' });
  v.text('yr', 330, v.H - 21, 98, d.ctxYear, 14, { bold: true, color: '#4338ca', align: 'right' });
  return v.scene();
}
function m8H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#196b2e', fill2: '#0284c7', ang: 90 });
  v.lbl('h', 12, 10, 330, 'DOC. DE IDENTIFICAÇÃO ESTUDANTIL', 7.5, { bold: true, color: '#ffffff' });
  v.rect(378, 8, 50, 17, { fill: '#ffffff', r: 4 });
  v.lbl('sg', 378, 10, 50, siglaOf(d.escola), 8, { bold: true, color: '#0284c7', align: 'center' });
  v.photo(12, 40, 82, 98, { border: '#ffffff', bw: 2, r: 8, bg: '#171717' });
  v.rect(106, 42, 322, 30, { fill: '#ffffff', r: 4 });
  v.lbl('l1', 112, 45, 200, 'NOME:', 5, { bold: true, color: '#64748b' });
  v.text('nome', 112, 53, 310, upper(d.nome), 8, { bold: true, color: '#0f172a', shrink: true });
  v.rect(106, 76, 322, 30, { fill: '#ffffff', r: 4 });
  v.lbl('l2', 112, 79, 200, 'CURSO / SÉRIE:', 5, { bold: true, color: '#64748b' });
  v.text('curso', 112, 87, 310, `${d.curso} (${d.classe})`, 7, { bold: true, color: '#065f46', shrink: true });
  v.rect(106, 110, 322, 26, { fill: '#ffffff', r: 4 });
  v.kv('ts', 112, 118, 190, 'Turma/Sala: ', d.ts, 6.5, { color: '#0f172a' });
  v.kv('tp', 310, 118, 112, 'Turno: ', d.periodo, 6.5, { color: '#0f172a' });
  v.rect(0, v.H - 26, 440, 26, { fill: '#facc15' });
  v.text('yr', 12, v.H - 23, 60, d.ctxYear, 12, { bold: true, color: '#020617' });
  v.kv('mat', 150, v.H - 19, 150, 'CIE: ', d.mat, 7, { color: '#020617', vf: 'mono' });
  v.kv('val', 320, v.H - 19, 110, 'Val: ', d.val, 7, { color: '#020617', vf: 'mono' });
  return v.scene();
}
function m9H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#a7e0cd', stroke: '#5eead4', sw: 1 });
  v.lbl('dne', 12, 8, 40, 'dne', 16, { bold: true, color: '#134e4a' });
  v.lbl('dne2', 52, 14, 200, 'DOCUMENTO NACIONAL DO ESTUDANTE', 6, { bold: true, color: '#042f2e' });
  v.ell(400, 8, 28, 28, { fill: '#1e3a8a', stroke: '#ffffff', sw: 1 });
  v.lbl('sg', 400, 16, 28, siglaOf(d.escola).slice(0, 4), 6.5, { bold: true, color: '#ffffff', align: 'center', shrink: true });
  v.photo(12, 46, 82, 98, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  v.text('nome', 106, 50, 322, upper(d.nome), 9.5, { bold: true, color: '#0f172a', shrink: true });
  v.text('curso', 106, 64, 322, `${upper(d.curso)} • ${upper(d.classe)}`, 7, { bold: true, color: '#042f2e', shrink: true });
  v.kv('ts', 106, 80, 322, 'TURMA / SALA: ', d.ts, 7, { color: '#1e293b', vb: false });
  v.kv('tp', 106, 92, 322, 'TURNO: ', `${d.periodo} | ANO: ${d.ano}`, 7, { color: '#1e293b', vb: false });
  v.kv('mat', 106, 104, 322, 'MATRÍCULA: ', d.mat, 7, { color: '#1e293b', vf: 'mono' });
  v.kv('bi', 106, 116, 322, 'B.I.: ', d.bi, 7, { color: '#1e293b', vf: 'mono' });
  v.line(0, v.H - 26, 440, v.H - 26, '#5eead4', 0.6);
  v.kv('val', 12, v.H - 19, 200, 'Validade: ', d.val, 7, { color: '#1e293b', vf: 'mono' });
  v.text('yr', 330, v.H - 21, 98, d.ctxYear, 14, { bold: true, color: '#312e81', align: 'right' });
  return v.scene();
}
function m10H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#0284c7', fill2: '#0c4a6e', ang: 90 });
  v.lbl('h', 12, 10, 330, 'CARTEIRA DE IDENTIFICAÇÃO ESTUDANTIL - CIE', 8, { bold: true, color: '#ffffff', spacing: 0.4, shrink: true });
  v.rect(372, 9, 56, 16, { fill: '#ffffff', op: 0.2, r: 3 });
  v.lbl('of', 372, 11, 56, 'OFICIAL', 6.5, { bold: true, color: '#ffffff', align: 'center' });
  v.photo(12, 40, 82, 98, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  v.lbl('l1', 106, 44, 200, 'NOME COMPLETO:', 5.5, { color: '#7dd3fc' });
  v.text('nome', 106, 52, 322, upper(d.nome), 9, { bold: true, color: '#ffffff', shrink: true });
  v.lbl('l2', 106, 70, 200, 'CURSO / GRAU:', 5.5, { color: '#7dd3fc' });
  v.text('curso', 106, 78, 322, `${d.curso} • ${d.classe}`, 7, { bold: true, color: '#ffffff', shrink: true });
  const o = { lc: '#e0f2fe', vc: '#ffffff', vb: false };
  v.kv('ts', 106, 100, 160, 'Turma/Sala: ', d.ts, 6.5, o);
  v.kv('tp', 276, 100, 150, 'Turno: ', d.periodo, 6.5, o);
  v.kv('mat', 106, 112, 160, 'Matrícula: ', d.mat, 6.5, { ...o, vf: 'mono' });
  v.kv('bi', 276, 112, 150, 'B.I.: ', d.bi, 6.5, { ...o, vf: 'mono' });
  v.rect(0, v.H - 24, 440, 24, { fill: '#000000', op: 0.3 });
  v.lbl('sg', 12, v.H - 18, 120, `${siglaOf(d.escola)} • ${upper(c.school.municipality || c.school.province || 'ANGOLA')}`, 6.5, { bold: true, color: '#bae6fd', shrink: true });
  v.kv('ano', 180, v.H - 18, 160, 'Ano: ', d.ano, 6.5, { lc: '#bae6fd', vc: '#ffffff' });
  v.text('yr', 360, v.H - 21, 68, d.ctxYear, 12, { bold: true, color: '#ffffff', align: 'right' });
  return v.scene();
}
function m11H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#99f6e4', sw: 1 });
  v.rect(0, 0, 440, 34, { fill: '#f0fdfa' });
  v.line(0, 34, 440, 34, '#ccfbf1', 0.8);
  v.ell(12, 6, 24, 24, { fill: '#0d9488' });
  v.lbl('isic', 12, 13, 24, 'ISIC', 6.5, { bold: true, color: '#ffffff', align: 'center' });
  v.lbl('t1', 42, 6, 250, 'INTERNATIONAL STUDENT IDENTITY CARD', 7.5, { bold: true, color: '#134e4a' });
  v.lbl('t2', 42, 18, 250, 'CARTÃO DE ESTUDANTE', 6, { bold: true, color: '#0d9488' });
  v.rect(364, 8, 64, 18, { fill: '#ffffff', stroke: '#99f6e4', sw: 1, r: 4 });
  v.lbl('un', 364, 11, 64, 'UNESCO', 7, { bold: true, color: '#115e59', align: 'center' });
  v.lbl('l0', 12, 42, 200, 'Name | Nome:', 5.5, { bold: true, color: '#94a3b8' });
  v.text('nome', 12, 50, 320, upper(d.nome), 9.5, { bold: true, color: '#042f2e', shrink: true });
  v.kv('curso', 12, 68, 320, 'Curso: ', `${d.curso} (${d.classe})`, 7, { color: '#334155', vc: '#115e59' });
  v.kv('ts', 12, 82, 320, 'Turma / Sala: ', `${d.ts}${d.periodo ? ' • ' + d.periodo : ''}`, 7, { color: '#334155', vb: false });
  v.kv('bi', 12, 96, 320, 'B.I. / ID: ', d.bi, 7, { color: '#334155', vf: 'mono', vb: false });
  v.kv('val', 12, 110, 320, 'Validade: ', d.val, 7, { color: '#334155', vc: '#0f766e', vf: 'mono' });
  v.photo(346, 42, 82, 98, { border: '#14b8a6', bw: 2, r: 8, bg: '#f0fdfa' });
  v.rect(0, v.H - 22, 440, 22, { fill: '#0d9488' });
  v.kv('mat', 12, v.H - 16, 190, 'N.º Matrícula: ', d.mat, 6.5, { color: '#ffffff', vf: 'mono' });
  v.kv('ano', 200, v.H - 16, 130, 'Ano: ', d.ano, 6.5, { color: '#ffffff' });
  v.flag(352, v.H - 17, 11);
  v.lbl('ao', 366, v.H - 16, 62, 'Angola', 6.5, { color: '#ffffff' });
  return v.scene();
}
function m12H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#2b5876' });
  v.rect(0, 0, 440, 24, { fill: '#000000', op: 0.6 });
  v.lbl('h', 0, 6, 440, 'DOCUMENTO ESTUDANTIL • VÁLIDO EM TODO O PAÍS', 8, { bold: true, color: '#ffffff', align: 'center', spacing: 0.4 });
  const pill = (id: string, x: number, y: number, w: number, label: string, val: string, px: number, mono = false) => {
    v.lbl(`${id}-l`, x, y, w, label, 5.5, { bold: true, color: '#bae6fd' });
    v.rect(x, y + 9, w, 18, { fill: '#ffffff', r: 9 });
    v.text(id, x + 8, y + 12, w - 16, val, px, { bold: true, color: '#0f172a', shrink: true, font: mono ? 'mono' : 'sans' });
  };
  pill('nome', 12, 36, 322, 'NOME:', upper(d.nome), 8);
  pill('curso', 12, 72, 158, 'CURSO:', d.curso, 7);
  pill('mat', 176, 72, 158, 'MATRÍCULA:', d.mat, 7, true);
  pill('ts', 12, 108, 158, 'TURMA / SALA:', d.ts, 6.5);
  pill('bi', 176, 108, 158, 'B.I. / IDENTIDADE:', d.bi, 6.5, true);
  v.photo(346, 36, 82, 98, { border: '#ffffff', bw: 2, r: 10, bg: '#ffffff' });
  v.rect(0, v.H - 24, 440, 24, { fill: '#000000', op: 0.8 });
  v.lbl('sg', 12, v.H - 18, 100, siglaOf(d.escola), 6.5, { bold: true, color: '#bae6fd' });
  v.kv('ano', 160, v.H - 18, 130, 'Ano: ', d.ano, 6.5, { lc: '#bae6fd', vc: '#ffffff' });
  v.kv('val', 300, v.H - 18, 128, 'Validade: ', d.val, 6.5, { lc: '#bae6fd', vc: '#ffffff', vf: 'mono' });
  return v.scene();
}
function m13H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ebeef2' });
  v.rect(0, 0, 8, v.H, { fill: '#64748b' });
  v.rect(432, 0, 8, v.H, { fill: '#64748b' });
  v.rect(8, 36, 424, 28, { fill: '#cbd5e1', op: 0.4 });
  v.rect(8, v.H - 52, 424, 36, { fill: '#cbd5e1', op: 0.6 });
  v.lbl('h', 20, 12, 400, 'CARTEIRA DE IDENTIFICAÇÃO ESTUDANTIL', 9, { bold: true, color: '#334155', spacing: 0.4 });
  v.photo(20, 40, 84, 98, { border: '#ffffff', bw: 2, r: 8, bg: '#171717' });
  v.lbl('l1', 116, 42, 200, 'NOME', 6.5, { bold: true, color: '#64748b' });
  v.text('nome', 116, 51, 304, upper(d.nome), 10, { bold: true, color: '#0f172a', shrink: true });
  v.lbl('l2', 116, 70, 200, 'INSTITUIÇÃO DE ENSINO', 6.5, { bold: true, color: '#64748b' });
  v.text('inst', 116, 79, 304, d.escolaU, 7.5, { bold: true, color: '#0f172a', shrink: true, model: true });
  v.kv('curso', 116, 92, 304, 'Graduação: ', `${d.curso} (${d.classe})`, 7, { color: '#334155', vc: '#0f172a' });
  v.kv('bi', 116, 108, 150, 'B.I. / RG: ', d.bi, 7, { lc: '#475569', vc: '#1e293b', vf: 'mono', vb: false });
  v.kv('mat', 276, 108, 144, 'Matr: ', d.mat, 7, { lc: '#475569', vc: '#1e293b', vf: 'mono', vb: false });
  v.text('yr', 20, v.H - 54, 160, d.ctxYear, 30, { bold: true, color: '#cbd5e1', font: 'mono' });
  v.rect(372, v.H - 56, 44, 44, { fill: '#ffffff', stroke: '#94a3b8', sw: 1, r: 4 });
  v.qr(376, v.H - 52, 36, c.verifyValue);
  return v.scene();
}
function m14H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#000000', sw: 5 });
  v.ell(14, 14, 32, 32, { fill: '#fef3c7', stroke: '#f59e0b', sw: 1 });
  v.lbl('sg', 14, 24, 32, siglaOf(d.escola).slice(0, 3), 8, { bold: true, color: '#92400e', align: 'center', font: 'serif' });
  v.flag(211, 12, 18);
  v.lbl('h1', 60, 32, 320, 'REPÚBLICA DE ANGOLA', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.lbl('h2', 60, 41, 320, 'MINISTÉRIO DA EDUCAÇÃO', 6, { bold: true, color: '#1e293b', align: 'center' });
  v.text('h3', 60, 50, 320, d.escolaU, 5.5, { bold: true, color: '#334155', align: 'center', shrink: true, model: true });
  v.kv('tit', 14, 68, 300, 'CARTÃO DE ESTUDANTE Nº ', d.mat, 8.5, { color: '#000000', vf: 'mono', ul: '#000000' });
  v.kv('nome', 14, 94, 330, 'NOME: ', upper(d.nome), 7, { color: '#0f172a', ul: '#000000' });
  v.kv('sala', 14, 112, 80, 'SALA Nº: ', d.sala, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('classe', 94, 112, 90, 'CLASSE: ', d.classe, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('turma', 184, 112, 80, 'TURMA: ', d.turma, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('turno', 264, 112, 80, 'TURNO: ', d.periodo, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('emit', 14, 132, 160, 'EMITIDO AOS: ', d.emissao, 6.5, { color: '#0f172a', vb: false, ul: '#000000' });
  v.kv('val', 180, 132, 160, 'VÁLIDO ATÉ: ', d.val, 6.5, { color: '#0f172a', vf: 'mono', ul: '#000000' });
  v.photo(354, 88, 72, 82, { border: '#000000', bw: 3, r: 16, bg: '#f1f5f9' });
  v.line(14, v.H - 40, 426, v.H - 40, '#e2e8f0', 0.6);
  v.lbl('dir', 14, v.H - 36, 412, 'O DIRECTOR', 7, { bold: true, color: '#000000', align: 'center', spacing: 0.6 });
  v.line(148, v.H - 18, 292, v.H - 18, '#000000', 0.8);
  return v.scene();
}
function m15H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#f4f2e9', stroke: '#94a3b8', sw: 2 });
  v.ell(10, 10, 28, 28, { fill: '#ffffff', stroke: '#2563eb', sw: 1 });
  v.lbl('em', 10, 19, 28, 'ESCOLA', 5.5, { bold: true, color: '#1e40af', align: 'center' });
  v.text('esc', 46, 8, 250, `“${d.escolaU}”`, 9, { bold: true, color: '#0f172a', shrink: true, model: true });
  v.rect(46, 24, 134, 15, { fill: '#facc15', r: 4 });
  v.lbl('tit', 46, 26, 134, 'CARTÃO DE ESTUDANTE', 8, { bold: true, color: '#020617', align: 'center' });
  v.kv('emi', 290, 12, 140, 'Data Emissão: ', d.emissao, 7, { color: '#0f172a', ul: '#000000' });
  v.line(10, 48, 430, 48, '#cbd5e1', 0.6);
  v.photo(10, 58, 82, 98, { border: '#000000', bw: 2, r: 4, bg: '#ffffff' });
  v.kv('nome', 104, 66, 326, 'Nome: ', upper(d.nome), 7.5, { color: '#0f172a', ul: '#000000' });
  v.kv('classe', 104, 86, 160, 'Classe: ', d.classe, 7.5, { color: '#0f172a', ul: '#000000' });
  v.kv('sala', 280, 86, 150, 'Sala Nº: ', d.sala, 7.5, { color: '#0f172a', ul: '#000000' });
  v.kv('turma', 104, 106, 160, 'Turma: ', d.turma, 7.5, { color: '#0f172a', ul: '#000000' });
  v.kv('per', 280, 106, 150, 'Período: ', d.periodo, 7.5, { color: '#0f172a', ul: '#000000' });
  v.kv('mat', 104, 126, 326, 'Matrícula: ', d.mat, 7.5, { color: '#0f172a', vf: 'mono', ul: '#000000' });
  v.line(10, v.H - 30, 430, v.H - 30, '#cbd5e1', 0.6);
  v.lbl('dir', 20, v.H - 24, 90, 'O DIRECTOR', 7, { color: '#0f172a' });
  v.text('dirn', 120, v.H - 25, 200, d.dir, 7.5, { bold: true, font: 'serif', align: 'center', color: '#0f172a', ul: '#000000', shrink: true });
  v.kv('val', 340, v.H - 24, 90, 'Val: ', d.val, 6.5, { color: '#0f172a' });
  return v.scene();
}
function m16H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#000000', sw: 4 });
  v.flag(212, 12, 16);
  v.lbl('h1', 10, 30, 420, 'REPÚBLICA DE ANGOLA', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.text('h2', 10, 39, 420, c.school.province ? `GOVERNO DA PROVÍNCIA DE ${upper(c.school.province)} • DIRECÇÃO DE EDUCAÇÃO` : 'DIRECÇÃO DE EDUCAÇÃO', 5.5, { bold: true, color: '#1e293b', align: 'center', shrink: true, model: true });
  v.text('h3', 10, 50, 420, d.escolaU, 8, { bold: true, color: '#0f172a', align: 'center', shrink: true, model: true });
  v.kv('tit', 10, 62, 420, 'CARTÃO DE ESTUDANTE Nº ', d.mat, 8.5, { color: '#dc2626', font: 'sans', vf: 'mono', bold: true });
  const dot = (y: number) => v.line(14, y, 340, y, '#475569', 0.6, true);
  v.kv('nome', 14, 96, 326, 'Nome: ', upper(d.nome), 7, { color: '#0f172a' }); dot(110);
  v.kv('turno', 14, 120, 90, 'Turno: ', d.periodo, 7, { color: '#0f172a' });
  v.kv('sala', 108, 120, 80, 'Sala: ', d.sala, 7, { color: '#0f172a' });
  v.kv('ano', 192, 120, 148, 'Ano Lectivo: ', d.ano, 7, { color: '#0f172a' }); dot(134);
  v.kv('turma', 14, 144, 100, 'Turma: ', d.turma, 7, { color: '#0f172a' });
  v.kv('mat', 118, 144, 100, 'Nº: ', d.mat, 7, { color: '#0f172a', vf: 'mono' });
  v.kv('bi', 222, 144, 118, 'B.I.: ', d.bi, 7, { color: '#0f172a', vf: 'mono' }); dot(158);
  v.photo(352, 90, 74, 90, { border: '#000000', bw: 2, r: 0, bg: '#f1f5f9' });
  v.lbl('dir', 10, v.H - 34, 420, 'O DIRECTOR', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.line(156, v.H - 18, 284, v.H - 18, '#000000', 0.8);
  return v.scene();
}
function m17H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#000000', sw: 3 });
  v.lbl('wm', 0, 86, 440, siglaOf(d.escola), 62, { bold: true, color: '#eceef1', align: 'center', font: 'serif', h: 80 });
  v.flag(166, 10, 16);
  v.lbl('h1', 40, 28, 300, 'REPÚBLICA DE ANGOLA • MINISTÉRIO DA EDUCAÇÃO', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.text('h2', 40, 37, 300, d.escolaU, 6.5, { bold: true, color: '#1e293b', align: 'center', shrink: true, model: true });
  v.text('tit', 40, 50, 300, `CARTÃO DE ESTUDANTE N.º ${d.mat}${d.ctxYear ? ' / ' + d.ctxYear : ''}`, 8, { bold: true, italic: true, font: 'serif', align: 'center', color: '#000000', shrink: true });
  v.photo(354, 10, 68, 78, { border: '#000000', bw: 2, r: 12, bg: '#f1f5f9' });
  v.kv('nome', 12, 104, 330, 'Nome: ', upper(d.nome), 7, { color: '#0f172a', ul: '#000000' });
  v.kv('ano', 12, 124, 150, 'Ano Lectivo: ', d.ano, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('classe', 166, 124, 100, 'Classe: ', d.classe, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('turma', 270, 124, 150, 'Turma: ', d.turma, 7, { color: '#0f172a', ul: '#000000' });
  v.kv('curso', 12, 144, 400, 'Curso: ', upper(d.curso), 7, { color: '#0f172a', ul: '#000000' });
  v.lbl('dir', 10, v.H - 34, 420, 'O DIRECTOR', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.line(156, v.H - 18, 284, v.H - 18, '#000000', 0.8);
  return v.scene();
}
function m18H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#000000', sw: 4 });
  v.rect(352, 4, 84, 92, { fill: '#f1f5f9' });
  v.img('foto', 352, 4, 84, 92);
  v.line(352, 4, 352, 96, '#000000', 2);
  v.line(352, 96, 436, 96, '#000000', 2);
  v.flag(12, 12, 16);
  v.lbl('h1', 12, 32, 330, 'REPÚBLICA DE ANGOLA', 6, { bold: true, color: '#000000' });
  v.text('h2', 12, 41, 330, c.school.province ? `GOVERNO PROVINCIAL DE ${upper(c.school.province)}${c.school.municipality ? ' • ' + upper(c.school.municipality) : ''}` : 'GOVERNO PROVINCIAL', 5.5, { bold: true, color: '#1e293b', shrink: true, model: true });
  v.text('h3', 12, 50, 330, d.escolaU, 7, { bold: true, color: '#000000', shrink: true, model: true });
  v.lbl('tit', 12, 64, 330, 'CARTÃO DE ESTUDANTE', 9, { bold: true, color: '#020617' });
  const dot = (y: number) => v.line(12, y, 428, y, '#000000', 0.6, true);
  v.kv('nome', 12, 112, 416, 'Nome: ', upper(d.nome), 7, { color: '#0f172a' }); dot(124);
  v.kv('mat', 12, 132, 120, 'Nº: ', d.mat, 7, { color: '#0f172a', vf: 'mono' });
  v.kv('sala', 136, 132, 80, 'Sala: ', d.sala, 7, { color: '#0f172a' });
  v.kv('turma', 220, 132, 100, 'Turma: ', d.turma, 7, { color: '#0f172a' });
  v.kv('classe', 324, 132, 104, 'Classe: ', d.classe, 7, { color: '#0f172a' }); dot(144);
  v.kv('per', 12, 152, 160, 'Período: ', d.periodo, 7, { color: '#0f172a' });
  v.kv('ano', 200, 152, 228, 'Ano Letivo: ', d.ano, 7, { color: '#0f172a' }); dot(164);
  v.lbl('dir', 10, v.H - 34, 420, 'A Directora', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.line(148, v.H - 18, 292, v.H - 18, '#000000', 0.8, true);
  return v.scene();
}
function m19H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff', stroke: '#cbd5e1', sw: 1 });
  v.ell(12, 8, 32, 32, { fill: '#ecfdf5', stroke: '#059669', sw: 1 });
  v.lbl('sg', 12, 19, 32, siglaOf(d.escola).slice(0, 3), 7, { bold: true, color: '#065f46', align: 'center' });
  v.rect(52, 10, 170, 17, { fill: '#3e7843', r: 4 });
  v.text('est', 58, 12, 160, c.school.province ? `Província de ${c.school.province}` : d.escola, 8, { bold: true, color: '#ffffff', shrink: true, model: true });
  v.text('tit', 52, 30, 300, `Carteira de Estudante ${d.ctxYear}`, 9.5, { bold: true, color: '#0f172a', shrink: true, model: true });
  v.photo(360, 8, 68, 78, { border: '#cbd5e1', bw: 1, r: 12, bg: '#f1f5f9' });
  const col = (id: string, x: number, label: string, val: string, mono = true) => {
    v.lbl(`${id}-l`, x, 94, 130, label, 6, { color: '#64748b' });
    v.text(id, x, 103, 136, val, 7, { bold: true, color: '#334155', font: mono ? 'mono' : 'sans', shrink: true });
  };
  col('bi', 12, 'B.I.:', d.bi); col('nasc', 154, 'Data Nascimento:', d.nasc, false); col('mat', 296, 'Matrícula:', d.mat);
  v.text('nivel', 12, 122, 416, upper(c.f.nivel || ''), 7.5, { bold: true, color: '#0f172a', shrink: true });
  v.kv('per', 12, 140, 136, 'Turno: ', upper(d.periodo), 6.5, { color: '#334155' });
  v.kv('classe', 154, 140, 136, 'Etapa: ', upper(d.classe), 6.5, { color: '#334155' });
  v.kv('turma', 296, 140, 132, 'Turma: ', upper(d.turma), 6.5, { color: '#334155' });
  v.rect(0, v.H - 38, 440, 38, { fill: '#f8fafc' });
  v.line(0, v.H - 38, 440, v.H - 38, '#e2e8f0', 0.6);
  v.barcode(8, v.H - 31, 424, 24, barOf(c.verifyValue), '#3e7843');
  return v.scene();
}

// ---------------------------------------------------------------------------------------------
// MODELOS 05–19 — vertical (crachá 54 × 85,6 mm)
// ---------------------------------------------------------------------------------------------
function m5V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#8a1926', fill2: '#147980', ang: 180 }).slot();
  v.lbl('t1', 0, 18, 270, 'ORDEM DOS ECONOMISTAS', 6.5, { bold: true, color: '#fecdd3', align: 'center', spacing: 0.5 });
  v.lbl('t2', 0, 28, 270, 'CARTÃO DE ESTUDANTE', 7.5, { bold: true, color: '#fcd34d', align: 'center' });
  v.photo(98, 46, 74, 92, { border: '#ffffff', bw: 2, r: 8 });
  vName(v, 144, d.nome, 9, '#ffffff', d.curso, '#a5f3fc');
  vRows(v, 186, [['Cédula:', d.mat], ['Turma/Sala:', d.ts], ['Turno:', `${d.classe} • ${d.periodo}`], ['B.I.:', d.bi]], '#cffafe', '#ffffff');
  v.line(8, v.H - 26, 262, v.H - 26, '#67e8f9', 0.5);
  v.text('vf-l', 12, v.H - 20, 130, `Ano: ${d.ano}`, 6.5, { color: '#cffafe', font: 'mono' });
  v.text('vf-r', 130, v.H - 20, 128, `Val: ${d.val}`, 6.5, { color: '#fcd34d', align: 'right', bold: true });
  return v.scene();
}
function m6V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#0e333b' }).slot();
  v.text('t1', 0, 18, 270, d.escolaU, 7.5, { bold: true, color: '#99f6e4', align: 'center', shrink: true, model: true });
  v.lbl('t2', 0, 29, 270, 'CARTÃO DE ESTUDANTE', 8, { bold: true, color: '#ffffff', align: 'center' });
  v.photo(98, 46, 74, 92, { border: '#2dd4bf', bw: 1, r: 8, bg: '#0f172a' });
  vName(v, 144, d.nome, 9, '#ffffff', d.curso, '#5eead4');
  vRows(v, 186, [['Turma / Sala:', d.ts], ['Período:', d.periodo], ['Matrícula:', d.mat], ['B.I.:', d.bi]], '#ccfbf1', '#ccfbf1');
  vFoot(v, { fill: '#000000', op: 0.5, l: d.ano, r: `Val: ${d.val}`, lc: '#99f6e4', rc: '#99f6e4' });
  return v.scene();
}
function m7V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#c5e8d8', stroke: '#6ee7b7', sw: 1 }).slot();
  v.lbl('dne', 12, 16, 60, 'dne', 12, { bold: true, color: '#065f46' });
  v.lbl('t1', 130, 20, 128, `${siglaOf(d.escola)} OFICIAL`, 6.5, { bold: true, color: '#1e3a8a', align: 'right' });
  v.photo(98, 40, 74, 92, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  vName(v, 138, d.nome, 9, '#0f172a', d.curso, '#064e3b');
  vRows(v, 180, [['Turma/Sala:', d.ts], ['Classe/Turno:', `${d.classe} (${d.periodo})`], ['Matrícula:', d.mat], ['B.I.:', d.bi]], '#1e293b', '#1e293b');
  v.line(0, v.H - 26, 270, v.H - 26, '#6ee7b7', 0.6);
  v.kv('vf-l', 12, v.H - 19, 130, 'Val: ', d.val, 6.5, { color: '#1e293b' });
  v.text('vf-r', 150, v.H - 21, 108, d.ctxYear, 14, { bold: true, color: '#4338ca', align: 'right' });
  return v.scene();
}
function m8V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#196b2e', fill2: '#0284c7', ang: 180 }).slot();
  v.lbl('t1', 12, 18, 150, 'ID ESTUDANTIL', 7, { bold: true, color: '#ffffff' });
  v.lbl('t2', 150, 17, 108, siglaOf(d.escola), 8, { bold: true, color: '#fcd34d', align: 'right' });
  v.photo(98, 40, 74, 92, { border: '#ffffff', bw: 2, r: 8, bg: '#171717' });
  vName(v, 138, d.nome, 9, '#ffffff', d.curso, '#fcd34d');
  v.rect(12, 182, 246, 52, { fill: '#ffffff', op: 0.92, r: 4 });
  vRows(v, 188, [['Turma / Sala:', d.ts], ['Turno:', `${d.classe} (${d.periodo})`], ['B.I.:', d.bi]], '#0f172a', '#0f172a', { x: 20, w: 230 });
  v.rect(0, v.H - 24, 270, 24, { fill: '#facc15' });
  v.text('vf-y', 8, v.H - 20, 40, d.ctxYear, 11, { bold: true, color: '#020617' });
  v.kv('vf-m', 56, v.H - 17, 100, 'Mat: ', d.mat, 6.5, { color: '#020617' });
  v.kv('vf-r', 170, v.H - 17, 90, 'Val: ', d.val, 6.5, { color: '#020617' });
  return v.scene();
}
function m9V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#a7e0cd', stroke: '#5eead4', sw: 1 }).slot();
  v.lbl('dne', 12, 16, 60, 'dne', 12, { bold: true, color: '#134e4a' });
  v.lbl('t1', 130, 19, 128, siglaOf(d.escola), 7, { bold: true, color: '#1e3a8a', align: 'right' });
  v.photo(98, 40, 74, 92, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  vName(v, 138, d.nome, 9, '#0f172a', d.curso, '#042f2e');
  vRows(v, 180, [['Turma/Sala:', d.ts], ['Turno:', d.periodo], ['Matrícula:', d.mat], ['B.I.:', d.bi]], '#1e293b', '#1e293b');
  v.line(0, v.H - 26, 270, v.H - 26, '#5eead4', 0.6);
  v.kv('vf-l', 12, v.H - 19, 130, 'Val: ', d.val, 6.5, { color: '#1e293b' });
  v.text('vf-r', 150, v.H - 21, 108, d.ctxYear, 14, { bold: true, color: '#312e81', align: 'right' });
  return v.scene();
}
function m10V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#0284c7', fill2: '#0c4a6e', ang: 180 }).slot();
  v.lbl('t1', 0, 18, 270, 'CIE ESTUDANTIL', 8, { bold: true, color: '#ffffff', align: 'center' });
  v.lbl('t2', 0, 30, 270, 'DOCUMENTO OFICIAL', 6, { color: '#bae6fd', align: 'center' });
  v.photo(98, 46, 74, 92, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  vName(v, 144, d.nome, 9, '#ffffff', d.curso, '#bae6fd');
  vRows(v, 186, [['Turma/Sala:', d.ts], ['Período:', d.periodo], ['B.I.:', d.bi]], '#e0f2fe', '#ffffff');
  v.rect(0, v.H - 24, 270, 24, { fill: '#000000', op: 0.4 });
  v.kv('vf-l', 8, v.H - 17, 130, 'Val: ', d.val, 6.5, { color: '#ffffff' });
  v.text('vf-r', 150, v.H - 21, 108, d.ctxYear, 12, { bold: true, color: '#ffffff', align: 'right' });
  return v.scene();
}
function m11V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#99f6e4', sw: 1 }).slot();
  v.lbl('t1', 0, 18, 270, 'ISIC UNESCO', 8, { bold: true, color: '#134e4a', align: 'center' });
  v.lbl('t2', 0, 30, 270, 'INTERNATIONAL STUDENT CARD', 6, { bold: true, color: '#0d9488', align: 'center' });
  v.photo(98, 46, 74, 92, { border: '#14b8a6', bw: 2, r: 8, bg: '#f0fdfa' });
  vName(v, 144, d.nome, 9, '#042f2e', d.curso, '#0f766e');
  vRows(v, 186, [['Turma/Sala:', d.ts], ['Período:', d.periodo], ['B.I.:', d.bi]], '#334155', '#334155');
  v.rect(0, v.H - 24, 270, 24, { fill: '#0d9488' });
  v.kv('vf-l', 8, v.H - 17, 130, 'ID: ', d.mat, 6.5, { color: '#ffffff', vf: 'mono' });
  v.kv('vf-r', 150, v.H - 17, 108, 'Val: ', d.val, 6.5, { color: '#ffffff' });
  return v.scene();
}
function m12V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#2b5876' }).slot();
  v.lbl('t1', 0, 18, 270, 'CARTÃO DE ESTUDANTE', 7.5, { bold: true, color: '#ffffff', align: 'center' });
  v.lbl('t2', 0, 29, 270, 'DOCUMENTO ACADÉMICO OFICIAL', 6, { color: '#bae6fd', align: 'center' });
  v.photo(98, 46, 74, 92, { border: '#ffffff', bw: 2, r: 8, bg: '#ffffff' });
  vName(v, 144, d.nome, 9, '#ffffff', d.curso, '#bae6fd');
  ([['Turma:', d.ts], ['Período:', d.periodo], ['B.I.:', d.bi]] as Array<[string, string]>).forEach(([l, val], i) => {
    const y = 186 + i * 22;
    v.rect(12, y, 246, 18, { fill: '#ffffff', r: 9 });
    v.lbl(`vr${i}-l`, 22, y + 3, 100, l, 6.5, { bold: true, color: '#0f172a' });
    v.text(`vr${i}`, 110, y + 3, 138, val, 6.5, { bold: true, color: '#0f172a', align: 'right', shrink: true });
  });
  v.rect(0, v.H - 24, 270, 24, { fill: '#000000', op: 0.8 });
  v.kv('vf-l', 8, v.H - 17, 130, 'Mat: ', d.mat, 6.5, { lc: '#bae6fd', vc: '#ffffff' });
  v.kv('vf-r', 150, v.H - 17, 108, 'Val: ', d.val, 6.5, { lc: '#bae6fd', vc: '#ffffff' });
  return v.scene();
}
function m13V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ebeef2' });
  v.rect(0, 0, 270, 8, { fill: '#64748b' }); v.rect(0, v.H - 8, 270, 8, { fill: '#64748b' });
  v.slot();
  v.lbl('t1', 0, 20, 270, 'CARTEIRA ESTUDANTIL (UNB)', 7.5, { bold: true, color: '#334155', align: 'center' });
  v.line(111, 34, 159, 34, '#94a3b8', 1);
  v.photo(98, 44, 74, 90, { border: '#ffffff', bw: 2, r: 8, bg: '#171717' });
  vName(v, 140, d.nome, 9.5, '#0f172a', d.curso, '#334155', 7.5);
  v.rect(12, 184, 246, 52, { fill: '#e2e8f0', op: 0.8, stroke: '#cbd5e1', sw: 1, r: 4 });
  vRows(v, 190, [['Turma / Sala:', d.ts], ['Matrícula:', d.mat], ['B.I.:', d.bi]], '#334155', '#1e293b', { px: 7, step: 15, x: 20, w: 230 });
  v.text('yr', 14, v.H - 56, 130, d.ctxYear, 24, { bold: true, color: '#94a3b8', font: 'mono' });
  v.rect(214, v.H - 56, 40, 40, { fill: '#ffffff', stroke: '#94a3b8', sw: 1, r: 4 });
  v.qr(217, v.H - 53, 34, c.verifyValue);
  return v.scene();
}
function m14V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#000000', sw: 5 }).slot();
  v.flag(127, 16, 16);
  v.lbl('t1', 10, 36, 250, 'REPÚBLICA DE ANGOLA', 6.5, { bold: true, color: '#000000', align: 'center' });
  v.text('t2', 10, 46, 250, `“${d.escolaU}”`, 5.5, { bold: true, color: '#1e293b', align: 'center', shrink: true, model: true });
  v.rect(30, 58, 210, 15, { fill: '#f1f5f9', stroke: '#cbd5e1', sw: 1, r: 3 });
  v.lbl('t3', 30, 61, 210, 'CARTÃO DE ESTUDANTE', 7, { bold: true, color: '#000000', align: 'center' });
  v.photo(100, 84, 70, 82, { border: '#000000', bw: 3, r: 16, bg: '#f1f5f9' });
  vName(v, 172, d.nome, 9, '#0f172a');
  v.line(14, 196, 256, 196, '#cbd5e1', 0.6);
  v.kv('r1', 14, 202, 240, 'Sala Nº: ', `${d.sala} | Classe: ${d.classe}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r2', 14, 214, 240, 'Turma: ', `${d.turma} | Turno: ${d.periodo}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r3', 14, 226, 240, 'Nº: ', d.mat, 6.5, { color: '#0f172a', vf: 'mono' });
  v.line(14, 242, 256, 242, '#cbd5e1', 0.6);
  vSign(v, v.H - 50, 'O DIRECTOR', { w: 96 });
  return v.scene();
}
function m15V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#f4f2e9', stroke: '#94a3b8', sw: 2 }).slot();
  v.ell(123, 14, 24, 24, { fill: '#ffffff', stroke: '#2563eb', sw: 1 });
  v.lbl('em', 123, 22, 24, 'ESCOLA', 5, { bold: true, color: '#1e40af', align: 'center' });
  v.text('t1', 10, 42, 250, `“${d.escolaU}”`, 8, { bold: true, color: '#0f172a', align: 'center', shrink: true, model: true });
  v.rect(70, 56, 130, 14, { fill: '#facc15', r: 3 });
  v.lbl('t2', 70, 58, 130, 'CARTÃO DE ESTUDANTE', 7.5, { bold: true, color: '#020617', align: 'center' });
  v.photo(96, 80, 78, 95, { border: '#000000', bw: 2, r: 4, bg: '#ffffff' });
  v.kv('nome', 14, 186, 242, 'Nome: ', upper(d.nome), 7, { color: '#0f172a', ul: '#000000' });
  v.kv('classe', 14, 200, 120, 'Classe: ', d.classe, 7, { color: '#0f172a', vb: false, ul: '#000000' });
  v.kv('sala', 140, 200, 116, 'Sala Nº: ', d.sala, 7, { color: '#0f172a', vb: false, ul: '#000000' });
  v.kv('turma', 14, 214, 120, 'Turma: ', d.turma, 7, { color: '#0f172a', vb: false, ul: '#000000' });
  v.kv('per', 140, 214, 116, 'Período: ', d.periodo, 7, { color: '#0f172a', vb: false, ul: '#000000' });
  v.kv('emi', 14, 228, 242, 'Data de Emissão: ', d.emissao, 7, { color: '#0f172a', vb: false, ul: '#000000' });
  v.line(14, v.H - 62, 256, v.H - 62, '#94a3b8', 0.6);
  vSign(v, v.H - 58, 'O DIRECTOR', { w: 112, name: d.dir });
  return v.scene();
}
function m16V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#000000', sw: 4 }).slot();
  v.flag(127, 16, 16);
  v.text('t1', 10, 36, 250, c.school.province ? `GOVERNO DE ${upper(c.school.province)}` : 'GOVERNO PROVINCIAL', 6.5, { bold: true, color: '#000000', align: 'center', shrink: true, model: true });
  v.lbl('t2', 10, 48, 250, 'CARTÃO DE ESTUDANTE', 7.5, { bold: true, color: '#dc2626', align: 'center' });
  v.photo(100, 66, 70, 85, { border: '#000000', bw: 2, r: 0, bg: '#f1f5f9' });
  vName(v, 156, d.nome, 8.5, '#000000');
  v.line(14, 184, 256, 184, '#000000', 0.6, true);
  v.kv('r1', 14, 190, 242, 'Escola: ', d.escola, 6.5, { color: '#0f172a' });
  v.kv('r2', 14, 202, 242, 'Turma: ', `${d.turma} | Sala: ${d.sala}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r3', 14, 214, 242, 'Nº Mat: ', d.mat, 6.5, { color: '#0f172a', vf: 'mono' });
  v.line(14, 230, 256, 230, '#000000', 0.6, true);
  vSign(v, v.H - 50, 'O Director', { w: 96, lpx: 6 });
  return v.scene();
}
function m17V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#000000', sw: 3 }).slot();
  v.lbl('wm', 0, 150, 270, siglaOf(d.escola), 46, { bold: true, color: '#eceef1', align: 'center', font: 'serif', h: 60 });
  v.text('t1', 10, 22, 250, d.escolaU, 6.5, { bold: true, color: '#000000', align: 'center', shrink: true, model: true });
  v.lbl('t2', 10, 34, 250, 'CARTÃO DE ESTUDANTE', 7.5, { bold: true, italic: true, font: 'serif', color: '#000000', align: 'center' });
  v.photo(100, 56, 70, 85, { border: '#000000', bw: 2, r: 12, bg: '#f1f5f9' });
  vName(v, 146, d.nome, 8.5, '#000000', d.curso, '#334155', 7);
  v.line(14, 184, 256, 184, '#cbd5e1', 0.6);
  v.kv('r1', 14, 190, 242, 'Classe: ', `${d.classe} | Turma: ${d.turma}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r2', 14, 202, 242, 'Ano Lectivo: ', d.ano, 6.5, { color: '#0f172a' });
  v.kv('r3', 14, 214, 242, 'Nº: ', d.mat, 6.5, { color: '#0f172a', vf: 'mono' });
  v.line(14, 230, 256, 230, '#cbd5e1', 0.6);
  vSign(v, v.H - 50, 'O DIRECTOR', { w: 96 });
  return v.scene();
}
function m18V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#000000', sw: 4 }).slot();
  v.text('t1', 10, 22, 250, c.school.name ? `COMPLEXO ${upper(c.school.name.replace(/^complexo\s+(escolar\s+)?/i, ''))}` : '', 6.5, { bold: true, color: '#000000', align: 'center', shrink: true, model: true });
  v.lbl('t2', 10, 34, 250, 'CARTÃO DE ESTUDANTE', 8, { bold: true, color: '#020617', align: 'center' });
  v.photo(98, 54, 74, 88, { border: '#000000', bw: 2, r: 0, bg: '#f1f5f9' });
  vName(v, 148, d.nome, 8.5, '#000000');
  v.line(14, 184, 256, 184, '#000000', 0.6, true);
  v.kv('r1', 14, 190, 242, 'Turma: ', `${d.turma} | Sala: ${d.sala}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r2', 14, 202, 242, 'Classe: ', `${d.classe} | Turno: ${d.periodo}`, 6.5, { color: '#0f172a', vb: false });
  v.kv('r3', 14, 214, 242, 'Ano Letivo: ', d.ano, 6.5, { color: '#0f172a' });
  v.line(14, 230, 256, 230, '#000000', 0.6, true);
  vSign(v, v.H - 50, 'A Directora', { w: 96, dash: true });
  return v.scene();
}
function m19V(c: CardCtx): Scene {
  const d = dOf(c); const v = new Cv('v').base({ fill: '#ffffff', stroke: '#cbd5e1', sw: 1 }).slot();
  v.rect(70, 20, 130, 15, { fill: '#3e7843', r: 4 });
  v.text('t1', 70, 22, 130, c.school.province || d.escola, 7, { bold: true, color: '#ffffff', align: 'center', shrink: true, model: true });
  v.lbl('t2', 0, 40, 270, 'Carteira de Estudante', 8, { bold: true, color: '#0f172a', align: 'center' });
  v.photo(100, 58, 70, 85, { border: '#cbd5e1', bw: 1, r: 12, bg: '#f1f5f9' });
  vName(v, 150, d.nome, 8.5, '#0f172a');
  v.line(12, 184, 258, 184, '#e2e8f0', 0.6);
  v.kv('r1', 12, 192, 246, 'Matrícula: ', d.mat, 6.5, { color: '#334155', vf: 'mono' });
  v.kv('r2', 12, 206, 246, 'Turno: ', `${upper(d.periodo)} | Etapa: ${upper(d.classe)}`, 6.5, { color: '#334155', vb: false });
  v.barcode(12, v.H - 44, 246, 22, barOf(c.verifyValue), '#3e7843');
  return v.scene();
}

// ---------------------------------------------------------------------------------------------
// Crachá de funcionário na horizontal e cartão de transporte na vertical
// ---------------------------------------------------------------------------------------------
export function staffFrontH(c: CardCtx, a: string, b: string): Scene {
  const f = c.f; const v = new Cv('h').base({ fill: '#ffffff' });
  v.rect(0, 0, 440, 62, { fill: a, fill2: b, r: 16 });
  v.rect(0, 40, 440, 22, { fill: a, fill2: b });
  v.img('brasao', 12, 10, 40, 42, { fit: 'contain' });
  v.lbl('h1', 60, 12, 300, 'REPÚBLICA DE ANGOLA', 6.5, { bold: true, color: '#ffffff' });
  v.text('h2', 60, 24, 368, upper(c.school.name), 9, { bold: true, color: '#ffffff', shrink: true, model: true });
  v.photo(12, 76, 96, 128, { border: a, bw: 2, r: 6 });
  v.text('nome', 124, 84, 304, f.nome, 14, { bold: true, color: '#0f172a', shrink: true });
  v.text('cargo', 124, 106, 304, f.cargo, 9.5, { bold: true, color: a, shrink: true });
  v.text('depto', 124, 122, 304, f.depto, 8, { color: '#475569', shrink: true });
  v.lbl('l-n', 124, 156, 120, 'N.º FUNC.', 6, { bold: true, color: '#64748b' });
  v.text('numero', 124, 165, 150, f.numero, 10, { bold: true, shrink: true });
  v.lbl('l-s', 290, 156, 120, 'VALIDADE', 6, { bold: true, color: '#64748b' });
  v.text('validade', 290, 165, 138, f.validade, 10, { bold: true });
  v.rect(0, v.H - 14, 440, 14, { fill: b });
  return v.scene();
}
export function staffBackH(c: CardCtx, a: string): Scene {
  const f = c.f; const v = new Cv('h').base({ fill: '#ffffff' });
  v.rect(0, 0, 440, 26, { fill: a });
  v.lbl('b-t', 0, 7, 440, 'IDENTIFICAÇÃO DO FUNCIONÁRIO', 8, { bold: true, color: '#ffffff', align: 'center' });
  const rows: Array<[string, string, string]> = [['l1', 'B.I. / NIF', [f.bi, f.nif].filter(Boolean).join(' · ')], ['l2', 'ADMISSÃO', f.admissao], ['l3', 'TELEFONE', f.tel], ['l4', 'GRUPO SANGUÍNEO', f.sangue]];
  rows.forEach(([id, l, val], i) => {
    v.lbl(id, 16, 40 + i * 38, 220, l, 6, { bold: true, color: '#64748b' });
    v.text(`${id}v`, 16, 50 + i * 38, 220, val, 9, { shrink: true });
  });
  v.qr(268, 40, 120, c.verifyValue);
  v.lbl('b-qr', 252, 164, 152, 'Controlo de acessos (QR)', 6.5, { color: '#475569', align: 'center' });
  v.lbl('b-1', 16, v.H - 44, 408, 'Propriedade da instituição. Se encontrar este cartão, devolva à Secretaria.', 6.5, { color: '#475569', align: 'center' });
  return v.scene();
}
export function transpFrontV(c: CardCtx, a: string, b: string, ink: string): Scene {
  const f = c.f; const v = new Cv('v').base({ fill: a, fill2: b, ang: 165 });
  v.rect(0, 296, 270, 132, { fill: '#000000', op: 0.12 });
  v.rect(0, 90, 270, 7, { fill: '#ffffff', op: 0.55 });
  v.slot();
  v.img('brasao', 12, 14, 36, 38, { fit: 'contain' });
  v.lbl('h1', 56, 16, 206, 'REPÚBLICA DE ANGOLA · MINISTÉRIO DA EDUCAÇÃO', 5.5, { bold: true, color: ink, shrink: true });
  v.lbl('h2', 56, 28, 206, 'CARTÃO DE TRANSPORTE ESCOLAR', 8.5, { bold: true, color: ink, shrink: true });
  v.text('h3', 56, 44, 206, upper(c.school.name), 6, { color: ink, shrink: true, model: true });
  v.photo(85, 104, 100, 126, { border: '#ffffff', bw: 3, r: 6, bg: '#ffffff' });
  v.lbl('l1', 0, 238, 270, f.lPessoa || 'ALUNO', 5.5, { bold: true, color: ink, align: 'center' });
  v.text('nome', 8, 247, 254, upper(f.nome), 10, { bold: true, color: ink, align: 'center', shrink: true });
  v.lbl('l2', 12, 270, 120, f.lClasse || 'CLASSE / TURMA', 5.5, { bold: true, color: ink });
  v.text('v2', 12, 279, 118, `${(f.classe || '').replace(/\s*classe/i, '')} · ${f.turma}`, 7.5, { bold: true, color: ink, shrink: true });
  v.lbl('l3', 140, 270, 120, f.lProc || 'Nº PROCESSO', 5.5, { bold: true, color: ink });
  v.text('v3', 140, 279, 118, f.proc, 7.5, { bold: true, color: ink, shrink: true });
  v.lbl('l4', 12, 298, 120, 'LINHA / ROTA', 5.5, { bold: true, color: ink });
  v.text('rota', 12, 307, 150, f.rota || '', 7.5, { bold: true, color: ink, shrink: true });
  v.lbl('l5', 12, 336, 120, 'ANO LECTIVO', 5.5, { bold: true, color: ink });
  v.text('ano', 12, 345, 120, f.ano, 7.5, { bold: true, color: ink });
  v.qr(190, 340, 68, c.verifyValue);
  return v.scene();
}
// ---------------------------------------------------------------------------------------------
// CARTÃO DE TRANSPORTE — VERSO (desenho do Modelo 01 do HTML de crachás: furo de fita, faixa
// magnética, painel de dados, termos, duas assinaturas, código de barras + QR). É o mesmo verso
// para todos os modelos de transporte — só muda a cor de destaque (a).
// ---------------------------------------------------------------------------------------------
const TRANSP_MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const TRANSP_DARK = '#0b1120';

/** Cor do rótulo/QR e do texto de rodapé do verso de transporte (muda só a cor do modelo). */
export interface TranspTone { a: string; b?: string; ink?: string }

const transpLocal = (c: CardCtx) => upper(c.school.city || siglaOf(c.school.name));

/** Célula de um mês: nome, caixa de visto (✓ se pago) e VISTADO / PENDENTE. */
function transpMonth(v: Cv, i: number, x: number, y: number, w: number, h: number, paid: boolean, mpx: number) {
  v.rect(x, y, w, h, { fill: '#ffffff', stroke: '#0f172a', sw: 1, r: 5 });
  v.lbl(`tb-m${i}`, x, y + 4, w, TRANSP_MESES[i], mpx, { bold: true, color: '#0f172a', align: 'center' });
  const cb = 14, cx = x + (w - cb) / 2, cy = y + h * 0.36;
  v.rect(cx, cy, cb, cb, { fill: paid ? '#0f172a' : '#ffffff', stroke: paid ? '#0f172a' : '#cbd5e1', sw: 1.2, r: 2.5 });
  if (paid) {
    v.line(cx + 3, cy + 7.5, cx + 6, cy + 10.5, '#ffffff', 1.8);
    v.line(cx + 6, cy + 10.5, cx + 11.2, cy + 3.8, '#ffffff', 1.8);
  }
  v.text(`tb-s${i}`, x, y + h - 12, w, paid ? 'VISTADO' : 'PENDENTE', 4.8, { color: paid ? '#334155' : '#94a3b8', align: 'center', bold: paid });
}

/** Painel do QR de embarque: o QR grava toda a lógica (pessoa + rota + turno + ano) lida pela app do motorista. */
function transpQrPanel(v: Cv, c: CardCtx, x: number, y: number, w: number, h: number, qr: number, tone: TranspTone, inline: boolean) {
  const f = c.f;
  v.rect(x, y, w, h, { fill: '#ffffff', stroke: '#0f172a', sw: 1, r: 6 });
  const qx = inline ? x + 8 : x + (w - qr) / 2;
  v.qr(qx, y + 8, qr, c.verifyValue, '#0f172a', '#ffffff');
  const tx = inline ? x + qr + 18 : x + 6, tw = inline ? w - qr - 24 : w - 12;
  const ty = inline ? y + 8 : y + qr + 14;
  const al = inline ? 'left' : 'center';
  v.lbl('tb-qr1', tx, ty, tw, 'QR DE EMBARQUE', 5.6, { bold: true, color: '#0f172a', align: al, shrink: true });
  v.lbl('tb-qr2', tx, ty + 9, tw, 'VALIDAÇÃO EM TEMPO REAL', 4.4, { color: '#64748b', align: al, shrink: true });
  v.lbl('tb-t', tx, ty + 24, tw, f.lPessoa || 'TITULAR', 4.4, { bold: true, color: tone.a === '#ffffff' ? '#0f172a' : '#475569', align: al });
  v.text('tb-nome', tx, ty + 32, tw, upper(f.nome || ''), 6, { bold: true, color: '#0f172a', align: al, shrink: true });
  v.text('tb-proc', tx, ty + 42, tw, [f.proc, f.ano].filter(Boolean).join(' · '), 5, { color: '#475569', align: al, shrink: true });
  if (inline) v.barcode(tx, ty + 56, Math.min(tw, 130), 16, barOf(c.verifyValue), '#0f172a');
  else v.barcode(x + 8, y + h - 28, w - 16, 14, barOf(c.verifyValue), '#0f172a');
}

/** Verso HORIZONTAL: autorização mensal de 12 meses (desenho do Rincão) + QR de embarque. */
export function transpBackH(c: CardCtx, a: string, b: string = a, ink = '#111827'): Scene {
  const paid = new Set(c.transpPaid || []);
  const v = new Cv('h').base({ fill: TRANSP_DARK });
  v.rect(8, 8, v.W - 16, v.H - 16, { fill: a, stroke: '#020617', sw: 1.5, r: 14 });
  // barra lateral escura com o título na vertical (letras empilhadas)
  v.rect(14, 14, 26, v.H - 28, { fill: '#0f172a', r: 8 });
  v.lbl('tb-tit', 14, 36, 26, 'AUTORIZAÇÃO MENSAL'.split('').join('\n'), 8, { bold: true, color: b, align: 'center', font: 'mono', lineH: 1.02, h: v.H - 70 });
  // grelha 3 × 4
  const gx = 46, gap = 4, cw = 80, rh = 48;
  for (let i = 0; i < 12; i++) transpMonth(v, i, gx + (i % 3) * (cw + gap), 14 + Math.floor(i / 3) * (rh + gap), cw, rh, paid.has(i + 1), 7);
  // QR + dados
  transpQrPanel(v, c, 46 + 3 * cw + 2 * gap + 6, 14, 126, v.H - 28, 62, { a, b, ink }, false);
  // rodapé
  v.lbl('tb-f1', gx, 226, 250, 'Obrigatória apresentação física diária para acesso ao coletivo.', 5.4, { bold: true, color: ink, shrink: true });
  v.lbl('tb-f2', gx, 238, 250, 'Em caso de dano, solicitar segunda via na Secretaria.', 5, { color: ink, shrink: true });
  v.text('tb-loc', gx + 106, 250, 142, `BALN. ${transpLocal(c)}`, 5, { bold: true, color: ink, align: 'right', shrink: true, model: true });
  return v.scene();
}

/** Verso VERTICAL: mesma autorização mensal de 12 meses + QR de embarque. */
export function transpBackV(c: CardCtx, a: string, b: string = a, ink = '#111827'): Scene {
  const paid = new Set(c.transpPaid || []);
  const v = new Cv('v').base({ fill: TRANSP_DARK });
  v.rect(8, 8, v.W - 16, v.H - 16, { fill: a, stroke: '#020617', sw: 1.5, r: 14 });
  v.rect(14, 14, v.W - 28, 22, { fill: '#0f172a', r: 8 });
  v.lbl('tb-tit', 14, 19, v.W - 28, 'AUTORIZAÇÃO MENSAL', 8, { bold: true, color: b, align: 'center', font: 'mono', spacing: 1.2 });
  const gx = 14, gap = 4, cw = (v.W - 28 - 2 * gap) / 3, rh = 48;
  for (let i = 0; i < 12; i++) transpMonth(v, i, gx + (i % 3) * (cw + gap), 42 + Math.floor(i / 3) * (rh + gap), cw, rh, paid.has(i + 1), 6);
  transpQrPanel(v, c, 14, 262, v.W - 28, 112, 92, { a, b, ink }, true);
  v.lbl('tb-f1', 14, 384, v.W - 28, 'Obrigatória apresentação física diária para acesso ao coletivo.', 5, { bold: true, color: ink, shrink: true });
  v.lbl('tb-f2', 14, 395, v.W - 28, 'Em caso de dano, solicitar segunda via na Secretaria.', 4.8, { color: ink, shrink: true });
  v.text('tb-loc', 14, 405, v.W - 28, `BALN. ${transpLocal(c)}`, 4.8, { bold: true, color: ink, align: 'right', shrink: true, model: true });
  return v.scene();
}

// ---------------------------------------------------------------------------------------------
// MODELOS 01 e 02 — redesenhados ponto a ponto a partir do HTML (Politécnico verde e Smart-ID)
// ---------------------------------------------------------------------------------------------
const wpx = (v: Cv, t: string, px: number, bold = false) => estimateTextWidthMm(t, v.pt(px), bold, false) / v.k;
/** "RÓTULO: valor" ancorado à esquerda (l), ao centro (c) ou à direita (r) de x. */
const lv = (v: Cv, id: string, x: number, y: number, label: string, val: string, px: number, a: 'l' | 'c' | 'r', lc: string, vc: string, mono = false) => {
  const lw = wpx(v, label, px, true) + 2.5, vw = Math.max(14, wpx(v, val, px, true)) + 2;
  const x0 = a === 'l' ? x : a === 'c' ? x - (lw + vw) / 2 : x - (lw + vw);
  v.lbl(`${id}-l`, x0, y, lw + 2, label, px, { bold: true, color: lc });
  v.text(id, x0 + lw, y, vw + 6, val, px, { bold: true, color: vc, font: mono ? 'mono' : 'sans', shrink: true });
};
/** Anéis concêntricos (repeating-radial-gradient do HTML). São só decoração: o PPTX ignora-os para não saírem do cartão. */
const rings = (v: Cv, cx: number, cy: number, maxR: number, step: number, op: number) => {
  for (let r = 5; r < maxR; r += step) {
    v.ell(cx - r, cy - r, 2 * r, 2 * r, { stroke: '#ffffff', sw: 0.8, op });
    v.prims[v.prims.length - 1].id = 'deco-ring';
  }
};
const GR = '#087f3b', GRL = '#a7f3d0';

function m1H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: '#ffffff' });
  // cabeçalho
  v.ell(16, 12, 31, 31, { fill: '#ffffff', stroke: GR, sw: 2 });
  v.img('logo', 20, 16, 23, 23, { fit: 'contain' });
  v.text('m1-inst', 53, 14, 230, d.escolaU, 8.6, { bold: true, color: GR, shrink: true, model: true, h: 12 });
  v.lbl('m1-sub', 53, 27, 230, c.school.decree || d.sub || 'Angola', 6.7, { color: '#64748b', shrink: true });
  v.lbl('m1-tit', 238, 15, 186, 'CARTÃO DE ESTUDANTE', 11.5, { bold: true, color: GR, align: 'right', spacing: 0.4, ul: '#fbbf24' });
  v.line(6, 50, v.W - 6, 50, '#d1fae5', 1);
  // foto 3×4
  v.photo(16, 99, 91, 110, { border: '#cbd5e1', bw: 2, r: 10, bg: '#f1f5f9' });
  v.ell(92, 192, 11, 11, { fill: '#a78bfa', stroke: '#ffffff', sw: 1, op: 0.85 });
  // tarjas verdes
  const X0 = 119, W0 = 305, SH = 17.5, XR = X0 + W0 - 8;
  const strip = (y: number) => v.rect(X0, y, W0, SH, { fill: GR, r: 4 });
  strip(58);
  v.lbl('m1-l1', X0 + 8, 62, 50, 'NOME:', 7.7, { bold: true, color: GRL });
  v.text('nome', X0 + 48, 60, W0 - 56, upper(d.nome), 9.6, { bold: true, color: '#ffffff', align: 'right', shrink: true });
  strip(105);
  v.lbl('m1-l2', X0 + 8, 109, 50, 'CURSO:', 7.7, { bold: true, color: GRL });
  v.text('curso', X0 + 48, 107, W0 - 56, upper(d.curso), 9.1, { bold: true, color: '#ffffff', align: 'right', shrink: true });
  strip(148);
  lv(v, 'periodo', X0 + 8, 152, 'PERÍODO:', upper(d.periodo), 7.7, 'l', GRL, '#ffffff');
  lv(v, 'turma', X0 + W0 / 2 + 4, 152, 'TURMA:', d.turma, 7.7, 'c', GRL, '#ffffff');
  lv(v, 'sala', XR, 152, 'SALA:', d.sala, 7.7, 'r', GRL, '#ffffff');
  strip(191);
  lv(v, 'ano', X0 + 8, 195, 'ANO:', d.ano, 7.7, 'l', GRL, '#ffffff');
  lv(v, 'classe', XR, 195, 'CLASSE:', d.classe, 7.7, 'r', GRL, '#ffffff');
  lv(v, 'proc', X0 + 2, 228, 'PROC:', d.proc, 7.2, 'l', '#1e293b', '#065f46', true);
  lv(v, 'bi', X0 + W0 - 2, 228, 'B.I.:', d.bi, 7.2, 'r', '#1e293b', '#065f46', true);
  // rodapé verde
  v.rect(0, v.H - 24, v.W, 24, { fill: GR });
  v.barcode(16, v.H - 20, 108, 15, barOf(c.verifyValue), '#ffffff', 0.95);
  v.text('m1-fid', 130, v.H - 17, 80, d.mat, 6.4, { color: '#d1fae5', font: 'mono', spacing: 1 });
  const tel = c.school.phone ? `Linha Verde: ${c.school.phone}` : '';
  v.text('m1-val', 205, v.H - 17, 219, `Val: ${d.val}${tel ? '  •  ' + tel : ''}`, 6.7, { color: '#d1fae5', align: 'right', shrink: true });
  // moldura verde (por cima de tudo)
  v.rect(3, 3, v.W - 6, v.H - 6, { stroke: GR, sw: 6, r: 14 });
  return v.scene();
}

function m1V(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  v.rect((v.W - 37) / 2, 8, 37, 5.6, { fill: '#cbd5e1', stroke: '#94a3b8', sw: 1, r: 3 });
  v.ell((v.W - 30) / 2, 22, 30, 30, { fill: '#ffffff', stroke: GR, sw: 1.4 });
  v.img('logo', (v.W - 22) / 2, 26, 22, 22, { fit: 'contain' });
  v.text('m1-inst', 10, 56, v.W - 20, d.escolaU, 7.4, { bold: true, color: GR, align: 'center', shrink: true, model: true, h: 10 });
  v.rect((v.W - 124) / 2, 68, 124, 17, { fill: GR, r: 3 });
  v.lbl('m1-tit', (v.W - 124) / 2, 71, 124, 'CARTÃO DE ESTUDANTE', 8.4, { bold: true, color: '#ffffff', align: 'center' });
  v.photo((v.W - 82) / 2, 94, 82, 100, { border: GR, bw: 2, r: 10, bg: '#f8fafc' });
  v.ell((v.W + 82) / 2 - 16, 94 + 100 - 16, 10, 10, { fill: '#a78bfa', stroke: '#ffffff', sw: 1, op: 0.9 });
  v.text('nome', 8, 199, v.W - 16, upper(d.nome), 10.2, { bold: true, color: '#0f172a', align: 'center', shrink: true });
  v.text('curso', 8, 214, v.W - 16, upper(d.curso), 8.4, { bold: true, color: GR, align: 'center', shrink: true });
  const rows: Array<[string, string, string, boolean, string]> = [
    ['Turma/Sala:', [d.turma, d.sala && `Sala ${d.sala}`].filter(Boolean).join(' • '), GR, false, 'turmasala'],
    ['Período/Classe:', `${d.periodo}${d.classe ? ` (${d.classe})` : ''}`, GR, false, 'pc'],
    ['Nº Matrícula:', d.mat, '#0f172a', true, 'proc'],
    ['B.I.:', d.bi, '#0f172a', true, 'bi']
  ];
  rows.forEach(([l, val, col, mono, id], i) => {
    const y = 237 + i * 21;
    v.rect(11, y, v.W - 22, 17, { fill: '#ecfdf5', stroke: '#a7f3d0', sw: 0.8, r: 3 });
    v.lbl(`m1-r${i}`, 17, y + 4, 90, l, 7, { bold: true, color: '#475569' });
    v.text(id, 100, y + 4, v.W - 117, val, 7, { bold: true, color: col, align: 'right', font: mono ? 'mono' : 'sans', shrink: true });
  });
  v.rect(0, v.H - 44, v.W, 44, { fill: GR });
  v.barcode(8, v.H - 39, v.W - 16, 15, barOf(c.verifyValue), '#ffffff', 0.95);
  lv(v, 'ano', 11, v.H - 18, 'Ano:', d.ano, 6.5, 'l', '#d1fae5', '#ffffff', true);
  lv(v, 'val', v.W - 11, v.H - 18, 'Val:', d.val, 6.5, 'r', '#d1fae5', '#ffffff', true);
  v.rect(2.5, 2.5, v.W - 5, v.H - 5, { stroke: GR, sw: 5, r: 14 });
  return v.scene();
}

const SM_BG = '#7f0909', SM_BG2 = '#200000', ROSE3 = '#fda4af', ROSE2 = '#fecdd3';

function m2H(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('h').base({ fill: SM_BG, fill2: SM_BG2, ang: 135 });
  rings(v, 44, 55, 460, 10, 0.12);
  v.lbl('m2-t', 19, 9, 140, 'SMART-ID', 19, { bold: true, color: '#ffffff', spacing: -0.4 });
  v.ell(116, 17, 7, 7, { fill: '#fb7185' });
  v.lbl('m2-s', 19, 35, 220, 'CARTÃO DE ESTUDANTE UNIVERSITÁRIO', 6.2, { bold: true, color: ROSE3, spacing: 0.5 });
  v.lbl('m2-al', 260, 11, 161, 'ANO LECTIVO', 7.7, { bold: true, color: ROSE2, align: 'right', spacing: 1 });
  v.text('ano', 260, 21, 161, d.ano, 13.4, { bold: true, color: '#ffffff', align: 'right', font: 'mono', shrink: true });
  // foto à direita
  const px = 335, py = 94;
  v.photo(px, py, 86, 107, { border: '#9f4752', bw: 2, r: 10, bg: '#171717' });
  v.rect(px + 4, py + 107 - 15, 34, 11, { fill: '#000000', op: 0.7, r: 3 });
  v.lbl('m2-aut', px + 4, py + 107 - 14.5, 34, 'AUT-ID', 6.2, { color: '#ffffff', font: 'mono', align: 'center' });
  // dados
  const L = (id: string, x: number, y: number, t: string) => v.lbl(id, x, y, 140, t, 6.2, { bold: true, color: ROSE3, spacing: 0.4 });
  L('m2-l1', 19, 112, 'NOME DO ESTUDANTE:');
  v.text('nome', 19, 121, 300, d.nome, 11.5, { bold: true, color: '#ffffff', shrink: true });
  L('m2-l2', 19, 146, 'CURSO:');
  v.text('curso', 19, 155, 140, d.curso, 8.6, { bold: true, color: '#ffffff', shrink: true });
  L('m2-l3', 173, 146, 'PERÍODO / CLASSE:');
  v.text('pc', 173, 155, 140, [d.periodo, d.classe].filter(Boolean).join(' • '), 7.7, { color: '#ffffff', shrink: true });
  L('m2-l4', 19, 177, 'MATRÍCULA:');
  v.text('proc', 19, 186, 95, d.mat, 7.7, { bold: true, color: '#ffffff', font: 'mono', shrink: true });
  L('m2-l5', 122, 177, 'TURMA/SALA:');
  v.text('ts', 122, 186, 95, d.ts, 7.7, { color: '#ffffff', shrink: true });
  L('m2-l6', 224, 177, 'VALIDADE:');
  v.text('val', 224, 186, 95, d.val, 7.7, { bold: true, color: '#fcd34d', font: 'mono', shrink: true });
  // tarja inferior
  const fy = v.H - 34;
  v.rect(0, fy, v.W, 34, { fill: '#000000', op: 0.4 });
  v.line(0, fy, v.W, fy, '#6b1a24', 0.8);
  v.rect(19, fy + 5.5, 23, 23, { fill: '#ffffff', r: 2.5 });
  v.qr(20.5, fy + 7, 20, c.verifyValue, '#000000', '#ffffff');
  lv(v, 'bi', 50, fy + 7, 'B.I.', d.bi, 7.2, 'l', '#ffffff', '#ffffff', true);
  v.lbl('m2-lei', 50, fy + 18, 240, 'Documento estudantil emitido nos termos da Lei', 6.2, { color: ROSE3 });
  v.barcode(329, fy + 9.5, 92, 15, barOf(c.verifyValue), '#ffffff', 0.9);
  return v.scene();
}

function m2V(c: CardCtx): Scene {
  const d = dOf(c);
  const v = new Cv('v').base({ fill: SM_BG, fill2: '#1a0000', ang: 180 });
  rings(v, 135, 43, 420, 10, 0.12);
  v.rect((v.W - 37) / 2, 8, 37, 5.6, { fill: '#4c0519', stroke: '#8f3a45', sw: 1, r: 3 });
  const tw = wpx(v, 'SMART-ID', 14.9, true), bw = wpx(v, 'ESTUDANTE', 7) + 8, gx = (v.W - (tw + 6 + bw)) / 2;
  v.lbl('m2-t', gx, 20, tw + 4, 'SMART-ID', 14.9, { bold: true, color: '#ffffff', spacing: -0.2 });
  v.rect(gx + tw + 6, 23, bw, 12, { fill: '#c0364f', op: 0.35, stroke: '#a94a58', sw: 0.8, r: 3 });
  v.lbl('m2-b', gx + tw + 6, 25, bw, 'ESTUDANTE', 7, { color: ROSE2, font: 'mono', align: 'center' });
  v.lbl('m2-s', 6, 40, v.W - 12, 'Cartão de Identificação Oficial', 6.5, { color: ROSE3, align: 'center' });
  v.photo((v.W - 82) / 2, 58, 82, 99, { border: '#a94a58', bw: 2, r: 10, bg: '#171717' });
  v.ell((v.W + 82) / 2 - 16, 58 + 99 - 16, 10, 10, { fill: '#a78bfa', stroke: '#ffffff', sw: 1, op: 0.9 });
  v.text('nome', 8, 164, v.W - 16, upper(d.nome), 11.2, { bold: true, color: '#ffffff', align: 'center', shrink: true });
  v.text('curso', 8, 179, v.W - 16, upper(d.curso), 8.8, { bold: true, color: ROSE3, align: 'center', shrink: true });
  v.rect(14, 198, v.W - 28, 90, { fill: '#000000', op: 0.3, stroke: '#5b1620', sw: 0.8, r: 7 });
  const R = (id: string, y: number, l: string, val: string, mono = false, lmono = false) => {
    v.lbl(`${id}-l`, 21, y, 100, l, 7.4, { color: ROSE3, font: lmono ? 'mono' : 'sans' });
    v.text(id, 110, y, v.W - 131, val, 7.4, { bold: true, color: '#ffffff', align: 'right', font: mono ? 'mono' : 'sans', shrink: true });
  };
  R('ts', 205, 'Turma / Sala:', [d.turma, d.sala && `Sala ${d.sala}`].filter(Boolean).join(' | '));
  R('periodo', 219, 'Período:', d.periodo);
  R('classe', 233, 'Classe / Grau:', d.classe);
  v.line(21, 248, v.W - 21, 248, '#5b1620', 0.8);
  R('proc', 253, 'Processo Nº:', d.proc, true, true);
  R('bi', 267, 'B.I.:', d.bi, true, true);
  const fy = v.H - 37;
  v.rect(0, fy, v.W, 37, { fill: '#000000', op: 0.6 });
  v.line(0, fy, v.W, fy, '#7a1d2b', 0.8);
  lv(v, 'ano', 15, fy + 7, 'Ano Lectivo:', d.ano, 6.5, 'l', ROSE3, '#ffffff');
  lv(v, 'val', 15, fy + 19, 'Validade:', d.val, 6.5, 'l', ROSE3, '#fcd34d', true);
  v.rect(v.W - 15 - 22, fy + 7.5, 22, 22, { fill: '#ffffff', r: 2.5 });
  v.qr(v.W - 15 - 20.5, fy + 9, 19, c.verifyValue, '#000000', '#ffffff');
  return v.scene();
}

// ---------------------------------------------------------------------------------------------
// REGISTO dos 19 modelos
// ---------------------------------------------------------------------------------------------
type Back = (c: CardCtx, accent: string) => Scene;
interface Def { n: number; name: string; desc: string; accent: string; swatch: [string, string]; h: (c: CardCtx) => Scene; v: (c: CardCtx) => Scene }

export function htmlModels(backH: Back, backV: Back): CardModel[] {
  const defs: Def[] = [
    { n: 1, name: 'Politécnico · Verde Floresta & Faixas', desc: 'Moldura verde, tarjas de dados, foto 3×4 e rodapé com código de barras (estilo Politécnico do Bita).', accent: '#087f3b', swatch: ['#087f3b', '#fbbf24'], h: m1H, v: m1V },
    { n: 2, name: 'Smart-ID · Bordô Radial', desc: 'Bordô com anéis radiais, foto à direita, QR e código de barras (estilo Smart-ID).', accent: '#7f0909', swatch: ['#7f0909', '#fda4af'], h: m2H, v: m2V },
    { n: 3, name: 'International School · Terracota', desc: 'Terracota dourado, currículo internacional.', accent: '#7a3411', swatch: ['#7a3411', '#fcd34d'], h: (c) => bitaH(c, '#7a3411'), v: (c) => bitaV(c, '#7a3411') },
    { n: 4, name: 'Teixeira Carelli · Vinho 3D', desc: 'Vinho profundo, estilo low-poly.', accent: '#3b122d', swatch: ['#3b122d', '#ec4899'], h: (c) => bitaH(c, '#3b122d'), v: (c) => bitaV(c, '#3b122d') },
    { n: 5, name: 'Ordem dos Economistas · Carmim/Petróleo', desc: 'Cédula bicolor carmim e verde-petróleo.', accent: '#8a1926', swatch: ['#8a1926', '#147980'], h: m5H, v: m5V },
    { n: 6, name: 'Escola Profissional · Azul Marinho', desc: 'Azul marinho com barra de código de barras.', accent: '#0e333b', swatch: ['#0e333b', '#22d3ee'], h: m6H, v: m6V },
    { n: 7, name: 'DNE · Verde Menta & Sol Dourado', desc: 'Documento Nacional do Estudante, menta pastel.', accent: '#065f46', swatch: ['#c5e8d8', '#fbbf24'], h: m7H, v: m7V },
    { n: 8, name: 'EAD / CIE · Verde e Amarelo', desc: 'Verde-azul com caixas brancas e rodapé amarelo.', accent: '#196b2e', swatch: ['#196b2e', '#facc15'], h: m8H, v: m8V },
    { n: 9, name: 'DNE · Menta com Selo Circular', desc: 'Menta pastel com selo azul da associação.', accent: '#0f766e', swatch: ['#a7e0cd', '#1e3a8a'], h: m9H, v: m9V },
    { n: 10, name: 'CIE · Azul Oceano', desc: 'Carteira CIE em azul oceano (UBES/UESPE).', accent: '#0369a1', swatch: ['#0284c7', '#0c4a6e'], h: m10H, v: m10V },
    { n: 11, name: 'ISIC · Turquesa Internacional', desc: 'Estilo ISIC/UNESCO, branco e turquesa com bandeira.', accent: '#0d9488', swatch: ['#ffffff', '#0d9488'], h: m11H, v: m11V },
    { n: 12, name: 'APG · Azul Clássico & Pílulas', desc: 'Azul clássico com campos em pílula branca.', accent: '#2b5876', swatch: ['#2b5876', '#ffffff'], h: m12H, v: m12V },
    { n: 13, name: 'UnB · Monocromático Cinza', desc: 'Faixas cinzas de segurança, QR na frente.', accent: '#475569', swatch: ['#ebeef2', '#64748b'], h: m13H, v: m13V },
    { n: 14, name: 'Santa Rita · Bordas Duplas', desc: 'Moldura preta grossa, estilo oficial MED.', accent: '#111111', swatch: ['#ffffff', '#111111'], h: m14H, v: m14V },
    { n: 15, name: 'Kuilizola · Bege & Tarja Amarela', desc: 'Crachá slim bege com tarja amarela.', accent: '#334155', swatch: ['#f4f2e9', '#facc15'], h: m15H, v: m15V },
    { n: 16, name: 'Barra do Bengo · Tipografia Rubra', desc: 'Moldura preta, título vermelho e linhas pontilhadas.', accent: '#111111', swatch: ['#ffffff', '#dc2626'], h: m16H, v: m16V },
    { n: 17, name: 'Dom Mário Lukunde · Marca d\'Água', desc: 'Marca de água central e foto de cantos suaves.', accent: '#111111', swatch: ['#ffffff', '#64748b'], h: m17H, v: m17V },
    { n: 18, name: 'Kutumamena · Foto no Canto', desc: 'Moldura com a foto encostada ao canto superior direito.', accent: '#111111', swatch: ['#ffffff', '#111111'], h: m18H, v: m18V },
    { n: 19, name: 'Santa Catarina · Tarja Verde', desc: 'Tarja verde com código de barras panorâmico.', accent: '#3e7843', swatch: ['#ffffff', '#3e7843'], h: m19H, v: m19V }
  ];
  return defs.map((m): CardModel => ({
    id: `html-${String(m.n).padStart(2, '0')}`, kind: 'estudante', name: `#${String(m.n).padStart(2, '0')} ${m.name}`, description: m.desc,
    orientation: 'h', level: 'todos', swatch: m.swatch, talao: true,
    front: m.h, back: (c) => backH(c, m.accent),
    alt: { front: m.v, back: (c) => backV(c, m.accent) }
  }));
}
