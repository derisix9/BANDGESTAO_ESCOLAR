import { describe, it, expect } from 'vitest';
import { payloadFromXlsx } from '../src/utils/backupFormats';
import { readBackupSources, analyzeBackupSources } from '../src/utils/backupImport';
import { zipBackupFile, zipFileName } from '../src/utils/backupCompress';
import { BACKUP_FORMAT } from '../src/utils/schoolBackupApi';
import { fakeXlsx } from './xlsxFake';

const resumo = [['campo', 'valor'], ['Escola', 'Escola Teste'], ['ID da escola', 'inst_teste'], ['Exportado em', '2026-10-23T06:00:00Z']];

describe('Excel legível (o do ZIP de "antes de eliminar")', () => {
  it('reconstrói registos, listas/objectos em JSON e ignora células vazias', async () => {
    const p = await payloadFromXlsx(fakeXlsx({
      Resumo: resumo,
      students: [['id', 'academic_year', 'version', 'created_at', 'updated_at', 'name', 'age', 'active', 'tags', 'phone', 'extra'],
        ['s1', '', 3, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'Ana', 12, true, '["a","b"]', '923000111', '']],
      documentos: [['key', 'updated_at', 'data', 'schoolName'], ['settings', '2026-01-01', '', 'Escola Teste'], ['events', '2026-01-01', '[{"x":1}]', '']],
      acessos: [['info'], ['sem dados']]
    }), new Uint8Array(1));
    expect(p.format).toBe(BACKUP_FORMAT);
    expect(p.institutionId).toBe('inst_teste');
    expect(p.records).toEqual([{ collection: 'students', id: 's1', academic_year: null, ord: null, version: 3, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      data: { name: 'Ana', age: 12, active: true, tags: ['a', 'b'], phone: '923000111' } }]);
    expect(p.docs).toEqual([{ key: 'settings', updated_at: '2026-01-01', data: { schoolName: 'Escola Teste' } }, { key: 'events', updated_at: '2026-01-01', data: [{ x: 1 }] }]);
    expect(p.__notes.length).toBeGreaterThan(0);
  });

  it('não restaura valores cortados pelo Excel: deixa o campo de fora e avisa', async () => {
    const p = await payloadFromXlsx(fakeXlsx({
      Resumo: resumo,
      students: [['id', 'version', 'name', 'photo'], ['s1', 1, 'Ana', 'data:image/png;base64,AAAA…[cortado; o valor completo está no JSON]']]
    }), new Uint8Array(1));
    expect(p.records[0].data).toEqual({ name: 'Ana' });
    expect(p.__notes[0]).toMatch(/cortados/);
  });

  it('sem a folha Resumo continua a recusar (não é um backup do BandMed)', async () => {
    await expect(payloadFromXlsx(fakeXlsx({ students: [['id'], ['1']] }), new Uint8Array(1))).rejects.toThrow();
  });

  it('o aviso vai para a pré-visualização e não segue para o restauro', async () => {
    const p = await payloadFromXlsx(fakeXlsx({ Resumo: resumo, students: [['id', 'version', 'name'], ['s1', 1, 'Ana']] }), new Uint8Array(1));
    const a = analyzeBackupSources([{ name: 'backup.xlsx', size: 1, format: 'xlsx', payload: p }], 'inst_teste');
    expect(a.errors).toBe(0);
    expect(a.globalIssues.some((i) => i.severity === 'aviso')).toBe(true);
    expect('__notes' in a.payload).toBe(false);
  });
});

describe('ZIP', () => {
  it('zipFileName troca a extensão por .zip', () => {
    expect(zipFileName('bandmed_x_antes-do-restauro_2026-10-23_1010.json')).toBe('bandmed_x_antes-do-restauro_2026-10-23_1010.zip');
    expect(zipFileName('a.b.xlsx')).toBe('a.b.zip');
  });
  it('zipBackupFile guarda o ficheiro com o nome original e comprime (DEFLATE)', async () => {
    const seen: any = {};
    class FakeZip { file(n: string, d: any) { seen.name = n; seen.data = d; } async generateAsync(o: any) { seen.opts = o; return new Uint8Array([80, 75, 3, 4]); } }
    const out = await zipBackupFile('backup.json', '{"a":1}', async () => FakeZip as any);
    expect(out.length).toBe(4);
    expect(seen.name).toBe('backup.json');
    expect(seen.opts.compression).toBe('DEFLATE');
  });
  it('zip que falha a gerar → erro (o ecrã guarda então o ficheiro simples)', async () => {
    class Bad { file() {} async generateAsync() { return new Uint8Array(0); } }
    await expect(zipBackupFile('x.json', 'x', async () => Bad as any)).rejects.toThrow();
  });
  it('ao carregar um ZIP com backup.json + backup.xlsx lê só o JSON (o Excel é só consulta)', async () => {
    const json = JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, institutionId: 'inst_teste', schoolName: 'E', exportedAt: '2026-10-23T06:00:00Z', records: [], docs: [] });
    const bytes = new TextEncoder().encode(json).buffer;
    const entry = (name: string, b: ArrayBuffer) => ({ name, dir: false, async: async () => b });
    const loadZip = async () => ({ loadAsync: async () => ({ files: { 'backup.json': entry('backup.json', bytes as ArrayBuffer), 'backup.xlsx': entry('backup.xlsx', new ArrayBuffer(8)), 'LEIA-ME.txt': entry('LEIA-ME.txt', new ArrayBuffer(1)) } }) });
    const out = await readBackupSources([{ name: 'b.zip', size: 10, text: async () => '', arrayBuffer: async () => new ArrayBuffer(1) }], undefined, loadZip as any);
    expect(out.map((o) => o.name)).toEqual(['backup.json']);
    expect(out[0].error).toBeUndefined();
  });
});
