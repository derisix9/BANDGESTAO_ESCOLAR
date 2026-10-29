import { describe, expect, it } from 'vitest';
import { buildPublicRecord } from '../src/utils/publicProjection';
import { personToken } from '../src/utils/publicToken';

const db: any = {
  settings: { schoolName: 'Escola X', currentAcademicYear: '2026/2027', publicVerifySecret: 'segredo', logoUrl: 'x', decreeAuthorization: 'y' },
  students: [{ id: '1', name: 'Ana', procNumber: '2026001', className: '10ª A', status: 'active', biNumber: '123456789LA041', address: 'Rua 1', guardianPhone: '923000000', healthNotes: 'asma' }],
  teachers: [{ id: '7', name: 'Prof', department: 'Matemática', biNumber: '999', iban: 'AO06...', phone: '9', email: 'p@x.ao' }],
  funcionarios: [{ id: '8', name: 'Func', cargo: 'Secretário', department: 'Secretaria', nif: '555', iban: 'AO06...' }],
  invoices: [{ id: 'f1', studentId: '1', status: 'pendente', totalAmountKz: 1000 }],
  payrollRecords: [{ id: 'p1', personId: '7', netSalary: 100000 }],
  transportRoutes: [], vehicles: []
};

describe('registo público dos QR é mínimo', () => {
  it('aluno: só nome, nº, turma e estado — nunca BI, morada, contactos, saúde, facturas', () => {
    const rec = buildPublicRecord(db, 's:1', 'inst')!;
    const txt = JSON.stringify(rec);
    expect(rec.v).toBe(2);
    expect(txt).toContain('Ana');
    for (const secret of ['123456789LA041', 'Rua 1', '923000000', 'asma', 'totalAmountKz', 'publicVerifySecret', 'segredo', 'decreeAuthorization']) {
      expect(txt).not.toContain(secret);
    }
    expect(rec.slice.invoices).toBeUndefined();
  });

  it('docente e funcionário: sem BI, IBAN, NIF, contactos nem folha de pagamento', () => {
    for (const key of ['t:7', 'f:8']) {
      const txt = JSON.stringify(buildPublicRecord(db, key, 'inst'));
      for (const secret of ['999', 'AO06', '555', 'p@x.ao', 'netSalary', 'payrollRecords']) expect(txt).not.toContain(secret);
    }
  });

  it('pessoa inexistente ou chave inválida não gera registo', () => {
    expect(buildPublicRecord(db, 's:404', 'inst')).toBeNull();
    expect(buildPublicRecord(db, 'xx', 'inst')).toBeNull();
  });

  it('o token é estável por pessoa e diferente entre pessoas e segredos', () => {
    expect(personToken('a', 's:1')).toBe(personToken('a', 's:1'));
    expect(personToken('a', 's:1')).not.toBe(personToken('a', 's:2'));
    expect(personToken('a', 's:1')).not.toBe(personToken('b', 's:1'));
    expect(personToken('a', 's:1')).toMatch(/^[0-9a-z]{10}$/);
  });
});
