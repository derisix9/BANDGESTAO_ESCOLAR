// notifications — notificações POR ESCOLA: push grátis (Web Push), SMS por fornecedor à escolha e WhatsApp com modelo. Ver docs/NOTIFICACOES_POR_ESCOLA.md.
//
// Chamadores (verify_jwt = false; a função valida ela própria):
//   • ADMINISTRADOR da escola  → save | test | disconnect | push-generate | push-test
//   • QUALQUER utilizador       → subscribe | unsubscribe   (o próprio aparelho)
//   • QUEM PODE ENVIAR AVISOS   → enqueue (SMS/WhatsApp) | push (audiência resolvida AQUI, no servidor)
//   • AGENDADOR (pg_cron / GitHub Actions) com x-cron-secret = NOTIFY_CRON_SECRET → entrega a fila e repetições
// A escola vem SEMPRE do perfil verificado, nunca do pedido. Segredos: NOTIFY_SECRETS_KEY (≥32; se faltar usa BACKUP_SECRETS_KEY),
// NOTIFY_CRON_SECRET (ou BACKUP_CRON_SECRET), opcional ALLOWED_ORIGIN.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ipAllowed, IP_DENIED_MESSAGE } from '../_shared/ipGuard.ts';
import { decryptSecret, encryptSecret, safeEqual, SecretsError } from '../school-backups/secrets.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  NotifyError, cleanBody, cleanCategory, cleanSmsSetup, cleanWhatsAppSetup, isSmsProvider, isWhatsAppProvider, makeSmsProvider,
  makeWhatsAppProvider, safeNotifyMessage, secretMissing, smsBlockedReason, toE164
} from '../_shared/notify.ts';
import { drainSchoolQueue } from '../_shared/notifyDeliver.ts';
import { sendPushToAudience, type PushAudience } from '../_shared/notifyPush.ts';
import { PushError, cleanSubscription, cleanVapidSubject, generateVapidKeys, isVapidPrivateKey, isVapidPublicKey, vapidPairMatches } from '../_shared/webpush.ts';

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
