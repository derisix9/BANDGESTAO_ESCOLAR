import { describe, it, expect } from 'vitest';
import { getAvailableGrades, getSubsystemForGrade, getCycleForGrade, classBelongsToSubsystem } from '../src/utils/educationSubsystems';
import { getPautaRegime, isExamClass } from '../src/utils/pautaCalculations';
import { shortClassLabel } from '../src/utils/pautaHeader';

describe('Módulo 3 — nova classe do Ensino Primário', () => {
  it('aparece nas classes do Primário', () => {
    expect(getAvailableGrades(['primario'])).toContain('Módulo 3');
    expect(getSubsystemForGrade('Módulo 3')?.id).toBe('primario');
    expect(getSubsystemForGrade('Modulo 3')?.id).toBe('primario');
    expect(getCycleForGrade('Módulo 3')).toMatch(/Ensino Primário/);
    expect(classBelongsToSubsystem({ grade: 'Módulo 3' }, 'primario')).toBe(true);
  });

  it('é classe de transição (sem exame/recurso) e não é EJA', () => {
    expect(isExamClass('Módulo 3')).toBe(false);
    expect(getPautaRegime('Módulo 3')).toBe('transicao');
  });

  it('não se confunde com a 3.ª Classe', () => {
    expect(shortClassLabel('Módulo 3')).toBe('M3');
    expect(shortClassLabel('3.ª Classe')).toBe('3ª');
    expect(getAvailableGrades(['primario']).filter((g) => g === '3.ª Classe')).toHaveLength(1);
  });

  it('o EJA continua intacto', () => {
    expect(getSubsystemForGrade('II Ano EJA (Módulos 3-4)')?.id).toBe('secundario_1');
  });
});
