import { describe, expect, it } from 'vitest';
import { latestMatriculaOf, resolveStudentSituation } from '../src/utils/studentSituation';

const mat = (id: string, studentId: string, academicYear: string, estado: string, createdAt = '2026-01-01T00:00:00Z') =>
  ({ id, studentId, academicYear, estado, createdAt } as any);

describe('situação do aluno a partir da matrícula', () => {
  it('matrícula cancelada => Inactivo em Alunos', () => {
    expect(resolveStudentSituation({ id: '1', studentSituation: 'Activo' }, [mat('a', '1', '2026/2027', 'cancelada')])).toBe('Inactivo');
  });

  it('sem matrícula cancelada mantém a situação da ficha (ou Activo)', () => {
    expect(resolveStudentSituation({ id: '1', studentSituation: 'Suspenso' }, [mat('a', '1', '2026/2027', 'matriculado')])).toBe('Suspenso');
    expect(resolveStudentSituation({ id: '1' }, [mat('a', '1', '2026/2027', 'confirmada')])).toBe('Activo');
    expect(resolveStudentSituation({ id: '1' }, [])).toBe('Activo');
  });

  it('só conta a matrícula mais recente: cancelada num ano antigo não torna o aluno Inactivo', () => {
    const list = [mat('a', '1', '2025/2026', 'cancelada'), mat('b', '1', '2026/2027', 'matriculado')];
    expect(latestMatriculaOf(list, '1')?.id).toBe('b');
    expect(resolveStudentSituation({ id: '1', studentSituation: 'Activo' }, list)).toBe('Activo');
  });

  it('no mesmo ano, uma nova matrícula depois da cancelada devolve o aluno a Activo', () => {
    const list = [mat('a', '1', '2026/2027', 'cancelada', '2026-02-01T00:00:00Z'), mat('b', '1', '2026/2027', 'matriculado', '2026-03-01T00:00:00Z')];
    expect(resolveStudentSituation({ id: '1', studentSituation: 'Activo' }, list)).toBe('Activo');
  });

  it('ignora matrículas de outros alunos', () => {
    expect(resolveStudentSituation({ id: '2', studentSituation: 'Activo' }, [mat('a', '1', '2026/2027', 'cancelada')])).toBe('Activo');
  });
});
