import { supabase } from './supabase';
import { NO_CHANNELS, createNotificationChannelsApi, type ChannelsEnabled, type InvokeFn } from '../utils/notificationChannelsApi';

/** Chama a Edge Function `notifications` e devolve o erro legível que ela escreveu no corpo (não o "non-2xx" genérico). */
export const invokeNotifications: InvokeFn = async (body) => {
  const { data, error } = await supabase.functions.invoke('notifications', { body });
  if (error) {
    let m = error.message || 'Erro ao contactar o servidor de notificações.';
    try { const b = await (error as any).context?.json?.(); if (b?.error) m = String(b.error); } catch { /* ignora */ }
    return { data: null, error: m };
  }
  if ((data as any)?.error) return { data: null, error: String((data as any).error) };
  return { data, error: null };
};

export const notificationChannelsApi = createNotificationChannelsApi((fn, args) => supabase.rpc(fn, args), invokeNotifications);

let cache: { at: number; value: Promise<ChannelsEnabled> } | null = null;
/** "Que canais a escola ligou?" — uma pergunta ao servidor por minuto, partilhada por todos os ecrãs. */
export function notificationChannelsEnabled(force = false): Promise<ChannelsEnabled> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = notificationChannelsApi.enabled().catch(() => NO_CHANNELS);
  cache = { at: Date.now(), value };
  return value;
}
