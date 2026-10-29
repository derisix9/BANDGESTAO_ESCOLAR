/**
 * Protecções do /api/translate (puras e testáveis). O ficheiro começa por "_" para a Vercel não o expor como rota.
 *  - sameOriginHost: compara o anfitrião EXACTO (o antigo `origin.includes(host)` deixava passar `https://host.evil.com`).
 *  - RateLimiter: janela deslizante em memória (por instância da função; ver nota em docs/CORS_TRADUCAO.md).
 */
export function hostOf(value: string | undefined | null): string {
  try { return new URL(String(value || '')).host.toLowerCase(); } catch { return ''; }
}

/** O pedido vem do próprio site? Exige cabeçalho Origin (ou Referer) e compara o anfitrião inteiro. */
export function sameOriginHost(headers: Record<string, string | string[] | undefined>, extraAllowed: string[] = []): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
  const host = (one(headers['x-forwarded-host']) || one(headers['host'])).split(',')[0].trim().toLowerCase();
  const from = hostOf(one(headers['origin']) || one(headers['referer']));
  if (!from) return false;
  const allowed = [host, ...extraAllowed.map((h) => h.trim().toLowerCase())].filter(Boolean);
  return allowed.includes(from);
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  /** true = pedido permitido (e contado). */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

export function bearerToken(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['authorization'];
  const s = Array.isArray(v) ? v[0] : v;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(String(s || '').trim());
  return m ? m[1] : '';
}
