/**
 * Documentos "de fluxo" (certificados e declarações): cabeçalho, texto, tabela de notas e assinaturas.
 * A mesma estrutura gera a página HTML (editável) e o Word (.docx).
 */
import type { GradeRow, StudioData, StudioLevel } from './data';
import { LEVEL_LABEL } from './data';
import { classNumber, dataPorExtenso, notaPorExtenso, upper } from './format';
import { b, red, mono, t } from './rich';
import { normalizeText } from '../utils/curriculum';

// ---------------------------------------------------------------------------------------------
// Estilo de página (moldura, papel, marca de água)
// ---------------------------------------------------------------------------------------------
export type BorderKey = 'duplaVermelha' | 'purpura' | 'purpuraFina' | 'verdeOuro' | 'greca' | 'fina' | 'nenhuma';
export type PaperKey = 'branco' | 'rosa' | 'marfim' | 'azulGelo';

export const BORDER_OPTIONS: Array<{ key: BorderKey; label: string; color: string }> = [
  { key: 'duplaVermelha', label: 'Dupla vermelha (oficial)', color: '#E00000' },
  { key: 'purpura', label: 'Púrpura grossa', color: '#7030A0' },
  { key: 'purpuraFina', label: 'Púrpura / azul fina', color: '#5B5FBF' },
  { key: 'verdeOuro', label: 'Dupla filete verde', color: '#B7CE8B' },
  { key: 'greca', label: 'Grega geométrica (azul)', color: '#1F3FBF' },
  { key: 'fina', label: 'Fina institucional', color: '#595959' },
  { key: 'nenhuma', label: 'Sem moldura (timbrado)', color: '#000000' }
];
export const PAPER_OPTIONS: Array<{ key: PaperKey; label: string; color: string }> = [
  { key: 'branco', label: 'Branco neve', color: '#FFFFFF' },
  { key: 'rosa', label: 'Rosa (Samora Machel)', color: '#F9A8C4' },
  { key: 'marfim', label: 'Marfim institucional', color: '#FBF5E3' },
  { key: 'azulGelo', label: 'Azul-gelo', color: '#EEF5FF' }
];

export interface PageStyle {
  border: BorderKey;
  /** Cor da moldura (hex). Por omissão a da opção escolhida. */
  borderColor?: string;
  paper: PaperKey;
  /** Cor de fundo personalizada (substitui o papel). */
  customPaper?: string;
  watermark: boolean;
  font: 'serif' | 'sans';
}
export const borderColorOf = (s: PageStyle) => s.borderColor || BORDER_OPTIONS.find((o) => o.key === s.border)?.color || '#000000';
export const paperColorOf = (s: PageStyle) => s.customPaper || PAPER_OPTIONS.find((o) => o.key === s.paper)?.color || '#FFFFFF';

// ---------------------------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------------------------
export interface TableCol { label: string; w: number; align?: 'left' | 'center' }
export interface TableRow { cells: string[]; kind?: 'data' | 'section' | 'total'; na?: boolean[] }
export interface TableSpec {
  cols: TableCol[];
  rows: TableRow[];
  headerFill: string;
  sectionFill: string;
  /** Células "não aplicável" (disciplina que a classe não tem) */
  naFill?: string;
  fontPt: number;
  /** Tabela em grelha de 2 colunas de disciplinas (declaração do I/II ciclo). */
  twoUp?: boolean;
}

export type Block =
  | { t: 'images'; left?: string; center: string; right?: string; h: number }
  | { t: 'line'; id: string; text: string; size: number; bold?: boolean; align?: 'center' | 'left'; after: number; font?: 'serif' | 'sans' | 'mono'; scope: 'model' | 'doc' }
  | { t: 'para'; id: string; html: string; size: number; align: 'justify' | 'left' | 'center'; after: number; scope: 'model' | 'doc'; before?: number }
  | { t: 'table'; spec: TableSpec }
  | { t: 'sign'; left: { label: string; name: string; idL: string; idN: string }; right: { label: string; name: string; idL: string; idN: string } }
  | { t: 'spacer'; h: number };

export interface FlowDoc { page: PageStyle; blocks: Block[]; warnings: string[]; title: string }

export interface FlowExtras {
  livro: string;
  folha: string;
  pap?: number;
  area: string;
  turmaNumero?: string;
  decreeOverride?: string;
  ejaGrades: { alf?: number; m2?: number; m3?: number };
  purpose?: string;
  /** Director(a) pedagógico(a) (declaração do I/II ciclo). */
  genderDirector: 'Director' | 'Directora';
}

export interface FlowCtx {
  data: StudioData;
  classNum: number | null;
  year: string;
  extras: FlowExtras;
}

export interface FlowModel {
  id: string;
  kind: 'certificado' | 'declaracao';
  name: string;
  description: string;
  level: StudioLevel;
  /** Declaração com/sem notas (só para kind=declaracao). */
  withGrades?: boolean;
  /** Classes que o modelo cobre (para o selector). */
  classes: number[];
  defaultPage: PageStyle;
  build: (c: FlowCtx) => FlowDoc;
}

// ---------------------------------------------------------------------------------------------
// Auxiliares de texto
// ---------------------------------------------------------------------------------------------
const gw = (g: 'M' | 'F') => ({
  filho: g === 'F' ? 'filha' : 'filho',
  nascido: g === 'F' ? 'nascida' : 'nascido',
  portador: g === 'F' ? 'Portadora' : 'Portador'
});
const BL = '________';
const orBlank = (v?: string, blank = BL) => (v && String(v).trim() ? String(v).trim() : blank);
const pad2 = (n: number) => String(n).padStart(2, '0');

function filiation(d: StudioData): string {
  const { person: p } = d;
  const w = gw(p.gender);
  const parents = [p.father, p.mother].filter(Boolean);
  if (!parents.length) return `${w.filho} de ${BL} e de ${BL}`;
  return `${w.filho} de ${orBlank(p.father)} e de ${orBlank(p.mother)}`;
}
function birthText(d: StudioData, ext = true): string {
  const { person: p } = d;
  const w = gw(p.gender);
  const date = ext ? p.birthDateExt : p.birthDate;
  const nat = p.naturalidade || BL, mun = p.municipio || nat, prov = p.provincia || mun;
  return `${w.nascido} aos ${orBlank(date, '__/__/____')}, natural de ${nat}, Município de ${mun}, Província de ${prov}`;
}
function biText(d: StudioData, upperP = true): string {
  const w = gw(d.person.gender);
  const city = d.school.city || BL;
  return `${upperP ? w.portador : w.portador.toLowerCase()} do B.I nº ${orBlank(d.person.bi, '_____________')}, passado pelo Arquivo de Identificação de ${city} aos ${orBlank(d.person.biIssueDate, '__/__/____')}`;
}

const headerLinesFor = (level: StudioLevel): string[] =>
  level === 'primario' ? ['REPÚBLICA DE ANGOLA', 'MINISTÉRIO DA EDUCAÇÃO', 'ENSINO PRIMÁRIO']
    : level === 'iciclo' ? ['REPÚBLICA DE ANGOLA', 'MINISTÉRIO DA EDUCAÇÃO', 'I CICLO DO ENSINO SECUNDÁRIO']
    : level === 'iiciclo' ? ['REPÚBLICA DE ANGOLA', 'MINISTÉRIO DA EDUCAÇÃO', 'ENSINO SECUNDÁRIO GERAL']
    : level === 'tecnico' ? ['REPÚBLICA DE ANGOLA', 'MINISTÉRIO DA EDUCAÇÃO', 'ENSINO SECUNDÁRIO TÉCNICO-PROFISSIONAL']
    : ['REPÚBLICA DE ANGOLA', 'MINISTÉRIO DA EDUCAÇÃO', 'EDUCAÇÃO DE ADULTOS'];

const ALINEA: Record<StudioLevel, string> = { primario: 'b)', iciclo: 'c)', iiciclo: 'e)', tecnico: 'f)', eja: 'b)' };

// ---------------------------------------------------------------------------------------------
// Tabelas de notas
// ---------------------------------------------------------------------------------------------
const CANON: Record<string, string[]> = {
  primario: ['lingua portuguesa', 'matematica', 'estudo do meio', 'ciencia da natureza', 'historia', 'geografia', 'educacao moral e civica', 'educacao manual e plastica', 'educacao visual plastica', 'educacao musical', 'educacao fisica'],
  iciclo: ['lingua portuguesa', 'lingua inglesa', 'matematica', 'biologia', 'fisica', 'quimica', 'geografia', 'historia', 'educacao fisica', 'educacao moral e civica', 'educacao visual plastica', 'educacao laboral'],
  iiciclo: ['lingua portuguesa', 'matematica', 'informatica', 'filosofia', 'educacao fisica', 'empreendedorismo', 'lingua estrangeira', 'lingua inglesa', 'historia', 'geografia', 'literatura', 'biologia', 'fisica', 'quimica', 'psicologia', 'antropologia', 'sociologia']
};
const GERAL = ['lingua portuguesa', 'matematica', 'informatica', 'filosofia', 'educacao fisica', 'empreendedorismo'];
const ESPEC = ['lingua estrangeira', 'lingua inglesa', 'lingua francesa', 'historia', 'geografia', 'literatura', 'biologia', 'fisica', 'quimica', 'economia', 'direito', 'contabilidade', 'desenho'];
const SOCIO = ['lingua portuguesa', 'lingua estrangeira', 'lingua inglesa', 'formacao de atitudes integradoras', 'educacao fisica'];
const CIENT = ['matematica', 'biologia', 'fisica', 'quimica', 'informatica', 'psicologia geral', 'psicologia'];

function orderRows(rows: GradeRow[], canon: string[]): GradeRow[] {
  const idx = (r: GradeRow) => { const k = normalizeText(r.subject); const i = canon.findIndex((c) => k.includes(c) || c.includes(k)); return i < 0 ? 999 : i; };
  return [...rows].sort((a, b) => idx(a) - idx(b) || a.subject.localeCompare(b.subject));
}

const fmt = (n: number | undefined, padded: boolean) => (n === undefined ? '' : padded ? pad2(n) : String(n));
const extensoCell = (n: number | undefined) => (n === undefined ? '' : `${notaPorExtenso(n)}\u00A0\u00A0\u00A0\u00A0Valores`);

function classColumnsTable(rows: GradeRow[], cls: number[], o: { padded: boolean; headerFill: string; naFill?: string; naSubjects?: string[]; fontPt?: number; label?: string }): { spec: TableSpec; avg: number | undefined } {
  const own = rows.map((r) => {
    const vals = cls.map((c) => r.byClass[c]).filter((n): n is number => typeof n === 'number');
    return { r, final: vals.length ? Math.round(vals.reduce((a, c) => a + c, 0) / vals.length) : undefined };
  }).filter((x) => x.final !== undefined);
  const finals = own.map((x) => x.final as number);
  const avg = finals.length ? Math.round(finals.reduce((a, c) => a + c, 0) / finals.length) : undefined;
  const spec: TableSpec = {
    headerFill: o.headerFill, sectionFill: '#D9D9D9', naFill: o.naFill, fontPt: o.fontPt || 10,
    cols: [{ label: o.label || 'Disciplinas', w: 0.30, align: 'left' }, ...cls.map((c) => ({ label: `${c}ª Classe`, w: 0.12, align: 'center' as const })), { label: 'Média Final', w: 0.14, align: 'center' }, { label: 'Média por Extenso', w: 0.26, align: 'left' }],
    rows: own.map(({ r, final }) => ({
      kind: 'data',
      cells: [r.subject, ...cls.map((c) => fmt(r.byClass[c], o.padded)), fmt(final, o.padded), extensoCell(final)],
      na: [false, ...cls.map((c) => !!o.naSubjects && r.byClass[c] === undefined && o.naSubjects.some((s) => normalizeText(r.subject).includes(s))), false, false]
    }))
  };
  return { spec, avg };
}

// ---------------------------------------------------------------------------------------------
// Cabeçalho comum
// ---------------------------------------------------------------------------------------------
function head(c: FlowCtx, level: StudioLevel, o: { title: string; subtitle?: string; logoLeft?: boolean; boldTop?: boolean; titleSize?: number }): Block[] {
  const lines = headerLinesFor(level);
  const out: Block[] = [{ t: 'images', left: o.logoLeft ? 'logo' : undefined, center: 'brasao', h: 22 }];
  out.push({ t: 'spacer', h: 3 });
  out.push({ t: 'line', id: 'h1', text: lines[0], size: 11, bold: true, align: 'center', after: 0, scope: 'model', font: undefined });
  out.push({ t: 'line', id: 'h2', text: lines[1], size: 11, bold: true, align: 'center', after: 0, scope: 'model' });
  if (o.subtitle !== '') out.push({ t: 'line', id: 'h3', text: o.subtitle ?? lines[2], size: 11, bold: true, align: 'center', after: 6, scope: 'model' });
  out.push({ t: 'line', id: 'titulo', text: o.title, size: o.titleSize || 15, bold: true, align: 'center', after: 8, scope: 'model' });
  return out;
}

function sign(c: FlowCtx, o: { leftLabel?: string; rightLabel: string; leftName?: string; rightName: string }): Block {
  return { t: 'sign', left: { label: o.leftLabel ?? 'Conferido por', name: o.leftName ?? '', idL: 'sigLL', idN: 'sigLN' }, right: { label: o.rightLabel, name: o.rightName, idL: 'sigRL', idN: 'sigRN' } };
}

const dateLine = (c: FlowCtx): Block => ({ t: 'line', id: 'data', text: `${c.data.school.city || ''}, ${c.data.school.city ? 'aos ' : ''}${dataPorExtenso(new Date())}.`, size: 11, bold: true, align: 'center', after: 10, scope: 'doc' });

const para = (id: string, html: string, o: Partial<{ size: number; align: 'justify' | 'left' | 'center'; after: number; scope: 'model' | 'doc'; before: number }> = {}): Block => ({ t: 'para', id, html, size: o.size || 12, align: o.align || 'justify', after: o.after ?? 6, scope: o.scope || 'doc', before: o.before });

const dirTitle = (c: FlowCtx) => c.extras.genderDirector;
const schoolDecree = (c: FlowCtx) => c.extras.decreeOverride || c.data.school.decree || 'nº ____';

// ---------------------------------------------------------------------------------------------
// MODELOS — CERTIFICADOS
// ---------------------------------------------------------------------------------------------
const certIntro = (c: FlowCtx, level: StudioLevel): Block[] => {
  const s = c.data.school;
  return [
    para('intro', `${b(orBlank(s.directorName, '__________________'))}, ${dirTitle(c)} do ${b(s.name)}, criado sob o Decreto Executivo ${t(schoolDecree(c))}.`, { before: 6 }),
    para('certifica', `Certifica que ${red(upper(c.data.person.name))}, ${t(filiation(c.data))}, ${t(birthText(c.data))}. ${t(biText(c.data))}.`)
  ];
};

function certPrimario(c: FlowCtx): FlowDoc {
  const d = c.data, e = d.enrollment;
  const { spec, avg } = classColumnsTable(d.rows, [2, 4, 6], { padded: true, headerFill: '#FFFFFF', naFill: '#00B050', naSubjects: ['historia', 'geografia', 'moral'], fontPt: 11, label: 'DISCIPLINAS' });
  const warn = avg === undefined ? ['O aluno não tem notas lançadas para as classes deste certificado.'] : [];
  return {
    title: 'Certificado — Ensino Primário', warnings: warn, page: { border: 'duplaVermelha', paper: 'branco', watermark: false, font: 'serif' },
    blocks: [
      ...head(c, 'primario', { title: 'CERTIFICADO', logoLeft: false }),
      ...certIntro(c, 'primario'),
      para('concluiu', `Concluiu no ${b(d.school.name)}, sob nº ${b(orBlank(e.numero, '__'))}, Turma ${b(orBlank(e.turma, '_'))}, no ano lectivo ${b(c.year.replace('/', '-'))} o ${mono('ENSINO PRIMÁRIO')}, conforme o disposto da alínea ${ALINEA.primario} do artigo 109 da LBSEE17/16 de Outubro, com a Média Final ${b(avg === undefined ? '__' : pad2(avg))} valores nas seguintes classificações:`),
      { t: 'table', spec },
      para('legal', `Para efeitos legais lhe é passado o presente ${b('CERTIFICADO')}, que consta no livro de registo nº ${b(orBlank(c.extras.livro, '__'))}, folha ${b(orBlank(c.extras.folha, '__'))}, assinado por mim com carimbo a óleo em uso neste estabelecimento de ensino.`, { before: 8 }),
      { t: 'spacer', h: 6 }, dateLine(c),
      sign(c, { rightLabel: `A ${dirTitle(c) === 'Directora' ? 'Directora' : 'Director'}`.replace('A Director', 'O Director'), rightName: d.school.directorName })
    ]
  };
}

function certICiclo(c: FlowCtx): FlowDoc {
  const d = c.data, e = d.enrollment;
  const { spec, avg } = classColumnsTable(d.rows, [7, 8, 9], { padded: false, headerFill: '#FFFFFF', fontPt: 11, label: 'Disciplinas' });
  return {
    title: 'Certificado — I Ciclo', warnings: avg === undefined ? ['O aluno não tem notas lançadas para a 7.ª, 8.ª e 9.ª classes.'] : [], page: { border: 'purpura', paper: 'branco', watermark: false, font: 'serif' },
    blocks: [
      ...head(c, 'iciclo', { title: 'CERTIFICADO' }),
      ...certIntro(c, 'iciclo'),
      para('concluiu', `${b('Concluiu')} no ano lectivo ${b(c.year)}, o ${mono('I CICLO DO ENSINO SECUNDÁRIO GERAL')}, sob nº ${b(orBlank(e.numero, '__'))}, na Turma ${b(orBlank(e.turma, '_'))}${e.periodo ? `, Período ${e.periodo}` : ''}, conforme o disposto da alínea (c) do artigo 109º da LBSEE17/16, de 7 de Outubro, com a Média Final de ${b(avg === undefined ? '__' : String(avg))} valores, obtida nas seguintes classificações por disciplinas:`),
      { t: 'table', spec },
      para('legal', `Para efeitos legais, lhe é passado o presente ${b('CERTIFICADO')}, que consta no livro de registo nº ${orBlank(c.extras.livro, '__')}, folha ${orBlank(c.extras.folha, '__')}, assinado por mim e autenticado com carimbo a óleo/selo branco em uso neste estabelecimento de ensino.`, { before: 8 }),
      dateLine(c), { t: 'spacer', h: 4 },
      sign(c, { rightLabel: 'O Director', rightName: d.school.directorName })
    ]
  };
}

function certIICiclo(c: FlowCtx): FlowDoc {
  const d = c.data;
  const rows = orderRows(d.rows, CANON.iiciclo);
  const { spec, avg } = classColumnsTable(rows, [10, 11, 12], { padded: false, headerFill: '#FFFFFF', fontPt: 9.5, label: 'DISCIPLINAS' });
  // Secções: Formação Geral / Específica / Opção
  const sec = (name: string) => ({ kind: 'section' as const, cells: [name, '', '', '', '', ''] });
  const dataRows = spec.rows;
  const geral = dataRows.filter((r) => GERAL.some((g) => normalizeText(r.cells[0]).includes(g)));
  const espec = dataRows.filter((r) => !geral.includes(r) && ESPEC.some((g) => normalizeText(r.cells[0]).includes(g)));
  const opcao = dataRows.filter((r) => !geral.includes(r) && !espec.includes(r));
  spec.rows = [sec('FORMAÇÃO GERAL'), ...geral, ...(espec.length ? [sec('FORMAÇÃO ESPECÍFICA'), ...espec] : []), ...(opcao.length ? [sec('OPÇÃO'), ...opcao] : []),
    { kind: 'total', cells: ['MÉDIA GERAL DO CURSO', '', '', '', avg === undefined ? '' : String(avg), avg === undefined ? '' : notaPorExtenso(avg)] }];
  spec.sectionFill = '#D9D9D9';
  return {
    title: 'Certificado — II Ciclo (Geral)', warnings: avg === undefined ? ['O aluno não tem notas lançadas para a 10.ª, 11.ª e 12.ª classes.'] : [], page: { border: 'fina', paper: 'branco', watermark: false, font: 'serif' },
    blocks: [
      ...head(c, 'iiciclo', { title: 'CERTIFICADO' }),
      para('intro', `${b(orBlank(d.school.directorName, '__________________'))}, ${dirTitle(c)} do ${b(d.school.name)}, criado sob Decreto Executivo ${t(schoolDecree(c))}, certifica que, ${red(d.person.name)}, ${t(filiation(d))}; ${t(birthText(d, false))}, ${t(biText(d, false))}, concluiu no ano lectivo ${b(c.year)}, o curso do ${b('II CICLO DO ENSINO SECUNDÁRIO GERAL')}, na área de ${t(orBlank(c.extras.area, '_______________'))}, conforme o disposto da alínea ${ALINEA.iiciclo} do artigo 109º da LBSEE17/16, de 7 de Outubro, com a Média Final de ${avg === undefined ? '__' : avg} Valores, obtida nas seguintes classificações por disciplinas:`, { before: 6, align: 'justify' }),
      { t: 'table', spec },
      para('legal', `Para efeitos legais, lhe é passado o presente ${b('CERTIFICADO')}, que consta no livro de registo nº: ${b(orBlank(c.extras.livro, '___'))}, folha nº: ${b(orBlank(c.extras.folha, '____'))}, assinado por mim e autenticado com carimbo a óleo em uso neste estabelecimento de ensino.`, { before: 6, size: 10.5 }),
      dateLine(c), sign(c, { rightLabel: 'O Director', rightName: d.school.directorName })
    ]
  };
}

function certTecnico(c: FlowCtx): FlowDoc {
  const d = c.data;
  const rows = d.rows.map((r) => ({ r, final: r.final })).filter((x) => x.final !== undefined);
  const socio = rows.filter((x) => SOCIO.some((s) => normalizeText(x.r.subject).includes(s)));
  const cient = rows.filter((x) => !socio.includes(x) && CIENT.some((s) => normalizeText(x.r.subject).includes(s)));
  const tec = rows.filter((x) => !socio.includes(x) && !cient.includes(x));
  const mk = (x: { r: GradeRow; final?: number }): TableRow => ({ kind: 'data', cells: [x.r.subject, String(x.final), notaPorExtenso(x.final)] });
  const sec = (n: string): TableRow => ({ kind: 'section', cells: [n, '', ''] });
  const finals = rows.map((x) => x.final as number);
  const pc = finals.length ? Math.round(finals.reduce((a, v) => a + v, 0) / finals.length) : undefined;
  const pap = c.extras.pap;
  const fin = pc !== undefined && typeof pap === 'number' ? Math.round((2 * pc + pap) / 3) : undefined;
  const spec: TableSpec = {
    headerFill: '#FFFFFF', sectionFill: '#FFFFFF', fontPt: 9, cols: [{ label: 'Componentes de Formação', w: 0.62, align: 'left' }, { label: 'Média Final', w: 0.16, align: 'center' }, { label: 'Média por Extenso', w: 0.22, align: 'center' }],
    rows: [
      sec('Componente Sócio-Cultural:'), ...socio.map(mk), sec('Componente Científico:'), ...cient.map(mk), sec('Componentes Técnicas, Tecnológica e Práticas'), ...tec.map(mk),
      { kind: 'total', cells: ['Média por Plano Curricular (P.C)', pc === undefined ? '' : String(pc), notaPorExtenso(pc)] },
      { kind: 'total', cells: ['Prova de Aptidão Profissional (PAP)', typeof pap === 'number' ? String(pap) : '', notaPorExtenso(pap)] },
      { kind: 'total', cells: ['Classificação final por curso =(2xPC+PAP)/3', fin === undefined ? '' : String(fin), notaPorExtenso(fin)] }
    ]
  };
  const e = d.enrollment;
  return {
    title: 'Certificado — Técnico-Profissional', warnings: [...(pc === undefined ? ['O aluno não tem notas lançadas para este curso.'] : []), ...(typeof pap !== 'number' ? ['Indique a nota da PAP em "Dados do registo" para calcular a classificação final.'] : [])],
    page: { border: 'nenhuma', paper: 'branco', watermark: true, font: 'serif' },
    blocks: [
      ...head(c, 'tecnico', { title: 'CERTIFICADO', titleSize: 11 }),
      para('intro', `${red(orBlank(d.school.directorName, '__________________'))}, ${b(`${dirTitle(c)} do ${d.school.name}, criado sob Decreto Executivo ${schoolDecree(c)}, certifica que`)} ${red(d.person.name)}, ${b(filiation(d))}, ${t(birthText(d, false))}, ${b(biText(d))}. ${b('Concluiu, no ano lectivo ' + c.year + ' o curso do II CICLO DO ENSINO SECUNDÁRIO TÉCNICO')}, na especialidade de ${t(orBlank(e.curso, '______________'))}, ${b('conforme o disposto na alínea (f) do art.º 109º, da LBSEE 17/16, de 7 de Outubro com a Média Final de')} ${red(fin === undefined ? '__' : String(fin))} ${b('Valores obtida nas seguintes classificações por disciplinas:')}`, { size: 10, before: 2 }),
      { t: 'table', spec },
      para('legal', `Para efeitos legais lhe é passado o presente ${b('CERTIFICADO')}, que consta no livro de registo nº ${orBlank(c.extras.livro, '__')} folha ${orBlank(c.extras.folha, '__')}, assinado por mim e autenticado com o carimbo a óleo em uso neste estabelecimento de Ensino.`, { size: 9, before: 4 }),
      { t: 'line', id: 'data', text: `${upper(d.school.city)}, AOS ${upper(dataPorExtenso(new Date()))}`, size: 9, bold: true, align: 'left', after: 6, scope: 'doc' },
      sign(c, { rightLabel: 'O Director', rightName: d.school.directorName })
    ]
  };
}

function certEJA(c: FlowCtx): FlowDoc {
  const d = c.data, e = d.enrollment;
  const g = c.extras.ejaGrades;
  const vs = [g.alf, g.m2, g.m3];
  const known = vs.filter((n): n is number => typeof n === 'number');
  const avg = known.length ? Math.round(known.reduce((a, v) => a + v, 0) / known.length) : undefined;
  const spec: TableSpec = { headerFill: '#FFFFFF', sectionFill: '#FFFFFF', fontPt: 11, cols: [{ label: 'Alfabetização', w: 1 / 3, align: 'center' }, { label: 'Módulo 2', w: 1 / 3, align: 'center' }, { label: 'Módulo 3', w: 1 / 3, align: 'center' }], rows: [{ kind: 'data', cells: vs.map((n) => (n === undefined ? '' : String(n))) }] };
  return {
    title: 'Certificado — Educação de Adultos', warnings: known.length ? [] : ['Introduza as notas dos módulos em "Dados do registo".'], page: { border: 'duplaVermelha', paper: 'branco', watermark: false, font: 'serif' },
    blocks: [
      ...head(c, 'eja', { title: '', subtitle: '' }),
      para('intro', `${b(`${orBlank(d.school.directorName, '__________________')}, ${dirTitle(c)} do ${d.school.name}`)}, Criado sob o Decreto Executivo ${t(schoolDecree(c))}.`, { before: 8 }),
      para('certifica', `Certifica que ${red(upper(d.person.name))}, ${t(filiation(d))}, ${t(birthText(d))}, ${t(biText(d))}.`),
      para('concluiu', `Concluiu no ${b(d.school.name)}, sob nº ${orBlank(e.numero, '__')}, Turma ${b(orBlank(e.turma, '_'))}, no ano lectivo ${b(c.year)} o ${mono('ENSINO PRIMÁRIO')}, conforme o disposto da alínea ${ALINEA.eja} do artigo 109 da LBSEE17/16 de Outubro, com a Média Final ${b(avg === undefined ? '__' : pad2(avg))} valores nas seguintes classificações:`, { before: 6 }),
      { t: 'table', spec },
      para('legal', `Para efeitos legais lhe é passado o presente ${b('Certificado')}, que consta no registo nº ${b(orBlank(c.extras.livro, '__'))}, folha ${b(orBlank(c.extras.folha, '__'))}, assinado por mim e autenticado com carimbo a óleo em uso neste estabelecimento de ensino.`, { before: 10 }),
      { t: 'spacer', h: 16 }, dateLine(c), { t: 'spacer', h: 10 },
      sign(c, { rightLabel: `A ${dirTitle(c) === 'Directora' ? 'Directora' : 'Director'}`.replace('A Director', 'O Director'), rightName: d.school.directorName })
    ]
  };
}

// ---------------------------------------------------------------------------------------------
// MODELOS — DECLARAÇÕES
// ---------------------------------------------------------------------------------------------
function twoUpTable(rows: GradeRow[], cls: number, headerFill: string): { spec: TableSpec; avg?: number } {
  const own = rows.filter((r) => typeof r.byClass[cls] === 'number');
  const vals = own.map((r) => r.byClass[cls] as number);
  const avg = vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : undefined;
  const half = Math.ceil(own.length / 2);
  const out: TableRow[] = [];
  for (let i = 0; i < half; i++) {
    const L = own[i], R = own[i + half];
    out.push({ kind: 'data', cells: [L.subject, String(L.byClass[cls]), 'Valores', R ? R.subject : '', R ? String(R.byClass[cls]) : '', R ? 'Valores' : ''] });
  }
  return {
    avg, spec: { twoUp: true, headerFill, sectionFill: '#FFFFFF', fontPt: 11, cols: [{ label: 'DISCIPLINAS', w: 0.26, align: 'left' }, { label: 'NOTAS', w: 0.1, align: 'center' }, { label: 'Valores', w: 0.11, align: 'center' }, { label: 'DISCIPLINAS', w: 0.29, align: 'left' }, { label: 'NOTAS', w: 0.1, align: 'center' }, { label: 'Valores', w: 0.14, align: 'center' }], rows: out }
  };
}

function declPrimaria(withGrades: boolean) {
  return (c: FlowCtx): FlowDoc => {
    const d = c.data, n = c.classNum ?? 5;
    const rows = orderRows(d.rows, CANON.primario);
    const own = rows.filter((r) => typeof r.byClass[n] === 'number');
    const vals = own.map((r) => r.byClass[n] as number);
    const avg = vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : undefined;
    const spec: TableSpec = { headerFill: '#FFFFFF', sectionFill: '#FFFFFF', fontPt: 11, cols: [{ label: 'Disciplinas', w: 0.36, align: 'left' }, { label: `${n}ª Classe`, w: 0.18, align: 'center' }, { label: 'Média Final', w: 0.2, align: 'center' }, { label: 'Média por extenso', w: 0.26, align: 'left' }], rows: own.map((r) => ({ kind: 'data' as const, cells: [r.subject, String(r.byClass[n]), String(r.byClass[n]), extensoCell(r.byClass[n])] })) };
    const text = withGrades
      ? `a) ${b(orBlank(d.school.directorName, '____________'))}, ${dirTitle(c)} da ${mono(d.school.name)}, criado sob o Decreto Executivo ${t(schoolDecree(c))}, declara que ${red(upper(d.person.name))}, ${t(filiation(d))}, ${t(birthText(d, false))}, ${t(biText(d))}, concluiu no ano lectivo ${red(c.year)} a ${red(n + 'ª CLASSE')}, tendo o resultado final de ${b(avg === undefined ? '__' : String(avg))} valores.`
      : `a) ${b(orBlank(d.school.directorName, '____________'))}, ${dirTitle(c)} da ${mono(d.school.name)}, criado sob o Decreto Executivo ${t(schoolDecree(c))}, declara que ${red(upper(d.person.name))}, ${t(filiation(d))}, ${t(birthText(d, false))}, ${t(biText(d))}, ${d.person.gender === 'F' ? 'frequenta' : 'frequenta'} no ano lectivo ${red(c.year)} a ${red(n + 'ª CLASSE')}${d.enrollment.turma ? `, Turma ${d.enrollment.turma}` : ''}${d.enrollment.numero ? `, sob nº ${d.enrollment.numero}` : ''}${d.enrollment.periodo ? `, Período ${d.enrollment.periodo}` : ''}, neste estabelecimento de ensino${c.extras.purpose ? `, para efeitos de ${c.extras.purpose}` : ''}.`;
    return {
      title: `Declaração ${withGrades ? 'com' : 'sem'} notas — Primário`, warnings: withGrades && avg === undefined ? [`O aluno não tem notas lançadas na ${n}.ª classe.`] : [], page: { border: 'verdeOuro', paper: 'branco', watermark: false, font: 'serif' },
      blocks: [
        ...head(c, 'primario', { title: 'DECLARAÇÃO', titleSize: 26 }),
        para('decl', text, { before: 6 }),
        ...(withGrades ? [{ t: 'table', spec } as Block] : []),
        para('legal', `Para efeitos legais, lhe é passado o presente ${b('DECLARAÇÃO')}, assinado por mim e autenticado com carimbo a óleo/selo branco em uso neste estabelecimento de ensino.`, { before: 8 }),
        { t: 'spacer', h: 8 }, dateLine(c), { t: 'spacer', h: 8 },
        sign(c, { rightLabel: 'O Director', rightName: d.school.directorName, leftName: '' })
      ]
    };
  };
}

function declSecundaria(level: StudioLevel, withGrades: boolean) {
  return (c: FlowCtx): FlowDoc => {
    const d = c.data, n = c.classNum ?? (level === 'iciclo' ? 7 : 10);
    const rows = orderRows(d.rows, level === 'iciclo' ? CANON.iciclo : CANON.iiciclo);
    const { spec, avg } = twoUpTable(rows, n, '#7F7F7F');
    const e = d.enrollment;
    const body = withGrades
      ? `${b(orBlank(d.school.directorName, '____________'))}, ${dirTitle(c)} do ${b(d.school.name)}, declara que: ${red(upper(d.person.name))}, ${t(filiation(d))}, ${t(birthText(d))}. Portador do B.I nº ${b(orBlank(d.person.bi, '_____________'))}, passado pelo arquivo de identificação de ${t(d.school.city || BL)}, aos ${orBlank(d.person.biIssueDate, '__/__/____')}.`
      : `${b(orBlank(d.school.directorName, '____________'))}, ${dirTitle(c)} do ${b(d.school.name)}, declara que: ${red(upper(d.person.name))}, ${t(filiation(d))}, ${t(birthText(d))}. Portador do B.I nº ${b(orBlank(d.person.bi, '_____________'))}, passado pelo arquivo de identificação de ${t(d.school.city || BL)}, aos ${orBlank(d.person.biIssueDate, '__/__/____')}.`;
    const conc = withGrades
      ? `${b('Concluiu o ano lectivo ' + c.year)}, o ${red(n + 'ª CLASSE')}, sob nº ${b(orBlank(e.numero, '__'))} na Turma ${b(orBlank(e.turma, '_'))}${e.periodo ? `, Período ${b(e.periodo)}` : ''}, conforme o disposto da alínea c) do artigo 109º da LBSEE 17/16, de 7 de Outubro, obtida nas seguintes classificações por disciplinas:`
      : `${b('Frequenta no ano lectivo ' + c.year)}, a ${red(n + 'ª CLASSE')}, sob nº ${b(orBlank(e.numero, '__'))} na Turma ${b(orBlank(e.turma, '_'))}${e.periodo ? `, Período ${b(e.periodo)}` : ''}${e.curso && level !== 'iciclo' ? `, curso de ${t(e.curso)}` : ''}, neste estabelecimento de ensino${c.extras.purpose ? `, para efeitos de ${t(c.extras.purpose)}` : ''}.`;
    return {
      title: `Declaração ${withGrades ? 'com' : 'sem'} notas — ${level === 'iciclo' ? 'I Ciclo' : 'II Ciclo'}`, warnings: withGrades && avg === undefined ? [`O aluno não tem notas lançadas na ${n}.ª classe.`] : [], page: { border: 'greca', paper: 'branco', watermark: false, font: 'serif' },
      blocks: [
        { t: 'images', left: 'logo', center: 'brasao', h: 24 }, { t: 'spacer', h: 3 },
        { t: 'line', id: 'h1', text: 'REPÚBLICA DE ANGOLA', size: 11, bold: true, align: 'center', after: 2, scope: 'model' },
        { t: 'line', id: 'h2', text: 'MINISTÉRIO DA EDUCAÇÃO', size: 11, bold: true, align: 'center', after: 4, scope: 'model' },
        { t: 'line', id: 'h3', text: d.school.name, size: 15, bold: true, align: 'center', after: 12, scope: 'model' },
        { t: 'line', id: 'titulo', text: 'DECLARAÇÃO DE HABILITAÇÃO', size: 14, bold: true, align: 'center', after: 10, scope: 'model' },
        para('decl', body, { before: 2 }), para('concl', conc),
        ...(withGrades ? [{ t: 'table', spec } as Block] : []),
        para('legal', `Para efeitos legais, lhe é passada a presente ${b('Declaração')} que vai assinado por mim, autenticado com carimbo a óleo em uso neste Instituição de ensino.`, { before: 6 }),
        { t: 'spacer', h: 14 }, dateLine(c), { t: 'spacer', h: 14 },
        sign(c, { leftLabel: 'O Director Pedagógico', leftName: d.school.directorPedagogicoName, rightLabel: 'O Director da Escola', rightName: d.school.directorName })
      ]
    };
  };
}

const page = (border: BorderKey, paper: PaperKey = 'branco', watermark = false): PageStyle => ({ border, paper, watermark, font: 'serif' });

export const FLOW_MODELS: FlowModel[] = [
  { id: 'cert-6', kind: 'certificado', name: 'Certificado da 6.ª Classe', description: 'Ensino Primário · 2.ª, 4.ª e 6.ª classes · moldura dupla vermelha.', level: 'primario', classes: [6], defaultPage: page('duplaVermelha'), build: certPrimario },
  { id: 'cert-9', kind: 'certificado', name: 'Certificado da 9.ª Classe', description: 'I Ciclo · 7.ª, 8.ª e 9.ª classes · moldura púrpura.', level: 'iciclo', classes: [9], defaultPage: page('purpura'), build: certICiclo },
  { id: 'cert-9-rosa', kind: 'certificado', name: 'Certificado da 9.ª Classe (papel rosa)', description: 'I Ciclo em papel rosa Samora Machel, moldura fina.', level: 'iciclo', classes: [9], defaultPage: page('purpuraFina', 'rosa'), build: certICiclo },
  { id: 'cert-12', kind: 'certificado', name: 'Certificado da 12.ª Classe', description: 'II Ciclo Geral · 10.ª, 11.ª e 12.ª · Formação Geral, Específica e Opção.', level: 'iiciclo', classes: [12], defaultPage: page('fina'), build: certIICiclo },
  { id: 'cert-13', kind: 'certificado', name: 'Certificado da 13.ª Classe', description: 'Técnico-Profissional · componentes, PAP e classificação final.', level: 'tecnico', classes: [13], defaultPage: page('nenhuma', 'branco', true), build: certTecnico },
  { id: 'cert-eja', kind: 'certificado', name: 'Certificado EJA (Módulos)', description: 'Educação de Adultos · Alfabetização, Módulo 2 e Módulo 3.', level: 'eja', classes: [], defaultPage: page('duplaVermelha'), build: certEJA },

  { id: 'decl-prim-notas', kind: 'declaracao', withGrades: true, name: 'Declaração com notas — Primário', description: 'Ensino Primário (1.ª a 6.ª classe) · moldura verde.', level: 'primario', classes: [1, 2, 3, 4, 5, 6], defaultPage: page('verdeOuro'), build: declPrimaria(true) },
  { id: 'decl-prim-sem', kind: 'declaracao', withGrades: false, name: 'Declaração sem notas — Primário', description: 'Declaração de frequência do Ensino Primário.', level: 'primario', classes: [1, 2, 3, 4, 5, 6], defaultPage: page('verdeOuro'), build: declPrimaria(false) },
  { id: 'decl-ic-notas', kind: 'declaracao', withGrades: true, name: 'Declaração com notas — 7.ª e 8.ª', description: 'I Ciclo · Declaração de Habilitação · moldura grega.', level: 'iciclo', classes: [7, 8, 9], defaultPage: page('greca'), build: declSecundaria('iciclo', true) },
  { id: 'decl-ic-sem', kind: 'declaracao', withGrades: false, name: 'Declaração sem notas — 7.ª e 8.ª', description: 'I Ciclo · declaração de frequência.', level: 'iciclo', classes: [7, 8, 9], defaultPage: page('greca'), build: declSecundaria('iciclo', false) },
  { id: 'decl-iic-notas', kind: 'declaracao', withGrades: true, name: 'Declaração com notas — 10.ª e 11.ª', description: 'II Ciclo · Declaração de Habilitação.', level: 'iiciclo', classes: [10, 11, 12], defaultPage: page('greca'), build: declSecundaria('iiciclo', true) },
  { id: 'decl-iic-sem', kind: 'declaracao', withGrades: false, name: 'Declaração sem notas — 10.ª e 11.ª', description: 'II Ciclo · declaração de frequência.', level: 'iiciclo', classes: [10, 11, 12], defaultPage: page('greca'), build: declSecundaria('iiciclo', false) }
];

export const getFlowModel = (id: string) => FLOW_MODELS.find((m) => m.id === id);

/** Constrói o documento aplicando o estilo de página do modelo (e as escolhas do utilizador por cima). */
export function buildFlow(model: FlowModel, ctx: FlowCtx, pageOverride?: Partial<PageStyle>): FlowDoc {
  const doc = model.build(ctx);
  return { ...doc, page: { ...doc.page, ...model.defaultPage, ...(pageOverride || {}) } };
}

export function defaultExtras(d: StudioData): FlowExtras {
  const eja = d.history.filter((h) => /m[oó]dulo|alfabet|eja/i.test(h.grade));
  const g: FlowExtras['ejaGrades'] = {};
  for (const h of eja) {
    const v = h.finalAverage;
    if (/alfabet/i.test(h.grade)) g.alf = v; else if (/(3|iii)/i.test(h.grade)) g.m3 = v; else if (/(2|ii)/i.test(h.grade)) g.m2 = v;
  }
  return { livro: '', folha: '', area: '', ejaGrades: g, genderDirector: 'Director' };
}

export { LEVEL_LABEL, classNumber };
