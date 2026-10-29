import { describe, it, expect } from 'vitest';
import { compareNames, sortByName, sortPautaRowsByName } from '../src/utils/alphabetical';
import { getStudentsForClass } from '../src/utils/classStudentsRoster';
import { buildMiniPautaRows, buildPautaGeralRows } from '../src/utils/pautaCalculations';

const st = (id: string, name: string, classId = 'c1') =>
  ({ id, name, classId, status: 'active', birthDate: '2012-01-01', gender: 'M', financialStatus: 'regular', isTuitionPaidCurrentMonth: true } as any);

describe('ordem alfabética por nome', () => {
  it('ignora acentos, maiúsculas e espaços; vazios vão para o fim', () => {
    const names = sortByName([{ name: 'Zélia' }, { name: '  ana' }, { name: 'Álvaro' }, { name: 'Alberto' }, { name: '' }, { name: 'Bruno' }]).map((x) => x.name);
    expect(names).toEqual(['Alberto', 'Álvaro', '  ana', 'Bruno', 'Zélia', '']);
    expect(compareNames('Ana', 'ana')).toBe(0);
  });

  it('não altera a lista original', () => {
    const l = [{ name: 'B' }, { name: 'A' }];
    sortByName(l);
    expect(l[0].name).toBe('B');
  });

  it('renumera as linhas da pauta', () => {
    expect(sortPautaRowsByName([{ name: 'Carlos', num: 1 }, { name: 'Ana', num: 2 }])).toEqual([{ name: 'Ana', num: 1 }, { name: 'Carlos', num: 2 }]);
  });

  const students = [st('1', 'Zeca'), st('2', 'Ângela'), st('3', 'Bento'), st('4', 'Outro', 'c2')];

  it('a lista da turma vem em ordem alfabética', () => {
    expect(getStudentsForClass('c1', students).map((s) => s.name)).toEqual(['Ângela', 'Bento', 'Zeca']);
  });

  it('Mini-Pauta e Pauta Geral saem em ordem alfabética, numeradas 1..n', () => {
    const mini = buildMiniPautaRows(students.slice(0, 3), 'mat', students, undefined, undefined);
    expect(mini.map((r) => [r.num, r.name])).toEqual([[1, 'Ângela'], [2, 'Bento'], [3, 'Zeca']]);
    const geral = buildPautaGeralRows(students.slice(0, 3), [], students, undefined, '7.ª Classe', undefined);
    expect(geral.map((r) => [r.num, r.name])).toEqual([[1, 'Ângela'], [2, 'Bento'], [3, 'Zeca']]);
  });
});
