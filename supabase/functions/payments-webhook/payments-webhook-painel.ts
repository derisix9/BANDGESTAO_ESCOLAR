// payments-webhook (ficheiro único para o editor do Supabase — gerado a partir de supabase/functions)
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

// ───── _shared/pay.ts ─────
namespace M__shared_pay {

/**
 * Pagamentos por referência Multicaixa — parte PURA (sem Deno, sem Supabase): validação do que a escola escreve,
 * assinatura HMAC do aviso, e o cliente HTTP do fornecedor. Usada pelas Edge Functions `payments` e
 * `payments-webhook` e testada em tests/paymentGateway.test.ts (com rede simulada).
 *
 * Fornecedor implementado: ProxyPay (API v2, https://developer.proxypay.co.ao/v2/):
 *   • autenticação      Authorization: Token <chave>   +   Accept: application/vnd.proxypay.v2+json
 *   • novo id           POST   /reference_ids          → inteiro (9 dígitos)
 *   • criar referência  PUT    /references/{id}        { amount, end_datetime, custom_fields }  → 204
 *   • apagar            DELETE /references/{id}        → 204
 *   • pagamentos        GET    /payments?n=100         (fila; confirma-se com DELETE /payments/{id})
 *   • aviso (webhook)   POST ao nosso endereço, cabeçalho X-Signature = hex(HMAC-SHA256(chave, corpo bruto))
 *   • sandbox           POST   /payments               só no ambiente de testes (pagamento simulado)
 * Cada fornecedor novo é só mais uma classe com a mesma interface (PaymentProviderClient) em makeClient().
 */

export class PayError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'PayError'; }
}

export const GATEWAY_PROVIDERS = ['proxypay'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];
export const isGatewayProvider = (v: unknown): v is GatewayProvider =>
  typeof v === 'string' && (GATEWAY_PROVIDERS as readonly string[]).includes(v);

export const PROXYPAY_URLS = { production: 'https://api.proxypay.co.ao', sandbox: 'https://api.sandbox.proxypay.co.ao' } as const;

// ---------- O que a escola escreve ----------
/** Entidade Multicaixa: 1 a 5 dígitos; guardada e mostrada com 5 (ex.: 411 → 00411). */
export function cleanEntity(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (!/^\d{1,5}$/.test(s)) throw new PayError('A entidade Multicaixa tem de ter entre 1 e 5 dígitos (só números).');
  return s.padStart(5, '0');
}

/** Validade da referência em dias: 7 a 365 (30 por omissão). */
export function cleanValidityDays(v: unknown): number {
  if (v === undefined || v === null || v === '') return 30;
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
  if (!Number.isInteger(n) || n < 7 || n > 365) throw new PayError('A validade da referência tem de ser um número inteiro de dias entre 7 e 365.');
  return n;
}

/** Chave de API do fornecedor: sem espaços, tamanho razoável. */
export function cleanApiKey(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 8 || s.length > 300 || /\s/.test(s)) throw new PayError('A chave de API parece inválida (sem espaços, entre 8 e 300 caracteres).');
  return s;
}

// ---------- Números, datas, referência ----------
/**
 * Valor com 2 casas e ponto decimal, como o fornecedor exige ("9701.84"). Arredonda 1.005 para 1.01.
 * (Math.round(1.005 * 100) dá 100 por causa da representação binária; o expoente em texto evita esse erro.)
 */
export function money(n: number): string {
  if (!Number.isFinite(n)) throw new PayError('Valor inválido.');
  const s = String(n);
  const cents = /e/i.test(s) ? Math.round(n * 100) : Math.round(Number(`${s}e2`));
  return (cents / 100).toFixed(2);
}

/** Data (AAAA-MM-DD) daqui a `days` dias, no fuso de Angola (UTC+1). O fornecedor aceita a referência até 23:59:59 desse dia. */
export function dateInDays(days: number, now: number = Date.now()): string {
  const d = new Date(now + 3_600_000 + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Só dígitos e sem zeros à esquerda: forma canónica guardada na base de dados e comparada nos avisos. */
export function normalizeReferenceId(v: unknown): string {
  const s = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!/^\d{1,12}$/.test(s)) throw new PayError('Referência inválida.');
  return s;
}

/** Como o ATM mostra: 9 dígitos em grupos de 3 (475545250 → "475 545 250"). Igual a app.pay_format_ref() no SQL. */
export function formatReference(id: string | number): string {
  const s = normalizeReferenceId(id);
  if (s.length > 9) return s;
  const p = s.padStart(9, '0');
  return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6, 9)}`;
}

// ---------- Assinatura do aviso ----------
const te = new TextEncoder();
const toHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacSha256Hex(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', te.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', k, te.encode(body)));
}

/** Comparação em tempo constante da assinatura (hex minúsculo) do cabeçalho X-Signature com a calculada do corpo bruto. */
export async function verifySignature(apiKey: string, rawBody: string, header: string | null | undefined): Promise<boolean> {
  const got = String(header ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  const want = await hmacSha256Hex(apiKey, rawBody);
  let d = 0;
  for (let i = 0; i < 64; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

/** Mensagem segura para mostrar ao utilizador (sem chaves nem pormenores internos). */
export function safeMessage(e: unknown): string {
  if (e instanceof PayError) return e.message;
  const m = e instanceof Error ? e.message : String(e ?? '');
  if (/timeout|aborted|timed out/i.test(m)) return 'O fornecedor de pagamentos demorou demasiado a responder. Tente de novo dentro de instantes.';
  if (/fetch failed|network|dns|connect|tls|certificate/i.test(m)) return 'Não foi possível contactar o fornecedor de pagamentos. Tente de novo dentro de instantes.';
  return 'Erro inesperado ao falar com o fornecedor de pagamentos.';
}

// ---------- Pagamento confirmado ----------
export interface ParsedPayment {
  /** id do pagamento no fornecedor: chave de idempotência. */
  eventKey: string;
  /** referência canónica (sem zeros à esquerda). */
  referenceId: string;
  amountKz: number;
  /** ISO 8601. */
  paidAt: string;
  entityId: string | null;
  terminalType: string | null;
}

/** Valida UM pagamento (corpo do webhook ou elemento de GET /payments). Lança PayError se faltar algo essencial. */
export function parseProxyPayment(raw: unknown): ParsedPayment {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new PayError('Aviso de pagamento inválido.');
  const idRaw = o.id;
  if (!(typeof idRaw === 'number' || typeof idRaw === 'string') || !/^\d{1,20}$/.test(String(idRaw))) throw new PayError('Aviso sem identificador do pagamento.');
  const referenceId = normalizeReferenceId(o.reference_id);
  const amt = typeof o.amount === 'number' ? o.amount : /^\d+(\.\d{1,2})?$/.test(String(o.amount ?? '')) ? Number(o.amount) : NaN;
  if (!Number.isFinite(amt) || amt <= 0 || amt > 99_999_999.99) throw new PayError('Aviso com valor inválido.');
  const t = Date.parse(String(o.datetime ?? ''));
  const paidAt = Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
  const ent = o.entity_id;
  return {
    eventKey: String(idRaw), referenceId, amountKz: Math.round(amt * 100) / 100, paidAt,
    entityId: typeof ent === 'number' || (typeof ent === 'string' && /^\d{1,5}$/.test(ent)) ? String(ent).padStart(5, '0') : null,
    terminalType: typeof o.terminal_type === 'string' ? o.terminal_type.slice(0, 8) : null
  };
}

// ---------- Cliente do fornecedor ----------
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** O que qualquer fornecedor tem de saber fazer. */
export interface PaymentProviderClient {
  /** Confirma que a chave serve (não cria nada). */
  ping(): Promise<void>;
  /** Pede um id de referência novo. */
  newReferenceId(): Promise<string>;
  /** Cria/actualiza a referência com valor e validade. */
  putReference(id: string, a: { amountKz: number; endDate: string; custom: Record<string, string> }): Promise<void>;
  deleteReference(id: string): Promise<void>;
  /** Pagamentos ainda não confirmados (fila do fornecedor). */
  listPayments(n?: number): Promise<unknown[]>;
  ackPayment(eventKey: string): Promise<void>;
  /** Só no ambiente de testes. */
  mockPayment(id: string, amountKz: number): Promise<void>;
}

export class ProxyPayClient implements PaymentProviderClient {
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  constructor(private readonly apiKey: string, readonly sandbox: boolean, fetchFn?: FetchFn, private readonly timeoutMs = 15_000) {
    this.base = sandbox ? PROXYPAY_URLS.sandbox : PROXYPAY_URLS.production;
    this.fetchFn = fetchFn ?? ((u, i) => fetch(u, i));
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Token ${this.apiKey}`, Accept: 'application/vnd.proxypay.v2+json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchFn(`${this.base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (res.ok) return res;
    throw new PayError(await this.explain(res), res.status === 401 ? 400 : 502);
  }

  private async explain(res: Response): Promise<string> {
    if (res.status === 401) return `O ProxyPay recusou a chave de API. Confirme que é a chave do ambiente ${this.sandbox ? 'de TESTES (sandbox)' : 'REAL (produção)'}.`;
    if (res.status === 429) return 'O ProxyPay limitou os pedidos. Tente de novo dentro de um minuto.';
    if (res.status === 400) {
      let detail = '';
      try {
        const j: any = await res.json();
        const list = Array.isArray(j) ? j : Array.isArray(j?.errors) ? j.errors : [];
        detail = list.map((x: any) => `${x?.param ? x.param + ': ' : ''}${x?.message ?? ''}`).filter(Boolean).slice(0, 3).join('; ');
      } catch { /* sem detalhe */ }
      return `O ProxyPay recusou o pedido${detail ? ` (${detail.slice(0, 200)})` : ''}.`;
    }
    return `O ProxyPay respondeu com erro ${res.status}. Tente de novo mais tarde.`;
  }

  async ping(): Promise<void> { await this.call('GET', '/payments?n=1'); }

  async newReferenceId(): Promise<string> {
    const res = await this.call('POST', '/reference_ids');
    const v = await res.json().catch(() => null);
    return normalizeReferenceId(typeof v === 'number' || typeof v === 'string' ? v : (v as any)?.id);
  }

  async putReference(id: string, a: { amountKz: number; endDate: string; custom: Record<string, string> }): Promise<void> {
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.custom).slice(0, 10)) custom[k.slice(0, 40)] = String(v).slice(0, 200);
    await this.call('PUT', `/references/${normalizeReferenceId(id)}`, { amount: money(a.amountKz), end_datetime: a.endDate, custom_fields: custom });
  }

  async deleteReference(id: string): Promise<void> { await this.call('DELETE', `/references/${normalizeReferenceId(id)}`); }

  async listPayments(n = 100): Promise<unknown[]> {
    const res = await this.call('GET', `/payments?n=${Math.min(Math.max(Math.trunc(n) || 100, 1), 100)}`);
    const v = await res.json().catch(() => []);
    return Array.isArray(v) ? v : [];
  }

  async ackPayment(eventKey: string): Promise<void> {
    if (!/^\d{1,20}$/.test(eventKey)) throw new PayError('Identificador de pagamento inválido.');
    await this.call('DELETE', `/payments/${eventKey}`);
  }

  async mockPayment(id: string, amountKz: number): Promise<void> {
    if (!this.sandbox) throw new PayError('A simulação de pagamentos só existe no ambiente de testes (sandbox).');
    await this.call('POST', '/payments', { reference_id: Number(normalizeReferenceId(id)), amount: money(amountKz) });
  }
}

export function makeClient(provider: GatewayProvider, o: { apiKey: string; sandbox: boolean }, fetchFn?: FetchFn): PaymentProviderClient {
  switch (provider) {
    case 'proxypay': return new ProxyPayClient(o.apiKey, o.sandbox, fetchFn);
    default: throw new PayError('Fornecedor de pagamentos não suportado.');
  }
}
}

// ───── _shared/payApply.ts ─────
namespace M__shared_payApply {
import PayError = M__shared_pay.PayError;
import isGatewayProvider = M__shared_pay.isGatewayProvider;
import parseProxyPayment = M__shared_pay.parseProxyPayment;
import safeMessage = M__shared_pay.safeMessage;
import verifySignature = M__shared_pay.verifySignature;
import GatewayProvider = M__shared_pay.GatewayProvider;
import ParsedPayment = M__shared_pay.ParsedPayment;
/**
 * Pagamentos por referência — aplicar um pagamento confirmado e tratar o aviso (webhook) do fornecedor.
 * Parte sem Deno e sem Supabase (recebe o que precisa por parâmetro), por isso é testada em tests/paymentGateway.test.ts.
 * Usada pelas Edge Functions `payments` (consulta periódica / simulação) e `payments-webhook` (aviso do fornecedor).
 */

/** O mínimo que precisamos do cliente Supabase (service_role): chamar funções SQL. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export type ApplyOutcome = 'aplicado' | 'valor_diferente' | 'ja_paga' | 'sem_referencia' | 'duplicado';
export type ApplyResult = { ok: true; outcome: ApplyOutcome; invoiceId?: string; status?: string } | { ok: false; error: string };

/**
 * Entrega UM pagamento à base de dados (public.payment_apply_event, migração 0038): idempotente, numa só transacção.
 * Se falhar, deixa o rasto do erro (payment_event_fail) e devolve ok:false — quem chama NÃO confirma ao fornecedor,
 * que volta a entregar o mesmo pagamento mais tarde.
 */
export async function applyPayment(db: RpcClient, inst: string, provider: GatewayProvider, p: ParsedPayment, raw: unknown): Promise<ApplyResult> {
  const { data, error } = await db.rpc('payment_apply_event', {
    p_inst: inst, p_provider: provider, p_event_key: p.eventKey, p_reference: p.referenceId,
    p_amount: p.amountKz, p_paid_at: p.paidAt, p_payload: raw ?? null
  });
  if (error || !data || typeof data.outcome !== 'string') {
    const msg = error?.message ?? 'resposta vazia da base de dados';
    console.error('payments: apply', inst, p.eventKey, msg);
    try { await db.rpc('payment_event_fail', { p_inst: inst, p_provider: provider, p_event_key: p.eventKey, p_error: msg }); } catch { /* sem rasto, mas o fornecedor repete */ }
    return { ok: false, error: msg };
  }
  return { ok: true, outcome: data.outcome as ApplyOutcome, invoiceId: data.invoice_id ?? undefined, status: data.status ?? undefined };
}

// ---------- Webhook ----------
export interface WebhookDeps {
  /** Escola dona de uma entidade (só se for inequívoco): usado quando o endereço não traz ?school=. */
  findSchoolByEntity(provider: GatewayProvider, entity: string): Promise<string | null>;
  /** Fornecedor e chave cifrada da escola (null se não há fornecedor ligado). */
  loadGateway(inst: string): Promise<{ provider: GatewayProvider; secretEnc: string } | null>;
  /** Decifra a chave de API da escola. */
  openApiKey(inst: string, secretEnc: string): Promise<string>;
  apply(inst: string, provider: GatewayProvider, p: ParsedPayment, raw: unknown): Promise<ApplyResult>;
}
export interface WebhookInput { rawBody: string; signature: string | null; school: string | null; provider?: string | null }
export interface WebhookResult { status: number; error?: string; outcome?: string }

export const MAX_WEBHOOK_BYTES = 64 * 1024;
/** Resposta igual para tudo o que falha a autenticação: não revela se a escola existe. */
const UNAUTHENTICATED: WebhookResult = { status: 401, error: 'Aviso não autenticado.' };

/**
 * Trata um aviso do fornecedor. O fornecedor repete o aviso se não receber 2xx, por isso:
 *   204 = tratado (ou duplicado: nada é pago duas vezes)   401 = assinatura inválida / escola desconhecida
 *   400 = corpo inválido                                   500 = falhou a gravar → o fornecedor volta a tentar
 * A chave que valida a assinatura é a DA ESCOLA (cifrada no servidor): um aviso forjado para outra escola não passa.
 */
export async function processWebhook(deps: WebhookDeps, input: WebhookInput): Promise<WebhookResult> {
  const providerRaw = input.provider || 'proxypay';
  if (!isGatewayProvider(providerRaw)) return { status: 400, error: 'Fornecedor desconhecido.' };
  const provider: GatewayProvider = providerRaw;
  if (new TextEncoder().encode(input.rawBody).byteLength > MAX_WEBHOOK_BYTES) return { status: 400, error: 'Aviso demasiado grande.' };

  let json: unknown;
  try { json = JSON.parse(input.rawBody); } catch { return { status: 400, error: 'O corpo do aviso não é JSON.' }; }

  let inst = (input.school ?? '').trim().slice(0, 100);
  if (!inst) {
    const ent = (json as any)?.entity_id;
    const entity = typeof ent === 'number' || typeof ent === 'string' ? String(ent).replace(/\D/g, '').padStart(5, '0') : '';
    inst = /^\d{5}$/.test(entity) ? (await deps.findSchoolByEntity(provider, entity)) ?? '' : '';
  }
  if (!inst) return UNAUTHENTICATED;

  const gw = await deps.loadGateway(inst);
  if (!gw || gw.provider !== provider) return UNAUTHENTICATED;
  let apiKey: string;
  try { apiKey = await deps.openApiKey(inst, gw.secretEnc); } catch (e) { console.error('payments-webhook: chave', inst, safeMessage(e)); return { status: 500, error: 'Erro ao abrir as credenciais da escola.' }; }
  if (!(await verifySignature(apiKey, input.rawBody, input.signature))) return UNAUTHENTICATED;

  let payment: ParsedPayment;
  try { payment = parseProxyPayment(json); } catch (e) { return { status: 400, error: e instanceof PayError ? e.message : 'Aviso inválido.' }; }

  const out = await deps.apply(inst, provider, payment, json);
  if (!out.ok) return { status: 500, error: 'Não foi possível registar o pagamento; será repetido.' };
  return { status: 204, outcome: out.outcome };
}
}

// ───── payments-webhook/index.ts ─────
import decryptSecret = M_school_backups_secrets.decryptSecret;
import SecretsError = M_school_backups_secrets.SecretsError;
import applyPayment = M__shared_payApply.applyPayment;
import processWebhook = M__shared_payApply.processWebhook;
import WebhookDeps = M__shared_payApply.WebhookDeps;
import GatewayProvider = M__shared_pay.GatewayProvider;
// payments-webhook — recebe o AVISO de pagamento do fornecedor (hoje: ProxyPay) e paga a factura sozinha.
// Ver docs/PAGAMENTOS_REFERENCIA.md. verify_jwt = false: quem chama é o fornecedor, não um utilizador; a autenticidade
// vem da assinatura HMAC-SHA256 (cabeçalho X-Signature) calculada com a chave de API DA ESCOLA, guardada cifrada.
//   POST /functions/v1/payments-webhook?school=<id da escola>   (o `payments` põe este endereço em cada referência: custom field callback_url)
//   POST /functions/v1/payments-webhook                          (webhook fixo no painel do fornecedor: a escola vem da entidade, se for inequívoca)
// Segredos: PAYMENTS_SECRETS_KEY (≥32; se faltar usa BACKUP_SECRETS_KEY). Resposta 204 = tratado; outro código = o fornecedor repete.

const env = (k: string) => Deno.env.get(k) ?? '';
const masterKey = () => env('PAYMENTS_SECRETS_KEY') || env('BACKUP_SECRETS_KEY');
const scope = (inst: string) => `pay:${inst}`;          // o mesmo âmbito com que a função `payments` cifrou a chave
const reply = (status: number, error?: string) => new Response(error ? JSON.stringify({ error }) : null, { status, headers: error ? { 'Content-Type': 'application/json' } : {} });

function deps(admin: SupabaseClient): WebhookDeps {
  return {
    async findSchoolByEntity(provider, entity) {
      const { data } = await admin.rpc('payment_gateway_by_entity', { p_provider: provider, p_entity: entity });
      return typeof data === 'string' && data ? data : null;
    },
    async loadGateway(inst) {
      const { data } = await admin.from('payment_gateways').select('provider, secret_enc').eq('institution_id', inst).maybeSingle();
      return data?.secret_enc ? { provider: data.provider as GatewayProvider, secretEnc: String(data.secret_enc) } : null;
    },
    async openApiKey(inst, secretEnc) {
      const s = await decryptSecret<{ apiKey: string }>(masterKey(), scope(inst), secretEnc);
      return String(s.apiKey);
    },
    apply: (inst, provider, p, raw) => applyPayment(admin, inst, provider, p, raw)
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return reply(405, 'Método não permitido');
    const url = new URL(req.url);
    const rawBody = await req.text();                    // o corpo BRUTO: é sobre ele que a assinatura é calculada
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const r = await processWebhook(deps(admin), {
      rawBody, signature: req.headers.get('x-signature'), school: url.searchParams.get('school'), provider: url.searchParams.get('provider')
    });
    return reply(r.status, r.error);
  } catch (e) {
    console.error('payments-webhook', e instanceof SecretsError ? e.message : e);
    return reply(500, 'Erro interno.');                  // 5xx: o fornecedor repete mais tarde
  }
});
