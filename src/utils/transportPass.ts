/**
 * Lógica do passe de transporte escolar (sem React, testável em Node).
 *
 * Quem pode andar no transporte: alunos, professores e funcionários. A ordem de dependência é:
 *   Viatura (lotação) → Rota (paragens + turno + viatura) → Inscrição (pessoa na rota) → Mensalidade.
 *
 * O QR do cartão grava um link (`?public_verify=true&type=transport&id=s:12&r=ROTA-0003…`). O futuro
 * aplicativo do motorista lê esse link e chama `evaluateTransportPass`, que responde às três perguntas:
 *   1. a pessoa está inscrita nesta rota e neste turno?
 *   2. a mensalidade do mês está paga?
 *   3. já embarcou hoje neste turno?
 * e devolve Verde (aprovado, com foto e nome) ou Vermelho (bloqueado, com o motivo).
 */
import type {
  SchoolDatabase, TransportBoarding, TransportPayment, TransportPersonKey, TransportRoute, TransportShift
} from '../types';

export type RiderKind = 'student' | 'docente' | 'funcionario';
export type TripShift = 'manha' | 'tarde' | 'noite';

export const TRIP_SHIFTS: TripShift[] = ['manha', 'tarde', 'noite'];
export const SHIFT_LABEL: Record<TransportShift, string> = {
  manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', ambos: 'Manhã e Tarde'
};
/** Letra curta do turno nos links (ambos = a). */
const SHIFT_CODE: Record<TransportShift, string> = { manha: 'm', tarde: 't', noite: 'n', ambos: 'a' };

export const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ---------------------------------------------------------------------------------------------
// Pessoas e chaves
// ---------------------------------------------------------------------------------------------
const PREFIX: Record<RiderKind, string> = { student: 's', docente: 't', funcionario: 'f' };
export const personKey = (kind: RiderKind, id: string | number): TransportPersonKey => `${PREFIX[kind]}:${id}`;
export function parsePersonKey(key: string): { kind: RiderKind; id: string } | null {
  const m = /^([stf]):(.+)$/.exec(key || '');
  if (!m) return null;
  return { kind: m[1] === 's' ? 'student' : m[1] === 't' ? 'docente' : 'funcionario', id: m[2] };
}

export const routeRiderKeys = (r: TransportRoute): TransportPersonKey[] => [
  ...(r.studentIds || []).map((id) => personKey('student', id)),
  ...(r.teacherIds || []).map((id) => personKey('docente', id)),
  ...(r.funcionarioIds || []).map((id) => personKey('funcionario', id))
];

/** Lugares ocupados na rota (alunos + professores + funcionários). */
export const routeOccupancy = (r: TransportRoute): number =>
  (r.studentIds || []).length + (r.teacherIds || []).length + (r.funcionarioIds || []).length;

export const routeVehicle = (db: Pick<SchoolDatabase, 'vehicles'>, r: TransportRoute) =>
  r.vehicleId ? (db.vehicles || []).find((v) => v.id === r.vehicleId) : undefined;

/** Lotação máxima da viatura da rota (undefined = rota sem viatura, sem limite). */
export const routeCapacity = (db: Pick<SchoolDatabase, 'vehicles'>, r: TransportRoute): number | undefined => routeVehicle(db, r)?.capacity;

export const seatsLeft = (db: Pick<SchoolDatabase, 'vehicles'>, r: TransportRoute): number | undefined => {
  const cap = routeCapacity(db, r);
  return cap === undefined ? undefined : Math.max(0, cap - routeOccupancy(r));
};

/** Verificação matemática da inscrição: Lugares Ocupados < Lotação Máxima. */
export function capacityCheck(db: Pick<SchoolDatabase, 'vehicles'>, r: TransportRoute): { ok: boolean; message?: string } {
  const veh = routeVehicle(db, r);
  if (!veh) return { ok: true };
  if (routeOccupancy(r) < veh.capacity) return { ok: true };
  return { ok: false, message: `Lotação Esgotada: a viatura ${veh.plate} tem ${veh.capacity} lugares e todos estão ocupados nesta rota/turno.` };
}

/** Turnos reais (manhã/tarde/noite) em que a rota circula. */
export const tripShiftsOf = (shift: TransportShift): TripShift[] => (shift === 'ambos' ? ['manha', 'tarde'] : [shift]);
export const shiftsClash = (a: TransportShift, b: TransportShift): boolean => tripShiftsOf(a).some((s) => tripShiftsOf(b).includes(s));

// ---------------------------------------------------------------------------------------------
// Inscrições confirmadas (quem pode ter cartão de transporte)
// ---------------------------------------------------------------------------------------------
export interface Rider {
  key: TransportPersonKey;
  kind: RiderKind;
  /** Id do aluno, do professor ou do funcionário. */
  id: string;
  route: TransportRoute;
}

/** Todas as inscrições nas rotas activas. Uma pessoa pode ter mais de uma (turnos diferentes). */
export function confirmedRiders(db: Pick<SchoolDatabase, 'transportRoutes'>): Rider[] {
  const out: Rider[] = [];
  for (const route of db.transportRoutes || []) {
    if (route.status !== 'ativa') continue;
    for (const key of routeRiderKeys(route)) {
      const p = parsePersonKey(key);
      if (p) out.push({ key, kind: p.kind, id: p.id, route });
    }
  }
  return out;
}

/** A inscrição activa de uma pessoa (a primeira rota activa em que consta). */
export const enrollmentOf = (db: Pick<SchoolDatabase, 'transportRoutes'>, key: TransportPersonKey): TransportRoute | undefined =>
  (db.transportRoutes || []).find((r) => r.status === 'ativa' && routeRiderKeys(r).includes(key));

export const isConfirmedRider = (db: Pick<SchoolDatabase, 'transportRoutes'>, key: TransportPersonKey): boolean => !!enrollmentOf(db, key);

/** Itinerário legível: primeira ⇄ última paragem. */
export function itineraryOf(r: TransportRoute): string {
  const names = (r.stops || []).map((s) => s.name).filter(Boolean);
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names[0]} ⇄ ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------
// Mensalidades
// ---------------------------------------------------------------------------------------------
/** Mensalidade da rota; sem valor próprio usa a taxa fixa de transporte (se existir). */
export const routeFee = (db: Pick<SchoolDatabase, 'settings'>, r: TransportRoute): number | undefined =>
  r.monthlyFeeKz ?? db.settings?.transportFixedFeeKz;

export const isMonthPaid = (r: TransportRoute, key: TransportPersonKey, year: string, month: number): boolean =>
  (r.payments || []).some((p) => p.personKey === key && p.month === month && (!year || !p.year || p.year === year));

/** Meses (1–12) com mensalidade validada para a pessoa nesta rota e ano lectivo. */
export function paidMonths(r: TransportRoute | undefined, key: TransportPersonKey, year: string): Set<number> {
  const set = new Set<number>();
  for (const p of r?.payments || []) if (p.personKey === key && (!year || !p.year || p.year === year)) set.add(p.month);
  return set;
}

export function makePayment(key: TransportPersonKey, year: string, month: number, amountKz?: number, now = new Date()): TransportPayment {
  return { personKey: key, year, month, amountKz, paidAt: now.toISOString(), receipt: `TRP-${year.replace(/\D+/g, '')}-${String(month).padStart(2, '0')}-${key.replace(/\W+/g, '')}` };
}

// ---------------------------------------------------------------------------------------------
// Link do QR
// ---------------------------------------------------------------------------------------------
export interface TransportLink {
  key: TransportPersonKey;
  /** Código da rota (ROTA-0003). */
  route: string;
  /** Turno da rota (m/t/n/a). */
  shift: TransportShift;
  /** Ano lectivo do cartão. */
  year: string;
  inst: string;
}

const CODE_SHIFT: Record<string, TransportShift> = { m: 'manha', t: 'tarde', n: 'noite', a: 'ambos' };

export interface TransportLinkOpts { inst?: string; origin?: string; /** Token público da pessoa (leitura sem login). */ token?: string }

/** Valor gravado no QR do cartão de transporte (curto, para o QR ficar legível a 13 mm). */
export function buildTransportLink(key: TransportPersonKey, route: Pick<TransportRoute, 'code' | 'shift'>, year: string, o: TransportLinkOpts & { base: string }): string {
  const p = new URLSearchParams();
  p.set('public_verify', 'true');
  p.set('type', 'transport');
  p.set('id', key);
  p.set('r', route.code);
  p.set('sh', SHIFT_CODE[route.shift]);
  if (year) p.set('y', year);
  if (o.inst) p.set('inst', o.inst);
  if (o.token) p.set('k', o.token);
  return `${o.base}?${p.toString()}`;
}

export function parseTransportLink(search: string): TransportLink | null {
  const q = new URLSearchParams(search.includes('?') ? search.slice(search.indexOf('?')) : search);
  if (q.get('type') !== 'transport') return null;
  const key = q.get('id') || '';
  if (!parsePersonKey(key)) return null;
  return { key, route: q.get('r') || '', shift: CODE_SHIFT[q.get('sh') || 'a'] || 'ambos', year: q.get('y') || '', inst: q.get('inst') || '' };
}

// ---------------------------------------------------------------------------------------------
// Validação do embarque (o que o aplicativo do motorista vai mostrar)
// ---------------------------------------------------------------------------------------------
export interface Trip {
  /** Código da rota que o motorista está a fazer (omitido = a rota do próprio cartão). */
  route?: string;
  /** Turno da viagem (omitido = deduzido da hora). */
  shift?: TripShift;
  now?: Date;
}

export interface BoardingResult {
  approved: boolean;
  /** Motivos do bloqueio (vazio se aprovado). */
  reasons: string[];
  checks: { enrolled: boolean; shiftOk: boolean; feePaid: boolean; notBoarded: boolean };
  person?: { key: TransportPersonKey; kind: RiderKind; name: string; photo: string; detail: string };
  route?: { code: string; name: string; plate: string; shift: TransportShift };
  month: number;
  date: string;
  shift: TripShift;
}

export const REASON = {
  notEnrolled: 'Não inscrito nesta rota',
  wrongShift: 'Turno Incorreto',
  feeLate: 'Mensalidade em Atraso',
  boarded: 'Já embarcou hoje neste turno',
  unknown: 'Cartão não reconhecido'
} as const;

/** Turno de uma hora do dia: até 12h manhã, até 18h tarde, depois noite. */
export const shiftOfHour = (h: number): TripShift => (h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite');
export const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function resolvePerson(db: SchoolDatabase, key: TransportPersonKey): BoardingResult['person'] | undefined {
  const p = parsePersonKey(key);
  if (!p) return undefined;
  if (p.kind === 'student') {
    const s = (db.students || []).find((x) => String(x.id) === p.id);
    return s ? { key, kind: p.kind, name: s.name, photo: s.docPassPhoto || s.avatar || '', detail: [s.className || s.grade, s.procNumber].filter(Boolean).join(' · ') } : undefined;
  }
  if (p.kind === 'docente') {
    const t = (db.teachers || []).find((x) => String(x.id) === p.id);
    return t ? { key, kind: p.kind, name: t.name, photo: t.avatar || '', detail: 'Docente' } : undefined;
  }
  const f = (db.funcionarios || []).find((x) => String(x.id) === p.id);
  return f ? { key, kind: p.kind, name: f.name, photo: f.avatar || '', detail: f.department || 'Funcionário' } : undefined;
}

/**
 * Valida um embarque. Não altera nada: quem regista o embarque (a aplicação do motorista) chama
 * depois `dbService.registerTransportBoarding`, que repete esta validação antes de gravar.
 */
export function evaluateTransportPass(db: SchoolDatabase, link: Pick<TransportLink, 'key' | 'route'> & Partial<TransportLink>, trip: Trip = {}): BoardingResult {
  const now = trip.now || new Date();
  const shift = trip.shift || shiftOfHour(now.getHours());
  const month = now.getMonth() + 1;
  const date = isoDay(now);
  const year = db.settings?.currentAcademicYear || link.year || '';
  const routes = db.transportRoutes || [];
  const person = resolvePerson(db, link.key);
  const tripRouteCode = trip.route || link.route;
  // A rota em que a pessoa está realmente inscrita e que o motorista está a fazer.
  const route = routes.find((r) => r.code === tripRouteCode && r.status === 'ativa');
  const enrolled = !!route && routeRiderKeys(route).includes(link.key);
  const shiftOk = !!route && enrolled && (route.shift === 'ambos' ? shift !== 'noite' : route.shift === shift);
  const feePaid = !!route && enrolled && isMonthPaid(route, link.key, year, month);
  const notBoarded = !(route?.boardings || []).some((b) => b.personKey === link.key && b.date === date && b.shift === shift);
  const reasons: string[] = [];
  if (!person) reasons.push(REASON.unknown);
  else if (!enrolled) reasons.push(REASON.notEnrolled);
  else {
    if (!shiftOk) reasons.push(REASON.wrongShift);
    if (!feePaid) reasons.push(REASON.feeLate);
    if (!notBoarded) reasons.push(REASON.boarded);
  }
  const veh = route ? routeVehicle(db, route) : undefined;
  return {
    approved: reasons.length === 0,
    reasons,
    checks: { enrolled, shiftOk, feePaid, notBoarded },
    person,
    route: route ? { code: route.code, name: route.name, plate: veh?.plate || '', shift: route.shift } : undefined,
    month, date, shift
  };
}

export const makeBoarding = (key: TransportPersonKey, shift: TripShift, now = new Date()): TransportBoarding => ({
  personKey: key, date: isoDay(now), shift, at: now.toISOString()
});
