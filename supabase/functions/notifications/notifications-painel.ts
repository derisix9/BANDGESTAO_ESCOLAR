// notifications (ficheiro único para o editor do Supabase — gerado a partir de supabase/functions por scripts/gen-painel.py)
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ───── school-backups/secrets.ts ─────
namespace M_school_backups_secrets {
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
}

// ───── _shared/cors.ts ─────
namespace M__shared_cors {
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
// A autenticação vai no cabeçalho Authorization (não em cookies); o CORS fechado é uma camada extra.
export const cors = {
  'Access-Control-Allow-Origin': allowedOrigin(),
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
/** Resposta ao pedido prévio (preflight) do navegador: tem de ser 2xx, senão o navegador bloqueia o pedido real. */
export const preflight = () => new Response(null, { status: 204, headers: cors });
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export const ROLES = ['admin','director','secretaria','professor','financeiro','funcionario','aluno','encarregado'];
export const MIN_PASSWORD = 10;
export function passwordProblem(p: string): string | null {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `A palavra-passe deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) return 'Use maiúsculas, minúsculas e números.';
  return null;
}

/** Comparação em tempo constante (evita descobrir o código de convite por diferenças de tempo). */
export function safeEqual(a: unknown, b: unknown): boolean {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

/** Avatar: só URL https ou imagem pequena. Evita encher a base de dados com ficheiros grandes (vão para o Storage). */
export const MAX_AVATAR = 20000;
export function cleanAvatar(v: unknown): string | null {
  const s = String(v ?? '');
  if (!s || s.length > MAX_AVATAR) return null;
  return /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(s) ? s : null;
}
}

// ───── _shared/notify.ts ─────
namespace M__shared_notify {
/**
 * Notificações por SMS e WhatsApp — parte PURA (sem Deno, sem Supabase): o que a escola escreve, as regras de uso dos
 * canais e os fornecedores. Usada pela Edge Function `notifications`, pelo worker `server/notify.ts` (Node) e testada em
 * tests/notificationProviders.test.ts (com rede simulada).
 *
 * Interfaces:  SmsProvider  e  WhatsAppProvider.  Cada fornecedor novo é só mais uma classe com a mesma interface,
 * registada em makeSmsProvider() / makeWhatsAppProvider().
 *
 * SMS
 *   • twilio   POST /2010-04-01/Accounts/{sid}/Messages.json          (Basic sid:token)
 *   • infobip  POST /sms/2/text/advanced                              (Authorization: App <chave>; endereço base da conta)
 *   • http     agregador LOCAL (operadora ou revendedor angolano) por API HTTP genérica: endereço, formato do corpo e
 *              autenticação escolhidos pela escola — não é preciso código novo para ligar mais um.
 * WhatsApp (só com modelo aprovado; texto livre só é permitido pela Meta dentro das 24 h de uma conversa iniciada pelo cliente)
 *   • twilio      Content API: ContentSid + ContentVariables
 *   • meta_cloud  Cloud API: POST /{versão}/{phone_number_id}/messages com "type: template"
 */

export class NotifyError extends Error {
  /** retryable: vale a pena tentar de novo (rede, 429, 5xx). Falhas de configuração/destinatário não repetem. */
  constructor(message: string, readonly status = 400, readonly retryable = false) { super(message); this.name = 'NotifyError'; }
}

export const SMS_PROVIDERS = ['twilio', 'infobip', 'http'] as const;
export const WHATSAPP_PROVIDERS = ['twilio', 'meta_cloud'] as const;
export type SmsProviderId = (typeof SMS_PROVIDERS)[number];
export type WhatsAppProviderId = (typeof WHATSAPP_PROVIDERS)[number];
export const isSmsProvider = (v: unknown): v is SmsProviderId => typeof v === 'string' && (SMS_PROVIDERS as readonly string[]).includes(v);
export const isWhatsAppProvider = (v: unknown): v is WhatsAppProviderId => typeof v === 'string' && (WHATSAPP_PROVIDERS as readonly string[]).includes(v);

export type Category = 'normal' | 'critico';
export const cleanCategory = (v: unknown): Category => (v === 'critico' ? 'critico' : 'normal');

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
/** Ficheiro a enviar junto (ex.: agenda/acta de uma reunião em PDF). `url` tem de ser público (a Meta e o Twilio descarregam-no). */
export interface SendAttachment { url: string; filename: string }
export interface SendInput { id: string; /** E.164 com "+" */ to: string; text: string; attachment?: SendAttachment }
export interface SendResult { providerId?: string }

export interface SmsProvider {
  readonly name: string;
  /** Confirma que as credenciais servem (não envia nada). Devolve uma frase curta para mostrar (ex.: o saldo). */
  ping(): Promise<string>;
  send(m: SendInput): Promise<SendResult>;
}
export interface WhatsAppProvider {
  readonly name: string;
  ping(): Promise<string>;
  /** Envia o modelo aprovado com o texto como variável {{1}}. */
  sendTemplate(m: SendInput): Promise<SendResult>;
}

// ---------- Regras de uso dos canais ----------
/** null = pode enviar. Texto = a razão (mostrada ao utilizador) pela qual este SMS não segue. */
export function smsBlockedReason(category: Category, criticalOnly: boolean): string | null {
  if (criticalOnly && category !== 'critico') {
    return 'O SMS desta escola está reservado a avisos críticos (ex.: propina em atraso). Envie este aviso por notificação push, ou marque-o como crítico.';
  }
  return null;
}

export const MAX_BODY = 480;
export function cleanBody(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!s || s.length > MAX_BODY) throw new NotifyError(`A mensagem tem de ter entre 1 e ${MAX_BODY} caracteres.`);
  return s;
}

/** E.164 com "+" (ex.: +244923456789) ou null. Números locais angolanos têm 9 dígitos. Igual a toE164() em src/utils/notificationGateway.ts. */
export function toE164(value?: string | null, defaultCountry = '244'): string | null {
  const raw = (value || '').trim();
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;
  if (!hasPlus && digits.length === 9) digits = defaultCountry + digits;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export type PhoneFormat = 'e164' | 'digits' | 'local';
/** Como o agregador quer o número: +244923456789, 244923456789 ou 923456789. */
export function formatPhone(e164: string, format: PhoneFormat): string {
  const digits = e164.replace(/\D/g, '');
  if (format === 'digits') return digits;
  if (format === 'local') return digits.startsWith('244') && digits.length === 12 ? digits.slice(3) : digits;
  return `+${digits}`;
}

// ---------- Endereços: só HTTPS públicos (a escola escreve o endereço do agregador; o servidor é que o chama) ----------
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.localdomain', '.lan', '.home', '.corp', '.intranet', '.private'];

/** Aceita só https://nome.publico[/caminho]. Recusa IPs, localhost, nomes internos, portas e credenciais no endereço. */
export function assertPublicHttpsUrl(raw: unknown, opts: { hostSuffix?: string; what?: string } = {}): URL {
  const what = opts.what ?? 'O endereço';
  let u: URL;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new NotifyError(`${what} não é um endereço válido.`); }
  if (u.protocol !== 'https:') throw new NotifyError(`${what} tem de começar por https://`);
  if (u.username || u.password) throw new NotifyError(`${what} não pode ter utilizador/senha dentro (use os campos de autenticação).`);
  if (u.port && u.port !== '443') throw new NotifyError(`${what} só pode usar a porta normal (443).`);
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  const last = h.split('.').pop() ?? '';
  if (!h.includes('.') || h.includes(':') || h.startsWith('[') || /^\d+$/.test(last) || /^0x/i.test(last)
      || h === 'localhost' || BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) {
    throw new NotifyError(`${what} tem de ser um nome público (não um IP, localhost ou nome interno).`);
  }
  if (opts.hostSuffix && !(h === opts.hostSuffix.slice(1) || h.endsWith(opts.hostSuffix))) {
    throw new NotifyError(`${what} tem de terminar em ${opts.hostSuffix}`);
  }
  u.hash = '';
  return u;
}

// ---------- O que a escola escreve (por fornecedor) ----------
const str = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const noSpace = (s: string) => !/\s/.test(s);

export interface Setup { config: Record<string, unknown>; /** só os campos escritos agora (os restantes ficam como estavam) */ secret: Record<string, string> }

function twilioSecret(b: any): Record<string, string> {
  const s: Record<string, string> = {};
  const sid = str(b?.accountSid, 60), tok = str(b?.authToken, 100);
  if (sid) { if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) throw new NotifyError('O Account SID do Twilio começa por AC e tem 34 caracteres.'); s.accountSid = sid; }
  if (tok) { if (!/^[0-9A-Za-z]{20,64}$/.test(tok)) throw new NotifyError('O Auth Token do Twilio parece inválido (só letras e números).'); s.authToken = tok; }
  return s;
}

/** Valida o que o administrador escreveu para o SMS. Lança NotifyError com a frase a mostrar. */
export function cleanSmsSetup(provider: SmsProviderId, input: any): Setup {
  const c = input?.config ?? {}, sec = input?.secret ?? {};
  switch (provider) {
    case 'twilio': {
      const from = str(c.from, 40), ms = str(c.messagingServiceSid, 40);
      if (!from && !ms) throw new NotifyError('Indique o remetente (número ou nome) ou o Messaging Service SID do Twilio.');
      if (ms && !/^MG[0-9a-fA-F]{32}$/.test(ms)) throw new NotifyError('O Messaging Service SID do Twilio começa por MG e tem 34 caracteres.');
      if (from && !/^(\+\d{8,15}|[A-Za-z0-9 ]{1,11})$/.test(from)) throw new NotifyError('O remetente tem de ser um número com + (ex.: +12025550123) ou um nome até 11 letras/números.');
      return { config: { ...(from ? { from } : {}), ...(ms ? { messagingServiceSid: ms } : {}) }, secret: twilioSecret(sec) };
    }
    case 'infobip': {
      const base = assertPublicHttpsUrl(c.baseUrl, { hostSuffix: '.infobip.com', what: 'O endereço base da conta Infobip' });
      const sender = str(c.sender, 20);
      if (!/^([A-Za-z0-9]{3,11}|\d{6,15})$/.test(sender)) throw new NotifyError('O remetente da Infobip tem de ter 3 a 11 letras/números (ou um número de telefone).');
      const apiKey = str(sec.apiKey, 300);
      if (apiKey && (apiKey.length < 20 || !noSpace(apiKey))) throw new NotifyError('A chave de API da Infobip parece inválida.');
      return { config: { baseUrl: `https://${base.hostname}`, sender }, secret: apiKey ? { apiKey } : {} };
    }
    case 'http': {
      const url = assertPublicHttpsUrl(c.url, { what: 'O endereço do agregador' });
      const contentType = c.contentType === 'form' ? 'form' : 'json';
      const bodyTemplate = str(c.bodyTemplate, 2000);
      if (!bodyTemplate.includes('{{message}}') || !bodyTemplate.includes('{{to}}')) throw new NotifyError('O modelo do corpo tem de conter {{to}} (número) e {{message}} (texto).');
      const authMode = (['none', 'bearer', 'basic', 'header', 'query'] as const).find((m) => m === c.authMode) ?? 'none';
      const authName = str(c.authName, 40);
      if (authMode === 'header' && !isSafeHeaderName(authName)) throw new NotifyError('Indique o nome do cabeçalho de autenticação (ex.: X-Api-Key).');
      if (authMode === 'query' && !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(authName)) throw new NotifyError('Indique o nome do parâmetro de autenticação no endereço (ex.: key).');
      const phoneFormat = (['e164', 'digits', 'local'] as const).find((m) => m === c.phoneFormat) ?? 'e164';
      const sender = str(c.sender, 30);
      const successContains = str(c.successContains, 80);
      const cfg = { url: url.toString(), contentType, bodyTemplate, authMode, ...(authName ? { authName } : {}), phoneFormat, ...(sender ? { sender } : {}), ...(successContains ? { successContains } : {}) };
      renderHttpBody(cfg as HttpSmsConfig, { to: '+244923000000', message: 'Teste "aspas" e\nlinha', sender: sender || 'BANDMED', id: 'teste' });   // o modelo tem de dar um corpo válido
      const token = str(sec.token, 500);
      if (token && authMode === 'basic' && (token.length < 3 || !token.includes(':'))) throw new NotifyError('Para autenticação Basic escreva utilizador:senha.');
      if (token && (authMode === 'bearer' || authMode === 'query') && !noSpace(token)) throw new NotifyError('O token não pode ter espaços.');
      return { config: cfg, secret: token ? { token } : {} };
    }
  }
}

/** Valida o que o administrador escreveu para o WhatsApp (sempre com modelo aprovado). */
export function cleanWhatsAppSetup(provider: WhatsAppProviderId, input: any): Setup {
  const c = input?.config ?? {}, sec = input?.secret ?? {};
  if (provider === 'twilio') {
    const from = str(c.from, 40), contentSid = str(c.contentSid, 40);
    if (!/^\+\d{8,15}$/.test(from.replace(/^whatsapp:/, ''))) throw new NotifyError('Indique o número WhatsApp do Twilio com + (ex.: +14155238886).');
    if (!/^HX[0-9a-fA-F]{32}$/.test(contentSid)) throw new NotifyError('Indique o Content SID do modelo aprovado (começa por HX e tem 34 caracteres). O WhatsApp só envia com modelo aprovado.');
    const documentContentSid = str(c.documentContentSid, 40);
    if (documentContentSid && !/^HX[0-9a-fA-F]{32}$/.test(documentContentSid)) throw new NotifyError('O Content SID do modelo com documento (opcional) começa por HX e tem 34 caracteres.');
    return { config: { from: from.replace(/^whatsapp:/, ''), contentSid, ...(documentContentSid ? { documentContentSid } : {}) }, secret: twilioSecret(sec) };
  }
  const phoneNumberId = str(c.phoneNumberId, 30), templateName = str(c.templateName, 100), templateLang = str(c.templateLang, 10) || 'pt_PT';
  const apiVersion = str(c.apiVersion, 10) || 'v21.0';
  if (!/^\d{8,20}$/.test(phoneNumberId)) throw new NotifyError('O Phone Number ID da Meta são só dígitos (copie-o do painel WhatsApp da Meta).');
  if (!/^[a-z0-9_]{1,100}$/.test(templateName)) throw new NotifyError('O nome do modelo usa só minúsculas, números e _ (ex.: aviso_escola).');
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLang)) throw new NotifyError('O idioma do modelo tem o formato pt_PT, pt_BR ou en_US.');
  if (!/^v\d{1,2}\.\d$/.test(apiVersion)) throw new NotifyError('A versão da API tem o formato v21.0.');
  const documentTemplateName = str(c.documentTemplateName, 100);
  if (documentTemplateName && !/^[a-z0-9_]{1,100}$/.test(documentTemplateName)) throw new NotifyError('O nome do modelo com documento (opcional) usa só minúsculas, números e _ (ex.: reuniao_com_pdf).');
  const accessToken = str(sec.accessToken, 800);
  if (accessToken && (accessToken.length < 20 || !noSpace(accessToken))) throw new NotifyError('O token de acesso da Meta parece inválido.');
  return { config: { phoneNumberId, templateName, templateLang, apiVersion, ...(documentTemplateName ? { documentTemplateName } : {}) }, secret: accessToken ? { accessToken } : {} };
}

/** Campos secretos que têm de existir para o fornecedor funcionar. */
export function requiredSecret(_channel: 'sms' | 'whatsapp', provider: string): string[] {
  if (provider === 'twilio') return ['accountSid', 'authToken'];
  if (provider === 'infobip') return ['apiKey'];
  if (provider === 'meta_cloud') return ['accessToken'];
  return [];   // http: o token só é obrigatório se a autenticação não for "none" (ver secretMissing)
}
export function secretMissing(channel: 'sms' | 'whatsapp', provider: string, config: Record<string, unknown>, secret: Record<string, unknown>): string | null {
  for (const k of requiredSecret(channel, provider)) if (!str(secret[k], 900)) return 'Falta preencher as credenciais do fornecedor.';
  if (provider === 'http' && config.authMode && config.authMode !== 'none' && !str(secret.token, 900)) return 'Falta o token/chave de autenticação do agregador.';
  return null;
}

// ---------- Cliente HTTP comum ----------
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'accept', 'cookie', 'set-cookie', 'te', 'upgrade', 'expect', 'user-agent', 'origin', 'referer']);
function isSafeHeaderName(n: string): boolean { return /^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(n) && !FORBIDDEN_HEADERS.has(n.toLowerCase()); }

class Http {
  constructor(private readonly fetchFn: FetchFn, private readonly timeoutMs: number) {}
  async call(url: string, init: RequestInit): Promise<{ res: Response; text: string }> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      throw new NotifyError(/timeout|abort|timed out/i.test(m) ? 'O fornecedor demorou demasiado a responder.' : 'Não foi possível contactar o fornecedor.', 502, true);
    }
    const text = (await res.text().catch(() => '')).slice(0, 4000);
    return { res, text };
  }
}
const json = (t: string): any => { try { return JSON.parse(t); } catch { return null; } };
const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

/** Frase legível para um HTTP de erro. 408/429/5xx repetem; o resto não. */
function failure(who: string, res: Response, detail: string): NotifyError {
  const retry = res.status === 408 || res.status === 429 || res.status >= 500;
  if (res.status === 401 || res.status === 403) return new NotifyError(`${who} recusou as credenciais. Confirme-as em Configurações → Integrações.`, 400, false);
  if (res.status === 429) return new NotifyError(`${who} limitou os pedidos. Será repetido mais tarde.`, 502, true);
  const d = detail ? ` (${detail.replace(/\s+/g, ' ').slice(0, 160)})` : '';
  return new NotifyError(retry ? `${who} está com problemas (${res.status}). Será repetido.` : `${who} recusou o pedido${d}.`, retry ? 502 : 400, retry);
}

// ---------- Twilio ----------
export interface TwilioCreds { accountSid: string; authToken: string }

class TwilioBase {
  protected readonly http: Http;
  constructor(protected readonly creds: TwilioCreds, fetchFn: FetchFn, timeoutMs: number) { this.http = new Http(fetchFn, timeoutMs); }
  protected get auth() { return basic(this.creds.accountSid, this.creds.authToken); }
  async ping(): Promise<string> {
    const { res, text } = await this.http.call(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.creds.accountSid)}.json`, { method: 'GET', headers: { Authorization: this.auth } });
    if (!res.ok) throw failure('O Twilio', res, json(text)?.message ?? '');
    const j = json(text);
    if (j?.status && j.status !== 'active') throw new NotifyError(`A conta Twilio está "${j.status}". Active-a no painel do Twilio.`, 400, false);
    return 'Conta Twilio activa.';
  }
  protected async post(form: URLSearchParams): Promise<SendResult> {
    const { res, text } = await this.http.call(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.creds.accountSid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
    });
    const j = json(text);
    if (res.ok) return { providerId: typeof j?.sid === 'string' ? j.sid : undefined };
    throw failure('O Twilio', res, j?.message ? String(j.message) : '');
  }
}

export class TwilioSms extends TwilioBase implements SmsProvider {
  readonly name = 'Twilio';
  constructor(private readonly cfg: { from?: string; messagingServiceSid?: string }, creds: TwilioCreds, fetchFn: FetchFn = (u, i) => fetch(u, i), timeoutMs = 15_000) { super(creds, fetchFn, timeoutMs); }
  send(m: SendInput): Promise<SendResult> {
    const f = new URLSearchParams({ To: m.to, Body: m.text });
    if (this.cfg.messagingServiceSid) f.set('MessagingServiceSid', this.cfg.messagingServiceSid); else f.set('From', String(this.cfg.from ?? ''));
    return this.post(f);
  }
}

export class TwilioWhatsApp extends TwilioBase implements WhatsAppProvider {
  readonly name = 'Twilio WhatsApp';
  /** freeform: texto livre (só no sandbox do Twilio ou dentro das 24 h). As escolas usam sempre o modelo (contentSid). */
  constructor(private readonly cfg: { from: string; contentSid?: string; freeform?: boolean; documentContentSid?: string }, creds: TwilioCreds, fetchFn: FetchFn = (u, i) => fetch(u, i), timeoutMs = 15_000) { super(creds, fetchFn, timeoutMs); }
  async sendTemplate(m: SendInput): Promise<SendResult> {
    const f = new URLSearchParams({ To: `whatsapp:${m.to}`, From: `whatsapp:${this.cfg.from.replace(/^whatsapp:/, '')}` });
    // Com ficheiro: modelo aprovado COM documento ({{1}} = texto, {{2}} = endereço do PDF) ou, no sandbox, texto livre + MediaUrl.
    // Sem nenhum dos dois, segue o modelo normal e o texto já leva o link de descarga.
    if (m.attachment && this.cfg.documentContentSid) { f.set('ContentSid', this.cfg.documentContentSid); f.set('ContentVariables', JSON.stringify({ 1: templateParam(m.text), 2: m.attachment.url })); }
    else if (m.attachment && !this.cfg.contentSid && this.cfg.freeform) { f.set('Body', m.text); f.set('MediaUrl', m.attachment.url); }
    else if (this.cfg.contentSid) { f.set('ContentSid', this.cfg.contentSid); f.set('ContentVariables', JSON.stringify({ 1: templateParam(m.text) })); }
    else if (this.cfg.freeform) f.set('Body', m.text);
    else throw new NotifyError('O WhatsApp só envia com um modelo aprovado: falta o Content SID.');
    return this.post(f);
  }
}

// ---------- Infobip ----------
export class InfobipSms implements SmsProvider {
  readonly name = 'Infobip';
  private readonly http: Http;
  constructor(private readonly cfg: { baseUrl: string; sender: string }, private readonly sec: { apiKey: string }, fetchFn: FetchFn = (u, i) => fetch(u, i), timeoutMs = 15_000) { this.http = new Http(fetchFn, timeoutMs); }
  private get headers() { return { Authorization: `App ${this.sec.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' }; }
  async ping(): Promise<string> {
    const base = assertPublicHttpsUrl(this.cfg.baseUrl, { hostSuffix: '.infobip.com' });
    const { res, text } = await this.http.call(`${base.origin}/account/1/balance`, { method: 'GET', headers: this.headers });
    if (!res.ok) throw failure('A Infobip', res, json(text)?.requestError?.serviceException?.text ?? '');
    const j = json(text);
    return typeof j?.balance === 'number' ? `Saldo: ${j.balance} ${j.currency ?? ''}`.trim() : 'Credenciais aceites.';
  }
  async send(m: SendInput): Promise<SendResult> {
    const base = assertPublicHttpsUrl(this.cfg.baseUrl, { hostSuffix: '.infobip.com' });
    const { res, text } = await this.http.call(`${base.origin}/sms/2/text/advanced`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({ messages: [{ from: this.cfg.sender, destinations: [{ to: m.to.replace(/^\+/, '') }], text: m.text }] })
    });
    const j = json(text);
    if (!res.ok) throw failure('A Infobip', res, j?.requestError?.serviceException?.text ?? '');
    const msg = j?.messages?.[0];
    // groupId: 1 PENDING, 2 UNDELIVERABLE, 3 DELIVERED, 4 EXPIRED, 5 REJECTED
    const gid = Number(msg?.status?.groupId);
    if (gid === 1 || gid === 3) return { providerId: typeof msg?.messageId === 'string' ? msg.messageId : undefined };
    throw new NotifyError(`A Infobip não aceitou a mensagem (${String(msg?.status?.description ?? msg?.status?.name ?? 'sem detalhe').slice(0, 120)}).`, 400, false);
  }
}

// ---------- Agregador local por API HTTP genérica ----------
export interface HttpSmsConfig {
  url: string; contentType: 'json' | 'form'; bodyTemplate: string;
  authMode: 'none' | 'bearer' | 'basic' | 'header' | 'query'; authName?: string; phoneFormat: PhoneFormat; sender?: string; successContains?: string;
}
const jsonInner = (v: string) => JSON.stringify(v).slice(1, -1);

/** Preenche {{to}}, {{message}}, {{sender}}, {{id}} no modelo. JSON: valores escapados; formulário: valores codificados. */
export function renderHttpBody(cfg: HttpSmsConfig, vars: { to: string; message: string; sender: string; id: string }): string {
  const v = { to: formatPhone(vars.to, cfg.phoneFormat), message: vars.message, sender: vars.sender, id: vars.id };
  const out = cfg.bodyTemplate.replace(/\{\{(to|message|sender|id)\}\}/g, (_m, k: keyof typeof v) => (cfg.contentType === 'json' ? jsonInner(v[k]) : encodeURIComponent(v[k])));
  if (cfg.contentType === 'json') {
    try { JSON.parse(out); } catch { throw new NotifyError('O modelo do corpo não dá um JSON válido. Exemplo: {"to":"{{to}}","text":"{{message}}"}'); }
  }
  return out;
}

export class HttpSms implements SmsProvider {
  readonly name = 'Agregador de SMS';
  private readonly http: Http;
  constructor(private readonly cfg: HttpSmsConfig, private readonly sec: { token?: string }, fetchFn: FetchFn = (u, i) => fetch(u, i), timeoutMs = 15_000) { this.http = new Http(fetchFn, timeoutMs); }
  async ping(): Promise<string> {
    assertPublicHttpsUrl(this.cfg.url);
    return 'O endereço é válido. Este tipo de fornecedor não tem teste automático: envie uma mensagem de teste para o seu número.';
  }
  async send(m: SendInput): Promise<SendResult> {
    const u = assertPublicHttpsUrl(this.cfg.url);
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', 'Content-Type': this.cfg.contentType === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' };
    const token = this.sec.token ?? '';
    if (this.cfg.authMode === 'bearer') headers.Authorization = `Bearer ${token}`;
    else if (this.cfg.authMode === 'basic') { const i = token.indexOf(':'); headers.Authorization = basic(token.slice(0, i), token.slice(i + 1)); }
    else if (this.cfg.authMode === 'header') {
      if (!isSafeHeaderName(this.cfg.authName ?? '')) throw new NotifyError('Nome de cabeçalho de autenticação inválido.');
      headers[String(this.cfg.authName)] = token;
    } else if (this.cfg.authMode === 'query') u.searchParams.set(String(this.cfg.authName), token);
    const body = renderHttpBody(this.cfg, { to: m.to, message: m.text, sender: this.cfg.sender ?? '', id: m.id });
    const { res, text } = await this.http.call(u.toString(), { method: 'POST', headers, body });
    if (!res.ok) throw failure('O agregador', res, text);
    if (this.cfg.successContains && !text.toLowerCase().includes(this.cfg.successContains.toLowerCase())) {
      throw new NotifyError('O agregador respondeu, mas não confirmou o envio (a resposta não tem o texto de sucesso indicado).', 400, false);
    }
    const j = json(text);
    const pid = j && (j.id ?? j.messageId ?? j.message_id ?? j.sid ?? j.data?.id);
    return { providerId: typeof pid === 'string' || typeof pid === 'number' ? String(pid).slice(0, 80) : undefined };
  }
}

// ---------- Meta WhatsApp Cloud API ----------
/** A Meta recusa quebras de linha, tabs e 4+ espaços seguidos numa variável do modelo; máx. 1024 caracteres. */
export function templateParam(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' | ').replace(/ {4,}/g, '   ').replace(/( \| )+/g, ' | ').trim().slice(0, 1024);
}

export class MetaWhatsApp implements WhatsAppProvider {
  readonly name = 'WhatsApp (Meta)';
  private readonly http: Http;
  constructor(private readonly cfg: { phoneNumberId: string; templateName: string; templateLang: string; apiVersion: string; documentTemplateName?: string }, private readonly sec: { accessToken: string }, fetchFn: FetchFn = (u, i) => fetch(u, i), timeoutMs = 15_000) { this.http = new Http(fetchFn, timeoutMs); }
  private get headers() { return { Authorization: `Bearer ${this.sec.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }; }
  private explain(res: Response, text: string): NotifyError {
    const err = json(text)?.error;
    // 131030/131026: número fora da lista/sem WhatsApp; 132001: modelo inexistente nesse idioma; 132000: nº de variáveis; 190: token expirado
    if (err?.code === 190) return new NotifyError('O token de acesso da Meta expirou ou é inválido. Gere um token permanente (utilizador de sistema) e volte a guardá-lo.', 400, false);
    if (err?.code === 132001) return new NotifyError('A Meta não encontrou o modelo com esse nome e idioma. Confirme que está APROVADO.', 400, false);
    if (err?.code === 131026 || err?.code === 131030) return new NotifyError('O número de destino não tem WhatsApp (ou não está autorizado no modo de testes da Meta).', 400, false);
    return failure('A Meta', res, err?.message ? String(err.message) : '');
  }
  async ping(): Promise<string> {
    const { res, text } = await this.http.call(`https://graph.facebook.com/${this.cfg.apiVersion}/${encodeURIComponent(this.cfg.phoneNumberId)}?fields=display_phone_number,verified_name`, { method: 'GET', headers: this.headers });
    if (!res.ok) throw this.explain(res, text);
    const j = json(text);
    return j?.display_phone_number ? `Número WhatsApp: ${j.display_phone_number}${j.verified_name ? ` (${j.verified_name})` : ''}` : 'Credenciais aceites.';
  }
  async sendTemplate(m: SendInput): Promise<SendResult> {
    // Com ficheiro e um modelo aprovado com cabeçalho «Documento»: o PDF chega directamente na conversa.
    // Sem esse modelo, segue o modelo normal (o texto já leva o link de descarga).
    const withDoc = !!m.attachment && !!this.cfg.documentTemplateName;
    const components: unknown[] = [];
    if (withDoc) components.push({ type: 'header', parameters: [{ type: 'document', document: { link: m.attachment!.url, filename: m.attachment!.filename.slice(0, 120) } }] });
    components.push({ type: 'body', parameters: [{ type: 'text', text: templateParam(m.text) }] });
    const { res, text } = await this.http.call(`https://graph.facebook.com/${this.cfg.apiVersion}/${encodeURIComponent(this.cfg.phoneNumberId)}/messages`, {
      method: 'POST', headers: this.headers,
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: m.to.replace(/^\+/, ''), type: 'template',
        template: { name: withDoc ? this.cfg.documentTemplateName : this.cfg.templateName, language: { code: this.cfg.templateLang }, components }
      })
    });
    if (!res.ok) throw this.explain(res, text);
    const id = json(text)?.messages?.[0]?.id;
    return { providerId: typeof id === 'string' ? id : undefined };
  }
}

// ---------- Fábricas ----------
export function makeSmsProvider(provider: string, config: any, secret: any, fetchFn?: FetchFn): SmsProvider {
  switch (provider) {
    case 'twilio': return new TwilioSms({ from: config?.from, messagingServiceSid: config?.messagingServiceSid }, { accountSid: String(secret?.accountSid ?? ''), authToken: String(secret?.authToken ?? '') }, fetchFn);
    case 'infobip': return new InfobipSms({ baseUrl: String(config?.baseUrl ?? ''), sender: String(config?.sender ?? '') }, { apiKey: String(secret?.apiKey ?? '') }, fetchFn);
    case 'http': return new HttpSms(config as HttpSmsConfig, { token: secret?.token }, fetchFn);
    default: throw new NotifyError('Fornecedor de SMS não suportado.');
  }
}

export function makeWhatsAppProvider(provider: string, config: any, secret: any, fetchFn?: FetchFn): WhatsAppProvider {
  switch (provider) {
    case 'twilio': return new TwilioWhatsApp({ from: String(config?.from ?? ''), contentSid: config?.contentSid, freeform: config?.freeform === true, documentContentSid: config?.documentContentSid || undefined }, { accountSid: String(secret?.accountSid ?? ''), authToken: String(secret?.authToken ?? '') }, fetchFn);
    case 'meta_cloud': return new MetaWhatsApp({ phoneNumberId: String(config?.phoneNumberId ?? ''), templateName: String(config?.templateName ?? ''), templateLang: String(config?.templateLang ?? 'pt_PT'), apiVersion: String(config?.apiVersion ?? 'v21.0'), documentTemplateName: config?.documentTemplateName || undefined }, { accessToken: String(secret?.accessToken ?? '') }, fetchFn);
    default: throw new NotifyError('Fornecedor de WhatsApp não suportado.');
  }
}

/** Mensagem segura para mostrar ao utilizador (sem chaves nem pormenores internos). */
export function safeNotifyMessage(e: unknown): string {
  if (e instanceof NotifyError) return e.message;
  const m = e instanceof Error ? e.message : String(e ?? '');
  if (/timeout|aborted|timed out/i.test(m)) return 'O fornecedor demorou demasiado a responder. Tente de novo dentro de instantes.';
  if (/fetch failed|network|dns|connect|tls|certificate/i.test(m)) return 'Não foi possível contactar o fornecedor. Tente de novo dentro de instantes.';
  return 'Erro inesperado ao falar com o fornecedor.';
}
}

// ───── _shared/webpush.ts ─────
namespace M__shared_webpush {
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
}

// ───── _shared/notifyDeliver.ts ─────
namespace M__shared_notifyDeliver {
import NotifyError = M__shared_notify.NotifyError;
import cleanCategory = M__shared_notify.cleanCategory;
import makeSmsProvider = M__shared_notify.makeSmsProvider;
import makeWhatsAppProvider = M__shared_notify.makeWhatsAppProvider;
import safeNotifyMessage = M__shared_notify.safeNotifyMessage;
import secretMissing = M__shared_notify.secretMissing;
import smsBlockedReason = M__shared_notify.smsBlockedReason;
import toE164 = M__shared_notify.toE164;
import FetchFn = M__shared_notify.FetchFn;
import SmsProvider = M__shared_notify.SmsProvider;
import WhatsAppProvider = M__shared_notify.WhatsAppProvider;
/**
 * Entrega da fila SMS/WhatsApp das escolas que ligaram o SEU fornecedor (migração 0039).
 * Parte sem Deno e sem Supabase (recebe o que precisa por parâmetro), testada em tests/notificationProviders.test.ts.
 * Usada pela Edge Function `notifications` (agendador e arranque imediato).
 *
 * Por mensagem: SMS só crítico → número válido → abre as credenciais DA ESCOLA (uma vez por lote) → envia → regista.
 * Falha de rede/429/5xx repete com recuo (finish_notification); falha de configuração/destinatário não repete (notification_skip).
 */

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export interface DeliverJob {
  id: string; institution_id: string; channel: 'sms' | 'whatsapp'; to_phone: string; body: string; category?: string; attempts?: number;
  /** Ficheiro a enviar junto (WhatsApp) — só reuniões, ver supabase/functions/meeting-file. */
  attachment_url?: string | null; attachment_name?: string | null;
  provider: string; config: Record<string, unknown> | null; secret_enc: string | null; critical_only: boolean;
}

export interface DeliverDeps {
  rpc: RpcClient;
  /** abre as credenciais cifradas da escola */
  openSecret(inst: string, channel: 'sms' | 'whatsapp', enc: string | null): Promise<Record<string, unknown>>;
  fetchFn?: FetchFn;
  log?: (msg: string, extra?: unknown) => void;
  /** tempo máximo de uma execução (ms) */
  budgetMs?: number;
  now?: () => number;
}

export type JobOutcome = 'sent' | 'retry' | 'failed' | 'skipped';
export interface DrainTotals { claimed: number; sent: number; retried: number; failed: number; skipped: number }

type CacheEntry = { provider: SmsProvider | WhatsAppProvider } | { error: NotifyError };
const cacheKey = (j: DeliverJob) => `${j.institution_id}|${j.channel}`;

async function record(deps: DeliverDeps, fn: string, args: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await deps.rpc.rpc(fn, args);
    if (error) deps.log?.(`${fn}: ${error.message}`, args.p_id);
  } catch (e) {
    // Se não conseguir registar, a mensagem fica "a enviar" e app.job_requeue_stuck volta a pô-la na fila.
    deps.log?.(`${fn}: falhou`, e instanceof Error ? e.message : e);
  }
}

/** Entrega UMA mensagem e regista o resultado. Nunca lança. */
export async function deliverJob(job: DeliverJob, deps: DeliverDeps, cache: Map<string, CacheEntry> = new Map()): Promise<JobOutcome> {
  const skip = async (reason: string): Promise<JobOutcome> => { await record(deps, 'notification_skip', { p_id: job.id, p_reason: reason }); return 'skipped'; };
  try {
    if (job.channel === 'sms') {
      const blocked = smsBlockedReason(cleanCategory(job.category), job.critical_only);
      if (blocked) return await skip(blocked);
    }
    const to = toE164(job.to_phone);
    if (!to) return await skip('Número de telefone inválido.');

    const key = cacheKey(job);
    let entry = cache.get(key);
    if (!entry) {
      try {
        const secret = await deps.openSecret(job.institution_id, job.channel, job.secret_enc);
        const missing = secretMissing(job.channel, job.provider, job.config ?? {}, secret);
        if (missing) throw new NotifyError(missing);
        const provider = job.channel === 'sms'
          ? makeSmsProvider(job.provider, job.config ?? {}, secret, deps.fetchFn)
          : makeWhatsAppProvider(job.provider, job.config ?? {}, secret, deps.fetchFn);
        entry = { provider };
      } catch (e) {
        // Credenciais em falta/ilegíveis ou fornecedor desconhecido: vale para todas as mensagens deste lote desta escola.
        const message = e instanceof NotifyError || (e as Error)?.name === 'SecretsError' ? (e as Error).message : safeNotifyMessage(e);
        entry = { error: new NotifyError(message) };
      }
      cache.set(key, entry);
    }
    if ('error' in entry) return await skip(entry.error.message);

    const input = {
      id: job.id, to, text: job.body,
      ...(job.channel === 'whatsapp' && job.attachment_url ? { attachment: { url: job.attachment_url, filename: job.attachment_name || 'documento.pdf' } } : {})
    };
    const res = job.channel === 'sms'
      ? await (entry.provider as SmsProvider).send(input)
      : await (entry.provider as WhatsAppProvider).sendTemplate(input);
    await record(deps, 'finish_notification', { p_id: job.id, p_ok: true, p_provider_id: res.providerId ?? null, p_error: null });
    return 'sent';
  } catch (e) {
    const message = safeNotifyMessage(e);
    const retryable = e instanceof NotifyError ? e.retryable : true;
    if (!retryable) return await skip(message);
    // finish_notification(ok=false) agenda a repetição com recuo; esgotadas as tentativas passa a "failed".
    await record(deps, 'finish_notification', { p_id: job.id, p_ok: false, p_provider_id: null, p_error: message });
    return (job.attempts ?? 1) >= 5 ? 'failed' : 'retry';
  }
}

/** Reserva lotes e entrega até a fila esvaziar ou o tempo acabar. */
export async function drainSchoolQueue(deps: DeliverDeps): Promise<DrainTotals> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 100_000;
  const totals: DrainTotals = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const cache = new Map<string, CacheEntry>();
  while (now() - started < budget) {
    const { data, error } = await deps.rpc.rpc('notification_claim_school', { p_limit: 50 });
    if (error) { deps.log?.(`notification_claim_school: ${error.message}`); break; }
    const jobs = (data as DeliverJob[] | null) ?? [];
    if (jobs.length === 0) break;
    totals.claimed += jobs.length;
    for (const j of jobs) {
      // Sem tempo: as que ficaram reservadas voltam à fila por app.job_requeue_stuck (10 min) — por isso paramos só entre mensagens.
      const out = await deliverJob(j, deps, cache);
      if (out === 'sent') totals.sent++; else if (out === 'retry') totals.retried++; else if (out === 'failed') totals.failed++; else totals.skipped++;
    }
  }
  return totals;
}
}

// ───── _shared/notifyPush.ts ─────
namespace M__shared_notifyPush {
import buildPushPayload = M__shared_webpush.buildPushPayload;
import isVapidPrivateKey = M__shared_webpush.isVapidPrivateKey;
import isVapidPublicKey = M__shared_webpush.isVapidPublicKey;
import sendWebPush = M__shared_webpush.sendWebPush;
import FetchFn = M__shared_webpush.FetchFn;
import PushOutcome = M__shared_webpush.PushOutcome;
import RpcClient = M__shared_notifyDeliver.RpcClient;
/**
 * Envio de push (Web Push/VAPID) às contas de UMA escola. Parte sem Deno e sem Supabase, testada em tests/notificationProviders.test.ts.
 * As chaves VAPID são da escola (migração 0039): a pública em config.publicKey, a privada cifrada em secret_enc.
 */

export interface PushAudience { kind: 'todos' | 'professores' | 'funcionarios' | 'alunos' | 'utilizadores'; ids?: string[] }
export interface PushMessage { title: string; body: string; url?: string; tag?: string; critical?: boolean }

export interface PushDeps {
  rpc: RpcClient;
  openSecret(inst: string, channel: 'push', enc: string | null): Promise<Record<string, unknown>>;
  /** apaga subscrições que já não existem (404/410) */
  removeSubscriptions(ids: string[]): Promise<void>;
  /** regista o resultado (last_ok_at / fail_count) */
  touchSubscriptions(okIds: string[], failIds: string[]): Promise<void>;
  fetchFn?: FetchFn;
  concurrency?: number;
}

export interface PushTotals {
  /** false = a escola não tem o push ligado */
  enabled: boolean;
  targets: number; sent: number; failed: number; removed: number;
  /** utilizadores com pelo menos um aparelho que recebeu */
  usersReached: number;
  error?: string;
}

const EMPTY: PushTotals = { enabled: false, targets: 0, sent: 0, failed: 0, removed: 0, usersReached: 0 };

export async function sendPushToAudience(deps: PushDeps, inst: string, audience: PushAudience, msg: PushMessage): Promise<PushTotals> {
  const { data: gw, error: ge } = await deps.rpc.rpc('notification_gateway_get', { p_inst: inst, p_channel: 'push' });
  if (ge) return { ...EMPTY, error: 'Não foi possível ler a configuração do push.' };
  const g = (gw as Array<{ config: any; secret_enc: string | null }> | null)?.[0];
  if (!g) return EMPTY;
  let privateKey = '';
  try { privateKey = String((await deps.openSecret(inst, 'push', g.secret_enc)).privateKey ?? ''); }
  catch (e) { return { ...EMPTY, enabled: true, error: (e as Error)?.message || 'Não foi possível abrir as chaves de push.' }; }
  const publicKey = String(g.config?.publicKey ?? ''), subject = String(g.config?.subject ?? '');
  if (!isVapidPublicKey(publicKey) || !isVapidPrivateKey(privateKey) || !subject) {
    return { ...EMPTY, enabled: true, error: 'As chaves de push desta escola estão incompletas. Volte a gerá-las em Configurações → Integrações → Notificações.' };
  }

  const { data: t, error: te } = await deps.rpc.rpc('notification_push_targets', { p_inst: inst, p_kind: audience.kind, p_ids: audience.ids ?? [] });
  if (te) return { ...EMPTY, enabled: true, error: 'Não foi possível obter os destinatários do push.' };
  const targets = (t as Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> | null) ?? [];
  const totals: PushTotals = { ...EMPTY, enabled: true, targets: targets.length };
  if (!targets.length) return totals;

  const payload = buildPushPayload({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
  const ok: string[] = [], fail: string[] = [], gone: string[] = [], users = new Set<string>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      const s = targets[i];
      let r: PushOutcome;
      try {
        r = await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload,
          { vapid: { publicKey, privateKey, subject }, urgency: msg.critical ? 'high' : 'normal', topic: msg.tag && /^[A-Za-z0-9_-]{1,32}$/.test(msg.tag) ? msg.tag : undefined, fetchFn: deps.fetchFn });
      } catch { r = { ok: false, status: 0, gone: false, retryable: true }; }
      if (r.ok) { ok.push(s.id); users.add(s.user_id); } else if (r.gone) gone.push(s.id); else fail.push(s.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 10, targets.length) }, worker));
  try { if (gone.length) await deps.removeSubscriptions(gone); } catch { /* melhor esforço */ }
  try { await deps.touchSubscriptions(ok, fail); } catch { /* melhor esforço */ }
  return { ...totals, sent: ok.length, failed: fail.length, removed: gone.length, usersReached: users.size };
}
}

// ───── notifications/index.ts ─────
import decryptSecret = M_school_backups_secrets.decryptSecret;
import encryptSecret = M_school_backups_secrets.encryptSecret;
import safeEqual = M_school_backups_secrets.safeEqual;
import SecretsError = M_school_backups_secrets.SecretsError;
import json = M__shared_cors.json;
import preflight = M__shared_cors.preflight;
import NotifyError = M__shared_notify.NotifyError;
import cleanBody = M__shared_notify.cleanBody;
import cleanCategory = M__shared_notify.cleanCategory;
import cleanSmsSetup = M__shared_notify.cleanSmsSetup;
import cleanWhatsAppSetup = M__shared_notify.cleanWhatsAppSetup;
import isSmsProvider = M__shared_notify.isSmsProvider;
import isWhatsAppProvider = M__shared_notify.isWhatsAppProvider;
import makeSmsProvider = M__shared_notify.makeSmsProvider;
import makeWhatsAppProvider = M__shared_notify.makeWhatsAppProvider;
import safeNotifyMessage = M__shared_notify.safeNotifyMessage;
import secretMissing = M__shared_notify.secretMissing;
import smsBlockedReason = M__shared_notify.smsBlockedReason;
import toE164 = M__shared_notify.toE164;
import drainSchoolQueue = M__shared_notifyDeliver.drainSchoolQueue;
import sendPushToAudience = M__shared_notifyPush.sendPushToAudience;
import PushAudience = M__shared_notifyPush.PushAudience;
import PushError = M__shared_webpush.PushError;
import cleanSubscription = M__shared_webpush.cleanSubscription;
import cleanVapidSubject = M__shared_webpush.cleanVapidSubject;
import generateVapidKeys = M__shared_webpush.generateVapidKeys;
import isVapidPrivateKey = M__shared_webpush.isVapidPrivateKey;
import isVapidPublicKey = M__shared_webpush.isVapidPublicKey;
import vapidPairMatches = M__shared_webpush.vapidPairMatches;

// ---- Lista de IPs autorizados (antes em _shared/ipGuard.ts; migração 0043) ----
function requestIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim();
  return v && v.length <= 45 ? v : null;
}
async function ipAllowed(admin: any, uid: string, req: Request): Promise<boolean> {
  const { data, error } = await admin.rpc('edge_ip_allowed', { p_uid: uid, p_ip: requestIp(req) });
  if (error) { console.error('ipGuard', error.message); return false; }
  return data === true;
}
const IP_DENIED_MESSAGE = 'Acesso recusado: rede não autorizada ou palavra-passe por renovar. Inicie sessão novamente.';

// notifications — notificações POR ESCOLA: push grátis (Web Push), SMS por fornecedor à escolha e WhatsApp com modelo. Ver docs/NOTIFICACOES_POR_ESCOLA.md.
//
// Chamadores (verify_jwt = false; a função valida ela própria):
//   • ADMINISTRADOR da escola  → save | test | disconnect | push-generate | push-test
//   • QUALQUER utilizador       → subscribe | unsubscribe   (o próprio aparelho)
//   • QUEM PODE ENVIAR AVISOS   → enqueue (SMS/WhatsApp) | push (audiência resolvida AQUI, no servidor)
//   • AGENDADOR (pg_cron / GitHub Actions) com x-cron-secret = NOTIFY_CRON_SECRET → entrega a fila e repetições
// A escola vem SEMPRE do perfil verificado, nunca do pedido. Segredos: NOTIFY_SECRETS_KEY (≥32; se faltar usa BACKUP_SECRETS_KEY),
// NOTIFY_CRON_SECRET (ou BACKUP_CRON_SECRET), opcional ALLOWED_ORIGIN.


const env = (k: string) => Deno.env.get(k) ?? '';
const masterKey = () => env('NOTIFY_SECRETS_KEY') || env('BACKUP_SECRETS_KEY');
type Channel = 'sms' | 'whatsapp' | 'push';
const scope = (inst: string, ch: Channel) => `notify:${inst}:${ch}`;   // entra na cifra: um segredo copiado para outra escola/canal não abre
const fail = (status: number, message: string) => json({ error: message }, status);
const service = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const isChannel = (v: unknown): v is Channel => v === 'sms' || v === 'whatsapp' || v === 'push';
const MAX_ENQUEUE = 500;
const AUDIENCES = ['todos', 'professores', 'funcionarios', 'alunos', 'utilizadores'];
const MAX_IDS = 2000;

interface Caller { uid: string; inst: string; role: string }
interface GatewayRow { channel: Channel; provider: string; enabled: boolean; config: Record<string, unknown>; secret_enc: string | null; critical_only: boolean }

const openSecret = (inst: string, ch: Channel, enc: string | null): Promise<Record<string, unknown>> => {
  if (!enc) return Promise.reject(new SecretsError('Falta preencher as credenciais do fornecedor.'));
  return decryptSecret<Record<string, unknown>>(masterKey(), scope(inst, ch), enc);
};

async function getGateway(admin: SupabaseClient, inst: string, ch: Channel): Promise<GatewayRow | null> {
  const { data } = await admin.from('notification_gateways').select('*').eq('institution_id', inst).eq('channel', ch).maybeSingle();
  return (data as GatewayRow | null) ?? null;
}
const audit = (admin: SupabaseClient, inst: string, uid: string, action: string, detail: Record<string, unknown>) =>
  admin.rpc('write_audit_event_service', { p_inst: inst, p_actor: uid, p_action: action, p_entity: 'school', p_entity_id: inst, p_detail: detail });

// ---------- Sessão ----------
async function authCaller(req: Request, admin: SupabaseClient): Promise<Caller | Response> {
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return fail(401, 'Sessão inválida');
  const { data: me } = await admin.from('profiles').select('institution_id, role, active').eq('id', u.user.id).single();
  if (!me || !me.active) return fail(403, 'Conta inactiva.');
  if (!(await ipAllowed(admin, u.user.id, req))) return fail(403, IP_DENIED_MESSAGE);
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });   // escola activa (mãe ou filial — 0024)
  const inst: string = typeof activeInst === 'string' && activeInst ? activeInst : me.institution_id;
  return { uid: u.user.id, inst, role: String(me.role) };
}

/** Configurar é só do administrador, e só se o Super Admin deixou a escola gravar em Integrações (0023). */
async function requireAdmin(admin: SupabaseClient, c: Caller): Promise<Response | null> {
  if (c.role !== 'admin') return fail(403, 'Só o administrador da escola gere as notificações.');
  const { data: fm } = await admin.from('school_feature_modes').select('mode').eq('institution_id', c.inst).eq('feature_key', 'integracoes').maybeSingle();
  if ((fm?.mode ?? 'oculto') !== 'gravacao') return fail(403, 'As Integrações estão em modo somente leitura (ou desactivadas) para esta escola. Contacte o suporte BandMed.');
  return null;
}

/** Quem pode enviar avisos: a permissão de escrita da colecção smsWhatsappNotifications, avaliada com o token de quem pede. */
async function requireSender(req: Request): Promise<Response | null> {
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data } = await caller.rpc('notification_can_send');
  return data === true ? null : fail(403, 'Sem permissão para enviar notificações.');
}

const drain = (admin: SupabaseClient) => drainSchoolQueue({
  rpc: admin as any, openSecret: (inst, ch, enc) => openSecret(inst, ch, enc), log: (m, x) => console.error('notifications', m, x)
});
async function scheduled(): Promise<Response> {
  // As mensagens "a enviar" há mais de 10 min voltam à fila pela tarefa app.job_requeue_stuck (0011, pg_cron).
  return json({ ok: true, ...(await drain(service())) });
}

const pushDeps = (admin: SupabaseClient) => ({
  rpc: admin as any,
  openSecret: (inst: string, ch: 'push', enc: string | null) => openSecret(inst, ch, enc),
  removeSubscriptions: async (ids: string[]) => { await admin.from('push_subscriptions').delete().in('id', ids); },
  touchSubscriptions: async (ok: string[], bad: string[]) => {
    if (ok.length) await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).in('id', ok);
    if (bad.length) {   // falhas seguidas (5) = o aparelho já não existe: sai da lista
      const { data } = await admin.from('push_subscriptions').select('id, fail_count').in('id', bad);
      for (const r of (data ?? []) as Array<{ id: string; fail_count: number }>) {
        if (r.fail_count + 1 >= 5) await admin.from('push_subscriptions').delete().eq('id', r.id);
        else await admin.from('push_subscriptions').update({ fail_count: r.fail_count + 1 }).eq('id', r.id);
      }
    }
  }
});

// ---------- Guardar a configuração ----------
async function saveChannel(admin: SupabaseClient, c: Caller, b: any): Promise<Response> {
  const ch = b.channel as Channel;
  const cur = await getGateway(admin, c.inst, ch);
  let provider: string, setup: { config: Record<string, unknown>; secret: Record<string, string> };
  try {
    if (ch === 'sms') { if (!isSmsProvider(b.provider)) throw new NotifyError('Escolha o fornecedor de SMS.'); provider = b.provider; setup = cleanSmsSetup(b.provider, b); }
    else if (ch === 'whatsapp') { if (!isWhatsAppProvider(b.provider)) throw new NotifyError('Escolha o fornecedor de WhatsApp.'); provider = b.provider; setup = cleanWhatsAppSetup(b.provider, b); }
    else return fail(400, 'O push configura-se com as acções push-generate / save com chaves próprias.');
  } catch (e) { return fail(400, safeNotifyMessage(e)); }

  // Segredos: os campos não escritos ficam como estavam (só se o fornecedor não mudou).
  let secret: Record<string, unknown> = {};
  try { if (cur?.secret_enc && cur.provider === provider) secret = await openSecret(c.inst, ch, cur.secret_enc); }
  catch (e) { if (!(e instanceof SecretsError)) throw e; secret = {}; }
  secret = { ...secret, ...setup.secret };
  const missing = secretMissing(ch, provider, setup.config, secret);
  if (missing) return fail(400, missing);

  const enabled = !!b.enabled;
  const criticalOnly = ch === 'sms' ? b.criticalOnly !== false : true;     // SMS: só crítico, salvo escolha contrária
  const secret_enc = await encryptSecret(masterKey(), scope(c.inst, ch), secret);
  const reset = !cur || cur.provider !== provider || Object.keys(setup.secret).length > 0;
  const { error } = await admin.from('notification_gateways').upsert({
    institution_id: c.inst, channel: ch, provider, enabled, config: setup.config, secret_enc, critical_only: criticalOnly, updated_at: new Date().toISOString(),
    ...(reset ? { last_test_at: null, last_test_ok: null, last_test_error: null } : {})
  });
  if (error) return fail(500, error.message);
  await audit(admin, c.inst, c.uid, 'RPC:notification_gateway_save', { channel: ch, provider, enabled, criticalOnly, secretChanged: Object.keys(setup.secret).length > 0 });
  return json({ ok: true });
}

async function savePush(admin: SupabaseClient, c: Caller, b: any): Promise<Response> {
  const cur = await getGateway(admin, c.inst, 'push');
  let subject: string;
  try { subject = cleanVapidSubject(b.subject ?? cur?.config?.subject); } catch (e) { return fail(400, safeNotifyMessage(e instanceof PushError ? new NotifyError(e.message) : e)); }
  let publicKey = String(cur?.config?.publicKey ?? ''), privateKey = '';
  let rotated = false;
  try {
    if (b.generate === true || (!cur && !b.privateKey)) {
      const k = await generateVapidKeys(); publicKey = k.publicKey; privateKey = k.privateKey; rotated = true;
    } else if (typeof b.privateKey === 'string' && b.privateKey.trim()) {
      publicKey = String(b.publicKey ?? '').trim(); privateKey = b.privateKey.trim();
      if (!isVapidPublicKey(publicKey) || !isVapidPrivateKey(privateKey) || !(await vapidPairMatches({ publicKey, privateKey }))) return fail(400, 'O par de chaves VAPID não é válido ou a privada não corresponde à pública.');
      rotated = publicKey !== cur?.config?.publicKey;
    } else if (cur?.secret_enc) {
      privateKey = String((await openSecret(c.inst, 'push', cur.secret_enc)).privateKey ?? '');
    } else return fail(400, 'Gere as chaves de push primeiro.');
  } catch (e) { return fail(e instanceof SecretsError ? 500 : 400, e instanceof Error ? e.message : 'Erro nas chaves.'); }

  const secret_enc = await encryptSecret(masterKey(), scope(c.inst, 'push'), { privateKey });
  const { error } = await admin.from('notification_gateways').upsert({
    institution_id: c.inst, channel: 'push', provider: 'webpush', enabled: !!b.enabled, config: { publicKey, subject }, secret_enc, critical_only: true,
    updated_at: new Date().toISOString(), ...(rotated ? { last_test_at: null, last_test_ok: null, last_test_error: null } : {})
  });
  if (error) return fail(500, error.message);
  let removed = 0;
  if (rotated && cur) {   // as subscrições feitas com a chave antiga já não servem: cada aparelho volta a subscrever sozinho
    const { data: del } = await admin.from('push_subscriptions').delete().eq('institution_id', c.inst).select('id');
    removed = del?.length ?? 0;
  }
  await audit(admin, c.inst, c.uid, 'RPC:notification_gateway_save', { channel: 'push', enabled: !!b.enabled, keysRotated: rotated, devicesReset: removed });
  return json({ ok: true, publicKey, keysRotated: rotated, devicesReset: removed });
}

// O anexo só pode ser o PDF de uma reunião servido por ESTE projecto (função meeting-file): nunca um endereço arbitrário.
function cleanAttachment(v: any): { url: string; filename: string } | null {
  if (!v || typeof v.url !== 'string') return null;
  const prefix = `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/meeting-file?`;
  if (!v.url.startsWith(prefix) || v.url.length > 400) return null;
  const filename = String(v.filename ?? 'documento.pdf').replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'documento.pdf';
  return { url: v.url, filename };
}

// ---------- SMS/WhatsApp: enfileirar com o token de quem pede ----------
async function enqueue(req: Request, admin: SupabaseClient, c: Caller, b: any): Promise<Response> {
  const msgs: any[] = Array.isArray(b.messages) ? b.messages : [];
  if (msgs.length === 0 || msgs.length > MAX_ENQUEUE) return fail(400, `Envie entre 1 e ${MAX_ENQUEUE} mensagens.`);
  const [sms, wa] = await Promise.all([getGateway(admin, c.inst, 'sms'), getGateway(admin, c.inst, 'whatsapp')]);
  const on = (g: GatewayRow | null) => !!g && g.enabled && !!g.secret_enc;
  const results: Array<{ id: string; ok: boolean; providerId?: string; error?: string }> = [];
  const rows: Array<Record<string, unknown>> = [], keep: string[] = [];
  for (const m of msgs) {
    const id = typeof m?.id === 'string' ? m.id.slice(0, 200) : '';
    if (!id) return fail(400, 'Pedido inválido.');
    const channel = m.channel;
    if (channel !== 'sms' && channel !== 'whatsapp') { results.push({ id, ok: false, error: 'Canal inválido.' }); continue; }
    const g = channel === 'sms' ? sms : wa;
    if (!on(g)) { results.push({ id, ok: false, error: `O ${channel === 'sms' ? 'SMS' : 'WhatsApp'} não está ligado nesta escola (Configurações → Integrações → Notificações).` }); continue; }
    const category = cleanCategory(m.category);
    if (channel === 'sms') { const blocked = smsBlockedReason(category, g!.critical_only); if (blocked) { results.push({ id, ok: false, error: blocked }); continue; } }
    const to = toE164(m.to);
    if (!to) { results.push({ id, ok: false, error: 'Número inválido.' }); continue; }
    let body: string; try { body = cleanBody(m.body); } catch (e) { results.push({ id, ok: false, error: safeNotifyMessage(e) }); continue; }
    const att = cleanAttachment(m.attachment);
    if (m.attachment && !att) { results.push({ id, ok: false, error: 'Anexo inválido: só são aceites os PDFs das reuniões da própria escola.' }); continue; }
    rows.push({ institution_id: c.inst, channel, to_phone: to, body, category, ...(att && channel === 'whatsapp' ? { attachment_url: att.url, attachment_name: att.filename } : {}) }); keep.push(id);
  }
  if (rows.length) {
    const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { error } = await asUser.from('notification_queue').insert(rows);   // a RLS aplica permissão e escola
    for (const id of keep) results.push(error ? { id, ok: false, error: 'A fila recusou o pedido.' } : { id, ok: true, providerId: 'fila' });
    if (!error) { try { (globalThis as any).EdgeRuntime?.waitUntil(drain(admin)); } catch { /* o agendador apanha */ } }
  }
  const byId = new Map(results.map((r) => [r.id, r]));
  return json({ results: msgs.map((m) => byId.get(String(m.id).slice(0, 200))) });
}

// ---------- Push: a audiência é resolvida AQUI ----------
async function pushNow(admin: SupabaseClient, c: Caller, b: any): Promise<Response> {
  const kind = String(b.audience?.kind ?? '');
  if (!AUDIENCES.includes(kind)) return fail(400, 'Público-alvo inválido.');
  const ids = Array.isArray(b.audience?.ids) ? b.audience.ids.map((x: unknown) => String(x).slice(0, 80)).slice(0, MAX_IDS) : [];
  const title = String(b.title ?? '').trim(), body = String(b.body ?? '').trim();
  if (!title || !body) return fail(400, 'Indique o título e a mensagem.');
  const audience: PushAudience = { kind: kind as PushAudience['kind'], ids };
  const r = await sendPushToAudience(pushDeps(admin), c.inst, audience, { title, body, url: typeof b.url === 'string' ? b.url : '/', tag: typeof b.tag === 'string' ? b.tag : undefined, critical: b.critical === true });
  return json({ ok: !r.error, ...r });
}

// ---------- Pedidos autenticados ----------
async function handleUser(req: Request): Promise<Response> {
  const admin = service();
  const who = await authCaller(req, admin);
  if (who instanceof Response) return who;
  const b: any = await req.json().catch(() => ({}));

  switch (b.action) {
    case 'subscribe': {
      let sub; try { sub = cleanSubscription(b.subscription); } catch (e) { return fail(400, (e as Error).message); }
      const g = await getGateway(admin, who.inst, 'push');
      if (!g?.enabled || !g.secret_enc) return fail(409, 'O push não está ligado nesta escola.');
      if (typeof b.publicKey === 'string' && b.publicKey !== g.config?.publicKey) return fail(409, 'A chave de push da escola mudou. Volte a subscrever.');
      const { error } = await admin.from('push_subscriptions').upsert({
        institution_id: who.inst, user_id: who.uid, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth,
        user_agent: String(req.headers.get('user-agent') ?? '').slice(0, 200), fail_count: 0
      }, { onConflict: 'endpoint' });
      if (error) return fail(500, 'Não foi possível guardar este aparelho.');
      return json({ ok: true });
    }
    case 'unsubscribe': {
      const endpoint = String(b.endpoint ?? '');
      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', who.uid);
      return json({ ok: true });
    }
    case 'enqueue': { const d = await requireSender(req); if (d) return d; return await enqueue(req, admin, who, b); }
    case 'push': { const d = await requireSender(req); if (d) return d; return await pushNow(admin, who, b); }
  }

  const denied = await requireAdmin(admin, who);
  if (denied) return denied;

  switch (b.action) {
    case 'save': {
      if (!isChannel(b.channel)) return fail(400, 'Canal desconhecido.');
      return b.channel === 'push' ? await savePush(admin, who, b) : await saveChannel(admin, who, b);
    }
    case 'push-generate': return await savePush(admin, who, { ...b, generate: true });
    case 'test': {
      if (!isChannel(b.channel)) return fail(400, 'Canal desconhecido.');
      const g = await getGateway(admin, who.inst, b.channel);
      if (!g?.secret_enc) return fail(409, 'Ligue primeiro o fornecedor.');
      let ok = true, detail = '', error: string | undefined;
      try {
        const sec = await openSecret(who.inst, b.channel, g.secret_enc);
        if (b.channel === 'push') {
          const pk = String(g.config?.publicKey ?? ''), sk = String(sec.privateKey ?? '');
          if (!(await vapidPairMatches({ publicKey: pk, privateKey: sk }))) throw new NotifyError('O par de chaves de push não confere. Gere-as de novo.');
          detail = 'As chaves de push estão correctas.';
        } else {
          const p = b.channel === 'sms' ? makeSmsProvider(g.provider, g.config, sec) : makeWhatsAppProvider(g.provider, g.config, sec);
          detail = await p.ping();
        }
      } catch (e) { ok = false; error = e instanceof SecretsError ? e.message : safeNotifyMessage(e); }
      await admin.from('notification_gateways').update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_error: error ?? null }).eq('institution_id', who.inst).eq('channel', b.channel);
      return json(ok ? { ok: true, detail } : { ok: false, error });
    }
    case 'push-test': {   // push de teste só para os aparelhos do próprio administrador
      const r = await sendPushToAudience(pushDeps(admin), who.inst, { kind: 'utilizadores', ids: [who.uid] }, { title: 'BandMed', body: 'Teste de notificações push: está tudo a funcionar.', url: '/', tag: 'teste' });
      if (r.error) return json({ ok: false, error: r.error });
      if (!r.targets) return json({ ok: false, error: 'Este aparelho ainda não está registado. Active as notificações no sino do topo e tente de novo.' });
      return json({ ok: r.sent > 0, ...r, ...(r.sent > 0 ? {} : { error: 'O serviço de push não aceitou o teste.' }) });
    }
    case 'sms-test': {   // SMS/WhatsApp de teste para um número indicado pelo administrador (conta como envio real)
      const ch = b.channel; if (ch !== 'sms' && ch !== 'whatsapp') return fail(400, 'Canal inválido.');
      const g = await getGateway(admin, who.inst, ch);
      if (!g?.secret_enc) return fail(409, 'Ligue primeiro o fornecedor.');
      const to = toE164(b.to); if (!to) return fail(400, 'Número inválido.');
      try {
        const sec = await openSecret(who.inst, ch, g.secret_enc);
        const input = { id: 'teste', to, text: 'BandMed: mensagem de teste das notificações da escola.' };
        const r = ch === 'sms' ? await makeSmsProvider(g.provider, g.config, sec).send(input) : await makeWhatsAppProvider(g.provider, g.config, sec).sendTemplate(input);
        return json({ ok: true, providerId: r.providerId ?? null });
      } catch (e) { return json({ ok: false, error: e instanceof SecretsError ? e.message : safeNotifyMessage(e) }); }
    }
    case 'disconnect': {
      if (!isChannel(b.channel)) return fail(400, 'Canal desconhecido.');
      const { error } = await admin.from('notification_gateways').delete().eq('institution_id', who.inst).eq('channel', b.channel);
      if (error) return fail(500, error.message);
      if (b.channel === 'push') await admin.from('push_subscriptions').delete().eq('institution_id', who.inst);
      await audit(admin, who.inst, who.uid, 'RPC:notification_gateway_disconnect', { channel: b.channel });
      return json({ ok: true });
    }
    default: return fail(400, 'Acção desconhecida.');
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    if (req.method !== 'POST') return fail(405, 'Método não permitido');
    const cron = req.headers.get('x-cron-secret');
    if (cron !== null) {
      const expected = env('NOTIFY_CRON_SECRET') || env('BACKUP_CRON_SECRET');
      if (expected.length < 24 || !safeEqual(cron, expected)) return fail(401, 'Segredo do agendador inválido');
      return await scheduled();
    }
    return await handleUser(req);
  } catch (e) {
    console.error('notifications', e);
    return fail(500, e instanceof SecretsError ? e.message : 'Erro interno. Veja os registos da função.');
  }
});