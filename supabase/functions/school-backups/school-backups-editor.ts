// school-backups (ficheiro único para o editor do Supabase). Desligue 'Verify JWT'. Segredos: BACKUP_SECRETS_KEY, BACKUP_CRON_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_ORIGIN.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createHash, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

const enc = (s: string, keepSlash = false): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, keepSlash ? '/' : '%2F');

interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  date?: Date;
}

function signV4(i: SignInput): Record<string, string> {
  const u = new URL(i.url);
  const d = (i.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = d.slice(0, 8);
  const service = i.service ?? 's3';
  const payloadHash = sha256Hex(i.body ?? '');

  const all: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-date': d, 'x-amz-content-sha256': payloadHash };
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) norm[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(norm).sort();
  const canonHeaders = names.map((n) => `${n}:${norm[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const q: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => q.push([enc(k), enc(v)]));
  q.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const canonQuery = q.map(([k, v]) => `${k}=${v}`).join('&');
  const canonPath = u.pathname.split('/').map((seg) => enc(decodeURIComponent(seg))).join('/') || '/';

  const canonical = [i.method.toUpperCase(), canonPath, canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', d, scope, sha256Hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + i.secretAccessKey, day), i.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');

  const out: Record<string, string> = { ...norm };
  delete out.host;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

class ConfigError extends Error { constructor(message: string) { super(message); this.name = 'ConfigError'; } }

const PROVIDERS = ['s3', 'gdrive'] as const;
type Provider = (typeof PROVIDERS)[number];
const isProvider = (v: unknown): v is Provider => (PROVIDERS as readonly string[]).includes(v as string);

const RETENTION_OPTIONS = [0, 7, 14, 30, 60, 90, 180, 365] as const;
const SCHOOL_TZ_OFFSET_MIN = 60;

function cleanSchedule(runHour: unknown, retentionDays: unknown): { runHour: number; retentionDays: number } {
  const h = Number(runHour);
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new ConfigError('Hora inválida (0 a 23).');
  const r = Number(retentionDays);
  if (!(RETENTION_OPTIONS as readonly number[]).includes(r)) throw new ConfigError('Período de retenção inválido.');
  return { runHour: h, retentionDays: r };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_SUFFIX = ['.local', '.localhost', '.internal', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.cluster.local'];

function checkS3Endpoint(raw: unknown): string {
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new ConfigError('Endereço (endpoint) inválido. Exemplo: https://s3.us-west-004.backblazeb2.com'); }
  if (u.protocol !== 'https:') throw new ConfigError('O endereço tem de começar por https://');
  if (u.username || u.password) throw new ConfigError('O endereço não pode conter utilizador/palavra-passe.');
  if (u.port && u.port !== '443') throw new ConfigError('Só é permitida a porta 443 (HTTPS normal).');
  if (u.pathname !== '/' && u.pathname !== '') throw new ConfigError('O endereço deve ser só o domínio, sem caminho (o bucket indica-se à parte).');
  if (u.search || u.hash) throw new ConfigError('O endereço não pode ter parâmetros.');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.startsWith('[') || h.includes(':') || IPV4.test(h) || h === 'localhost' || BLOCKED_SUFFIX.some((s) => h.endsWith(s))) {
    throw new ConfigError('O endereço tem de ser um nome de domínio público (não IPs nem endereços internos).');
  }
  if (!/^[a-z0-9.-]+$/.test(h)) throw new ConfigError('Nome de domínio inválido.');
  return `https://${h}`;
}

interface S3Config { endpoint: string; region: string; bucket: string; prefix: string }
interface S3Secret { accessKeyId: string; secretAccessKey: string }

function cleanS3Config(c: any): S3Config {
  const endpoint = checkS3Endpoint(c?.endpoint);
  const region = String(c?.region ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw new ConfigError('Região inválida (ex.: us-west-004, eu-central-2, auto).');
  const bucket = String(c?.bucket ?? '').trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new ConfigError('Nome do bucket inválido (3 a 63 caracteres: minúsculas, números, ponto e hífen).');
  const prefix = String(c?.prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (prefix && (prefix.length > 100 || prefix.includes('..') || prefix.includes('//') || !/^[A-Za-z0-9_.\-/]+$/.test(prefix))) {
    throw new ConfigError('Pasta inválida (letras, números, _ - . e /; sem "..").');
  }
  return { endpoint, region, bucket, prefix };
}

function cleanS3Secret(s: any): S3Secret {
  const accessKeyId = String(s?.accessKeyId ?? '').trim();
  const secretAccessKey = String(s?.secretAccessKey ?? '').trim();
  if (!/^[A-Za-z0-9/+=_-]{8,128}$/.test(accessKeyId)) throw new ConfigError('Chave de acesso (Access Key ID) inválida.');
  if (secretAccessKey.length < 8 || secretAccessKey.length > 256 || /\s/.test(secretAccessKey)) throw new ConfigError('Chave secreta (Secret Access Key) inválida.');
  return { accessKeyId, secretAccessKey };
}

const slugify = (s: string): string =>
  (s || 'escola').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'escola';

function backupFileName(schoolName: string, when: Date = new Date()): string {
  const l = new Date(when.getTime() + SCHOOL_TZ_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `bandmed_${slugify(schoolName)}_${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}_${p(l.getUTCHours())}${p(l.getUTCMinutes())}.json`;
}

function backupFileDate(name: string, schoolName: string): number | null {
  const m = new RegExp(`^bandmed_${slugify(schoolName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{4})-(\\d{2})-(\\d{2})_\\d{4}\\.json$`).exec(name);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

function selectExpired(names: string[], schoolName: string, keepDays: number, now: number = Date.now(), minKeep = 3): string[] {
  if (!keepDays || keepDays <= 0) return [];
  const dated = names.map((n) => ({ n, t: backupFileDate(n, schoolName) })).filter((x): x is { n: string; t: number } => x.t !== null)
    .sort((a, b) => b.t - a.t || (a.n < b.n ? 1 : -1));
  const cutoff = now - keepDays * 86_400_000;
  return dated.slice(minKeep).filter((x) => x.t < cutoff).map((x) => x.n);
}

function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? 'Erro desconhecido');
  return m.replace(/\s+/g, ' ').slice(0, 300);
}

const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (u: Uint8Array): string => { let s = ''; u.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u: Uint8Array): string => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string): Uint8Array => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

class SecretsError extends Error { constructor(message: string) { super(message); this.name = 'SecretsError'; } }

function assertMasterKey(key: string | undefined | null): string {
  if (!key || key.length < 32) throw new SecretsError('BACKUP_SECRETS_KEY em falta ou com menos de 32 caracteres (supabase secrets set BACKUP_SECRETS_KEY=...).');
  return key;
}
async function aesKey(master: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', te.encode('bandmed-backup-secrets|' + assertMasterKey(master)));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}
async function encryptSecret(master: string, institutionId: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(institutionId) }, await aesKey(master, ['encrypt']), te.encode(JSON.stringify(value)));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}
async function decryptSecret<T = any>(master: string, institutionId: string, token: string): Promise<T> {
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
async function signState(master: string, payload: Record<string, unknown>, now = Date.now(), ttlMs = 10 * 60_000): Promise<string> {
  const body = b64url(te.encode(JSON.stringify({ ...payload, exp: now + ttlMs })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(master, ['sign']), te.encode(body)));
  return `${body}.${b64url(sig)}`;
}
async function verifyState<T extends Record<string, unknown>>(master: string, state: string, now = Date.now()): Promise<T | null> {
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
function safeEqual(a: unknown, b: unknown): boolean {
  const x = te.encode(String(a ?? '')), y = te.encode(String(b ?? ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

const xmlText = (s: string, tag: string): string[] =>
  [...s.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));

interface S3Options { fetch?: typeof fetch; retries?: number; retryDelayMs?: number; timeoutMs?: number }

class S3Client {
  private pre: string;
  private f: typeof fetch;
  constructor(private cfg: S3Config, private secret: S3Secret, private opt: S3Options = {}) {
    this.pre = cfg.prefix ? cfg.prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
    this.f = opt.fetch ?? fetch;
  }
  private url(key: string, query = ''): string {
    return `${this.cfg.endpoint}/${this.cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}${query}`;
  }
  private async call(method: string, key: string, query = '', body?: Uint8Array, ok: number[] = [200]): Promise<Response> {
    const url = this.url(key, query);
    const attempts = (this.opt.retries ?? 2) + 1;
    let last = 'sem resposta';
    for (let a = 0; a < attempts; a++) {
      try {
        const headers = signV4({ method, url, body: body ? Buffer.from(body) : undefined, region: this.cfg.region, accessKeyId: this.secret.accessKeyId, secretAccessKey: this.secret.secretAccessKey });
        const res = await this.f(url, { method, headers, body: body as any, signal: AbortSignal.timeout(this.opt.timeoutMs ?? 120_000), redirect: 'error' });
        if (ok.includes(res.status)) return res;
        const txt = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        last = `HTTP ${res.status} ${txt}`;
        if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(last), { final: true });
      } catch (e: any) {
        if (e?.final) throw new Error(`O armazenamento recusou o pedido: ${hint(e.message)}`);
        last = e instanceof Error ? e.message : String(e);
      }
      if (a < attempts - 1) await new Promise((r) => setTimeout(r, (this.opt.retryDelayMs ?? 500) * 2 ** a));
    }
    throw new Error(`O armazenamento está indisponível: ${last}`);
  }
  async put(name: string, body: Uint8Array): Promise<void> { await this.call('PUT', this.pre + name, '', body, [200]); }
  async delete(name: string): Promise<void> { await this.call('DELETE', this.pre + name, '', undefined, [200, 204, 404]); }
  async list(): Promise<string[]> {
    const out: string[] = [];
    let token = '';
    for (let page = 0; page < 200; page++) {
      const q = `?list-type=2&prefix=${encodeURIComponent(this.pre)}&delimiter=%2F` + (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
      const xml = await (await this.call('GET', '', q, undefined, [200])).text();
      for (const k of xmlText(xml, 'Key')) if (k.startsWith(this.pre) && k.length > this.pre.length) out.push(k.slice(this.pre.length));
      const next = xmlText(xml, 'NextContinuationToken')[0];
      if (xmlText(xml, 'IsTruncated')[0] === 'true' && next) token = next; else break;
    }
    return out;
  }
}

function hint(msg: string): string {
  if (/403|SignatureDoesNotMatch|InvalidAccessKeyId/i.test(msg)) return `${msg} — confirme a chave de acesso, a chave secreta e a região.`;
  if (/NoSuchBucket|404/i.test(msg)) return `${msg} — o bucket não existe nesse endereço/região.`;
  if (/AccessDenied/i.test(msg)) return `${msg} — a chave não tem permissão de escrita/listagem/apagar neste bucket.`;
  return msg;
}

const DRIVE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = 'BandMed Backups';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface GoogleApp { clientId: string; clientSecret: string }
type F = typeof fetch;

async function driveFail(res: Response, what: string): Promise<never> {
  let m = '';
  try { const j = await res.json(); m = j?.error?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : ''); } catch { /* sem JSON */ }
  const extra = res.status === 401 || /invalid_grant/i.test(m) ? ' — a ligação ao Google Drive expirou ou foi revogada; volte a ligar.'
    : res.status === 403 ? ' — sem permissão ou quota/limite do Google atingido.' : '';
  throw new Error(`Google Drive (${what}): HTTP ${res.status} ${String(m).slice(0, 160)}${extra}`);
}

function drvAuthUrl(app: GoogleApp, redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  return `${AUTH}?${p}`;
}

async function drvExchangeCode(app: GoogleApp, redirectUri: string, code: string, f: F = fetch): Promise<{ refreshToken: string; email: string }> {
  const res = await f(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  if (!res.ok) await driveFail(res, 'ligação');
  const j: any = await res.json();
  if (!j.refresh_token) throw new Error('O Google não devolveu autorização permanente. Remova o acesso do BandMed em myaccount.google.com/permissions e ligue de novo.');
  let email = '';
  try { email = JSON.parse(atob(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { /* sem e-mail */ }
  return { refreshToken: String(j.refresh_token), email };
}

async function drvAccessToken(app: GoogleApp, refreshToken: string, f: F = fetch): Promise<string> {
  const res = await f(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  if (!res.ok) await driveFail(res, 'autorização');
  return String(((await res.json()) as any).access_token);
}

async function drvRevoke(refreshToken: string, f: F = fetch): Promise<void> {
  try { await f(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) }); } catch { /* melhor esforço */ }
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function drvEnsureFolder(token: string, knownId?: string | null, f: F = fetch): Promise<string> {
  if (knownId) {
    const r = await f(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`, { headers: bearer(token) });
    if (r.ok) { const j: any = await r.json(); if (!j.trashed) return String(j.id); }
    else if (r.status !== 404) await driveFail(r, 'pasta');
  }
  const q = `name='${esc(DRIVE_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const s = await f(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: bearer(token) });
  if (!s.ok) await driveFail(s, 'pasta');
  const found = ((await s.json()) as any).files?.[0]?.id;
  if (found) return String(found);
  const c = await f(`${API}/files?fields=id`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) });
  if (!c.ok) await driveFail(c, 'criar pasta');
  return String(((await c.json()) as any).id);
}

async function drvUploadFile(token: string, folderId: string, name: string, body: Uint8Array, mime: string, f: F = fetch): Promise<string> {
  const init = await f(`${UPLOAD}/files?uploadType=resumable&fields=id`, { method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(body.byteLength) },
    body: JSON.stringify({ name, parents: [folderId] }) });
  if (!init.ok) await driveFail(init, 'iniciar envio');
  const loc = init.headers.get('location');
  if (!loc || !/^https:\/\/[a-z0-9.-]*googleapis\.com\//i.test(loc)) throw new Error('Google Drive: resposta de envio inesperada.');
  const put = await f(loc, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(body.byteLength) }, body: body as any });
  if (!put.ok) await driveFail(put, 'enviar ficheiro');
  return String(((await put.json()) as any).id);
}

async function drvListFiles(token: string, folderId: string, f: F = fetch): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let page = '';
  for (let i = 0; i < 100; i++) {
    const q = `'${esc(folderId)}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
    const r = await f(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: bearer(token) });
    if (!r.ok) await driveFail(r, 'listar');
    const j: any = await r.json();
    for (const x of j.files ?? []) out.push({ id: String(x.id), name: String(x.name) });
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return out;
}

async function drvDeleteFile(token: string, id: string, f: F = fetch): Promise<void> {
  const r = await f(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: bearer(token) });
  if (!r.ok && r.status !== 404) await driveFail(r, 'apagar');
}

const env = (k: string) => Deno.env.get(k) ?? '';
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const RUN_BUDGET_MS = 110_000;

// CORS fechado por omissão: só a origem definida em ALLOWED_ORIGIN (ex.: supabase secrets set ALLOWED_ORIGIN=https://bandgestao.vercel.app).
// "*" só se for pedido de forma explícita (ALLOWED_ORIGIN=*) ou em desenvolvimento local. Sem o segredo em produção, o navegador bloqueia (origem "null").
function allowedOrigin(): string {
  const o = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim();
  if (o === '*') return '*';
  if (o) return o.replace(/\/+$/, '');
  if (/^https?:\/\/(127\.0\.0\.1|localhost|kong)\b/.test(Deno.env.get('SUPABASE_URL') ?? '')) return '*';
  console.warn('ALLOWED_ORIGIN não definido: pedidos do navegador serão bloqueados. Defina o segredo ALLOWED_ORIGIN.');
  return 'null';
}
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin(),
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, message: string) => json({ error: message }, status);

// ---- Lista de IPs autorizados (inline: o editor do painel do Supabase não leva a pasta _shared; migração 0043) ----
function requestIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim();
  return v && v.length <= 45 ? v : null;
}
async function ipAllowed(admin: SupabaseClient, uid: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_ip_allowed', { p_uid: uid, p_ip: requestIp(req) });
  if (error) { console.error('ipGuard', error.message); return false; }
  return data === true;
}
const IP_DENIED_MESSAGE = 'Acesso recusado: rede não autorizada ou palavra-passe por renovar. Inicie sessão novamente.';

const service = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const googleApp = (): GoogleApp | null => env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') ? { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') } : null;
const redirectUri = () => `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/school-backups/gdrive-callback`;

interface Row { inst: string; prov: Provider; cfg: any; secret: string; keep_days: number; school: string }
interface Target { put(name: string, body: Uint8Array, mime: string): Promise<void>; list(): Promise<Array<{ name: string; remove: () => Promise<void> }>> }

async function openTarget(admin: SupabaseClient, r: Row): Promise<Target> {
  const secret = await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), r.inst, r.secret);
  if (r.prov === 's3') {
    const s3 = new S3Client(r.cfg as S3Config, secret as S3Secret);
    return { put: (name, body) => s3.put(name, body), list: async () => (await s3.list()).map((name) => ({ name, remove: () => s3.delete(name) })) };
  }
  const app = googleApp();
  if (!app) throw new ConfigError('O servidor ainda não tem a aplicação Google configurada (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  const token = await drvAccessToken(app, String(secret.refreshToken));
  const folderId = await drvEnsureFolder(token, r.cfg?.folderId);
  if (folderId !== r.cfg?.folderId) await admin.from('school_backup_destinations').update({ config: { ...r.cfg, folderId } }).eq('institution_id', r.inst);
  return {
    put: async (name, body, mime) => { await drvUploadFile(token, folderId, name, body, mime); },
    list: async () => (await drvListFiles(token, folderId)).map((f) => ({ name: f.name, remove: () => drvDeleteFile(token, f.id) }))
  };
}

type Trigger = 'agendado' | 'manual' | 'teste';

async function runOne(admin: SupabaseClient, r: Row, trigger: Trigger): Promise<{ ok: boolean; file?: string; size?: number; deleted?: number; error?: string }> {
  let file: string | undefined, size: number | undefined, deleted = 0;
  try {
    const target = await openTarget(admin, r);
    if (trigger === 'teste') {
      file = `bandmed_teste_${Date.now()}.txt`;
      const body = new TextEncoder().encode('Teste de ligação do BandMed. Pode apagar este ficheiro.');
      await target.put(file, body, 'text/plain');
      for (const f of await target.list()) if (f.name === file) await f.remove();
      size = body.byteLength;
    } else {
      const { data, error } = await admin.rpc('school_backup_export_service', { p_inst: r.inst });
      if (error) throw new Error(`Base de dados: ${error.message}`);
      if (!data || !(data.counts?.records > 0)) throw new Error('A escola não tem registos neste momento: nada foi copiado (os backups anteriores ficam intactos).');
      const body = new TextEncoder().encode(JSON.stringify(data));
      if (body.byteLength > MAX_BACKUP_BYTES) throw new Error(`O backup tem ${(body.byteLength / 1048576).toFixed(0)} MB, acima do limite desta função (${MAX_BACKUP_BYTES / 1048576} MB). Peça apoio técnico.`);
      const school = r.school || String(data.schoolName || '');
      file = backupFileName(school, new Date());
      await target.put(file, body, 'application/json');
      size = body.byteLength;
      try {
        const all = await target.list();
        const old = new Set(selectExpired(all.map((f) => f.name), school, r.keep_days));
        for (const f of all) if (old.has(f.name) && f.name !== file) { await f.remove(); deleted++; }
      } catch (e) { console.error('retenção falhou', r.inst, safeError(e)); }
    }
    await admin.rpc('backup_finish', { p_inst: r.inst, p_trigger: trigger, p_ok: true, p_provider: r.prov, p_file: file, p_size: size, p_error: null });
    return { ok: true, file, size, deleted };
  } catch (e) {
    const msg = e instanceof SecretsError || e instanceof ConfigError ? e.message : safeError(e);
    await admin.rpc('backup_finish', { p_inst: r.inst, p_trigger: trigger, p_ok: false, p_provider: r.prov, p_file: file ?? null, p_size: null, p_error: msg });
    return { ok: false, error: msg };
  }
}

async function scheduled(): Promise<Response> {
  const admin = service();
  const started = Date.now();
  const results: Array<{ inst: string; ok: boolean }> = [];
  while (Date.now() - started < RUN_BUDGET_MS) {
    const { data, error } = await admin.rpc('backup_claim_due', { p_limit: 1 });
    if (error) return fail(500, `claim: ${error.message}`);
    const r = (data as Row[] | null)?.[0];
    if (!r) break;
    results.push({ inst: r.inst, ok: (await runOne(admin, r, 'agendado')).ok });
  }
  return json({ ran: results.length, ok: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).map((x) => x.inst) });
}

async function authAdmin(req: Request, admin: SupabaseClient): Promise<{ uid: string; inst: string } | Response> {
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return fail(401, 'Sessão inválida');
  const { data: me } = await admin.from('profiles').select('institution_id, role, active').eq('id', u.user.id).single();
  if (!me || !me.active || me.role !== 'admin') return fail(403, 'Só o administrador da escola gere a cópia para a nuvem.');
  if (!(await ipAllowed(admin, u.user.id, req))) return fail(403, IP_DENIED_MESSAGE);
  // Escola ativa (mãe ou filial — migração 0024).
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  return { uid: u.user.id, inst: (typeof activeInst === 'string' && activeInst) ? activeInst : me.institution_id };
}

const audit = (admin: SupabaseClient, inst: string, uid: string, action: string, detail: Record<string, unknown>) =>
  admin.rpc('write_audit_event_service', { p_inst: inst, p_actor: uid, p_action: action, p_entity: 'school', p_entity_id: inst, p_detail: detail });

async function claimOne(admin: SupabaseClient, inst: string): Promise<Row | null> {
  const { data } = await admin.rpc('backup_claim_one', { p_inst: inst });
  return (data as Row[] | null)?.[0] ?? null;
}

async function handleAdmin(req: Request): Promise<Response> {
  const admin = service();
  const who = await authAdmin(req, admin);
  if (who instanceof Response) return who;
  const b: any = await req.json().catch(() => ({}));

  switch (b.action) {
    case 'save': {
      let sched;
      try { sched = cleanSchedule(b.runHour, b.retentionDays); } catch (e) { return fail(400, (e as Error).message); }
      if (!isProvider(b.provider)) return fail(400, 'Escolha o serviço de destino.');
      const provider: Provider = b.provider;
      const { data: cur } = await admin.from('school_backup_destinations').select('*').eq('institution_id', who.inst).maybeSingle();
      const sameProvider = cur?.provider === provider;
      let config = sameProvider ? cur.config : {};
      let secret_enc: string | null = sameProvider ? cur.secret_enc : null;
      try {
        if (provider === 's3') {
          config = cleanS3Config(b.config);
          if (b.secret && (b.secret.accessKeyId || b.secret.secretAccessKey)) secret_enc = await encryptSecret(env('BACKUP_SECRETS_KEY'), who.inst, cleanS3Secret(b.secret));
          else if (!secret_enc) throw new ConfigError('Indique a chave de acesso e a chave secreta.');
        } else if (!secret_enc) {
          throw new ConfigError('Ligue primeiro a conta Google Drive (botão "Ligar Google Drive").');
        }
      } catch (e) {
        return fail(e instanceof ConfigError || e instanceof SecretsError ? 400 : 500, (e as Error).message);
      }
      if (b.enabled && !secret_enc) return fail(400, 'Ligue o destino antes de activar o backup diário.');
      if (cur && !sameProvider && cur.provider === 'gdrive' && cur.secret_enc) {
        try { await drvRevoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), who.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
      }
      const changedTarget = !cur || !sameProvider || secret_enc !== cur.secret_enc || JSON.stringify(config) !== JSON.stringify(cur.config);
      const { error } = await admin.from('school_backup_destinations').upsert({
        institution_id: who.inst, provider, enabled: !!b.enabled, run_hour: sched.runHour, retention_days: sched.retentionDays,
        config, secret_enc, updated_at: new Date().toISOString(),
        ...(changedTarget ? { last_status: null, last_error: null } : {})
      });
      if (error) return fail(500, error.message);
      await audit(admin, who.inst, who.uid, 'RPC:school_backup_destination_save', { provider, enabled: !!b.enabled, runHour: sched.runHour, retentionDays: sched.retentionDays, changedTarget, target: provider === 's3' ? { endpoint: (config as S3Config).endpoint, bucket: (config as S3Config).bucket } : { account: config?.account } });
      return json({ ok: true });
    }

    case 'test':
    case 'run-now': {
      const r = await claimOne(admin, who.inst);
      if (!r) return fail(409, 'Não há destino configurado, ou já há uma cópia em curso/muito recente. Aguarde um minuto e tente de novo.');
      return json(await runOne(admin, r, b.action === 'test' ? 'teste' : 'manual'));
    }

    case 'disconnect': {
      const { data: cur } = await admin.from('school_backup_destinations').select('provider, secret_enc').eq('institution_id', who.inst).maybeSingle();
      if (cur?.provider === 'gdrive' && cur.secret_enc) {
        try { await drvRevoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), who.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
      }
      const { error } = await admin.from('school_backup_destinations').delete().eq('institution_id', who.inst);
      if (error) return fail(500, error.message);
      await audit(admin, who.inst, who.uid, 'RPC:school_backup_destination_disconnect', { provider: cur?.provider ?? null });
      return json({ ok: true });
    }

    case 'gdrive-start': {
      const app = googleApp();
      if (!app) return fail(501, 'O Google Drive ainda não está configurado neste servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Use um serviço S3 (Backblaze B2, Wasabi…) ou peça ao responsável técnico.');
      let returnTo = '';
      try { const u = new URL(String(b.returnTo || '')); if (/^https?:$/.test(u.protocol)) returnTo = u.origin; } catch { /* sem retorno */ }
      const allowed = env('APP_URL') || (env('ALLOWED_ORIGIN') !== '*' ? env('ALLOWED_ORIGIN') : '');
      if (allowed && returnTo && new URL(allowed).origin !== returnTo) returnTo = new URL(allowed).origin;
      const state = await signState(env('BACKUP_SECRETS_KEY'), { inst: who.inst, uid: who.uid, returnTo });
      return json({ url: drvAuthUrl(app, redirectUri(), state) });
    }

    default:
      return fail(400, 'Acção desconhecida.');
  }
}

async function handleCallback(url: URL): Promise<Response> {
  const st = await verifyState<{ inst: string; uid: string; returnTo: string }>(env('BACKUP_SECRETS_KEY'), url.searchParams.get('state') || '');
  const text = (s: string, status = 200) => new Response(s, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!st) return text('Pedido inválido ou expirado. Volte ao BandMed e tente ligar outra vez.', 400);
  const back = (result: string, msg = '') => {
    if (!st.returnTo) return text(result === 'ok' ? 'Google Drive ligado. Pode fechar esta janela e voltar ao BandMed.' : `Não foi possível ligar: ${msg}`);
    const target = new URL('/', st.returnTo);
    target.searchParams.set('backup-drive', result);
    if (msg) target.searchParams.set('msg', msg.slice(0, 120));
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  };
  if (url.searchParams.get('error')) return back('erro', 'Autorização recusada no Google.');
  const app = googleApp();
  const code = url.searchParams.get('code');
  if (!app || !code) return back('erro', 'Resposta do Google incompleta.');
  try {
    const admin = service();
    const { refreshToken, email } = await drvExchangeCode(app, redirectUri(), code);
    const { data: cur } = await admin.from('school_backup_destinations').select('*').eq('institution_id', st.inst).maybeSingle();
    if (cur?.provider === 'gdrive' && cur.secret_enc) {
      try { await drvRevoke(String((await decryptSecret<any>(env('BACKUP_SECRETS_KEY'), st.inst, cur.secret_enc)).refreshToken)); } catch { /* melhor esforço */ }
    }
    const keep = cur?.provider === 'gdrive';
    const { error } = await admin.from('school_backup_destinations').upsert({
      institution_id: st.inst, provider: 'gdrive', enabled: keep ? cur.enabled : false,
      run_hour: keep ? cur.run_hour : 23, retention_days: keep ? cur.retention_days : 30,
      config: { account: email, folderId: null }, secret_enc: await encryptSecret(env('BACKUP_SECRETS_KEY'), st.inst, { refreshToken }),
      last_status: null, last_error: null, updated_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
    await audit(admin, st.inst, st.uid, 'RPC:school_backup_destination_save', { provider: 'gdrive', account: email, connected: true });
    return back('ok');
  } catch (e) {
    return back('erro', e instanceof Error ? e.message : 'Erro desconhecido');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/gdrive-callback')) return await handleCallback(url);
    if (req.method !== 'POST') return fail(405, 'Método não permitido');
    const cron = req.headers.get('x-cron-secret');
    if (cron !== null) {
      const expected = env('BACKUP_CRON_SECRET');
      if (expected.length < 24 || !safeEqual(cron, expected)) return fail(401, 'Segredo do agendador inválido');
      return await scheduled();
    }
    return await handleAdmin(req);
  } catch (e) {
    console.error('school-backups', e);
    return fail(500, e instanceof SecretsError ? e.message : 'Erro interno. Veja os registos da função.');
  }
});
