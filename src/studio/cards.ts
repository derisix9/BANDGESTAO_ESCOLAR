/**
 * Modelos de cartão de estudante, crachá de funcionário, cartão de transporte escolar e diploma.
 * Cada modelo é uma função que devolve a Cena (frente e verso) já preenchida com os dados.
 */
import type { Scene, Prim, PText } from './scene';
import type { StaffPerson, StudioData, StudioLevel } from './data';
import { LEVEL_LABEL } from './data';
import { dataCurta, upper } from './format';
import type { FeeCell } from './cardsHtml';
import { htmlModels, talaoBack, staffBackH, staffFrontH, transpBackH, transpBackV, transpFrontV } from './cardsHtml';
import { staffHtmlModels } from './cardsStaff';

export type CardOrientation = 'h' | 'v';
export interface CardKind { id: 'estudante' | 'funcionario' | 'transporte' | 'diploma'; label: string; icon: string }
export const CARD_W = 85.6;
export const CARD_H = 53.98;

export interface CardModel {
  id: string;
  kind: CardKind['id'];
  name: string;
  description: string;
  orientation: CardOrientation | 'a4l';
  level?: StudioLevel | 'todos';
  /** Cor de pré-visualização do modelo na galeria. */
  swatch: [string, string];
  front: (c: CardCtx) => Scene;
  back: (c: CardCtx) => Scene;
  /** Desenho na outra posição (vertical se o principal é horizontal, e vice-versa). */
  alt?: { front: (c: CardCtx) => Scene; back: (c: CardCtx) => Scene };
  /** Cartão de estudante: aceita o verso \"Talão de Propinas\". */
  talao?: boolean;
}

export type CardSide = 'padrao' | 'talao';

/** Frente e verso do modelo na posição pedida (a do modelo se não tiver a outra) e com o verso escolhido. */
export function cardPair(m: CardModel, orient: CardOrientation | null, back: CardSide): { front: CardModel['front']; back: CardModel['back']; orient: CardOrientation | 'a4l' } {
  const primary = { front: m.front, back: m.back };
  let pair = primary, o: CardOrientation | 'a4l' = m.orientation;
  if (m.orientation !== 'a4l' && orient && orient !== m.orientation && m.alt) { pair = m.alt; o = orient; }
  if (back === 'talao' && m.kind === 'estudante') {
    const oo: CardOrientation = o === 'v' ? 'v' : 'h';
    return { front: pair.front, back: (c) => talaoBack(c, oo), orient: o };
  }
  return { ...pair, orient: o };
}

export interface CardCtx {
  school: StudioData['school'];
  /** Dados da pessoa já formatados em linhas prontas. */
  f: Record<string, string>;
  verifyValue: string;
  level: StudioLevel;
  year: string;
  /** Propinas do ano lectivo, mês a mês (10 meses), para o verso Talão. */
  fees?: FeeCell[];
  /** Cartão de transporte: meses (1–12) com mensalidade validada, para o verso de 12 meses. */
  transpPaid?: number[];
}

const T = (p: Omit<PText, 'k'>): PText => ({ k: 'text', scope: 'doc', ...p });
const M = (p: Omit<PText, 'k'>): PText => ({ k: 'text', scope: 'model', editable: true, ...p });

const sceneH = (prims: Prim[]): Scene => ({ w: CARD_W, h: CARD_H, prims });
const sceneV = (prims: Prim[]): Scene => ({ w: CARD_H, h: CARD_W, prims });

const headerLines = (school: CardCtx['school'], level: StudioLevel) => [
  'REPÚBLICA DE ANGOLA',
  'MINISTÉRIO DA EDUCAÇÃO',
  (level === 'primario' ? 'ENSINO PRIMÁRIO' : level === 'iciclo' ? 'I CICLO DO ENSINO SECUNDÁRIO' : level === 'eja' ? 'EDUCAÇÃO DE ADULTOS' : 'ENSINO SECUNDÁRIO'),
  upper(school.name)
];

/** Ensino Médio (10.ª–13.ª classe): o cartão leva o Curso e a sua descrição. */
export const hasCurso = (level: StudioLevel) => level === 'iiciclo' || level === 'tecnico';
const resumir = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/** Pessoa → campos de texto comuns. */
export function studentFields(d: StudioData, year: string, level: StudioLevel): Record<string, string> {
  return {
    nome: d.person.name,
    proc: d.person.procNumber,
    bi: d.person.bi,
    classe: d.enrollment.grade.replace(/\s*\(.*\)$/, ''),
    turma: d.enrollment.turma,
    numero: d.enrollment.numero,
    curso: d.enrollment.curso,
    cursoDesc: hasCurso(level) ? resumir(d.enrollment.cursoDescricao, 110) : '',
    matricula: d.enrollment.matricula,
    periodo: d.enrollment.periodo,
    sala: d.enrollment.sala,
    ano: year || d.enrollment.year,
    nasc: d.person.birthDate,
    emissao: dataCurta(new Date()),
    tel: d.person.phone,
    nivel: LEVEL_LABEL[level]
  };
}

export function staffFields(s: StaffPerson, year: string): Record<string, string> {
  return {
    nome: s.name, cargo: s.role, depto: s.department || (s.kind === 'docente' ? 'Corpo Docente' : 'Pessoal Administrativo'),
    numero: s.number, bi: s.bi, nif: s.nif, admissao: s.admission, tel: s.phone, sangue: s.blood, ano: year,
    kind: s.kind === 'docente' ? 'DOCENTE' : 'FUNCIONÁRIO',
    validade: year ? `${year.split(/\D+/)[1] || year}` : ''
  };
}

// ---------------------------------------------------------------------------------------------
// CARTÃO DE ESTUDANTE — horizontal 85,6 × 54
// ---------------------------------------------------------------------------------------------
/** Réplica do modelo oficial das escolas (folha de 8): moldura fina, brasão, marca de água, foto à direita. */
function estOficialFront(c: CardCtx): Scene {
  const L = headerLines(c.school, c.level);
  const p: Prim[] = [
    { k: 'rect', x: 0.4, y: 0.4, w: CARD_W - 0.8, h: CARD_H - 0.8, fill: '#ffffff', stroke: '#111111', sw: 0.35, r: 3 },
    { k: 'image', slot: 'logo', x: 20, y: 11, w: 40, h: 40, opacity: 0.08, fit: 'contain' },
    { k: 'image', slot: 'brasao', x: 4.5, y: 3, w: 9, h: 9.5, fit: 'contain' },
    M({ id: 'h1', x: 14, y: 2.6, w: 48, h: 3, text: L[0], size: 5.2, bold: true, align: 'center', font: 'serif', color: '#111' }),
    M({ id: 'h2', x: 14, y: 5.4, w: 48, h: 3, text: L[1], size: 5.2, bold: true, align: 'center', font: 'serif', color: '#111' }),
    M({ id: 'h3', x: 14, y: 8.2, w: 46, h: 3.2, text: L[3], size: 5.4, bold: true, align: 'center', font: 'serif', color: '#0b2a6b', shrink: true }),
    M({ id: 'h4', x: 14, y: 11, w: 48, h: 3, text: c.school.subTitle || L[2], size: 4.8, bold: true, align: 'center', font: 'serif', color: '#0b2a6b' }),
    { k: 'rect', x: 62, y: 4, w: 19, h: 25, fill: '#ffffff', stroke: '#111', sw: 0.3, r: 1 },
    { k: 'image', slot: 'foto', x: 62.3, y: 4.3, w: 18.4, h: 24.4, fit: 'cover' },
    T({ id: 'titulo', x: 4.5, y: 15.4, w: 56, h: 4, text: `CARTÃO DE ESTUDANTE Nº ${c.f.matricula || c.f.proc || '____'}`, size: 6.4, italic: true, bold: true, font: 'sans', color: '#111', shrink: true }),
    M({ id: 'l-nome', x: 4.5, y: 21, w: 12, h: 3.5, text: 'Nome:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'nome', x: 14, y: 20.6, w: 46, h: 4, text: c.f.nome, size: 7, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l-ano', x: 4.5, y: 27.4, w: 20, h: 3.5, text: 'Ano Lectivo:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'ano', x: 20, y: 27, w: 17, h: 4, text: c.f.ano, size: 6.4, bold: true, font: 'sans' }),
    M({ id: 'l-classe', x: 38, y: 27.4, w: 14, h: 3.5, text: 'Classe:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'classe', x: 47, y: 27, w: 13, h: 4, text: c.f.classe.replace(/\s*classe/i, ''), size: 6.4, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l-turma', x: 62, y: 31.6, w: 12, h: 3.5, text: 'Turma:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'turma', x: 71, y: 31.2, w: 10, h: 4, text: c.f.turma, size: 6.4, bold: true, font: 'sans' }),
    M({ id: 'l-n', x: 4.5, y: 34, w: 8, h: 3.5, text: 'Nº:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'numero', x: 11, y: 33.6, w: 10, h: 4, text: c.f.numero, size: 6.4, bold: true, font: 'sans' }),
    M({ id: 'l-curso', x: 24, y: 34, w: 12, h: 3.5, text: hasCurso(c.level) ? 'Curso:' : 'Período:', size: 6, italic: true, font: 'sans' }),
    T({ id: 'curso', x: 35, y: 33.6, w: 41, h: 4, text: hasCurso(c.level) ? c.f.curso : c.f.periodo, size: 6.4, bold: true, font: 'sans', shrink: true }),
    { k: 'image', slot: 'assinatura', x: 50, y: 39.2, w: 24, h: 5.6, fit: 'contain' },
    M({ id: 'dir', x: 46, y: 45.8, w: 32, h: 3.5, text: 'O Director', size: 6, italic: true, align: 'center', font: 'sans' }),
    { k: 'line', x1: 44, y1: 45.2, x2: 80, y2: 45.2, stroke: '#111', sw: 0.2 },
    { k: 'qr', x: 5, y: 40.5, w: 9, h: 9, value: c.verifyValue }
  ];
  return sceneH(p);
}

export function estBackGeneric(c: CardCtx, accent: string, ink = '#111111'): Scene {
  const p: Prim[] = [
    { k: 'rect', x: 0.4, y: 0.4, w: CARD_W - 0.8, h: CARD_H - 0.8, fill: '#ffffff', stroke: accent, sw: 0.35, r: 3 },
    { k: 'rect', x: 0.4, y: 0.4, w: CARD_W - 0.8, h: 7, fill: accent, r: 3 },
    M({ id: 'b-t', x: 4, y: 1.8, w: 78, h: 4, text: 'NORMAS DE UTILIZAÇÃO', size: 6.2, bold: true, color: '#ffffff', align: 'center', font: 'sans' }),
    M({ id: 'b-1', x: 4, y: 9, w: 56, h: 18, size: 5.2, color: ink, font: 'sans', lineH: 1.25, text: '1. O cartão é pessoal e intransmissível e deve ser apresentado sempre que solicitado.\n2. A perda ou o extravio deve ser comunicado de imediato à Secretaria.\n3. A segunda via implica o pagamento da respectiva taxa.' }),
    T({ id: 'b-val', x: 4, y: 29, w: 56, h: 4, text: `Válido até: ${c.f.validade || (c.f.ano ? c.f.ano.split(/\D+/)[1] || '' : '')}`, size: 6, bold: true, color: ink, font: 'sans' }),
    T({ id: 'b-proc', x: 4, y: 33.5, w: 56, h: 4, text: `Processo Nº ${c.f.proc || ''}`, size: 6, color: ink, font: 'sans' }),
    T({ id: 'b-bi', x: 4, y: 38, w: 56, h: 4, text: c.f.bi ? `B.I. Nº ${c.f.bi}` : '', size: 6, color: ink, font: 'sans' }),
    { k: 'qr', x: 62, y: 13, w: 20, h: 20, value: c.verifyValue },
    M({ id: 'b-qr', x: 58, y: 34, w: 28, h: 6, text: 'Validação pública\n(leia o código QR)', size: 4.6, align: 'center', color: ink, font: 'sans' }),
    M({ id: 'b-end', x: 4, y: 44.6, w: 78, h: 6, text: `${c.school.name}${c.school.address ? ' · ' + c.school.address : ''}${c.school.phone ? ' · ' + c.school.phone : ''}`, size: 4.6, align: 'center', color: '#475569', font: 'sans', shrink: true })
  ];
  return sceneH(p);
}

/** Cartão com faixa lateral de cor e cabeçalho colorido. */
function estBandFront(c: CardCtx, a: string, b: string): Scene {
  const L = headerLines(c.school, c.level);
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_W, h: CARD_H, fill: '#ffffff' },
    { k: 'rect', x: 0, y: 0, w: CARD_W, h: 14, fill: a, fill2: b },
    { k: 'image', slot: 'brasao', x: 3, y: 2.2, w: 9.6, h: 10, fit: 'contain' },
    M({ id: 'h1', x: 14, y: 1.8, w: 68, h: 3.4, text: 'REPÚBLICA DE ANGOLA · MINISTÉRIO DA EDUCAÇÃO', size: 5, bold: true, color: '#ffffff', font: 'sans' }),
    M({ id: 'h2', x: 14, y: 5.2, w: 68, h: 4.4, text: L[3], size: 7.4, bold: true, color: '#ffffff', font: 'sans', shrink: true }),
    M({ id: 'h3', x: 14, y: 9.6, w: 68, h: 3.4, text: c.school.subTitle || L[2], size: 4.8, color: '#ffffffcc', font: 'sans' }),
    { k: 'rect', x: 4, y: 17, w: 24, h: 31, fill: '#e2e8f0', stroke: a, sw: 0.5, r: 1.5 },
    { k: 'image', slot: 'foto', x: 4.3, y: 17.3, w: 23.4, h: 30.4, fit: 'cover' },
    T({ id: 'cartao', x: 31, y: 16.4, w: 52, h: 4, text: c.f.matricula ? `CARTÃO DE ESTUDANTE Nº ${c.f.matricula}` : 'CARTÃO DE ESTUDANTE', size: 6.2, bold: true, color: a, font: 'sans', shrink: true }),
    T({ id: 'nome', x: 31, y: 21, w: 52, h: 6, text: upper(c.f.nome), size: 9, bold: true, color: '#0f172a', font: 'sans', shrink: true }),
    M({ id: 'l1', x: 31, y: 28.4, w: 16, h: 3, text: hasCurso(c.level) ? 'CURSO' : 'PERÍODO', size: 4.2, color: '#64748b', font: 'sans', bold: true }),
    T({ id: 'v1', x: 31, y: 30.8, w: 28, h: 4, text: hasCurso(c.level) ? c.f.curso : c.f.periodo, size: 6.2, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l2', x: 61, y: 28.4, w: 20, h: 3, text: 'CLASSE / TURMA', size: 4.2, color: '#64748b', font: 'sans', bold: true }),
    T({ id: 'v2', x: 61, y: 30.8, w: 22, h: 4, text: `${c.f.classe.replace(/\s*classe/i, '')} · ${c.f.turma}${c.f.numero ? ' · Nº ' + c.f.numero : ''}`, size: 6.2, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l3', x: 31, y: 36.4, w: 20, h: 3, text: 'Nº PROCESSO', size: 4.2, color: '#64748b', font: 'sans', bold: true }),
    T({ id: 'v3', x: 31, y: 38.8, w: 28, h: 4, text: c.f.proc, size: 6.2, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l4', x: 61, y: 36.4, w: 20, h: 3, text: 'ANO LECTIVO', size: 4.2, color: '#64748b', font: 'sans', bold: true }),
    T({ id: 'v4', x: 61, y: 38.8, w: 22, h: 4, text: c.f.ano, size: 6.2, bold: true, font: 'sans' }),
    ...(hasCurso(c.level) ? [
      T({ id: 'curso-desc', x: 31, y: 43.2, w: 52, h: 5, text: c.f.cursoDesc, size: 4.4, italic: true, font: 'sans', color: '#334155', lineH: 1.1, valign: 'top', editable: true }) as Prim
    ] : []),
    { k: 'rect', x: 0, y: CARD_H - 4.2, w: CARD_W, h: 4.2, fill: b },
    M({ id: 'rod', x: 30, y: CARD_H - 3.7, w: 54, h: 3.2, text: 'O Director · Válido para o ano lectivo em curso', size: 4.2, color: '#ffffff', font: 'sans', align: 'right' })
  ];
  return sceneH(p);
}

/** Cartão VERTICAL (lanyard) 54 × 85,6. */
function estVerticalFront(c: CardCtx, a: string, b: string): Scene {
  const L = headerLines(c.school, c.level);
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: CARD_W, fill: '#ffffff' },
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: 30, fill: a, fill2: b },
    { k: 'rect', x: 20.5, y: 3, w: 13, h: 2.2, fill: '#ffffff', opacity: 0.4, r: 1.1 },
    { k: 'image', slot: 'brasao', x: 4, y: 7, w: 9, h: 9.5, fit: 'contain' },
    M({ id: 'h1', x: 14, y: 7, w: 38, h: 3.6, text: 'REPÚBLICA DE ANGOLA', size: 4.8, bold: true, color: '#ffffff', font: 'sans' }),
    M({ id: 'h2', x: 14, y: 10.6, w: 38, h: 6, text: L[3], size: 5.6, bold: true, color: '#ffffff', font: 'sans', shrink: true }),
    { k: 'ellipse', x: 13, y: 16, w: 28, h: 28, fill: '#ffffff' },
    { k: 'image', slot: 'foto', x: 14, y: 17, w: 26, h: 26, round: true, fit: 'cover' },
    M({ id: 'cartao', x: 4, y: 46.6, w: 46, h: 4, text: 'CARTÃO DE ESTUDANTE', size: 5.4, bold: true, color: a, font: 'sans', align: 'center', spacing: 1 }),
    T({ id: 'nome', x: 3, y: 51.2, w: 48, h: 7, text: upper(c.f.nome), size: 8.2, bold: true, align: 'center', font: 'sans', shrink: true, color: '#0f172a' }),
    T({ id: 'v1', x: 3, y: 59.4, w: 48, h: 4, text: `${c.f.classe} · Turma ${c.f.turma}${c.f.numero ? ' · Nº ' + c.f.numero : ''}`, size: 6, align: 'center', font: 'sans', color: '#334155', shrink: true }),
    T({ id: 'v2', x: 3, y: 63.4, w: 48, h: 4, text: hasCurso(c.level) ? c.f.curso : `Período: ${c.f.periodo}`, size: 5.6, align: 'center', font: 'sans', color: '#334155', shrink: true }),
    T({ id: 'v3', x: 3, y: 67.4, w: 48, h: 4, text: c.f.matricula ? `Matrícula Nº ${c.f.matricula}` : `Proc. Nº ${c.f.proc} · ${c.f.ano}`, size: 5.4, align: 'center', font: 'sans', color: '#64748b', shrink: true }),
    ...(hasCurso(c.level) ? [
      T({ id: 'curso-desc', x: 4, y: 70.8, w: 46, h: 5.4, text: c.f.cursoDesc, size: 4.2, italic: true, align: 'center', font: 'sans', color: '#475569', lineH: 1.1, valign: 'top', editable: true }) as Prim
    ] : []),
    { k: 'rect', x: 0, y: CARD_W - 9, w: CARD_H, h: 9, fill: b },
    M({ id: 'rod', x: 2, y: CARD_W - 6.4, w: 50, h: 4, text: 'O Director', size: 5, color: '#ffffff', font: 'sans', align: 'center' })
  ];
  return sceneV(p);
}
export function estVerticalBack(c: CardCtx, a: string): Scene {
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: CARD_W, fill: '#ffffff' },
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: 9, fill: a },
    M({ id: 'b-t', x: 2, y: 2.6, w: 50, h: 4, text: 'NORMAS DE UTILIZAÇÃO', size: 5.4, bold: true, color: '#ffffff', align: 'center', font: 'sans' }),
    M({ id: 'b-1', x: 4, y: 12, w: 46, h: 30, size: 5, color: '#111', font: 'sans', lineH: 1.3, text: '1. Cartão pessoal e intransmissível.\n2. Apresentar sempre que solicitado.\n3. Em caso de perda, comunique à Secretaria.\n4. Segunda via sujeita a taxa.' }),
    { k: 'qr', x: 14, y: 44, w: 26, h: 26, value: c.verifyValue },
    M({ id: 'b-qr', x: 4, y: 71, w: 46, h: 4, text: 'Validação pública (QR)', size: 4.6, align: 'center', color: '#475569', font: 'sans' }),
    M({ id: 'b-end', x: 3, y: 76.2, w: 48, h: 7, text: `${c.school.name}${c.school.phone ? ' · ' + c.school.phone : ''}`, size: 4.4, align: 'center', color: '#475569', font: 'sans', shrink: true })
  ];
  return sceneV(p);
}

// ---------------------------------------------------------------------------------------------
// CRACHÁ DE FUNCIONÁRIO — vertical 54 × 85,6
// ---------------------------------------------------------------------------------------------
function staffFront(c: CardCtx, a: string, b: string): Scene {
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: CARD_W, fill: '#ffffff' },
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: 28, fill: a, fill2: b },
    { k: 'rect', x: 20.5, y: 2.6, w: 13, h: 2.2, fill: '#ffffff', opacity: 0.45, r: 1.1 },
    { k: 'image', slot: 'brasao', x: 4, y: 7.5, w: 8.6, h: 9, fit: 'contain' },
    M({ id: 'h1', x: 14, y: 7.2, w: 38, h: 3.4, text: 'REPÚBLICA DE ANGOLA', size: 4.6, bold: true, color: '#ffffff', font: 'sans' }),
    M({ id: 'h2', x: 14, y: 10.4, w: 38, h: 7, text: upper(c.school.name), size: 5.6, bold: true, color: '#ffffff', font: 'sans', shrink: true }),
    { k: 'rect', x: 14, y: 19, w: 26, h: 33, fill: '#e2e8f0', stroke: '#ffffff', sw: 1, r: 2 },
    { k: 'image', slot: 'foto', x: 14.3, y: 19.3, w: 25.4, h: 32.4, fit: 'cover' },
    T({ id: 'nome', x: 3, y: 54, w: 48, h: 8, text: c.f.nome, size: 8.4, bold: true, align: 'center', font: 'sans', color: '#0f172a', shrink: true }),
    T({ id: 'cargo', x: 3, y: 62.2, w: 48, h: 4, text: c.f.cargo, size: 6, bold: true, align: 'center', font: 'sans', color: a, shrink: true }),
    T({ id: 'depto', x: 3, y: 66.4, w: 48, h: 4, text: c.f.depto, size: 5.4, align: 'center', font: 'sans', color: '#475569', shrink: true }),
    M({ id: 'l-n', x: 5, y: 72, w: 20, h: 3, text: 'N.º FUNC.', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'numero', x: 5, y: 74.6, w: 24, h: 4, text: c.f.numero, size: 6, bold: true, font: 'sans', shrink: true }),
    M({ id: 'l-s', x: 31, y: 72, w: 20, h: 3, text: 'VALIDADE', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'validade', x: 31, y: 74.6, w: 20, h: 4, text: c.f.validade, size: 6, bold: true, font: 'sans' }),
    { k: 'rect', x: 0, y: CARD_W - 3.4, w: CARD_H, h: 3.4, fill: b }
  ];
  return sceneV(p);
}
function staffBack(c: CardCtx, a: string): Scene {
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: CARD_W, fill: '#ffffff' },
    { k: 'rect', x: 0, y: 0, w: CARD_H, h: 8, fill: a },
    M({ id: 'b-t', x: 2, y: 2.4, w: 50, h: 4, text: 'IDENTIFICAÇÃO DO FUNCIONÁRIO', size: 5, bold: true, color: '#ffffff', align: 'center', font: 'sans' }),
    M({ id: 'l1', x: 5, y: 11, w: 40, h: 3, text: 'B.I. / NIF', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'bi', x: 5, y: 13.6, w: 44, h: 4, text: [c.f.bi, c.f.nif].filter(Boolean).join(' · '), size: 5.6, font: 'sans', shrink: true }),
    M({ id: 'l2', x: 5, y: 19, w: 40, h: 3, text: 'ADMISSÃO', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'adm', x: 5, y: 21.6, w: 44, h: 4, text: c.f.admissao, size: 5.6, font: 'sans' }),
    M({ id: 'l3', x: 5, y: 27, w: 40, h: 3, text: 'TELEFONE', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'tel', x: 5, y: 29.6, w: 44, h: 4, text: c.f.tel, size: 5.6, font: 'sans' }),
    M({ id: 'l4', x: 5, y: 35, w: 40, h: 3, text: 'GRUPO SANGUÍNEO', size: 4, bold: true, color: '#64748b', font: 'sans' }),
    T({ id: 'sg', x: 5, y: 37.6, w: 44, h: 4, text: c.f.sangue, size: 5.6, font: 'sans' }),
    { k: 'qr', x: 15, y: 44, w: 24, h: 24, value: c.verifyValue },
    M({ id: 'b-qr', x: 4, y: 69, w: 46, h: 4, text: 'Controlo de acessos (QR)', size: 4.4, align: 'center', color: '#475569', font: 'sans' }),
    M({ id: 'b-1', x: 4, y: 74, w: 46, h: 9, text: 'Propriedade da instituição. Se encontrar este cartão, devolva à Secretaria.', size: 4.2, align: 'center', color: '#475569', font: 'sans', lineH: 1.2 })
  ];
  return sceneV(p);
}

// ---------------------------------------------------------------------------------------------
// CARTÃO DE TRANSPORTE ESCOLAR — horizontal
// ---------------------------------------------------------------------------------------------
function transpFront(c: CardCtx, a: string, b: string, ink: string): Scene {
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: CARD_W, h: CARD_H, fill: a, fill2: b },
    { k: 'rect', x: 0, y: 40, w: CARD_W, h: 14, fill: '#000000', opacity: 0.12 },
    { k: 'rect', x: 0, y: 15.5, w: CARD_W, h: 1.6, fill: '#ffffff', opacity: 0.55 },
    { k: 'image', slot: 'brasao', x: 3.2, y: 2.4, w: 9, h: 9.5, fit: 'contain' },
    M({ id: 'h1', x: 14, y: 2.2, w: 68, h: 3.4, text: 'REPÚBLICA DE ANGOLA · MINISTÉRIO DA EDUCAÇÃO', size: 4.8, bold: true, color: ink, font: 'sans' }),
    M({ id: 'h2', x: 14, y: 5.6, w: 68, h: 4.4, text: 'CARTÃO DE TRANSPORTE ESCOLAR', size: 8, bold: true, color: ink, font: 'sans' }),
    M({ id: 'h3', x: 14, y: 10.4, w: 68, h: 4, text: upper(c.school.name), size: 5.2, color: ink, font: 'sans', shrink: true }),
    { k: 'rect', x: 4, y: 19, w: 21, h: 27, fill: '#ffffff', r: 1.5 },
    { k: 'image', slot: 'foto', x: 4.4, y: 19.4, w: 20.2, h: 26.2, fit: 'cover' },
    M({ id: 'l1', x: 28, y: 18.4, w: 20, h: 3, text: c.f.lPessoa || 'ALUNO', size: 4, bold: true, color: ink, font: 'sans' }),
    T({ id: 'nome', x: 28, y: 21, w: 55, h: 5, text: upper(c.f.nome), size: 8, bold: true, color: ink, font: 'sans', shrink: true }),
    M({ id: 'l2', x: 28, y: 28, w: 20, h: 3, text: c.f.lClasse || 'CLASSE / TURMA', size: 4, bold: true, color: ink, font: 'sans' }),
    T({ id: 'v2', x: 28, y: 30.4, w: 26, h: 4, text: `${c.f.classe.replace(/\s*classe/i, '')} · ${c.f.turma}`, size: 6, bold: true, color: ink, font: 'sans', shrink: true }),
    M({ id: 'l3', x: 56, y: 28, w: 26, h: 3, text: c.f.lProc || 'Nº PROCESSO', size: 4, bold: true, color: ink, font: 'sans' }),
    T({ id: 'v3', x: 56, y: 30.4, w: 26, h: 4, text: c.f.proc, size: 6, bold: true, color: ink, font: 'sans', shrink: true }),
    M({ id: 'l4', x: 28, y: 36, w: 26, h: 3, text: 'LINHA / ROTA', size: 4, bold: true, color: ink, font: 'sans' }),
    T({ id: 'rota', x: 28, y: 38.4, w: 54, h: 4, text: c.f.rota || '', size: 6, bold: true, color: ink, font: 'sans', shrink: true, editable: true }),
    M({ id: 'l5', x: 4, y: 47.4, w: 30, h: 3, text: 'ANO LECTIVO', size: 4, bold: true, color: ink, font: 'sans' }),
    T({ id: 'ano', x: 4, y: 49.6, w: 30, h: 3.6, text: c.f.ano, size: 5.6, bold: true, color: ink, font: 'sans' }),
    { k: 'qr', x: 68, y: 40, w: 13.5, h: 13.5, value: c.verifyValue }
  ];
  return sceneH(p);
}
// ---------------------------------------------------------------------------------------------
// DIPLOMA — A4 paisagem 297 × 210
// ---------------------------------------------------------------------------------------------
function diplomaScene(c: CardCtx, o: { frame: string; frame2: string; paper: string; title: string; accent: string }): Scene {
  const W = 297, H = 210;
  const L = headerLines(c.school, c.level);
  const p: Prim[] = [
    { k: 'rect', x: 0, y: 0, w: W, h: H, fill: o.paper },
    { k: 'rect', x: 7, y: 7, w: W - 14, h: H - 14, stroke: o.frame, sw: 2.2 },
    { k: 'rect', x: 10.5, y: 10.5, w: W - 21, h: H - 21, stroke: o.frame2, sw: 0.6 },
    { k: 'rect', x: 13, y: 13, w: W - 26, h: H - 26, stroke: o.frame, sw: 0.3 },
    { k: 'ellipse', x: 4.5, y: 4.5, w: 9, h: 9, fill: o.frame },
    { k: 'ellipse', x: W - 13.5, y: 4.5, w: 9, h: 9, fill: o.frame },
    { k: 'ellipse', x: 4.5, y: H - 13.5, w: 9, h: 9, fill: o.frame },
    { k: 'ellipse', x: W - 13.5, y: H - 13.5, w: 9, h: 9, fill: o.frame },
    { k: 'image', slot: 'brasao', x: W / 2 - 40, y: 55, w: 80, h: 80, opacity: 0.06, fit: 'contain' },
    { k: 'image', slot: 'brasao', x: W / 2 - 11, y: 18, w: 22, h: 23, fit: 'contain' },
    M({ id: 'd1', x: 40, y: 43, w: W - 80, h: 6, text: L[0], size: 13, bold: true, align: 'center', font: 'serif', color: '#111' }),
    M({ id: 'd2', x: 40, y: 49.5, w: W - 80, h: 6, text: L[1], size: 13, bold: true, align: 'center', font: 'serif', color: '#111' }),
    M({ id: 'd3', x: 30, y: 56, w: W - 60, h: 6, text: L[3], size: 12, bold: true, align: 'center', font: 'serif', color: o.accent, shrink: true }),
    M({ id: 'dt', x: 30, y: 68, w: W - 60, h: 18, text: o.title, size: 38, bold: true, align: 'center', font: 'serif', color: o.accent, spacing: 3 }),
    M({ id: 'dtxt1', x: 40, y: 92, w: W - 80, h: 9, text: 'A Direcção da instituição confere o presente diploma a', size: 13, italic: true, align: 'center', font: 'serif', color: '#222' }),
    T({ id: 'dnome', x: 30, y: 103, w: W - 60, h: 16, text: upper(c.f.nome), size: 30, bold: true, align: 'center', font: 'serif', color: '#111', shrink: true }),
    { k: 'line', x1: 60, y1: 121, x2: W - 60, y2: 121, stroke: o.frame, sw: 0.5 },
    T({ id: 'dtxt2', x: 35, y: 124, w: W - 70, h: 26, text: c.f.outorga || '', size: 13, align: 'center', font: 'serif', color: '#222', lineH: 1.5, editable: true }),
    T({ id: 'ddata', x: 40, y: 152, w: W - 80, h: 7, text: c.f.dataEmissao || '', size: 12, bold: true, align: 'center', font: 'serif', color: '#111', editable: true }),
    { k: 'line', x1: 40, y1: 182, x2: 112, y2: 182, stroke: '#111', sw: 0.35 },
    { k: 'line', x1: W - 112, y1: 182, x2: W - 40, y2: 182, stroke: '#111', sw: 0.35 },
    M({ id: 'sig1c', x: 40, y: 183, w: 72, h: 5, text: 'O Director Pedagógico', size: 11, align: 'center', font: 'serif' }),
    M({ id: 'sig2c', x: W - 112, y: 183, w: 72, h: 5, text: 'O Director', size: 11, align: 'center', font: 'serif' }),
    M({ id: 'sig1', x: 40, y: 188.4, w: 72, h: 5, text: c.school.directorPedagogicoName, size: 11, bold: true, align: 'center', font: 'serif', shrink: true }),
    M({ id: 'sig2', x: W - 112, y: 188.4, w: 72, h: 5, text: c.school.directorName, size: 11, bold: true, align: 'center', font: 'serif', shrink: true }),
    { k: 'ellipse', x: W / 2 - 16, y: 160, w: 32, h: 32, fill: '#c9a227', opacity: 0.95 },
    { k: 'ellipse', x: W / 2 - 13, y: 163, w: 26, h: 26, stroke: '#ffffff', sw: 0.7 },
    M({ id: 'selo', x: W / 2 - 13, y: 172.5, w: 26, h: 8, text: 'SELO\nOFICIAL', size: 7, bold: true, color: '#ffffff', align: 'center', font: 'serif', lineH: 1.1 }),
    T({ id: 'dreg', x: 20, y: H - 17, w: 80, h: 4, text: c.f.registo || '', size: 7, font: 'sans', color: '#444', editable: true })
  ];
  return { w: W, h: H, prims: p };
}

const diploma = (frame: string, frame2: string, paper: string, title: string, accent: string): Pick<CardModel, 'front' | 'back'> => ({
  front: (c) => diplomaScene(c, { frame, frame2, paper, title, accent }),
  back: (c) => diplomaScene(c, { frame, frame2, paper, title, accent })
});

// ---------------------------------------------------------------------------------------------
// REGISTO
// ---------------------------------------------------------------------------------------------
const LV: Array<[StudioLevel, string]> = [['primario', 'Ensino Primário'], ['iciclo', 'I Ciclo'], ['iiciclo', 'Ensino Médio (II Ciclo)']];

const studentModels: CardModel[] = [];
for (const [lv, lvLabel] of LV) {
  studentModels.push(
    { id: `est-oficial-${lv}`, kind: 'estudante', name: `Modelo Oficial · ${lvLabel}`, description: 'Réplica da folha oficial de 8 cartões: moldura fina, marca de água e foto à direita.', orientation: 'h', level: lv, swatch: ['#ffffff', '#0b2a6b'], front: estOficialFront, back: (c) => estBackGeneric(c, '#0b2a6b'), talao: true, alt: { front: (c) => estVerticalFront(c, '#0b2a6b', '#111111'), back: (c) => estVerticalBack(c, '#0b2a6b') } },
    { id: `est-azul-${lv}`, kind: 'estudante', name: `Azul Institucional · ${lvLabel}`, description: 'Cabeçalho azul degradé, foto 3×4 e dados em grelha.', orientation: 'h', level: lv, swatch: ['#12498a', '#2563eb'], front: (c) => estBandFront(c, '#12498a', '#2563eb'), back: (c) => estBackGeneric(c, '#12498a'), talao: true, alt: { front: (c) => estVerticalFront(c, '#12498a', '#2563eb'), back: (c) => estVerticalBack(c, '#12498a') } },
    { id: `est-verde-${lv}`, kind: 'estudante', name: `Verde Floresta · ${lvLabel}`, description: 'Faixas verdes inspiradas no Politécnico do Bita.', orientation: 'h', level: lv, swatch: ['#14532d', '#16a34a'], front: (c) => estBandFront(c, '#14532d', '#16a34a'), back: (c) => estBackGeneric(c, '#14532d'), talao: true, alt: { front: (c) => estVerticalFront(c, '#14532d', '#16a34a'), back: (c) => estVerticalBack(c, '#14532d') } },
    { id: `est-vinho-${lv}`, kind: 'estudante', name: `Vinho & Dourado · ${lvLabel}`, description: 'Cartão horizontal vinho com rodapé dourado.', orientation: 'h', level: lv, swatch: ['#7a0c0c', '#b45309'], front: (c) => estBandFront(c, '#7a0c0c', '#b45309'), back: (c) => estBackGeneric(c, '#7a0c0c'), talao: true, alt: { front: (c) => estVerticalFront(c, '#7a0c0c', '#b45309'), back: (c) => estVerticalBack(c, '#7a0c0c') } },
    { id: `est-vertical-${lv}`, kind: 'estudante', name: `Vertical Lanyard · ${lvLabel}`, description: 'Cartão vertical para fita (54 × 85,6 mm) com foto redonda.', orientation: 'v', level: lv, swatch: ['#1d4ed8', '#0f172a'], front: (c) => estVerticalFront(c, '#1d4ed8', '#0f172a'), back: (c) => estVerticalBack(c, '#1d4ed8'), talao: true, alt: { front: (c) => estBandFront(c, '#1d4ed8', '#0f172a'), back: (c) => estBackGeneric(c, '#1d4ed8') } }
  );
}

const htmlStudentModels: CardModel[] = htmlModels(estBackGeneric, estVerticalBack);

const staffModels: CardModel[] = [
  // 19 modelos fiéis à galeria HTML "Studio Crachá" (ver cardsStaff.ts)
  ...staffHtmlModels.map((m): CardModel => ({ ...m, kind: 'funcionario', orientation: 'v', level: 'todos' })),
  // modelos genéricos anteriores — mantidos para reimpressão de cartões já emitidos
  { id: 'func-azul', kind: 'funcionario', name: 'Crachá Azul Institucional', description: 'Vertical, frente e verso, com QR de controlo de acessos.', orientation: 'v', swatch: ['#12498a', '#2563eb'], front: (c) => staffFront(c, '#12498a', '#2563eb'), back: (c) => staffBack(c, '#12498a'), alt: { front: (c) => staffFrontH(c, '#12498a', '#2563eb'), back: (c) => staffBackH(c, '#12498a') } },
  { id: 'func-vinho', kind: 'funcionario', name: 'Crachá Vinho Corporativo', description: 'Vertical com cabeçalho vinho.', orientation: 'v', swatch: ['#7a0c0c', '#450a0a'], front: (c) => staffFront(c, '#7a0c0c', '#450a0a'), back: (c) => staffBack(c, '#7a0c0c'), alt: { front: (c) => staffFrontH(c, '#7a0c0c', '#450a0a'), back: (c) => staffBackH(c, '#7a0c0c') } },
  { id: 'func-verde', kind: 'funcionario', name: 'Crachá Verde Floresta', description: 'Vertical com cabeçalho verde.', orientation: 'v', swatch: ['#14532d', '#16a34a'], front: (c) => staffFront(c, '#14532d', '#16a34a'), back: (c) => staffBack(c, '#14532d'), alt: { front: (c) => staffFrontH(c, '#14532d', '#16a34a'), back: (c) => staffBackH(c, '#14532d') } },
  { id: 'func-grafite', kind: 'funcionario', name: 'Crachá Grafite Executivo', description: 'Vertical sóbrio, cinza-grafite.', orientation: 'v', swatch: ['#334155', '#0f172a'], front: (c) => staffFront(c, '#334155', '#0f172a'), back: (c) => staffBack(c, '#334155'), alt: { front: (c) => staffFrontH(c, '#334155', '#0f172a'), back: (c) => staffBackH(c, '#334155') } }
];

// Verso igual para todos os modelos de transporte (autorização mensal de 12 meses + QR de embarque):
// muda só a cor. [id, nome, descrição, cor1, cor2, tinta da frente, cor do verso, destaque no verso, tinta do verso]
const TRANSP_STYLES: Array<[string, string, string, string, string, string, string, string, string]> = [
  ['amarelo', 'Amarelo Escolar', 'Autocarro escolar clássico, amarelo.', '#facc15', '#f59e0b', '#1f2937', '#fde047', '#fde047', '#1f2937'],
  ['azul', 'Azul Bilhete Único', 'Estilo bilhete único, azul.', '#1d4ed8', '#38bdf8', '#ffffff', '#2563eb', '#93c5fd', '#ffffff'],
  ['verde', 'Verde Mobilidade', 'Verde com a rota em destaque.', '#15803d', '#4ade80', '#ffffff', '#16a34a', '#86efac', '#ffffff'],
  ['laranja', 'Laranja Urbano', 'Laranja vivo, visível de longe.', '#ea580c', '#fb923c', '#ffffff', '#f97316', '#fdba74', '#ffffff'],
  ['vermelho', 'Vermelho Expresso', 'Vermelho de linha expresso.', '#b91c1c', '#f87171', '#ffffff', '#dc2626', '#fca5a5', '#ffffff'],
  ['roxo', 'Roxo Metro', 'Roxo estilo metropolitano.', '#6d28d9', '#a78bfa', '#ffffff', '#7c3aed', '#c4b5fd', '#ffffff'],
  ['turquesa', 'Turquesa Costa', 'Turquesa fresco, litoral.', '#0f766e', '#2dd4bf', '#ffffff', '#0d9488', '#5eead4', '#ffffff'],
  ['rosa', 'Rosa Vibrante', 'Rosa forte para linhas infantis.', '#be185d', '#f472b6', '#ffffff', '#db2777', '#f9a8d4', '#ffffff'],
  ['grafite', 'Grafite Executivo', 'Cinza-grafite sóbrio.', '#1e293b', '#64748b', '#ffffff', '#475569', '#cbd5e1', '#ffffff'],
  ['bordo', 'Bordô Clássico', 'Bordô institucional.', '#7f1d1d', '#be123c', '#ffffff', '#9f1239', '#fda4af', '#ffffff']
];
const transpModels: CardModel[] = TRANSP_STYLES.map(([id, name, description, c1, c2, ink, back, hi, binkInk]): CardModel => ({
  id: `transp-${id}`, kind: 'transporte', name, description: `${description} Verso com autorização mensal e QR de embarque.`, orientation: 'h', swatch: [c1, c2],
  front: (c) => transpFront(c, c1, c2, ink), back: (c) => transpBackH(c, back, hi, binkInk),
  alt: { front: (c) => transpFrontV(c, c1, c2, ink), back: (c) => transpBackV(c, back, hi, binkInk) }
}));

const diplomaModels: CardModel[] = [
  { id: 'dipl-esmeralda', kind: 'diploma', name: 'Louros Esmeralda', description: 'Moldura tripla verde-esmeralda sobre papel marfim.', orientation: 'a4l', swatch: ['#065f46', '#c9a227'], ...diploma('#065f46', '#c9a227', '#fffdf5', 'DIPLOMA', '#065f46') },
  { id: 'dipl-petroleo', kind: 'diploma', name: 'Régio Azul Petróleo', description: 'Moldura azul petróleo e dourado.', orientation: 'a4l', swatch: ['#0c4a6e', '#c9a227'], ...diploma('#0c4a6e', '#c9a227', '#fbfdff', 'DIPLOMA', '#0c4a6e') },
  { id: 'dipl-bordo', kind: 'diploma', name: 'Bordô Filigrana', description: 'Moldura bordô, clássico.', orientation: 'a4l', swatch: ['#7a0c0c', '#c9a227'], ...diploma('#7a0c0c', '#c9a227', '#fffaf5', 'DIPLOMA', '#7a0c0c') },
  { id: 'dipl-pergaminho', kind: 'diploma', name: 'Pergaminho Imperial', description: 'Papel pergaminho com moldura castanha.', orientation: 'a4l', swatch: ['#78350f', '#b45309'], ...diploma('#78350f', '#b45309', '#f6ecd2', 'CERTIFICADO DE CONCLUSÃO', '#78350f') }
];

export const CARD_KINDS: CardKind[] = [
  { id: 'estudante', label: 'Cartão de Estudante', icon: 'badge' },
  { id: 'funcionario', label: 'Passe / Crachá de Funcionário', icon: 'id_card' },
  { id: 'transporte', label: 'Cartão de Transporte Escolar', icon: 'directions_bus' },
  { id: 'diploma', label: 'Diplomas', icon: 'workspace_premium' }
];

export const CARD_MODELS: CardModel[] = [...studentModels, ...htmlStudentModels, ...staffModels, ...transpModels, ...diplomaModels];
export const getCardModel = (id: string) => CARD_MODELS.find((m) => m.id === id);

export { dataCurta };
