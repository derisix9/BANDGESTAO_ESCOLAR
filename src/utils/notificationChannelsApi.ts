/**
 * Notificações POR ESCOLA (push, SMS, WhatsApp) — parte pura, sem React.
 *   • "que canais estão ligados?": RPC `notification_channels_enabled()` (qualquer utilizador da escola);
 *   • estado completo (sem segredos): RPC `notification_gateway_status()` (só o administrador);
 *   • acções: Edge Function `notifications` (save | test | sms-test | push-generate | push-test | disconnect | subscribe | enqueue | push).
 * Migração 0039 + supabase/functions/notifications. Detalhes em docs/NOTIFICACOES_POR_ESCOLA.md.
 */
export type NotifyChannel = 'sms' | 'whatsapp' | 'push';

export interface ChannelsEnabled { sms: boolean; whatsapp: boolean; push: boolean; smsCriticalOnly: boolean; pushPublicKey: string | null }
export const NO_CHANNELS: ChannelsEnabled = { sms: false, whatsapp: false, push: false, smsCriticalOnly: true, pushPublicKey: null };

export function normalizeChannels(v: any): ChannelsEnabled {
  if (!v || typeof v !== 'object') return NO_CHANNELS;
  return {
    sms: v.sms === true, whatsapp: v.whatsapp === true, push: v.push === true,
    smsCriticalOnly: v.smsCriticalOnly !== false,
    pushPublicKey: typeof v.pushPublicKey === 'string' && v.pushPublicKey ? v.pushPublicKey : null
  };
}

export type SmsProviderId = 'twilio' | 'infobip' | 'http';
export type WhatsAppProviderId = 'twilio' | 'meta_cloud';

export const SMS_PROVIDERS: Array<{ id: SmsProviderId; label: string; help: string }> = [
  { id: 'twilio', label: 'Twilio', help: 'Conta Twilio: Account SID, Auth Token e um remetente (número ou nome) ou Messaging Service SID.' },
  { id: 'infobip', label: 'Infobip', help: 'Endereço base da conta (xxxx.api.infobip.com), chave de API e remetente.' },
  { id: 'http', label: 'Agregador local (API HTTP)', help: 'Operadora ou revendedor angolano com API HTTP: indique o endereço, o modelo do corpo e a autenticação. Não é preciso código novo.' }
];
export const WHATSAPP_PROVIDERS: Array<{ id: WhatsAppProviderId; label: string; help: string }> = [
  { id: 'meta_cloud', label: 'WhatsApp Cloud API (Meta)', help: 'Phone Number ID, token permanente e o nome do modelo APROVADO.' },
  { id: 'twilio', label: 'Twilio WhatsApp', help: 'Número WhatsApp do Twilio e o Content SID do modelo APROVADO.' }
];

export interface ChannelStatus {
  provider: string; enabled: boolean; config: Record<string, any>; hasSecret: boolean; criticalOnly: boolean;
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null;
}
export interface NotificationStatus {
  institutionId: string;
  channels: Partial<Record<NotifyChannel, ChannelStatus>>;
  counts: { enviadas7d?: number; falhadas7d?: number; naFila?: number; ultimoErro?: string | null };
  pushDevices: number; pushUsers: number;
}

export interface SaveChannelBody {
  channel: NotifyChannel; provider?: string; enabled: boolean; config?: Record<string, unknown>; secret?: Record<string, string>;
  criticalOnly?: boolean; subject?: string; generate?: boolean; publicKey?: string; privateKey?: string;
}
export interface PushResult { ok: boolean; enabled: boolean; targets: number; sent: number; failed: number; removed: number; usersReached: number; error?: string }
export type EnqueueResult = Array<{ id: string; ok: boolean; providerId?: string; error?: string }>;

export type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message?: string; code?: string } | null }>;
export type InvokeFn = (body: Record<string, unknown>) => Promise<{ data: any; error: string | null }>;

export function friendlyNotificationError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : String(e ?? '');
  const code = (e as any)?.code as string | undefined;
  if (code === 'PGRST202' || /Could not find the function/i.test(msg)) return 'A migração 0039 ainda não foi aplicada no Supabase (notificações por escola). Aplique supabase/migrations/0039_notificacoes_por_escola.sql.';
  if (code === '42501' || /Só o administrador/i.test(msg)) return 'Sem permissão: só o administrador da escola gere as notificações.';
  if (/failed to fetch|network|Failed to send a request to the Edge Function/i.test(msg)) return 'Não foi possível contactar o servidor de notificações. Verifique a internet e se a função notifications está publicada.';
  return msg || 'Erro desconhecido.';
}

export function createNotificationChannelsApi(rpc: RpcFn, invoke: InvokeFn) {
  const act = async (body: Record<string, unknown>) => {
    const { data, error } = await invoke(body);
    if (error) throw new Error(error);
    return data;
  };
  return {
    async enabled(): Promise<ChannelsEnabled> {
      const { data, error } = await rpc('notification_channels_enabled');
      if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
      return normalizeChannels(data);
    },
    async status(): Promise<NotificationStatus> {
      const { data, error } = await rpc('notification_gateway_status');
      if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
      return data as NotificationStatus;
    },
    save: (b: SaveChannelBody) => act({ action: 'save', ...b }) as Promise<{ ok: boolean; publicKey?: string; keysRotated?: boolean; devicesReset?: number }>,
    generatePush: (subject: string) => act({ action: 'push-generate', subject, enabled: true }) as Promise<{ ok: boolean; publicKey: string; devicesReset?: number }>,
    test: (channel: NotifyChannel) => act({ action: 'test', channel }) as Promise<{ ok: boolean; detail?: string; error?: string }>,
    pushTest: () => act({ action: 'push-test' }) as Promise<PushResult>,
    smsTest: (channel: 'sms' | 'whatsapp', to: string) => act({ action: 'sms-test', channel, to }) as Promise<{ ok: boolean; providerId?: string | null; error?: string }>,
    disconnect: (channel: NotifyChannel) => act({ action: 'disconnect', channel }),
    subscribe: (subscription: unknown, publicKey: string) => act({ action: 'subscribe', subscription, publicKey }) as Promise<{ ok: boolean }>,
    unsubscribe: (endpoint: string) => act({ action: 'unsubscribe', endpoint }),
    enqueue: (messages: unknown[]) => act({ action: 'enqueue', messages }).then((d) => (d?.results ?? []) as EnqueueResult),
    push: (b: { audience: { kind: string; ids?: string[] }; title: string; body: string; url?: string; tag?: string; critical?: boolean }) => act({ action: 'push', ...b }) as Promise<PushResult>
  };
}
