/** Ligação segura do número WhatsApp à conta autenticada do BANDGESTÃO. */
import { createHash, randomInt } from 'node:crypto';
import { createAdminClient, env, getCallerFromToken, isWhatsAppRuntimeConfigured, maskPhone, normalizeE164 } from '../_whatsapp-ai';
import { bearerToken, RateLimiter, sameOriginHost } from '../_guard';
import { loadProviderChain } from '../_ai-store';

declare const process: { env: Record<string, string | undefined> };

const byUser = new RateLimiter(8, 60_000);
const fail = (res: any, status: number, error: string) => res.status(status).json({ ok: false, error });
const tokenFrom = (req: any) => bearerToken(req.headers || {});

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  if (!sameOriginHost(req.headers || {})) return fail(res, 403, 'Origem não autorizada.');

  const token = tokenFrom(req);
  if (!token) return fail(res, 401, 'Inicie sessão no BANDGESTÃO.');
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return fail(res, 503, 'O serviço seguro do Supabase ainda não está configurado.'); }
  let caller;
  try { caller = await getCallerFromToken(token, admin); }
  catch (error) { return fail(res, 403, error instanceof Error ? error.message : 'Acesso recusado.'); }
  if (!byUser.allow(caller.uid)) return fail(res, 429, 'Demasiados pedidos. Tente novamente dentro de um minuto.');

  if (req.method === 'GET') {
    const { data: link } = await admin.from('whatsapp_ai_links').select('phone_e164,active,paired_at,last_message_at')
      .eq('user_id', caller.uid).eq('institution_id', caller.homeInstitutionId).maybeSingle();
    const aiProviders = (await loadProviderChain(admin, caller.institutionId)).length;
    return res.status(200).json({
      ok: true,
      configured: isWhatsAppRuntimeConfigured(),
      aiProviders,
      linked: !!link?.active,
      phone: link?.active ? maskPhone(String(link.phone_e164)) : null,
      businessPhone: env('WHATSAPP_AI_BUSINESS_NUMBER') || null,
      pairedAt: link?.paired_at || null,
      lastMessageAt: link?.last_message_at || null
    });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = String(body?.action || '');

  if (action === 'unlink') {
    const { error } = await admin.from('whatsapp_ai_links').delete().eq('user_id', caller.uid).eq('institution_id', caller.homeInstitutionId);
    await admin.from('whatsapp_ai_pairing_codes').delete().eq('user_id', caller.uid).eq('institution_id', caller.homeInstitutionId);
    if (error) return fail(res, 500, 'Não foi possível desligar o número WhatsApp.');
    await admin.rpc('write_audit_event_service', {
      p_inst: caller.institutionId, p_actor: caller.uid, p_action: 'whatsapp_ai_phone_unlinked',
      p_entity: 'whatsapp_ai_links', p_entity_id: caller.uid, p_detail: {}
    }).catch(() => {});
    return res.status(200).json({ ok: true, linked: false });
  }

  if (action !== 'generate') return fail(res, 400, 'Acção inválida.');
  if (!isWhatsAppRuntimeConfigured()) return fail(res, 503, 'O BANDGESTÃO AI ainda não está configurado no servidor. Configure as credenciais da Meta (WhatsApp) e do Supabase no Vercel.');
  const phone = normalizeE164(body?.phone);
  if (!phone) return fail(res, 400, 'Indique o número WhatsApp no formato internacional, por exemplo +244923000000.');

  const { data: existing } = await admin.from('whatsapp_ai_links').select('user_id,institution_id')
    .eq('phone_e164', phone).maybeSingle();
  if (existing && (existing.user_id !== caller.uid || existing.institution_id !== caller.homeInstitutionId)) {
    return fail(res, 409, 'Este número já está associado a outra conta BANDGESTÃO. Desligue primeiro a associação anterior.');
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await admin.from('whatsapp_ai_pairing_codes').delete().eq('user_id', caller.uid).eq('institution_id', caller.homeInstitutionId);
  const { error } = await admin.from('whatsapp_ai_pairing_codes').insert({
    institution_id: caller.homeInstitutionId, user_id: caller.uid, phone_e164: phone,
    code_hash: codeHash, expires_at: expiresAt
  });
  if (error) {
    console.error('BANDGESTAO AI: falha ao criar código de associação:', error.message);
    return fail(res, 500, 'Não foi possível gerar o código de ligação.');
  }
  await admin.rpc('write_audit_event_service', {
    p_inst: caller.institutionId, p_actor: caller.uid, p_action: 'whatsapp_ai_pairing_code_generated',
    p_entity: 'whatsapp_ai_pairing_codes', p_entity_id: caller.uid, p_detail: { phoneSuffix: phone.slice(-4) }
  }).catch(() => {});

  return res.status(200).json({
    ok: true, code, expiresAt,
    businessPhone: env('WHATSAPP_AI_BUSINESS_NUMBER') || null,
    instruction: `Envie a mensagem LIGAR ${code} para o número oficial do BANDGESTÃO AI dentro de 10 minutos.`
  });
}
