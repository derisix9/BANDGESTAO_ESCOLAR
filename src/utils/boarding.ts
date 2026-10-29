/**
 * INTERNATO / ALOJAMENTO — quartos, camas, alocação e mensalidade.
 * Lógica pura, testada em tests/boarding.test.ts.
 */
import type { BoardingAllocation, BoardingRoom, Student } from '../types';

export const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function normGender(g?: string): 'M' | 'F' | null {
  const x = String(g || '').trim().toUpperCase();
  if (x.startsWith('F')) return 'F';
  if (x.startsWith('M')) return 'M';
  return null;
}

export function validateRoom(input: { code: string; beds: number; monthlyFeeKz: number }, rooms: BoardingRoom[], ignoreId?: string): string[] {
  const errs: string[] = [];
  if (!input.code?.trim()) errs.push('Indique o código do quarto.');
  else if (rooms.some((r) => r.id !== ignoreId && r.code.trim().toLowerCase() === input.code.trim().toLowerCase())) errs.push('Já existe um quarto com este código.');
  if (!Number.isInteger(input.beds) || input.beds < 1 || input.beds > 40) errs.push('O nº de camas deve ser um inteiro entre 1 e 40.');
  if (!Number.isFinite(input.monthlyFeeKz) || input.monthlyFeeKz < 0) errs.push('A mensalidade não pode ser negativa.');
  return errs;
}

export const activeAllocations = (al: BoardingAllocation[]) => al.filter((a) => a.status === 'ativa');

export function roomOccupancy(room: BoardingRoom, allocations: BoardingAllocation[]) {
  const occ = activeAllocations(allocations).filter((a) => a.roomId === room.id);
  const taken = new Set(occ.map((a) => a.bed));
  const free: number[] = [];
  for (let b = 1; b <= room.beds; b++) if (!taken.has(b)) free.push(b);
  return { occupied: occ.length, free, capacity: room.beds };
}

export function validateAllocation(
  input: { roomId: string; bed: number; studentId: string; startDate: string },
  rooms: BoardingRoom[], allocations: BoardingAllocation[], students: Student[]
): string[] {
  const errs: string[] = [];
  const room = rooms.find((r) => r.id === input.roomId);
  const student = students.find((s) => s.id === input.studentId);
  if (!room) return ['Quarto não encontrado.'];
  if (!student) return ['Aluno não encontrado.'];
  if (room.status !== 'ativo') errs.push('Este quarto está inactivo.');
  if (!Number.isInteger(input.bed) || input.bed < 1 || input.bed > room.beds) errs.push(`A cama deve estar entre 1 e ${room.beds}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '')) errs.push('Indique a data de entrada.');
  const act = activeAllocations(allocations);
  if (act.some((a) => a.roomId === room.id && a.bed === input.bed)) errs.push(`A cama ${input.bed} do quarto ${room.code} já está ocupada.`);
  const existing = act.find((a) => a.studentId === student.id);
  if (existing) errs.push(`${student.name} já está alojado(a) no quarto ${existing.roomCode}, cama ${existing.bed}.`);
  if (room.gender !== 'misto') {
    const g = normGender(student.gender);
    if (!g) errs.push('O género do aluno não está preenchido, não é possível confirmar o quarto.');
    else if (g !== room.gender) errs.push(`O quarto ${room.code} é ${room.gender === 'M' ? 'masculino' : 'feminino'}.`);
  }
  if (student.status !== 'active') errs.push('Só alunos activos podem ser alojados.');
  return errs;
}

export function occupancySummary(rooms: BoardingRoom[], allocations: BoardingAllocation[]) {
  const active = rooms.filter((r) => r.status === 'ativo');
  const beds = active.reduce((s, r) => s + r.beds, 0);
  const occupied = activeAllocations(allocations).filter((a) => active.some((r) => r.id === a.roomId)).length;
  return { rooms: active.length, beds, occupied, free: Math.max(0, beds - occupied), rate: beds > 0 ? Math.round((occupied / beds) * 1000) / 10 : null };
}

export const monthPeriodLabel = (year: number, month1to12: number) => `${MONTHS_PT[month1to12 - 1]} / ${year}`;
export const boardingInvoiceDescription = (roomCode: string, year: number, month1to12: number) =>
  `Mensalidade de Internato — Quarto ${roomCode} (${MONTHS_PT[month1to12 - 1]}/${year})`;

/** Alocações activas que ainda não têm factura do mês. `invoices` só precisa de studentId e description. */
export function pendingBoardingBills(
  allocations: BoardingAllocation[], invoices: Array<{ studentId: string; description: string }>, year: number, month1to12: number
): BoardingAllocation[] {
  const first = `${year}-${String(month1to12).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month1to12, 0).getDate();
  const last = `${year}-${String(month1to12).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return activeAllocations(allocations).filter((a) => {
    if (a.monthlyFeeKz <= 0) return false;
    if (a.startDate > last) return false;           // ainda não tinha entrado
    if (a.endDate && a.endDate < first) return false; // já tinha saído
    const desc = boardingInvoiceDescription(a.roomCode, year, month1to12);
    return !invoices.some((i) => i.studentId === a.studentId && i.description === desc);
  });
}
