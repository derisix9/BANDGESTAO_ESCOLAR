/**
 * Leitura/escrita de Excel (.xlsx) com `exceljs`, no lugar do `xlsx@0.18.5` (SheetJS), que tem falhas conhecidas
 * (prototype pollution CVE-2023-30533 e ReDoS CVE-2024-22363) e já não recebe correcções no npm.
 *
 * Tudo o que a app lê de um Excel de terceiros (pautas, extractos bancários, backups) passa por aqui:
 *  - limites de tamanho/folhas/linhas/colunas antes de devolver dados;
 *  - só devolve valores simples (texto, número, booleano, Date): fórmulas viram o último resultado, texto rico vira texto;
 *  - ao escrever, uma célula de texto nunca é tratada como fórmula (não há injecção de `=...`).
 * Formatos suportados: .xlsx / .xlsm. Os antigos .xls e .ods NÃO são lidos pelo exceljs (ver bankStatementImport).
 */
import type { CellValue } from 'exceljs';

export type XlsxRow = unknown[];
export interface SheetMatrix { name: string; rows: XlsxRow[]; /** largura das colunas ao escrever (caracteres) */ colWidths?: number[] }

export interface XlsxReadOptions {
  /** Ignora linhas sem nenhum valor (por omissão: sim). */
  skipBlankRows?: boolean;
  /** Tamanho máximo do ficheiro em bytes (por omissão 15 MB). */
  maxBytes?: number;
}

/** Interface mínima usada pela app; os testes injectam uma versão falsa. */
export interface XlsxLib {
  read(bytes: Uint8Array | ArrayBuffer, opts?: XlsxReadOptions): Promise<SheetMatrix[]>;
  write(sheets: SheetMatrix[]): Promise<Uint8Array>;
}
export type XlsxLoader = () => Promise<XlsxLib>;

export const XLSX_LIMITS = { maxBytes: 15 * 1024 * 1024, maxSheets: 50, maxRows: 100_000, maxCols: 256 } as const;

export class XlsxLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'XlsxLimitError'; }
}

/** Valor de uma célula do exceljs → valor simples. */
export function plainCellValue(v: CellValue | undefined, depth = 0): unknown {
  if (v === null || v === undefined || depth > 4) return '';
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;
  const o = v as unknown as Record<string, unknown>;
  if ('result' in o) return plainCellValue(o.result as CellValue, depth + 1);            // fórmula: o último resultado calculado
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: unknown }>).map((t) => String(t?.text ?? '')).join('');
  if ('error' in o) return '';                                                              // #N/A, #REF!...
  if (o.text !== undefined) return plainCellValue(o.text as CellValue, depth + 1);        // hiperligação
  return '';
}

/** Valor a escrever: nunca objectos, nunca NaN/Infinity. */
function writableValue(v: unknown): string | number | boolean | Date | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return String(v);
}

/** Nome de folha válido no Excel (≤ 31 caracteres, sem \ / * ? : [ ]), único dentro do ficheiro. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = String(name ?? '').replace(/[\\/*?:[\]]/g, '_').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Folha';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) {
    const suffix = `_${n}`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(out.toLowerCase());
  return out;
}

async function loadExcelJs(): Promise<typeof import('exceljs')> {
  return (await import('exceljs')).default as unknown as typeof import('exceljs');
}

const MERGE_SLAVE = 1;   // ExcelJS.ValueType.Merge: célula coberta por uma fusão (só a de cima à esquerda tem valor)

export const xlsxLib: XlsxLib = {
  async read(bytes, opts = {}) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const maxBytes = opts.maxBytes ?? XLSX_LIMITS.maxBytes;
    if (u8.byteLength > maxBytes) {
      throw new XlsxLimitError(`O ficheiro Excel é demasiado grande (${Math.round(u8.byteLength / 1048576)} MB; máximo ${Math.round(maxBytes / 1048576)} MB).`);
    }
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(u8 as unknown as ArrayBuffer);
    if (wb.worksheets.length > XLSX_LIMITS.maxSheets) throw new XlsxLimitError(`O ficheiro tem folhas a mais (máximo ${XLSX_LIMITS.maxSheets}).`);
    const skipBlank = opts.skipBlankRows ?? true;
    const out: SheetMatrix[] = [];
    for (const ws of wb.worksheets) {
      const nRows = ws.rowCount;
      const nCols = ws.columnCount;
      if (nRows > XLSX_LIMITS.maxRows || nCols > XLSX_LIMITS.maxCols) {
        throw new XlsxLimitError(`A folha "${ws.name}" é demasiado grande (máximo ${XLSX_LIMITS.maxRows} linhas e ${XLSX_LIMITS.maxCols} colunas).`);
      }
      const rows: XlsxRow[] = [];
      for (let r = 1; r <= nRows; r++) {
        const row = ws.getRow(r);
        const arr: unknown[] = new Array(nCols);
        let blank = true;
        for (let c = 1; c <= nCols; c++) {
          const cell = row.getCell(c);
          const v = cell.type === MERGE_SLAVE ? '' : plainCellValue(cell.value);
          arr[c - 1] = v;
          if (v !== '') blank = false;
        }
        if (blank && skipBlank) continue;
        rows.push(arr);
      }
      out.push({ name: ws.name, rows });
    }
    return out;
  },

  async write(sheets) {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    const used = new Set<string>();
    for (const s of sheets) {
      const ws = wb.addWorksheet(safeSheetName(s.name, used));
      for (const r of s.rows) ws.addRow(r.map(writableValue));
      s.colWidths?.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Uint8Array(buf as ArrayBuffer);
  }
};

/** Carrega o exceljs só quando é preciso (fica fora do pacote inicial). */
export const loadXlsx: XlsxLoader = async () => xlsxLib;

/** Descarrega um .xlsx no navegador. */
export function saveXlsx(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
