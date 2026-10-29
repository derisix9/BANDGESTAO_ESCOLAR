/**
 * Os 19 modelos de crachá de funcionário, redesenhados ponto a ponto a partir da galeria HTML
 * ("Studio Crachá", CR80 vertical 54 × 85,6 mm). Cada modelo tem frente e verso fiéis ao desenho
 * original (cores, disposição, foto, faixa magnética e faixa de código de barras + QR no verso),
 * com os textos institucionais adaptados: marca = nome da escola, dados = o funcionário/docente.
 * Tudo é desenhado em "píxeis do HTML" (cartão vertical 270 px de largura) via Cv e convertido
 * para milímetros reais — pré-visualização, impressão e PPTX saem iguais.
 */
import type { Scene } from './scene';
import type { CardCtx, CardModel } from './cards';
import { Cv, siglaOf } from './cardsHtml';
import { upper } from './format';
import { barOf } from '../utils/publicLink';

/** Dados do funcionário/docente já prontos para os desenhos. */
interface SD {
  nome: string; cargo: string; depto: string; numero: string; bi: string; nif: string;
  admissao: string; tel: string; sangue: string; ano: string; val: string; kind: string;
  escola: string; escolaU: string; sigla: string;
}
const sd = (c: CardCtx): SD => {
  const f = c.f;
  return {
    nome: f.nome || '', cargo: f.cargo || '', depto: f.depto || '', numero: f.numero || '',
    bi: f.bi || '', nif: f.nif || '', admissao: f.admissao || '', tel: f.tel || '', sangue: f.sangue || '',
    ano: f.ano || '', val: f.validade ? `12/${f.validade}` : f.ano || '',
    kind: f.kind || 'FUNCIONÁRIO',
    escola: c.school.name || '', escolaU: upper(c.school.name || ''), sigla: siglaOf(c.school.name || 'ESCOLA')
  };
};

// ---------- peças comuns (fiel ao HTML: furo de fita, faixa magnética, foto, chips) ----------
/** Furo oblongo da fita (slot punch), centrado no topo. */
const slotD = (v: Cv, color = '#0b1326') => {
  v.rect((v.W - 46) / 2, 9, 46, 10, { fill: color, r: 5 });
};
/** Faixa magnética HiCo (12,7 mm) por baixo do furo. */
const magStripe = (v: Cv, color = '#060e20') => v.rect(0, 34, v.W, 40, { fill: color });

/** Foto 3×4 rectangular com cantos e moldura. */
const photoBox = (v: Cv, y: number, o: { border?: string; bw?: number; r?: number; bg?: string; w?: number; h?: number } = {}) => {
  const w = o.w ?? 100, h = o.h ?? 124;
  v.photo((v.W - w) / 2, y, w, h, { border: o.border, bw: o.bw, r: o.r ?? 6, bg: o.bg ?? '#222a3d' });
};
/** Foto redonda (modelos 02, 03, 10, 12, 16). */
const photoRound = (v: Cv, y: number, s: number, border: string, bg = '#222a3d', bw = 2) => {
  const x = (v.W - s) / 2;
  v.ell(x, y, s, s, { fill: bg });
  v.img('foto', x, y, s, s, { round: true });
  v.ell(x, y, s, s, { stroke: border, sw: bw });
};
/** Nome a negrito + cargo por baixo, centrados. */
const nameBlock = (v: Cv, y: number, d: SD, nc: string, cc: string, npx = 9.5, cpx = 7) => {
  v.text('nome', 8, y, v.W - 16, d.nome, npx, { bold: true, color: nc, align: 'center', shrink: true });
  v.text('cargo', 8, y + npx * 1.55, v.W - 16, d.cargo, cpx, { color: cc, align: 'center', shrink: true });
};
/** Etiqueta (chip) com fundo e texto centrado. */
const chip = (v: Cv, id: string, x: number, y: number, w: number, h: number, text: string, bg: string, color: string, px = 6.5, r = 4, op?: number) => {
  v.rect(x, y, w, h, { fill: bg, r, op });
  v.lbl(id, x + 2, y, w - 4, text, px, { bold: true, color, align: 'center', h, valign: 'middle', shrink: true });
};
/** Texto vertical (pilar) letra a letra — a Scene não roda texto. */
const vLetters = (v: Cv, id: string, cx: number, y: number, text: string, px: number, color: string) => {
  const chars = upper(text).replace(/\s+/g, ' ').split('');
  chars.forEach((ch, i) => v.lbl(`${id}-${i}`, cx - 8, y + i * px * 1.45, 16, ch, px, { bold: true, color, align: 'center', h: Math.ceil(px * 1.45) }));
};

interface BackOpts {
  bg: string; ink: string; sub: string; line: string; stripe: string; slotC: string;
  /** Caixa do QR e cor dos módulos (claro→caixa escura com QR branco; escuro→caixa branca com QR escuro). */
  box: string; qrFg: string; bar: string;
  rows?: Array<[string, string]>;
  terms: string;
}
/** Verso padrão da galeria: furo, faixa magnética, dados/termos, código de barras + QR. */
function staffBack(c: CardCtx, o: BackOpts): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: o.bg });
  slotD(v, o.slotC);
  magStripe(v, o.stripe);
  let y = 94;
  for (const [l, val] of o.rows || []) {
    v.kv(`r${y}`, 20, y, 230, `${l}: `, val, 6.5, { lc: o.sub, vc: o.ink, vShrink: true });
    y += 18;
  }
  v.lbl('b-terms', 20, y + 6, 230, o.terms, 5.5, { color: o.sub, lineH: 1.35, h: 42 });
  v.line(14, 368, 256, 368, o.line, 1);
  v.barcode(20, 380, 108, 20, barOf(c.verifyValue), o.bar);
  v.lbl('b-barc', 20, 404, 108, `*${d.numero || d.bi || 'CRACHA'}*`, 5, { color: o.sub, align: 'center', spacing: 0.6 });
  v.rect(186, 372, 60, 60, { fill: o.box, r: 6 });
  v.qr(191.5, 377.5, 49, c.verifyValue, o.qrFg, o.box);
  return v.scene();
}

// =============================================================================================
// MODELO 01 — FlexFoam Rubro & Branco (Padrão Corporativo e Industrial)
// =============================================================================================
function f01F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#060e20');
  v.text('brand', 14, 28, 200, d.escolaU, 8.5, { bold: true, color: '#93000a', shrink: true, model: true });
  v.lbl('star', 236, 26, 20, '★', 9, { color: '#f59e0b', align: 'right' });
  photoBox(v, 108, { bg: '#222a3d' });
  nameBlock(v, 244, d, '#0b1326', '#89929b');
  v.line(14, 382, 256, 382, '#d6d9e0', 1);
  v.text('f-id', 14, 392, 160, `ID: ${d.numero}`, 6.5, { color: '#334155', font: 'mono', shrink: true });
  v.text('f-sg', 196, 392, 60, d.sangue, 7, { bold: true, color: '#ba1a1a', align: 'right' });
  return v.scene();
}
const f01B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#0b1326', sub: '#64748b', line: '#d6d9e0', stripe: '#060e20', slotC: '#060e20',
    box: '#060e20', qrFg: '#ffffff', bar: '#0b1326',
    rows: [['B.I.', sd(c).bi], ['Admissão', sd(c).admissao], ['Emergência', sd(c).tel]],
    terms: `Propriedade exclusiva de ${sd(c).escola}. Devolver à secretaria em caso de perda.`
  });

// =============================================================================================
// MODELO 02 — James Murphy Press (Editorial & Credenciamento de Mídia)
// =============================================================================================
function f02F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#1c1917' });
  slotD(v, '#0c0a09');
  chip(v, 'chip-kind', 14, 26, 74, 15, d.kind, '#ffb4ab', '#690005', 6, 3);
  v.text('f-ano', 170, 28, 86, d.ano, 6, { color: '#a8a29e', align: 'right', font: 'mono' });
  photoRound(v, 104, 116, '#ffb4ab');
  nameBlock(v, 236, d, '#ffffff', '#ffb4ab');
  chip(v, 'chip-cred', 24, 384, 222, 22, `CREDENCIAL ${d.numero}`, '#292524', '#e7e5e4', 6.5, 4);
  return v.scene();
}
const f02B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#1c1917', ink: '#e7e5e4', sub: '#a8a29e', line: '#292524', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#1c1917', bar: '#d6d3d1',
    rows: [['Validade', sd(c).val], ['Departamento', sd(c).depto]],
    terms: 'Credencial de identificação profissional. Livre trânsito nas instalações da instituição durante o horário de serviço.'
  });
// (no verso do original lê-se "AUTORIZAÇÃO RH" junto ao QR)

// =============================================================================================
// MODELO 03 — Samuel Atkinson Cyan Wave (Tech Slate & Carbon Minimal)
// =============================================================================================
function f03F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#2d3449' });
  slotD(v, '#060e20');
  v.ell(16, 28, 13, 13, { fill: '#93ccff' });
  v.text('brand', 36, 28, 220, d.escolaU, 8, { bold: true, color: '#93ccff', shrink: true, model: true });
  photoRound(v, 100, 112, '#93ccff');
  nameBlock(v, 228, d, '#ffffff', '#93ccff');
  v.line(14, 384, 256, 384, '#171f33', 1);
  v.text('f-id', 14, 394, 150, `ID: ${d.numero}`, 6.5, { color: '#bfc7d2', font: 'mono', shrink: true });
  v.lbl('f-rfid', 176, 394, 80, 'RFID EV1', 6.5, { color: '#4edea3', align: 'right' });
  return v.scene();
}
const f03B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#2d3449', ink: '#dae2fd', sub: '#89929b', line: '#171f33', stripe: '#060e20', slotC: '#060e20',
    box: '#93ccff', qrFg: '#060e20', bar: '#dae2fd',
    rows: [['Depto', sd(c).depto], ['Acesso', 'Áreas comuns e técnicas'], ['Contacto', sd(c).tel]],
    terms: 'Identificação obrigatória e visível dentro das instalações. Cartão pessoal e intransmissível.'
  });

// =============================================================================================
// MODELO 04 — Emily Jones Dark Dome (Contraste Dinâmico Branco & Preto)
// =============================================================================================
function f04F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#000000');
  v.text('brand', 14, 28, 180, d.escolaU, 8.5, { bold: true, color: '#ba1a1a', shrink: true, model: true });
  v.text('f-id', 196, 29, 60, d.numero, 5.5, { color: '#89929b', align: 'right', font: 'mono', shrink: true });
  photoBox(v, 108, { bg: '#0b1326', r: 5 });
  nameBlock(v, 244, d, '#0b1326', '#ba1a1a');
  chip(v, 'chip-acesso', 14, 386, 242, 24, 'ACESSO TOTAL', '#0b1326', '#ffffff', 7, 4);
  return v.scene();
}
const f04B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#0b1326', sub: '#64748b', line: '#d6d9e0', stripe: '#000000', slotC: '#000000',
    box: '#0b1326', qrFg: '#ffffff', bar: '#0b1326',
    rows: [['Emissão', sd(c).admissao], ['Expiração', sd(c).val], ['Telefone', sd(c).tel]],
    terms: 'Cartão de identificação oficial protegido por criptografia. Em caso de perda, comunique de imediato à secretaria.'
  });

// =============================================================================================
// MODELO 05 — Study Program Navy Pillar (Institucional Universitário & Pesquisa)
// =============================================================================================
function f05F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#060e20');
  // coluna esquerda
  v.text('brand', 14, 30, 168, d.escolaU, 8, { bold: true, color: '#3198dc', shrink: true, model: true });
  v.photo(16, 108, 88, 108, { r: 5, bg: '#222a3d' });
  v.text('nome', 12, 226, 170, d.nome, 8.5, { bold: true, color: '#0b1326', shrink: true });
  v.text('cargo', 12, 242, 170, d.cargo, 6.5, { color: '#64748b', shrink: true });
  v.text('f-mat', 12, 396, 170, `MAT: ${d.numero}`, 6, { color: '#334155', font: 'mono', shrink: true });
  // pilar navy à direita
  v.rect(196, 0, 74, v.H, { fill: '#222a3d' });
  vLetters(v, 'pil', 233, 60, d.depto || 'ESCOLA', 8, '#ffffff');
  v.rect(221, 380, 24, 24, { fill: '#3198dc', r: 4 });
  v.lbl('pil-star', 221, 380, 24, '★', 10, { color: '#ffffff', align: 'center', h: 24, valign: 'middle' });
  return v.scene();
}
const f05B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#0b1326', sub: '#64748b', line: '#d6d9e0', stripe: '#060e20', slotC: '#060e20',
    box: '#3198dc', qrFg: '#060e20', bar: '#0b1326',
    rows: [['Departamento', sd(c).depto], ['Admissão', sd(c).admissao], ['B.I.', sd(c).bi]],
    terms: 'Documento institucional de identificação. O titular deve apresentá-lo sempre que solicitado.'
  });

// =============================================================================================
// MODELO 06 — Bita Corporativo Verde Floresta (Sustentabilidade & Agroflorestal)
// =============================================================================================
function f06F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#1c1917' });
  v.rect(0, 0, v.W, 10, { fill: '#4edea3' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 30, 170, d.escolaU, 8, { bold: true, color: '#4edea3', shrink: true, model: true });
  v.lbl('f-tag', 190, 31, 66, 'BIO-ID', 5.5, { color: '#4edea3', align: 'right', spacing: 1 });
  photoBox(v, 108, { border: '#4edea3', bw: 1.5, bg: '#292524' });
  nameBlock(v, 244, d, '#ffffff', '#d6d3d1');
  chip(v, 'chip-zona', 24, 384, 222, 22, upper(d.depto), '#4edea3', '#003920', 6.5, 4);
  return v.scene();
}
const f06B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#1c1917', ink: '#e7e5e4', sub: '#a8a29e', line: '#292524', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#4edea3', qrFg: '#06231a', bar: '#d6d3d1',
    terms: 'Certificação interna de segurança e meio ambiente. Acesso condicionado às áreas autorizadas da instituição.'
  });

// =============================================================================================
// MODELO 07 — Smart-ID Executivo Bordô Luxo (Diretoria Executiva & C-Level)
// =============================================================================================
function f07F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#0c0a09', fill2: '#4c0519', ang: 180 });
  slotD(v, '#0c0a09');
  v.lbl('f-exec', 14, 28, 160, 'EXECUTIVE', 8.5, { bold: true, color: '#fde68a', spacing: 1.6, model: true });
  v.text('cargo-tag', 176, 30, 80, upper(d.depto), 5.5, { color: '#fcd34d', align: 'right', shrink: true });
  photoBox(v, 108, { border: '#fcd34d', bw: 1.5, bg: '#292524' });
  nameBlock(v, 244, d, '#fef3c7', '#d6d3d1');
  v.line(14, 384, 256, 384, '#fcd34d', 0.75);
  v.text('f-num', 14, 394, 150, `Nº ${d.numero}`, 6.5, { color: '#fde68a', font: 'mono', shrink: true });
  v.lbl('f-vip', 176, 394, 80, 'ACESSO VIP', 6.5, { bold: true, color: '#fcd34d', align: 'right' });
  return v.scene();
}
const f07B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#0c0a09', ink: '#e7e5e4', sub: '#a8a29e', line: '#292524', stripe: '#000000', slotC: '#000000',
    box: '#fcd34d', qrFg: '#0c0a09', bar: '#d6d3d1',
    terms: 'Credencial de trânsito livre permanente em todas as áreas da instituição, incluindo salas reservadas à direcção.'
  });

// =============================================================================================
// MODELO 08 — Int. Corp Terracota & Ouro (Diplomacia & Comércio Exterior)
// =============================================================================================
function f08F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#f5f5f4' });
  slotD(v, '#292524');
  v.text('brand', 14, 28, 190, d.escolaU, 8.5, { bold: true, color: '#9a3412', shrink: true, model: true });
  v.lbl('f-tag', 196, 30, 60, 'CONSULAR', 5.5, { color: '#78716c', align: 'right', spacing: 0.8 });
  v.line(14, 48, 256, 48, '#fed7aa', 1);
  photoBox(v, 108, { bg: '#d6d3d1' });
  nameBlock(v, 244, d, '#1c1917', '#7c2d12');
  v.line(14, 384, 256, 384, '#fed7aa', 1);
  v.text('f-id', 14, 394, 140, `ID: ${d.numero}`, 6.5, { color: '#44403c', font: 'mono', shrink: true });
  v.text('f-val', 156, 394, 100, `VALID: ${d.val}`, 6.5, { bold: true, color: '#c2410c', align: 'right', shrink: true });
  return v.scene();
}
const f08B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#f5f5f4', ink: '#1c1917', sub: '#78716c', line: '#e7e5e4', stripe: '#292524', slotC: '#292524',
    box: '#c2410c', qrFg: '#ffffff', bar: '#1c1917',
    terms: 'Documento de identificação institucional — válido em todas as dependências e representações da escola.'
  });

// =============================================================================================
// MODELO 09 — Carelli & Leite Low-Poly Vinho (Advocacia e Consultoria Jurídica)
// =============================================================================================
function f09F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#4c0519', fill2: '#881337', ang: 160 });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 190, d.escolaU, 8.5, { bold: true, color: '#fecdd3', shrink: true, model: true });
  v.text('f-sigla', 206, 30, 50, d.sigla, 6, { color: '#fda4af', align: 'right', shrink: true });
  photoBox(v, 108, { bg: '#881337' });
  nameBlock(v, 244, d, '#ffffff', '#fecdd3');
  v.line(14, 384, 256, 384, '#9f1239', 1);
  v.text('f-mat', 14, 394, 150, `MAT: ${d.numero}`, 6.5, { color: '#fecdd3', font: 'mono', shrink: true });
  v.lbl('f-pleno', 186, 394, 70, 'PLENO', 6.5, { bold: true, color: '#fda4af', align: 'right' });
  return v.scene();
}
const f09B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#4c0519', ink: '#ffe4e6', sub: '#fda4af', line: '#9f1239', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#4c0519', bar: '#fecdd3',
    terms: 'Validação profissional e acesso às áreas internas da instituição. Documento pessoal e intransmissível.'
  });

// =============================================================================================
// MODELO 10 — Ordem Economistas Bicolor (Conselhos e Associações de Classe)
// =============================================================================================
function f10F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#164e63', fill2: '#4c0519', ang: 45 });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 190, d.escolaU, 8, { bold: true, color: '#67e8f9', shrink: true, model: true });
  v.lbl('f-reg', 176, 30, 80, 'REG. OFICIAL', 5.5, { color: '#fda4af', align: 'right', spacing: 0.6 });
  photoRound(v, 102, 114, '#22d3ee');
  nameBlock(v, 232, d, '#ffffff', '#a5f3fc');
  v.line(14, 384, 256, 384, '#155e75', 1);
  v.text('f-num', 14, 394, 150, `${d.sigla} ${d.numero}`, 6.5, { color: '#a5f3fc', font: 'mono', shrink: true });
  v.lbl('f-hab', 186, 394, 70, 'HABILITADO', 6, { bold: true, color: '#4edea3', align: 'right' });
  return v.scene();
}
const f10B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#0f172a', ink: '#e2e8f0', sub: '#94a3b8', line: '#155e75', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#0f172a', bar: '#cbd5e1',
    terms: 'Cédula de identificação profissional com validade em todo o território nacional.'
  });

// =============================================================================================
// MODELO 11 — Infante Petróleo 3D Slate (Setor Offshore, Energia & Gás)
// =============================================================================================
function f11F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#020617' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 170, d.escolaU, 8, { bold: true, color: '#38bdf8', shrink: true, model: true });
  chip(v, 'chip-kind', 190, 26, 66, 15, d.kind, '#f59e0b', '#451a03', 5.5, 3, 0.9);
  photoBox(v, 108, { bg: '#1e293b' });
  nameBlock(v, 244, d, '#ffffff', '#7dd3fc');
  chip(v, 'chip-rig', 24, 384, 120, 22, `REG ${d.numero}`, '#082f49', '#7dd3fc', 6, 4, 0.7);
  chip(v, 'chip-ok', 152, 384, 94, 22, 'BOSIET OK', '#082f49', '#fbbf24', 6, 4, 0.7);
  return v.scene();
}
const f11B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#020617', ink: '#e2e8f0', sub: '#94a3b8', line: '#1e293b', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#020617', bar: '#cbd5e1',
    rows: [['Tipo sanguíneo', sd(c).sangue], ['Departamento', sd(c).depto]],
    terms: 'Documento de identificação — treinamentos e validade conforme os registos da instituição.'
  });

// =============================================================================================
// MODELO 12 — FESN Clean Menta (Saúde Pública e Hospitalar)
// =============================================================================================
function f12F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#060e20');
  v.text('brand', 14, 28, 190, d.escolaU, 8.5, { bold: true, color: '#047857', shrink: true, model: true });
  v.text('cargo-tag', 196, 30, 60, d.kind, 5.5, { bold: true, color: '#059669', align: 'right', shrink: true });
  v.line(14, 48, 256, 48, '#d1fae5', 1);
  photoRound(v, 104, 112, '#10b981', '#f0fdf4');
  nameBlock(v, 232, d, '#064e3b', '#047857');
  v.line(14, 384, 256, 384, '#d1fae5', 1);
  v.text('f-num', 14, 394, 150, `Nº ${d.numero}`, 6.5, { color: '#334155', font: 'mono', shrink: true });
  v.lbl('f-ativo', 186, 394, 70, 'ATIVO', 6.5, { bold: true, color: '#ba1a1a', align: 'right' });
  return v.scene();
}
const f12B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#064e3b', sub: '#64748b', line: '#d1fae5', stripe: '#060e20', slotC: '#060e20',
    box: '#059669', qrFg: '#ffffff', bar: '#0b1326',
    rows: [['Departamento', sd(c).depto], ['Telefone', sd(c).tel], ['Tipo sanguíneo', sd(c).sangue]],
    terms: 'Identificação de pessoal da instituição. Higienize o cartão regularmente e mantenha-o visível.'
  });

// =============================================================================================
// MODELO 13 — EAD Inovação Digital (EdTech & Plataformas Online)
// =============================================================================================
function f13F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#0f172a' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 190, d.escolaU, 8, { bold: true, color: '#22d3ee', shrink: true, model: true });
  v.text('cargo-tag', 196, 30, 60, d.kind, 5.5, { bold: true, color: '#fcd34d', align: 'right', shrink: true });
  photoBox(v, 108, { border: '#22d3ee', bw: 1.5, r: 10, bg: '#1e293b' });
  nameBlock(v, 244, d, '#ffffff', '#a5f3fc');
  chip(v, 'chip-depto', 24, 384, 222, 22, upper(d.depto), '#164e63', '#a5f3fc', 6.5, 5);
  return v.scene();
}
const f13B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#0f172a', ink: '#e2e8f0', sub: '#94a3b8', line: '#164e63', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#0f172a', bar: '#cbd5e1',
    terms: 'Acesso aos estúdios, laboratórios e salas técnicas conforme o perfil atribuído ao titular.'
  });

// =============================================================================================
// MODELO 14 — UEEP Institucional (Empresas Públicas & Autarquias)
// =============================================================================================
function f14F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#060e20');
  v.text('brand', 14, 28, 190, d.escolaU, 8.5, { bold: true, color: '#0c4a6e', shrink: true, model: true });
  v.text('cargo-tag', 196, 30, 60, d.kind, 5.5, { bold: true, color: '#0369a1', align: 'right', shrink: true });
  v.line(14, 48, 256, 48, '#bae6fd', 1);
  photoBox(v, 108, { bg: '#e0f2fe' });
  nameBlock(v, 244, d, '#0c4a6e', '#075985');
  v.line(14, 384, 256, 384, '#bae6fd', 1);
  v.text('f-num', 14, 394, 150, `Nº ${d.numero}`, 6.5, { color: '#334155', font: 'mono', shrink: true });
  v.lbl('f-efetivo', 176, 394, 80, 'EFETIVO', 6.5, { bold: true, color: '#00a572', align: 'right' });
  return v.scene();
}
const f14B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#0c4a6e', sub: '#64748b', line: '#bae6fd', stripe: '#060e20', slotC: '#060e20',
    box: '#0369a1', qrFg: '#ffffff', bar: '#0b1326',
    rows: [['Departamento', sd(c).depto], ['Admissão', sd(c).admissao], ['B.I.', sd(c).bi]],
    terms: 'Documento oficial de identificação funcional, emitido pela direcção da instituição.'
  });

// =============================================================================================
// MODELO 15 — CIE Marinho Ondas (Autoridades Portuárias & Logística)
// =============================================================================================
function f15F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#172554' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 170, d.escolaU, 8, { bold: true, color: '#7dd3fc', shrink: true, model: true });
  v.lbl('f-tag', 176, 30, 80, 'SEGURANÇA', 5.5, { bold: true, color: '#fcd34d', align: 'right', spacing: 0.6 });
  photoBox(v, 108, { border: '#7dd3fc', bw: 1.5, r: 8, bg: '#1e3a8a' });
  nameBlock(v, 244, d, '#ffffff', '#bae6fd');
  chip(v, 'chip-num', 24, 384, 110, 22, `REG ${d.numero}`, '#1e3a8a', '#bae6fd', 6, 4);
  chip(v, 'chip-seg', 142, 384, 104, 22, upper(d.depto), '#1e3a8a', '#4edea3', 5.5, 4);
  return v.scene();
}
const f15B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#172554', ink: '#dbeafe', sub: '#93c5fd', line: '#1e3a8a', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#172554', bar: '#bfdbfe',
    terms: 'Acesso às áreas restritas conforme o perfil atribuído ao titular. Uso obrigatório dentro das instalações.'
  });

// =============================================================================================
// MODELO 16 — ISIC Internacional (Bilíngue UNESCO & Intercâmbio)
// =============================================================================================
function f16F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#134e4a' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 190, d.escolaU, 8, { bold: true, color: '#ffffff', shrink: true, model: true });
  v.lbl('f-tag', 196, 30, 60, 'GLOBAL', 5.5, { color: '#99f6e4', align: 'right', spacing: 1 });
  photoRound(v, 102, 114, '#5eead4', '#0f766e');
  nameBlock(v, 232, d, '#ffffff', '#99f6e4');
  v.line(14, 384, 256, 384, '#0f766e', 1);
  v.text('f-id', 14, 394, 140, `ID: ${d.numero}`, 6.5, { color: '#ccfbf1', font: 'mono', shrink: true });
  v.text('f-val', 156, 394, 100, `EXP: ${d.val}`, 6.5, { bold: true, color: '#5eead4', align: 'right', shrink: true });
  return v.scene();
}
const f16B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#042f2e', ink: '#ccfbf1', sub: '#5eead4', line: '#0f766e', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#134e4a', bar: '#99f6e4',
    terms: 'Documento de identificação de pessoal docente e administrativo, válido em território nacional.'
  });

// =============================================================================================
// MODELO 17 — APG Pílulas de Alta Leitura (Inspeção Visual Rápida de Campo)
// =============================================================================================
function f17F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#1e1b4b' });
  slotD(v, '#0c0a09');
  v.text('brand', 14, 28, 160, d.escolaU, 8, { bold: true, color: '#a5b4fc', shrink: true, model: true });
  chip(v, 'chip-zona', 184, 26, 72, 16, `ZONA ${d.sigla.slice(0, 1)}`, '#4f46e5', '#ffffff', 6, 8);
  photoBox(v, 108, { r: 5, bg: '#312e81' });
  nameBlock(v, 244, d, '#ffffff', '#a5b4fc');
  chip(v, 'chip-depto', 24, 384, 222, 22, upper(d.depto), '#3730a3', '#ffffff', 6.5, 5);
  return v.scene();
}
const f17B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#1e1b4b', ink: '#e0e7ff', sub: '#a5b4fc', line: '#3730a3', stripe: '#0c0a09', slotC: '#0c0a09',
    box: '#ffffff', qrFg: '#1e1b4b', bar: '#c7d2fe',
    terms: 'Identificação obrigatória e visível em todas as áreas da instituição durante o período de serviço.'
  });

// =============================================================================================
// MODELO 18 — UAN Monocromático Segurança (Guilloche de Alta Segurança Laser)
// =============================================================================================
function f18F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#171717' });
  slotD(v, '#0a0a0a');
  // micro-padrão de segurança (guilloché simplificado)
  for (let i = 0; i < 9; i++) v.line(0, 60 + i * 40, v.W, 20 + i * 40, '#262626', 0.5);
  v.text('brand', 14, 28, 190, d.escolaU, 8, { bold: true, color: '#d4d4d4', shrink: true, model: true });
  v.text('f-num', 196, 30, 60, d.numero, 5.5, { color: '#a3a3a3', align: 'right', font: 'mono', shrink: true });
  photoBox(v, 108, { border: '#404040', bw: 1.5, bg: '#262626' });
  nameBlock(v, 244, d, '#f5f5f5', '#a3a3a3');
  v.line(14, 384, 256, 384, '#404040', 1);
  v.text('f-sg', 14, 394, 140, `TIPO: ${d.sangue}`, 6.5, { color: '#d4d4d4', font: 'mono', shrink: true });
  v.lbl('f-af', 156, 394, 100, 'ANTIFRAUDE', 6, { bold: true, color: '#d4d4d4', align: 'right', spacing: 0.8 });
  return v.scene();
}
const f18B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#171717', ink: '#e5e5e5', sub: '#a3a3a3', line: '#404040', stripe: '#0a0a0a', slotC: '#0a0a0a',
    box: '#ffffff', qrFg: '#171717', bar: '#d4d4d4',
    terms: 'Documento com microtexto e elementos de segurança — verificação óptica obrigatória na recepção.'
  });

// =============================================================================================
// MODELO 19 — Santa Catarina Gov (Administração Governamental & Fazenda)
// =============================================================================================
function f19F(c: CardCtx): Scene {
  const d = sd(c);
  const v = new Cv('v').base({ fill: '#ffffff' });
  slotD(v, '#060e20');
  v.text('brand', 14, 28, 190, d.escolaU, 8.5, { bold: true, color: '#065f46', shrink: true, model: true });
  v.text('cargo-tag', 196, 30, 60, d.kind, 5.5, { bold: true, color: '#047857', align: 'right', shrink: true });
  v.line(14, 48, 256, 48, '#10b981', 1.5);
  photoBox(v, 108, { border: '#10b981', bw: 1.5, bg: '#f0fdf4' });
  nameBlock(v, 244, d, '#064e3b', '#065f46');
  v.line(14, 384, 256, 384, '#a7f3d0', 1);
  v.text('f-mat', 14, 394, 150, `MAT: ${d.numero}`, 6.5, { color: '#334155', font: 'mono', shrink: true });
  v.lbl('f-val', 176, 394, 80, 'VÁLIDO', 6.5, { bold: true, color: '#00a572', align: 'right' });
  return v.scene();
}
const f19B = (c: CardCtx): Scene =>
  staffBack(c, {
    bg: '#ffffff', ink: '#064e3b', sub: '#64748b', line: '#a7f3d0', stripe: '#060e20', slotC: '#060e20',
    box: '#047857', qrFg: '#ffffff', bar: '#0b1326',
    rows: [['Departamento', sd(c).depto], ['Admissão', sd(c).admissao]],
    terms: 'Documento oficial de identificação funcional — fé pública conferida em todo o território nacional.'
  });

/** Os 19 modelos fiéis à galeria HTML (frente + verso), verticais CR80. */
export const staffHtmlModels: Array<Omit<CardModel, 'kind' | 'orientation'>> = [
  { id: 'func-m01', name: 'Crachá 01 · FlexFoam Rubro & Branco', description: 'Padrão Corporativo e Industrial', swatch: ['#ffffff', '#93000a'], front: f01F, back: f01B },
  { id: 'func-m02', name: 'Crachá 02 · James Murphy Press', description: 'Editorial & Credenciamento de Mídia', swatch: ['#1c1917', '#ffb4ab'], front: f02F, back: f02B },
  { id: 'func-m03', name: 'Crachá 03 · Cyan Wave', description: 'Tech Slate & Carbon Minimal', swatch: ['#2d3449', '#93ccff'], front: f03F, back: f03B },
  { id: 'func-m04', name: 'Crachá 04 · Dark Dome', description: 'Contraste Dinâmico Branco & Preto', swatch: ['#ffffff', '#0b1326'], front: f04F, back: f04B },
  { id: 'func-m05', name: 'Crachá 05 · Navy Pillar', description: 'Institucional Universitário & Pesquisa', swatch: ['#ffffff', '#222a3d'], front: f05F, back: f05B },
  { id: 'func-m06', name: 'Crachá 06 · Verde Floresta', description: 'Sustentabilidade & Agroflorestal', swatch: ['#1c1917', '#4edea3'], front: f06F, back: f06B },
  { id: 'func-m07', name: 'Crachá 07 · Executivo Bordô', description: 'Diretoria Executiva & C-Level', swatch: ['#4c0519', '#fcd34d'], front: f07F, back: f07B },
  { id: 'func-m08', name: 'Crachá 08 · Terracota & Ouro', description: 'Diplomacia & Comércio Exterior', swatch: ['#f5f5f4', '#9a3412'], front: f08F, back: f08B },
  { id: 'func-m09', name: 'Crachá 09 · Low-Poly Vinho', description: 'Advocacia e Consultoria Jurídica', swatch: ['#4c0519', '#fb7185'], front: f09F, back: f09B },
  { id: 'func-m10', name: 'Crachá 10 · Economistas Bicolor', description: 'Conselhos e Associações de Classe', swatch: ['#164e63', '#22d3ee'], front: f10F, back: f10B },
  { id: 'func-m11', name: 'Crachá 11 · 3D Slate', description: 'Setor Offshore, Energia & Gás', swatch: ['#020617', '#38bdf8'], front: f11F, back: f11B },
  { id: 'func-m12', name: 'Crachá 12 · Clean Menta', description: 'Saúde Pública e Hospitalar', swatch: ['#ffffff', '#10b981'], front: f12F, back: f12B },
  { id: 'func-m13', name: 'Crachá 13 · Inovação Digital', description: 'EdTech & Plataformas Online', swatch: ['#0f172a', '#22d3ee'], front: f13F, back: f13B },
  { id: 'func-m14', name: 'Crachá 14 · Institucional', description: 'Empresas Públicas & Autarquias', swatch: ['#ffffff', '#0c4a6e'], front: f14F, back: f14B },
  { id: 'func-m15', name: 'Crachá 15 · Marinho Ondas', description: 'Autoridades Portuárias & Logística', swatch: ['#172554', '#7dd3fc'], front: f15F, back: f15B },
  { id: 'func-m16', name: 'Crachá 16 · ISIC Internacional', description: 'Bilíngue UNESCO & Intercâmbio', swatch: ['#134e4a', '#5eead4'], front: f16F, back: f16B },
  { id: 'func-m17', name: 'Crachá 17 · Pílulas', description: 'Inspeção Visual Rápida de Campo', swatch: ['#1e1b4b', '#818cf8'], front: f17F, back: f17B },
  { id: 'func-m18', name: 'Crachá 18 · Monocromático', description: 'Guilloche de Alta Segurança Laser', swatch: ['#171717', '#d4d4d4'], front: f18F, back: f18B },
  { id: 'func-m19', name: 'Crachá 19 · Gov', description: 'Administração Governamental & Fazenda', swatch: ['#ffffff', '#059669'], front: f19F, back: f19B }
];
