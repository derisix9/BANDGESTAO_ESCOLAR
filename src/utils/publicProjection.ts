/**
 * Registo público de UMA pessoa para os QR / códigos de barras (lido sem login).
 * DADOS MÍNIMOS: só o que é preciso para confirmar que o cartão é autêntico e activo
 * (nome, nº, turma/departamento, estado) e, no passe de transporte, a rota da própria pessoa.
 * NUNCA entram: BI, NIF, morada, telefone, e-mail, IBAN, saúde, notas/histórico, folha de pagamento,
 * facturas ou dados de outras pessoas. O servidor ainda impõe validade e revogação (public_tokens).
 */
import type { SchoolDatabase } from '../types';
import { enrollmentOf, parsePersonKey, routeVehicle } from './transportPass';

export interface PublicRecord {
  v: 2;
  inst: string;
  key: string;
  kind: 'student' | 'docente' | 'funcionario';
  updatedAt: string;
  slice: Partial<SchoolDatabase>;
}

/** Só fotografias leves (URL ou imagem pequena) e só no passe de transporte, para o motorista conferir a pessoa. */
const MAX_PHOTO = 20000;
const lightPhoto = (v?: string): string => (typeof v === 'string' && v.length <= MAX_PHOTO ? v : '');

export function buildPublicRecord(db: SchoolDatabase, key: string, inst: string): PublicRecord | null {
  const p = parsePersonKey(key);
  if (!p) return null;
  const s = db.settings as any;
  const settings = { schoolName: s?.schoolName, currentAcademicYear: s?.currentAcademicYear } as any;
  const slice: Partial<SchoolDatabase> = { settings };
  const route = enrollmentOf(db, key);

  if (p.kind === 'student') {
    const st = (db.students || []).find((x) => String(x.id) === p.id) as any;
    if (!st) return null;
    slice.students = [{
      id: st.id, name: st.name, procNumber: st.procNumber, className: st.className, grade: st.grade, status: st.status,
      ...(route ? { docPassPhoto: lightPhoto(st.docPassPhoto || st.avatar) } : {})
    } as any];
  } else if (p.kind === 'docente') {
    const t = (db.teachers || []).find((x) => String(x.id) === p.id) as any;
    if (!t) return null;
    slice.teachers = [{ id: t.id, name: t.name, department: t.department, status: t.status, ...(route ? { avatar: lightPhoto(t.avatar) } : {}) } as any];
  } else {
    const f = (db.funcionarios || []).find((x) => String(x.id) === p.id) as any;
    if (!f) return null;
    slice.funcionarios = [{ id: f.id, name: f.name, cargo: f.cargo, department: f.department, status: f.status, ...(route ? { avatar: lightPhoto(f.avatar) } : {}) } as any];
  }

  // Passe de transporte: só a rota desta pessoa, reduzida a ela própria.
  if (route) {
    const mine = (arr?: string[]) => (arr || []).filter((id) => key === `${p.kind === 'student' ? 's' : p.kind === 'docente' ? 't' : 'f'}:${id}`);
    slice.transportRoutes = [{
      id: route.id, code: route.code, name: route.name, vehicleId: route.vehicleId, shift: route.shift, stops: route.stops, status: route.status, createdAt: route.createdAt,
      studentIds: mine(route.studentIds), teacherIds: mine(route.teacherIds), funcionarioIds: mine(route.funcionarioIds),
      payments: (route.payments || []).filter((x) => x.personKey === key).slice(-14),
      boardings: (route.boardings || []).filter((x) => x.personKey === key).slice(-6)
    } as any];
    const veh = routeVehicle(db, route);
    if (veh) slice.vehicles = [{ id: veh.id, plate: veh.plate, capacity: veh.capacity } as any];
  }
  const rec: PublicRecord = { v: 2, inst, key, kind: p.kind, updatedAt: new Date().toISOString(), slice };
  // O servidor limita o payload a 4 KB: se passar, corta primeiro os embarques e depois as paragens.
  if (JSON.stringify(rec).length > 3500 && slice.transportRoutes?.[0]) { (slice.transportRoutes[0] as any).boardings = []; }
  if (JSON.stringify(rec).length > 3500 && slice.transportRoutes?.[0]) { (slice.transportRoutes[0] as any).stops = []; }
  return rec;
}

/** Hash curto do conteúdo (ignora updatedAt) para só escrever na nuvem o que mudou. */
export function recordHash(r: PublicRecord): string {
  const str = JSON.stringify({ ...r, updatedAt: '' });
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h >>> 0}`;
}

/** Base de dados "de bolso" com só o registo público, para reutilizar as páginas de consulta existentes. */
export function recordToDb(r: PublicRecord): SchoolDatabase {
  return { students: [], teachers: [], funcionarios: [], invoices: [], payrollRecords: [], transportRoutes: [], vehicles: [], ...(r.slice as any) } as SchoolDatabase;
}
