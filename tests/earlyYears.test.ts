import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESCHOOL_AREAS, DEFAULT_PRIMARY_AREAS, buildDescriptiveReport, competencyKey, defaultAreasForGrade, isEarlyYearsGrade,
  publishBlockers, summarizeAssessment, type CompetencyLevel, type DescriptiveAssessment
} from '../src/utils/earlyYears';

describe('quem usa avaliação descritiva', () => {
  it('pré-escolar e 1.ª a 6.ª classe', () => {
    for (const g of ['Iniciação', 'Pré-Escolar', '1.ª Classe', '6.ª Classe', '3ª classe']) expect(isEarlyYearsGrade(g)).toBe(true);
    for (const g of ['7.ª Classe', '10.ª Classe', '13.ª Classe', '']) expect(isEarlyYearsGrade(g)).toBe(false);
  });
  it('escolhe as áreas certas', () => {
    expect(defaultAreasForGrade('Iniciação')).toBe(DEFAULT_PRESCHOOL_AREAS);
    expect(defaultAreasForGrade('4.ª Classe')).toBe(DEFAULT_PRIMARY_AREAS);
  });
});

function allLevels(level: CompetencyLevel) {
  const o: Record<string, CompetencyLevel> = {};
  for (const a of DEFAULT_PRIMARY_AREAS) for (const c of a.competencies) o[competencyKey(a.id, c.id)] = level;
  return o;
}

describe('resumo', () => {
  it('conta só o que foi observado', () => {
    const s = summarizeAssessment(DEFAULT_PRIMARY_AREAS, {});
    expect(s.evaluated).toBe(0);
    expect(s.average).toBeNull();
    const full = summarizeAssessment(DEFAULT_PRIMARY_AREAS, allLevels('consolidado'));
    expect(full.evaluated).toBe(full.total);
    expect(full.average).toBe(3);
  });
  it('lista o que pede apoio', () => {
    const levels = { ...allLevels('consolidado'), [competencyKey('portugues', 'leitura')]: 'iniciado' as CompetencyLevel };
    expect(summarizeAssessment(DEFAULT_PRIMARY_AREAS, levels).needsSupport).toEqual(['Lê com fluência e compreensão']);
  });
});

describe('publicar', () => {
  it('exige tudo avaliado e comentário', () => {
    expect(publishBlockers(DEFAULT_PRIMARY_AREAS, { levels: {}, strengths: '' }).length).toBe(2);
    expect(publishBlockers(DEFAULT_PRIMARY_AREAS, { levels: allLevels('superado'), strengths: 'Muito empenhado' })).toEqual([]);
  });
});

describe('relatório', () => {
  it('inclui nome, níveis e comentários', () => {
    const a: DescriptiveAssessment = {
      id: 'd', academicYear: '2026/2027', trimester: '1', studentId: 's', studentName: 'Ana', classId: 'c', className: '3.ª A',
      levels: allLevels('consolidado'), strengths: 'Curiosa', status: 'publicado', teacherName: 'Prof.ª Marta', updatedAt: ''
    };
    const txt = buildDescriptiveReport(DEFAULT_PRIMARY_AREAS, a);
    expect(txt).toContain('Ana');
    expect(txt).toContain('Consolidado');
    expect(txt).toContain('Pontos fortes: Curiosa');
  });
});
