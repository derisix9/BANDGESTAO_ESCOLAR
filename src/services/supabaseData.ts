/**
 * Camada de dados Supabase — equivalente a src/utils/shardSync.ts + chamadas ao RTDB no db.ts.
 * Migração módulo a módulo: cada colecção de dataShards.json vive em `records`.
 * Regras: o servidor decide permissões (RLS); este ficheiro nunca confia no papel enviado pelo cliente.
 */
import { supabase } from './supabase';
import { reportPlanLimit } from '../utils/planLimits';

export interface RecordRow<T = any> { id: string; data: T; version: number; academic_year: string | null; ord: number | null }

/** Lê uma colecção (paginada, filtrada por ano lectivo no servidor — nunca "tudo"). */
export async function listRecords<T = any>(
  institutionId: string, collection: string,
  opts: { academicYear?: string; from?: number; to?: number } = {}
): Promise<RecordRow<T>[]> {
  let q = supabase.from('records').select('id,data,version,academic_year,ord')
    .eq('institution_id', institutionId).eq('collection', collection)
    .order('ord', { ascending: true, nullsFirst: false }).order('id');
  if (opts.academicYear) q = q.eq('academic_year', opts.academicYear);
  const from = opts.from ?? 0, to = opts.to ?? from + 999;
  const { data, error } = await q.range(from, to);
  if (error) throw error;
  return (data ?? []) as RecordRow<T>[];
}

/** Grava um registo. `version` = a que leu; se outro utilizador gravou entretanto, falha (conflito PT409/HTTP 409). */
export async function saveRecord(
  institutionId: string, collection: string, id: string, data: any,
  opts: { version?: number; academicYear?: string; ord?: number } = {}
): Promise<void> {
  if (opts.version === undefined) {
    const { error } = await supabase.from('records').insert({
      institution_id: institutionId, collection, id, data, academic_year: opts.academicYear ?? null, ord: opts.ord ?? null
    });
    if (error) { reportPlanLimit(error); throw error; }
    return;
  }
  const { error, count } = await supabase.from('records')
    .update({ data, version: opts.version }, { count: 'exact' })
    .eq('institution_id', institutionId).eq('collection', collection).eq('id', id);
  if (error) { reportPlanLimit(error); throw error; }
  if (!count) throw new Error('Sem permissão ou registo inexistente');
}

export async function deleteRecord(institutionId: string, collection: string, id: string): Promise<void> {
  const { error } = await supabase.from('records').delete()
    .eq('institution_id', institutionId).eq('collection', collection).eq('id', id);
  if (error) throw error;
}

// ---- Operações sensíveis: só pelo servidor (RPC), nunca por escrita directa ----
export const registerPayment = async (invoiceId: string, amountKz: number, method: string, reference: string | null, idempotencyKey: string) => {
  const { data, error } = await supabase.rpc('register_payment', {
    p_invoice_id: invoiceId, p_amount_kz: amountKz, p_method: method, p_reference: reference, p_idempotency_key: idempotencyKey
  });
  if (error) throw error; return data;
};
export const homologatePauta = async (h: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc('homologate_pauta', { p_homologation: h });
  if (error) throw error; return data;
};
export const issueFiscalDocument = async (a: {
  docType: 'FT'|'FR'|'RG'|'NC'|'ND'; series: string; customerName: string; customerNif?: string;
  lines: unknown[]; netKz: number; taxKz: number; sourceInvoiceId?: string;
}) => {
  const { data, error } = await supabase.rpc('issue_fiscal_document', {
    p_doc_type: a.docType, p_series: a.series, p_customer_name: a.customerName, p_customer_nif: a.customerNif ?? null,
    p_lines: a.lines, p_net: a.netKz, p_tax: a.taxKz, p_source_invoice: a.sourceInvoiceId ?? null
  });
  if (error) throw error; return data;
};
export const issuePublicToken = async (type: 'student_card'|'document'|'transport_pass'|'staff_card', subjectId: string, payload: object, days = 365) => {
  const { data, error } = await supabase.rpc('issue_public_token', { p_subject_type: type, p_subject_id: subjectId, p_payload: payload, p_days: days });
  if (error) throw error; return data as string;
};
export const verifyPublicToken = async (token: string) => {
  const { data, error } = await supabase.rpc('verify_public_token', { p_token: token });
  if (error) throw error; return data as { valid: boolean; type?: string; data?: any; school?: string; expires_at?: string };
};

// ---- Contas: via Edge Functions (o cliente não cria perfis) ----
export const createUserAccount = async (a: {
  email: string; password: string; name: string; role: string; phone?: string;
  linkedStudentId?: string; linkedTeacherId?: string; linkedFuncionarioId?: string;
}) => {
  const { data, error } = await supabase.functions.invoke('create-user', { body: a });
  if (error) { reportPlanLimit(error); throw error; } return data as { id: string };
};
