import { describe, expect, it } from 'vitest';
import { isYearScopedCollection, filterRecordsByAcademicYear, SHARD_CONFIG, SHARD_KEYS } from '../src/utils/shardSync';


describe('Carregamento por Ano Lectivo', () => {
  it('identifica correctamente colecções anuais vs perenes', () => {
    // Colecções ligadas ao ano letivo
    expect(isYearScopedCollection('matriculas')).toBe(true);
    expect(isYearScopedCollection('classes')).toBe(true);
    expect(isYearScopedCollection('invoices')).toBe(true);
    expect(isYearScopedCollection('attendanceSheets')).toBe(true);
    expect(isYearScopedCollection('homologations')).toBe(true);
    expect(isYearScopedCollection('admissions')).toBe(true);
    expect(isYearScopedCollection('curriculumPlans')).toBe(true);
    expect(isYearScopedCollection('subjectAssignments')).toBe(true);
    expect(isYearScopedCollection('medicalRecords')).toBe(true);
    expect(isYearScopedCollection('disciplinaryIncidents')).toBe(true);

    // Colecções perenes (instituição, pessoas, património)
    expect(isYearScopedCollection('teachers')).toBe(false);
    expect(isYearScopedCollection('funcionarios')).toBe(false);
    expect(isYearScopedCollection('departments')).toBe(false);
    expect(isYearScopedCollection('suppliers')).toBe(false);
    expect(isYearScopedCollection('assets')).toBe(false);
    expect(isYearScopedCollection('courses')).toBe(false);
    expect(isYearScopedCollection('subjects')).toBe(false);
  });

  it('filterRecordsByAcademicYear filtra apenas os registos do ano pretendido', () => {
    const list = [
      { id: '1', academicYear: '2025/2026', title: 'Antigo' },
      { id: '2', academicYear: '2026/2027', title: 'Corrente A' },
      { id: '3', academicYear: '2026/2027', title: 'Corrente B' },
      { id: '4', academicYear: '2027/2028', title: 'Futuro' },
      { id: '5', title: 'Sem Ano Definido' }
    ];

    const year26 = filterRecordsByAcademicYear(list, '2026/2027');
    expect(year26.map((r) => r.id)).toEqual(['2', '3', '5']);

    const year25 = filterRecordsByAcademicYear(list, '2025/2026');
    expect(year25.map((r) => r.id)).toEqual(['1', '5']);

    // Sem especificar ano, retorna a lista completa
    expect(filterRecordsByAcademicYear(list, '')).toEqual(list);
    expect(filterRecordsByAcademicYear(null, '2026/2027')).toEqual([]);
  });

  it('aluno e encarregado não conseguem ler as listas completas de alunos, turmas, faturas e matrículas', () => {
    // Reforçado no servidor por collection_acl / RLS (supabase/migrations)
    const forbiddenForPortals = ['students', 'classes', 'invoices', 'matriculas', 'guardianLinks', 'internalChatThreads', 'inscricoesUC', 'bolsasEstudo', 'homologations', 'attendanceSheets'];
    for (const name of forbiddenForPortals) {
      const cfg = SHARD_CONFIG[name];
      expect(cfg.read).not.toContain('aluno');
      expect(cfg.read).not.toContain('encarregado');
    }
  });
});
