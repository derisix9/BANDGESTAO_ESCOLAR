import { describe, it, expect } from 'vitest';
import { RateLimiter, bearerToken, hostOf, sameOriginHost } from '../api/_guard';

describe('sameOriginHost', () => {
  const h = (origin?: string, host = 'bandgestao.vercel.app', referer?: string) => ({ host, origin, referer });
  it('aceita o próprio anfitrião', () => expect(sameOriginHost(h('https://bandgestao.vercel.app'))).toBe(true));
  it('recusa o truque do includes (host.evil.com e evil.com/host)', () => {
    expect(sameOriginHost(h('https://bandgestao.vercel.app.evil.com'))).toBe(false);
    expect(sameOriginHost(h('https://evil.com/bandgestao.vercel.app'))).toBe(false);
    expect(sameOriginHost(h('https://xbandgestao.vercel.app'))).toBe(false);
  });
  it('exige Origin ou Referer', () => expect(sameOriginHost(h(undefined))).toBe(false));
  it('usa o Referer se não houver Origin', () => expect(sameOriginHost(h(undefined, 'bandgestao.vercel.app', 'https://bandgestao.vercel.app/x'))).toBe(true));
  it('aceita anfitriões extra autorizados', () => expect(sameOriginHost(h('https://app.escola.ao'), ['app.escola.ao'])).toBe(true));
  it('origem inválida/null recusada', () => { expect(sameOriginHost(h('null'))).toBe(false); expect(hostOf('lixo')).toBe(''); });
});

describe('RateLimiter', () => {
  it('bloqueia acima do limite e liberta depois da janela', () => {
    const r = new RateLimiter(3, 1000);
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('a', 3)]).toEqual([true, true, true, false]);
    expect(r.allow('b', 3)).toBe(true);          // outra chave não é afectada
    expect(r.allow('a', 1500)).toBe(true);       // a janela passou
  });
});

describe('bearerToken', () => {
  it('extrai só tokens com forma válida', () => {
    expect(bearerToken({ authorization: 'Bearer abcdefghijklmnopqrstuvwxyz.123' })).toBe('abcdefghijklmnopqrstuvwxyz.123');
    expect(bearerToken({ authorization: 'Basic abc' })).toBe('');
    expect(bearerToken({})).toBe('');
    expect(bearerToken({ authorization: 'Bearer curto' })).toBe('');
  });
});
