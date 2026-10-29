import { describe, it, expect } from 'vitest';
import { assembleStudio } from '../src/studio/assemble';
import { initialState } from '../src/studio/state';
import { sheetGeometry } from '../src/studio/ui/CardSheets';
import { buildCardsPptx } from '../src/studio/exportPptx';

const db: any = {
  settings: { schoolName: 'Escola Teste', currentAcademicYear: '2025/2026' },
  classes: [{ id: 'c1', name: '7.ª A' }],
  students: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Aluno ${i}`, classId: 'c1', grade: '7.ª Classe', className: '7.ª A', procNumber: `P${i}`, gender: 'M' })),
  academicDocuments: []
};

describe('estúdio · turma inteira', () => {
  it('gera um cartão por aluno e 8 por folha A4', async () => {
    const s = { ...initialState('2025/2026'), tab: 'estudante' as const, scope: 'turma' as const, classId: 'c1' };
    const v = assembleStudio(db, s);
    expect(v.isBatch).toBe(true);
    expect(v.cardItems.length).toBe(10);
    expect(v.blockers).toEqual([]);
    const g = sheetGeometry(v.cardItems[0].front);
    expect(g.per).toBe(8);
    const bytes = await buildCardsPptx({ items: v.cardItems, sides: 'ambos', images: {}, photos: v.photos });
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it('pede a turma quando falta', () => {
    const v = assembleStudio(db, { ...initialState('2025/2026'), tab: 'estudante', scope: 'turma' });
    expect(v.blockers[0]).toMatch(/turma/i);
  });
});
