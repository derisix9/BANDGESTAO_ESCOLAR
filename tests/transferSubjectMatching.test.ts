import { describe, expect, it } from 'vitest';
import {
  applySubjectMapping, canonSubject, matchSubjectsToDestination, needsManualEquivalence, transferredGradesToRecords
} from '../src/utils/transfers';
import type { SubjectEquivalence } from '../src/types/processos';

const dest = [
  { id: 's1', name: 'Língua Portuguesa', code: 'LP' },
  { id: 's2', name: 'Matemática', code: 'MAT' },
  { id: 's3', name: 'Educação Física', code: 'EF' },
  { id: 's4', name: 'Ciências da Natureza', code: 'CN' }
];

describe('deteção automática de disciplinas iguais', () => {
  it('ignora maiúsculas, acentos, espaços e pontuação', () => {
    const m = matchSubjectsToDestination(['LINGUA PORTUGUESA', 'lingua  portuguesa', 'Língua Portuguesa.'], dest);
    expect(m.every((x) => x.kind === 'exact' && x.dest?.id === 's1')).toBe(true);
  });
  it('ignora "de/da/e" e plurais simples', () => {
    expect(canonSubject('Educação  Física')).toBe(canonSubject('EDUCACAO FISICA'));
    const m = matchSubjectsToDestination(['Ciência da Natureza', 'Educacao de Fisica'], dest);
    expect(m.map((x) => x.kind)).toEqual(['exact', 'exact']);
  });
  it('reconhece pelo código quando o nome de origem é uma sigla', () => {
    expect(matchSubjectsToDestination(['MAT'], dest)[0]).toMatchObject({ kind: 'exact', dest: { id: 's2' } });
  });
  it('aplica regras de equivalência já guardadas', () => {
    const rules = [{ id: 'e1', originSubject: 'Informática Aplicada', destSubject: 'Matemática', destSubjectId: 's2', createdBy: 'x', createdAt: '' }] as SubjectEquivalence[];
    expect(matchSubjectsToDestination(['informatica aplicada'], dest, rules)[0]).toMatchObject({ kind: 'rule', dest: { id: 's2' } });
  });
  it('só sugere (não aplica) nomes parecidos e deixa os restantes para decisão manual', () => {
    const m = matchSubjectsToDestination(['Lingua Portuguesa I', 'Filosofia'], dest);
    expect(m[0].kind).toBe('suggested');
    expect(m[0].dest?.id).toBe('s1');
    expect(m[1].kind).toBe('none');
    expect(needsManualEquivalence(m)).toBe(true);
    expect(needsManualEquivalence(matchSubjectsToDestination(['MATEMATICA'], dest))).toBe(false);
  });
});

describe('aplicar o mapeamento às notas', () => {
  const grades = [
    { subjectName: 'LINGUA PORTUGUESA', mt1: 14, mt2: 15, mt3: '' as const },
    { subjectName: 'Filosofia', mt1: 12, mt2: '' as const, mt3: '' as const },
    { subjectName: 'Informática', mt1: 16, mt2: '' as const, mt3: '' as const }
  ];
  it('usa o nome e o id da disciplina desta escola e respeita as decisões manuais', () => {
    const matches = matchSubjectsToDestination(grades.map((g) => g.subjectName), dest);
    const out = applySubjectMapping(grades, matches, { Filosofia: null, 'Informática': dest[1] });
    expect(out.map((g) => g.subjectName)).toEqual(['Língua Portuguesa', 'Filosofia', 'Matemática']);
    expect(out[0].destSubjectId).toBe('s1');
    expect(out[0].originSubjectName).toBe('LINGUA PORTUGUESA');
    expect(out[1].destSubjectId).toBeUndefined();
  });
  it('junta duas disciplinas de origem que caiam na mesma de destino', () => {
    const g = [{ subjectName: 'Matemática I', mt1: 10, mt2: '' as const }, { subjectName: 'Matematica II', mt1: '' as const, mt2: 13 }];
    const matches = matchSubjectsToDestination(g.map((x) => x.subjectName), dest);
    const out = applySubjectMapping(g, matches, { 'Matemática I': dest[1], 'Matematica II': dest[1] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ subjectName: 'Matemática', mt1: 10, mt2: 13 });
  });
  it('os registos criados ficam ligados à disciplina da escola e marcados como Transferência', () => {
    const matches = matchSubjectsToDestination(['LINGUA PORTUGUESA'], dest);
    const [rec] = transferredGradesToRecords(applySubjectMapping([grades[0]], matches), 'Escola A');
    expect(rec.subjectId).toBe('s1');
    expect(rec.subjectName).toBe('Língua Portuguesa');
    expect(rec.origemNota).toBe('Transferência');
    expect(rec.origemDetalhe).toContain('LINGUA PORTUGUESA');
  });
});
