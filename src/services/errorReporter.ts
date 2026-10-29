/**
 * Monitorização de erros do browser e das falhas de sincronização.
 *
 * Captura: erros não tratados (window.onerror), promessas rejeitadas, falhas de renderização (ErrorBoundary) e
 * falhas repetidas de sincronização. Envia para public.report_client_error (migração 0047), que só aceita sessões
 * iniciadas e deduz a escola do servidor. Sem sessão ou sem rede, os relatórios ficam numa pequena fila local
 * (máx. 20) e seguem quando a sessão/rede voltam. Nunca lança erros: monitorizar não pode causar mais erros.
 */
import { supabase } from './supabase';
import { buildPayload, ReportThrottle, type ClientErrorKind, type ClientErrorPayload } from '../utils/errorReport';

const QUEUE_KEY = 'bandmed:error-queue';
const MAX_QUEUE = 20;
const throttle = new ReportThrottle();
let installed = false;
let flushing = false;

const appVersion = (): string => ((import.meta as any).env?.VITE_APP_VERSION as string | undefined) || 'dev';

function readQueue(): ClientErrorPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, MAX_QUEUE) : [];
  } catch { return []; }
}
function writeQueue(q: ClientErrorPayload[]) {
  try {
    if (q.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch { /* sem localStorage: perde-se, não faz mal */ }
}

async function hasSession(): Promise<boolean> {
  try { return !!(await supabase.auth.getSession()).data.session; } catch { return false; }
}

async function send(payload: ClientErrorPayload): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (!(await hasSession())) return false;
    const { error } = await supabase.rpc('report_client_error', { p: payload });
    return !error;
  } catch { return false; }
}

/** Envia o que ficou na fila (chamado ao iniciar sessão, ao voltar a rede e ao arrancar). */
export async function flushErrorQueue(): Promise<void> {
  if (flushing) return;
  const q = readQueue();
  if (q.length === 0) return;
  flushing = true;
  try {
    const rest: ClientErrorPayload[] = [];
    for (const item of q) {
      if (!(await send(item))) rest.push(item);
    }
    writeQueue(rest);
  } finally { flushing = false; }
}

export function reportError(kind: ClientErrorKind, error: unknown, context?: Record<string, string | number | boolean | null>): void {
  try {
    const payload = buildPayload({
      kind,
      error,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      appVersion: appVersion(),
      context: { online: typeof navigator !== 'undefined' ? navigator.onLine : true, ...context }
    });
    if (!payload || !throttle.allow(payload.fingerprint)) return;
    void send(payload).then((ok) => {
      if (!ok) writeQueue([...readQueue(), payload]);
    });
  } catch { /* nunca falha */ }
}

/** Falha de sincronização com a nuvem. Só se comunica a partir da 3.ª tentativa seguida (cortes breves não são ruído). */
export function reportSyncFailure(error: unknown, attempts: number): void {
  if (attempts < 3) return;
  reportError('sync', error instanceof Error ? error : new Error(String((error as any)?.message ?? error ?? 'Falha de sincronização')), { attempts });
}

export function initErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // Erros de carregamento de recursos (img/script) não têm .error; ignoram-se.
    if (!ev.error && !ev.message) return;
    reportError('error', ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => reportError('unhandledrejection', ev.reason));
  window.addEventListener('online', () => { void flushErrorQueue(); });
  try {
    supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN') void flushErrorQueue(); });
  } catch { /* ignora */ }
  setTimeout(() => { void flushErrorQueue(); }, 5000);
}
