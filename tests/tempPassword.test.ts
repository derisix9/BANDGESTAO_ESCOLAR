import { describe, expect, it } from 'vitest';
import { generateTempPassword } from '../src/utils/idGenerators';

describe('generateTempPassword', () => {
  it('tem 10 caracteres e sempre maiúscula, minúscula e número (exigido pelo registo/criação de contas)', () => {
    for (let i = 0; i < 2000; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(10);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
    }
  });

  it('não repete valores (aleatório)', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()));
    expect(seen.size).toBe(500);
  });
});
