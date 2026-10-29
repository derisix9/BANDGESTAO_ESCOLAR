import { describe, expect, it } from 'vitest';
import { XLSX_LIMITS, XlsxLimitError, plainCellValue, safeSheetName, xlsxLib } from '../src/utils/xlsxSafe';
import { readBankStatementFile } from '../src/utils/bankStatementImport';

describe('plainCellValue (só valores simples)', () => {
  it('texto, número, booleano e data passam; vazio vira ""', () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    expect(plainCellValue('a')).toBe('a');
    expect(plainCellValue(3)).toBe(3);
    expect(plainCellValue(true)).toBe(true);
    expect(plainCellValue(d)).toBe(d);
    expect(plainCellValue(null)).toBe('');
    expect(plainCellValue(undefined)).toBe('');
  });
  it('fórmula → último resultado; texto rico → texto; hiperligação → texto; erro → ""', () => {
    expect(plainCellValue({ formula: '1+1', result: 2 } as any)).toBe(2);
    expect(plainCellValue({ formula: 'A1' } as any)).toBe('');
    expect(plainCellValue({ richText: [{ text: 'Ol' }, { text: 'á' }] } as any)).toBe('Olá');
    expect(plainCellValue({ text: 'site', hyperlink: 'https://x.ao' } as any)).toBe('site');
    expect(plainCellValue({ error: '#N/A' } as any)).toBe('');
    expect(plainCellValue({ formula: 'x', result: { error: '#REF!' } } as any)).toBe('');
  });
});

describe('safeSheetName', () => {
  it('tira caracteres proibidos, corta a 31 e não repete nomes', () => {
    const used = new Set<string>();
    expect(safeSheetName('a/b:c*d?[e]', used)).toBe('a_b_c_d__e_');
    expect(safeSheetName('x'.repeat(40), used)).toHaveLength(31);
    expect(safeSheetName('Pauta', used)).toBe('Pauta');
    expect(safeSheetName('pauta', used)).toBe('pauta_2');
    expect(safeSheetName('', used)).toBe('Folha');
  });
});

describe('exceljs: ida e volta e limites', () => {
  it('escreve e lê texto, números, booleanos e datas', async () => {
    const d = new Date(Date.UTC(2026, 0, 15));
    const bytes = await xlsxLib.write([{ name: 'A', rows: [['t', 'n', 'b', 'd'], ['x', 1.5, true, d]], colWidths: [10, 10] }]);
    const sheets = await xlsxLib.read(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['A']);
    expect(sheets[0].rows[0]).toEqual(['t', 'n', 'b', 'd']);
    expect(sheets[0].rows[1].slice(0, 3)).toEqual(['x', 1.5, true]);
    expect((sheets[0].rows[1][3] as Date).getTime()).toBe(d.getTime());
  });

  it('texto que começa por "=" continua a ser texto (sem injecção de fórmulas)', async () => {
    const bytes = await xlsxLib.write([{ name: 'A', rows: [['=1+1', '+cmd', '@x']] }]);
    const [s] = await xlsxLib.read(bytes);
    expect(s.rows[0]).toEqual(['=1+1', '+cmd', '@x']);
  });

  it('NaN/Infinity/undefined não estragam o ficheiro', async () => {
    const bytes = await xlsxLib.write([{ name: 'A', rows: [['a', NaN, Infinity, undefined, 'b']] }]);
    const [s] = await xlsxLib.read(bytes);
    expect(s.rows[0]).toEqual(['a', '', '', '', 'b']);
  });

  it('fórmulas dão o último resultado; células fundidas só têm valor na de cima à esquerda', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('F');
    ws.getCell('A1').value = 'Título';
    ws.mergeCells('A1:C1');
    ws.getCell('A2').value = { formula: '1+1', result: 2 } as any;
    const [s] = await xlsxLib.read(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer));
    expect(s.rows[0]).toEqual(['Título', '', '']);
    expect(s.rows[1][0]).toBe(2);
  });

  it('linhas em branco: ignoradas por omissão, mantidas com skipBlankRows:false', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('B');
    ws.getCell('A1').value = 'a';
    ws.getCell('A3').value = 'b';
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    expect((await xlsxLib.read(bytes))[0].rows).toEqual([['a'], ['b']]);
    expect((await xlsxLib.read(bytes, { skipBlankRows: false }))[0].rows).toEqual([['a'], [''], ['b']]);
  });

  it('recusa ficheiros acima do tamanho máximo e lixo que não é .xlsx', async () => {
    await expect(xlsxLib.read(new Uint8Array(100), { maxBytes: 10 })).rejects.toBeInstanceOf(XlsxLimitError);
    await expect(xlsxLib.read(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
    expect(XLSX_LIMITS.maxBytes).toBeGreaterThan(1024 * 1024);
  });

  it('recusa folhas gigantes', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('G').getCell(`A${XLSX_LIMITS.maxRows + 1}`).value = 'x';
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    await expect(xlsxLib.read(bytes)).rejects.toBeInstanceOf(XlsxLimitError);
  });
});

describe('extracto bancário em Excel', () => {
  const asFile = (name: string, bytes: Uint8Array) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => '' }) as unknown as File;

  it('lê um .xlsx', async () => {
    const bytes = await xlsxLib.write([{ name: 'Extrato', rows: [['Data', 'Descrição', 'Valor', 'Ref'], [46300, 'Excel', 20000, 'R1']] }]);
    const r = await readBankStatementFile(asFile('extrato.xlsx', bytes));
    expect(r.format).toBe('planilha');
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amount).toBe(20000);
  });

  it('.xls e .ods já não são lidos: mensagem a pedir .xlsx ou CSV', async () => {
    for (const n of ['a.xls', 'a.ods']) {
      const r = await readBankStatementFile(asFile(n, new Uint8Array(4)));
      expect(r.lines).toEqual([]);
      expect(r.errors[0]).toMatch(/\.xlsx ou CSV/);
    }
  });

  it('ficheiro corrompido → erro simpático, sem excepção', async () => {
    const r = await readBankStatementFile(asFile('x.xlsx', new Uint8Array([1, 2, 3])));
    expect(r.lines).toEqual([]);
    expect(r.errors[0]).toMatch(/Não foi possível abrir/);
  });
});
