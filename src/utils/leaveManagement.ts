import { Funcionario, LeaveRequest, LeaveType, RhPersonType, SchoolDatabase, Teacher } from '../types';
import { addDaysIso, isSchoolDay } from './canteen';

/**
 * Férias & Licenças — cálculo de dias úteis, deteção de sobreposição de datas
 * e saldo de férias por pessoa/ano, a partir apenas de dados reais já
 * existentes na base de dados (docentes, funcionários e pedidos registados).
 */

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ferias: 'Férias',
  licenca_maternidade: 'Licença de Maternidade',
  licenca_paternidade: 'Licença de Paternidade',
  licenca_medica: 'Licença Médica',
  licenca_sem_vencimento: 'Licença sem Vencimento',
  falta_justificada: 'Falta Justificada',
  luto: 'Luto',
  outro: 'Outro'
};

export const LEAVE_STATUS_META: Record<LeaveRequest['status'], { label: string; badge: string }> = {
  pendente: { label: 'Pendente', badge: 'bg-amber-100 text-amber-800' },
  aprovado: { label: 'Aprovado', badge: 'bg-emerald-100 text-emerald-800' },
  rejeitado: { label: 'Rejeitado', badge: 'bg-red-100 text-red-800' },
  concluido: { label: 'Concluído', badge: 'bg-slate-200 text-slate-600' },
  cancelado: { label: 'Cancelado', badge: 'bg-slate-200 text-slate-600' }
};

export const DEFAULT_ANNUAL_LEAVE_ENTITLEMENT_DAYS = 22;

/** Nº de dias úteis (segunda a sexta) entre duas datas ISO, inclusive. */
export function countWorkingDays(startDateIso: string, endDateIso: string): number {
  if (!startDateIso || !endDateIso || endDateIso < startDateIso) return 0;
  let count = 0;
  let cursor = startDateIso;
  // Limite de segurança para nunca entrar em loop infinito com datas inválidas.
  let guard = 0;
  while (cursor <= endDateIso && guard < 3660) {
    if (isSchoolDay(cursor)) count += 1;
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }
  return count;
}

/** Verdadeiro se já existir um pedido pendente ou aprovado da mesma pessoa que se sobreponha ao intervalo dado. */
export function hasOverlappingLeave(
  personId: string,
  startDateIso: string,
  endDateIso: string,
  existing: LeaveRequest[],
  ignoreId?: string
): boolean {
  return existing.some((r) => {
    if (r.personId !== personId) return false;
    if (ignoreId && r.id === ignoreId) return false;
    if (r.status !== 'pendente' && r.status !== 'aprovado') return false;
    return r.startDate <= endDateIso && startDateIso <= r.endDate;
  });
}

export interface LeaveEligiblePerson {
  id: string;
  type: RhPersonType;
  name: string;
  role: string;
  department?: string;
  status: string;
}

/** Docentes e funcionários elegíveis para pedidos de férias/licenças (ativos ou já em licença). */
export function listLeaveEligiblePeople(db: SchoolDatabase): LeaveEligiblePerson[] {
  const teachers: LeaveEligiblePerson[] = (db.teachers || [])
    .filter((t: Teacher) => t.status !== 'contrato_vencer' || true)
    .map((t: Teacher) => ({
      id: t.id,
      type: 'professor' as RhPersonType,
      name: t.name,
      role: t.category || 'Professor',
      department: t.department,
      status: t.status
    }));

  const funcionarios: LeaveEligiblePerson[] = (db.funcionarios || []).map((f: Funcionario) => ({
    id: f.id,
    type: 'funcionario' as RhPersonType,
    name: f.name,
    role: f.cargo === 'outro' ? (f.cargoOutroDescricao || 'Funcionário') : f.cargo,
    department: f.department,
    status: f.status
  }));

  return [...teachers, ...funcionarios].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}

/** Ano civil (1 Jan a 31 Dez) usado para contabilizar o saldo de férias de uma pessoa. */
export function leaveYearOf(iso: string): number {
  return Number(iso.slice(0, 4)) || new Date().getFullYear();
}

export interface LeaveBalance {
  entitlementDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

/**
 * Saldo de férias (tipo 'ferias') de uma pessoa num dado ano civil: dias úteis já
 * aprovados/concluídos contam como usados; pedidos pendentes aparecem à parte,
 * para não subtrair do saldo antes de decididos.
 */
export function computeLeaveBalance(
  personId: string,
  year: number,
  requests: LeaveRequest[],
  entitlementDays: number
): LeaveBalance {
  const relevant = requests.filter(
    (r) => r.personId === personId && r.type === 'ferias' && leaveYearOf(r.startDate) === year
  );
  const usedDays = relevant
    .filter((r) => r.status === 'aprovado' || r.status === 'concluido')
    .reduce((sum, r) => sum + (r.workingDaysCount || 0), 0);
  const pendingDays = relevant
    .filter((r) => r.status === 'pendente')
    .reduce((sum, r) => sum + (r.workingDaysCount || 0), 0);
  return {
    entitlementDays,
    usedDays,
    pendingDays,
    remainingDays: Math.max(0, entitlementDays - usedDays)
  };
}

export function leaveRequestsToCsv(requests: LeaveRequest[]): string {
  const header = ['Nome', 'Tipo', 'Cargo', 'Tipo de Ausência', 'Início', 'Fim', 'Dias Úteis', 'Estado', 'Solicitado em'];
  const rows = requests.map((r) => [
    r.personName,
    r.personType === 'professor' ? 'Professor' : 'Funcionário',
    r.personRole,
    r.type === 'outro' ? r.typeDescription || 'Outro' : LEAVE_TYPE_LABELS[r.type],
    r.startDate,
    r.endDate,
    String(r.workingDaysCount),
    LEAVE_STATUS_META[r.status]?.label || r.status,
    (r.requestedAt || '').slice(0, 10)
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map((c) => escape(String(c))).join(';')).join('\n');
}
