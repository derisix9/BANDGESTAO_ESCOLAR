import { supabase } from './supabase';
import { createPaymentGatewayApi, type InvokeFn } from '../utils/paymentGatewayApi';

/** Chama a Edge Function `payments` e devolve o erro legível que ela escreveu no corpo (não o "non-2xx" genérico). */
export const invokePayments: InvokeFn = async (body) => {
  const { data, error } = await supabase.functions.invoke('payments', { body });
  if (error) {
    let m = error.message || 'Erro ao contactar o servidor de pagamentos.';
    try { const b = await (error as any).context?.json?.(); if (b?.error) m = String(b.error); } catch { /* ignora */ }
    return { data: null, error: m };
  }
  if ((data as any)?.error) return { data: null, error: String((data as any).error) };
  return { data, error: null };
};

export const paymentGatewayApi = createPaymentGatewayApi((fn, args) => supabase.rpc(fn, args), invokePayments);

let enabledCache: { at: number; value: Promise<boolean> } | null = null;
/** "Os pagamentos por referência estão activos nesta escola?" — uma pergunta ao servidor por minuto, partilhada por todos os botões. */
export function paymentsEnabled(force = false): Promise<boolean> {
  if (!force && enabledCache && Date.now() - enabledCache.at < 60_000) return enabledCache.value;
  const value = paymentGatewayApi.enabled().catch(() => false);
  enabledCache = { at: Date.now(), value };
  return value;
}
