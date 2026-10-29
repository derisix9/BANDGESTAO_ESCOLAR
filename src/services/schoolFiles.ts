/**
 * Ficheiros (fotos, BI, certificados, PDFs) vivem no Storage, NUNCA em base64 dentro da base de dados.
 * Caminho: {escola}/{colecção}/{id do registo}/{ficheiro} — as permissões do Storage seguem as da colecção (migração 0008).
 * No registo guarda-se só o caminho; para mostrar, pede-se um link temporário.
 */
import { supabase } from './supabase';
import { reportPlanLimit, STORAGE_FULL_TEXT } from '../utils/planLimits';

const BUCKET = 'school-files';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Ficheiro inválido');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'ficheiro';

/** Envia um ficheiro e devolve o caminho a guardar no registo. */
export async function uploadSchoolFile(institutionId: string, collection: string, recordId: string, file: Blob | string, name: string): Promise<string> {
  const blob = typeof file === 'string' ? dataUrlToBlob(file) : file;
  if (!ALLOWED.includes(blob.type)) throw new Error('Tipo de ficheiro não permitido (use JPG, PNG, WebP ou PDF).');
  if (blob.size > MAX_BYTES) throw new Error('Ficheiro demasiado grande (máximo 5 MB).');
  const path = `${institutionId}/${collection}/${encodeURIComponent(recordId)}/${Date.now()}_${safeName(name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) {
    // A política do Storage recusa o envio quando o armazenamento do plano está cheio (migração 0020),
    // mas só devolve "violates row-level security": confirma com o servidor para dar a mensagem certa.
    if (/row-level security|unauthorized|403/i.test(String(error.message))) {
      const full = await supabase.rpc('my_storage_full');
      if (full.data === true) {
        reportPlanLimit('LIMITE_PLANO:armazenamento — ' + STORAGE_FULL_TEXT);
        throw new Error(STORAGE_FULL_TEXT);
      }
    }
    throw error;
  }
  return path;
}

/** Link temporário (por omissão 10 min) para mostrar/descarregar. */
export async function schoolFileUrl(path: string, seconds = 600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

export async function deleteSchoolFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
