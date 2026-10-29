/**
 * Web Push SEM dependências (só WebCrypto): chaves VAPID (RFC 8292) e cifra da mensagem aes128gcm (RFC 8291 / RFC 8188).
 * Corre na Edge Function (Deno) e em Node 20+; testada em tests/webpush.test.ts (ida e volta + contra a biblioteca `http_ece`).
 *
 * O navegador do utilizador cria a subscrição com a chave PÚBLICA da escola (applicationServerKey) e entrega-nos
 *   { endpoint, p256dh, auth }.  Enviamos um POST cifrado a esse endpoint (serviço de push do Google/Mozilla/Apple/Microsoft),
 * assinado com a chave PRIVADA da escola, e o service worker (public/sw.js) mostra a notificação.
 */

const te = new TextEncoder();
const b64 = (u: Uint8Array): string => { let s = ''; u.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
export const b64url = (u: Uint8Array): string => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64url(s: string): Uint8Array {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
// Em Deno e Node recentes os tipos do WebCrypto pedem ArrayBuffer "puro"; copiamos para evitar SharedArrayBuffer/ArrayBufferLike.
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export class PushError extends Error { constructor(message: string) { super(message); this.name = 'PushError'; } }

// ---------- Chaves VAPID ----------
export interface VapidKeys {
  /** Ponto P-256 não comprimido (65 bytes) em base64url: é o que o navegador recebe (applicationServerKey). */
  publicKey: string;
  /** Escalar privado (32 bytes) em base64url. SÓ no servidor, cifrado. */
  privateKey: string;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  if (!jwk.d) throw new PushError('Não foi possível gerar as chaves.');
  return { publicKey: b64url(pub), privateKey: jwk.d };
}

export function isVapidPublicKey(k: unknown): k is string {
  if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(k)) return false;
  const u = unb64url(k);
  return u.length === 65 && u[0] === 0x04;
}
export const isVapidPrivateKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k) && unb64url(k).length === 32;

async function importPrivate(keys: VapidKeys): Promise<CryptoKey> {
  const pub = unb64url(keys.publicKey);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: keys.privateKey, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Confirma que a chave privada pertence mesmo à pública (assina e verifica). Útil quando a escola cola um par existente. */
export async function vapidPairMatches(keys: VapidKeys): Promise<boolean> {
  try {
    if (!isVapidPublicKey(keys.publicKey) || !isVapidPrivateKey(keys.privateKey)) return false;
    const sk = await importPrivate(keys);
    const pk = await crypto.subtle.importKey('raw', buf(unb64url(keys.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const msg = te.encode('bandmed-vapid-check');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sk, msg);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, sig, msg);
  } catch { return false; }
}

/** mailto:alguem@escola.ao ou https://escola.ao — o serviço de push usa-o para contactar a escola se houver abuso. */
export function cleanVapidSubject(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200) return s;
  if (/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(s) && s.length <= 200) return s;
  throw new PushError('O contacto VAPID tem de ser um e-mail (mailto:secretaria@escola.ao) ou um endereço https.');
}

/** Cabeçalho Authorization (RFC 8292): vapid t=<JWT ES256>, k=<chave pública>. */
export async function vapidAuthHeader(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await importPrivate(keys), te.encode(`${head}.${body}`)));   // r||s, 64 bytes: o formato do JWT
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.publicKey}`;
}

// ---------- Endereços de push aceites ----------
/** O navegador entrega o endereço; o servidor é que o chama. Só aceitamos os serviços de push conhecidos (evita pedidos para sítios internos). */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 700) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com' || h === 'android.googleapis.com'
    || h === 'push.services.mozilla.com' || h.endsWith('.push.services.mozilla.com')
    || h.endsWith('.push.apple.com') || h === 'push.apple.com'
    || h.endsWith('.notify.windows.com');
}

export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }

/** Valida o que o navegador entrega (PushSubscription.toJSON()). Lança PushError se for inválido. */
export function cleanSubscription(input: any): PushSubscriptionKeys {
  const endpoint = input?.endpoint, p256dh = input?.keys?.p256dh ?? input?.p256dh, auth = input?.keys?.auth ?? input?.auth;
  if (!isAllowedPushEndpoint(endpoint)) throw new PushError('Este navegador usa um serviço de push que não é suportado.');
  try {
    const k = unb64url(String(p256dh)), a = unb64url(String(auth));
    if (k.length !== 65 || k[0] !== 0x04 || a.length !== 16) throw new Error('tamanho');
  } catch { throw new PushError('Subscrição de push inválida.'); }
  return { endpoint, p256dh: String(p256dh), auth: String(auth) };
}

// ---------- Cifra da mensagem (RFC 8291, aes128gcm) ----------
const RECORD_SIZE = 4096;
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 16 /*tag*/ - 1 /*delimitador*/ - 86 /*cabeçalho*/;   // 3993

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/** Cifra `payload` para uma subscrição. `ephemeral`/`salt` só servem para testes com valores fixos. */
export async function encryptPayload(sub: { p256dh: string; auth: string }, payload: Uint8Array,
  fixed?: { salt?: Uint8Array; ephemeral?: CryptoKeyPair }): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new PushError('A mensagem é grande demais para um push.');
  let uaPublic: Uint8Array, authSecret: Uint8Array;
  try { uaPublic = unb64url(sub.p256dh); authSecret = unb64url(sub.auth); } catch { throw new PushError('Subscrição de push inválida.'); }
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new PushError('Subscrição de push inválida.');
  const eph = fixed?.ephemeral ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(ecdh, authSecret, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aes, buf(concat(payload, new Uint8Array([0x02])))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ---------- Envio ----------
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export interface PushOutcome {
  ok: boolean;
  status: number;
  /** a subscrição já não existe (404/410): apagar */
  gone: boolean;
  /** vale a pena tentar mais tarde (429, 5xx, rede) */
  retryable: boolean;
  error?: string;
}

export interface SendPushOptions {
  vapid: VapidKeys & { subject: string };
  /** segundos que o serviço de push guarda a mensagem se o aparelho estiver desligado (omissão: 1 dia) */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** mensagens com o mesmo tópico substituem-se */
  topic?: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

export async function sendWebPush(sub: PushSubscriptionKeys, payload: string | null, o: SendPushOptions): Promise<PushOutcome> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, status: 0, gone: true, retryable: false, error: 'Endereço de push não suportado.' };
  const headers: Record<string, string> = {
    Authorization: await vapidAuthHeader(sub.endpoint, o.vapid, o.vapid.subject),
    TTL: String(Math.min(Math.max(Math.trunc(o.ttl ?? 86_400), 0), 2_419_200)),
    Urgency: o.urgency ?? 'normal'
  };
  if (o.topic && /^[A-Za-z0-9_-]{1,32}$/.test(o.topic)) headers.Topic = o.topic;
  let body: BodyInit | undefined;
  if (payload !== null) {
    headers['Content-Encoding'] = 'aes128gcm';
    headers['Content-Type'] = 'application/octet-stream';
    body = buf(await encryptPayload(sub, te.encode(payload)));
  } else headers['Content-Length'] = '0';
  try {
    const res = await (o.fetchFn ?? ((u, i) => fetch(u, i)))(sub.endpoint, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    await res.arrayBuffer().catch(() => null);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, gone: false, retryable: false };
    if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, gone: true, retryable: false, error: 'O aparelho já não recebe notificações.' };
    if (res.status === 429 || res.status >= 500) return { ok: false, status: res.status, gone: false, retryable: true, error: `O serviço de push respondeu ${res.status}.` };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, gone: false, retryable: false, error: 'O serviço de push recusou a chave VAPID (subscrição feita com outra chave?).' };
    return { ok: false, status: res.status, gone: false, retryable: false, error: `O serviço de push recusou o pedido (${res.status}).` };
  } catch (e) {
    return { ok: false, status: 0, gone: false, retryable: true, error: /timeout|abort/i.test(String((e as Error)?.message ?? e)) ? 'O serviço de push demorou demasiado.' : 'Não foi possível contactar o serviço de push.' };
  }
}

/** Corpo que o service worker (public/sw.js) espera: { title, body, url, tag }. */
export function buildPushPayload(p: { title: string; body: string; url?: string; tag?: string }): string {
  const url = typeof p.url === 'string' && p.url.startsWith('/') && !p.url.startsWith('//') ? p.url.slice(0, 200) : '/';
  const out: Record<string, string> = { title: String(p.title).slice(0, 80), body: String(p.body).slice(0, 200), url };
  if (p.tag && /^[\w:.-]{1,60}$/.test(p.tag)) out.tag = p.tag;
  return JSON.stringify(out);
}
