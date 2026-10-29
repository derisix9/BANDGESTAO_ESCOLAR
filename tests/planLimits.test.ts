import { describe, it, expect } from 'vitest';
import { parsePlanLimit } from '../src/utils/planLimits';

describe('parsePlanLimit', () => {
  it('reconhece o erro de alunos vindo da base de dados', () => {
    const r = parsePlanLimit({ message: 'LIMITE_PLANO:alunos — O plano permite 300  alunos e já foram atingidos.' });
    expect(r?.kind).toBe('alunos');
    expect(r?.message).toContain('300');
  });
  it('reconhece armazenamento e utilizadores', () => {
    expect(parsePlanLimit(new Error('LIMITE_PLANO:armazenamento — cheio'))?.kind).toBe('armazenamento');
    expect(parsePlanLimit('LIMITE_PLANO:utilizadores — x')?.kind).toBe('utilizadores');
  });
  it('usa texto por omissão quando não há mensagem', () => {
    expect(parsePlanLimit('LIMITE_PLANO:alunos')?.message).toMatch(/limite de alunos/i);
  });
  it('ignora outros erros', () => {
    expect(parsePlanLimit(new Error('row-level security'))).toBeNull();
    expect(parsePlanLimit(null)).toBeNull();
  });
});
