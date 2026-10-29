import { describe, expect, it } from 'vitest';
import { computeClassStats } from '../src/utils/aproveitamentoStats';
import { classBelongsToSubsystem } from '../src/utils/educationSubsystems';

const st = (id: string, gender: string, grades: any[], status = 'active', name = 'Aluno') =>
  ({ id, name, gender, status, trimesterGrades: grades } as any);

const rec = (subjectId: string, mac: number | '', npp: number | '', npt: number | '') => ({
  subjectId, subjectName: subjectId.toUpperCase(),
  mac1: mac, npp1: npp, npt1: npt, mt1: 0,
  mac2: '', npp2: '', npt2: '', mt2: 0,
  mac3: '', npp3: '', npt3: '', mt3: 0,
  mfd: 0, ca: 0, situation: 'Aprovado'
});

describe('classBelongsToSubsystem', () => {
  const c = (grade: string, cycle = '') => ({ grade, cycle });
  it('Primário não traz 11.ª, 12.ª, 13.ª nem 10.ª', () => {
    expect(classBelongsToSubsystem(c('4.ª Classe'), 'primario')).toBe(true);
    for (const g of ['10.ª Classe', '11.ª Classe', '12.ª Classe', '13.ª Classe (Técnico-Profissional)']) {
      expect(classBelongsToSubsystem(c(g), 'primario')).toBe(false);
      expect(classBelongsToSubsystem(c(g), 'secundario_1')).toBe(false);
      expect(classBelongsToSubsystem(c(g), 'secundario_2')).toBe(true);
    }
  });
  it('I Ciclo é 7.ª–9.ª e não traz II Ciclo', () => {
    expect(classBelongsToSubsystem(c('8.ª Classe'), 'secundario_1')).toBe(true);
    expect(classBelongsToSubsystem(c('8.ª Classe'), 'primario')).toBe(false);
    expect(classBelongsToSubsystem(c('', 'II Ciclo / Ensino Médio'), 'secundario_1')).toBe(false);
    expect(classBelongsToSubsystem(c('', 'I Ciclo do Ensino Secundário'), 'secundario_1')).toBe(true);
  });
});

describe('computeClassStats', () => {
  const students = [
    st('1', 'M', [rec('mat', 14, 12, 16), rec('por', 5, 6, 7)]),   // mat 14 | por 6
    st('2', 'F', [rec('mat', 8, 8, 8), rec('por', 12, 12, 12)]),   // mat 8  | por 12
    st('3', 'F', [rec('mat', '', '', 11)]),                         // mat 11
    st('4', 'M', [], 'suspended'),                                  // desistido
    st('5', 'F', [])                                                // sem notas
  ];

  it('conta por sexo na disciplina escolhida', () => {
    const s = computeClassStats(students, { trimester: '1', subjectId: 'mat' });
    expect(s.matriculados).toEqual({ M: 2, F: 3, MF: 5 });
    expect(s.desistidos).toEqual({ M: 1, F: 0, MF: 1 });
    expect(s.avaliados).toEqual({ M: 1, F: 2, MF: 3 });
    expect(s.aprovados).toEqual({ M: 1, F: 1, MF: 2 });
    expect(s.reprovados).toEqual({ M: 0, F: 1, MF: 1 });
    expect(s.percentagem).toEqual({ M: 100, F: 50, MF: 66.7 });
  });

  it('sem disciplina: média das disciplinas de cada aluno', () => {
    const s = computeClassStats(students, { trimester: '1' });
    // aluno1 (14+6)/2=10 aprova; aluno2 (8+12)/2=10 aprova; aluno3 11 aprova
    expect(s.avaliados.MF).toBe(3);
    expect(s.aprovados.MF).toBe(3);
  });

  it('matrícula cancelada sem notas é desistente e nunca conta como avaliado', () => {
    const s = computeClassStats([st('9', 'M', [], 'suspended')], { trimester: '1', subjectId: 'mat' });
    expect(s.desistidos.MF).toBe(1);
    expect(s.transferidos.MF).toBe(0);
    expect(s.avaliados.MF).toBe(0);
    expect(s.percentagem.MF).toBeNull();
  });

  it('matrícula cancelada mas com notas lançadas não é desistente (mesma regra da Pauta)', () => {
    const s = computeClassStats([st('9', 'M', [rec('mat', 15, 15, 15)], 'suspended')], { trimester: '1', subjectId: 'mat' });
    expect(s.desistidos.MF).toBe(0);
    expect(s.avaliados.MF).toBe(1);
  });

  it('sem notas no I e II trimestres é desistente só com o III trimestre em curso', () => {
    const alunos = [st('1', 'M', [rec('mat', 14, 14, 14)]), st('2', 'F', [])];
    expect(computeClassStats(alunos, { trimester: '1', subjectId: 'mat', currentTrimester: '1' }).desistidos.MF).toBe(0);
    const t3 = computeClassStats(alunos, { trimester: '1', subjectId: 'mat', currentTrimester: '3' });
    expect(t3.desistidos).toEqual({ M: 0, F: 1, MF: 1 });
    expect(t3.matriculados.MF).toBe(2);
  });

  it('aluno que saiu por transferência conta em Transferidos (M, F, MF) e não em Desistidos nem Avaliados', () => {
    const list = [
      st('1', 'M', [rec('mat', 15, 15, 15)]),
      st('2', 'M', [rec('mat', 15, 15, 15)], 'transferred'),
      st('3', 'F', [rec('mat', 15, 15, 15)], 'transferred'),
      st('4', 'F', [rec('mat', 15, 15, 15)], 'transferred'),
      st('5', 'F', [], 'suspended')
    ];
    const s = computeClassStats(list, { trimester: '1', subjectId: 'mat' });
    expect(s.matriculados).toEqual({ M: 2, F: 3, MF: 5 });
    expect(s.transferidos).toEqual({ M: 1, F: 2, MF: 3 });
    expect(s.desistidos).toEqual({ M: 0, F: 1, MF: 1 });
    expect(s.avaliados).toEqual({ M: 1, F: 0, MF: 1 });
  });

  it('M + F = MF em todos os grupos', () => {
    const s = computeClassStats(students, { trimester: '1', subjectId: 'por' });
    for (const g of [s.matriculados, s.desistidos, s.transferidos, s.avaliados, s.reprovados, s.aprovados]) {
      expect(g.M + g.F).toBe(g.MF);
    }
  });
});
