// payments — pagamentos AUTOMÁTICOS por referência Multicaixa, por escola (hoje: ProxyPay). Ver docs/PAGAMENTOS_REFERENCIA.md.
//
// Chamadores (verify_jwt = false; a função valida ela própria):
//   • ADMINISTRADOR da escola (Authorization: Bearer <jwt>)  → save | test | disconnect | simulate | sync-now
//   • STAFF (admin/director/secretaria/financeiro) e ALUNO/ENCARREGADO → reference (só das SUAS facturas) | cancel (staff)
//   • AGENDADOR (pg_cron / GitHub Actions) com x-cron-secret = PAYMENTS_CRON_SECRET → expira referências e consulta o
//     fornecedor (rede de segurança do webhook: se um aviso se perder, o pagamento é apanhado em ≤ 5 minutos)
// A escola vem SEMPRE do perfil verificado (ou da linha da escola no agendador), nunca do pedido.
// Segredos: PAYMENTS_SECRETS_KEY (≥32; se faltar usa BACKUP_SECRETS_KEY), PAYMENTS_CRON_SECRET (ou BACKUP_CRON_SECRET), opcional ALLOWED_ORIGIN.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ipAllowed, IP_DENIED_MESSAGE } from '../_shared/ipGuard.ts';
import { decryptSecret, encryptSecret, safeEqual, SecretsError } from '../school-backups/secrets.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  PayError, cleanApiKey, cleanEntity, cleanValidityDays, isGatewayProvider, makeClient, parseProxyPayment, safeMessage,
  type GatewayProvider, type PaymentProviderClient
} from '../_shared/pay.ts';
import { applyPayment } from '../_shared/payApply.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const masterKey = () => env('PAYMENTS_SECRETS_KEY') || env('BACKUP_SECRETS_KEY');
const scope = (inst: string) => `pay:${inst}`;          // entra na cifra: um segredo copiado para outra escola/uso não abre
const RUN_BUDGET_MS = 100_000;
const STAFF = ['admin', 'director', 'secretaria', 'financeiro'];

const fail = (status: number, message: string) => json({ error: message }, status);
const service = (): SupabaseClient => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const webhookFor = (inst: string) => `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/payments-webhook?school=${encodeURIComponent(inst)}`;

interface Gateway {
  institution_id: string; provider: GatewayProvider; enabled: boolean; sandbox: boolean; entity: string;
  validity_days: number; secret_enc: string | null;
}
interface Caller { uid: string; inst: string; role: string }

async function getGateway(admin: SupabaseClient, inst: string): Promise<Gateway | null> {
  const { data } = await admin.from('payment_gateways').select('*').eq('institution_id', inst).maybeSingle();
  return (data as Gateway | null) ?? null;
}

async function openClient(inst: string, provider: GatewayProvider, sandbox: boolean, secretEnc: string): Promise<PaymentProviderClient> {
  const s = await decryptSecret<{ apiKey: string }>(masterKey(), scope(inst), secretEnc);
  return makeClient(provider, { apiKey: String(s.apiKey), sandbox });
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
  // Escola activa (mãe ou filial — migração 0024).
  const { data: activeInst } = await admin.rpc('resolve_institution', { p_uid: u.user.id });
  const inst: string = typeof activeInst === 'string' && activeInst ? activeInst : me.institution_id;
  return { uid: u.user.id, inst, role: String(me.role) };
}

/** Configurar é só do administrador, e só se o Super Admin deixou a escola gravar em Integrações (migração 0023). */
async function requireAdmin(admin: SupabaseClient, c: Caller): Promise<Response | null> {
  if (c.role !== 'admin') return fail(403, 'Só o administrador da escola gere os pagamentos por referência.');
  const { data: fm } = await admin.from('school_feature_modes').select('mode').eq('institution_id', c.inst).eq('feature_key', 'integracoes').maybeSingle();
  if ((fm?.mode ?? 'oculto') !== 'gravacao') return fail(403, 'As Integrações estão em modo somente leitura (ou desactivadas) para esta escola. Contacte o suporte BandMed.');
  return null;
}

// ---------- Consulta ao fornecedor (rede de segurança do webhook) ----------
interface SyncSummary { seen: number; applied: number; review: number; failed: number; error?: string }

async function pullAndApply(admin: SupabaseClient, inst: string, provider: GatewayProvider, client: PaymentProviderClient): Promise<SyncSummary> {
  const sum: SyncSummary = { seen: 0, applied: 0, review: 0, failed: 0 };
  for (let round = 0; round < 5; round++) {                       // até 500 pagamentos por execução
    const list = await client.listPayments(100);
    if (!list.length) break;
    let acked = 0;
    for (const raw of list) {
      sum.seen++;
      let p;
      try { p = parseProxyPayment(raw); } catch { sum.failed++; continue; }
      const out = await applyPayment(admin, inst, provider, p, raw);
      if (!out.ok) { sum.failed++; continue; }                    // não confirma: o fornecedor volta a entregar
      if (out.outcome === 'aplicado') sum.applied++;
      else if (out.outcome !== 'duplicado') sum.review++;         // valor diferente, já paga, sem referência: a secretaria revê
      try { await client.ackPayment(p.eventKey); acked++; } catch { /* volta a vir; a RPC é idempotente */ }
    }
    if (list.length < 100 || acked === 0) break;
  }
  return sum;
}

interface SyncRow { inst: string; prov: GatewayProvider; sandbox: boolean; secret: string }

async function syncOne(admin: SupabaseClient, r: SyncRow): Promise<SyncSummary> {
  try {
    const client = await openClient(r.inst, r.prov, r.sandbox, r.secret);
    const sum = await pullAndApply(admin, r.inst, r.prov, client);
    await admin.rpc('payment_sync_finish', { p_inst: r.inst, p_ok: true, p_error: null });
    return sum;
  } catch (e) {
    const msg = e instanceof SecretsError ? e.message : safeMessage(e);
    await admin.rpc('payment_sync_finish', { p_inst: r.inst, p_ok: false, p_error: msg });
    return { seen: 0, applied: 0, review: 0, failed: 0, error: msg };
  }
}

async function scheduled(): Promise<Response> {
  const admin = service();
  const started = Date.now();
  const { data: expired } = await admin.rpc('payment_expire_due');
  const results: Array<{ inst: string; ok: boolean; applied: number }> = [];
  while (Date.now() - started < RUN_BUDGET_MS) {
    const { data, error } = await admin.rpc('payment_sync_claim_due', { p_limit: 1 });
    if (error) return fail(500, `claim: ${error.message}`);
    const r = (data as SyncRow[] | null)?.[0];
    if (!r) break;
    const s = await syncOne(admin, r);
    results.push({ inst: r.inst, ok: !s.error, applied: s.applied });
  }
  return json({ expired: expired ?? 0, ran: results.length, applied: results.reduce((a, x) => a + x.applied, 0), failed: results.filter((x) => !x.ok).map((x) => x.inst) });
}

// ---------- Gerar a referência de uma factura ----------
async function createReference(admin: SupabaseClient, c: Caller, invoiceId: string): Promise<Response> {
  const { data: r, error } = await admin.rpc('payment_reference_reserve', { p_inst: c.inst, p_invoice_id: invoiceId, p_user: c.uid });
  if (error) return fail(error.code === '22023' ? 400 : 500, error.code === '22023' ? error.message : 'Erro ao reservar a referência.');
  if (r.state === 'existente') return json({ ok: true, created: false, reference: r.reference, entity: r.entity, amountKz: r.amount, expiresOn: r.expires_on });
  if (r.state === 'a_gerar') return fail(409, 'A referência está a ser gerada. Aguarde alguns segundos e volte a abrir.');

  const g = await getGateway(admin, c.inst);
  if (!g?.secret_enc) { await admin.rpc('payment_reference_abort', { p_id: r.id }); return fail(400, 'Os pagamentos por referência não estão activos nesta escola.'); }
  let client: PaymentProviderClient;
  let refId: string;
  try {
    client = await openClient(c.inst, g.provider, g.sandbox, g.secret_enc);
    refId = await client.newReferenceId();
    await client.putReference(refId, {
      amountKz: Number(r.amount), endDate: String(r.expires_on),
      // callback_url: o ProxyPay avisa ESTE endereço quando esta referência for paga (não é preciso configurar nada no painel deles)
      custom: { invoice: String(r.invoice_number ?? '').slice(0, 60), school: c.inst, callback_url: webhookFor(c.inst) }
    });
  } catch (e) {
    await admin.rpc('payment_reference_abort', { p_id: r.id });
    if (e instanceof SecretsError) return fail(500, e.message);
    return fail(e instanceof PayError && e.status < 500 ? 400 : 502, safeMessage(e));
  }
  const { data: done, error: ce } = await admin.rpc('payment_reference_commit', { p_id: r.id, p_reference_id: refId });
  if (ce) {
    try { await client.deleteReference(refId); } catch { /* expira sozinha */ }
    await admin.rpc('payment_reference_abort', { p_id: r.id });
    console.error('payments: commit', c.inst, ce.message);
    return fail(500, 'Não foi possível guardar a referência. Tente de novo.');
  }
  if (r.stale_reference) { try { await client.deleteReference(String(r.stale_reference)); } catch { /* melhor esforço */ } }
  return json({ ok: true, created: true, reference: done.reference, entity: done.entity, amountKz: done.amount, expiresOn: done.expires_on });
}

// ---------- Pedidos autenticados ----------
async function handleUser(req: Request): Promise<Response> {
  const admin = service();
  const who = await authCaller(req, admin);
  if (who instanceof Response) return who;
  const b: any = await req.json().catch(() => ({}));

  switch (b.action) {
    case 'reference': {
      const invoiceId = String(b.invoiceId ?? '').slice(0, 200);
      if (!invoiceId) return fail(400, 'Indique a factura.');
      if (STAFF.includes(who.role)) { /* secretaria/financeiro/direcção: qualquer factura da escola */ }
      else if (who.role === 'aluno' || who.role === 'encarregado') {
        const { data: can } = await admin.rpc('payment_portal_can_pay', { p_inst: who.inst, p_uid: who.uid, p_invoice_id: invoiceId });
        if (!can) return fail(403, 'Esta factura não pertence à sua conta.');
      } else return fail(403, 'Sem permissão para gerar referências de pagamento.');
      return await createReference(admin, who, invoiceId);
    }

    case 'cancel': {
      if (!STAFF.includes(who.role)) return fail(403, 'Sem permissão.');
      const invoiceId = String(b.invoiceId ?? '').slice(0, 200);
      const { data: c } = await admin.rpc('payment_reference_cancel', { p_inst: who.inst, p_invoice_id: invoiceId, p_user: who.uid });
      if (!c) return json({ ok: true, cancelled: false });
      const g = await getGateway(admin, who.inst);
      if (g?.secret_enc && g.sandbox === !!c.sandbox && c.reference_id) {
        try { await (await openClient(who.inst, g.provider, g.sandbox, g.secret_enc)).deleteReference(String(c.reference_id)); } catch { /* expira sozinha */ }
      }
      return json({ ok: true, cancelled: true });
    }
  }

  // ---- daqui para baixo: só o administrador ----
  const denied = await requireAdmin(admin, who);
  if (denied) return denied;

  switch (b.action) {
    case 'save': {
      let provider: GatewayProvider, entity: string, validity: number;
      try {
        if (!isGatewayProvider(b.provider)) throw new PayError('Escolha o fornecedor de pagamentos.');
        provider = b.provider; entity = cleanEntity(b.entity); validity = cleanValidityDays(b.validityDays);
      } catch (e) { return fail(400, safeMessage(e)); }
      const sandbox = b.sandbox !== false;                        // sem indicação = testes (nunca produção por engano)
      const enabled = !!b.enabled;
      const cur = await getGateway(admin, who.inst);
      let secret_enc = cur?.provider === provider ? cur.secret_enc : null;
      let warning: string | undefined;
      const typed = typeof b.apiKey === 'string' && b.apiKey.trim() !== '';
      try {
        if (typed) {
          const apiKey = cleanApiKey(b.apiKey);
          try { await makeClient(provider, { apiKey, sandbox }).ping(); }
          catch (e) {
            if (e instanceof PayError && e.status < 500) throw e;   // chave recusada: não grava
            warning = `Guardado, mas não foi possível confirmar a chave agora: ${safeMessage(e)}`;
          }
          secret_enc = await encryptSecret(masterKey(), scope(who.inst), { apiKey });
        } else if (!secret_enc) throw new PayError('Indique a chave de API do fornecedor.');
        else if (cur && cur.sandbox !== sandbox) throw new PayError(`Ao mudar para o ambiente ${sandbox ? 'de TESTES (sandbox)' : 'REAL (produção)'}, indique a chave de API desse ambiente.`);
      } catch (e) {
        return fail(e instanceof SecretsError ? 500 : 400, e instanceof SecretsError ? e.message : safeMessage(e));
      }
      const targetChanged = !cur || cur.provider !== provider || cur.sandbox !== sandbox || cur.entity !== entity;
      const { error } = await admin.from('payment_gateways').upsert({
        institution_id: who.inst, provider, enabled, sandbox, entity, validity_days: validity, secret_enc, updated_at: new Date().toISOString(),
        ...(targetChanged || typed ? { last_test_at: null, last_test_ok: null, last_test_error: null } : {})
      });
      if (error) return fail(500, error.message);
      let reset = 0;
      if (cur && targetChanged) {                                 // as referências do ambiente/entidade antigos deixam de servir
        const { data: n } = await admin.rpc('payment_references_reset', { p_inst: who.inst, p_reason: 'mudança de ambiente, entidade ou fornecedor' });
        reset = Number(n ?? 0);
      }
      await audit(admin, who.inst, who.uid, 'RPC:payment_gateway_save', { provider, enabled, sandbox, entity, validity, keyChanged: typed, referencesCancelled: reset });
      return json({ ok: true, referencesCancelled: reset, ...(warning ? { warning } : {}) });
    }

    case 'test': {
      const g = await getGateway(admin, who.inst);
      if (!g?.secret_enc) return fail(409, 'Ligue primeiro o fornecedor (chave de API).');
      let ok = true, error: string | undefined;
      try { await (await openClient(who.inst, g.provider, g.sandbox, g.secret_enc)).ping(); }
      catch (e) { ok = false; error = e instanceof SecretsError ? e.message : safeMessage(e); }
      await admin.from('payment_gateways').update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_error: error ?? null }).eq('institution_id', who.inst);
      return json(ok ? { ok: true } : { ok: false, error });      // 200 mesmo com falha do fornecedor: o erro legível vai no corpo
    }

    case 'sync-now': {
      const { data } = await admin.rpc('payment_sync_claim_one', { p_inst: who.inst });
      const r = (data as SyncRow[] | null)?.[0];
      if (!r) return fail(409, 'Não há fornecedor ligado, ou já há uma consulta em curso/muito recente. Aguarde um minuto.');
      const s = await syncOne(admin, r);
      return json(s.error ? { ok: false, error: s.error } : { ok: true, ...s });
    }

    case 'simulate': {
      const g = await getGateway(admin, who.inst);
      if (!g?.secret_enc) return fail(409, 'Ligue primeiro o fornecedor (chave de API).');
      if (!g.sandbox) return fail(400, 'A simulação só existe no ambiente de testes (sandbox). Está em produção: pague a referência a sério.');
      const invoiceId = String(b.invoiceId ?? '').slice(0, 200);
      const { data: ref } = await admin.from('payment_references').select('reference_id, amount_kz')
        .eq('institution_id', who.inst).eq('invoice_id', invoiceId).eq('status', 'ativa').not('reference_id', 'is', null).maybeSingle();
      if (!ref) return fail(404, 'Esta factura não tem referência activa. Gere primeiro a referência.');
      try {
        const client = await openClient(who.inst, g.provider, true, g.secret_enc);
        await client.mockPayment(String(ref.reference_id), Number(ref.amount_kz));
        // Com webhook, o aviso chega sozinho; sem ele, a consulta apanha-o já: o resultado vê-se logo.
        const s = await pullAndApply(admin, who.inst, g.provider, client);
        return json({ ok: true, ...s });
      } catch (e) { return fail(e instanceof PayError ? 400 : 502, e instanceof SecretsError ? e.message : safeMessage(e)); }
    }

    case 'disconnect': {
      const reset = await admin.rpc('payment_references_reset', { p_inst: who.inst, p_reason: 'fornecedor desligado' });
      const { error } = await admin.from('payment_gateways').delete().eq('institution_id', who.inst);
      if (error) return fail(500, error.message);
      await audit(admin, who.inst, who.uid, 'RPC:payment_gateway_disconnect', { referencesCancelled: Number(reset.data ?? 0) });
      return json({ ok: true });
    }

    default:
      return fail(400, 'Acção desconhecida.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    if (req.method !== 'POST') return fail(405, 'Método não permitido');
    const cron = req.headers.get('x-cron-secret');
    if (cron !== null) {
      const expected = env('PAYMENTS_CRON_SECRET') || env('BACKUP_CRON_SECRET');
      if (expected.length < 24 || !safeEqual(cron, expected)) return fail(401, 'Segredo do agendador inválido');
      return await scheduled();
    }
    return await handleUser(req);
  } catch (e) {
    console.error('payments', e);
    return fail(500, e instanceof SecretsError ? e.message : 'Erro interno. Veja os registos da função.');
  }
});
