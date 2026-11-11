/**
 * Gestão dos fornecedores de IA (OpenAI, Gemini, Claude, Groq, OpenRouter) de cada instituição.
 * Apenas o Administrador pode ver o estado ou alterar chaves. As chaves são cifradas no servidor e
 * nunca regressam ao navegador: só se mostram os últimos 4 caracteres.
 */
import { createAdminClient, getCallerFromToken } from '../_whatsapp-ai';
import { bearerToken, RateLimiter, sameOriginHost } from '../_guard';
import { PROVIDERS, PROVIDER_IDS, serverCredentials, testCredential, type ProviderId } from '../_ai-providers';
import { deleteProviderKey, listStoredProviders, loadProviderChain, loadStoredCredential, recordProviderStatus, saveProviderKey } from '../_ai-store';

const byUser = new RateLimiter(20, 60_000);
const testsByUser = new RateLimiter(8, 60_000);
const fail = (res: any, status: number, error: string) => res.status(status).json({ ok: false, error });

const catalog = () => {
  const server = new Set(serverCredentials().map((c) => c.provider));
  return PROVIDER_IDS.map((id) => ({
    id, label: PROVIDERS[id].label, defaultModel: PROVIDERS[id].defaultModel, free: PROVIDERS[id].free,
    note: PROVIDERS[id].note, helpUrl: PROVIDERS[id].helpUrl, serverKey: server.has(id)
  }));
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  if (!sameOriginHost(req.headers || {})) return fail(res, 403, 'Origem não autorizada.');
  const token = bearerToken(req.headers || {});
  if (!token) return fail(res, 401, 'Inicie sessão no BANDGESTÃO.');

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return fail(res, 503, 'O serviço seguro do Supabase ainda não está configurado.'); }
  let caller;
  try { caller = await getCallerFromToken(token, admin); }
  catch (error) { return fail(res, 403, error instanceof Error ? error.message : 'Acesso recusado.'); }
  if (!byUser.allow(caller.uid)) return fail(res, 429, 'Demasiados pedidos. Tente novamente dentro de um minuto.');

  const canManage = caller.role === 'admin';

  if (req.method === 'GET') {
    const available = (await loadProviderChain(admin, caller.institutionId)).length;
    if (!canManage) return res.status(200).json({ ok: true, canManage: false, available });
    try {
      return res.status(200).json({ ok: true, canManage: true, available, catalog: catalog(), providers: await listStoredProviders(admin, caller.institutionId) });
    } catch (error) {
      return fail(res, 500, error instanceof Error ? `${error.message} Confirme que a migração 0049 foi aplicada.` : 'Erro ao consultar os fornecedores.');
    }
  }

  if (!canManage) return fail(res, 403, 'Apenas o Administrador pode configurar os fornecedores de IA.');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = String(body?.action || '');
  const provider = String(body?.provider || '') as ProviderId;
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) return fail(res, 400, 'Fornecedor desconhecido.');

  const audit = (name: string, detail: Record<string, unknown> = {}) => admin.rpc('write_audit_event_service', {
    p_inst: caller.institutionId, p_actor: caller.uid, p_action: name, p_entity: 'whatsapp_ai_provider_keys', p_entity_id: provider, p_detail: { provider, ...detail }
  }).then(() => undefined, () => undefined);

  try {
    if (action === 'save') {
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey : undefined;
      await saveProviderKey(admin, caller.institutionId, caller.uid, {
        provider, apiKey, model: body.model === undefined ? undefined : String(body.model),
        priority: body.priority === undefined ? undefined : Number(body.priority),
        enabled: body.enabled === undefined ? undefined : !!body.enabled
      });
      await audit('whatsapp_ai_provider_saved', { keyChanged: !!apiKey, enabled: body.enabled });
      let test: Awaited<ReturnType<typeof testCredential>> | null = null;
      if (apiKey && testsByUser.allow(caller.uid)) {
        const cred = await loadStoredCredential(admin, caller.institutionId, provider);
        if (cred) { test = await testCredential(cred); await recordProviderStatus(admin, caller.institutionId, provider, test.ok, test.ok ? undefined : test.message); }
      }
      return res.status(200).json({ ok: true, test, providers: await listStoredProviders(admin, caller.institutionId) });
    }

    if (action === 'delete') {
      await deleteProviderKey(admin, caller.institutionId, provider);
      await audit('whatsapp_ai_provider_removed');
      return res.status(200).json({ ok: true, providers: await listStoredProviders(admin, caller.institutionId) });
    }

    if (action === 'test') {
      if (!testsByUser.allow(caller.uid)) return fail(res, 429, 'Demasiados testes seguidos. Aguarde um minuto.');
      const cred = await loadStoredCredential(admin, caller.institutionId, provider);
      if (!cred) return fail(res, 404, 'Este fornecedor ainda não tem chave guardada.');
      const test = await testCredential(cred);
      await recordProviderStatus(admin, caller.institutionId, provider, test.ok, test.ok ? undefined : test.message);
      return res.status(200).json({ ok: true, test, providers: await listStoredProviders(admin, caller.institutionId) });
    }
  } catch (error) {
    return fail(res, 400, error instanceof Error ? error.message : 'Não foi possível concluir o pedido.');
  }
  return fail(res, 400, 'Acção inválida.');
}
