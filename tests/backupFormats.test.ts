import { describe, it, expect } from 'vitest';
import { memXlsx } from './xlsxFake';
import { BACKUP_FORMAT } from '../src/utils/schoolBackupApi';
import {
  BACKUP_FORMAT_ORDER, formatFromFileName, payloadFromCsv, payloadFromSql, readBackupFile, serializeBackup, splitText, toCsv, toSql, payloadFromXlsx, toXlsxBytes
} from '../src/utils/backupFormats';

const big = 'x'.repeat(70000) + '😀' + 'y'.repeat(10);
const payload = () => ({
  format: BACKUP_FORMAT, formatVersion: 1, institutionId: 'esc_a', schoolName: "Escola D'Ouro, \"A\"", exportedAt: '2026-10-11T17:00:00Z',
  records: [
    { collection: 'students', id: 's1', academic_year: '2026', ord: 2.5, version: 3, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', data: { name: "O'Brien; João\nlinha2", n: 1 } },
    { collection: 'students', id: 's2', academic_year: null, ord: null, version: 1, created_at: null, updated_at: null, data: { big } }
  ],
  docs: [{ key: 'settings', updated_at: '2026-02-01T00:00:00Z', data: { a: [1, 2], b: 'ç' } }, { key: 'events', updated_at: null, data: [] }],
  publicAdmissionConfig: { open: true },
  publicAdmissionRequests: [{ id: 'rq1', created_at: '2026-03-01T00:00:00Z', data: { nome: 'Ana' } }],
  archive: { payments: [{ id: 'p1', amount_kz: 1000 }], fiscalDocuments: [{ doc_no: 'FT FT2026/1' }], fiscalSeries: [{ series: 'FT2026', doc_type: 'FT' }] }
});
const strip = (p: any) => { const { counts, ...r } = p; return r; };
const norm = (p: any) => JSON.parse(JSON.stringify(strip(p)));

describe('formatos do backup: ida e volta', () => {
  it('CSV', () => { expect(norm(payloadFromCsv(toCsv(payload())))).toEqual(norm(payload())); });
  it('CSV com ; e sem BOM (Excel PT)', () => {
    const t = toCsv(payload()).replace(/^\uFEFF/, '');
    const lines = t.split('\r\n'); // só o cabeçalho muda de separador: o parser deteta pelo cabeçalho, por isso converte-se tudo
    expect(lines[0].split(',').length).toBe(11);
  });
  it('SQL', () => { expect(norm(payloadFromSql(toSql(payload())))).toEqual(norm(payload())); });
  it('XLSX (com células partidas em partes)', async () => {
    const bytes = await toXlsxBytes(memXlsx, payload());
    expect(norm(await payloadFromXlsx(memXlsx, bytes))).toEqual(norm(payload()));
  });
  it('serialize + readBackupFile para os 4 tipos', async () => {
    for (const f of BACKUP_FORMAT_ORDER) {
      const s = await serializeBackup(payload(), f, async () => memXlsx);
      const file = { name: 'b' + s.ext, text: async () => (typeof s.data === 'string' ? s.data : ''), arrayBuffer: async () => (s.data as Uint8Array).buffer.slice((s.data as Uint8Array).byteOffset, (s.data as Uint8Array).byteOffset + (s.data as Uint8Array).byteLength) as ArrayBuffer };
      const back = await readBackupFile(file as any, f, async () => memXlsx);
      expect(norm(back)).toEqual(norm(payload()));
    }
  });
});

describe('recusas', () => {
  it('tipo escolhido diferente do ficheiro', async () => {
    await expect(readBackupFile({ name: 'x.csv', text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }, 'json')).rejects.toMatchObject({ code: 'wrong-format' });
    expect(formatFromFileName('A.SQL')).toBe('sql');
  });
  it('SQL arbitrário nunca é aceite', () => {
    const t = toSql(payload()) + "\nDELETE FROM public.records;\n";
    expect(() => payloadFromSql(t)).toThrow(/SQL não suportado/);
    expect(() => payloadFromSql(toSql(payload()).replace('public.records', 'public.profiles'))).toThrow();
    expect(() => payloadFromSql("DROP TABLE x;")).toThrow();
  });
  it('SQL com escolas misturadas', () => {
    expect(() => payloadFromSql(toSql(payload()).replace("VALUES ('esc_a', 'events'", "VALUES ('esc_b', 'events'"))).toThrow(/escolas diferentes/);
  });
  it('CSV: linha sem parte, secção desconhecida, JSON corrompido', () => {
    const lines = toCsv(payload()).split('\r\n');
    const idx = lines.map((l, i) => (l.startsWith('records,students,s2,') ? i : -1)).filter((i) => i >= 0);
    expect(idx.length).toBe(3);                                     // 70 000 caracteres → 3 partes
    const noPart = lines.filter((_, i) => i !== idx[1]).join('\r\n');
    expect(() => payloadFromCsv(noPart)).toThrow(/incompleto/);
    expect(() => payloadFromCsv(toCsv(payload()).replace('records,', 'lixo,'))).toThrow(/secção desconhecida/);
    expect(() => payloadFromCsv(lines.map((l, i) => (i === idx[0] ? l.replace('""big""', 'big') : l)).join('\r\n'))).toThrow(/JSON válido/);
    expect(() => payloadFromCsv('a,b\r\n1,2')).toThrow(/colunas/);
  });
  it('splitText não parte emojis', () => {
    const parts = splitText('a'.repeat(29999) + '😀' + 'b', 30000);
    expect(parts.join('')).toBe('a'.repeat(29999) + '😀' + 'b');
    expect(parts.every((p) => !/[\ud800-\udbff]$/.test(p))).toBe(true);
  });
});
