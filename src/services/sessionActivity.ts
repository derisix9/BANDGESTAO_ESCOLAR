/**
 * "Lembrar-me" e inatividade.
 *  - Lembrar-me LIGADO : a sessão fica guardada no navegador (localStorage) e sobrevive ao fecho do navegador,
 *    mas expira após 60 min sem atividade (mesmo com a app fechada): depois disso pede novo login.
 *  - Lembrar-me DESLIGADO: a sessão fica só no separador (sessionStorage) e termina ao fechar o navegador.
 * A última atividade é guardada em localStorage para valer entre separadores e depois de recarregar.
 */
const REMEMBER_KEY = 'bandmed_remember';
const ACTIVITY_KEY = 'bandmed_last_activity';
export const REMEMBER_IDLE_MINUTES = 60;

const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export const isRemembered = (): boolean => ls()?.getItem(REMEMBER_KEY) !== '0';
export const setRemembered = (v: boolean) => { try { ls()?.setItem(REMEMBER_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

let lastWrite = 0;
/** Regista atividade agora (no máximo uma escrita por 10 s, salvo force). */
export function touchActivity(force = false) {
  const now = Date.now();
  if (!force && now - lastWrite < 10_000) return;
  lastWrite = now;
  try { ls()?.setItem(ACTIVITY_KEY, String(now)); } catch { /* ignore */ }
}
export const lastActivityAt = (): number | null => {
  const v = Number(ls()?.getItem(ACTIVITY_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
};
export const clearActivity = () => { try { ls()?.removeItem(ACTIVITY_KEY); } catch { /* ignore */ } };

/** Sessão "lembrada" parada há mais de 60 min? (usado ao abrir/recarregar a app) */
export function rememberedSessionExpired(): boolean {
  if (!isRemembered()) return false;
  const last = lastActivityAt();
  return last !== null && Date.now() - last > REMEMBER_IDLE_MINUTES * 60_000;
}
/** Minutos de inatividade que valem agora: com "Lembrar-me" o máximo é 60 (ou menos, se a política da escola for menor). */
export function effectiveIdleMinutes(policyMinutes: number): number {
  if (!isRemembered()) return policyMinutes > 0 ? policyMinutes : 0;   // 0 = sem limite (política da escola)
  return policyMinutes > 0 ? Math.min(policyMinutes, REMEMBER_IDLE_MINUTES) : REMEMBER_IDLE_MINUTES;
}
