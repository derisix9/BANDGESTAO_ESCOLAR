/**
 * Tradução remota em lote com cache persistente (localStorage).
 * Primeiro tenta o serviço da própria app (/api/translate); se não existir (ex.: `npm run dev`),
 * tenta directamente o endpoint público do Google Translate.
 */
import { supabase } from '../services/supabase';

const CACHE_KEY = 'bandgest.i18n.en.v1';
const MAX_CACHE = 6000;
const BATCH_TEXTS = 30;
const BATCH_CHARS = 3500;
const CONCURRENCY = 3;
const RETRY_AFTER_MS = 60_000;

const cache = new Map<string, string>();
const failed = new Map<string, number>();
const waiting = new Map<string, Array<(t: string) => void>>();
let inFlight = 0;
let timer: number | undefined;
let saveTimer: number | undefined;
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]') as Array<[string, string]>;
    for (const [k, v] of raw) cache.set(k, v);
  } catch { /* cache corrompida: recomeça */ }
}

function save() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    try {
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(cache.entries())));
    } catch { /* quota cheia: segue só em memória */ }
  }, 1500);
}

export function cachedTranslation(src: string): string | undefined {
  load();
  return cache.get(src);
}

class ApiStatusError extends Error { constructor(public status: number) { super(`api ${status}`); } }

async function viaApp(texts: string[]): Promise<string[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* sem sessão: o servidor responde 401 e traduz-se directamente */ }
  const r = await fetch('/api/translate', { method: 'POST', headers, body: JSON.stringify({ texts, target: 'en' }) });
  if (!r.ok) throw new ApiStatusError(r.status);
  const j = await r.json();
  if (!Array.isArray(j.translations) || j.translations.length !== texts.length) throw new Error('api shape');
  return j.translations;
}

async function direct(texts: string[]): Promise<string[]> {
  return Promise.all(texts.map(async (t) => {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(t)}`);
    if (!r.ok) throw new Error(`gtx ${r.status}`);
    const d = await r.json();
    return (d?.[0] || []).map((s: any) => s?.[0] || '').join('');
  }));
}

let appApiWorks: boolean | undefined;
async function translateChunk(texts: string[]): Promise<string[]> {
  if (appApiWorks !== false) {
    try { const out = await viaApp(texts); appApiWorks = true; return out; }
    catch (e) {
      // 401 (sem sessão) e 429 (limite): traduz directamente no navegador desta vez, mas não desliga a API para o resto da sessão.
      if (e instanceof ApiStatusError && (e.status === 401 || e.status === 429)) return direct(texts);
      if (appApiWorks === undefined) appApiWorks = false; else throw e;
    }
  }
  return direct(texts);
}

function pump() {
  timer = undefined;
  while (inFlight < CONCURRENCY && waiting.size) {
    const batch: string[] = [];
    let chars = 0;
    for (const src of Array.from(waiting.keys())) {
      if (batch.length >= BATCH_TEXTS || chars + src.length > BATCH_CHARS) break;
      batch.push(src); chars += src.length;
    }
    if (!batch.length) break;
    const cbs = batch.map((s) => { const c = waiting.get(s)!; waiting.delete(s); return c; });
    inFlight++;
    translateChunk(batch).then((out) => {
      out.forEach((t, i) => { const v = (t || '').trim() ? t : batch[i]; cache.set(batch[i], v); cbs[i].forEach((cb) => cb(v)); });
      save();
    }).catch(() => {
      const now = Date.now();
      batch.forEach((s) => failed.set(s, now));
    }).finally(() => { inFlight--; if (waiting.size) schedule(); });
  }
}

function schedule() { if (timer === undefined) timer = window.setTimeout(pump, 80); }

/** Pede a tradução de `src`; `cb` é chamado quando chega. Falhas ficam por tentar durante 1 minuto. */
export function requestTranslation(src: string, cb: (t: string) => void): void {
  load();
  const hit = cache.get(src);
  if (hit !== undefined) { cb(hit); return; }
  const f = failed.get(src);
  if (f && Date.now() - f < RETRY_AFTER_MS) return;
  failed.delete(src);
  const list = waiting.get(src);
  if (list) list.push(cb); else waiting.set(src, [cb]);
  schedule();
}
