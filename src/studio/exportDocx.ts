/**
 * Exporta um documento de fluxo (certificado/declaração) para Word (.docx).
 * O ficheiro sai com texto, tabelas e imagens 100 % editáveis; só as notas e dados académicos
 * (tabela) devem manter-se como vêm do sistema.
 */
import {
  AlignmentType, BorderStyle, Document, Header, ImageRun, Packer, PageBorderDisplay, PageBorderOffsetFrom, PageBreak, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, HorizontalPositionAlign, VerticalPositionAlign, TextWrappingType
} from 'docx';
import JSZip from 'jszip';
import type { Block, FlowDoc, TableSpec } from './flow';
import { borderColorOf, paperColorOf } from './flow';
import { parseRuns } from './rich';

export interface ImgData { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; w: number; h: number }
export interface DocxOptions {
  overrides?: Record<string, string>;
  images?: Record<string, ImgData | undefined>;
  /** Marca de água já esbatida (PNG), centrada atrás do texto. */
  watermark?: ImgData;
}

const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134; // A4, margens 2 cm
const TEXT_W = PAGE_W - MARGIN * 2;
const mmToPx = (mm: number) => Math.round(mm * 3.7795);
const FONT = { serif: 'Times New Roman', sans: 'Arial', mono: 'Courier New' } as const;
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const LINE = { style: BorderStyle.SINGLE, size: 6, color: '000000' } as const;

export function dataUrlToImg(url: string, w = 0, h = 0): ImgData | undefined {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(url || '');
  if (!m) return undefined;
  const bin = typeof atob === 'function' ? atob(m[2]) : Buffer.from(m[2], 'base64').toString('binary');
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const kind = m[1].toLowerCase();
  return { data, type: kind.startsWith('jp') ? 'jpg' : (kind as ImgData['type']), w, h };
}

function runsFor(html: string, size: number, font: string, base: { bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const r of parseRuns(html)) {
    if (r.br) { out.push(new TextRun({ break: 1 })); continue; }
    out.push(new TextRun({ text: r.text, bold: r.bold ?? base.bold, italics: r.italic, underline: r.underline ? {} : undefined, color: r.color, font: r.mono ? FONT.mono : font, size: Math.round(size * 2) }));
  }
  return out.length ? out : [new TextRun({ text: '', size: Math.round(size * 2), font })];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (s: string) => esc(s);

function fitImg(img: ImgData, maxHmm: number, maxWmm = 60) {
  const ratio = img.w && img.h ? img.w / img.h : 1;
  let h = mmToPx(maxHmm), w = Math.round(h * ratio);
  const maxW = mmToPx(maxWmm);
  if (w > maxW) { w = maxW; h = Math.round(w / ratio); }
  return { width: w, height: h };
}

function imagesBlock(b: Extract<Block, { t: 'images' }>, images: DocxOptions['images']): Table | Paragraph {
  const cell = (slot: string | undefined, align: (typeof AlignmentType)[keyof typeof AlignmentType]) => {
    const img = slot ? images?.[slot] : undefined;
    return new TableCell({
      width: { size: Math.round(TEXT_W / 3), type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: align, children: img ? [new ImageRun({ type: img.type, data: img.data, transformation: fitImg(img, b.h, 32), altText: { name: slot!, title: slot!, description: slot! } })] : [new TextRun('')] })]
    });
  };
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: [Math.round(TEXT_W / 3), Math.round(TEXT_W / 3), Math.round(TEXT_W / 3)],
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: [cell(b.left, AlignmentType.LEFT), cell(b.center, AlignmentType.CENTER), cell(b.right, AlignmentType.RIGHT)] })]
  });
}

function gradesTable(spec: TableSpec, font: string): Table {
  const total = TEXT_W;
  const widths = spec.cols.map((c) => Math.round(c.w * total));
  const sumW = widths.reduce((a, c) => a + c, 0);
  widths[0] += total - sumW;
  const border = { top: LINE, bottom: LINE, left: LINE, right: LINE } as const;
  const margins = { top: 50, bottom: 50, left: 80, right: 80 };
  const sz = Math.round(spec.fontPt * 2);
  const hdr = new TableRow({
    tableHeader: true,
    children: spec.cols.map((c, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, borders: border, margins, verticalAlign: VerticalAlign.CENTER,
      shading: spec.headerFill && spec.headerFill.toUpperCase() !== '#FFFFFF' ? { type: ShadingType.CLEAR, color: 'auto', fill: spec.headerFill.replace('#', '') } : undefined,
      children: [new Paragraph({ alignment: c.align === 'left' ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text: c.label, bold: true, size: sz, font, color: spec.twoUp ? '000000' : undefined })] })]
    }))
  });
  const rows = spec.rows.map((r) => {
    if (r.kind === 'section') {
      return new TableRow({ children: [new TableCell({ columnSpan: spec.cols.length, borders: border, margins, shading: { type: ShadingType.CLEAR, color: 'auto', fill: spec.sectionFill.replace('#', '') }, children: [new Paragraph({ children: [new TextRun({ text: r.cells[0], bold: true, size: sz, font })] })] })] });
    }
    const bold = r.kind === 'total';
    return new TableRow({
      cantSplit: true,
      children: r.cells.map((txt, i) => new TableCell({
        width: { size: widths[i], type: WidthType.DXA }, borders: border, margins, verticalAlign: VerticalAlign.CENTER,
        shading: r.na?.[i] && spec.naFill ? { type: ShadingType.CLEAR, color: 'auto', fill: spec.naFill.replace('#', '') } : undefined,
        children: [new Paragraph({ alignment: spec.cols[i].align === 'left' ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text: txt, bold: bold || (spec.twoUp ? false : false), size: sz, font })] })]
      }))
    });
  });
  return new Table({ width: { size: total, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: widths, rows: [hdr, ...rows] });
}

function signBlock(b: Extract<Block, { t: 'sign' }>, o: DocxOptions, font: string): Table {
  const get = (id: string, fallback: string) => o.overrides?.[id] ?? fallback;
  const col = (side: { label: string; name: string; idL: string; idN: string }) => new TableCell({
    width: { size: Math.round(TEXT_W / 2), type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: runsFor(get(side.idL, `<b>${plain(side.label)}</b>`).replace(/^(?!<)(.*)$/s, '<b>$1</b>'), 11, font) }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '______________________________', size: 22, font })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: runsFor(get(side.idN, plain(side.name)), 11, font) })
    ]
  });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: [Math.round(TEXT_W / 2), Math.round(TEXT_W / 2)],
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: [col(b.left), col(b.right)] })]
  });
}

export function pageBordersFor(doc: FlowDoc) {
  const color = borderColorOf(doc.page).replace('#', '');
  const mk = (style: (typeof BorderStyle)[keyof typeof BorderStyle], size: number, space = 24) => ({ style, size, color, space });
  let side;
  switch (doc.page.border) {
    case 'duplaVermelha': side = mk(BorderStyle.THICK_THIN_SMALL_GAP, 24); break;
    case 'purpura': side = mk(BorderStyle.SINGLE, 24); break;
    case 'purpuraFina': side = mk(BorderStyle.DOUBLE, 6); break;
    case 'verdeOuro': side = mk(BorderStyle.DOUBLE, 18); break;
    case 'greca': side = mk(BorderStyle.SINGLE, 36); break;
    case 'fina': side = mk(BorderStyle.SINGLE, 12); break;
    default: return undefined;
  }
  return {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop: { ...side, space: 24 }, pageBorderBottom: { ...side, space: 24 }, pageBorderLeft: { ...side, space: 24 }, pageBorderRight: { ...side, space: 24 }
  };
}

/** Blocos de um documento de fluxo em parágrafos/tabelas do Word. */
function docChildren(doc: FlowDoc, o: DocxOptions): Array<Paragraph | Table> {
  const font = doc.page.font === 'sans' ? FONT.sans : FONT.serif;
  const ov = o.overrides || {};
  const children: Array<Paragraph | Table> = [];
  for (const b of doc.blocks) {
    if (b.t === 'images') children.push(imagesBlock(b, o.images));
    else if (b.t === 'spacer') children.push(new Paragraph({ spacing: { after: Math.round(b.h * 20 * 0.7) }, children: [new TextRun('')] }));
    else if (b.t === 'line') {
      const text = ov[b.id] ?? esc(b.text);
      children.push(new Paragraph({ alignment: b.align === 'left' ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { after: Math.round(b.after * 20) }, children: runsFor(text, b.size, b.font ? FONT[b.font] : font, { bold: b.bold }) }));
    } else if (b.t === 'para') {
      children.push(new Paragraph({ alignment: b.align === 'justify' ? AlignmentType.JUSTIFIED : b.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { before: Math.round((b.before || 0) * 20), after: Math.round(b.after * 20), line: 300 }, children: runsFor(ov[b.id] ?? b.html, b.size, font) }));
    } else if (b.t === 'table') {
      children.push(gradesTable(b.spec, font));
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun('')] }));
    } else if (b.t === 'sign') children.push(signBlock(b, o, font));
  }
  return children;
}

/** Serializa o documento do Word para bytes sem depender do Node (o browser não tem "nodebuffer"). */
async function packBytes(d: Document): Promise<Uint8Array> {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = await Packer.toBlob(d);
    return new Uint8Array(await blob.arrayBuffer());
  }
  return Packer.toBuffer(d);
}

export async function buildDocx(doc: FlowDoc, o: DocxOptions = {}): Promise<Uint8Array> {
  return buildDocxBatch([doc], o);
}

/** Vários documentos (ex.: turma inteira) num único .docx, cada um a começar em página nova. */
export async function buildDocxBatch(docs: FlowDoc[], o: DocxOptions = {}): Promise<Uint8Array> {
  const doc = docs[0];
  if (!doc) throw new Error('Sem documentos para exportar.');
  const children: Array<Paragraph | Table> = [];
  docs.forEach((d, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...docChildren(d, o));
  });

  const headerChildren: Paragraph[] = [];
  if (o.watermark) {
    const wmSize = Math.round(mmToPx(110));
    headerChildren.push(new Paragraph({
      children: [new ImageRun({
        type: o.watermark.type, data: o.watermark.data, transformation: { width: wmSize, height: wmSize },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.CENTER },
          behindDocument: true, wrap: { type: TextWrappingType.NONE }
        },
        altText: { name: 'marca-de-agua', title: 'Marca de água', description: 'Brasão esbatido' }
      })]
    }));
  }

  const font = doc.page.font === 'sans' ? FONT.sans : FONT.serif;
  const paper = paperColorOf(doc.page).replace('#', '');
  const d = new Document({
    creator: 'Sistema de Gestão Escolar', title: doc.title, description: 'Gerado no Estúdio de Documentos',
    background: paper.toUpperCase() !== 'FFFFFF' ? { color: paper } : undefined,
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1000, bottom: 900, left: MARGIN, right: MARGIN, header: 400, footer: 400 }, borders: pageBordersFor(doc) as any } },
      headers: headerChildren.length ? { default: new Header({ children: headerChildren }) } : undefined,
      children
    }]
  });
  let bytes: Uint8Array = await packBytes(d);

  // Moldura "grega" (arte de página do Word) e fundo visível: pequenos acertos ao XML.
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file('word/document.xml')!.async('string');
  if (doc.page.border === 'greca') {
    xml = xml.replace(/(<w:pgBorders[^>]*>[\s\S]*?<\/w:pgBorders>)/, (m) => m.replace(/w:val="single"/g, 'w:val="basicBlackSquares"').replace(/w:sz="\d+"/g, 'w:sz="24"'));
  }
  zip.file('word/document.xml', xml);
  if (paper.toUpperCase() !== 'FFFFFF') {
    const st = await zip.file('word/settings.xml')!.async('string');
    if (!/displayBackgroundShape/.test(st)) zip.file('word/settings.xml', st.replace(/(<w:settings[^>]*>)/, '$1<w:displayBackgroundShape/>'));
  }
  bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return bytes;
}

