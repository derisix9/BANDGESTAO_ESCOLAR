import { describe, it, expect } from 'vitest';
import {
  BACKUP_FORMAT, SchoolBackupApiError, backupFileName, createBackupApi, describeRestoreSummary, formatBackupSize, friendlyBackupError,
  parseBackupText, purgeLocalSchoolCache, validateBackupPayload
} from '../src/utils/schoolBackupApi';

const good = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: BACKUP_FORMAT, formatVersion: 1, institutionId: 'esc_a', schoolName: 'Escola A', exportedAt: '2026-10-11T17:00:00Z',
  records: [{ collection: 'students', id: 's1', data: {} }], docs: [{ key: 'settings', data: {} }],
  publicAdmissionRequests: [{ id: 'r1' }], archive: { payments: [{}, {}], fiscalDocuments: [] }, ...over
});
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as SchoolBackupApiError).code; } return null; };

describe('ficheiro de backup', () => {
  it('lê um ficheiro válido e resume o conteúdo', () => {
    const { info } = parseBackupText(good(), 'esc_a');
    expect(info).toMatchObject({ schoolName: 'Escola A', institutionId: 'esc_a', counts: { records: 1, docs: 1, publicAdmissionRequests: 1, payments: 2, fiscalDocuments: 0 } });
  });
  it('recusa o que não é backup, versões futuras, ficheiros incompletos e outra escola', () => {
    expect(code(() => parseBackupText('isto não é json'))).toBe('invalid-backup');
    expect(code(() => parseBackupText('{"a":1}'))).toBe('invalid-backup');
    expect(code(() => parseBackupText(good({ formatVersion: 2 })))).toBe('invalid-backup');
    expect(code(() => parseBackupText(good({ records: 'x' })))).toBe('invalid-backup');
    expect(code(() => parseBackupText(good(), 'esc_b'))).toBe('wrong-school');
    expect(code(() => parseBackupText(good()))).toBeNull();
  });
  it('nome do ficheiro: sem acentos nem espaços, com data e etiqueta', () => {
    const d = new Date(2026, 9, 11, 18, 5);
    expect(backupFileName('Colégio São José nº 3', d)).toBe('bandmed_colegio-sao-jose-n-3_2026-10-11_1805.json');
    expect(backupFileName('', d, 'antes-do-restauro')).toBe('bandmed_escola_antes-do-restauro_2026-10-11_1805.json');
  });
});

describe('nome com extensão e validação de objecto', () => {
  it('extensão por tipo', () => {
    expect(backupFileName('Escola', new Date(2026, 9, 11, 18, 5), undefined, '.xlsx')).toBe('bandmed_escola_2026-10-11_1805.xlsx');
    expect(validateBackupPayload(JSON.parse(good()), 'esc_a').info.counts.records).toBe(1);
  });
});

describe('chamadas ao Supabase', () => {
  it('exporta e restaura pelas funções SQL, sem enviar a escola', async () => {
    const calls: Array<[string, any]> = [];
    const api = createBackupApi(async (fn, args) => {
      calls.push([fn, args]);
      return fn === 'school_backup_export' ? { data: JSON.parse(good()), error: null } : { data: { records: 1, docs: 1 }, error: null };
    });
    const r = await api.exportBackup();
    expect(r.info.schoolName).toBe('Escola A');
    expect(JSON.parse(r.text).format).toBe(BACKUP_FORMAT);
    await api.restoreBackup(r.payload, 'RESTAURAR');
    expect(calls[0]).toEqual(['school_backup_export', undefined]);
    expect(calls[1][0]).toBe('school_backup_restore');
    expect(Object.keys(calls[1][1]).sort()).toEqual(['p_confirm', 'p_payload']);
  });
  it('erros do Postgres viram mensagens em português', async () => {
    const api = createBackupApi(async () => ({ data: null, error: { message: 'wrong-school: este backup pertence a outra escola', code: '42501' } }));
    const err = await api.restoreBackup({}, 'RESTAURAR').catch((e) => e);
    expect(friendlyBackupError(err)).toMatch(/outra escola/);
    expect(friendlyBackupError({ message: 'x', code: '42501' })).toMatch(/administrador/);
    expect(friendlyBackupError({ message: 'canceling statement due to statement timeout', code: '57014' })).toMatch(/demorou/);
    expect(friendlyBackupError({ message: 'Could not find the function', code: 'PGRST202' })).toMatch(/0012/);
    expect(friendlyBackupError({ message: 'busy: já há um restauro', code: '55P03' })).toMatch(/a decorrer/);
  });
  it('resumo e tamanhos', () => {
    expect(describeRestoreSummary({ records: 3, recordsIgnored: 1, invoicesRecreated: 1, invoicesKept: 2, docs: 2, publicAdmissionRequests: 0 }))
      .toMatch(/3 registos.*recriadas.*ficaram.*ignorados/);
    expect(formatBackupSize(2048)).toBe('2.0 KB');
  });
});

describe('cache local', () => {
  it('purgeLocalSchoolCache apaga as chaves da escola e esvazia o IndexedDB', async () => {
    const removed: string[] = []; let cleared = false;
    const store = { clear: () => { cleared = true; } };
    const tx: any = { objectStore: () => store, oncomplete: null };
    const db = { objectStoreNames: { contains: () => true }, transaction: () => { setTimeout(() => tx.oncomplete?.(), 0); return tx; }, close: () => undefined };
    const idb = { open: () => { const r: any = { result: db }; setTimeout(() => r.onsuccess?.(), 0); return r; } };
    await purgeLocalSchoolCache('esc_a', { removeItem: (k: string) => { removed.push(k); } }, idb as any);
    expect(removed).toEqual(['escola_inst_esc_a', 'escola_access_map_esc_a']); expect(cleared).toBe(true);
    removed.length = 0; await purgeLocalSchoolCache('inst_bandmed', { removeItem: (k: string) => { removed.push(k); } }, null);
    expect(removed).toContain('bandmed_escola_db_v1');
  });
});
