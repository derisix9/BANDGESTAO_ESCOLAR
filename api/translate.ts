/**
 * Serviço de tradução automática da interface (Vercel Serverless Function).
 *
 * POST /api/translate  { texts: string[], target?: 'en' }  →  { translations: string[] }
 *
 * Por ordem de preferência:
 *  1. Google Cloud Translation (oficial)  — defina GOOGLE_TRANSLATE_API_KEY nas variáveis de ambiente do Vercel;
 *  2. endpoint público "gtx" do Google Translate (sem chave; adequado para começar, sem garantia de serviço).
 * Protecções (passo 7 da auditoria):
 *  - só pedidos do próprio site (anfitrião exacto do Origin/Referer; `includes` era contornável);
 *  - exige sessão válida do Supabase (Authorization: Bearer), para a chave do Google não ser usada por terceiros;
 *  - limite de pedidos por utilizador e por IP, e limites de tamanho.
 * Sem sessão, o cliente traduz directamente no navegador (sem usar a chave da escola).
 */
import { createHash } from 'node:crypto';
import { RateLimiter, bearerToken, sameOriginHost } from './_guard';

declare const process: { env: Record<string, string | undefined> };

const MAX_TEXTS = 60;
const MAX_CHARS = 9000;
const MAX_ONE = 2000;                       // caracteres por texto
const byUser = new RateLimiter(30, 60_000); // 30 pedidos/min por utilizador
const byIp = new RateLimiter(60, 60_000);   // 60 pedidos/min por IP
const verified = new Map<string, { uid: string; exp: number }>();   // cache curta de sessões já validadas (60 s)

/** Confirma a sessão no Supabase Auth. Devolve o id do utilizador, ou '' se inválida / não configurado (fecha por defeito). */
async function userFromToken(token: string): Promise<string> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!token || !url || !anon) return '';
  const k = createHash('sha256').update(token).digest('hex');
  const hit = verified.get(k);
  if (hit && hit.exp > Date.now()) return hit.uid;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return '';
    const u: any = await r.json();
    const uid = typeof u?.id === 'string' ? u.id : '';
    if (uid) { verified.set(k, { uid, exp: Date.now() + 60_000 }); if (verified.size > 2000) verified.clear(); }
    return uid;
  } catch { return ''; }
}

async function gtx(text: string, target: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`gtx ${r.status}`);
  const data: any = await r.json();
  return (data?.[0] || []).map((s: any) => s?.[0] || '').join('');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  // 1) Só o próprio site (anfitrião exacto) + domínios extra autorizados em TRANSLATE_ALLOWED_HOSTS (separados por vírgula).
  const extra = (process.env.TRANSLATE_ALLOWED_HOSTS || '').split(',');
  if (!sameOriginHost(req.headers || {}, extra)) { res.status(403).json({ error: 'origin' }); return; }

  // 2) Limite por IP (antes de qualquer outra coisa).
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'sem-ip';
  if (!byIp.allow(ip)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'rate' }); return; }

  // 3) Sessão obrigatória.
  const uid = await userFromToken(bearerToken(req.headers || {}));
  if (!uid) { res.status(401).json({ error: 'auth' }); return; }
  if (!byUser.allow(uid)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'rate' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const texts: string[] = Array.isArray(body?.texts) ? body.texts.filter((t: unknown) => typeof t === 'string') : [];
  const target = typeof body?.target === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.target) ? body.target : 'en';
  if (!texts.length || texts.length > MAX_TEXTS || texts.some((t) => t.length > MAX_ONE) || texts.reduce((n, t) => n + t.length, 0) > MAX_CHARS) {
    res.status(400).json({ error: 'size' });
    return;
  }

  try {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (key) {
      const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, target, format: 'text' })
      });
      if (!r.ok) throw new Error(`google ${r.status}`);
      const data: any = await r.json();
      const out = (data?.data?.translations || []).map((t: any) => String(t.translatedText || ''));
      if (out.length !== texts.length) throw new Error('google length');
      res.status(200).json({ translations: out });
      return;
    }
    const out: string[] = new Array(texts.length);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < texts.length) { const k = i++; out[k] = await gtx(texts[k], target); }
    }));
    res.status(200).json({ translations: out });
  } catch (e: any) {
    res.status(502).json({ error: 'upstream' });   // sem detalhes internos (podiam incluir partes do pedido à Google)
  }
}
