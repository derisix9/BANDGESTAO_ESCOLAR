import { fetchImage, ImageLoader } from './pautaExcelExport';

/**
 * Exportação das Estatísticas Escolares (Relatórios) em Excel (.xlsx).
 * Reproduz a IMPRESSÃO: o mesmo cabeçalho oficial (insígnia, República, Governo, escola, título, quadro de
 * Ano Letivo / Período / NIF / Data de Emissão), as mesmas cores no cabeçalho e nas colunas de destaque,
 * a mesma linha de TOTAL e o rodapé com as 3 assinaturas. Os números saem como números (somáveis no Excel).
 */

type ExcelJSType = typeof import('exceljs');

const FONT = 'Arial';
const NAVY = 'FF0B1F3A';
const BORDER_C = 'FF94A3B8';
const BORDER_DARK = 'FF475569';
const ZEBRA = 'FFF8FAFC';

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

export interface XlsxCol {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  /** Fundo / texto do cabeçalho (por omissão azul-marinho / branco). */
  headFill?: string;
  headColor?: string;
  /** Destaque de coluna no corpo (ex.: verde das assiduidades). */
  cellFill?: string;
  cellColor?: string;
  bold?: boolean;
  /** Fundo / texto desta coluna na linha de TOTAL. */
  totFill?: string;
  totColor?: string;
  numFmt?: string;
  /** Cabeçalho agrupado (linha de cima): colunas consecutivas com o mesmo `group.id` fundem-se. */
  group?: { id: string; label: string; fill: string; color: string };
  /** Texto do sub-cabeçalho (2.ª linha) quando há grupos (ex.: M / F / MF). */
  subHeader?: string;
  /** Cor do corpo por valor (ex.: vermelho quando > 0). */
  colorFn?: (v: unknown) => string | undefined;
}

export interface XlsxReportSpec {
  fileName: string;
  sheetName: string;
  schoolName: string;
  logoUrl?: string;
  title: string;
  meta: Array<{ label: string; value: string }>;
  columns: XlsxCol[];
  rows: unknown[][];
  total?: unknown[];
  footnote?: string;
  emptyMessage?: string;
  signatures?: string[];
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

const colPx = (w: number) => Math.round(w * 7 + 5);

export async function buildReportWorkbook(spec: XlsxReportSpec, load: ImageLoader = fetchImage) {
  const ExcelJS = (await import('exceljs')).default as unknown as ExcelJSType;
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.schoolName;
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.sheetName.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.1, footer: 0.1 }
    }
  });

  const cols = spec.columns;
  const n = cols.length;
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  const totalPx = cols.reduce((a, c) => a + colPx(c.width), 0);

  const border = (color = BORDER_C) => ({
    top: { style: 'thin' as const, color: { argb: color } },
    left: { style: 'thin' as const, color: { argb: color } },
    bottom: { style: 'thin' as const, color: { argb: color } },
    right: { style: 'thin' as const, color: { argb: color } }
  });
  const fill = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: hex } });

  let r = 1;
  const merged = (row: number, c1: number, c2: number) => { if (c2 > c1) ws.mergeCells(row, c1, row, c2); };

  // ---- Cabeçalho oficial -------------------------------------------------------------------------------
  const logoRow = r++;
  ws.getRow(logoRow).height = 54;
  const lines: Array<{ text: string; size: number; bold: boolean; color: string; h: number }> = [
    { text: 'REPÚBLICA DE ANGOLA • MINISTÉRIO DA EDUCAÇÃO', size: 9, bold: true, color: 'FF334155', h: 14 },
    { text: 'GOVERNO PROVINCIAL • DIRECÇÃO MUNICIPAL DA EDUCAÇÃO', size: 10, bold: true, color: 'FF1E293B', h: 15 },
    { text: spec.schoolName.toUpperCase(), size: 16, bold: true, color: NAVY, h: 26 },
    { text: spec.title.toUpperCase(), size: 11, bold: true, color: 'FF1E293B', h: 20 }
  ];
  lines.forEach((l) => {
    const row = r++;
    ws.getRow(row).height = l.h;
    merged(row, 1, n);
    const cell = ws.getCell(row, 1);
    cell.value = l.text;
    cell.font = { name: FONT, size: l.size, bold: l.bold, color: { argb: l.color } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Insígnia centrada na primeira linha.
  const logo = await load(spec.logoUrl || '/school_emblem.png');
  if (logo) {
    const h = 56;
    const w = logo.width && logo.height ? Math.round((h * logo.width) / logo.height) : 56;
    const left = Math.max(0, (totalPx - w) / 2);
    let acc = 0;
    let colIdx = 0;
    let frac = 0;
    for (let i = 0; i < n; i++) {
      const cw = colPx(cols[i].width);
      if (left < acc + cw) { colIdx = i; frac = (left - acc) / cw; break; }
      acc += cw;
      colIdx = i;
    }
    const id = wb.addImage({ base64: logo.base64, extension: logo.ext });
    ws.addImage(id, { tl: { col: colIdx + frac, row: logoRow - 1 + 0.04 }, ext: { width: w, height: h } });
  }

  // Quadro Ano Letivo / Período / NIF / Data de Emissão.
  r++;
  ws.getRow(r - 1).height = 6;
  const metaN = spec.meta.length;
  const per = Math.max(1, Math.floor(n / metaN));
  const labelRow = r++;
  const valueRow = r++;
  ws.getRow(labelRow).height = 13;
  ws.getRow(valueRow).height = 19;
  spec.meta.forEach((m, i) => {
    const c1 = i * per + 1;
    const c2 = i === metaN - 1 ? n : (i + 1) * per;
    merged(labelRow, c1, c2);
    merged(valueRow, c1, c2);
    for (let c = c1; c <= c2; c++) {
      const top = ws.getCell(labelRow, c);
      const bot = ws.getCell(valueRow, c);
      top.fill = fill(ZEBRA);
      bot.fill = fill(ZEBRA);
      top.border = { top: border().top, left: c === c1 ? border().left : undefined, right: c === c2 ? border().right : undefined };
      bot.border = { bottom: border().bottom, left: c === c1 ? border().left : undefined, right: c === c2 ? border().right : undefined };
    }
    const lc = ws.getCell(labelRow, c1);
    lc.value = m.label.toUpperCase();
    lc.font = { name: FONT, size: 7, bold: true, color: { argb: 'FF64748B' } };
    lc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    const vc = ws.getCell(valueRow, c1);
    vc.value = m.value;
    vc.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF1E293B' } };
    vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  });
  // Linha forte por baixo do cabeçalho (border-b-2 da impressão).
  const ruleRow = r++;
  ws.getRow(ruleRow).height = 6;
  for (let c = 1; c <= n; c++) ws.getCell(ruleRow, c).border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
  r++;
  ws.getRow(r - 1).height = 8;

  // ---- Tabela ------------------------------------------------------------------------------------------
  const hasGroups = cols.some((c) => c.group);
  const head1 = r++;
  const head2 = hasGroups ? r++ : head1;
  ws.getRow(head1).height = hasGroups ? 22 : 30;
  if (hasGroups) ws.getRow(head2).height = 18;

  const styleHead = (cell: import('exceljs').Cell, bg: string, color: string, align: 'left' | 'center' | 'right' = 'center') => {
    cell.fill = fill(argb(bg));
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: argb(color) } };
    cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
    cell.border = border(BORDER_DARK);
  };

  let i = 0;
  while (i < n) {
    const c = cols[i];
    if (c.group) {
      let j = i;
      while (j + 1 < n && cols[j + 1].group?.id === c.group.id) j++;
      merged(head1, i + 1, j + 1);
      const cell = ws.getCell(head1, i + 1);
      cell.value = c.group.label;
      for (let k = i; k <= j; k++) styleHead(ws.getCell(head1, k + 1), c.group.fill, c.group.color);
      for (let k = i; k <= j; k++) {
        const sc = ws.getCell(head2, k + 1);
        sc.value = cols[k].subHeader ?? cols[k].header;
        styleHead(sc, '334155', 'FFFFFF');
      }
      i = j + 1;
      continue;
    }
    if (hasGroups) ws.mergeCells(head1, i + 1, head2, i + 1);
    const cell = ws.getCell(head1, i + 1);
    cell.value = c.header;
    styleHead(cell, c.headFill || '0B1F3A', c.headColor || 'FFFFFF', c.align === 'right' ? 'center' : (c.align || 'left'));
    if (hasGroups) styleHead(ws.getCell(head2, i + 1), c.headFill || '0B1F3A', c.headColor || 'FFFFFF', c.align === 'right' ? 'center' : (c.align || 'left'));
    i++;
  }

  const num = (v: unknown) => v;
  if (spec.rows.length === 0) {
    const row = r++;
    merged(row, 1, n);
    const cell = ws.getCell(row, 1);
    cell.value = spec.emptyMessage || 'Sem dados para os filtros selecionados.';
    cell.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(row).height = 28;
  }
  spec.rows.forEach((vals, idx) => {
    const row = r++;
    ws.getRow(row).height = 18;
    vals.forEach((v, ci) => {
      const col = cols[ci];
      const cell = ws.getCell(row, ci + 1);
      cell.value = num(v) as any;
      const colorHex = col.colorFn?.(v);
      const isName = ci === 0;
      cell.font = {
        name: FONT, size: 9,
        bold: isName || !!col.bold || !!col.cellColor,
        color: { argb: colorHex ? argb(colorHex) : col.cellColor ? argb(col.cellColor) : isName ? NAVY : 'FF1E293B' }
      };
      cell.fill = fill(col.cellFill ? argb(col.cellFill) : idx % 2 === 1 ? ZEBRA : 'FFFFFFFF');
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle', wrapText: col.align !== 'center' && col.align !== 'right', indent: col.align ? 0 : 1 };
      cell.border = border();
      if (col.numFmt && typeof v === 'number') cell.numFmt = col.numFmt;
    });
  });
  if (spec.total && spec.rows.length > 0) {
    const row = r++;
    ws.getRow(row).height = 22;
    spec.total.forEach((v, ci) => {
      const col = cols[ci];
      const cell = ws.getCell(row, ci + 1);
      cell.value = v as any;
      cell.fill = fill(col.totFill ? argb(col.totFill) : NAVY);
      cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: col.totColor ? argb(col.totColor) : 'FFFFFFFF' } };
      cell.alignment = { horizontal: ci === 0 ? 'left' : col.align || 'center', vertical: 'middle', indent: ci === 0 ? 1 : 0 };
      cell.border = { ...border(BORDER_DARK), top: { style: 'medium', color: { argb: 'FF0F172A' } } };
      if (col.numFmt && typeof v === 'number') cell.numFmt = col.numFmt;
    });
  }

  if (spec.footnote) {
    const row = r++;
    merged(row, 1, n);
    ws.getRow(row).height = 28;
    const cell = ws.getCell(row, 1);
    cell.value = spec.footnote;
    cell.font = { name: FONT, size: 8, color: { argb: 'FF64748B' } };
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  }

  // ---- Rodapé: 3 assinaturas -----------------------------------------------------------------------------
  const sigs = spec.signatures || [];
  if (sigs.length) {
    r += 2;
    const sigRow = r++;
    ws.getRow(sigRow).height = 28;
    const labelRow2 = r++;
    ws.getRow(labelRow2).height = 16;
    const sp = Math.max(1, Math.floor(n / sigs.length));
    sigs.forEach((label, k) => {
      const c1 = k * sp + 1;
      const c2 = k === sigs.length - 1 ? n : (k + 1) * sp;
      // pequena margem: a linha de assinatura ocupa do 2.º ao penúltimo "slot"
      merged(labelRow2, c1, c2);
      const line = ws.getCell(sigRow, c1);
      for (let c = c1; c <= c2; c++) ws.getCell(sigRow, c).border = { bottom: { style: 'thin', color: { argb: 'FF64748B' } } };
      line.value = '';
      const cell = ws.getCell(labelRow2, c1);
      cell.value = label.toUpperCase();
      cell.font = { name: FONT, size: 9, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function exportReportExcel(spec: XlsxReportSpec, load: ImageLoader = fetchImage): Promise<void> {
  const buffer = await buildReportWorkbook(spec, load);
  download(buffer, spec.fileName);
}
