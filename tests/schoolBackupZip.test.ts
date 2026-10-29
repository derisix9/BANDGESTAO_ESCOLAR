import { describe, it, expect } from 'vitest';
import { normalizeBackupForZip, backupZipName } from '../src/utils/schoolBackupZip';

describe('backup para eliminação (ZIP)', () => {
  it('lê o formato actual (bandmed-school-backup v1 + userAccess)', () => {
    const n = normalizeBackupForZip({
      format: 'bandmed-school-backup', formatVersion: 1, institutionId: 'esc_a', schoolName: 'Escola A', exportedAt: '2026-10-13T00:30:00Z',
      counts: { records: 2 }, records: [{ collection: 'students', id: 's1', data: {} }, { collection: 'classes', id: 'c1', data: {} }],
      docs: [{ key: 'settings', data: {} }], userAccess: [{ user_id: 'u1', sections: {} }],
      archive: { payments: [{ id: 'p1' }], fiscalDocuments: [{ id: 'f1' }, { id: 'f2' }] }
    });
    expect(n).toMatchObject({ schoolName: 'Escola A', institutionId: 'esc_a', exportedAt: '2026-10-13T00:30:00Z' });
    expect(n.records).toHaveLength(2);
    expect(n.docs).toHaveLength(1);
    expect(n.userAccess).toHaveLength(1);
    expect(n.payments).toHaveLength(1);
    expect(n.fiscalDocuments).toHaveLength(2);
  });
  it('continua a ler o formato antigo (app.export_school)', () => {
    const n = normalizeBackupForZip({
      institution_name: 'Escola B', institution_id: 'esc_b', exported_at: 'x',
      data: { records: [{ id: 'r' }], institution_docs: [{ key: 'k' }], user_access: [{ user_id: 'u' }] },
      reference: { payments: [{ id: 'p' }], fiscal_documents: [{ id: 'f' }] }
    });
    expect(n.schoolName).toBe('Escola B');
    expect([n.records.length, n.docs.length, n.userAccess.length, n.payments.length, n.fiscalDocuments.length]).toEqual([1, 1, 1, 1, 1]);
  });
  it('não rebenta com um payload vazio e o nome do ZIP é seguro', () => {
    expect(normalizeBackupForZip(null).records).toEqual([]);
    expect(backupZipName('ESCOLA SECUNDÁRIA BEMDIZER', new Date(2026, 9, 13, 0, 30))).toBe('bandmed_escola-secundaria-bemdizer_antes-de-eliminar_2026-10-13_0030.zip');
  });
});
