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
