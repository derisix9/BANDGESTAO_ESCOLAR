import type { SheetMatrix, XlsxLib } from '../src/utils/xlsxSafe';

/** Biblioteca de Excel falsa para os testes da lógica (sem exceljs): "escreve" as folhas como JSON e "lê" de volta. */
export const memXlsx: XlsxLib = {
  async write(sheets: SheetMatrix[]) { return new TextEncoder().encode(JSON.stringify(sheets)); },
  async read(bytes: Uint8Array | ArrayBuffer) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sheets = JSON.parse(new TextDecoder().decode(u8)) as SheetMatrix[];
    // como num Excel de verdade: célula vazia = '' (o JSON troca undefined por null)
    return sheets.map((s) => ({ name: s.name, rows: s.rows.filter((r) => r.some((c) => c !== null && c !== undefined && c !== '')).map((r) => r.map((c) => (c === null || c === undefined ? '' : c))) }));
  }
};

/** Lib de leitura falsa: cada folha já é uma matriz de linhas. */
export const fakeXlsx = (sheets: Record<string, unknown[][]>): XlsxLib => ({
  read: async () => Object.entries(sheets).map(([name, rows]) => ({ name, rows })),
  write: async () => new Uint8Array()
});
