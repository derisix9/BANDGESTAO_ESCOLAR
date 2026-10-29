/**
 * Entrada OFFLINE de perfis com 2FA (admin, director, financeiro) — passo 8 da auditoria.
 * Antes: sem rede, a app aceitava o perfil guardado no aparelho como se o 2FA tivesse sido feito (mfaOk = usedCachedProfile),
 * sem pedir nada. Agora, nesses perfis, entrar sem rede exige:
 *   1) um "arrendamento" (lease) criado num login ONLINE completo (palavra-passe + 2FA), com no máximo N dias;
 *   2) a palavra-passe outra vez. O lease está cifrado (AES-GCM) com uma chave derivada da palavra-passe (PBKDF2-SHA256, 600 000
 *      iterações): só quem a sabe consegue abri-lo, e quem altera o ficheiro é apanhado pela autenticação do AES-GCM.
 * O lease não dá acesso a dados do servidor (isso continua a exigir a sessão e a RLS): só autoriza abrir a cópia local.
 */
import type { KeyValueStore } from './localDataPolicy';

export const LEASE_KEY = 'bm_offline_lease';
export const SALT_KEY = 'bm_vault_salt';
export const OFFLINE_OK_KEY = 'bm_offline_ok';          // sessionStorage: já desbloqueado neste separador
export const PBKDF2_ITERATIONS = 600_000;
export const DEFAULT_LEASE_DAYS = 7;

interface Store extends KeyValueStore { setItem(k: string, v: string): void }
export interface LeaseData { uid: string; role: string; mfa: boolean; at: number }

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function saltFor(store: Store): BufferSource {
  const have = store.getItem(SALT_KEY);
  if (have) { try { return unb64(have); } catch { /* corrompido: gera outro */ } }
  const s = crypto.getRandomValues(new Uint8Array(16));
  store.setItem(SALT_KEY, b64(s));
  return s;
}

async function deriveKey(password: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Guarda o lease depois de um login online completo. `iterations` só se altera nos testes. */
export async function writeOfflineLease(store: Store, password: string, data: Omit<LeaseData, 'at'>, iterations = PBKDF2_ITERATIONS, now = Date.now()): Promise<void> {
  const key = await deriveKey(password, saltFor(store), iterations);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: LeaseData = { ...data, at: now };
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(data.uid) }, key, enc.encode(JSON.stringify(payload))));
  store.setItem(LEASE_KEY, JSON.stringify({ v: 1, it: iterations, uid: data.uid, iv: b64(iv), ct: b64(ct) }));
}

export type LeaseCheck = { ok: true; lease: LeaseData } | { ok: false; reason: 'sem-lease' | 'palavra-passe' | 'expirado' | 'sem-2fa' | 'outra-conta' };

/** Abre o lease com a palavra-passe e valida conta, idade e 2FA. */
export async function openOfflineLease(store: Store, password: string, uid: string, opts: { maxDays?: number; requireMfa?: boolean; now?: number } = {}): Promise<LeaseCheck> {
  const raw = store.getItem(LEASE_KEY);
  if (!raw) return { ok: false, reason: 'sem-lease' };
  let box: { it: number; uid: string; iv: string; ct: string };
  try { box = JSON.parse(raw); } catch { return { ok: false, reason: 'sem-lease' }; }
  if (box.uid !== uid) return { ok: false, reason: 'outra-conta' };
  let lease: LeaseData;
  try {
    const key = await deriveKey(password, saltFor(store), box.it || PBKDF2_ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(uid) }, key, unb64(box.ct));
    lease = JSON.parse(dec.decode(pt));
  } catch { return { ok: false, reason: 'palavra-passe' }; }       // palavra-passe errada OU ficheiro alterado
  if (lease.uid !== uid) return { ok: false, reason: 'outra-conta' };
  const ageDays = ((opts.now ?? Date.now()) - lease.at) / 86_400_000;
  if (ageDays > (opts.maxDays ?? DEFAULT_LEASE_DAYS) || ageDays < -0.01) return { ok: false, reason: 'expirado' };
  if (opts.requireMfa && !lease.mfa) return { ok: false, reason: 'sem-2fa' };
  return { ok: true, lease };
}

export const clearOfflineLease = (store: Store & { removeItem(k: string): void }) => { try { store.removeItem(LEASE_KEY); } catch { /* ignore */ } };

/** Marca este separador como desbloqueado (sobrevive a recarregar a página, não a fechar o navegador). */
export const markOfflineUnlocked = (session: Store, uid: string) => session.setItem(OFFLINE_OK_KEY, uid);
export const isOfflineUnlocked = (session: Store, uid: string) => session.getItem(OFFLINE_OK_KEY) === uid;

export const leaseMessage = (r: Extract<LeaseCheck, { ok: false }>['reason']): string => ({
  'sem-lease': 'Este aparelho ainda não foi autorizado para trabalhar sem internet. Ligue-se à internet e inicie sessão.',
  'palavra-passe': 'Palavra-passe incorrecta.',
  'expirado': 'A autorização para trabalhar sem internet expirou. Ligue-se à internet e inicie sessão.',
  'sem-2fa': 'O último acesso neste aparelho não teve a verificação em dois passos. Ligue-se à internet e inicie sessão.',
  'outra-conta': 'Este aparelho foi autorizado para outra conta.'
}[r]);
