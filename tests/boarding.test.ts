import { describe, expect, it } from 'vitest';
import { validateRoom, validateAllocation, roomOccupancy, occupancySummary, pendingBoardingBills, boardingInvoiceDescription } from '../src/utils/boarding';

const room = (o: any = {}): any => ({ id: 'r1', code: 'A1', gender: 'F', beds: 2, monthlyFeeKz: 15000, status: 'ativo', ...o });
const stu = (id: string, gender: string, status = 'active'): any => ({ id, name: `Aluno ${id}`, gender, status });
const al = (o: any = {}): any => ({ id: 'a1', roomId: 'r1', roomCode: 'A1', bed: 1, studentId: 's1', studentName: 'Aluno s1', startDate: '2026-09-01', status: 'ativa', monthlyFeeKz: 15000, ...o });

describe('internato: quartos', () => {
  it('código único (sem distinguir maiúsculas), camas e valor', () => {
    expect(validateRoom({ code: 'a1', beds: 2, monthlyFeeKz: 0 }, [room()])).toContain('Já existe um quarto com este código.');
    expect(validateRoom({ code: 'B2', beds: 0, monthlyFeeKz: 0 }, [])).toHaveLength(1);
    expect(validateRoom({ code: 'B2', beds: 2, monthlyFeeKz: -1 }, [])).toHaveLength(1);
    expect(validateRoom({ code: 'A1', beds: 2, monthlyFeeKz: 0 }, [room()], 'r1')).toEqual([]);
  });
  it('ocupação e camas livres', () => {
    expect(roomOccupancy(room(), [al()])).toEqual({ occupied: 1, free: [2], capacity: 2 });
    expect(roomOccupancy(room(), [al({ status: 'encerrada' })]).free).toEqual([1, 2]);
    expect(occupancySummary([room(), room({ id: 'r2', status: 'inativo' })], [al()])).toEqual({ rooms: 1, beds: 2, occupied: 1, free: 1, rate: 50 });
  });
});

describe('internato: alocação', () => {
  const input = (o: any = {}) => ({ roomId: 'r1', bed: 2, studentId: 's2', startDate: '2026-09-01', ...o });
  it('aluna em quarto feminino e cama livre é válida', () => {
    expect(validateAllocation(input(), [room()], [al()], [stu('s2', 'Feminino')])).toEqual([]);
  });
  it('recusa cama ocupada, aluno já alojado e quarto de outro género', () => {
    expect(validateAllocation(input({ bed: 1 }), [room()], [al()], [stu('s2', 'F')]).length).toBe(1);
    expect(validateAllocation(input({ studentId: 's1', bed: 2 }), [room()], [al()], [stu('s1', 'F')]).length).toBe(1);
    expect(validateAllocation(input(), [room()], [], [stu('s2', 'Masculino')])[0]).toContain('feminino');
  });
  it('género em falta só bloqueia em quarto não misto; cama fora do intervalo; aluno inactivo', () => {
    expect(validateAllocation(input(), [room({ gender: 'misto' })], [], [stu('s2', '')])).toEqual([]);
    expect(validateAllocation(input(), [room()], [], [stu('s2', '')]).length).toBe(1);
    expect(validateAllocation(input({ bed: 3 }), [room()], [], [stu('s2', 'F')]).length).toBe(1);
    expect(validateAllocation(input(), [room()], [], [stu('s2', 'F', 'transferred')]).length).toBe(1);
  });
});

describe('internato: mensalidades', () => {
  it('emite uma vez por mês e por aluno', () => {
    const a = [al()];
    expect(pendingBoardingBills(a, [], 2026, 10)).toHaveLength(1);
    const inv = [{ studentId: 's1', description: boardingInvoiceDescription('A1', 2026, 10) }];
    expect(pendingBoardingBills(a, inv, 2026, 10)).toHaveLength(0);
    expect(pendingBoardingBills(a, inv, 2026, 11)).toHaveLength(1);
  });
  it('não cobra antes da entrada nem com mensalidade zero', () => {
    expect(pendingBoardingBills([al({ startDate: '2026-11-05' })], [], 2026, 10)).toHaveLength(0);
    expect(pendingBoardingBills([al({ startDate: '2026-10-31' })], [], 2026, 10)).toHaveLength(1);
    expect(pendingBoardingBills([al({ monthlyFeeKz: 0 })], [], 2026, 10)).toHaveLength(0);
  });
  it('descrição não contém "propina" (não conta como mês de propina pago)', () => {
    expect(/propina/i.test(boardingInvoiceDescription('A1', 2026, 10))).toBe(false);
  });
});
