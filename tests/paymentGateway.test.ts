import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  PayError, ProxyPayClient, cleanApiKey, cleanEntity, cleanValidityDays, dateInDays, formatReference, hmacSha256Hex, isGatewayProvider,
  makeClient, money, normalizeReferenceId, parseProxyPayment, safeMessage, verifySignature, PROXYPAY_URLS
} from '../supabase/functions/_shared/pay';
import { applyPayment, processWebhook, type WebhookDeps, type RpcClient } from '../supabase/functions/_shared/payApply';
import { decryptSecret, encryptSecret } from '../supabase/functions/school-backups/secrets';
import { buildMulticaixaFields, buildMulticaixaReference } from '../src/utils/multicaixa';
import { createPaymentGatewayApi, friendlyPaymentError, providerInfo, webhookUrl, formatKz, PROVIDERS } from '../src/utils/paymentGatewayApi';

const KEY = 'chave-de-teste-123456';
const MASTER = 'm'.repeat(40);

describe('validação do que a escola escreve', () => {
  it('entidade: 1 a 5 dígitos, mostrada com 5', () => {
    expect(cleanEntity('411')).toBe('00411');
    expect(cleanEntity(' 00192 ')).toBe('00192');
    expect(cleanEntity('1 2 3')).toBe('00123');
    for (const bad of ['', 'abc', '123456', '12a', '-1', null, undefined]) expect(() => cleanEntity(bad), String(bad)).toThrow(PayError);
  });
  it('validade: 7 a 365 dias, 30 por omissão', () => {
    expect(cleanValidityDays(undefined)).toBe(30);
    expect(cleanValidityDays('')).toBe(30);
    expect(cleanValidityDays(7)).toBe(7);
    expect(cleanValidityDays('365')).toBe(365);
    for (const bad of [6, 366, 1.5, 'x', -3]) expect(() => cleanValidityDays(bad), String(bad)).toThrow(PayError);
  });
  it('chave de API: sem espaços, tamanho razoável', () => {
    expect(cleanApiKey('  abcdefgh12345678 ')).toBe('abcdefgh12345678');
    for (const bad of ['', 'curta', 'tem espaço no meio', 'x'.repeat(301), null]) expect(() => cleanApiKey(bad), String(bad)).toThrow(PayError);
  });
  it('fornecedores conhecidos', () => {
    expect(isGatewayProvider('proxypay')).toBe(true);
    expect(isGatewayProvider('emis')).toBe(false);
    expect(isGatewayProvider(undefined)).toBe(false);
  });
});

describe('formatação', () => {
  it('valor com 2 casas e ponto decimal', () => {
    expect(money(9701.84)).toBe('9701.84');
    expect(money(1000)).toBe('1000.00');
    expect(money(0.1 + 0.2)).toBe('0.30');
    expect(money(1.005)).toBe('1.01');
    expect(money(25000.675)).toBe('25000.68');
    expect(money(99_999_999.99)).toBe('99999999.99');
    expect(() => money(NaN)).toThrow(PayError);
    expect(() => money(Infinity)).toThrow(PayError);
  });
  it('data limite no fuso de Angola (UTC+1)', () => {
    const now = Date.parse('2026-10-26T23:30:00Z');          // já é dia 27 em Luanda
    expect(dateInDays(0, now)).toBe('2026-10-27');
    expect(dateInDays(30, now)).toBe('2026-11-26');
    expect(dateInDays(7, Date.parse('2026-10-26T10:00:00Z'))).toBe('2026-11-02');
  });
  it('referência: canónica e como o ATM mostra', () => {
    expect(normalizeReferenceId('000475545250')).toBe('475545250');
    expect(normalizeReferenceId(475545250)).toBe('475545250');
    expect(formatReference(475545250)).toBe('475 545 250');
    expect(formatReference('5545250')).toBe('005 545 250');
    expect(formatReference('1234567890')).toBe('1234567890');
    for (const bad of ['', 'abc', '0', '1234567890123']) expect(() => normalizeReferenceId(bad), bad).toThrow(PayError);
  });
});

describe('assinatura do aviso (HMAC-SHA256 em hexadecimal)', () => {
  const body = '{"id":156200026356,"reference_id":111111139,"amount":"1000.01"}';
  it('calcula o mesmo que o Node (referência independente)', async () => {
    expect(await hmacSha256Hex(KEY, body)).toBe(createHmac('sha256', KEY).update(body).digest('hex'));
  });
  it('aceita a assinatura certa (qualquer capitalização / espaços) e recusa o resto', async () => {
    const sig = createHmac('sha256', KEY).update(body).digest('hex');
    expect(await verifySignature(KEY, body, sig)).toBe(true);
    expect(await verifySignature(KEY, body, `  ${sig.toUpperCase()} `)).toBe(true);
    expect(await verifySignature(KEY, body + ' ', sig)).toBe(false);          // corpo alterado
    expect(await verifySignature('outra-chave-12345', body, sig)).toBe(false); // chave de outra escola
    for (const bad of [null, undefined, '', 'abc', sig.slice(1), sig + '0', 'z'.repeat(64)]) expect(await verifySignature(KEY, body, bad as any), String(bad)).toBe(false);
  });
});

describe('pagamento confirmado', () => {
  const ok = { id: 156200026356, reference_id: 111111139, amount: '1000.01', datetime: '2017-01-17T09:08:00Z', entity_id: 411, terminal_type: 'IB' };
  it('lê um aviso do ProxyPay', () => {
    expect(parseProxyPayment(ok)).toEqual({
      eventKey: '156200026356', referenceId: '111111139', amountKz: 1000.01, paidAt: '2017-01-17T09:08:00.000Z', entityId: '00411', terminalType: 'IB'
    });
  });
  it('aceita números e textos, e ignora zeros à esquerda na referência', () => {
    expect(parseProxyPayment({ ...ok, amount: 25000.5, reference_id: '000111111139', id: '7' })).toMatchObject({ amountKz: 25000.5, referenceId: '111111139', eventKey: '7' });
  });
  it('recusa avisos sem o essencial', () => {
    for (const bad of [null, [], 'x', {}, { ...ok, id: undefined }, { ...ok, id: 'abc' }, { ...ok, reference_id: 'x' }, { ...ok, amount: '0' }, { ...ok, amount: '-5' }, { ...ok, amount: 'dez' }, { ...ok, amount: 1e12 }]) {
      expect(() => parseProxyPayment(bad), JSON.stringify(bad)).toThrow(PayError);
    }
  });
});

describe('cliente ProxyPay (rede simulada)', () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const fake = (responses: Array<Response | Error>) => async (url: string, init?: RequestInit) => {
    calls.push({ url, method: String(init?.method), headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r ?? new Response(null, { status: 204 });
  };
  const reset = () => { calls.length = 0; };

  it('sandbox e produção usam endereços diferentes, com os cabeçalhos da API v2', async () => {
    reset();
    await new ProxyPayClient(KEY, true, fake([new Response('[]')])).ping();
    await new ProxyPayClient(KEY, false, fake([new Response('[]')])).ping();
    expect(calls[0].url).toBe(`${PROXYPAY_URLS.sandbox}/payments?n=1`);
    expect(calls[1].url).toBe(`${PROXYPAY_URLS.production}/payments?n=1`);
    expect(calls[0].headers.Authorization).toBe(`Token ${KEY}`);
    expect(calls[0].headers.Accept).toBe('application/vnd.proxypay.v2+json');
  });
  it('pede o id, cria a referência (valor com 2 casas, data, campos) e apaga', async () => {
    reset();
    const c = new ProxyPayClient(KEY, true, fake([new Response('475545250'), new Response(null, { status: 204 }), new Response(null, { status: 204 })]));
    const id = await c.newReferenceId();
    expect(id).toBe('475545250');
    await c.putReference(id, { amountKz: 9701.8, endDate: '2026-12-31', custom: { invoice: 'FT 2026/1', school: 'esc1' } });
    await c.deleteReference(id);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${PROXYPAY_URLS.sandbox}/reference_ids` });
    expect(calls[1]).toMatchObject({ method: 'PUT', url: `${PROXYPAY_URLS.sandbox}/references/475545250` });
    expect(JSON.parse(calls[1].body!)).toEqual({ amount: '9701.80', end_datetime: '2026-12-31', custom_fields: { invoice: 'FT 2026/1', school: 'esc1' } });
    expect(calls[1].headers['Content-Type']).toBe('application/json');
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: `${PROXYPAY_URLS.sandbox}/references/475545250` });
  });
  it('limita os campos personalizados (10 campos, chave 40, valor 200)', async () => {
    reset();
    const custom: Record<string, string> = {};
    for (let i = 0; i < 14; i++) custom[`k${i}`.padEnd(60, 'x')] = 'v'.repeat(300);
    await new ProxyPayClient(KEY, true, fake([])).putReference('1', { amountKz: 1, endDate: '2026-12-31', custom });
    const sent = JSON.parse(calls[0].body!).custom_fields as Record<string, string>;
    expect(Object.keys(sent)).toHaveLength(10);
    expect(Object.keys(sent)[0]).toHaveLength(40);
    expect(Object.values(sent)[0]).toHaveLength(200);
  });
  it('aceita o id devolvido como número ou como objecto', async () => {
    expect(await new ProxyPayClient(KEY, true, fake([new Response('123456789')])).newReferenceId()).toBe('123456789');
    expect(await new ProxyPayClient(KEY, true, fake([new Response('{"id":987654321}')])).newReferenceId()).toBe('987654321');
  });
  it('lista e confirma pagamentos; limita n a 1..100', async () => {
    reset();
    const c = new ProxyPayClient(KEY, true, fake([new Response('[{"id":1}]'), new Response('{"x":1}'), new Response(null, { status: 204 })]));
    expect(await c.listPayments(500)).toEqual([{ id: 1 }]);
    expect(calls[0].url).toContain('/payments?n=100');
    expect(await c.listPayments(0)).toEqual([]);                                 // não é lista → vazio
    await c.ackPayment('156200026356');
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: `${PROXYPAY_URLS.sandbox}/payments/156200026356` });
    await expect(c.ackPayment('../x')).rejects.toBeInstanceOf(PayError);
  });
  it('simulação só existe no sandbox', async () => {
    reset();
    await expect(new ProxyPayClient(KEY, false, fake([])).mockPayment('1', 10)).rejects.toThrow(/sandbox/i);
    await new ProxyPayClient(KEY, true, fake([new Response('{}')])).mockPayment('904800000', 9701.84);
    expect(JSON.parse(calls[0].body!)).toEqual({ reference_id: 904800000, amount: '9701.84' });
  });
  it('erros do fornecedor viram mensagens claras (sem a chave)', async () => {
    const run = (r: Response | Error, sandbox = true) => new ProxyPayClient(KEY, sandbox, fake([r])).ping().then(() => null, (e) => e as PayError);
    const e401 = await run(new Response('', { status: 401 }));
    expect(e401).toBeInstanceOf(PayError);
    expect(e401!.status).toBe(400);
    expect(e401!.message).toMatch(/TESTES/);
    expect((await run(new Response('', { status: 401 }), false))!.message).toMatch(/REAL/);
    expect((await run(new Response('', { status: 429 })))!.message).toMatch(/limitou/);
    const e400 = await run(new Response(JSON.stringify([{ param: 'amount', message: 'is invalid' }]), { status: 400 }));
    expect(e400!.message).toContain('amount: is invalid');
    const e500 = await run(new Response('', { status: 503 }));
    expect(e500!.status).toBe(502);
    for (const e of [e401, e400, e500]) expect(e!.message).not.toContain(KEY);
  });
  it('safeMessage esconde pormenores internos', () => {
    expect(safeMessage(new PayError('Referência inválida.'))).toBe('Referência inválida.');
    expect(safeMessage(new Error('The operation timed out'))).toMatch(/demorou/);
    expect(safeMessage(new TypeError('fetch failed'))).toMatch(/contactar/);
    expect(safeMessage(new Error('SELECT secret FROM x'))).toBe('Erro inesperado ao falar com o fornecedor de pagamentos.');
  });
  it('makeClient escolhe o adaptador e recusa fornecedores desconhecidos', () => {
    expect(makeClient('proxypay', { apiKey: KEY, sandbox: true })).toBeInstanceOf(ProxyPayClient);
    expect(() => makeClient('emis' as any, { apiKey: KEY, sandbox: true })).toThrow(PayError);
  });
});

describe('a chave de API fica cifrada por escola', () => {
  it('cifra e decifra; outra escola ou outra chave-mestra não abre', async () => {
    const token = await encryptSecret(MASTER, 'pay:escola-a', { apiKey: KEY });
    expect(token).not.toContain(KEY);
    expect(await decryptSecret<{ apiKey: string }>(MASTER, 'pay:escola-a', token)).toEqual({ apiKey: KEY });
    await expect(decryptSecret(MASTER, 'pay:escola-b', token)).rejects.toThrow();
    await expect(decryptSecret('x'.repeat(40), 'pay:escola-a', token)).rejects.toThrow();
    await expect(decryptSecret(MASTER, 'backup-escola-a', token)).rejects.toThrow();     // o âmbito dos pagamentos não abre o dos backups
  });
});

describe('aplicar um pagamento (base de dados simulada)', () => {
  const payment = parseProxyPayment({ id: 99, reference_id: 475545250, amount: '5000.00', datetime: '2026-10-26T10:00:00Z', entity_id: 411 });
  const rpcWith = (handler: (fn: string, args: any) => { data: any; error: any }): RpcClient & { log: Array<{ fn: string; args: any }> } => {
    const log: Array<{ fn: string; args: any }> = [];
    return { log, rpc: async (fn, args) => { log.push({ fn, args }); return handler(fn, args); } };
  };

  it('envia à função SQL o que o fornecedor disse (e o aviso bruto para auditoria)', async () => {
    const db = rpcWith(() => ({ data: { outcome: 'aplicado', invoice_id: 'inv-1', status: 'pago' }, error: null }));
    const r = await applyPayment(db, 'esc1', 'proxypay', payment, { id: 99 });
    expect(r).toEqual({ ok: true, outcome: 'aplicado', invoiceId: 'inv-1', status: 'pago' });
    expect(db.log[0]).toEqual({ fn: 'payment_apply_event', args: { p_inst: 'esc1', p_provider: 'proxypay', p_event_key: '99', p_reference: '475545250', p_amount: 5000, p_paid_at: '2026-10-26T10:00:00.000Z', p_payload: { id: 99 } } });
  });
  it('falha da base de dados: regista o erro e NÃO confirma (o fornecedor repete)', async () => {
    const db = rpcWith((fn) => (fn === 'payment_apply_event' ? { data: null, error: { message: 'deadlock' } } : { data: null, error: null }));
    const r = await applyPayment(db, 'esc1', 'proxypay', payment, {});
    expect(r).toEqual({ ok: false, error: 'deadlock' });
    expect(db.log.map((c) => c.fn)).toEqual(['payment_apply_event', 'payment_event_fail']);
    expect(db.log[1].args).toMatchObject({ p_event_key: '99', p_error: 'deadlock' });
  });
});

describe('webhook do fornecedor', () => {
  const PAY = { id: 156200026356, reference_id: 475545250, amount: '5000.00', datetime: '2026-10-26T10:00:00Z', entity_id: 411 };
  const sign = (key: string, body: string) => createHmac('sha256', key).update(body).digest('hex');
  const make = (over: Partial<WebhookDeps> = {}) => {
    const applied: Array<{ inst: string; key: string }> = [];
    const deps: WebhookDeps = {
      findSchoolByEntity: async (_p, entity) => (entity === '00411' ? 'esc1' : null),
      loadGateway: async (inst) => (inst === 'esc1' ? { provider: 'proxypay', secretEnc: 'enc' } : null),
      openApiKey: async () => KEY,
      apply: async (inst, _p, p) => { applied.push({ inst, key: p.eventKey }); return { ok: true, outcome: 'aplicado' }; },
      ...over
    };
    return { deps, applied };
  };
  const body = JSON.stringify(PAY);

  it('aviso verdadeiro: paga e responde 204', async () => {
    const { deps, applied } = make();
    expect(await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: 'esc1' })).toEqual({ status: 204, outcome: 'aplicado' });
    expect(applied).toEqual([{ inst: 'esc1', key: '156200026356' }]);
  });
  it('webhook fixo sem ?school=: a escola vem da entidade (se inequívoca)', async () => {
    const { deps, applied } = make();
    expect((await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: null })).status).toBe(204);
    expect(applied[0].inst).toBe('esc1');
    const unknown = JSON.stringify({ ...PAY, entity_id: 12345 });
    expect((await processWebhook(deps, { rawBody: unknown, signature: sign(KEY, unknown), school: null })).status).toBe(401);
  });
  it('assinatura falsa, em falta, de outra chave, ou corpo alterado: 401 e nada é pago', async () => {
    const { deps, applied } = make();
    for (const signature of [null, '', 'abc', sign('outra-chave-12345', body), sign(KEY, body + ' ')]) {
      expect((await processWebhook(deps, { rawBody: body, signature, school: 'esc1' })).status, String(signature)).toBe(401);
    }
    expect(applied).toEqual([]);
  });
  it('escola desconhecida ou sem fornecedor: 401 igual (não revela se existe)', async () => {
    const { deps } = make();
    const r = await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: 'nao-existe' });
    expect(r).toEqual({ status: 401, error: 'Aviso não autenticado.' });
  });
  it('corpo inválido ou enorme: 400', async () => {
    const { deps } = make();
    expect((await processWebhook(deps, { rawBody: 'não é json', signature: null, school: 'esc1' })).status).toBe(400);
    expect((await processWebhook(deps, { rawBody: JSON.stringify({ x: 'a'.repeat(70_000) }), signature: null, school: 'esc1' })).status).toBe(400);
    expect((await processWebhook(deps, { rawBody: body, signature: null, school: 'esc1', provider: 'emis' })).status).toBe(400);
    const odd = JSON.stringify({ ...PAY, amount: '0' });
    expect((await processWebhook(deps, { rawBody: odd, signature: sign(KEY, odd), school: 'esc1' })).status).toBe(400);   // assinado mas inválido
  });
  it('falha a gravar: 500, para o fornecedor repetir', async () => {
    const { deps } = make({ apply: async () => ({ ok: false, error: 'boom' }) });
    expect((await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: 'esc1' })).status).toBe(500);
  });
  it('não consegue abrir a chave guardada: 500 sem a mostrar', async () => {
    const { deps } = make({ openApiKey: async () => { throw new Error(`chave ${KEY} inválida`); } });
    const r = await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: 'esc1' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('o mesmo aviso repetido: continua a responder 204 (a base de dados ignora o duplicado)', async () => {
    const { deps } = make({ apply: async () => ({ ok: true, outcome: 'duplicado' }) });
    expect(await processWebhook(deps, { rawBody: body, signature: sign(KEY, body), school: 'esc1' })).toEqual({ status: 204, outcome: 'duplicado' });
  });
});

describe('a referência nunca é inventada no navegador', () => {
  it('as funções antigas devolvem sempre "sem referência"', () => {
    expect(buildMulticaixaReference('FT 2026/1', 5000, '00411')).toBe('');
    expect(buildMulticaixaFields('FT 2026/1', 5000, '00411')).toEqual({});
  });
});

describe('API do cliente', () => {
  const status = { configured: true, enabled: true };
  it('estado e "activo?" vêm das funções SQL; erros trazem o código', async () => {
    const api = createPaymentGatewayApi(async (fn) => (fn === 'payment_gateway_status' ? { data: status, error: null } : { data: true, error: null }), async () => ({ data: {}, error: null }));
    expect(await api.status()).toBe(status);
    expect(await api.enabled()).toBe(true);
    const bad = createPaymentGatewayApi(async () => ({ data: null, error: { message: 'x', code: 'PGRST202' } }), async () => ({ data: {}, error: null }));
    await expect(bad.status()).rejects.toMatchObject({ code: 'PGRST202' });
    await expect(bad.enabled()).rejects.toMatchObject({ code: 'PGRST202' });
  });
  it('acções vão para a Edge Function com o nome certo', async () => {
    const sent: any[] = [];
    const api = createPaymentGatewayApi(async () => ({ data: null, error: null }), async (b) => { sent.push(b); return { data: { ok: true }, error: null }; });
    await api.save({ provider: 'proxypay', enabled: true, sandbox: true, entity: '00411', validityDays: 30, apiKey: KEY });
    await api.test(); await api.syncNow(); await api.simulate('inv-1'); await api.disconnect(); await api.reference('inv-1'); await api.cancel('inv-1');
    expect(sent.map((b) => b.action)).toEqual(['save', 'test', 'sync-now', 'simulate', 'disconnect', 'reference', 'cancel']);
    expect(sent[3].invoiceId).toBe('inv-1');
    const failing = createPaymentGatewayApi(async () => ({ data: null, error: null }), async () => ({ data: null, error: 'Chave recusada' }));
    await expect(failing.test()).rejects.toThrow('Chave recusada');
  });
  it('mensagens amigáveis e endereço do webhook', () => {
    expect(friendlyPaymentError({ code: 'PGRST202', message: 'x' })).toMatch(/0038/);
    expect(friendlyPaymentError({ code: '42501', message: 'x' })).toMatch(/administrador/);
    expect(friendlyPaymentError(new Error('Failed to fetch'))).toMatch(/contactar/);
    expect(friendlyPaymentError(new Error('Chave recusada'))).toBe('Chave recusada');
    expect(webhookUrl('https://abc.supabase.co/', 'esc 1')).toBe('https://abc.supabase.co/functions/v1/payments-webhook?school=esc%201');
    expect(providerInfo('proxypay')).toBe(PROVIDERS[0]);
    expect(providerInfo(null)).toBe(PROVIDERS[0]);
    expect(formatKz(null)).toBe('—');
    expect(formatKz(5000)).toContain('Kz');
  });
});
