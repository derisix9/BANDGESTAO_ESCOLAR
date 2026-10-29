import { describe, it, expect } from 'vitest';
import { assembleStudio } from '../src/studio/assemble';
import { initialState } from '../src/studio/state';
import { CARD_MODELS } from '../src/studio/cards';
import { buildPublicLink, parsePublicLink } from '../src/utils/publicLink';

const db: any = {
  settings: { schoolName: 'Escola Teste', currentAcademicYear: '2025/2026' },
  classes: [{ id: 'c1', name: '7.ª A' }],
  students: [{ id: 's1', name: 'Aluno Um', classId: 'c1', grade: '7.ª Classe', className: '7.ª A', procNumber: 'P1', gender: 'M' }],
  invoices: [{ id: 'i1', studentId: 's1', academicYear: '2025/2026', period: 'Outubro', status: 'pago', receiptNumber: 'REC000123' }],
  teachers: [{ id: 't1', name: 'Prof Um', agentNumber: 'A1' }],
  academicDocuments: []
};

describe('estúdio · modelos HTML, posição e talão', () => {
  it('tem os 19 modelos novos de estudante', () => {
    expect(CARD_MODELS.filter((m) => m.id.startsWith('html-')).length).toBe(19);
  });
  for (const o of ['h', 'v'] as const) for (const back of ['padrao', 'talao'] as const) {
    it(`todos os modelos de estudante geram frente/verso (${o}, verso ${back})`, () => {
      for (const m of CARD_MODELS.filter((x) => x.kind === 'estudante')) {
        const s = { ...initialState('2025/2026'), tab: 'estudante' as const, modelId: m.id, studentId: 's1', orientation: o, backSide: back } as any;
        const v = assembleStudio(db, s);
        expect(v.cardItems.length, m.id).toBe(1);
        const f = v.cardItems[0].front, b = v.cardItems[0].back;
        expect(f.prims.length).toBeGreaterThan(0);
        expect(b.prims.length).toBeGreaterThan(0);
        if (back === 'talao') expect(JSON.stringify(b)).toMatch(/RUPE|PROPINA/i);
        expect(f.w < f.h, `${m.id} ${o}`).toBe(o === 'v' || (m.orientation === 'v' && !m.alt));
      }
    });
  }
  it('QR é link público sem login', () => {
    const l = buildPublicLink('student', 's1', { origin: 'https://x.ao/', inst: 'inst_a' });
    expect(l).toContain('public_verify=true');
    expect(parsePublicLink(l.split('?')[1]).id).toBe('s1');
    const v = assembleStudio(db, { ...initialState('2025/2026'), tab: 'estudante', studentId: 's1' } as any);
    expect(JSON.stringify(v.cardItems[0].back)).toContain('public_verify');
  });
});
