import { describe, it, expect } from 'vitest';
import {
  NotifyError, TwilioSms, TwilioWhatsApp, InfobipSms, HttpSms, MetaWhatsApp, assertPublicHttpsUrl, cleanSmsSetup, cleanWhatsAppSetup, formatPhone,
  makeSmsProvider, renderHttpBody, secretMissing, smsBlockedReason, templateParam, toE164, cleanCategory
} from '../supabase/functions/_shared/notify';
import { drainSchoolQueue, deliverJob, type DeliverJob } from '../supabase/functions/_shared/notifyDeliver';
import { sendPushToAudience } from '../supabase/functions/_shared/notifyPush';
import { generateVapidKeys } from '../supabase/functions/_shared/webpush';
import { buildProvidersFromEnv } from '../server/notifyEnv';
import { checkRoute, pushAudienceFor, pushText } from '../src/utils/notificationRouting';
import { NO_CHANNELS, createNotificationChannelsApi, normalizeChannels } from '../src/utils/notificationChannelsApi';

const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const recorder = (responses: Response[] | ((u: string, i: RequestInit) => Response)) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let n = 0;
  const fn = async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return typeof responses === 'function' ? responses(url, init) : responses[Math.min(n++, responses.length - 1)]; };
  return { fn, calls };
};
const TW = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32) };

describe('regras de uso dos canais', () => {
  it('SMS só crítico quando a escola deixou ligado', () => {
    expect(smsBlockedReason('normal', true)).toMatch(/críticos/);
    expect(smsBlockedReason('critico', true)).toBeNull();
    expect(smsBlockedReason('normal', false)).toBeNull();
    expect(cleanCategory('critico')).toBe('critico');
    expect(cleanCategory('xpto')).toBe('normal');
  });
  it('telefones', () => {
    expect(toE164('923 456 789')).toBe('+244923456789');
    expect(formatPhone('+244923456789', 'local')).toBe('923456789');
    expect(formatPhone('+244923456789', 'digits')).toBe('244923456789');
  });
});

describe('endereços (anti-SSRF)', () => {
  it('só https públicos', () => {
    expect(assertPublicHttpsUrl('https://api.sms.ao/send').hostname).toBe('api.sms.ao');
    for (const bad of ['http://api.sms.ao', 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://sms.internal/x', 'https://u:p@sms.ao/x', 'https://sms.ao:8443/x', 'https://[::1]/x', 'https://0x7f000001/x', 'https://sms/x']) {
      expect(() => assertPublicHttpsUrl(bad), bad).toThrow(NotifyError);
    }
  });
  it('Infobip só em *.infobip.com', () => {
    expect(() => cleanSmsSetup('infobip', { config: { baseUrl: 'https://evil.com', sender: 'ESCOLA' }, secret: { apiKey: 'x'.repeat(30) } })).toThrow(/infobip/i);
    expect(cleanSmsSetup('infobip', { config: { baseUrl: 'https://abc12.api.infobip.com/x', sender: 'ESCOLA' }, secret: { apiKey: 'x'.repeat(30) } }).config.baseUrl).toBe('https://abc12.api.infobip.com');
  });
});

describe('validação do que a escola escreve', () => {
  it('Twilio SMS', () => {
    expect(() => cleanSmsSetup('twilio', { config: {}, secret: TW })).toThrow(/remetente/);
    expect(() => cleanSmsSetup('twilio', { config: { from: '+12025550123' }, secret: { accountSid: 'xx' } })).toThrow(/AC/);
    const ok = cleanSmsSetup('twilio', { config: { from: 'ESCOLA' }, secret: TW });
    expect(ok.secret.accountSid).toBe(TW.accountSid);
  });
  it('agregador HTTP: modelo com {{to}} e {{message}} e JSON válido', () => {
    const base = { url: 'https://api.agregador.ao/sms', bodyTemplate: '{"to":"{{to}}","text":"{{message}}"}' };
    expect(cleanSmsSetup('http', { config: base, secret: {} }).config.authMode).toBe('none');
    expect(() => cleanSmsSetup('http', { config: { ...base, bodyTemplate: '{"to":"{{to}}"}' }, secret: {} })).toThrow(/\{\{message\}\}/);
    expect(() => cleanSmsSetup('http', { config: { ...base, bodyTemplate: '{to:{{to}} {{message}}' }, secret: {} })).toThrow(/JSON/);
    expect(() => cleanSmsSetup('http', { config: { ...base, authMode: 'header', authName: 'Host' }, secret: {} })).toThrow(/cabeçalho/);
    expect(() => cleanSmsSetup('http', { config: { ...base, authMode: 'basic' }, secret: { token: 'semdoispontos' } })).toThrow(/utilizador:senha/);
  });
  it('WhatsApp exige modelo aprovado', () => {
    expect(() => cleanWhatsAppSetup('twilio', { config: { from: '+14155238886' }, secret: TW })).toThrow(/Content SID/);
    expect(() => cleanWhatsAppSetup('meta_cloud', { config: { phoneNumberId: '123456789', templateName: 'Aviso Escola' }, secret: { accessToken: 't'.repeat(30) } })).toThrow(/modelo/);
    expect(cleanWhatsAppSetup('meta_cloud', { config: { phoneNumberId: '123456789', templateName: 'aviso_escola' }, secret: { accessToken: 't'.repeat(30) } }).config.templateLang).toBe('pt_PT');
  });
  it('credenciais em falta', () => {
    expect(secretMissing('sms', 'twilio', {}, {})).toMatch(/credenciais/);
    expect(secretMissing('sms', 'http', { authMode: 'bearer' }, {})).toMatch(/token/i);
    expect(secretMissing('sms', 'http', { authMode: 'none' }, {})).toBeNull();
  });
});

describe('fornecedores (rede simulada)', () => {
  it('Twilio SMS: pedido certo e id do fornecedor', async () => {
    const r = recorder([reply(201, { sid: 'SM123' })]);
    const out = await new TwilioSms({ from: '+12025550123' }, TW, r.fn).send({ id: '1', to: '+244923456789', text: 'Olá' });
    expect(out.providerId).toBe('SM123');
    expect(r.calls[0].url).toContain(`/Accounts/${TW.accountSid}/Messages.json`);
    expect(String(r.calls[0].init.body)).toContain('To=%2B244923456789');
    expect((r.calls[0].init.headers as any).Authorization).toMatch(/^Basic /);
  });
  it('erros: 401 não repete; 429 e 500 repetem', async () => {
    const t = async (status: number): Promise<NotifyError> => {
      try { await new TwilioSms({ from: 'X' }, TW, recorder([reply(status, { message: 'x' })]).fn).send({ id: '1', to: '+244923456789', text: 'a' }); }
      catch (e) { return e as NotifyError; }
      throw new Error('Era esperada uma falha do fornecedor.');
    };
    expect((await t(401)).retryable).toBe(false);
    expect((await t(400)).retryable).toBe(false);
    expect((await t(429)).retryable).toBe(true);
    expect((await t(503)).retryable).toBe(true);
  });
  it('rede em baixo repete', async () => {
    const e = await (async (): Promise<NotifyError> => {
      try { await new TwilioSms({ from: 'X' }, TW, async () => { throw new Error('fetch failed'); }).send({ id: '1', to: '+244923456789', text: 'a' }); }
      catch (x) { return x as NotifyError; }
      throw new Error('Era esperada uma falha de rede.');
    })();
    expect(e.retryable).toBe(true);
  });
  it('Twilio WhatsApp usa o modelo (ContentSid + variável 1)', async () => {
    const r = recorder([reply(201, { sid: 'SMwa' })]);
    await new TwilioWhatsApp({ from: '+14155238886', contentSid: 'HX' + 'a'.repeat(32) }, TW, r.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Aviso\nlinha 2' });
    const b = new URLSearchParams(String(r.calls[0].init.body));
    expect(b.get('To')).toBe('whatsapp:+244923456789');
    expect(b.get('ContentSid')).toMatch(/^HX/);
    expect(JSON.parse(b.get('ContentVariables')!)['1']).toBe('Aviso | linha 2');
    expect(b.get('Body')).toBeNull();
  });
  it('WhatsApp sem modelo não envia texto livre', async () => {
    await expect(new TwilioWhatsApp({ from: '+14155238886' }, TW, recorder([reply(201, {})]).fn).sendTemplate({ id: '1', to: '+244923456789', text: 'a' })).rejects.toThrow(/modelo/);
  });
  it('Meta Cloud: template com parâmetro e códigos de erro explicados', async () => {
    const cfg = { phoneNumberId: '1234567890', templateName: 'aviso_escola', templateLang: 'pt_PT', apiVersion: 'v21.0' };
    const r = recorder([reply(200, { messages: [{ id: 'wamid.1' }] })]);
    const out = await new MetaWhatsApp(cfg, { accessToken: 't'.repeat(30) }, r.fn).sendTemplate({ id: '1', to: '+244923456789', text: 'Olá' });
    expect(out.providerId).toBe('wamid.1');
    const b = JSON.parse(String(r.calls[0].init.body));
    expect(b.type).toBe('template'); expect(b.to).toBe('244923456789'); expect(b.template.name).toBe('aviso_escola');
    const bad = async (code: number): Promise<NotifyError> => {
      try { await new MetaWhatsApp(cfg, { accessToken: 't'.repeat(30) }, recorder([reply(400, { error: { code } })]).fn).sendTemplate({ id: '1', to: '+244923456789', text: 'a' }); }
      catch (e) { return e as NotifyError; }
      throw new Error('Era esperada uma falha da Meta.');
    };
    expect((await bad(190)).message).toMatch(/expirou/);
    expect((await bad(132001)).message).toMatch(/APROVADO/);
  });
  it('Infobip: aceita PENDING, recusa REJECTED', async () => {
    const cfg = { baseUrl: 'https://abc.api.infobip.com', sender: 'ESCOLA' };
    const ok = await new InfobipSms(cfg, { apiKey: 'k'.repeat(30) }, recorder([reply(200, { messages: [{ messageId: 'm1', status: { groupId: 1 } }] })]).fn).send({ id: '1', to: '+244923456789', text: 'a' });
    expect(ok.providerId).toBe('m1');
    await expect(new InfobipSms(cfg, { apiKey: 'k'.repeat(30) }, recorder([reply(200, { messages: [{ status: { groupId: 5, description: 'rejeitada' } }] })]).fn).send({ id: '1', to: '+244923456789', text: 'a' })).rejects.toThrow(/não aceitou/);
  });
  it('agregador HTTP: corpo JSON escapado, autenticação e texto de sucesso', async () => {
    const cfg = { url: 'https://api.agregador.ao/sms', contentType: 'json' as const, bodyTemplate: '{"to":"{{to}}","text":"{{message}}"}', authMode: 'bearer' as const, phoneFormat: 'digits' as const, successContains: 'ok' };
    const r = recorder([reply(200, '{"status":"ok","id":77}')]);
    const out = await new HttpSms(cfg, { token: 'tok' }, r.fn).send({ id: '1', to: '+244923456789', text: 'Disse "olá"\nfim' });
    expect(out.providerId).toBe('77');
    expect((r.calls[0].init.headers as any).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ to: '244923456789', text: 'Disse "olá"\nfim' });
    await expect(new HttpSms(cfg, { token: 'tok' }, recorder([reply(200, '{"status":"erro"}')]).fn).send({ id: '1', to: '+244923456789', text: 'a' })).rejects.toThrow(/não confirmou/);
  });
  it('agregador HTTP: a chave pode ir no endereço ou em cabeçalho; formulário codifica', async () => {
    const q = recorder([reply(200, '{}')]);
    await new HttpSms({ url: 'https://a.ao/s', contentType: 'form', bodyTemplate: 'to={{to}}&msg={{message}}', authMode: 'query', authName: 'key', phoneFormat: 'local' }, { token: 'abc' }, q.fn).send({ id: '1', to: '+244923456789', text: 'a b&c' });
    expect(q.calls[0].url).toContain('key=abc');
    expect(String(q.calls[0].init.body)).toBe('to=923456789&msg=a%20b%26c');
    expect(renderHttpBody({ url: 'https://a.ao', contentType: 'json', bodyTemplate: '{"t":"{{message}}"}', authMode: 'none', phoneFormat: 'e164' }, { to: '+1', message: 'x"y', sender: '', id: 'i' })).toBe('{"t":"x\\"y"}');
  });
  it('não segue redireccionamentos nem chama endereços internos', async () => {
    const r = recorder([reply(200, '{}')]);
    await new HttpSms({ url: 'https://a.ao/s', contentType: 'json', bodyTemplate: '{"to":"{{to}}","t":"{{message}}"}', authMode: 'none', phoneFormat: 'e164' }, {}, r.fn).send({ id: '1', to: '+244923456789', text: 'a' });
    expect(r.calls[0].init.redirect).toBe('error');
    await expect(new HttpSms({ url: 'http://169.254.169.254/x', contentType: 'json', bodyTemplate: '{"to":"{{to}}","t":"{{message}}"}', authMode: 'none', phoneFormat: 'e164' }, {}, r.fn).send({ id: '1', to: '+244923456789', text: 'a' })).rejects.toThrow(/https/);
  });
  it('variável de modelo WhatsApp: sem quebras de linha, até 1024', () => {
    expect(templateParam('a\n\nb\tc')).toBe('a | b | c');
    expect(templateParam('x'.repeat(2000)).length).toBe(1024);
  });
  it('fornecedor desconhecido', () => { expect(() => makeSmsProvider('zap', {}, {})).toThrow(NotifyError); });
});

// ---------- Entrega da fila ----------
function fakeRpc(jobsBatches: DeliverJob[][]) {
  const calls: Array<{ fn: string; args: any }> = [];
  let i = 0;
  return {
    calls,
    rpc: async (fn: string, args: any) => {
      calls.push({ fn, args });
      if (fn === 'notification_claim_school') return { data: jobsBatches[i++] ?? [], error: null };
      return { data: null, error: null };
    }
  };
}
const job = (o: Partial<DeliverJob> = {}): DeliverJob => ({ id: 'j1', institution_id: 'e1', channel: 'sms', to_phone: '+244923456789', body: 'Propina em atraso', category: 'critico', attempts: 1, provider: 'twilio', config: { from: 'ESCOLA' }, secret_enc: 'enc', critical_only: true, ...o });

describe('entrega da fila por escola', () => {
  const secrets = async () => TW as Record<string, unknown>;
  it('envia e regista o resultado', async () => {
    const f = fakeRpc([[job()]]); const net = recorder([reply(201, { sid: 'SM9' })]);
    const t = await drainSchoolQueue({ rpc: f as any, openSecret: secrets, fetchFn: net.fn });
    expect(t).toMatchObject({ claimed: 1, sent: 1 });
    expect(f.calls.find((c) => c.fn === 'finish_notification')!.args).toMatchObject({ p_id: 'j1', p_ok: true, p_provider_id: 'SM9' });
  });
  it('SMS normal com "só crítico": não envia (nem chama o fornecedor) e não repete', async () => {
    const f = fakeRpc([[job({ category: 'normal' })]]); const net = recorder([reply(201, {})]);
    const t = await drainSchoolQueue({ rpc: f as any, openSecret: secrets, fetchFn: net.fn });
    expect(t.skipped).toBe(1); expect(net.calls.length).toBe(0);
    expect(f.calls.find((c) => c.fn === 'notification_skip')!.args.p_reason).toMatch(/críticos/);
  });
  it('número inválido: falha definitiva', async () => {
    const f = fakeRpc([[job({ to_phone: '123' })]]);
    expect((await drainSchoolQueue({ rpc: f as any, openSecret: secrets, fetchFn: recorder([reply(201, {})]).fn })).skipped).toBe(1);
  });
  it('erro temporário volta à fila (finish_notification ok=false); erro definitivo não', async () => {
    const f1 = fakeRpc([[job()]]);
    const t1 = await drainSchoolQueue({ rpc: f1 as any, openSecret: secrets, fetchFn: recorder([reply(503, '')]).fn });
    expect(t1.retried).toBe(1);
    expect(f1.calls.find((c) => c.fn === 'finish_notification')!.args.p_ok).toBe(false);
    const f2 = fakeRpc([[job()]]);
    const t2 = await drainSchoolQueue({ rpc: f2 as any, openSecret: secrets, fetchFn: recorder([reply(401, '')]).fn });
    expect(t2.skipped).toBe(1);
    expect(f2.calls.some((c) => c.fn === 'notification_skip')).toBe(true);
  });
  it('última tentativa esgotada conta como falhada', async () => {
    const f = fakeRpc([[job({ attempts: 5 })]]);
    expect((await drainSchoolQueue({ rpc: f as any, openSecret: secrets, fetchFn: recorder([reply(503, '')]).fn })).failed).toBe(1);
  });
  it('credenciais ilegíveis: todas as mensagens da escola falham de uma vez, sem rede', async () => {
    const f = fakeRpc([[job({ id: 'a' }), job({ id: 'b' })]]); const net = recorder([reply(201, {})]);
    let opened = 0;
    const t = await drainSchoolQueue({ rpc: f as any, fetchFn: net.fn, openSecret: async () => { opened++; throw Object.assign(new Error('chave do servidor alterada'), { name: 'SecretsError' }); } });
    expect(t.skipped).toBe(2); expect(opened).toBe(1); expect(net.calls.length).toBe(0);
  });
  it('escolas diferentes usam credenciais diferentes (nunca misturadas)', async () => {
    const f = fakeRpc([[job({ id: 'a', institution_id: 'e1', secret_enc: 'enc1' }), job({ id: 'b', institution_id: 'e2', secret_enc: 'enc2' })]]);
    const seen: string[] = [];
    await drainSchoolQueue({ rpc: f as any, fetchFn: recorder([reply(201, {})]).fn, openSecret: async (inst, _c, enc) => { seen.push(`${inst}:${enc}`); return TW; } });
    expect(seen).toEqual(['e1:enc1', 'e2:enc2']);
  });
  it('WhatsApp usa o modelo da escola', async () => {
    const f = fakeRpc([[job({ channel: 'whatsapp', provider: 'meta_cloud', config: { phoneNumberId: '1234567890', templateName: 'aviso', templateLang: 'pt_PT', apiVersion: 'v21.0' } })]]);
    const net = recorder([reply(200, { messages: [{ id: 'w1' }] })]);
    const t = await drainSchoolQueue({ rpc: f as any, openSecret: async () => ({ accessToken: 't'.repeat(30) }), fetchFn: net.fn });
    expect(t.sent).toBe(1); expect(JSON.parse(String(net.calls[0].init.body)).template.name).toBe('aviso');
  });
  it('um erro a registar o resultado não derruba o lote', async () => {
    const f = fakeRpc([[job({ id: 'a' }), job({ id: 'b' })]]);
    const rpc = async (fn: string, a: any) => { if (fn === 'finish_notification' && a.p_id === 'a') throw new Error('rede'); return f.rpc(fn, a); };
    expect((await drainSchoolQueue({ rpc: { rpc } as any, openSecret: secrets, fetchFn: recorder([reply(201, {})]).fn })).sent).toBe(2);
  });
  it('deliverJob nunca lança', async () => {
    expect(await deliverJob(job(), { rpc: { rpc: async () => { throw new Error('x'); } } as any, openSecret: secrets, fetchFn: recorder([reply(201, {})]).fn })).toBe('sent');
  });
});

// ---------- Push ----------
describe('push por escola', () => {
  it('envia só a quem a função devolve e limpa aparelhos mortos', async () => {
    const keys = await generateVapidKeys();
    const nodeCrypto = await import('node:crypto');
    const mk = () => { const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys(); return { p256dh: ua.getPublicKey().toString('base64url'), auth: nodeCrypto.randomBytes(16).toString('base64url') }; };
    const targets = [
      { id: 's1', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/aaa', ...mk() },
      { id: 's2', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/bbb', ...mk() },
      { id: 's3', user_id: 'u2', endpoint: 'https://fcm.googleapis.com/fcm/send/ccc', ...mk() },
      { id: 's4', user_id: 'u3', endpoint: 'https://fcm.googleapis.com/fcm/send/ddd', ...mk() }
    ];
    const asked: any[] = [];
    const rpc = async (fn: string, args: any) => {
      asked.push({ fn, args });
      if (fn === 'notification_gateway_get') return { data: [{ config: { publicKey: keys.publicKey, subject: 'mailto:a@escola.ao' }, secret_enc: 'enc' }], error: null };
      if (fn === 'notification_push_targets') return { data: targets, error: null };
      return { data: null, error: null };
    };
    const removed: string[] = []; let touched: any;
    const net = recorder((u) => (u.endsWith('ccc') ? reply(410, '') : u.endsWith('ddd') ? reply(503, '') : reply(201, '')));
    const r = await sendPushToAudience({ rpc: { rpc } as any, openSecret: async () => ({ privateKey: keys.privateKey }), removeSubscriptions: async (ids) => { removed.push(...ids); }, touchSubscriptions: async (ok, bad) => { touched = { ok, bad }; }, fetchFn: net.fn },
      'e1', { kind: 'alunos', ids: ['al1'] }, { title: 'Aviso', body: 'Reunião amanhã', url: '/', critical: true });
    expect(r).toMatchObject({ enabled: true, targets: 4, sent: 2, failed: 1, removed: 1, usersReached: 1 });
    expect(removed).toEqual(['s3']); expect(touched.ok.sort()).toEqual(['s1', 's2']); expect(touched.bad).toEqual(['s4']);
    expect(asked.find((a) => a.fn === 'notification_push_targets').args).toEqual({ p_inst: 'e1', p_kind: 'alunos', p_ids: ['al1'] });
    expect((net.calls[0].init.headers as any).Urgency).toBe('high');
  });
  it('escola sem push ligado: nada é enviado', async () => {
    const r = await sendPushToAudience({ rpc: { rpc: async () => ({ data: [], error: null }) } as any, openSecret: async () => ({}), removeSubscriptions: async () => {}, touchSubscriptions: async () => {} }, 'e1', { kind: 'todos' }, { title: 'a', body: 'b' });
    expect(r.enabled).toBe(false); expect(r.sent).toBe(0);
  });
  it('chaves incompletas dão erro legível, sem enviar', async () => {
    const rpc = async (fn: string) => ({ data: fn === 'notification_gateway_get' ? [{ config: {}, secret_enc: 'x' }] : [], error: null });
    const r = await sendPushToAudience({ rpc: { rpc } as any, openSecret: async () => ({ privateKey: 'x' }), removeSubscriptions: async () => {}, touchSubscriptions: async () => {} }, 'e1', { kind: 'todos' }, { title: 'a', body: 'b' });
    expect(r.error).toMatch(/chaves/);
  });
});

// ---------- Servidor global: fornecedor por variável de ambiente ----------
describe('server/notify.ts — fornecedor por variável de ambiente', () => {
  const env = (o: Record<string, string>) => (k: string) => o[k] || '';
  it('Twilio por omissão (comportamento anterior)', () => {
    const p = buildProvidersFromEnv(env({ TWILIO_ACCOUNT_SID: TW.accountSid, TWILIO_AUTH_TOKEN: TW.authToken, TWILIO_SMS_FROM: '+12025550123', TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' }));
    expect(p.sms?.name).toBe('Twilio'); expect(p.whatsapp?.name).toBe('Twilio WhatsApp');
  });
  it('agregador local escolhido só por variáveis', () => {
    const p = buildProvidersFromEnv(env({ SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://api.agregador.ao/sms', SMS_HTTP_BODY_TEMPLATE: '{"to":"{{to}}","text":"{{message}}"}', SMS_HTTP_AUTH_MODE: 'bearer', SMS_HTTP_TOKEN: 'abc' }));
    expect(p.sms?.name).toBe('Agregador de SMS');
  });
  it('Infobip e Meta', () => {
    const p = buildProvidersFromEnv(env({ SMS_PROVIDER: 'infobip', INFOBIP_BASE_URL: 'https://x.api.infobip.com', INFOBIP_API_KEY: 'k'.repeat(30), INFOBIP_SENDER: 'ESCOLA',
      WHATSAPP_PROVIDER: 'meta_cloud', META_PHONE_NUMBER_ID: '1234567890', META_ACCESS_TOKEN: 't'.repeat(30), META_TEMPLATE_NAME: 'aviso_escola' }));
    expect(p.sms?.name).toBe('Infobip'); expect(p.whatsapp?.name).toBe('WhatsApp (Meta)');
  });
  it('erros de configuração são legíveis e não rebentam', () => {
    const p = buildProvidersFromEnv(env({ SMS_PROVIDER: 'zap', WHATSAPP_PROVIDER: 'meta_cloud' }));
    expect(p.sms).toBeUndefined(); expect(p.smsError).toMatch(/não é suportado/); expect(p.whatsapp).toBeUndefined(); expect(p.whatsappError).toBeTruthy();
  });
});

// ---------- Cliente ----------
describe('roteamento no cliente', () => {
  const students: any[] = [{ id: 's1', status: 'active', classId: 'c1' }, { id: 's2', status: 'active', classId: 'c2' }, { id: 's3', status: 'inactive', classId: 'c1' }];
  it('audiência do push', () => {
    expect(pushAudienceFor('toda_escola', students)).toEqual({ kind: 'todos' });
    expect(pushAudienceFor('turma', students, 'c1')).toEqual({ kind: 'alunos', ids: ['s1'] });
    expect(pushAudienceFor('aluno', students, undefined, ['s2'])).toEqual({ kind: 'alunos', ids: ['s2'] });
    expect(pushAudienceFor('professores', students)).toEqual({ kind: 'professores' });
  });
  it('texto do push cortado', () => { expect(pushText(' '.repeat(2) + 'a'.repeat(100), 'b'.repeat(300))).toEqual({ title: 'a'.repeat(80), body: 'b'.repeat(200) }); });
  const on = { ...NO_CHANNELS, sms: true, whatsapp: true, push: true };
  it('canais desligados são recusados', () => {
    expect(checkRoute('push', false, NO_CHANNELS, false).ok).toBe(false);
    expect(checkRoute('sms', true, NO_CHANNELS, false).ok).toBe(false);
    expect(checkRoute('sms', true, NO_CHANNELS, true).ok).toBe(true);   // servidor global antigo
    expect(checkRoute('push', false, on, false).ok).toBe(true);
  });
  it('SMS normal é recusado, crítico segue; "ambos" segue só pelo WhatsApp com aviso', () => {
    expect(checkRoute('sms', false, on, false).error).toMatch(/críticos/);
    expect(checkRoute('sms', true, on, false).ok).toBe(true);
    const r = checkRoute('ambos', false, on, false);
    expect(r.ok).toBe(true); expect(r.warnings.length).toBe(1);
    expect(checkRoute('sms', false, { ...on, smsCriticalOnly: false }, false).ok).toBe(true);
  });
  it('API: normaliza o estado e propaga erros do servidor', async () => {
    expect(normalizeChannels(null)).toEqual(NO_CHANNELS);
    expect(normalizeChannels({ sms: true, smsCriticalOnly: false, pushPublicKey: 'K' })).toMatchObject({ sms: true, smsCriticalOnly: false, pushPublicKey: 'K', push: false });
    const calls: any[] = [];
    const api = createNotificationChannelsApi(async () => ({ data: { sms: true }, error: null }), async (b) => { calls.push(b); return b.action === 'save' ? { data: null, error: 'Falta o remetente' } : { data: { results: [{ id: 'a', ok: true }] }, error: null }; });
    expect((await api.enabled()).sms).toBe(true);
    await expect(api.save({ channel: 'sms', enabled: true })).rejects.toThrow('Falta o remetente');
    expect(await api.enqueue([{ id: 'a' }])).toEqual([{ id: 'a', ok: true }]);
    expect(calls[1]).toMatchObject({ action: 'enqueue' });
  });
});
