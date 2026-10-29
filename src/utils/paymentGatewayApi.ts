/**
 * Pagamentos AUTOMÁTICOS por referência Multicaixa (ProxyPay…) — parte pura, sem React.
 *   • estado: RPC `payment_gateway_status()` (só o administrador; nunca devolve a chave de API);
 *   • "os pagamentos estão activos?": RPC `payment_gateway_enabled()` (qualquer utilizador da escola);
 *   • acções: Edge Function `payments` (save | test | sync-now | simulate | disconnect | reference | cancel).
 * Migração 0038 + supabase/functions/payments. Detalhes em docs/PAGAMENTOS_REFERENCIA.md.
 */
export type GatewayProvider = 'proxypay';

export interface ProviderInfo { id: GatewayProvider; label: string; site: string; help: string; keyLabel: string; entityHelp: string }
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'proxypay', label: 'ProxyPay (Multicaixa)', site: 'https://www.proxypay.co.ao', keyLabel: 'Chave de API (API Key)',
    help: 'A ProxyPay emite referências Multicaixa por si. Peça a conta à ProxyPay, copie do painel deles a chave de API (uma para TESTES e outra para PRODUÇÃO) e a entidade que lhe atribuíram.',
    entityHelp: 'A entidade Multicaixa que a ProxyPay lhe atribuiu (até 5 dígitos, ex.: 411 ou 00411).'
  }
];
export const providerInfo = (id?: string | null): ProviderInfo => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export const VALIDITY_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 dias' }, { days: 15, label: '15 dias' }, { days: 30, label: '30 dias (recomendado)' },
  { days: 60, label: '60 dias' }, { days: 90, label: '90 dias' }, { days: 180, label: '6 meses' }, { days: 365, label: '1 ano' }
];

export type EventOutcome = 'recebido' | 'aplicado' | 'valor_diferente' | 'ja_paga' | 'sem_referencia' | 'erro';
export const OUTCOME_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  recebido: { text: 'Recebido', tone: 'info' },
  aplicado: { text: 'Paga', tone: 'ok' },
  valor_diferente: { text: 'Rever: valor diferente', tone: 'warn' },
  ja_paga: { text: 'Rever: factura já paga', tone: 'warn' },
  sem_referencia: { text: 'Rever: referência desconhecida', tone: 'bad' },
  erro: { text: 'Erro (o fornecedor repete)', tone: 'bad' }
};

export interface GatewayEvent { at: string; outcome: EventOutcome | string; reference: string | null; invoiceId: string | null; amountKz: number | null; detail: string | null }
export interface GatewayStatus {
  institutionId: string;
  configured: boolean;
  provider: GatewayProvider | null;
  enabled: boolean;
  sandbox: boolean;
  entity: string | null;
  validityDays: number;
  hasSecret: boolean;
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null;
  lastSyncAt: string | null; lastSyncOk: boolean | null; lastSyncError: string | null;
  counts: { ativas?: number; pagas?: number; expiradas?: number; paraRever?: number };
  events: GatewayEvent[];
}

export interface SaveBody { provider: GatewayProvider; enabled: boolean; sandbox: boolean; entity: string; validityDays: number; apiKey?: string }
export interface SyncResult { ok: boolean; seen?: number; applied?: number; review?: number; failed?: number; error?: string }
export interface ReferenceResult { ok: boolean; created: boolean; reference: string; entity: string; amountKz: number; expiresOn: string }

export type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message?: string; code?: string } | null }>;
export type InvokeFn = (body: Record<string, unknown>) => Promise<{ data: any; error: string | null }>;

export const formatKz = (n: number | string | null | undefined): string => {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('pt-AO', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} Kz`;
};

/** Endereço que o fornecedor chama quando uma referência é paga (já vai em cada referência; serve também como webhook fixo). */
export const webhookUrl = (supabaseUrl: string, institutionId: string): string =>
  `${String(supabaseUrl).replace(/\/+$/, '')}/functions/v1/payments-webhook?school=${encodeURIComponent(institutionId)}`;

export function friendlyPaymentError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : String(e ?? '');
  const code = (e as any)?.code as string | undefined;
  if (code === 'PGRST202' || /Could not find the function/i.test(msg)) return 'A migração 0038 ainda não foi aplicada no Supabase (pagamentos por referência). Aplique supabase/migrations/0038_pagamentos_referencia.sql.';
  if (code === '42501' || /Só o administrador/i.test(msg)) return 'Sem permissão: só o administrador da escola gere os pagamentos por referência.';
  if (/failed to fetch|network|Failed to send a request to the Edge Function/i.test(msg)) return 'Não foi possível contactar o servidor de pagamentos. Verifique a internet e se as funções payments e payments-webhook estão publicadas.';
  return msg || 'Erro desconhecido.';
}

export function createPaymentGatewayApi(rpc: RpcFn, invoke: InvokeFn) {
  const act = async (body: Record<string, unknown>) => {
    const { data, error } = await invoke(body);
    if (error) throw new Error(error);
    return data;
  };
  return {
    async status(): Promise<GatewayStatus> {
      const { data, error } = await rpc('payment_gateway_status');
      if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
      return data as GatewayStatus;
    },
    /** Qualquer utilizador: os pagamentos por referência estão activos nesta escola? */
    async enabled(): Promise<boolean> {
      const { data, error } = await rpc('payment_gateway_enabled');
      if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
      return data === true;
    },
    save: (b: SaveBody) => act({ action: 'save', ...b }) as Promise<{ ok: boolean; referencesCancelled?: number; warning?: string }>,
    test: () => act({ action: 'test' }) as Promise<{ ok: boolean; error?: string }>,
    syncNow: () => act({ action: 'sync-now' }) as Promise<SyncResult>,
    simulate: (invoiceId: string) => act({ action: 'simulate', invoiceId }) as Promise<SyncResult>,
    disconnect: () => act({ action: 'disconnect' }),
    /** Gera (ou devolve a existente) a referência de uma factura. Staff: qualquer factura; aluno/encarregado: só as suas. */
    reference: (invoiceId: string) => act({ action: 'reference', invoiceId }) as Promise<ReferenceResult>,
    cancel: (invoiceId: string) => act({ action: 'cancel', invoiceId }) as Promise<{ ok: boolean; cancelled: boolean }>
  };
}
