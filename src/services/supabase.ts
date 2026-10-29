import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  console.warn('Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env');
}

/**
 * O link de "recuperar palavra-passe" abre a app com `#...type=recovery`. Lemos isto ANTES de criar o cliente
 * (que limpa o endereço) para a app mostrar o ecrã "nova palavra-passe" em vez de abrir a sessão directamente.
 */
/** Hash + query do endereço actual; vazio fora de um navegador completo (testes, SSR, workers: `window` existe mas sem `location`). */
const currentUrlFlags = (): string =>
  typeof window !== 'undefined' && window.location ? (window.location.hash || '') + '&' + (window.location.search || '') : '';

export let recoveryPending: boolean = /(^|[#&?])type=recovery(&|$)/.test(currentUrlFlags());
export const clearRecoveryPending = () => { recoveryPending = false; };

/**
 * O link de "confirmar e-mail" do registo de uma escola abre a app com `#...type=signup`. Também lido ANTES de criar o
 * cliente: a app não abre a escola de imediato; o LoginView cria a escola, mostra a caixa verde e leva ao início de sessão.
 * Link expirado/já usado: o Supabase devolve `#error_code=otp_expired...`.
 */
const urlFlags = currentUrlFlags();
export let signupConfirmPending: boolean = /(^|[#&?])type=signup(&|$)/.test(urlFlags);
export const signupLinkError: string | null = /(^|[#&?])error_code=/.test(urlFlags)
  ? (urlFlags.match(/(?:^|[#&?])error_code=([^&]*)/)?.[1] ?? 'erro') : null;
export const clearSignupConfirmPending = () => { signupConfirmPending = false; };

export const supabaseUrl = url ?? 'http://localhost:54321';
export const supabaseAnonKey = anon ?? 'anon-missing';

/** A chave "anon" é pública por desenho. A segurança está nas políticas RLS (supabase/migrations). */
/**
 * Onde fica a sessão: com "Lembrar-me" em localStorage (sobrevive ao fecho do navegador; a inatividade de 60 min
 * é imposta por sessionActivity/App), sem "Lembrar-me" em sessionStorage (termina ao fechar o navegador).
 */
const hybridStorage = {
  getItem(k: string): string | null {
    try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; }
  },
  setItem(k: string, v: string): void {
    try {
      const remember = localStorage.getItem('bandmed_remember') !== '0';
      (remember ? localStorage : sessionStorage).setItem(k, v);
      (remember ? sessionStorage : localStorage).removeItem(k);
    } catch { /* ignore */ }
  },
  removeItem(k: string): void {
    try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* ignore */ }
  }
};

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', anon ?? 'anon-missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: hybridStorage }
});

/**
 * Disjuntor: quando o Supabase responde 5xx (503/504/520…) ou não responde, NÃO se deve continuar a bombardeá-lo.
 * Cada falha abre o disjuntor por alguns segundos (cresce até 60 s); durante esse tempo os pedidos "automáticos"
 * (restaurar perfil, escola activa…) falham logo, sem rede. Um clique manual em "Entrar" ignora a pausa.
 * Antes, vários pontos da app repetiam o mesmo GET /profiles em paralelo (dezenas de erros 503 por minuto),
 * o que mantinha o servidor sobrecarregado e a app presa em "A verificar os dados...".
 */
let breakerUntil = 0;
let breakerFailures = 0;
export const isServerCoolingDown = (): boolean => Date.now() < breakerUntil;
export const secondsUntilServerRetry = (): number => Math.max(0, Math.ceil((breakerUntil - Date.now()) / 1000));
export function noteServerFailure(): void {
  breakerFailures = Math.min(breakerFailures + 1, 4);
  breakerUntil = Date.now() + Math.min(60_000, 5_000 * 2 ** (breakerFailures - 1));   // 5, 10, 20, 40, 60 s
}
export function noteServerOk(): void { breakerFailures = 0; breakerUntil = 0; }
/** Falha transitória do servidor (5xx, 429, rede) — não é "sem permissão" nem "sem perfil". */
export function isTransientFailure(status?: number, error?: any): boolean {
  if (status && (status >= 500 || status === 429 || status === 408)) return true;
  if (status === 0 || status === undefined) {
    const m = String(error?.message ?? error ?? '').toLowerCase();
    return !error || /fetch|network|timeout|unavailable|gateway|failed to/.test(m);
  }
  return false;
}
