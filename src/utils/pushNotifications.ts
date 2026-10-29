/**
 * Notificações push / do sistema (passo 5).
 *
 * SEM servidor: pedir permissão e mostrar uma notificação do sistema (pelo service worker) quando chega uma notificação nova
 * e a aplicação está aberta em segundo plano.
 * COM push (aplicação FECHADA): cada escola tem o SEU par de chaves VAPID (Configurações → Integrações → Notificações; a privada
 * fica cifrada no servidor). O aparelho subscreve com a chave PÚBLICA da escola e entrega a subscrição à Edge Function
 * `notifications` (src/services/pushDevice.ts). No iPhone/iPad só funciona com a app instalada no ecrã inicial (iOS 16.4+).
 */

export type PushSupport = 'unsupported' | 'denied' | 'default' | 'granted';

export function pushSupport(env: { Notification?: any; serviceWorker?: boolean } = {
  Notification: typeof Notification !== 'undefined' ? Notification : undefined,
  serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}): PushSupport {
  if (!env.Notification || !env.serviceWorker) return 'unsupported';
  return env.Notification.permission as PushSupport;
}

export async function requestPushPermission(): Promise<PushSupport> {
  if (pushSupport() === 'unsupported') return 'unsupported';
  const result = await Notification.requestPermission();
  return result as PushSupport;
}

/** Abre só caminhos internos (nunca URLs externas vindas de dados). */
/** Chave pública VAPID: base64url, em regra com 87 caracteres (ponto EC P-256 não comprimido). */
export function isLikelyVapidKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{80,100}$/.test((key || '').trim());
}

export function safeInternalPath(path?: string): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

export interface SystemNotificationInput {
  id: string;
  title: string;
  message: string;
  priority?: string;
}

/** Corta o texto para o ecrã de bloqueio e devolve as opções para showNotification. */
export function toNotificationOptions(n: SystemNotificationInput): { title: string; options: NotificationOptions } {
  const body = n.message.length > 140 ? `${n.message.slice(0, 137)}…` : n.message;
  return {
    title: n.title.slice(0, 80),
    options: {
      body,
      tag: `bandgest-${n.id}`,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      requireInteraction: n.priority === 'urgente',
      data: { url: '/' }
    }
  };
}

/** Notificações que ainda não foram mostradas no sistema (memória por sessão do separador). */
export function selectFresh<T extends { id: string; read: boolean }>(items: T[], alreadyShown: Set<string>): T[] {
  return items.filter((i) => !i.read && !alreadyShown.has(i.id));
}

export async function showSystemNotification(n: SystemNotificationInput): Promise<boolean> {
  if (pushSupport() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { title, options } = toNotificationOptions(n);
    await reg.showNotification(title, options);
    return true;
  } catch {
    return false;
  }
}

const toB64url = (buf: ArrayBuffer): string => {
  let s = '';
  new Uint8Array(buf).forEach((c) => { s += String.fromCharCode(c); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Subscrição Web Push (precisa da chave pública VAPID do servidor). Devolve o JSON a guardar. */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJSON | null> {
  if (pushSupport() !== 'granted' || !vapidPublicKey) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource
    });
    return sub.toJSON();
  } catch {
    return null;
  }
}

/** A subscrição foi feita com esta chave pública? (Se a escola trocar de chave, a antiga já não serve.) */
export function sameServerKey(applicationServerKey: ArrayBuffer | null | undefined, vapidPublicKey: string): boolean {
  if (!applicationServerKey || !vapidPublicKey) return false;
  return toB64url(applicationServerKey) === vapidPublicKey.trim();
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (pushSupport() === 'unsupported') return null;
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

/** Subscreve com a chave da escola; se já havia uma subscrição feita com OUTRA chave, troca-a. */
export async function ensurePushSubscription(vapidPublicKey: string): Promise<PushSubscriptionJSON | null> {
  if (pushSupport() !== 'granted' || !vapidPublicKey) return null;
  const existing = await currentPushSubscription();
  if (existing) {
    if (sameServerKey(existing.options?.applicationServerKey, vapidPublicKey)) return existing.toJSON();
    try { await existing.unsubscribe(); } catch { /* a nova subscrição substitui-a */ }
  }
  return subscribeToPush(vapidPublicKey);
}
