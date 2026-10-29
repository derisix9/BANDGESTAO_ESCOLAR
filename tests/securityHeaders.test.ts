import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('vercel.json', () => {
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const h = Object.fromEntries(cfg.headers[0].headers.map((x: any) => [x.key, x.value]));
  it('tem os cabeçalhos de segurança', () => {
    for (const k of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'Referrer-Policy', 'X-Content-Type-Options']) expect(h[k]).toBeTruthy();
    expect(h['X-Frame-Options']).toBe('DENY');
  });
  it('CSP não permite scripts inline nem eval', () => {
    const script = String(h['Content-Security-Policy']).split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
  it('connect-src deixa o service worker (public/sw.js) guardar fontes e ícones em cache', () => {
    // O sw.js faz fetch() a estes domínios e esses pedidos obedecem ao connect-src. Sem eles os ícones Material Symbols viram texto.
    const connect = String(h['Content-Security-Policy']).split(';').find((d) => d.trim().startsWith('connect-src'))!;
    for (const host of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net']) expect(connect).toContain(host);
  });
});

describe('sem scripts inline', () => {
  it('index.html e termos não têm <script> inline nem onclick', () => {
    for (const f of ['index.html', 'public/termos-e-privacidade.html']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(s).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });
  it('o código não escreve <script> nem on*= em HTML montado à mão', () => {
    const bad = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('i18n'))
      .filter((f) => readFileSync(f, 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .some((l) => /<script>|\sonload="|\sonclick="|\sonerror="/.test(l)));
    expect(bad).toEqual([]);
  });
});
