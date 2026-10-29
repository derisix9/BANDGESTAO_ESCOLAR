/**
 * Entrega da fila SMS/WhatsApp das escolas que ligaram o SEU fornecedor (migração 0039).
 * Parte sem Deno e sem Supabase (recebe o que precisa por parâmetro), testada em tests/notificationProviders.test.ts.
 * Usada pela Edge Function `notifications` (agendador e arranque imediato).
 *
 * Por mensagem: SMS só crítico → número válido → abre as credenciais DA ESCOLA (uma vez por lote) → envia → regista.
 * Falha de rede/429/5xx repete com recuo (finish_notification); falha de configuração/destinatário não repete (notification_skip).
 */
import {
  NotifyError, cleanCategory, makeSmsProvider, makeWhatsAppProvider, safeNotifyMessage, secretMissing, smsBlockedReason, toE164,
  type FetchFn, type SmsProvider, type WhatsAppProvider
} from './notify.ts';

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export interface DeliverJob {
  id: string; institution_id: string; channel: 'sms' | 'whatsapp'; to_phone: string; body: string; category?: string; attempts?: number;
  /** Ficheiro a enviar junto (WhatsApp) — só reuniões, ver supabase/functions/meeting-file. */
  attachment_url?: string | null; attachment_name?: string | null;
  provider: string; config: Record<string, unknown> | null; secret_enc: string | null; critical_only: boolean;
}

export interface DeliverDeps {
  rpc: RpcClient;
  /** abre as credenciais cifradas da escola */
  openSecret(inst: string, channel: 'sms' | 'whatsapp', enc: string | null): Promise<Record<string, unknown>>;
  fetchFn?: FetchFn;
  log?: (msg: string, extra?: unknown) => void;
  /** tempo máximo de uma execução (ms) */
  budgetMs?: number;
  now?: () => number;
}

export type JobOutcome = 'sent' | 'retry' | 'failed' | 'skipped';
export interface DrainTotals { claimed: number; sent: number; retried: number; failed: number; skipped: number }

type CacheEntry = { provider: SmsProvider | WhatsAppProvider } | { error: NotifyError };
const cacheKey = (j: DeliverJob) => `${j.institution_id}|${j.channel}`;

async function record(deps: DeliverDeps, fn: string, args: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await deps.rpc.rpc(fn, args);
    if (error) deps.log?.(`${fn}: ${error.message}`, args.p_id);
  } catch (e) {
    // Se não conseguir registar, a mensagem fica "a enviar" e app.job_requeue_stuck volta a pô-la na fila.
    deps.log?.(`${fn}: falhou`, e instanceof Error ? e.message : e);
  }
}

/** Entrega UMA mensagem e regista o resultado. Nunca lança. */
export async function deliverJob(job: DeliverJob, deps: DeliverDeps, cache: Map<string, CacheEntry> = new Map()): Promise<JobOutcome> {
  const skip = async (reason: string): Promise<JobOutcome> => { await record(deps, 'notification_skip', { p_id: job.id, p_reason: reason }); return 'skipped'; };
  try {
    if (job.channel === 'sms') {
      const blocked = smsBlockedReason(cleanCategory(job.category), job.critical_only);
      if (blocked) return await skip(blocked);
    }
    const to = toE164(job.to_phone);
    if (!to) return await skip('Número de telefone inválido.');

    const key = cacheKey(job);
    let entry = cache.get(key);
    if (!entry) {
      try {
        const secret = await deps.openSecret(job.institution_id, job.channel, job.secret_enc);
        const missing = secretMissing(job.channel, job.provider, job.config ?? {}, secret);
        if (missing) throw new NotifyError(missing);
        const provider = job.channel === 'sms'
          ? makeSmsProvider(job.provider, job.config ?? {}, secret, deps.fetchFn)
          : makeWhatsAppProvider(job.provider, job.config ?? {}, secret, deps.fetchFn);
        entry = { provider };
      } catch (e) {
        // Credenciais em falta/ilegíveis ou fornecedor desconhecido: vale para todas as mensagens deste lote desta escola.
        const message = e instanceof NotifyError || (e as Error)?.name === 'SecretsError' ? (e as Error).message : safeNotifyMessage(e);
        entry = { error: new NotifyError(message) };
      }
      cache.set(key, entry);
    }
    if ('error' in entry) return await skip(entry.error.message);

    const input = {
      id: job.id, to, text: job.body,
      ...(job.channel === 'whatsapp' && job.attachment_url ? { attachment: { url: job.attachment_url, filename: job.attachment_name || 'documento.pdf' } } : {})
    };
    const res = job.channel === 'sms'
      ? await (entry.provider as SmsProvider).send(input)
      : await (entry.provider as WhatsAppProvider).sendTemplate(input);
    await record(deps, 'finish_notification', { p_id: job.id, p_ok: true, p_provider_id: res.providerId ?? null, p_error: null });
    return 'sent';
  } catch (e) {
    const message = safeNotifyMessage(e);
    const retryable = e instanceof NotifyError ? e.retryable : true;
    if (!retryable) return await skip(message);
    // finish_notification(ok=false) agenda a repetição com recuo; esgotadas as tentativas passa a "failed".
    await record(deps, 'finish_notification', { p_id: job.id, p_ok: false, p_provider_id: null, p_error: message });
    return (job.attempts ?? 1) >= 5 ? 'failed' : 'retry';
  }
}

/** Reserva lotes e entrega até a fila esvaziar ou o tempo acabar. */
export async function drainSchoolQueue(deps: DeliverDeps): Promise<DrainTotals> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 100_000;
  const totals: DrainTotals = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const cache = new Map<string, CacheEntry>();
  while (now() - started < budget) {
    const { data, error } = await deps.rpc.rpc('notification_claim_school', { p_limit: 50 });
    if (error) { deps.log?.(`notification_claim_school: ${error.message}`); break; }
    const jobs = (data as DeliverJob[] | null) ?? [];
    if (jobs.length === 0) break;
    totals.claimed += jobs.length;
    for (const j of jobs) {
      // Sem tempo: as que ficaram reservadas voltam à fila por app.job_requeue_stuck (10 min) — por isso paramos só entre mensagens.
      const out = await deliverJob(j, deps, cache);
      if (out === 'sent') totals.sent++; else if (out === 'retry') totals.retried++; else if (out === 'failed') totals.failed++; else totals.skipped++;
    }
  }
  return totals;
}
