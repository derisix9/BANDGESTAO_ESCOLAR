/**
 * Publicação / leitura dos registos públicos dos QR (Supabase: tabela public_tokens, migrações 0004 e 0010).
 * Escrita: só gestão da própria escola, por publish_public_token (nunca sobrescreve outra escola; token revogado
 * não ressuscita). Leitura: qualquer pessoa com o token, por verify_public_token — só devolve o payload MÍNIMO
 * e só se o token existir, não tiver expirado nem sido revogado. O anónimo nunca toca na tabela.
 */
import { supabase } from './supabase';
import type { SchoolDatabase } from '../types';
import { personToken } from '../utils/publicToken';
import { buildPublicRecord, recordHash, type PublicRecord } from '../utils/publicProjection';

const idxKey = (inst: string) => `pv_idx_${inst}`;
type Idx = Record<string, { t: string; h: string }>;
const loadIdx = (inst: string): Idx => { try { return JSON.parse(localStorage.getItem(idxKey(inst)) || '{}'); } catch { return {}; } };
const saveIdx = (inst: string, i: Idx) => { try { localStorage.setItem(idxKey(inst), JSON.stringify(i)); } catch { /* quota */ } };

/** Publica (ou actualiza) o registo público das pessoas indicadas; só escreve o que mudou. */
export interface PublishResult { n: number; revoked?: number; error?: 'sem-segredo' | 'permissao' | 'rede' }
export async function publishPublicRecords(db: SchoolDatabase, keys: string[], inst: string, force = false): Promise<PublishResult> {
  const secret = (db.settings as any)?.publicVerifySecret as string | undefined;
  if (!secret || !inst) return { n: 0, error: 'sem-segredo' };
  let error: PublishResult['error'];
  const idx = loadIdx(inst);
  let n = 0, revoked = 0;
  for (const key of Array.from(new Set(keys))) {
    const rec = buildPublicRecord(db, key, inst);
    if (!rec) continue;
    const token = personToken(secret, key);
    const h = recordHash(rec);
    if (!force && idx[key]?.h === h) continue;
    try {
      const { data: st, error: rpcError } = await supabase.rpc('publish_public_token', {
        p_token: token,
        p_subject_type: rec.kind === 'student' ? 'student_card' : 'staff_card',
        p_subject_id: key,
        p_payload: rec,
        p_days: 365
      });
      if (rpcError) throw rpcError;
      if (st === 'revoked') { revoked++; continue; }   // cartão revogado: a secretaria tem de emitir um novo
      idx[key] = { t: token, h };
      n++;
    } catch (e: any) {
      console.warn('[public_verify] não foi possível publicar', key, e);
      error = /permission|denied|permiss|42501|outra institui/i.test(String(e?.message || e) + String(e?.code || '')) ? 'permissao' : 'rede';
      break; // sem permissão / função não publicada: não insistir
    }
  }
  saveIdx(inst, idx);
  return { n, revoked, error };
}

/** Revoga todos os QR activos de uma pessoa (cartão perdido, aluno transferido, saída do funcionário). */
export async function revokePublicSubject(key: string, inst: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('revoke_public_subject', { p_subject_id: key });
  if (error) return { success: false, error: error.message };
  const idx = loadIdx(inst); delete idx[key]; saveIdx(inst, idx);
  return { success: true };
}

/** Reactiva (só administrador) o QR de uma pessoa antes revogado — por exemplo, cartão reemitido. Fica auditado. */
export async function reissuePublicRecord(db: SchoolDatabase, key: string, inst: string): Promise<{ success: boolean; error?: string }> {
  const secret = (db.settings as any)?.publicVerifySecret as string | undefined;
  const rec = secret ? buildPublicRecord(db, key, inst) : null;
  if (!secret || !rec) return { success: false, error: 'Sem segredo público ou pessoa inexistente.' };
  const { error } = await supabase.rpc('publish_public_token', {
    p_token: personToken(secret, key), p_subject_type: rec.kind === 'student' ? 'student_card' : 'staff_card',
    p_subject_id: key, p_payload: rec, p_days: 365, p_reissue: true
  });
  return error ? { success: false, error: error.message } : { success: true };
}

/** Volta a publicar só as pessoas já publicadas (estado financeiro / transporte actualizados). */
export async function refreshPublishedRecords(db: SchoolDatabase, inst: string): Promise<number> {
  const keys = Object.keys(loadIdx(inst));
  return keys.length ? (await publishPublicRecords(db, keys, inst)).n : 0;
}

export interface FetchResult { rec: PublicRecord | null; error?: 'token' | 'permissao' | 'rede' | 'inexistente' }

/** Lê um registo público pelo token (sem login), com limite de 12 s para nunca ficar preso. */
export async function fetchPublicRecord(token: string): Promise<FetchResult> {
  if (!/^[0-9a-z]{10}$/.test(token)) return { rec: null, error: 'token' };
  try {
    const res = await Promise.race([
      supabase.rpc('verify_public_token', { p_token: token }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
    ]);
    if (res.error) throw res.error;
    const v = res.data as { valid?: boolean; data?: PublicRecord; expires_at?: string } | null;
    // Revogado, expirado ou inexistente: a função não os distingue (de propósito, para não revelar nada).
    return v?.valid && v.data ? { rec: v.data as PublicRecord } : { rec: null, error: 'inexistente' };
  } catch (e: any) {
    console.warn('[public_verify] leitura falhou', e);
    return { rec: null, error: /permission|denied|42501/i.test(String(e?.message || e) + String(e?.code || '')) ? 'permissao' : 'rede' };
  }
}

/** Chaves de pessoa (s:/t:/f:) que aparecem nos QR de um conjunto de cenas de cartões. */
export function keysFromScenes(scenes: Array<{ prims?: any[] } | undefined>): string[] {
  const out = new Set<string>();
  for (const sc of scenes) for (const p of sc?.prims || []) {
    if (p.k !== 'qr' || typeof p.value !== 'string' || !p.value.includes('public_verify')) continue;
    const q = new URLSearchParams(p.value.slice(p.value.indexOf('?') + 1));
    const id = q.get('id') || '';
    if (!id) continue;
    out.add(/^[stf]:/.test(id) ? id : q.get('type') === 'staff' ? id : `s:${id}`);
  }
  return Array.from(out);
}
