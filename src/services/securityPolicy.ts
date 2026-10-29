/**
 * MOTOR DE POLÍTICAS DE SEGURANÇA
 * ===============================
 *
 * Tudo o que é parametrizado em Configurações → 7. Segurança & Backups deixa de
 * ser apenas um valor guardado e passa a produzir efeito real:
 *
 *   • Inatividade de Sessão ....... termina a sessão automaticamente.
 *   • Tentativas Falhadas ......... bloqueia o login após N falhas seguidas.
 *   • Validade da Senha ........... avisa e obriga à renovação da credencial.
 *   • Autenticação 2FA ............ exige 2.º fator ao Admin Geral e Direção.
 *   • Sub-redes Autorizadas (IP) .. restringe o acesso aos IP configurados (aplicado no SERVIDOR, migração 0043).
 *
 * Os valores são SEMPRE lidos da base de dados (`settings.securityPolicies` e
 * `settings.allowedIpRanges`), nunca de constantes locais: mudar a configuração
 * muda o comportamento na sessão seguinte de todos os utilizadores, sem tocar
 * em código.
 */

import { MFA_ENABLED } from './authSupabase';
import { supabase } from './supabase';
import { dbService } from './db';
import { User } from '../types';

export interface SecurityPolicies {
  twoFactorActive: boolean;
  /** Minutos de inatividade até a sessão ser terminada. 0 = desativado. */
  sessionTimeoutMinutes: number;
  /** Tentativas de login falhadas consecutivas permitidas. 0 = desativado. */
  maxFailedAttempts: number;
  /** Dias de validade da palavra-passe. 0 = nunca expira. */
  passwordExpirationDays: number;
  /** Intervalos/prefixos de IP autorizados. Vazio = sem restrição. */
  allowedIpRanges: string[];
}

const DEFAULTS: SecurityPolicies = {
  twoFactorActive: false,
  sessionTimeoutMinutes: 60,
  maxFailedAttempts: 5,
  passwordExpirationDays: 90,
  allowedIpRanges: []
};

function toNumber(value: unknown, fallback: number): number {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Lê as políticas em vigor diretamente da base de dados da instituição. */
export function getSecurityPolicies(): SecurityPolicies {
  let settings: any = {};
  try {
    settings = dbService.getDatabase()?.settings || {};
  } catch {
    settings = {};
  }
  const sec = settings.securityPolicies || {};
  return {
    twoFactorActive: sec.twoFactorActive === true,
    sessionTimeoutMinutes: toNumber(sec.sessionTimeout, DEFAULTS.sessionTimeoutMinutes),
    maxFailedAttempts: toNumber(sec.maxFailedAttempts, DEFAULTS.maxFailedAttempts),
    passwordExpirationDays: toNumber(sec.passwordExpirationDays, DEFAULTS.passwordExpirationDays),
    allowedIpRanges: Array.isArray(settings.allowedIpRanges) ? settings.allowedIpRanges.filter(Boolean) : []
  };
}

// ---------------------------------------------------------------------------
// 1. Tentativas de login falhadas
// ---------------------------------------------------------------------------
// ATENÇÃO: este contador é só conforto de interface (resposta rápida neste posto). A protecção REAL
// contra força bruta é o hook do servidor (supabase/migrations/0042_login_lockout.sql), que não se contorna
// limpando o localStorage nem mudando de navegador.
// O contador vive no próprio dispositivo (localStorage) e é apagado assim que
// a autenticação tem sucesso. O bloqueio dura 15 minutos, tal como a proteção
// anti-força-bruta do Firebase, e fica registado na auditoria.

const ATTEMPTS_KEY = 'bandmed_failed_logins';
const LOCK_MINUTES = 15;

interface AttemptRecord {
  count: number;
  lockedUntil?: number;
}

function readAttempts(): Record<string, AttemptRecord> {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAttempts(data: Record<string, AttemptRecord>) {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(data));
  } catch {
    // armazenamento indisponível: a política simplesmente não persiste
  }
}

function normalizeIdentifier(identifier: string): string {
  return (identifier || '').trim().toLowerCase();
}

/** Estado do bloqueio para um identificador (e-mail ou n.º de processo). */
export function getLoginLockState(identifier: string): { locked: boolean; remainingMinutes: number; attempts: number } {
  const policies = getSecurityPolicies();
  const key = normalizeIdentifier(identifier);
  const record = readAttempts()[key];
  if (!record) return { locked: false, remainingMinutes: 0, attempts: 0 };

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return {
      locked: true,
      remainingMinutes: Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / 60000)),
      attempts: record.count
    };
  }
  if (policies.maxFailedAttempts > 0 && record.count >= policies.maxFailedAttempts && !record.lockedUntil) {
    return { locked: true, remainingMinutes: LOCK_MINUTES, attempts: record.count };
  }
  return { locked: false, remainingMinutes: 0, attempts: record.count };
}

/** Regista uma tentativa falhada e devolve o estado resultante. */
export function registerFailedLogin(identifier: string): { locked: boolean; attempts: number; allowed: number } {
  const policies = getSecurityPolicies();
  const key = normalizeIdentifier(identifier);
  const store = readAttempts();
  const record = store[key] || { count: 0 };
  record.count += 1;

  const allowed = policies.maxFailedAttempts;
  let locked = false;
  if (allowed > 0 && record.count >= allowed) {
    record.lockedUntil = Date.now() + LOCK_MINUTES * 60_000;
    locked = true;
  }
  store[key] = record;
  writeAttempts(store);

  if (locked) {
    safeAudit({
      action: 'Bloqueio de Acesso por Tentativas Falhadas',
      details: `Credencial "${identifier}" bloqueada durante ${LOCK_MINUTES} minutos após ${record.count} tentativas falhadas (limite configurado: ${allowed}).`,
      userName: identifier
    });
  }

  return { locked, attempts: record.count, allowed };
}

/** Limpa o contador após uma autenticação bem-sucedida. */
export function clearFailedLogins(identifier: string) {
  const key = normalizeIdentifier(identifier);
  const store = readAttempts();
  if (store[key]) {
    delete store[key];
    writeAttempts(store);
  }
}

// ---------------------------------------------------------------------------
// 2. Validade da palavra-passe
// ---------------------------------------------------------------------------

export interface PasswordStatus {
  expired: boolean;
  daysRemaining: number | null;
  /** Avisar o utilizador (faltam 7 dias ou menos). */
  warning: boolean;
  lastChangeIso?: string;
}

/**
 * Compara a data da última alteração de credencial com a validade configurada.
 * Quando a conta ainda não tem data registada, ela é gravada no primeiro
 * arranque — a contagem passa a correr a partir desse momento.
 */
export function getPasswordStatus(user: User | null | undefined): PasswordStatus {
  const { passwordExpirationDays } = getSecurityPolicies();
  if (!user || passwordExpirationDays <= 0) {
    return { expired: false, daysRemaining: null, warning: false };
  }

  const lastChange = (user as any).passwordUpdatedAt as string | undefined;
  if (!lastChange) {
    return { expired: false, daysRemaining: passwordExpirationDays, warning: false };
  }

  const changedAt = new Date(lastChange).getTime();
  if (!Number.isFinite(changedAt)) {
    return { expired: false, daysRemaining: null, warning: false };
  }

  const ageDays = Math.floor((Date.now() - changedAt) / 86_400_000);
  const remaining = passwordExpirationDays - ageDays;
  return {
    expired: remaining <= 0,
    daysRemaining: remaining,
    warning: remaining > 0 && remaining <= 7,
    lastChangeIso: lastChange
  };
}

// ---------------------------------------------------------------------------
// 3. Sub-redes autorizadas (IP Whitelist)
// ---------------------------------------------------------------------------

/**
 * Verifica se um IP pertence a um dos intervalos configurados. Aceita:
 *   • IP exato ............ 197.218.10.4
 *   • Prefixo/sub-rede .... 197.218.10.  ou  197.218.10.0/24
 *   • Intervalo ........... 197.218.10.1-197.218.10.60
 */
export function isIpAllowed(ip: string, ranges: string[] = getSecurityPolicies().allowedIpRanges): boolean {
  if (!ranges || ranges.length === 0) return true; // sem restrição configurada
  if (!ip) return true; // IP desconhecido: não se bloqueia às cegas

  const toLong = (addr: string): number | null => {
    const parts = addr.trim().split('.');
    if (parts.length !== 4) return null;
    let total = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      total = total * 256 + n;
    }
    return total;
  };

  const target = toLong(ip);

  return ranges.some((raw) => {
    const range = String(raw).trim();
    if (!range) return false;

    if (range.includes('/')) {
      const [base, bitsRaw] = range.split('/');
      const bits = Number(bitsRaw);
      const baseLong = toLong(base);
      if (target === null || baseLong === null || !Number.isInteger(bits)) return false;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (target & mask) === (baseLong & mask);
    }

    if (range.includes('-')) {
      const [from, to] = range.split('-').map((s) => toLong(s));
      if (target === null || from === null || to === null) return false;
      return target >= from && target <= to;
    }

    if (range.endsWith('.')) {
      return ip.startsWith(range);
    }

    return ip.trim() === range;
  });
}

/**
 * Sub-redes autorizadas: a decisão é do SERVIDOR (migração 0043). O IP vem do cabeçalho que o Cloudflare/Supabase
 * acrescenta ao pedido, não do navegador (antes: api.ipify.org + decisão no cliente + falha em aberto).
 * Mesmo que esta verificação seja contornada no navegador, a RLS recusa os dados a quem estiver fora da lista.
 * Aqui só se pergunta o estado para mostrar uma mensagem clara em vez de uma aplicação vazia.
 */
export async function enforceIpPolicy(): Promise<{ allowed: boolean; ip: string | null }> {
  try {
    const { data, error } = await supabase.rpc('ip_access_status');
    if (error || !data) return { allowed: true, ip: null };      // rede em baixo: a RLS continua a proteger os dados
    return { allowed: data.blocked !== true, ip: typeof data.ip === 'string' ? data.ip : null };
  } catch {
    return { allowed: true, ip: null };
  }
}

export interface IpPolicy { ranges: string[]; roles: string[]; ip: string | null }

/** Administrador/direcção: lista actual guardada no servidor e o IP que o servidor vê neste momento. */
export async function loadIpPolicy(): Promise<IpPolicy | null> {
  const { data, error } = await supabase.rpc('get_ip_policy');
  if (error || !data) return null;
  return { ranges: data.ranges ?? [], roles: data.roles ?? [], ip: data.ip ?? null };
}

/** Só o administrador. O servidor recusa se o IP actual do administrador não estiver na nova lista. */
export async function saveIpPolicy(ranges: string[], roles?: string[]): Promise<{ success: boolean; error?: string; policy?: IpPolicy }> {
  const { data, error } = await supabase.rpc('set_ip_policy', { p_ranges: ranges, p_roles: roles ?? null });
  if (error) return { success: false, error: error.message };
  return { success: true, policy: { ranges: data?.ranges ?? [], roles: data?.roles ?? [], ip: data?.ip ?? null } };
}

// ---------------------------------------------------------------------------
// 4. Autenticação de dois fatores
// ---------------------------------------------------------------------------

/** Perfis a quem o 2FA é obrigatório quando a política está ativa. */
const TWO_FACTOR_ROLES = ['admin', 'director'];

export function requiresTwoFactor(role: string | undefined): boolean {
  if (!MFA_ENABLED) return false;   // 2FA desligado: sem aviso no banner
  const { twoFactorActive } = getSecurityPolicies();
  return twoFactorActive && !!role && TWO_FACTOR_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Auditoria auxiliar
// ---------------------------------------------------------------------------

function safeAudit(entry: { action: string; details: string; userName?: string }) {
  try {
    const current = dbService.getDatabase()?.currentUser;
    dbService.addAuditLog({
      userName: entry.userName || current?.name || 'Sistema',
      userRole: current?.roleTitle || 'Sistema',
      action: entry.action,
      details: entry.details,
      module: 'sistema',
      timestamp: new Date().toLocaleString('pt-PT'),
      badgeColor: '#b91c1c'
    } as any);
  } catch {
    // auditoria é best-effort: nunca bloqueia a operação de segurança
  }
}

export const securityAudit = safeAudit;
