import { describe, it, expect } from 'vitest';
import { reconcileServicesWithFinancialTable } from '../src/utils/financialCatalogSync';

const row = (grade: string, p: number, m = 5000, c = 3000): any => ({
  id: grade, grade, subsystemId: 'primario', levelName: 'Primário', cycle: '1.º Ciclo',
  matriculaKz: m, confirmacaoKz: c, monthlyTuitionKz: p, lateFeeLimitDays: 10,
});

describe('Tabela Financeira → Catálogo de Serviços', () => {
  it('cria 3 serviços por classe e preserva os manuais', () => {
    const manual: any = { id: 'x', code: 'DECL-01', name: 'Declaração', category: 'declaracao', defaultPriceKz: 1000, active: true };
    const r = reconcileServicesWithFinancialTable([manual], [row('1.ª Classe', 2000)]);
    expect(r.changed).toBe(true);
    expect(r.services).toHaveLength(4);
    expect(r.services.find((s) => s.code === 'PROP-1-CLASSE')?.defaultPriceKz).toBe(2000);
    expect(r.services.find((s) => s.code === 'DECL-01')).toBe(manual);
  });
  it('atualiza o preço quando a tabela muda e não muda nada se nada mudou', () => {
    const a = reconcileServicesWithFinancialTable([], [row('1.ª Classe', 2000)]).services;
    const b = reconcileServicesWithFinancialTable(a, [row('1.ª Classe', 2500)]);
    expect(b.changed).toBe(true);
    expect(b.services.find((s) => s.code === 'PROP-1-CLASSE')?.defaultPriceKz).toBe(2500);
    const c = reconcileServicesWithFinancialTable(b.services, [row('1.ª Classe', 2500)]);
    expect(c.changed).toBe(false);
    expect(c.services).toBe(b.services);
  });
  it('remove os serviços de classes retiradas e ignora tabela vazia', () => {
    const a = reconcileServicesWithFinancialTable([], [row('1.ª Classe', 1), row('2.ª Classe', 2)]).services;
    expect(a).toHaveLength(6);
    const b = reconcileServicesWithFinancialTable(a, [row('1.ª Classe', 1)]);
    expect(b.services).toHaveLength(3);
    expect(reconcileServicesWithFinancialTable(b.services, []).changed).toBe(false);
  });
});
