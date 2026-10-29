/**
 * Relatório de erros do cliente (lógica pura e testável; o envio fica em src/services/errorReporter.ts).
 *
 * Regras: nunca enviar dados pessoais (e-mails, tokens, parâmetros de URL), agrupar o mesmo erro numa
 * "impressão digital" estável (sem números de linha nem ids) e não inundar o servidor.
 */

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'react' | 'sync' | 'other';

export interface ClientErrorPayload {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  appVersion?: string;
  fingerprint: string;
  context?: Record<string, string | number | boolean | null>;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Remove do texto o que pode identificar pessoas ou dar acesso: JWT, e-mails, tokens em parâmetros, sequências longas (BI/NIF/telefone). */
export function scrubText(input: unknown, max = MAX_MESSAGE): string {
  let s = typeof input === 'string' ? input : input == null ? '' : String(input);
  s = s
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [token]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/([?&#;\s](?:access_token|refresh_token|token|apikey|api_key|key|code|password|senha|secret)=)[^&\s)'"]+/gi, '$1[x]')
    .replace(/\b\d{9,}\b/g, '[num]')
    .replace(/\b[0-9]{9}[A-Z]{2}[0-9]{3}\b/g, '[bi]');
  return s.length > max ? s.slice(0, max) : s;
}

/** Só o caminho: sem parâmetros de consulta nem fragmentos com dados (#...?token=...). */
export function scrubUrl(url: unknown): string {
  const raw = typeof url === 'string' ? url : '';
  if (!raw) return '';
  try {
    const u = new URL(raw);
    let hash = u.hash.split('?')[0];
    if (/[=&]/.test(hash)) hash = '';   // #chave=valor (ex.: tokens do Auth): descarta-se por inteiro
    return scrubText(`${u.origin}${u.pathname}${hash}`, 300);
  } catch {
    return scrubText(raw.split('?')[0], 300);
  }
}

export function scrubStack(stack: unknown): string {
  return scrubText(stack, MAX_STACK);
}

/** Texto do erro sem partes variáveis (ids, números, hashes de ficheiro) para o mesmo erro dar sempre a mesma chave. */
export function normalizeForFingerprint(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#id')
    .replace(/\b[0-9a-f]{16,}\b/g, '#hash')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primeira linha útil da stack, sem coluna/linha nem hash do bundle (ex.: App-3fa9c1.js:12:34 → App). */
export function topFrame(stack?: string): string {
  if (!stack) return '';
  const lines = stack.split('\n').map((l) => l.trim()).filter((l) => /^at\s|@/.test(l));
  const first = lines[0] || '';
  return first
    .replace(/https?:\/\/[^\s)]+\//g, '')
    .replace(/-[A-Za-z0-9_]{6,10}\.js/g, '.js')
    .replace(/:\d+(:\d+)?/g, '')
    .slice(0, 120);
}

function hash32(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintOf(kind: ClientErrorKind, message: string, stack?: string): string {
  return `${kind[0]}${hash32(`${kind}|${normalizeForFingerprint(message)}|${topFrame(stack)}`)}`;
}

/** Erros que não valem a pena (ruído de extensões do browser, cancelamentos, redimensionamento). */
export function isIgnorableError(message: string, stack?: string): boolean {
  const m = message || '';
  if (/ResizeObserver loop/i.test(m)) return true;
  if (/^Script error\.?$/i.test(m.trim())) return true;       // erro de outra origem, sem informação
  if (/AbortError|The user aborted a request|signal is aborted/i.test(m)) return true;
  if (/(chrome|moz|safari)-extension:\/\//i.test(stack || '') || /(chrome|moz)-extension:\/\//i.test(m)) return true;
  if (/Non-Error promise rejection captured/i.test(m)) return true;
  return false;
}

export function buildPayload(params: {
  kind: ClientErrorKind;
  error: unknown;
  url?: string;
  userAgent?: string;
  appVersion?: string;
  context?: Record<string, string | number | boolean | null>;
}): ClientErrorPayload | null {
  const err = params.error as any;
  const rawMessage = typeof err === 'string' ? err : err?.message ?? (err != null ? safeStringify(err) : '');
  const rawStack = typeof err?.stack === 'string' ? err.stack : undefined;
  if (!rawMessage || isIgnorableError(String(rawMessage), rawStack)) return null;
  const message = scrubText(rawMessage);
  const stack = rawStack ? scrubStack(rawStack) : undefined;
  return {
    kind: params.kind,
    message,
    stack,
    url: scrubUrl(params.url),
    userAgent: (params.userAgent || '').slice(0, 300),
    appVersion: (params.appVersion || '').slice(0, 40),
    fingerprint: fingerprintOf(params.kind, message, stack),
    context: params.context
  };
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Limitador: no máximo `maxPerSession` envios por sessão e o mesmo erro só volta a ser enviado passado `dedupeMs`
 * (o servidor também agrupa, mas assim poupa-se rede em ciclos de erro).
 */
export class ReportThrottle {
  private sent = 0;
  private last = new Map<string, number>();
  constructor(private maxPerSession = 30, private dedupeMs = 60_000) {}
  allow(fingerprint: string, now = Date.now()): boolean {
    if (this.sent >= this.maxPerSession) return false;
    const prev = this.last.get(fingerprint);
    if (prev !== undefined && now - prev < this.dedupeMs) return false;
    this.last.set(fingerprint, now);
    this.sent += 1;
    return true;
  }
}
