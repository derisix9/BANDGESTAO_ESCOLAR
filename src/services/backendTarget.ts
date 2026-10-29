/**
 * Escolhe a que servidor Supabase a app se liga: "local" (o seu PC) ou "cloud" (supabase.com).
 *
 * Regras:
 *  - Build de PRODUÇÃO (npm run build / Vercel / Render): usa SEMPRE a nuvem. Não há botão nem parâmetro que mude isto.
 *  - Desenvolvimento (npm run dev): usa VITE_BACKEND_DEFAULT (local por omissão). Pode trocar com
 *      · o selector no canto do ecrã (só aparece em desenvolvimento), ou
 *      · ?backend=local / ?backend=cloud no endereço.
 *  - Compatível com o .env antigo: se só existir VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, isso é a "nuvem".
 *
 * Ao trocar de servidor, as caches do navegador (escola_*, bandmed_*, IndexedDB) são apagadas, para dados de um
 * servidor nunca aparecerem no outro. A sessão de login também é separada por servidor.
 */

export type BackendTarget = 'local' | 'cloud';

const env = ((import.meta as any).env ?? {}) as Record<string, string | boolean | undefined>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const IS_PRODUCTION: boolean = env.PROD === true;

const PREF_KEY = 'bandmed_backend_target';
const LAST_KEY = 'bandmed_backend_last';

interface Cfg { url?: string; anon?: string }

const CONFIG: Record<BackendTarget, Cfg> = {
  local: {
    url: str(env.VITE_SUPABASE_URL_LOCAL) ?? 'http://127.0.0.1:54321',
    anon: str(env.VITE_SUPABASE_ANON_KEY_LOCAL)
  },
  cloud: {
    url: str(env.VITE_SUPABASE_URL_CLOUD) ?? str(env.VITE_SUPABASE_URL),
    anon: str(env.VITE_SUPABASE_ANON_KEY_CLOUD) ?? str(env.VITE_SUPABASE_ANON_KEY)
  }
};

const isConfigured = (t: BackendTarget): boolean => !!(CONFIG[t].url && CONFIG[t].anon);
const isTarget = (v: unknown): v is BackendTarget => v === 'local' || v === 'cloud';

function readPreference(): BackendTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('backend');
    if (isTarget(q)) { localStorage.setItem(PREF_KEY, q); return q; }
    const saved = localStorage.getItem(PREF_KEY);
    return isTarget(saved) ? saved : null;
  } catch { return null; }
}

function resolveTarget(): BackendTarget {
  if (IS_PRODUCTION) return 'cloud';
  const wanted: BackendTarget = readPreference() ?? (isTarget(env.VITE_BACKEND_DEFAULT) ? env.VITE_BACKEND_DEFAULT : 'local');
  if (isConfigured(wanted)) return wanted;
  const other: BackendTarget = wanted === 'local' ? 'cloud' : 'local';
  if (isConfigured(other)) {
    console.warn(`[backend] "${wanted}" não está configurado no .env; a usar "${other}".`);
    return other;
  }
  return wanted;
}

/** Apaga o que a app guarda no navegador (cache de dados). Mantém só a escolha local/nuvem. */
function purgeBrowserCaches(): void {
  try {
    const drop = (st: Storage) => {
      for (const k of Object.keys(st)) {
        if (k === PREF_KEY || k === LAST_KEY || k === 'bandmed_remember') continue;
        // As chaves "bandmed-auth-*" (sessão de cada servidor, com hífen) não começam por estes prefixos: ficam intactas.
        if (k.startsWith('escola_') || k.startsWith('bandmed_')) st.removeItem(k);
      }
    };
    drop(localStorage); drop(sessionStorage);
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('bandmed_school_db');
  } catch { /* ignore */ }
}

export const backendTarget: BackendTarget = resolveTarget();

// Se desde a última vez a app passou de um servidor para outro, limpa as caches antes de qualquer leitura.
if (typeof window !== 'undefined' && !IS_PRODUCTION) {
  try {
    const last = localStorage.getItem(LAST_KEY);
    if (last && last !== backendTarget) purgeBrowserCaches();
    localStorage.setItem(LAST_KEY, backendTarget);
  } catch { /* ignore */ }
}

export const backendUrl: string = CONFIG[backendTarget].url ?? 'http://127.0.0.1:54321';
export const backendAnonKey: string | undefined = CONFIG[backendTarget].anon;
export const backendConfigured: boolean = isConfigured(backendTarget);

/** Só em desenvolvimento: muda de servidor e recarrega a página. */
export function switchBackend(next: BackendTarget): void {
  if (IS_PRODUCTION || typeof window === 'undefined') return;
  try { localStorage.setItem(PREF_KEY, next); } catch { /* ignore */ }
  const u = new URL(window.location.href);
  u.searchParams.delete('backend');
  window.location.replace(u.toString());
}

/** Selector flutuante, só em desenvolvimento. Não depende do React. */
export function mountBackendBadge(): void {
  if (IS_PRODUCTION || typeof document === 'undefined') return;
  const mount = () => {
    if (document.getElementById('bandmed-backend-badge')) return;
    const el = document.createElement('div');
    el.id = 'bandmed-backend-badge';
    const isLocal = backendTarget === 'local';
    const other: BackendTarget = isLocal ? 'cloud' : 'local';
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:600 11px system-ui,sans-serif;display:flex;gap:6px;align-items:center;' +
      'padding:4px 8px;border-radius:999px;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.92;' +
      `background:${isLocal ? '#15803d' : '#b45309'}`;
    const label = document.createElement('span');
    label.textContent = (isLocal ? 'DEV · Servidor LOCAL' : 'DEV · Servidor NUVEM') + (backendConfigured ? '' : ' (sem .env!)');
    const btn = document.createElement('button');
    btn.textContent = `mudar para ${isLocal ? 'nuvem' : 'local'}`;
    btn.style.cssText = 'all:unset;cursor:pointer;text-decoration:underline;font-weight:500';
    btn.onclick = () => {
      if (other === 'cloud' && !window.confirm('Vai ligar-se à base de dados da NUVEM (dados reais). Continuar?')) return;
      switchBackend(other);
    };
    el.append(label, btn);
    document.body.appendChild(el);
  };
  if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);
}
