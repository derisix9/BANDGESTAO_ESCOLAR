/**
 * Verificação PRÉVIA dos limites do plano (alunos, utilizadores, armazenamento).
 *
 * O servidor já recusa o excesso (migrações 0020/0025), mas a app guarda primeiro no aparelho e só depois
 * sincroniza — por isso o registo aparecia e o aviso vinha tarde. Aqui consulta-se o estado do plano (RPC
 * `my_plan_status`, migração 0032) e recusa-se ANTES de gravar, com a mesma janela de aviso.
 *
 *   guardPlan('alunos')       → alunos cheios OU armazenamento cheio
 *   guardPlan('utilizadores') → utilizadores cheios OU armazenamento cheio
 *   guardPlan('armazenamento')→ só armazenamento (qualquer outro cadastro)
 *
 * Falha em aberto: sem rede/sem a migração/plano ilimitado, nada é bloqueado aqui (o servidor continua a ser a regra final).
 */
import { supabase } from '../services/supabase';
import { reportPlanLimit, type PlanLimitKind } from './planLimits';

export interface PlanStatus {
  limits: { students: number | null; users: number | null; storageBytes: number | null };
  usage: { students: number; users: number; storageBytes: number };
  blocked: { students: boolean; users: boolean; storage: boolean };
}

const STALE_MS = 30_000;
let status: PlanStatus | null = null;
let fetchedAt = 0;
let inflight: Promise<PlanStatus | null> | null = null;

const MSG: Record<PlanLimitKind, (s: PlanStatus) => string> = {
  alunos: (s) => `O plano permite ${s.limits.students} alunos e já foram atingidos. Peça um plano maior para cadastrar mais.`,
  utilizadores: (s) => `O plano permite ${s.limits.users} utilizadores e já foram atingidos. Desative um utilizador ou peça um plano maior.`,
  armazenamento: () => 'O armazenamento do plano está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
};

/** Vai buscar o estado ao servidor (no máximo uma chamada de cada vez). */
export function refreshPlanStatus(force = false): Promise<PlanStatus | null> {
  if (!force && status && Date.now() - fetchedAt < STALE_MS) return Promise.resolve(status);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('my_plan_status');
      if (!error && data) { status = data as PlanStatus; fetchedAt = Date.now(); }
    } catch { /* offline: mantém o último estado conhecido */ }
    finally { inflight = null; }
    return status;
  })();
  return inflight;
}

export function clearPlanStatus() { status = null; fetchedAt = 0; }

/** Qual limite está atingido para esta acção (null = pode avançar). */
export function planBlock(kind: PlanLimitKind): { kind: PlanLimitKind; message: string } | null {
  const s = status;
  if (!s) return null;
  if (kind === 'alunos' && s.blocked.students) return { kind, message: MSG.alunos(s) };
  if (kind === 'utilizadores' && s.blocked.users) return { kind, message: MSG.utilizadores(s) };
  if (s.blocked.storage) return { kind: 'armazenamento', message: MSG.armazenamento(s) };
  return null;
}

/** Sincrónico, com o último estado conhecido: avisa a interface e devolve false se estiver bloqueado. */
export function guardPlan(kind: PlanLimitKind): boolean {
  void refreshPlanStatus();                    // mantém o estado fresco para a próxima vez
  const b = planBlock(kind);
  if (!b) return true;
  reportPlanLimit(`LIMITE_PLANO:${b.kind} — ${b.message}`);
  return false;
}

/** Como `guardPlan`, mas confirma primeiro no servidor se o estado estiver desactualizado. */
export async function guardPlanFresh(kind: PlanLimitKind): Promise<boolean> {
  await refreshPlanStatus();
  return guardPlan(kind);
}

/** Depois de cadastrar com sucesso: actualiza o contador local para bloquear já o próximo, sem esperar pelo servidor. */
export function notePlanUse(kind: 'alunos' | 'utilizadores', n = 1) {
  if (!status) return;
  if (kind === 'alunos') {
    status.usage.students += n;
    if (status.limits.students !== null && status.usage.students >= status.limits.students) status.blocked.students = true;
  } else {
    status.usage.users += n;
    if (status.limits.users !== null && status.usage.users >= status.limits.users) status.blocked.users = true;
  }
  fetchedAt = 0;                                // força nova leitura ao servidor na próxima verificação
}

/** Erro lançado por operações bloqueadas pelo plano (a mensagem já é a que o utilizador deve ver). */
export class PlanLimitBlocked extends Error {
  constructor(public kind: PlanLimitKind, message: string) { super(`LIMITE_PLANO:${kind} — ${message}`); this.name = 'PlanLimitBlocked'; }
}

/** Lança PlanLimitBlocked (e avisa a interface) se o limite estiver atingido. */
export function assertPlan(kind: PlanLimitKind): void {
  const b = planBlock(kind);
  if (!b) return;
  reportPlanLimit(`LIMITE_PLANO:${b.kind} — ${b.message}`);
  throw new PlanLimitBlocked(b.kind, b.message);
}
