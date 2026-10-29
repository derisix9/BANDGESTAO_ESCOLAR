import { describe, it, expect } from 'vitest';
import { BACKUP_FORMAT } from '../src/utils/schoolBackupApi';
import { serializeBackup, toXml, payloadFromXml } from '../src/utils/backupFormats';
import { analyzeBackupSources, buildTablePayload, buildTablesPayload, isTableLoadable, readBackupSources, type SourceFile } from '../src/utils/backupImport';

const rec = (collection: string, id: string, data: any, extra: any = {}) => ({ collection, id, academic_year: '2026/2027', ord: null, version: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', data, ...extra });
const backup = (records: any[], extra: any = {}) => ({
  format: BACKUP_FORMAT, formatVersion: 1, institutionId: 'esc_a', schoolName: 'Escola A', exportedAt: '2026-10-11T17:00:00Z',
  records, docs: [{ key: 'settings', updated_at: null, data: { a: 1 } }], publicAdmissionConfig: null, publicAdmissionRequests: [],
  archive: { payments: [{ id: 'p1' }], fiscalDocuments: [], fiscalSeries: [] }, ...extra
});
const src = (name: string, payload: any): SourceFile => ({ name, size: 10, format: 'json', payload });

describe('XML', () => {
  it('ida e volta', () => {
    const p = backup([rec('students', 's1', { name: 'Ana & <Bé>', n: [1, null] })]);
    const back = payloadFromXml(toXml(p)); delete back.counts;
    expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(p)));
  });
  it('recusa DOCTYPE e estrutura estranha', () => {
    expect(() => payloadFromXml('<!DOCTYPE a><a/>')).toThrow();
    expect(() => payloadFromXml('<bandmed-backup format="bandmed-school-backup"><x/></bandmed-backup>')).toThrow();
  });
  it('serializeBackup xml', async () => { expect((await serializeBackup(backup([]), 'xml')).ext).toBe('.xml'); });
});

describe('pré-visualização', () => {
  const students = [rec('students', 's1', { name: 'Ana', status: 'active' }), rec('students', 's2', { name: 'Rui', status: 'xx' })];
  const invoices = [
    rec('invoices', 'i1', { studentId: 's1', studentName: 'Ana', baseAmountKz: 100, lateFeeKz: 10, totalAmountKz: 110, status: 'pago' }),
    rec('invoices', 'i2', { studentId: 's9', studentName: 'Zé', baseAmountKz: 100, lateFeeKz: 0, totalAmountKz: 50, status: 'pago' })
  ];
  it('uma tabela por colecção, com contagem e anomalias', () => {
    const a = analyzeBackupSources([src('a.json', backup([...students, ...invoices]))], 'esc_a');
    expect(a.tables.map((t) => `${t.label}:${t.count}`)).toEqual(['invoices:2', 'students:2', 'documentos:1', 'pagamentos:1']);
    const inv = a.tables.find((t) => t.label === 'invoices')!;
    expect(inv.issues.some((i) => /não existe na tabela students/.test(i.message))).toBe(true);
    expect(inv.issues.some((i) => /não corresponde ao valor base/.test(i.message))).toBe(true);
    expect(a.tables.find((t) => t.label === 'students')!.issues.some((i) => /Estado do aluno/.test(i.message))).toBe(true);
    expect(a.tables.find((t) => t.label === 'pagamentos')!.restorable).toBe(false);
  });
  it('erros de linha bloqueiam, a não ser que se salte as linhas', () => {
    const a = analyzeBackupSources([src('a.json', backup([rec('students', 's1', { name: 'Ana' }), rec('students', '', 'texto' as any)]))]);
    const t = a.tables.find((x) => x.label === 'students')!;
    expect(t.errorRows).toBe(1);
    const cur = backup([rec('students', 'old', { name: 'Velho' }), rec('classes', 'c1', { name: '1A' })]);
    expect(() => buildTablePayload(cur, a, t.key)).toThrow();
    const r = buildTablePayload(cur, a, t.key, true);
    expect(r.loaded).toBe(1); expect(r.skipped).toBe(1);
    expect(r.payload.records.map((x: any) => `${x.collection}/${x.id}`).sort()).toEqual(['classes/c1', 'students/s1']);
  });
  it('carrega várias tabelas de uma vez e deixa as outras intactas', () => {
    const file = backup([rec('students', 's1', { name: 'Ana' }), rec('classes', 'c1', { name: '1A' }), rec('courses', 'k1', { name: 'Med' }), rec('teachers', 't1', { name: 'Prof' })]);
    const a = analyzeBackupSources([src('a.json', file)], 'esc_a');
    const key = (l: string) => a.tables.find((t) => t.label === l)!.key;
    const cur = backup([rec('students', 'old', { name: 'Velho' }), rec('classes', 'oldc', { name: 'Velha' }), rec('courses', 'oldk', { name: 'V' }), rec('teachers', 'oldt', { name: 'P' })]);
    const r = buildTablesPayload(cur, a, [key('students'), key('classes'), key('classes')]);
    expect(r.loaded).toBe(2); expect(r.tables.map((t) => t.label)).toEqual(['students', 'classes']);
    expect(r.payload.records.map((x: any) => `${x.collection}/${x.id}`).sort()).toEqual(['classes/c1', 'courses/oldk', 'students/s1', 'teachers/oldt']);
    expect(() => buildTablesPayload(cur, a, [])).toThrow();
    // "todas": todas as tabelas carregáveis
    const all = buildTablesPayload(cur, a, a.tables.filter(isTableLoadable).map((t) => t.key));
    expect(all.payload.records.map((x: any) => x.id).sort()).toEqual(['c1', 'k1', 's1', 't1']);
    // pagamentos (só consulta) nunca entram
    expect(() => buildTablesPayload(cur, a, ['ref:payments'])).toThrow();
    expect(isTableLoadable(a.tables.find((t) => t.key === 'ref:payments')!)).toBe(false);
  });
  it('junta vários ficheiros: o mais recente ganha e avisa', () => {
    const a1 = backup([rec('students', 's1', { name: 'Ana' })]);
    const a2 = backup([rec('students', 's1', { name: 'Ana Maria' }, { updated_at: '2026-05-01T00:00:00Z' }), rec('classes', 'c1', { name: '1A' })], { exportedAt: '2026-10-12T00:00:00Z' });
    const a = analyzeBackupSources([src('a1.json', a1), src('a2.xml', a2)], 'esc_a');
    expect(a.tables.map((t) => t.label)).toContain('classes');
    const st = a.tables.find((t) => t.label === 'students')!;
    expect(a.payload.records.find((r: any) => r.id === 's1').data.name).toBe('Ana Maria');
    expect(st.issues.some((i) => /Repetido/.test(i.message))).toBe(true);
  });
  it('escola diferente e ficheiros inválidos', () => {
    const a = analyzeBackupSources([src('a.json', backup([])), src('b.json', { ...backup([]), institutionId: 'outra' }), { name: 'x.txt', size: 1, format: 'json', error: 'Tipo não suportado' }], 'esc_a');
    expect(a.sources.filter((s) => s.error).length).toBe(2);
    expect(a.globalIssues.every((i) => i.severity === 'aviso')).toBe(true);
    expect(analyzeBackupSources([{ name: 'x.txt', size: 1, format: 'json', error: 'x' }]).errors).toBe(1);
  });
  it('lê vários ficheiros e um ZIP', async () => {
    const mk = (name: string, text: string) => ({ name, size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer });
    const j = JSON.stringify(backup([rec('students', 's1', { name: 'Ana' })]));
    const fakeZip = { loadAsync: async () => ({ files: {
      'pasta/backup.json': { name: 'pasta/backup.json', dir: false, async: async () => new TextEncoder().encode(j).buffer },
      'LEIAME.txt': { name: 'LEIAME.txt', dir: false, async: async () => new ArrayBuffer(1) }
    } }) };
    const out = await readBackupSources([mk('x.xml', toXml(backup([]))), mk('z.zip', 'zip')], undefined, async () => fakeZip as any);
    expect(out.map((s) => s.name + (s.error ? '!' : ''))).toEqual(['x.xml', 'backup.json']);
    expect(out[1].origin).toBe('z.zip');
  });
});
