/**
 * BANDGESTÃO AI — armazenamento das chaves de IA de cada instituição.
 * As chaves são cifradas com AES-256-GCM (chave derivada de AI_KEYS_SECRET, ou, na falta dela, da chave
 * service_role) e ligadas à instituição e ao fornecedor (AAD): um registo copiado para outra escola não decifra.
 * O navegador nunca recebe a chave; apenas os últimos 4 caracteres.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  PROVIDERS, PROVIDER_IDS, sanitizeModel, serverCredentials, validateApiKeyFormat,
  type ProviderCredential, type ProviderId
} from './_ai-providers';

declare const process: { env: Record<string, string | undefined> };

const TABLE = 'whatsapp_ai_provider_keys';

export interface StoredProvider {
  provider: ProviderId;
  model: string;
  keyHint: string;
  priority: number;
  enabled: boolean;
  lastStatus: 'untested' | 'ok' | 'error';
  lastError: string | null;
  lastUsedAt: string | null;
}

function masterKey(): Buffer {
  const secret = String(process.env.AI_KEYS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (secret.length < 16) throw new Error('Defina AI_KEYS_SECRET (mínimo 16 caracteres) nas variáveis do servidor para guardar chaves de IA.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('bandgestao-ai-keys-v1'), Buffer.from('aes-256-gcm'), 32));
}

const aad = (institutionId: string, provider: string) => Buffer.from(`${institutionId}|${provider}`);

export function encryptKey(plain: string, institutionId: string, provider: ProviderId): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(aad(institutionId, provider));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(':');
}

export function decryptKey(payload: string, institutionId: string, provider: ProviderId): string {
  const [version, iv, tag, body] = String(payload || '').split(':');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Formato de chave desconhecido.');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(aad(institutionId, provider));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

const hintOf = (key: string) => `••••${key.slice(-4)}`;
const isProvider = (v: unknown): v is ProviderId => (PROVIDER_IDS as readonly string[]).includes(String(v));

function toCredential(row: any, institutionId: string): ProviderCredential | null {
  if (!isProvider(row?.provider)) return null;
  try {
    return { provider: row.provider, apiKey: decryptKey(String(row.key_cipher), institutionId, row.provider), model: sanitizeModel(row.provider, row.model), source: 'institution' };
  } catch {
    // Chave ilegível (segredo alterado, registo corrompido): ignora-a em vez de falhar o assistente todo.
    console.error(`BANDGESTAO AI: não foi possível decifrar a chave de ${row?.provider}.`);
    return null;
  }
}

/**
 * Ordem de utilização: chaves da escola activas (por prioridade), depois as do servidor para os
 * fornecedores que a escola não configurou. Assim há sempre reserva se uma chave esgotar a quota.
 */
export async function loadProviderChain(admin: SupabaseClient, institutionId: string): Promise<ProviderCredential[]> {
  const chain: ProviderCredential[] = [];
  const { data, error } = await admin.from(TABLE).select('provider,key_cipher,model,priority,enabled')
    .eq('institution_id', institutionId).eq('enabled', true).order('priority', { ascending: true });
  if (error) console.error('BANDGESTAO AI: falha a ler fornecedores de IA (migração 0049 aplicada?):', error.message);
  for (const row of data || []) {
    const cred = toCredential(row, institutionId);
    if (cred) chain.push(cred);
  }
  const have = new Set(chain.map((c) => c.provider));
  for (const cred of serverCredentials()) if (!have.has(cred.provider)) chain.push(cred);
  return chain;
}

export async function loadStoredCredential(admin: SupabaseClient, institutionId: string, provider: ProviderId): Promise<ProviderCredential | null> {
  const { data } = await admin.from(TABLE).select('provider,key_cipher,model')
    .eq('institution_id', institutionId).eq('provider', provider).maybeSingle();
  return data ? toCredential(data, institutionId) : null;
}

export async function listStoredProviders(admin: SupabaseClient, institutionId: string): Promise<StoredProvider[]> {
  const { data, error } = await admin.from(TABLE)
    .select('provider,model,key_hint,priority,enabled,last_status,last_error,last_used_at')
    .eq('institution_id', institutionId).order('priority', { ascending: true });
  if (error) throw new Error('Não foi possível ler os fornecedores de IA.');
  return (data || []).filter((r: any) => isProvider(r.provider)).map((r: any) => ({
    provider: r.provider, model: String(r.model || PROVIDERS[r.provider as ProviderId].defaultModel), keyHint: String(r.key_hint || '••••'),
    priority: Number(r.priority) || 10, enabled: r.enabled !== false,
    lastStatus: (['ok', 'error'].includes(r.last_status) ? r.last_status : 'untested') as StoredProvider['lastStatus'],
    lastError: r.last_error ? String(r.last_error) : null, lastUsedAt: r.last_used_at || null
  }));
}

export async function saveProviderKey(admin: SupabaseClient, institutionId: string, userId: string, input: {
  provider: ProviderId; apiKey?: string; model?: string; priority?: number; enabled?: boolean;
}): Promise<void> {
  const { data: existing } = await admin.from(TABLE).select('provider').eq('institution_id', institutionId).eq('provider', input.provider).maybeSingle();
  if (!existing && !input.apiKey) throw new Error('Indique a chave de API deste fornecedor.');

  const patch: Record<string, unknown> = { institution_id: institutionId, provider: input.provider, updated_by: userId, updated_at: new Date().toISOString() };
  if (input.apiKey) {
    const key = validateApiKeyFormat(input.provider, input.apiKey);
    patch.key_cipher = encryptKey(key, institutionId, input.provider);
    patch.key_hint = hintOf(key);
    patch.last_status = 'untested';
    patch.last_error = null;
  }
  if (input.model !== undefined) patch.model = sanitizeModel(input.provider, input.model);
  else if (!existing) patch.model = PROVIDERS[input.provider].defaultModel;
  if (input.priority !== undefined && Number.isFinite(input.priority)) patch.priority = Math.min(99, Math.max(1, Math.round(input.priority)));
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const { error } = await admin.from(TABLE).upsert(patch, { onConflict: 'institution_id,provider' });
  if (error) {
    console.error('BANDGESTAO AI: falha ao guardar a chave de IA:', error.message);
    throw new Error('Não foi possível guardar a chave. Confirme que a migração 0049 foi aplicada.');
  }
}

export async function deleteProviderKey(admin: SupabaseClient, institutionId: string, provider: ProviderId): Promise<void> {
  const { error } = await admin.from(TABLE).delete().eq('institution_id', institutionId).eq('provider', provider);
  if (error) throw new Error('Não foi possível remover a chave.');
}

export async function recordProviderStatus(admin: SupabaseClient, institutionId: string, provider: ProviderId, ok: boolean, error?: string): Promise<void> {
  await admin.from(TABLE).update({
    last_status: ok ? 'ok' : 'error', last_error: ok ? null : String(error || 'Falha').slice(0, 240), last_used_at: new Date().toISOString()
  }).eq('institution_id', institutionId).eq('provider', provider).then(() => undefined, () => undefined);
}
