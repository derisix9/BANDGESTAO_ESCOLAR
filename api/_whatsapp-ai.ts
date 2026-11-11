/**
 * BANDGESTÃO AI — helpers privados do servidor.
 * Nunca importar este módulo no navegador. A IA vive em _ai-providers e _ai-assistant. O acesso aos dados usa service_role,
 * mas cada operação volta a validar perfil, instituição e collection_acl.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

declare const process: { env: Record<string, string | undefined> };

export const STAFF_ROLES = ['admin', 'director', 'secretaria', 'professor', 'financeiro', 'funcionario'] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export interface WhatsAppCaller {
  uid: string;
  institutionId: string;
  /** Instituição de origem do perfil; permite manter um só número ao trocar de filial. */
  homeInstitutionId: string;
  role: StaffRole;
  name: string;
  email: string;
  phone?: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  type: string;
  text?: string;
}

export const env = (key: string): string => String(process.env[key] || '').trim();
export const whatsappGraphVersion = (): string => env('WHATSAPP_AI_GRAPH_VERSION') || 'v26.0';
export const supabaseUrl = (): string => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/, '');
export const supabaseAnonKey = (): string => env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
export const serviceRoleKey = (): string => env('SUPABASE_SERVICE_ROLE_KEY');

export function isWhatsAppRuntimeConfigured(): boolean {
  return !!(
    env('WHATSAPP_AI_ENABLED') === 'true' &&
    env('WHATSAPP_AI_ACCESS_TOKEN') && env('WHATSAPP_AI_PHONE_NUMBER_ID') &&
    env('WHATSAPP_AI_VERIFY_TOKEN') && env('WHATSAPP_AI_APP_SECRET') &&
    supabaseUrl() && supabaseAnonKey() && serviceRoleKey()
  );
}

export function createAdminClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('Configuração segura do Supabase em falta no servidor.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function createAuthClient(accessToken: string): SupabaseClient {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon || !accessToken) throw new Error('Sessão inválida.');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

export function normalizeE164(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  const normalized = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length < 7 ? '••••••••' : `+${digits.slice(0, 4)}••••${digits.slice(-3)}`;
}

export function safeEqualText(a: string, b: string): boolean {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
}

export function accessKey(raw: string): string {
  return String(raw).replace(/\./g, '~d').replace(/\//g, '~s').replace(/\$/g, '~c')
    .replace(/#/g, '~h').replace(/\[/g, '~o').replace(/\]/g, '~e');
}

export async function getCallerFromToken(token: string, admin = createAdminClient()): Promise<WhatsAppCaller> {
  if (!token || token.length > 4096) throw new Error('Sessão inválida. Entre novamente no BANDGESTÃO.');
  const auth = createAuthClient(token);
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData?.user?.id) throw new Error('Sessão inválida. Entre novamente no BANDGESTÃO.');
  const uid = authData.user.id;
  const { data: profile, error } = await admin.from('profiles')
    .select('id,institution_id,role,name,email,phone,active')
    .eq('id', uid).maybeSingle();
  if (error || !profile || profile.active !== true) throw new Error('Conta inexistente ou inactiva.');
  if (!(STAFF_ROLES as readonly string[]).includes(String(profile.role))) {
    throw new Error('O Assistente WhatsApp está disponível apenas para membros da equipa da instituição.');
  }
  const { data: resolved, error: resolveError } = await admin.rpc('resolve_institution', { p_uid: uid });
  if (resolveError || typeof resolved !== 'string' || !resolved) {
    throw new Error('Não foi possível identificar a instituição activa deste utilizador.');
  }
  return {
    uid,
    institutionId: resolved,
    homeInstitutionId: String(profile.institution_id),
    role: profile.role as StaffRole,
    name: String(profile.name || 'Utilizador'),
    email: String(profile.email || authData.user.email || ''),
    phone: typeof profile.phone === 'string' ? profile.phone : undefined
  };
}

/**
 * Espelha app.can_access() para chamadas do servidor com service_role.
 * Esta verificação é obrigatória porque service_role ignora RLS.
 */
export async function canAccessCollection(
  admin: SupabaseClient,
  caller: WhatsAppCaller,
  collection: string,
  kind: 'read' | 'write' = 'read'
): Promise<boolean> {
  const { data: acl, error: aclError } = await admin.from('collection_acl')
    .select('sections,read_roles,write_roles,server_only')
    .eq('collection', collection).maybeSingle();
  if (aclError || !acl) return false;
  if (kind === 'write' && acl.server_only === true) return false;

  const sections = Array.isArray(acl.sections) ? acl.sections.map(String) : [];
  // Igual à app.can_access(): um bloqueio de secção da escola activa prevalece
  // inclusive para administradores e impede qualquer leitura dessa colecção.
  if (sections.length) {
    const { data: featureOverride, error: featureError } = await admin.from('school_feature_overrides')
      .select('blocked_sections').eq('institution_id', caller.institutionId).maybeSingle();
    if (featureError) return false; // falha fechada: não contornar bloqueios da plataforma.
    const blocked = featureOverride?.blocked_sections && typeof featureOverride.blocked_sections === 'object'
      ? featureOverride.blocked_sections as Record<string, unknown> : {};
    if (sections.some((section) => blocked[section] === true || blocked[section] === 'true')) return false;
  }
  if (caller.role === 'admin') return true;

  // app.can_access() procura a ACL personalizada na instituição de origem do perfil,
  // mesmo quando o administrador está a operar temporariamente numa filial.
  const { data: accessRow, error: accessError } = await admin.from('user_access').select('sections')
    .eq('institution_id', caller.homeInstitutionId).eq('user_id', caller.uid).maybeSingle();
  if (accessError) return false;
  const custom = (accessRow?.sections && typeof accessRow.sections === 'object') ? accessRow.sections as Record<string, any> : {};
  const hasCustomizedSection = sections.some((section) =>
    Object.prototype.hasOwnProperty.call(custom, accessKey(section))
  );

  if (hasCustomizedSection) {
    return sections.some((section) => {
      const rule = custom[accessKey(section)];
      if (!rule || rule.enabled !== true) return false;
      return kind === 'read' || rule.mode === 'write';
    });
  }
  const roles = kind === 'read' ? acl.read_roles : acl.write_roles;
  return Array.isArray(roles) && roles.includes(caller.role);
}

export async function sendWhatsAppDocument(to: string, link: string, filename: string, caption: string): Promise<void> {
  const version = whatsappGraphVersion();
  const phoneId = env('WHATSAPP_AI_PHONE_NUMBER_ID');
  const token = env('WHATSAPP_AI_ACCESS_TOKEN');
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'document',
      document: { link, filename, caption: caption.slice(0, 900) }
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    console.error('BANDGESTAO AI: falha no envio do documento WhatsApp, HTTP', response.status);
    throw new Error('O documento foi arquivado, mas o WhatsApp não confirmou a entrega.');
  }
}

export async function sendWhatsAppText(to: string, message: string): Promise<void> {
  const version = whatsappGraphVersion();
  const phoneId = env('WHATSAPP_AI_PHONE_NUMBER_ID');
  const token = env('WHATSAPP_AI_ACCESS_TOKEN');
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { preview_url: false, body: message.slice(0, 3900) } }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    console.error('BANDGESTAO AI: falha no envio de texto WhatsApp, HTTP', response.status);
    throw new Error('Não foi possível responder pelo WhatsApp.');
  }
}

export async function linkWhatsAppFromCode(admin: SupabaseClient, phone: string, code: string): Promise<WhatsAppCaller | null> {
  const hash = createHash('sha256').update(code).digest('hex');
  const { data: pairing, error } = await admin.from('whatsapp_ai_pairing_codes').select('id,institution_id,user_id,phone_e164,expires_at,consumed_at')
    .eq('code_hash', hash).eq('phone_e164', phone).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !pairing) return null;
  const { data: profile } = await admin.from('profiles').select('id,institution_id,role,name,email,phone,active')
    .eq('id', pairing.user_id).eq('active', true).maybeSingle();
  if (!profile || profile.institution_id !== pairing.institution_id || !(STAFF_ROLES as readonly string[]).includes(String(profile.role))) return null;
  const { data: resolved } = await admin.rpc('resolve_institution', { p_uid: profile.id });
  if (typeof resolved !== 'string' || !resolved) return null;
  const { data: consumed, error: consumeError } = await admin.from('whatsapp_ai_pairing_codes')
    .update({ consumed_at: new Date().toISOString() }).eq('id', pairing.id).is('consumed_at', null).select('id').maybeSingle();
  if (consumeError || !consumed) return null;
  const { error: linkError } = await admin.from('whatsapp_ai_links').upsert({
    institution_id: pairing.institution_id, user_id: pairing.user_id, phone_e164: phone,
    active: true, paired_at: new Date().toISOString(), last_message_at: null
  }, { onConflict: 'institution_id,user_id' });
  if (linkError) {
    console.error('BANDGESTAO AI: não foi possível concluir a ligação WhatsApp:', linkError.message);
    return null;
  }
  await admin.from('whatsapp_ai_pairing_codes').delete().eq('user_id', pairing.user_id).neq('id', pairing.id);
  await admin.rpc('write_audit_event_service', {
    p_inst: pairing.institution_id, p_actor: pairing.user_id, p_action: 'whatsapp_ai_phone_linked',
    p_entity: 'whatsapp_ai_links', p_entity_id: pairing.user_id, p_detail: { phoneSuffix: phone.slice(-4) }
  }).then(() => undefined, () => undefined);
  return {
    uid: profile.id, institutionId: resolved, homeInstitutionId: pairing.institution_id, role: profile.role as StaffRole,
    name: String(profile.name || 'Utilizador'), email: String(profile.email || ''),
    phone: typeof profile.phone === 'string' ? profile.phone : undefined
  };
}

export async function callerFromWhatsAppLink(admin: SupabaseClient, phone: string): Promise<WhatsAppCaller | null> {
  const { data: link, error } = await admin.from('whatsapp_ai_links').select('user_id,institution_id,active')
    .eq('phone_e164', phone).eq('active', true).maybeSingle();
  if (error || !link) return null;
  const { data: profile } = await admin.from('profiles').select('id,institution_id,role,name,email,phone,active')
    .eq('id', link.user_id).eq('active', true).maybeSingle();
  if (!profile || profile.institution_id !== link.institution_id || !(STAFF_ROLES as readonly string[]).includes(String(profile.role))) {
    await admin.from('whatsapp_ai_links').update({ active: false }).eq('user_id', link.user_id).eq('institution_id', link.institution_id);
    return null;
  }
  const { data: resolved } = await admin.rpc('resolve_institution', { p_uid: profile.id });
  if (typeof resolved !== 'string' || !resolved) return null;
  await admin.from('whatsapp_ai_links').update({ last_message_at: new Date().toISOString() }).eq('user_id', profile.id).eq('institution_id', link.institution_id);
  return {
    uid: profile.id, institutionId: resolved, homeInstitutionId: link.institution_id, role: profile.role as StaffRole,
    name: String(profile.name || 'Utilizador'), email: String(profile.email || ''),
    phone: typeof profile.phone === 'string' ? profile.phone : undefined
  };
}
