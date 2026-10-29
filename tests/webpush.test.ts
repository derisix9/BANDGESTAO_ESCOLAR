import { describe, it, expect } from 'vitest';
import { createECDH, createPublicKey, createDecipheriv, hkdfSync, randomBytes, verify } from 'node:crypto';
import {
  buildPushPayload, cleanSubscription, cleanVapidSubject, encryptPayload, generateVapidKeys, isAllowedPushEndpoint, isVapidPrivateKey, isVapidPublicKey,
  sendWebPush, unb64url, vapidAuthHeader, vapidPairMatches, b64url
} from '../supabase/functions/_shared/webpush';

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');

/** Receptor de referência (RFC 8291 §3.4), escrito à parte com node:crypto: decifra o que o nosso emissor produz. */
function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const ecdh = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(0x02)).toString('utf8');
}

describe('cifra Web Push (RFC 8291)', () => {
  it('vetor de teste do Apêndice A da RFC', async () => {
    const asPub = Buffer.from('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url');
    const eph = {
      privateKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(asPub.subarray(1, 33)), y: b64u(asPub.subarray(33)), d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    } as CryptoKeyPair;
    const out = await encryptPayload({ p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      new TextEncoder().encode('When I grow up, I want to be a watermelon'), { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), ephemeral: eph });
    expect(b64u(out)).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });
  it('ida e volta com receptor independente (vários tamanhos, acentos e emoji)', async () => {
    for (const text of ['olá', 'Propina de Outubro em atraso — Ana Silva', 'x'.repeat(1500), JSON.stringify({ title: 'Aviso', body: 'ç ã é 😀' })]) {
      const ua = createECDH('prime256v1'); ua.generateKeys(); const auth = randomBytes(16);
      const body = await encryptPayload({ p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }, new TextEncoder().encode(text));
      expect(decrypt(Buffer.from(body), ua, auth)).toBe(text);
    }
  });
  it('recusa mensagens grandes demais e subscrições inválidas', async () => {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    await expect(encryptPayload({ p256dh: b64u(ua.getPublicKey()), auth: b64u(randomBytes(16)) }, new Uint8Array(4000))).rejects.toThrow(/grande/);
    await expect(encryptPayload({ p256dh: 'curta', auth: 'x' }, new Uint8Array(3))).rejects.toThrow(/inválida/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('chaves geradas conferem; par trocado não', async () => {
    const k = await generateVapidKeys();
    expect(isVapidPublicKey(k.publicKey)).toBe(true); expect(isVapidPrivateKey(k.privateKey)).toBe(true);
    expect(await vapidPairMatches(k)).toBe(true);
    expect(await vapidPairMatches({ publicKey: (await generateVapidKeys()).publicKey, privateKey: k.privateKey })).toBe(false);
  });
  it('JWT ES256 verificável por node:crypto, com aud/exp/sub certos', async () => {
    const k = await generateVapidKeys();
    const h = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/xyz', k, 'mailto:a@b.ao', 1_700_000_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(m[4]).toBe(k.publicKey);
    const pub = unb64url(k.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'))).toBe(true);
    const c = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    expect(c).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:a@b.ao' }); expect(c.exp - 1_700_000_000).toBeLessThanOrEqual(86400);
  });
  it('contacto VAPID: e-mail ou https', () => {
    expect(cleanVapidSubject('mailto:secretaria@escola.ao')).toBe('mailto:secretaria@escola.ao');
    expect(cleanVapidSubject('https://escola.ao')).toBe('https://escola.ao');
    expect(() => cleanVapidSubject('secretaria@escola.ao')).toThrow(); expect(() => cleanVapidSubject('http://escola.ao')).toThrow();
  });
});

describe('endereços de push e envio', () => {
  it('só serviços de push conhecidos (anti-SSRF)', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://web.push.apple.com/a', 'https://wns2-par02p.notify.windows.com/w/a']) expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest']) expect(isAllowedPushEndpoint(bad), bad).toBe(false);
  });
  it('subscrição do navegador validada', () => {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(randomBytes(16)) } };
    expect(cleanSubscription(good).endpoint).toBe(good.endpoint);
    expect(() => cleanSubscription({ ...good, endpoint: 'https://evil.com/x' })).toThrow(/suportado/);
    expect(() => cleanSubscription({ ...good, keys: { ...good.keys, auth: 'curto' } })).toThrow(/inválida/);
  });
  it('resposta do serviço: 201 ok, 410 apaga, 429/5xx repete, 403 chave errada', async () => {
    const k = await generateVapidKeys(); const ua = createECDH('prime256v1'); ua.generateKeys();
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: b64u(ua.getPublicKey()), auth: b64u(randomBytes(16)) };
    const send = (status: number) => sendWebPush(sub, buildPushPayload({ title: 'a', body: 'b' }), { vapid: { ...k, subject: 'mailto:a@b.ao' }, fetchFn: async () => new Response('', { status }) });
    expect((await send(201)).ok).toBe(true);
    expect((await send(410)).gone).toBe(true); expect((await send(404)).gone).toBe(true);
    expect((await send(429)).retryable).toBe(true); expect((await send(503)).retryable).toBe(true);
    const f = await send(403); expect(f.ok).toBe(false); expect(f.retryable).toBe(false); expect(f.error).toMatch(/VAPID/);
    const net = await sendWebPush(sub, 'x', { vapid: { ...k, subject: 'mailto:a@b.ao' }, fetchFn: async () => { throw new Error('boom'); } });
    expect(net.retryable).toBe(true);
  });
  it('payload do service worker: só caminhos internos', () => {
    expect(JSON.parse(buildPushPayload({ title: 'a'.repeat(200), body: 'b', url: '//evil.com' })).url).toBe('/');
    expect(JSON.parse(buildPushPayload({ title: 'a', body: 'b', url: 'https://evil.com' })).url).toBe('/');
    expect(JSON.parse(buildPushPayload({ title: 'a', body: 'b', url: '/comunicacao' })).url).toBe('/comunicacao');
    expect(JSON.parse(buildPushPayload({ title: 'a'.repeat(200), body: 'b' })).title.length).toBe(80);
  });
});
