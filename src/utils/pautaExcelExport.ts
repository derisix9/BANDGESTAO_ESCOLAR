import { StudentMiniPautaItem, StudentPautaGeralItem, GradeTypeKey } from '../types/pauta';
import { Subject } from '../types';
import { PautaHeaderModel } from './pautaHeader';
import { PautaRegime, EJA_LIMITS, calculateEjaSubtotal } from './pautaCalculations';
import { buildUniqueSubjectAbbreviations } from './subjectAbbreviation';
import { usesFullSubjectNames } from './pautaView';

/**
 * Exportação das pautas em Excel (.xlsx). O cabeçalho, a legenda, a descrição e o rodapé vêm
 * de `buildPautaHeader` — o MESMO modelo da impressão. Todas as colunas calculadas (SUBTOTAL, MT,
 * MFD, MF, CA, Resultado Final e o Mapa Estatístico) são FÓRMULAS do Excel que repetem as regras
 * da aplicação, para o professor poder continuar a trabalhar no Excel com os mesmos cálculos.
 *
 * FORMATAÇÃO (copiada dos modelos corrigidos à mão pelo utilizador — 7.ª classe, 9.ª classe e EJA):
 *  - tipo de letra Arial Narrow em todo o ficheiro; 12 pt (legenda das siglas a 10 pt);
 *  - República / Governo / Gabinete / Escola centrados sobre a tabela, com a insígnia centrada por
 *    cima deles e encostada ao fundo da linha 4 (50 px de altura, proporção original);
 *  - logótipo do EJA logo depois da legenda;
 *  - linhas 1-8 a 15,95 pt, faixa e descrição a 18 pt, cabeçalho das notas a 32,1 / 28,5 / 20,1 pt.
 */

type ExcelJSType = typeof import('exceljs');

const FONT = 'Arial Narrow';
const BASE_SIZE = 12;
const BLUE = 'FF2F5F8A';
const GREEN = 'FFC6E0B4';
const GRAY = 'FFD9D9D9';
const DARKGRAY = 'FF7F7F7F';
const SALMON = 'FFFCE4D6';
const ORANGE = 'FFF4B183';
const RED = 'FFC00000';
const BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } as const;

// Medidas do modelo (em pontos, pixéis e EMU).
const HEADER_ROW_PT = 15.95; // linhas 1-8 (legenda + títulos)
const BANNER_ROW_PT = 18; // faixa de título e descrição
const EMU_PER_PX = 9525;
const ptToPx = (pt: number) => (pt * 96) / 72;
const INSIGNIA_HEIGHT_PX = 50;
const INSIGNIA_FALLBACK_WIDTH_PX = 62; // proporção 84×68 da imagem fornecida
const EJA_LOGO_HEIGHT_PX = 73;
const CANON_FIXED = [5, 36, 7]; // colunas fixas da Pauta Final (Nº, Nome, Género)
const CANON_COL_W = 6.5; // largura-base das restantes colunas
const PAUTA_FINAL_HEADER_ZONE_PX = 720; // largura fixa da zona do cabeçalho da Pauta Final
const EJA_LOGO_FIXED_X_PX = 452; // início da coluna F no modelo (5+36+7+6,5+6,5 caracteres)
const EJA_LOGO_FALLBACK_WIDTH_PX = 72;

export interface LoadedImage {
  base64: string;
  ext: 'png' | 'jpeg';
  /** Dimensões naturais (px), quando se conseguem ler — servem para manter a proporção. */
  width?: number;
  height?: number;
}
export type ImageLoader = (url?: string) => Promise<LoadedImage | null>;

function readImageSize(buf: Uint8Array, ext: 'png' | 'jpeg'): { width?: number; height?: number } {
  try {
    if (ext === 'png' && buf.length > 24) {
      const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      return { width: v.getUint32(16), height: v.getUint32(20) };
    }
    if (ext === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* sem dimensões: usa-se o tamanho por omissão */
  }
  return {};
}

export const fetchImage: ImageLoader = async (url) => {
  try {
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/') || type.includes('svg')) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const ext: 'png' | 'jpeg' = type.includes('jpeg') || type.includes('jpg') ? 'jpeg' : 'png';
    return { base64: btoa(bin), ext, ...readImageSize(buf, ext) };
  } catch {
    return null;
  }
};

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Largura de uma coluna em pixéis (fórmula do Excel para o tipo de letra por omissão). */
const colPx = (w: number) => Math.round(w * 7 + 5);

/** Âncora nativa (em EMU) para um ponto x/y, em pixéis, medido desde o canto superior esquerdo da folha. */
function nativeAnchor(widths: number[], rowHeightsPt: number[], xPx: number, yPx: number) {
  let nativeCol = 0;
  let accX = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = colPx(widths[i]);
    if (xPx < accX + w) { nativeCol = i; break; }
    accX += w;
    nativeCol = i + 1;
  }
  let nativeRow = 0;
  let accY = 0;
  for (let i = 0; i < rowHeightsPt.length; i++) {
    const h = ptToPx(rowHeightsPt[i]);
    if (yPx < accY + h) { nativeRow = i; break; }
    accY += h;
    nativeRow = i + 1;
  }
  return {
    nativeCol,
    nativeColOff: Math.max(0, Math.round((xPx - accX) * EMU_PER_PX)),
    nativeRow,
    nativeRowOff: Math.max(0, Math.round((yPx - accY) * EMU_PER_PX))
  };
}

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safe = (v: unknown) => String(v ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
const num = (v: unknown): number | '' => (typeof v === 'number' && !isNaN(v) ? v : '');
const font = (o: Record<string, unknown> = {}) => ({ name: FONT, size: BASE_SIZE, ...o });

function headerCell(cell: any, opts: { fill?: string; color?: string; size?: number; wrap?: boolean; rotate?: number } = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill ?? GRAY } };
  cell.font = font({ bold: true, size: opts.size ?? BASE_SIZE, color: { argb: opts.color ?? 'FF000000' } });
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: opts.wrap ?? true, textRotation: opts.rotate };
  cell.border = BORDER;
}

/** Cria a folha com a página, o tipo de letra por omissão e as larguras do modelo. */
function createSheet(wb: any, name: string, widths: number[], extraCols = 0) {
  const ws = wb.addWorksheet(name, {
    properties: { defaultRowHeight: 15.75 },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 } }
  });
  const total = Math.max(widths.length + extraCols, 1);
  for (let i = 1; i <= total; i++) ws.getColumn(i).font = font();
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return ws;
}

/**
 * Cabeçalho oficial no topo da folha. Devolve a próxima linha livre.
 *
 * Geometria (igual à dos modelos corrigidos): a legenda fica nas linhas 1-N, à esquerda;
 * "REPÚBLICA…/GOVERNO…/GABINETE…/ESCOLA…" são centrados sobre a tabela (linhas 5-8) e a insígnia fica
 * centrada sobre esse mesmo eixo, com a base na base da linha 4. O logótipo do EJA fica depois da legenda.
 */
async function addHeaderBlock(
  wb: any,
  ws: any,
  header: PautaHeaderModel,
  totalCols: number,
  widths: number[],
  load: ImageLoader,
  /**
   * Zona fixa do cabeçalho (em px). Quando definida (Pauta Final), os títulos, a insígnia, o logótipo do EJA
   * e o texto da faixa/descrição ficam centrados numa zona de largura constante, medida desde a coluna A —
   * por isso NÃO se movem quando a tabela ganha ou perde colunas (disciplinas). Sem ela (Mini-Pauta) o
   * cabeçalho centra-se sobre a tabela, como antes.
   */
  fixedZonePx?: number
): Promise<number> {
  const tableCols = Math.max(totalCols, 8);
  const allWidths = [...widths];
  const PAD_W = fixedZonePx ? CANON_COL_W : 9;
  while (allWidths.length < tableCols) allWidths.push(PAD_W);
  // Zona fixa: as colunas ESCOLHIDAS para os títulos/faixa/descrição saem de uma grelha canónica
  // (A-C do modelo e as restantes a 6,5), que não depende das disciplinas; assim as mesmas colunas
  // são sempre usadas. A posição das imagens segue a largura real dessas colunas.
  const canon = (c: number) => (c <= CANON_FIXED.length ? CANON_FIXED[c - 1] : CANON_COL_W);
  const pxOf = (c: number) => colPx(allWidths[c - 1] ?? PAD_W);
  const cpxOf = (c: number) => colPx(canon(c));
  let zoneEnd = tableCols;
  if (fixedZonePx) {
    let acc = 0;
    zoneEnd = 0;
    while (acc < fixedZonePx) {
      zoneEnd++;
      acc += cpxOf(zoneEnd);
    }
    // Colunas de enchimento (a tabela é mais estreita do que a zona): largura canónica explícita.
    while (allWidths.length < zoneEnd) { allWidths.push(CANON_COL_W); ws.getColumn(allWidths.length).width = CANON_COL_W; }
  }
  const lastCol = fixedZonePx ? zoneEnd : tableCols;
  const leftOf = (c: number) => { let s = 0; for (let i = 1; i < c; i++) s += pxOf(i); return s; };
  const rightOf = (c: number) => leftOf(c + 1);
  // Para ESCOLHER colunas (zona fixa) usa-se a grelha canónica; para posicionar, a real.
  const cLeftOf = (c: number) => { let s = 0; for (let i = 1; i < c; i++) s += cpxOf(i); return s; };
  const cRightOf = (c: number) => cLeftOf(c + 1);
  const selLeft = fixedZonePx ? cLeftOf : leftOf;
  const selRight = fixedZonePx ? cRightOf : rightOf;

  const rowPts: number[] = [];
  for (let i = 1; i <= 8; i++) { ws.getRow(i).height = HEADER_ROW_PT; rowPts.push(HEADER_ROW_PT); }

  // Legenda (canto superior esquerdo)
  header.legend.forEach((line, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = line;
    c.font = font({ bold: true, size: 10 });
    c.alignment = { horizontal: 'left', vertical: 'middle' };
  });

  // Eixo central dos títulos. Se a legenda ocupa as linhas 5-8 os títulos começam na coluna D e
  // terminam na coluna que deixa o intervalo centrado sobre a tabela; senão cobrem a tabela toda.
  const legendReachesTitles = header.legend.length > 4;
  let titleStart = legendReachesTitles ? 4 : 1;
  let titleEnd = lastCol;
  if (legendReachesTitles) {
    const tableCenter = fixedZonePx ? fixedZonePx / 2 : selRight(lastCol) / 2;
    let best = Infinity;
    for (let e = titleStart + 1; e <= lastCol; e++) {
      const d = Math.abs((selLeft(titleStart) + selRight(e)) / 2 - tableCenter);
      if (d < best) { best = d; titleEnd = e; }
    }
    // Tabelas muito estreitas: não deixa o texto sem espaço.
    if (selRight(titleEnd) - selLeft(titleStart) < 360) titleEnd = lastCol;
  }
  const axisX = (leftOf(titleStart) + rightOf(titleEnd)) / 2;

  header.titleLines.forEach((line, i) => {
    const r = 5 + i;
    ws.mergeCells(r, titleStart, r, titleEnd);
    const c = ws.getCell(r, titleStart);
    c.value = line;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    const school = i === header.titleLines.length - 1;
    c.font = font({ bold: school, underline: school });
  });

  // Faixa de título
  const bannerRow = 10;
  ws.mergeCells(bannerRow, 1, bannerRow, lastCol);
  const b = ws.getCell(bannerRow, 1);
  b.value = header.banner;
  b.alignment = { horizontal: 'center', vertical: 'middle' };
  const green = header.bannerTone === 'green';
  const bannerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green ? GREEN : BLUE } } as const;
  b.fill = bannerFill;
  b.font = font({ bold: true, color: { argb: green ? 'FF000000' : 'FFFFFFFF' } });
  // Zona fixa: o texto fica na zona; a faixa colorida continua até ao fim da tabela.
  if (fixedZonePx) for (let c = lastCol + 1; c <= tableCols; c++) ws.getCell(bannerRow, c).fill = bannerFill;
  ws.getRow(bannerRow).height = BANNER_ROW_PT;

  // Descrição: rótulo a preto, valor a vermelho (tudo a negrito)
  const descRow = 11;
  ws.mergeCells(descRow, 1, descRow, lastCol);
  const d = ws.getCell(descRow, 1);
  const rich: any[] = [];
  header.description.forEach((x, i) => {
    rich.push({ text: `${i ? '    ' : ''}${x.label}: `, font: font({ bold: true }) });
    rich.push({ text: x.value, font: font({ bold: true, color: { argb: RED } }) });
  });
  d.value = { richText: rich };
  d.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(descRow).height = BANNER_ROW_PT;

  // Imagens com âncora nativa (EMU), para ficarem exactamente onde o cálculo manda.
  const [insignia, eja] = await Promise.all([load(header.insigniaUrl), load(header.ejaLogoUrl)]);
  if (insignia) {
    const h = INSIGNIA_HEIGHT_PX;
    const w = insignia.width && insignia.height ? (h * insignia.width) / insignia.height : INSIGNIA_FALLBACK_WIDTH_PX;
    const top = 4 * ptToPx(HEADER_ROW_PT) - h; // base da imagem = base da linha 4
    const id = wb.addImage({ base64: insignia.base64, extension: insignia.ext });
    ws.addImage(id, { tl: nativeAnchor(allWidths, rowPts, axisX - w / 2, top), ext: { width: w, height: h } });
  }
  if (eja) {
    const h = EJA_LOGO_HEIGHT_PX;
    const w = eja.width && eja.height ? (h * eja.width) / eja.height : EJA_LOGO_FALLBACK_WIDTH_PX;
    // Logo do EJA: depois da legenda (início da coluna F + 15 px), com o topo a ~10 px da linha 2.
    // Zona fixa: posição absoluta (px) da coluna F do modelo, independente da largura das colunas.
    const x = (fixedZonePx ? EJA_LOGO_FIXED_X_PX : leftOf(6)) + 15;
    const y = ptToPx(HEADER_ROW_PT) + 10.7;
    ws.addImage(wb.addImage({ base64: eja.base64, extension: eja.ext }), { tl: nativeAnchor(allWidths, rowPts, x, y), ext: { width: w, height: h } });
  }
  return descRow + 1;
}

function addFooter(ws: any, r: number, totalCols: number, placeAndDate: string, left: [string, string], right: [string, string]) {
  r += 2;
  ws.mergeCells(r, 1, r, totalCols);
  const dt = ws.getCell(r, 1);
  dt.value = placeAndDate;
  dt.font = font({ bold: true });
  dt.alignment = { horizontal: 'center' };
  r += 3;
  const leftEnd = Math.max(3, Math.floor(totalCols / 3));
  const rightStart = totalCols - Math.max(3, Math.floor(totalCols / 3)) + 1;
  const put = (from: number, to: number, [title, name]: [string, string]) => {
    ws.mergeCells(r, from, r, to);
    const t = ws.getCell(r, from);
    t.value = title;
    t.font = font({ bold: true });
    t.alignment = { horizontal: 'center' };
    ws.mergeCells(r + 1, from, r + 1, to);
    const l = ws.getCell(r + 1, from);
    l.value = '______________________________';
    l.font = font();
    l.alignment = { horizontal: 'center' };
    ws.mergeCells(r + 2, from, r + 2, to);
    const n = ws.getCell(r + 2, from);
    n.value = name;
    n.font = font({ bold: true });
    n.alignment = { horizontal: 'center' };
  };
  put(1, leftEnd, left);
  put(rightStart, totalCols, right);
}

// ---------------------------------------------------------------------------------------
// MINI-PAUTA
// ---------------------------------------------------------------------------------------
interface MCol {
  key: string;
  label: string;
  range?: string; // "(0–14)"
  group: string;
  kind: 'input' | 'calc';
  max?: number;
  fill?: string;
  fmt?: string;
  /** Valor da célula quando é de entrada, ou resultado em cache quando é fórmula. */
  value: (r: StudentMiniPautaItem) => number | string;
  formula?: (ref: (key: string) => string) => string | null;
  scale?: number; // para realçar negativas
}

export interface MiniPautaExcelOptions {
  rows: StudentMiniPautaItem[];
  header: PautaHeaderModel;
  regime: PautaRegime;
  selectedGradeTypes: Set<GradeTypeKey>;
  isKeySubject?: boolean;
  passingGrade: number;
  recursoMinGrade: number;
  roundHalfUp?: boolean;
  hideDebtorGrades: boolean;
  signatures: { teacher: string; classHead: string; pedagogicDirector: string };
  fileName?: string;
}

/** Constrói o livro Excel da Mini-Pauta (sem o descarregar) — usado pela exportação e pelos testes. */
export async function buildMiniPautaWorkbook(
  opts: MiniPautaExcelOptions,
  load: ImageLoader = fetchImage
): Promise<{ wb: any; fileName: string }> {
  const ExcelJS = (await import('exceljs')).default as unknown as ExcelJSType;
  const { rows, header, regime, selectedGradeTypes: sel, passingGrade: P, recursoMinGrade: R, hideDebtorGrades } = opts;
  const key = !!opts.isKeySubject;
  const has = (k: GradeTypeKey) => sel.has(k);
  const ROUND = opts.roundHalfUp === false ? 'TRUNC' : 'ROUND';
  const isEJA = regime === 'eja';
  const isExame = regime === 'exame';

  const tg = ['I TRIMESTRE', 'II TRIMESTRE', 'III TRIMESTRE'];
  const cols: MCol[] = [];

  ([1, 2, 3] as const).forEach((t) => {
    const g = tg[t - 1];
    const inp = (id: string, label: string, max: number, range = false): MCol => ({
      key: `${id}${t}`, label, range: range ? `(0–${max})` : undefined, group: g, kind: 'input', max, scale: max,
      fmt: '0.00', value: (r) => num((r as any)[`${id}${t}`])
    });
    const mtCol = (formula: MCol['formula']): MCol => ({
      key: `mt${t}`, label: `MT${t}`, group: g, kind: 'calc', fill: GRAY, fmt: '0.00', scale: 20,
      value: (r) => num((r as any)[`mt${t}`]), formula
    });
    if (isEJA) {
      if (has('MAC')) cols.push(inp('mac', 'MAC', EJA_LIMITS.MAC, true));
      if (has('NPT')) cols.push(inp('npt', 'NPT', EJA_LIMITS.NPT, true));
      if (has('SUB'))
        cols.push({
          key: `sub${t}`, label: 'Subtotal', group: g, kind: 'calc', fmt: '0.00', scale: EJA_LIMITS.MAC,
          value: (r) => {
            const v = calculateEjaSubtotal((r as any)[`mac${t}`] ?? '', (r as any)[`npt${t}`] ?? '', { MAC: has('MAC'), NPT: has('NPT') });
            return typeof v === 'number' ? v : '';
          },
          formula: (ref) => {
            const p = [has('MAC') && ref(`mac${t}`), has('NPT') && ref(`npt${t}`)].filter(Boolean) as string[];
            return p.length ? `IF(COUNT(${p.join(',')})=0,"",AVERAGE(${p.join(',')}))` : null;
          }
        });
      if (has('AAV')) cols.push(inp('aav', 'AAV', EJA_LIMITS.AAV, true));
      if (has('PCP')) cols.push(inp('pcp', 'PCP', EJA_LIMITS.PCP, true));
      if (has(`MT${t}` as GradeTypeKey))
        cols.push(
          mtCol((ref) => {
            const sub = [has('MAC') && ref(`mac${t}`), has('NPT') && ref(`npt${t}`)].filter(Boolean) as string[];
            const add = [has('AAV') && ref(`aav${t}`), has('PCP') && ref(`pcp${t}`)].filter(Boolean) as string[];
            const all = [...sub, ...add];
            if (!all.length) return null;
            const subExpr = sub.length ? `IF(COUNT(${sub.join(',')})=0,0,AVERAGE(${sub.join(',')}))` : '0';
            const addExpr = add.length ? `SUM(${add.join(',')})` : '0';
            return `IF(COUNT(${all.join(',')})=0,"",MIN(20,${subExpr}+${addExpr}))`;
          })
        );
    } else {
      if (has('MAC')) cols.push(inp('mac', 'MAC', 20));
      if (has('NPP')) cols.push(inp('npp', 'NPP', 20));
      if (has('NPT')) cols.push(inp('npt', 'NPT', 20));
      if (has(`MT${t}` as GradeTypeKey))
        cols.push(
          mtCol((ref) => {
            const p = [has('MAC') && ref(`mac${t}`), has('NPP') && ref(`npp${t}`), has('NPT') && ref(`npt${t}`)].filter(Boolean) as string[];
            return p.length ? `IF(COUNT(${p.join(',')})=0,"",${ROUND}(AVERAGE(${p.join(',')}),0))` : null;
          })
        );
    }
  });

  // Classificação final
  const fg = isExame ? 'CLASSIFICAÇÃO FINAL' : 'FINAL';
  const mtKeys = (ref: (k: string) => string) => ([1, 2, 3] as const).filter((t) => has(`MT${t}` as GradeTypeKey)).map((t) => ref(`mt${t}`));
  if (has('MFD'))
    cols.push({
      key: 'mfd', label: 'MFD', group: fg, kind: 'calc', fill: SALMON, fmt: '0', scale: 20, value: (r) => num(r.mfd),
      formula: (ref) => {
        const m = mtKeys(ref);
        if (!m.length) return null;
        const avg = `AVERAGE(${m.join(',')})`;
        if (regime === 'transicao' && has('PG')) {
          return `IF(COUNT(${m.join(',')})=0,"",${ROUND}(IF(ISNUMBER(${ref('pg')}),${avg}*0.6+${ref('pg')}*0.4,${avg}),0))`;
        }
        return `IF(COUNT(${m.join(',')})=0,"",${ROUND}(${avg},0))`;
      }
    });
  if (regime === 'transicao') {
    if (has('PG')) cols.push({ key: 'pg', label: 'PG', group: fg, kind: 'input', max: 20, scale: 20, fmt: '0', value: (r) => num(r.pg) });
    if (has('CA'))
      cols.push({
        key: 'ca', label: 'CA', group: fg, kind: 'calc', fmt: '0', value: (r) => num(r.ca),
        formula: (ref) => `IF(${ref('mfd')}="","",IF(${ref('mfd')}>=17,5,IF(${ref('mfd')}>=14,4,IF(${ref('mfd')}>=10,3,IF(${ref('mfd')}>=7,2,1)))))`
      });
  }
  if (isExame) {
    if (has('MFD'))
      cols.push({
        key: 'mfd60', label: 'MFD(60%)', group: fg, kind: 'calc', fmt: '0.00',
        value: (r) => (typeof r.mfd === 'number' ? r.mfd * 0.6 : ''),
        formula: (ref) => `IF(${ref('mfd')}="","",${ref('mfd')}*0.6)`
      });
    if (has('NEE')) cols.push({ key: 'nee', label: 'NE', group: fg, kind: 'input', max: 20, scale: 20, fmt: '0', value: (r) => num(r.nee) });
    if (has('NEE'))
      cols.push({
        key: 'ne40', label: 'NE(40%)', group: fg, kind: 'calc', fmt: '0.00',
        value: (r) => (typeof r.nee === 'number' ? r.nee * 0.4 : ''),
        formula: (ref) => `IF(${ref('nee')}="","",${ref('nee')}*0.4)`
      });
    if (has('NEO')) cols.push({ key: 'neo', label: 'NEO', group: fg, kind: 'input', max: 20, scale: 20, fmt: '0', value: (r) => num(r.neo) });
    if (has('MF'))
      cols.push({
        key: 'mf', label: 'MF', group: fg, kind: 'calc', fill: SALMON, fmt: '0', scale: 20, value: (r) => num(r.mf),
        formula: (ref) => {
          const ex = [has('NEE') && ref('nee'), has('NEO') && ref('neo')].filter(Boolean) as string[];
          if (!ex.length || !has('MFD')) return null;
          return `IF(OR(${ref('mfd')}="",COUNT(${ex.join(',')})=0),"",${ROUND}(${ref('mfd')}*0.6+0.4*AVERAGE(${ex.join(',')}),0))`;
        }
      });
    if (has('NER') && !key) cols.push({ key: 'ner', label: 'NER', group: fg, kind: 'input', max: 20, scale: 20, fmt: '0', value: (r) => num(r.ner) });
  }

  // Resultado final (fórmula)
  const decisiveRef = (ref: (k: string) => string) => {
    const hasMF = cols.some((c) => c.key === 'mf');
    const hasMFD = cols.some((c) => c.key === 'mfd');
    if (isExame && hasMF && hasMFD) return `IF(ISNUMBER(${ref('mf')}),${ref('mf')},${ref('mfd')})`;
    if (isExame && hasMF) return ref('mf');
    return hasMFD ? ref('mfd') : '""';
  };
  const hasNerCol = cols.some((c) => c.key === 'ner');
  const resultFormula = (ref: (k: string) => string): string => {
    const dec = decisiveRef(ref);
    const base = isExame && !key
      ? `IF(${dec}>=${P},"Aprovado (a)",IF(${dec}>=${R},"Recurso","Reprovado (a)"))`
      : `IF(${dec}>=${P},"Aprovado (a)","Reprovado (a)")`;
    if (isExame && !key && hasNerCol) {
      return `IF(NOT(ISNUMBER(${dec})),"",IF(AND(ISNUMBER(${ref('ner')}),${dec}<${P},${dec}>=${R}),IF(${ref('ner')}>=${P},"Aprovado (a)","Reprovado (a)"),${base}))`;
    }
    return `IF(NOT(ISNUMBER(${dec})),"",${base})`;
  };
  const resultCached = (r: StudentMiniPautaItem): string => {
    const dec = isExame && typeof r.mf === 'number' ? r.mf : r.mfd;
    if (typeof dec !== 'number') return '';
    const ner = typeof r.ner === 'number' && !key ? r.ner : null;
    if (isExame && !key) {
      if (ner !== null && dec < P && dec >= R) return ner >= P ? 'Aprovado (a)' : 'Reprovado (a)';
      return dec >= P ? 'Aprovado (a)' : dec >= R ? 'Recurso' : 'Reprovado (a)';
    }
    return dec >= P ? 'Aprovado (a)' : 'Reprovado (a)';
  };

  const FIXED = 3; // Nº, Nome, Género
  const gradeStart = FIXED + 1;
  const resultCol = FIXED + cols.length + 1;
  const totalCols = resultCol;
  const colIndexOf = (k: string) => gradeStart + cols.findIndex((c) => c.key === k);

  const widths: number[] = [5, 36, 7];
  cols.forEach((c) => widths.push(c.label.length > 6 || c.key.startsWith('sub') ? 10 : 7.5));
  widths.push(16);

  const wb: any = new (ExcelJS as any).Workbook();
  wb.creator = 'Sistema de Gestão Escolar';
  wb.calcProperties = { fullCalcOnLoad: true };
  // + coluna em branco + Mapa Estatístico (2 colunas de identificação + 7 grupos × 3, com Transferidos)
  const ws = createSheet(wb, 'Mini-Pauta', widths, 22);

  let r0 = await addHeaderBlock(wb, ws, header, totalCols, widths, load);
  const top = r0;
  const sub = r0 + 1;
  // Alturas do modelo: EJA (rótulos a duas linhas) 32,1 · classes de exame 28,5 · restantes 20,1
  ws.getRow(sub).height = isEJA ? 32.1 : isExame ? 28.5 : 20.1;

  // Cabeçalho da tabela
  [['Nº', 1], ['NOME COMPLETO', 2]].forEach(([label, c]) => {
    ws.mergeCells(top, c as number, sub, c as number);
    const cell = ws.getCell(top, c as number);
    cell.value = label;
    headerCell(cell, {});
  });
  ws.mergeCells(top, 3, sub, 3);
  ws.getCell(top, 3).value = 'Género';
  headerCell(ws.getCell(top, 3), { color: RED, rotate: 90 });

  let gs = gradeStart;
  cols.forEach((c, i) => {
    const ci = gradeStart + i;
    const cell = ws.getCell(sub, ci);
    cell.value = c.range ? `${c.label}\n${c.range}` : c.label;
    headerCell(cell, { fill: c.fill ?? 'FFFFFFFF' });
    const next = cols[i + 1];
    if (!next || next.group !== c.group) {
      ws.mergeCells(top, gs, top, ci);
      const g = ws.getCell(top, gs);
      g.value = c.group;
      headerCell(g, { fill: c.group.startsWith('CLASSIF') || c.group === 'FINAL' ? GRAY : DARKGRAY, color: c.group.startsWith('CLASSIF') || c.group === 'FINAL' ? 'FF000000' : 'FFFFFFFF' });
      gs = ci + 1;
    }
  });
  // "FINAL" com só MFD fica sem faixa de grupo visível: o MFD ocupa as duas linhas.
  ws.mergeCells(top, resultCol, sub, resultCol);
  ws.getCell(top, resultCol).value = 'Resultado Final';
  headerCell(ws.getCell(top, resultCol), {});

  // Corpo
  const first = sub + 1;
  const last = sub + rows.length;
  rows.forEach((row, i) => {
    const r = first + i;
    const hidden = row.isDebtor && hideDebtorGrades;
    const ref = (k: string) => `${colLetter(colIndexOf(k))}${r}`;
    const base: Array<number | string> = [row.num, row.name, row.gender];
    base.forEach((v, ci) => {
      const cell = ws.getCell(r, ci + 1);
      cell.value = v as any;
      cell.border = BORDER;
      cell.font = font({ bold: ci === 0 });
      cell.alignment = { horizontal: ci === 1 ? 'left' : 'center', vertical: 'middle' };
    });
    cols.forEach((c, k) => {
      const cell = ws.getCell(r, gradeStart + k);
      cell.border = BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = font({ bold: c.kind === 'calc' });
      if (c.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
      cell.numFmt = c.fmt ?? '0.00';
      if (row.isDesistente || hidden) {
        cell.value = '-';
        return;
      }
      if (c.kind === 'input') {
        const v = c.value(row);
        cell.value = v === '' ? null : (v as number);
        if (c.max) {
          cell.dataValidation = {
            type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, c.max],
            showErrorMessage: true, errorTitle: 'Nota inválida', error: `A nota deve estar entre 0 e ${c.max}.`
          };
        }
      } else {
        const f = c.formula?.(ref);
        const v = c.value(row);
        cell.value = f ? ({ formula: f, result: v === '' ? '' : v } as any) : (v === '' ? null : (v as number));
      }
    });
    const rc = ws.getCell(r, resultCol);
    rc.border = BORDER;
    rc.alignment = { horizontal: 'center', vertical: 'middle' };
    rc.font = font({ bold: true });
    if (row.isTransferido) rc.value = 'Transferido';
    else if (row.isDesistente) rc.value = 'Desistente';
    else if (hidden) rc.value = 'Retido';
    else rc.value = ({ formula: resultFormula(ref), result: resultCached(row) } as any);
  });

  if (rows.length) {
    // Notas negativas a vermelho; resultado colorido
    cols.forEach((c, k) => {
      if (!c.scale || c.key === 'ca') return;
      const L = colLetter(gradeStart + k);
      ws.addConditionalFormatting({
        ref: `${L}${first}:${L}${last}`,
        rules: [{ type: 'cellIs', operator: 'lessThan', priority: 1, formulae: [(P * c.scale) / 20], style: { font: { color: { argb: RED }, bold: true } } }]
      });
    });
    const RL = colLetter(resultCol);
    ws.addConditionalFormatting({
      ref: `${RL}${first}:${RL}${last}`,
      rules: [
        { type: 'containsText', operator: 'containsText', text: 'Reprovado', priority: 2, style: { font: { color: { argb: RED } } } },
        { type: 'containsText', operator: 'containsText', text: 'Aprovado', priority: 3, style: { font: { color: { argb: 'FF2F75B5' } } } },
        { type: 'containsText', operator: 'containsText', text: 'Recurso', priority: 4, style: { font: { color: { argb: 'FFB45F06' } } } }
      ]
    });
  }

  addFooter(ws, last + 1, totalCols, header.placeAndDate,
    ['O/A Professor/a', opts.signatures.teacher], ['O/A Subdirector/a Pedagógico/a', opts.signatures.pedagogicDirector]);

  // Mapa Estatístico de Aproveitamento (à direita, depois de uma coluna em branco)
  if (rows.length) {
    const mapStart = totalCols + 2;
    const classe = header.description.find((d) => d.label === 'Classe')?.value || '';
    const turma = header.description.find((d) => d.label === 'Turma')?.value || '';
    const G = `$C$${first}:$C$${last}`;
    const RES = `$${colLetter(resultCol)}$${first}:$${colLetter(resultCol)}$${last}`;
    const groups = ['MATRICULADOS', 'DESISTIDOS', 'TRANSFERIDOS', 'AVALIADOS', 'REPROVADOS', 'APROVADOS', 'PERCENTAGEM'];
    ws.getColumn(mapStart - 1).width = 3;
    for (let c = 0; c < 23; c++) {
      ws.getColumn(mapStart + c).width = c === 0 ? 11 : c === 1 ? 7 : 5.5;
      ws.getColumn(mapStart + c).font = font();
    }
    let mr = top;
    ([1, 2, 3] as const).forEach((t) => {
      const mtIdx = cols.findIndex((c) => c.key === `mt${t}`);
      if (mtIdx < 0) return;
      const MT = `$${colLetter(gradeStart + mtIdx)}$${first}:$${colLetter(gradeStart + mtIdx)}$${last}`;
      ws.mergeCells(mr, mapStart, mr, mapStart + 22);
      const tt = ws.getCell(mr, mapStart);
      tt.value = `MAPA ESTATÍSTICO DE APROVEITAMENTO DO ${['I', 'II', 'III'][t - 1]} TRIMESTRE`;
      headerCell(tt, { fill: ORANGE });
      const h1 = mr + 1, h2 = mr + 2, dr = mr + 3;
      ['CLASSE', 'TURMA'].forEach((l, i) => {
        ws.mergeCells(h1, mapStart + i, h2, mapStart + i);
        ws.getCell(h1, mapStart + i).value = l;
        headerCell(ws.getCell(h1, mapStart + i), { fill: SALMON, rotate: 90 });
        const dc = ws.getCell(dr, mapStart + i);
        dc.value = i === 0 ? classe : turma;
        dc.font = font({ bold: true, color: { argb: RED } });
        dc.alignment = { horizontal: 'center', vertical: 'middle' };
        dc.border = BORDER;
      });
      const mt = (v: string) => `${v}`;
      const cnt: Record<string, (g: string) => string> = {
        MATRICULADOS: (g) => `COUNTIF(${G},"${g}")`,
        DESISTIDOS: (g) => `COUNTIFS(${G},"${g}",${RES},"Desistente")`,
        TRANSFERIDOS: (g) => `COUNTIFS(${G},"${g}",${RES},"Transferido")`,
        // Os transferidos mantêm as notas lançadas, mas não entram em Avaliados/Aprovados/Reprovados.
        AVALIADOS: (g) => `COUNTIFS(${G},"${g}",${MT},">=0",${RES},"<>Transferido")`,
        REPROVADOS: (g) => `COUNTIFS(${G},"${g}",${MT},"<${P}",${RES},"<>Transferido")`,
        APROVADOS: (g) => `COUNTIFS(${G},"${g}",${MT},">=${P}",${RES},"<>Transferido")`
      };
      // valores em cache
      const lvl = (r2: StudentMiniPautaItem) => (r2 as any)[`mt${t}`];
      const cached = (grp: string, g: 'M' | 'F'): number => {
        const rs = rows.filter((x) => x.gender === g);
        if (grp === 'MATRICULADOS') return rs.length;
        if (grp === 'DESISTIDOS') return rs.filter((x) => x.isDesistente && !x.isTransferido).length;
        if (grp === 'TRANSFERIDOS') return rs.filter((x) => x.isTransferido).length;
        const ev = rs.filter((x) => !x.isDesistente && !x.isTransferido && !(x.isDebtor && hideDebtorGrades) && typeof lvl(x) === 'number');
        if (grp === 'AVALIADOS') return ev.length;
        if (grp === 'REPROVADOS') return ev.filter((x) => lvl(x) < P).length;
        return ev.filter((x) => lvl(x) >= P).length;
      };
      const posOf = (gi: number) => mapStart + 2 + gi * 3;
      groups.forEach((grp, gi) => {
        const p = posOf(gi);
        ws.mergeCells(h1, p, h1, p + 2);
        ws.getCell(h1, p).value = grp;
        headerCell(ws.getCell(h1, p), { fill: SALMON });
        ['M', 'F', 'MF'].forEach((l, j) => {
          const c = ws.getCell(h2, p + j);
          c.value = l;
          headerCell(c, { fill: j === 2 ? GRAY : SALMON });
        });
      });
      groups.forEach((grp, gi) => {
        const p = posOf(gi);
        const cellAt = (j: number) => `${colLetter(p + j)}${dr}`;
        const at = (g: number, j: number) => `${colLetter(posOf(g) + j)}${dr}`;
        [0, 1, 2].forEach((j) => {
          const c = ws.getCell(dr, p + j);
          c.border = BORDER;
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.font = font({ bold: true, color: { argb: RED } });
          if (j === 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
          if (grp !== 'PERCENTAGEM') {
            if (j < 2) {
              const g = j === 0 ? 'M' : 'F';
              c.value = { formula: cnt[grp](g), result: cached(grp, g as 'M' | 'F') } as any;
            } else {
              c.value = { formula: `${cellAt(0)}+${cellAt(1)}`, result: cached(grp, 'M') + cached(grp, 'F') } as any;
            }
          } else {
            c.numFmt = '0%';
            const av = (jj: number) => cached('AVALIADOS', jj === 0 ? 'M' : 'F');
            const ap = (jj: number) => cached('APROVADOS', jj === 0 ? 'M' : 'F');
            const f = `IFERROR(${at(groups.indexOf('APROVADOS'), j)}/${at(groups.indexOf('AVALIADOS'), j)},0)`;
            const res = j < 2 ? (av(j) ? ap(j) / av(j) : 0) : (av(0) + av(1) ? (ap(0) + ap(1)) / (av(0) + av(1)) : 0);
            c.value = { formula: f, result: res } as any;
          }
        });
      });
      void mt;
      mr += 5;
    });
  }

  return {
    wb,
    fileName: opts.fileName || `Mini-Pauta_${safe(header.description.find((d) => d.label === 'Turma')?.value)}_${safe(header.description.find((d) => d.label === 'Disciplina')?.value)}.xlsx`
  };
}

export async function exportMiniPautaExcel(opts: MiniPautaExcelOptions, load: ImageLoader = fetchImage): Promise<void> {
  const { wb, fileName } = await buildMiniPautaWorkbook(opts, load);
  const buffer = await wb.xlsx.writeBuffer();
  download(buffer as ArrayBuffer, fileName);
}


// ---------------------------------------------------------------------------------------
// PAUTA FINAL
// ---------------------------------------------------------------------------------------
export interface PautaFinalExcelOptions {
  rows: StudentPautaGeralItem[];
  subjects: Subject[];
  header: PautaHeaderModel;
  regime: PautaRegime;
  selectedGradeTypes: Set<GradeTypeKey>;
  isKey: (subject: Subject) => boolean;
  passingGrade: number;
  hideDebtorGrades: boolean;
  signatures: { classHead: string; pedagogicDirector: string; generalDirector: string };
  fileName?: string;
}

/** Constrói o livro Excel da Pauta Final (sem o descarregar) — usado pela exportação e pelos testes. */
export async function buildPautaFinalWorkbook(
  opts: PautaFinalExcelOptions,
  load: ImageLoader = fetchImage
): Promise<{ wb: any; fileName: string }> {
  const ExcelJS = (await import('exceljs')).default as unknown as ExcelJSType;
  const { rows, subjects, header, regime, selectedGradeTypes: sel, passingGrade: P, hideDebtorGrades } = opts;
  const has = (k: GradeTypeKey) => sel.has(k);
  const isExame = regime === 'exame';
  const abbr = buildUniqueSubjectAbbreviations(subjects.map((s) => s.name));

  type SC = { label: string; get: (g: StudentPautaGeralItem['subjectGrades'][string]) => number | string; decisive?: boolean };
  const subCols: SC[] = [];
  if (has('MT1')) subCols.push({ label: 'MT1', get: (g) => num(g.mt1) });
  if (has('MT2')) subCols.push({ label: 'MT2', get: (g) => num(g.mt2) });
  if (has('MT3')) subCols.push({ label: 'MT3', get: (g) => num(g.mt3) });
  if (has('MFD') || subCols.length === 0) subCols.push({ label: 'MFD', get: (g) => num(g.mfd), decisive: !(isExame && has('MF')) });
  if (isExame && has('MF')) subCols.push({ label: 'MF', get: (g) => num(g.mf), decisive: true });
  if (isExame && has('NER')) subCols.push({ label: 'NER', get: (g) => num(g.ner) });

  const showMF = has('MF');
  const FIXED = 3;
  const totalCols = FIXED + subjects.length * subCols.length + (showMF ? 1 : 0) + 1;

  // Só MFD (e MF) visíveis -> nome COMPLETO da disciplina (na impressão e aqui); com MT1/MT2/MT3 -> sigla.
  const fullNames = usesFullSubjectNames(sel);
  const subjectLabel = (s: Subject) =>
    `${fullNames ? s.name : abbr.get(s.name) || s.name}${isExame && opts.isKey(s) ? ' (Chave)' : ''}`;
  const labels = subjects.map(subjectLabel);

  // Largura de cada disciplina. Com nomes completos, cada grupo é dimensionado pela sua palavra mais
  // comprida (nunca se parte uma palavra a meio) e o nome tem de caber em 3 linhas; a linha do
  // cabeçalho cresce para as mostrar inteiras. A estimativa é conservadora (serve também quando o
  // Arial Narrow não está instalado e o Excel usa uma fonte mais larga).
  const CHAR_PX = 9.5;
  const wrapLines = (text: string, w: number) => {
    const cap = Math.max(4, Math.floor((w * 7 - 6) / CHAR_PX));
    let lines = 1;
    let cur = 0;
    text.split(/\s+/).filter(Boolean).forEach((word) => {
      if (cur === 0) cur = word.length;
      else if (cur + 1 + word.length <= cap) cur += 1 + word.length;
      else { lines += 1; cur = word.length; }
    });
    return lines;
  };
  const minGroup = subCols.length * 6.5;
  const groupWidths = labels.map((label) => {
    if (!fullNames) return minGroup;
    const longestWord = Math.max(...label.split(/\s+/).map((w) => w.length), 1);
    let gw = Math.max(minGroup, 9, (longestWord * CHAR_PX + 10) / 7);
    while (gw < 26 && wrapLines(label, gw) > 3) gw += 0.5;
    return Math.round(gw * 2) / 2;
  });
  const groupLines = fullNames && subjects.length ? Math.max(...labels.map((l, i) => wrapLines(l, groupWidths[i]))) : 1;
  const widths: number[] = [5, 36, 7];
  groupWidths.forEach((gw) => {
    for (let j = 0; j < subCols.length; j++) widths.push(Math.max(6.5, gw / subCols.length));
  });
  if (showMF) widths.push(6.5);
  widths.push(16);

  const wb: any = new (ExcelJS as any).Workbook();
  wb.creator = 'Sistema de Gestão Escolar';
  wb.calcProperties = { fullCalcOnLoad: true };
  const ws = createSheet(wb, 'Pauta Final', widths);
  const r0 = await addHeaderBlock(wb, ws, header, totalCols, widths, load, PAUTA_FINAL_HEADER_ZONE_PX);
  const top = r0;
  const sub = r0 + 1;
  if (fullNames && groupLines > 1) ws.getRow(top).height = Math.round(groupLines * 15.75 * 100) / 100;

  [['Nº', 1], ['NOME DO ALUNO', 2]].forEach(([label, c]) => {
    ws.mergeCells(top, c as number, sub, c as number);
    ws.getCell(top, c as number).value = label;
    headerCell(ws.getCell(top, c as number), {});
  });
  ws.mergeCells(top, 3, sub, 3);
  ws.getCell(top, 3).value = 'Género';
  headerCell(ws.getCell(top, 3), { color: RED, rotate: 90 });

  let col = FIXED + 1;
  const decisiveCols: number[] = [];
  subjects.forEach((s) => {
    ws.mergeCells(top, col, top, col + subCols.length - 1);
    const g = ws.getCell(top, col);
    g.value = subjectLabel(s);
    headerCell(g, { fill: DARKGRAY, color: 'FFFFFFFF' });
    subCols.forEach((sc, j) => {
      const c = ws.getCell(sub, col + j);
      c.value = sc.label;
      headerCell(c, { fill: sc.decisive ? SALMON : 'FFFFFFFF' });
      if (sc.decisive) decisiveCols.push(col + j);
    });
    col += subCols.length;
  });
  const mfCol = showMF ? col : 0;
  if (showMF) {
    ws.mergeCells(top, col, sub, col);
    ws.getCell(top, col).value = 'MF';
    headerCell(ws.getCell(top, col), { fill: SALMON });
    col++;
  }
  const sitCol = col;
  ws.mergeCells(top, sitCol, sub, sitCol);
  ws.getCell(top, sitCol).value = 'Resultado Final';
  headerCell(ws.getCell(top, sitCol));

  const first = sub + 1;
  rows.forEach((row, i) => {
    const r = first + i;
    const hidden = row.isDebtor && hideDebtorGrades;
    [row.num, row.name, row.gender].forEach((v, ci) => {
      const cell = ws.getCell(r, ci + 1);
      cell.value = v as any;
      cell.border = BORDER;
      cell.font = font({ bold: ci === 0 });
      cell.alignment = { horizontal: ci === 1 ? 'left' : 'center', vertical: 'middle' };
    });
    let cc = FIXED + 1;
    subjects.forEach((s) => {
      subCols.forEach((sc) => {
        const cell = ws.getCell(r, cc++);
        cell.border = BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = font({ bold: !!sc.decisive, color: { argb: 'FF000000' } });
        cell.numFmt = '0';
        const g = row.subjectGrades[s.id];
        if (row.isDesistente || hidden || !g) {
          cell.value = '-';
        } else {
          const v = sc.get(g);
          cell.value = v === '' ? null : (v as number);
        }
      });
    });
    if (showMF) {
      const cell = ws.getCell(r, mfCol);
      cell.border = BORDER;
      cell.numFmt = '0';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = font({ bold: true });
      if (row.isDesistente || hidden) cell.value = '-';
      else if (decisiveCols.length) {
        const refs = decisiveCols.map((c) => `${colLetter(c)}${r}`).join(',');
        cell.value = { formula: `IF(COUNT(${refs})=0,"",ROUND(AVERAGE(${refs}),0))`, result: num(row.mf) } as any;
      }
    }
    const sc = ws.getCell(r, sitCol);
    sc.border = BORDER;
    sc.alignment = { horizontal: 'center', vertical: 'middle' };
    sc.font = font({ bold: true });
    const label: Record<string, string> = { APROVADO: 'Aprovado (a)', REPROVADO: 'Reprovado (a)', RECURSO: 'Recurso', DESISTIDO: 'Desistente', TRANSFERIDO: 'Transferido', PENDENTE: '' };
    sc.value = row.isTransferido ? 'Transferido' : row.isDesistente ? 'Desistente' : hidden ? 'Retido' : label[row.situation] ?? row.situation;
  });
  const last = first + rows.length - 1;
  if (rows.length) {
    const L = colLetter(FIXED + 1);
    const R = colLetter(sitCol - 1);
    ws.addConditionalFormatting({
      ref: `${L}${first}:${R}${last}`,
      rules: [{ type: 'cellIs', operator: 'lessThan', priority: 1, formulae: [P], style: { font: { color: { argb: RED }, bold: true } } }]
    });
    const SL = colLetter(sitCol);
    ws.addConditionalFormatting({
      ref: `${SL}${first}:${SL}${last}`,
      rules: [
        { type: 'containsText', operator: 'containsText', text: 'Reprovado', priority: 2, style: { font: { color: { argb: RED } } } },
        { type: 'containsText', operator: 'containsText', text: 'Aprovado', priority: 3, style: { font: { color: { argb: 'FF2F75B5' } } } },
        { type: 'containsText', operator: 'containsText', text: 'Recurso', priority: 4, style: { font: { color: { argb: 'FFB45F06' } } } }
      ]
    });
  }

  addFooter(ws, last + 1, totalCols, header.placeAndDate,
    ['O/A Responsável da Turma', opts.signatures.classHead], ['O/A Subdirector/a Pedagógico/a', opts.signatures.pedagogicDirector]);

  return { wb, fileName: opts.fileName || `Pauta_Final_${safe(header.description.find((d) => d.label === 'Turma')?.value)}.xlsx` };
}

export async function exportPautaFinalExcel(opts: PautaFinalExcelOptions, load: ImageLoader = fetchImage): Promise<void> {
  const { wb, fileName } = await buildPautaFinalWorkbook(opts, load);
  const buffer = await wb.xlsx.writeBuffer();
  download(buffer as ArrayBuffer, fileName);
}
