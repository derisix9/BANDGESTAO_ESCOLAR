import { describe, expect, it } from 'vitest';
import shards from '../src/config/dataShards.json';
import { NAV_GROUPS } from '../src/utils/navCatalog';

const cols: any = (shards as any).collections;
const navViews = new Set(NAV_GROUPS.flatMap((g: any) => g.items.map((i: any) => i.view)));

describe('Exames, plano individual e internato: permissões', () => {
  it('planos individuais (dados sensíveis) só para admin e director', () => {
    expect(cols.individualPlans.read).toEqual(['admin', 'director']);
    expect(cols.individualPlans.write).toEqual(['admin', 'director']);
    for (const r of ['aluno', 'encarregado', 'professor', 'secretaria', 'financeiro', 'funcionario']) {
      expect(cols.individualPlans.read.includes(r)).toBe(false);
    }
  });
  it('alunos e encarregados não leem exames, inscrições nem alojamentos', () => {
    for (const c of ['nationalExams', 'examEnrollments', 'boardingRooms', 'boardingAllocations']) {
      expect(cols[c].read.includes('aluno')).toBe(false);
      expect(cols[c].read.includes('encarregado')).toBe(false);
    }
  });
  it('cada colecção nova aponta para uma secção que existe no menu', () => {
    for (const c of ['nationalExams', 'examEnrollments', 'individualPlans', 'boardingRooms', 'boardingAllocations']) {
      for (const sec of cols[c].sections) expect(navViews.has(sec)).toBe(true);
    }
  });
  it('colecções ligadas ao ano lectivo têm índice', () => {
    for (const c of ['nationalExams', 'examEnrollments', 'individualPlans', 'boardingAllocations']) {
      expect(cols[c].academicYearScoped).toBe(true);
    }
    expect(!!cols.boardingRooms.academicYearScoped).toBe(false);
  });
});
