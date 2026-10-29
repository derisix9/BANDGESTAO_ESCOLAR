import { notificationChannelsApi, notificationChannelsEnabled } from './notificationChannels';
import { currentPushSubscription, ensurePushSubscription, pushSupport } from '../utils/pushNotifications';

const MARK = 'bandmed-push-registered';
const stamp = (key: string, uid = '') => `${key}|${uid}`;

/**
 * Regista ESTE aparelho no servidor para receber push com a app fechada (se a escola o ligou e a permissão foi dada).
 * Nunca lança. `force` ignora a memória local (ex.: logo a seguir a dar a permissão).
 */
export async function registerPushDevice(force = false): Promise<boolean> {
  try {
    if (pushSupport() !== 'granted') return false;
    const ch = await notificationChannelsEnabled(force);
    if (!ch.push || !ch.pushPublicKey) return false;
    const existing = await currentPushSubscription();
    const mark = stamp(ch.pushPublicKey, existing?.endpoint?.slice(-24));
    if (!force && existing && localStorage.getItem(MARK) === mark) return true;
    const sub = await ensurePushSubscription(ch.pushPublicKey);
    if (!sub) return false;
    await notificationChannelsApi.subscribe(sub, ch.pushPublicKey);
    localStorage.setItem(MARK, stamp(ch.pushPublicKey, sub.endpoint?.slice(-24)));
    return true;
  } catch { return false; }
}

/** Ao terminar a sessão: este aparelho deixa de receber os avisos desta conta. */
export async function unregisterPushDevice(): Promise<void> {
  try {
    const sub = await currentPushSubscription();
    try { localStorage.removeItem(MARK); } catch { /* ignora */ }
    if (!sub) return;
    await notificationChannelsApi.unsubscribe(sub.endpoint);
    await sub.unsubscribe();
  } catch { /* o servidor limpa as subscrições mortas */ }
}
