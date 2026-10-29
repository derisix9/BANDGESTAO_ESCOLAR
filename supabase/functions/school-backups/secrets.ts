/**
 * Cifra das credenciais do destino (AES-256-GCM) e assinatura do "state" do OAuth (HMAC-SHA256). Só WebCrypto.
 * A chave vem de BACKUP_SECRETS_KEY (≥ 32 caracteres), NUNCA da base de dados. O id da escola entra como AAD:
 * um texto cifrado copiado para outra escola não abre.
 */
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (u: Uint8Array): string => { let s = ''; u.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (u: Uint8Array): string => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s: string): Uint8Array => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export class SecretsError extends Error { constructor(message: string) { super(message); this.name = 'SecretsError'; } }

export function assertMasterKey(key: string | undefined | null): string {
  if (!key || key.length < 32) throw new SecretsError('BACKUP_SECRETS_KEY em falta ou com menos de 32 caracteres (supabase secrets set BACKUP_SECRETS_KEY=...).');
  return key;
}
async function aesKey(master: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', te.encode('bandmed-backup-secrets|' + assertMasterKey(master)));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}
export async function encryptSecret(master: string, institutionId: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(institutionId) }, await aesKey(master, ['encrypt']), te.encode(JSON.stringify(value)));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}
export async function decryptSecret<T = any>(master: string, institutionId: string, token: string): Promise<T> {
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token || '');
  if (!m) throw new SecretsError('Credenciais guardadas num formato desconhecido. Volte a ligar o destino.');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(m[1]), additionalData: te.encode(institutionId) }, await aesKey(master, ['decrypt']), unb64url(m[2]));
    return JSON.parse(td.decode(pt)) as T;
  } catch {
    throw new SecretsError('Não foi possível abrir as credenciais guardadas (chave do servidor alterada?). Volte a ligar o destino.');
  }
}
async function hmacKey(master: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', te.encode('bandmed-oauth-state|' + assertMasterKey(master)), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
export async function signState(master: string, payload: Record<string, unknown>, now = Date.now(), ttlMs = 10 * 60_000): Promise<string> {
  const body = b64url(te.encode(JSON.stringify({ ...payload, exp: now + ttlMs })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(master, ['sign']), te.encode(body)));
  return `${body}.${b64url(sig)}`;
}
export async function verifyState<T extends Record<string, unknown>>(master: string, state: string, now = Date.now()): Promise<T | null> {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(master, ['verify']), unb64url(sig), te.encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const p = JSON.parse(td.decode(unb64url(body)));
    return typeof p?.exp === 'number' && p.exp > now ? (p as T) : null;
  } catch { return null; }
}
export function safeEqual(a: unknown, b: unknown): boolean {
  const x = te.encode(String(a ?? '')), y = te.encode(String(b ?? ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
