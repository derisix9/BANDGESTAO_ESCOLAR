// payments-webhook — recebe o AVISO de pagamento do fornecedor (hoje: ProxyPay) e paga a factura sozinha.
// Ver docs/PAGAMENTOS_REFERENCIA.md. verify_jwt = false: quem chama é o fornecedor, não um utilizador; a autenticidade
// vem da assinatura HMAC-SHA256 (cabeçalho X-Signature) calculada com a chave de API DA ESCOLA, guardada cifrada.
//   POST /functions/v1/payments-webhook?school=<id da escola>   (o `payments` põe este endereço em cada referência: custom field callback_url)
//   POST /functions/v1/payments-webhook                          (webhook fixo no painel do fornecedor: a escola vem da entidade, se for inequívoca)
// Segredos: PAYMENTS_SECRETS_KEY (≥32; se faltar usa BACKUP_SECRETS_KEY). Resposta 204 = tratado; outro código = o fornecedor repete.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { decryptSecret, SecretsError } from '../school-backups/secrets.ts';
import { applyPayment, processWebhook, type WebhookDeps } from '../_shared/payApply.ts';
import type { GatewayProvider } from '../_shared/pay.ts';

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
