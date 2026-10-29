/**
 * Gateway de mensagens (passo 5). Parte partilhada entre a app (navegador) e o servidor
 * (server/notify.ts): normalização de telefones, pedido/resposta e segmentos de SMS.
 *
 * O navegador NUNCA guarda chaves de fornecedor. Envia o pedido ao endpoint da escola
 * (configurado em Configurações → Integrações) com o token de sessão; o servidor valida
 * quem pede e só ele fala com o fornecedor (ver server/notify.ts).
 */

export type GatewayChannel = 'sms' | 'whatsapp';

/** 'critico' = aviso que justifica SMS (ex.: propina em atraso). Os restantes vão por push (grátis). */
export type GatewayCategory = 'normal' | 'critico';

export interface GatewayMessage {
  /** Id do destinatário na notificação (para voltar a casar o resultado). */
  id: string;
  /** Número E.164 com "+", ex.: +244923456789 */
  to: string;
  channel: GatewayChannel;
  body: string;
  /** Omissão: 'normal'. O servidor decide se o SMS é permitido para esta categoria. */
  category?: GatewayCategory;
  /** Ficheiro a enviar junto (só WhatsApp). O SMS leva apenas o link no texto. */
  attachment?: { url: string; filename: string };
}

export interface GatewayResult {
  id: string;
  ok: boolean;
  /** Id da mensagem no fornecedor. */
  providerId?: string;
  error?: string;
}

/** Devolve E.164 com "+" (ex.: +244923456789) ou null. Números locais angolanos têm 9 dígitos. */
export function toE164(value?: string | null, defaultCountry = '244'): string | null {
  const raw = (value || '').trim();
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;
  if (!hasPlus && digits.length === 9) digits = defaultCountry + digits;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/** SMS GSM-7 tem 160 caracteres (153 em mensagens concatenadas); com acentos fora do GSM usa UCS-2 (70/67). */
export function smsSegments(text: string): { segments: number; encoding: 'GSM-7' | 'UCS-2' } {
  const gsm = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
  const isGsm = gsm.test(text);
  const len = [...text].length;
  const [single, multi] = isGsm ? [160, 153] : [70, 67];
  return { segments: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi), encoding: isGsm ? 'GSM-7' : 'UCS-2' };
}

export function buildGatewayMessages(
  recipients: Array<{ id: string; phone: string }>,
  channel: 'sms' | 'whatsapp' | 'ambos',
  body: string,
  category: GatewayCategory = 'normal',
  attachment?: { url: string; filename: string }
): { messages: GatewayMessage[]; invalid: string[] } {
  const channels: GatewayChannel[] = channel === 'ambos' ? ['sms', 'whatsapp'] : [channel];
  const messages: GatewayMessage[] = [];
  const invalid: string[] = [];
  for (const r of recipients) {
    const to = toE164(r.phone);
    if (!to) { invalid.push(r.id); continue; }
    for (const ch of channels) messages.push({ id: channels.length > 1 ? `${r.id}#${ch}` : r.id, to, channel: ch, body, ...(category === 'critico' ? { category } : {}), ...(attachment && ch === 'whatsapp' ? { attachment } : {}) });
  }
  return { messages, invalid };
}

export type GatewayConfig = { url?: string };

export function isGatewayConfigured(cfg?: GatewayConfig): boolean {
  try {
    if (!cfg?.url) return false;
    const u = new URL(cfg.url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Envia ao endpoint da escola. Nunca lança: falhas de rede viram resultados "ok: false". */
export async function sendViaGateway(
  cfg: GatewayConfig,
  idToken: string,
  messages: GatewayMessage[],
  fetchImpl: typeof fetch = fetch
): Promise<GatewayResult[]> {
  if (!isGatewayConfigured(cfg)) {
    return messages.map((m) => ({ id: m.id, ok: false, error: 'Gateway não configurado.' }));
  }
  try {
    const res = await fetchImpl(cfg.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ messages })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return messages.map((m) => ({ id: m.id, ok: false, error: `Gateway respondeu ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}` }));
    }
    const data = (await res.json()) as { results?: GatewayResult[] };
    const byId = new Map((data.results || []).map((r) => [r.id, r]));
    return messages.map((m) => byId.get(m.id) || { id: m.id, ok: false, error: 'Sem resposta do gateway para esta mensagem.' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'erro de rede';
    return messages.map((m) => ({ id: m.id, ok: false, error: `Não foi possível contactar o gateway (${reason}).` }));
  }
}

/** Junta os resultados por canal de volta ao destinatário: só "entregue" se todos os canais pedidos foram aceites. */
export function foldResultsByRecipient(results: GatewayResult[]): Map<string, { ok: boolean; error?: string }> {
  const out = new Map<string, { ok: boolean; error?: string }>();
  for (const r of results) {
    const rid = r.id.split('#')[0];
    const prev = out.get(rid);
    out.set(rid, { ok: (prev ? prev.ok : true) && r.ok, error: prev?.error || (r.ok ? undefined : r.error) });
  }
  return out;
}
