import { describe, expect, it } from 'vitest';
import {
  IMPORT_PHASE_SIZE, buildStatusRecord, chunkPhases, lookupIdsOf, lookupIndexKey, newPublicRef, normalizeLookupId, statusSignature
} from '../src/utils/publicAdmission';

const adm: any = {
  id: 'a1', code: 'PRE-2026/2027-0001', publicRef: 'PM-ABCD2345', academicYear: '2026/2027', status: 'aprovada',
  name: 'Ana Maria', gender: 'Feminino', birthDate: '2012-05-10', biNumber: '00123LA045', desiredGrade: '7ª Classe',
  guardianName: 'José Maria', guardianPhone: '923000000', assessmentScore: 15, createdAt: '2026-01-01T00:00:00Z',
  internalNotes: 'não publicar', decisionNotes: 'privado', history: [{ text: 'privado' }],
  documents: [{ key: 'fotografias', label: 'Foto', delivered: true, attachment: { dataUrl: 'data:image/jpeg;base64,AAA', fileName: 'f.jpg', mimeType: 'image/jpeg', size: 3 } }]
};

describe('Pré-Matrícula online', () => {
  it('gera nº de pré-matrícula legível e diferente de cada vez', () => {
    const a = newPublicRef(); const b = newPublicRef();
    expect(a).toMatch(/^PM-[A-Z2-9]{8}$/);
    expect(a).not.toBe(b);
  });
  it('normaliza B.I., PM e código', () => {
    expect(normalizeLookupId(' pre-2026/2027-0001 ')).toBe('PRE202620270001');
    expect(normalizeLookupId('pm-abcd 2345')).toBe('PMABCD2345');
  });
  it('o índice depende da data de nascimento', async () => {
    const k1 = await lookupIndexKey('inst', 'PM-ABCD2345', '2012-05-10');
    expect(k1).toMatch(/^ix_[0-9a-f]{40}$/);
    expect(await lookupIndexKey('inst', 'pm abcd2345', '2012-05-10')).toBe(k1);
    expect(await lookupIndexKey('inst', 'PM-ABCD2345', '2012-05-11')).not.toBe(k1);
    expect(await lookupIndexKey('inst', 'PM-ABCD2345', '')).toBe('');
  });
  it('lista os identificadores de consulta', () => {
    expect(lookupIdsOf(adm)).toEqual(['00123LA045', 'PM-ABCD2345', 'PRE-2026/2027-0001']);
    expect(lookupIdsOf({ code: 'PRE-2026/2027-0002' } as any)).toEqual(['PRE-2026/2027-0002']);
  });
  it('o registo público leva nota, foto e matrícula, e nunca notas internas', () => {
    const r = buildStatusRecord(adm, { statusKey: 'rk_x', matriculaNumber: 'MAT-2026/2027-0001', schoolName: 'Escola' }) as any;
    expect(r.assessmentScore).toBe(15);
    expect(r.matriculaNumber).toBe('MAT-2026/2027-0001');
    expect(r.photo).toContain('data:image/');
    expect(r.internalNotes).toBeUndefined();
    expect(r.decisionNotes).toBeUndefined();
    expect(r.history).toBeUndefined();
  });
  it('a assinatura só muda quando muda o que é publicado', () => {
    const r1 = buildStatusRecord(adm, { statusKey: 'rk_x' });
    const r2 = buildStatusRecord({ ...adm, updatedAt: 'outra' }, { statusKey: 'rk_x' });
    const r3 = buildStatusRecord({ ...adm, assessmentScore: 16 }, { statusKey: 'rk_x' });
    expect(statusSignature(r1)).toBe(statusSignature(r2));
    expect(statusSignature(r1)).not.toBe(statusSignature(r3));
  });
  it('divide a importação em fases de 50', () => {
    const fases = chunkPhases(Array.from({ length: 120 }, (_, i) => i));
    expect(IMPORT_PHASE_SIZE).toBe(50);
    expect(fases.map((f) => f.length)).toEqual([50, 50, 20]);
  });
});
