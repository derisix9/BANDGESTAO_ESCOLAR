/**
 * Pagamentos por referência — aplicar um pagamento confirmado e tratar o aviso (webhook) do fornecedor.
 * Parte sem Deno e sem Supabase (recebe o que precisa por parâmetro), por isso é testada em tests/paymentGateway.test.ts.
 * Usada pelas Edge Functions `payments` (consulta periódica / simulação) e `payments-webhook` (aviso do fornecedor).
 */
import { PayError, isGatewayProvider, parseProxyPayment, safeMessage, verifySignature, type GatewayProvider, type ParsedPayment } from './pay.ts';

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
