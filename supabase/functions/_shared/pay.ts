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
