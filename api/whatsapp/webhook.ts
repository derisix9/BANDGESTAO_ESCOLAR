/** Webhook oficial Meta WhatsApp Cloud API — GET de verificação e POST de mensagens. */
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { RateLimiter } from '../_guard';
import {
  callerFromWhatsAppLink, createAdminClient, env, isWhatsAppRuntimeConfigured,
  linkWhatsAppFromCode, normalizeE164, safeEqualText, sendWhatsAppText
} from '../_whatsapp-ai';
import { answerWhatsAppMessage, handleQuickCommand } from '../_ai-assistant';

declare const process: { env: Record<string, string | undefined> };

export const config = { api: { bodyParser: false, responseLimit: '1mb' }, maxDuration: 60 };
const byPhone = new RateLimiter(12, 60_000);

async function rawBody(req: any, maxBytes = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > maxBytes) throw new Error('Payload demasiado grande.');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function signatureValid(raw: Buffer, header: unknown): boolean {
  const secret = env('WHATSAPP_AI_APP_SECRET');
  const supplied = String(header || '').trim();
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return safeEqualText(expected.toLowerCase(), supplied.toLowerCase());
}

function webhookChallenge(req: any): string {
  try {
    const url = new URL(String(req.url || '/'), 'https://bandgestao.invalid');
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && safeEqualText(token, env('WHATSAPP_AI_VERIFY_TOKEN')) && challenge) return challenge;
  } catch { /* pedido inválido */ }
  return '';
}

async function handleMessage(admin: ReturnType<typeof createAdminClient>, message: any, phoneNumberId: string) {
  const phone = normalizeE164(message?.from);
  const wamid = String(message?.id || '').slice(0, 160);
  if (!phone || !wamid) return;
  if (!byPhone.allow(phone)) {
    await sendWhatsAppText(phone, 'Recebi muitas mensagens deste número num curto espaço de tempo. Aguarde um minuto e volte a tentar.');
    return;
  }

  const { error: eventError } = await admin.from('whatsapp_ai_webhook_events').insert({
    message_id: wamid, from_phone: phone, status: 'processing', phone_number_id: phoneNumberId
  });
  if (eventError) {
    if (eventError.code === '23505' || eventError.status === 409) {
      // Meta pode repetir um webhook quando a execução serverless expira. Não repetimos
      // eventos concluídos; só recuperamos um processamento que ficou preso por >65 s.
      const { data: previous } = await admin.from('whatsapp_ai_webhook_events')
        .select('status,created_at').eq('message_id', wamid).maybeSingle();
      const isStale = previous?.status === 'processing' &&
        Date.now() - new Date(previous.created_at).getTime() > 65_000;
      if (!isStale) return;
      const { data: claimed } = await admin.from('whatsapp_ai_webhook_events')
        .update({ status: 'processing', created_at: new Date().toISOString(), processed_at: null, last_error: null })
        .eq('message_id', wamid).eq('status', 'processing').select('message_id').maybeSingle();
      if (!claimed) return; // outra instância já recuperou o evento.
    } else {
      console.error('BANDGESTAO AI: não foi possível registar o evento do webhook:', eventError.message);
      return;
    }
  }

  // Limite persistente complementar ao rate limiter em memória (cobre várias instâncias Vercel).
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await admin.from('whatsapp_ai_webhook_events')
    .select('message_id', { count: 'exact', head: true }).eq('from_phone', phone).gte('created_at', since);
  if ((recentCount ?? 0) > 12) {
    await admin.from('whatsapp_ai_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('message_id', wamid);
    await sendWhatsAppText(phone, 'O limite temporário de mensagens foi atingido. Aguarde um minuto antes de voltar a enviar comandos.');
    return;
  }

  try {
    const text = message?.type === 'text' ? String(message?.text?.body || '').trim() : '';
    if (!text) {
      await sendWhatsAppText(phone, 'Por enquanto, envie comandos em texto. Pode escrever, por exemplo: “Quantos alunos estão matriculados?” ou “Gera um relatório de turmas em PDF”.');
      await admin.from('whatsapp_ai_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('message_id', wamid);
      return;
    }

    const pairing = /^\s*(?:LIGAR|LINK|CONECTAR)\s+(\d{6})\s*$/i.exec(text);
    if (pairing) {
      const linked = await linkWhatsAppFromCode(admin, phone, pairing[1]);
      if (!linked) {
        await sendWhatsAppText(phone, 'Código inválido, expirado ou emitido para outro número. Gere um novo código dentro do BANDGESTÃO e tente novamente.');
      } else {
        await sendWhatsAppText(phone, `Ligação concluída com sucesso! Olá, ${linked.name}. Este número está associado ao seu perfil ${linked.role}. Já pode consultar dados e pedir relatórios em PDF ou Excel dentro das permissões do seu perfil. Escreva AJUDA para ver exemplos.`);
      }
      await admin.from('whatsapp_ai_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('message_id', wamid);
      return;
    }

    const caller = await callerFromWhatsAppLink(admin, phone);
    if (!caller) {
      await sendWhatsAppText(phone, 'Este número ainda não está associado a um utilizador do BANDGESTÃO. Entre na sua conta, abra “BANDGESTÃO AI” no cabeçalho e faça a ligação por código.');
      await admin.from('whatsapp_ai_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('message_id', wamid);
      return;
    }

    // Comandos rápidos (AJUDA, ESTADO, NOVA CONVERSA) respondem sem gastar quota de IA.
    const quick = await handleQuickCommand(admin, caller, phone, text);
    const answer = quick ?? await answerWhatsAppMessage(admin, caller, phone, text);
    await sendWhatsAppText(phone, answer || 'Não consegui preparar uma resposta. Reformule o pedido, por favor.');
    await admin.from('whatsapp_ai_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('message_id', wamid);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Erro interno.';
    console.error('BANDGESTAO AI: falha ao processar mensagem WhatsApp:', safeMessage);
    await admin.from('whatsapp_ai_webhook_events').update({ status: 'failed', last_error: safeMessage.slice(0, 220), processed_at: new Date().toISOString() }).eq('message_id', wamid);
    try { await sendWhatsAppText(phone, 'Ocorreu um erro ao processar o pedido. Os dados não foram alterados. Tente novamente ou contacte o suporte.'); } catch { /* Meta fará retry do evento se a entrega falhar */ }
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const challenge = webhookChallenge(req);
    return challenge ? res.status(200).send(challenge) : res.status(403).send('Verificação recusada.');
  }
  if (req.method !== 'POST') return res.status(405).send('Método não permitido.');
  if (!isWhatsAppRuntimeConfigured()) return res.status(503).send('BANDGESTÃO AI não configurado.');

  let raw: Buffer;
  try { raw = await rawBody(req); }
  catch { return res.status(413).send('Payload demasiado grande.'); }
  if (!signatureValid(raw, req.headers?.['x-hub-signature-256'])) return res.status(401).send('Assinatura inválida.');

  let payload: any;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).send('JSON inválido.'); }
  if (payload?.object !== 'whatsapp_business_account') return res.status(404).send('Evento ignorado.');

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return res.status(503).send('Serviço indisponível.'); }
  const expectedPhoneId = env('WHATSAPP_AI_PHONE_NUMBER_ID');
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change?.field !== 'messages' || String(value?.metadata?.phone_number_id || '') !== expectedPhoneId) continue;
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        await handleMessage(admin, message, expectedPhoneId);
      }
    }
  }
  // Retenção operacional: códigos expirados e IDs de webhook antigos deixam de ocupar espaço.
  await Promise.all([
    admin.from('whatsapp_ai_pairing_codes').delete().lt('expires_at', new Date().toISOString()),
    admin.from('whatsapp_ai_webhook_events').delete().lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
  ]);
  return res.status(200).send('EVENT_RECEIVED');
}
