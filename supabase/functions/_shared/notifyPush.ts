/**
 * Envio de push (Web Push/VAPID) às contas de UMA escola. Parte sem Deno e sem Supabase, testada em tests/notificationProviders.test.ts.
 * As chaves VAPID são da escola (migração 0039): a pública em config.publicKey, a privada cifrada em secret_enc.
 */
import { buildPushPayload, isVapidPrivateKey, isVapidPublicKey, sendWebPush, type FetchFn, type PushOutcome } from './webpush.ts';
import type { RpcClient } from './notifyDeliver.ts';

export interface PushAudience { kind: 'todos' | 'professores' | 'funcionarios' | 'alunos' | 'utilizadores'; ids?: string[] }
export interface PushMessage { title: string; body: string; url?: string; tag?: string; critical?: boolean }

export interface PushDeps {
  rpc: RpcClient;
  openSecret(inst: string, channel: 'push', enc: string | null): Promise<Record<string, unknown>>;
  /** apaga subscrições que já não existem (404/410) */
  removeSubscriptions(ids: string[]): Promise<void>;
  /** regista o resultado (last_ok_at / fail_count) */
  touchSubscriptions(okIds: string[], failIds: string[]): Promise<void>;
  fetchFn?: FetchFn;
  concurrency?: number;
}

export interface PushTotals {
  /** false = a escola não tem o push ligado */
  enabled: boolean;
  targets: number; sent: number; failed: number; removed: number;
  /** utilizadores com pelo menos um aparelho que recebeu */
  usersReached: number;
  error?: string;
}

const EMPTY: PushTotals = { enabled: false, targets: 0, sent: 0, failed: 0, removed: 0, usersReached: 0 };

export async function sendPushToAudience(deps: PushDeps, inst: string, audience: PushAudience, msg: PushMessage): Promise<PushTotals> {
  const { data: gw, error: ge } = await deps.rpc.rpc('notification_gateway_get', { p_inst: inst, p_channel: 'push' });
  if (ge) return { ...EMPTY, error: 'Não foi possível ler a configuração do push.' };
  const g = (gw as Array<{ config: any; secret_enc: string | null }> | null)?.[0];
  if (!g) return EMPTY;
  let privateKey = '';
  try { privateKey = String((await deps.openSecret(inst, 'push', g.secret_enc)).privateKey ?? ''); }
  catch (e) { return { ...EMPTY, enabled: true, error: (e as Error)?.message || 'Não foi possível abrir as chaves de push.' }; }
  const publicKey = String(g.config?.publicKey ?? ''), subject = String(g.config?.subject ?? '');
  if (!isVapidPublicKey(publicKey) || !isVapidPrivateKey(privateKey) || !subject) {
    return { ...EMPTY, enabled: true, error: 'As chaves de push desta escola estão incompletas. Volte a gerá-las em Configurações → Integrações → Notificações.' };
  }

  const { data: t, error: te } = await deps.rpc.rpc('notification_push_targets', { p_inst: inst, p_kind: audience.kind, p_ids: audience.ids ?? [] });
  if (te) return { ...EMPTY, enabled: true, error: 'Não foi possível obter os destinatários do push.' };
  const targets = (t as Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> | null) ?? [];
  const totals: PushTotals = { ...EMPTY, enabled: true, targets: targets.length };
  if (!targets.length) return totals;

  const payload = buildPushPayload({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
  const ok: string[] = [], fail: string[] = [], gone: string[] = [], users = new Set<string>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      const s = targets[i];
      let r: PushOutcome;
      try {
        r = await sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload,
          { vapid: { publicKey, privateKey, subject }, urgency: msg.critical ? 'high' : 'normal', topic: msg.tag && /^[A-Za-z0-9_-]{1,32}$/.test(msg.tag) ? msg.tag : undefined, fetchFn: deps.fetchFn });
      } catch { r = { ok: false, status: 0, gone: false, retryable: true }; }
      if (r.ok) { ok.push(s.id); users.add(s.user_id); } else if (r.gone) gone.push(s.id); else fail.push(s.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 10, targets.length) }, worker));
  try { if (gone.length) await deps.removeSubscriptions(gone); } catch { /* melhor esforço */ }
  try { await deps.touchSubscriptions(ok, fail); } catch { /* melhor esforço */ }
  return { ...totals, sent: ok.length, failed: fail.length, removed: gone.length, usersReached: users.size };
}
