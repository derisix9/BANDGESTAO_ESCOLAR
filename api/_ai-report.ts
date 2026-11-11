/**
 * BANDGESTÃO AI — gerador de documentos profissionais (PDF e Excel) a partir de uma estrutura única.
 * Só corre no servidor.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { Buffer } from 'node:buffer';

export interface ReportKpi { label: string; value: string }
export interface ReportColumn { header: string; align?: 'left' | 'right' | 'center'; width?: number }
export interface ReportTable { columns: ReportColumn[]; rows: Array<Array<string | number>> }
export interface ReportSection { heading: string; kpis?: ReportKpi[]; table?: ReportTable; text?: string[] }
export interface ReportDoc {
  title: string;
  subtitle?: string;
  institution: string;
  issuer: string;
  generatedAt: string;
  sections: ReportSection[];
  notes: string[];
}

const NAVY: [number, number, number] = [10, 42, 82];
const ZEBRA: [number, number, number] = [238, 243, 251];

/** A fonte base do PDF (Helvetica) só cobre Latin-1/WinAnsi: remove o que a faria imprimir lixo. */
function pdfText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...').replace(/[\u2192\u2794]/g, '->').replace(/\u2265/g, '>=').replace(/\u2264/g, '<=')
    .replace(/[^\u0009\u000A\u0020-\u00FF\u2013\u2014\u2022\u20AC]/g, '');
}

export function renderPdf(doc: ReportDoc): Buffer {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const left = 14;
  const right = pageW - 14;

  // Faixa superior
  pdf.setFillColor(...NAVY);
  pdf.rect(0, 0, pageW, 24, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('BANDGESTÃO', left, 15.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(pdfText(doc.institution), right, 11, { align: 'right', maxWidth: 110 });
  pdf.text('Relatório emitido pelo BANDGESTÃO AI', right, 16.5, { align: 'right' });

  // Título
  pdf.setTextColor(...NAVY);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  const titleLines = pdf.splitTextToSize(pdfText(doc.title), right - left) as string[];
  pdf.text(titleLines, left, 36);
  let y = 36 + titleLines.length * 7;
  pdf.setTextColor(90, 100, 115);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  const meta = [doc.subtitle, `Emitido por: ${doc.issuer}`, `Data: ${doc.generatedAt}`].filter(Boolean).join('   •   ');
  const metaLines = pdf.splitTextToSize(pdfText(meta), right - left) as string[];
  pdf.text(metaLines, left, y);
  y += metaLines.length * 4.4 + 3;
  pdf.setDrawColor(...NAVY);
  pdf.setLineWidth(0.5);
  pdf.line(left, y, right, y);
  y += 7;

  const ensure = (needed: number) => {
    if (y + needed > 280) { pdf.addPage(); y = 18; }
  };

  for (const section of doc.sections) {
    ensure(18);
    pdf.setTextColor(...NAVY);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(pdfText(section.heading), left, y);
    y += 2.5;
    pdf.setDrawColor(200, 210, 225);
    pdf.setLineWidth(0.3);
    pdf.line(left, y, right, y);
    y += 4;

    if (section.kpis?.length) {
      autoTable(pdf, {
        startY: y, margin: { left, right: 14 }, theme: 'plain',
        body: section.kpis.map((k) => [pdfText(k.label), pdfText(k.value)]),
        styles: { fontSize: 9.5, cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 }, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 95 }, 1: { halign: 'right', fontStyle: 'bold', textColor: NAVY } },
        alternateRowStyles: { fillColor: ZEBRA }
      });
      y = ((pdf as any).lastAutoTable?.finalY ?? y) + 5;
    }
    if (section.text?.length) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.setTextColor(40, 50, 65);
      for (const paragraph of section.text) {
        const lines = pdf.splitTextToSize(pdfText(paragraph), right - left) as string[];
        ensure(lines.length * 4.6 + 2);
        pdf.text(lines, left, y);
        y += lines.length * 4.6 + 2;
      }
      y += 2;
    }
    if (section.table) {
      const { columns, rows } = section.table;
      autoTable(pdf, {
        startY: y, margin: { left, right: 14, top: 16, bottom: 16 }, theme: 'grid',
        head: [columns.map((c) => pdfText(c.header))],
        body: rows.map((r) => r.map((cell) => pdfText(cell))),
        styles: { fontSize: 8, cellPadding: 1.8, lineColor: [210, 220, 235], lineWidth: 0.1, textColor: [30, 41, 59], overflow: 'linebreak' },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', halign: 'left' },
        alternateRowStyles: { fillColor: ZEBRA },
        showHead: 'everyPage',
        columnStyles: Object.fromEntries(columns.map((c, i) => [i, {
          halign: c.align || 'left', ...(c.width ? { cellWidth: c.width } : {})
        }]))
      });
      y = ((pdf as any).lastAutoTable?.finalY ?? y) + 8;
    }
  }

  if (doc.notes.length) {
    ensure(12 + doc.notes.length * 5);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 110, 125);
    for (const note of doc.notes) {
      const lines = pdf.splitTextToSize(pdfText(`Nota: ${note}`), right - left) as string[];
      ensure(lines.length * 4 + 1);
      pdf.text(lines, left, y);
      y += lines.length * 4 + 1;
    }
  }

  // Rodapé com numeração em todas as páginas
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    const h = pdf.internal.pageSize.getHeight();
    pdf.setDrawColor(200, 210, 225);
    pdf.setLineWidth(0.2);
    pdf.line(left, h - 12, right, h - 12);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(110, 120, 135);
    pdf.text('Documento informativo gerado pelo BANDGESTÃO AI. Confirme os dados oficiais no sistema.', left, h - 7.5);
    pdf.text(`Página ${i} de ${pages}`, right, h - 7.5, { align: 'right' });
  }
  return Buffer.from(pdf.output('arraybuffer'));
}

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Folha';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 25)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

export async function renderXlsx(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BANDGESTÃO AI';
  wb.created = new Date();
  const used = new Set<string>();
  const headFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0A2A52' } };
  const zebraFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEEF3FB' } };

  const addBanner = (ws: ExcelJS.Worksheet, cols: number): number => {
    ws.mergeCells(1, 1, 1, Math.max(cols, 2));
    const t = ws.getCell(1, 1);
    t.value = doc.title; t.font = { bold: true, size: 15, color: { argb: 'FF0A2A52' } };
    ws.mergeCells(2, 1, 2, Math.max(cols, 2));
    ws.getCell(2, 1).value = `${doc.institution}  •  Emitido por ${doc.issuer}  •  ${doc.generatedAt}`;
    ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF5A6473' } };
    return 4;
  };

  const summary = doc.sections.filter((s) => s.kpis?.length || s.text?.length);
  const tables = doc.sections.filter((s) => s.table);

  if (summary.length || !tables.length) {
    const ws = wb.addWorksheet(sheetName('Resumo', used));
    ws.columns = [{ width: 52 }, { width: 28 }];
    let row = addBanner(ws, 2);
    for (const s of summary) {
      ws.getCell(row, 1).value = s.heading; ws.getCell(row, 1).font = { bold: true, size: 11, color: { argb: 'FF0A2A52' } };
      row++;
      for (const k of s.kpis || []) {
        ws.getCell(row, 1).value = k.label; ws.getCell(row, 2).value = k.value;
        ws.getCell(row, 2).font = { bold: true }; ws.getCell(row, 2).alignment = { horizontal: 'right' };
        if (row % 2 === 0) { ws.getCell(row, 1).fill = zebraFill; ws.getCell(row, 2).fill = zebraFill; }
        row++;
      }
      for (const p of s.text || []) { ws.getCell(row, 1).value = p; ws.getCell(row, 1).alignment = { wrapText: true }; row++; }
      row++;
    }
    for (const n of doc.notes) { ws.getCell(row, 1).value = `Nota: ${n}`; ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: 'FF5A6473' } }; row++; }
  }

  for (const s of tables) {
    const t = s.table!;
    const ws = wb.addWorksheet(sheetName(s.heading, used));
    ws.columns = t.columns.map((c) => ({ width: Math.min(46, Math.max(12, c.width ? Math.round(c.width / 2.2) : c.header.length + 6)) }));
    const start = addBanner(ws, t.columns.length);
    const head = ws.getRow(start);
    t.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header; cell.fill = headFill;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: c.align || 'left' };
    });
    head.height = 20;
    t.rows.forEach((r, ri) => {
      const row = ws.getRow(start + 1 + ri);
      r.forEach((value, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = value as any;
        cell.alignment = { horizontal: t.columns[ci]?.align || 'left', vertical: 'top' };
        if (ri % 2 === 1) cell.fill = zebraFill;
      });
    });
    ws.views = [{ state: 'frozen', ySplit: start }];
    ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start, column: t.columns.length } };
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
