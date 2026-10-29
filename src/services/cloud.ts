/**
 * Camada de dados na nuvem (Supabase) — substitui o Firebase Realtime Database.
 *
 * Mapa (Firebase → Supabase):
 *   institutions/{escola}  (documento)      → institution_docs   (settings, events, auditLogs, miniPautasStore, pauta, attendance)
 *   users/{uid}                              → profiles
 *   access_control/{escola}/{uid}            → user_access
 *   user_projections/{escola}/{uid}          → user_projections
 *   public_academic_years/{escola}           → public_academic_years  (leitura pública só por RPC)
 *   public_admission_*                       → tabelas public_admission_* (anónimo só por RPC)
 *   institution_transfers/{destino}/{id}     → institution_transfers
 *   institutions_registry/index              → RPC list_institutions()
 *
 * Regras: quem pode ler/escrever o quê é decidido pela base de dados (RLS + gatilhos, ver supabase/migrations).
 * Este ficheiro nunca confia no papel enviado pelo cliente.
 */
import { supabase, isServerCoolingDown, noteServerFailure, noteServerOk, isTransientFailure } from './supabase';
import { reportPlanLimit } from '../utils/planLimits';

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

let signedIn = false;
if (typeof window !== 'undefined') {
  void supabase.auth.getSession().then(({ data }) => { signedIn = !!data.session; });
  supabase.auth.onAuthStateChange((_e, s) => { signedIn = !!s; });
}
/** Há sessão Supabase neste navegador? (síncrono, actualizado pelo evento de autenticação) */
export const isSignedIn = (): boolean => signedIn;

const isRlsDenied = (e: any): boolean => e?.code === '42501' || /row-level security|permission denied/i.test(String(e?.message || ''));

// ---------------------------------------------------------------------------
// Utilizadores (profiles)
// ---------------------------------------------------------------------------

/** Converte uma linha de `profiles` no objecto `User` que a app usa. */
export function profileRowToUser(p: any): any {
  const d = (p?.data ?? {}) as Record<string, any>;
  return {
    ...d,
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    roleTitle: d.roleTitle ?? p.role,
    avatar: d.avatar ?? '',
    phone: p.phone ?? d.phone ?? undefined,
    // Escola ativa: só o administrador pode estar numa filial (o servidor valida; ver 0024_filiais.sql).
    institutionId: p.role === 'admin' && p.active_institution_id ? p.active_institution_id : p.institution_id,
    homeInstitutionId: p.institution_id,
    linkedStudentId: p.linked_student_id ?? undefined,
    linkedTeacherId: p.linked_teacher_id ?? undefined,
    linkedFuncionarioId: p.linked_funcionario_id ?? undefined,
    isFounder: p.is_founder === true
  };
}

/** Campos de apresentação que ficam em `profiles.data` (o resto tem colunas próprias). */
const PROFILE_COLUMNS = new Set([
  'id', 'name', 'email', 'role', 'phone', 'institutionId', 'homeInstitutionId', 'linkedStudentId', 'linkedTeacherId', 'linkedFuncionarioId', 'isFounder',
  'password', 'access'
]);

/** Perfil de um utilizador pelo id da conta (o próprio, ou qualquer um da escola se a RLS o permitir). */
export async function loadProfileById(uid: string): Promise<any | null> {
  if (isServerCoolingDown()) throw new Error('Servidor temporariamente indisponível');
  const { data, error, status } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) { if (isTransientFailure(status, error)) noteServerFailure(); throw error; }
  noteServerOk();
  if (!data || data.active === false) return null;
  return profileRowToUser(data);
}

/** Lista os perfis da escola (só a equipa tem permissão; para os restantes devolve [] ou só o próprio). */
export async function listInstitutionUsers(inst: string): Promise<any[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('institution_id', inst).order('name');
  if (error) throw error;
  return (data ?? []).map(profileRowToUser);
}

/**
 * Actualiza os dados de apresentação de um perfil existente (nome, telefone, avatar, etc.).
 * Papel, escola e estado NÃO são enviados: só o servidor decide isso (gatilho profiles_guard).
 * Perfis novos são criados pela Edge Function `create-user`, nunca por aqui.
 */
export async function updateProfile(user: Record<string, any>, opts: { includeRole?: boolean } = {}): Promise<void> {
  if (!user?.id) return;
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(user)) {
    if (PROFILE_COLUMNS.has(k) || v === undefined) continue;
    extra[k] = v;
  }
  const row: Record<string, any> = { data: extra };
  if (user.name) row.name = String(user.name).trim();
  if (user.phone !== undefined) row.phone = user.phone || null;
  // O tipo de perfil (coluna `role`) só segue quando o administrador o altera de propósito; as RLS/gatilhos validam.
  if (opts.includeRole && user.role) row.role = user.role;
  const { error } = await supabase.from('profiles').update(row).eq('id', user.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Documento da escola (institution_docs)
// ---------------------------------------------------------------------------

export const DOC_KEYS = ['settings', 'events', 'auditLogs', 'miniPautasStore', 'pauta', 'attendance'] as const;
type DocKey = (typeof DOC_KEYS)[number];

/** Última versão conhecida de cada chave, para só enviar o que mudou. */
const docSig = new Map<string, string>();
const sigOf = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(Math.random()); } };

export interface SchoolDoc extends Record<string, any> {
  /** Carimbo do servidor da última alteração (substitui o antigo `lastCloudSync`). */
  lastCloudSync?: string;
}

/**
 * Lê o documento da escola. Devolve `null` se a escola ainda não tem nenhuma linha (e a leitura funcionou).
 * Lança erro se a leitura falhou (rede/permissão) — quem chama NUNCA deve tratar isso como "nuvem vazia".
 */
export async function loadSchoolDoc(inst: string, opts: { withUsers?: boolean } = {}): Promise<SchoolDoc | null> {
  // Mesmas 2 consultas de antes, mas em paralelo (não acrescenta carga; só tira a espera em série).
  const usersPromise: Promise<any[] | null> = opts.withUsers ? listInstitutionUsers(inst).catch(() => null) : Promise.resolve(null);
  const { data, error } = await supabase.from('institution_docs').select('key,data,updated_at').eq('institution_id', inst);
  if (error) throw error;
  const doc: SchoolDoc = {};
  let latest = '';
  for (const r of data ?? []) {
    doc[r.key] = r.data;
    docSig.set(inst + '/' + r.key, sigOf(r.data));
    if (String(r.updated_at) > latest) latest = String(r.updated_at);
  }
  if (opts.withUsers) {
    try {
      const users = await usersPromise;
      if (!users) throw new Error('sem utilizadores');
      // Só contas desta escola (a lista vem filtrada por institution_id; o filtro extra protege contra cache cruzada).
      const own = users.filter((u: any) => !u.homeInstitutionId || u.homeInstitutionId === inst || u.institutionId === inst);
      if (own.length) doc.users = own;
    } catch { /* sem permissão para listar utilizadores: fica só o próprio */ }
  }
  if (!data || data.length === 0) return opts.withUsers && doc.users ? doc : null;
  doc.lastCloudSync = latest;
  return doc;
}

/**
 * Grava no documento da escola as chaves que mudaram (as outras colecções têm destino próprio: `records`).
 * Devolve o carimbo do servidor das linhas gravadas (para o cliente reconhecer o seu próprio eco no Realtime).
 * Chaves sem permissão de escrita para este perfil são ignoradas (a base de dados é que decide).
 */
export async function saveSchoolDoc(inst: string, payload: Record<string, any>): Promise<string | undefined> {
  const rows: Array<{ institution_id: string; key: DocKey; data: any }> = [];
  for (const key of DOC_KEYS) {
    const v = payload[key];
    if (v === undefined || v === null) continue;
    // Mesma regra da restrição institution_docs_shape na base de dados.
    const wantsObject = key === 'settings' || key === 'miniPautasStore';
    const shapeOk = wantsObject ? typeof v === 'object' && !Array.isArray(v) : Array.isArray(v);
    if (!shapeOk) { console.warn(`institution_docs: "${key}" tem forma inválida (${Array.isArray(v) ? 'array' : typeof v}); não enviado.`); continue; }
    if (docSig.get(inst + '/' + key) === sigOf(v)) continue;
    rows.push({ institution_id: inst, key, data: v });
  }
  if (rows.length === 0) return undefined;

  let { data, error } = await supabase.from('institution_docs').upsert(rows, { onConflict: 'institution_id,key' }).select('key,updated_at');
  if (error && isRlsDenied(error) && rows.length > 1) {
    // Uma das chaves não é gravável por este perfil: tenta uma a uma e ignora as negadas.
    const ok: Array<{ key: string; updated_at: string }> = [];
    for (const r of rows) {
      const one = await supabase.from('institution_docs').upsert(r, { onConflict: 'institution_id,key' }).select('key,updated_at');
      if (one.error) {
        if (isRlsDenied(one.error)) { docSig.set(inst + '/' + r.key, sigOf(r.data)); continue; }
        reportPlanLimit(one.error);
        throw one.error;
      }
      ok.push(...((one.data ?? []) as any[]));
    }
    data = ok as any; error = null;
  }
  if (error) {
    if (isRlsDenied(error)) { for (const r of rows) docSig.set(inst + '/' + r.key, sigOf(r.data)); return undefined; }
    reportPlanLimit(error);
    throw error;
  }
  let latest: string | undefined;
  for (const r of (data ?? []) as any[]) {
    const row = rows.find((x) => x.key === r.key);
    if (row) docSig.set(inst + '/' + r.key, sigOf(row.data));
    if (!latest || String(r.updated_at) > latest) latest = String(r.updated_at);
  }
  for (const r of rows) if (!docSig.has(inst + '/' + r.key) || docSig.get(inst + '/' + r.key) !== sigOf(r.data)) docSig.set(inst + '/' + r.key, sigOf(r.data));
  return latest;
}

/** Escuta o documento da escola (Realtime) e volta a ler; se o Realtime falhar, verifica de 30 em 30 s. */
export function listenSchoolDoc(inst: string, onDoc: (d: SchoolDoc) => void, onError: (e: unknown) => void, opts: { withUsers?: boolean } = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const refresh = async () => {
    try {
      const d = await loadSchoolDoc(inst, opts);
      if (!stopped && d) onDoc(d);
    } catch (e) { if (!stopped) onError(e); }
  };
  const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 400); };
  const channel = supabase.channel(`docs-${inst}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'institution_docs', filter: `institution_id=eq.${inst}` }, later)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { if (poll) { clearInterval(poll); poll = null; } }
      else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !poll && !stopped) poll = setInterval(refresh, 30000);
    });
  return () => { stopped = true; if (timer) clearTimeout(timer); if (poll) clearInterval(poll); void supabase.removeChannel(channel); };
}

// ---------------------------------------------------------------------------
// Acesso personalizado por utilizador (user_access)
// ---------------------------------------------------------------------------

/** Admin: mapa {uid → acesso} de toda a escola. Restantes: só o seu registo (a RLS filtra). */
export async function loadAccessMap(inst: string, onlyUid?: string): Promise<Record<string, any>> {
  let q = supabase.from('user_access').select('user_id,sections').eq('institution_id', inst);
  if (onlyUid) q = q.eq('user_id', onlyUid);
  const { data, error } = await q;
  if (error) throw error;
  const out: Record<string, any> = {};
  for (const r of data ?? []) out[r.user_id] = { version: 1, sections: r.sections ?? {} };
  return out;
}

export async function saveAccess(inst: string, uid: string, access: { sections?: Record<string, any> } | null): Promise<void> {
  const has = !!access && Object.keys(access.sections || {}).length > 0;
  if (!has) {
    const { error } = await supabase.from('user_access').delete().eq('institution_id', inst).eq('user_id', uid);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('user_access')
    .upsert({ institution_id: inst, user_id: uid, sections: access!.sections }, { onConflict: 'institution_id,user_id' });
  if (error) throw error;
}

export function listenAccess(inst: string, onlyUid: string | undefined, onMap: (m: Record<string, any>) => void, onError: (e: unknown) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = async () => {
    try { const m = await loadAccessMap(inst, onlyUid); if (!stopped) onMap(m); } catch (e) { if (!stopped) onError(e); }
  };
  const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 300); };
  const channel = supabase.channel(`acc-${inst}-${onlyUid ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_access', filter: `institution_id=eq.${inst}` }, later)
    .subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
  void refresh();
  return () => { stopped = true; if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
}

// ---------------------------------------------------------------------------
// Projecções individuais (aluno / encarregado)
// ---------------------------------------------------------------------------

export async function loadProjection(inst: string, uid: string): Promise<any | null> {
  const { data, error } = await supabase.from('user_projections').select('data').eq('institution_id', inst).eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

export function listenProjection(inst: string, uid: string, onData: (d: any) => void, onError: (e: unknown) => void): () => void {
  let stopped = false;
  const refresh = async () => {
    try { const d = await loadProjection(inst, uid); if (!stopped && d) onData(d); } catch (e) { if (!stopped) onError(e); }
  };
  const channel = supabase.channel(`proj-${inst}-${uid}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_projections', filter: `user_id=eq.${uid}` }, () => { void refresh(); })
    .subscribe();
  return () => { stopped = true; void supabase.removeChannel(channel); };
}

/** Equipa de gestão: grava as projecções (uma linha por utilizador), em lotes. */
export async function saveProjections(inst: string, byUid: Record<string, any>): Promise<void> {
  const rows = Object.entries(byUid).map(([user_id, data]) => ({ institution_id: inst, user_id, data }));
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('user_projections').upsert(rows.slice(i, i + 50), { onConflict: 'institution_id,user_id' });
    if (error) throw error;
  }
}

/** Professor/gestão: refresca nas projecções do aluno/encarregado as notas e faltas alteradas. */
export async function refreshPortalProjections(studentIds: string[], classIds: string[], extras = false): Promise<void> {
  const { error } = await supabase.rpc('refresh_portal_projections', { p_student_ids: studentIds, p_class_ids: classIds, p_extras: extras });
  if (error) throw error;
}

/** Aluno: envia o boletim ao encarregado (grava no registo e nas projecções do aluno e do encarregado). */
export async function studentSendBoletim(studentId: string): Promise<void> {
  const { error } = await supabase.rpc('student_send_boletim', { p_student_id: studentId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Anos lectivos públicos + Pré-Matrícula online
// ---------------------------------------------------------------------------

export async function fetchPublicYears(inst: string): Promise<{ current?: string; years?: string[] } | null> {
  const { data, error } = await supabase.rpc('get_public_academic_years', { p_inst: inst });
  if (error) throw error;
  return (data as any) ?? null;
}

export async function savePublicYears(inst: string, current: string, years: string[]): Promise<void> {
  const { error } = await supabase.from('public_academic_years')
    .upsert({ institution_id: inst, current_year: current, years, updated_at: new Date().toISOString() }, { onConflict: 'institution_id' });
  if (error) throw error;
}

export async function fetchAdmissionConfig(inst: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.rpc('get_public_admission_config', { p_inst: inst });
  if (error) throw error;
  return ((data as any) ?? {}) as Record<string, any>;
}

/** Equipa: grava o estado do link (substitui o objecto inteiro). */
export async function saveAdmissionConfig(inst: string, cfg: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('public_admission_config')
    .upsert({ institution_id: inst, data: cfg, updated_at: new Date().toISOString() }, { onConflict: 'institution_id' });
  if (error) throw error;
}

/** Candidato (sem sessão): uma única chamada que valida tudo no servidor. */
export async function submitAdmission(inst: string, request: any, statusKey: string, status: any, indexKeys: string[]): Promise<void> {
  const { error } = await supabase.rpc('public_admission_submit', {
    p_inst: inst, p_request: request, p_status_key: statusKey, p_status: status, p_index_keys: indexKeys
  });
  if (error) throw error;
}

export async function lookupAdmissionStatus(inst: string, indexKey: string): Promise<any | null> {
  const { data, error } = await supabase.rpc('public_admission_lookup', { p_inst: inst, p_ix: indexKey });
  if (error) throw error;
  return data ?? null;
}

/** Equipa: publica (ou actualiza) o registo de estado e os seus índices de consulta. */
export async function writeAdmissionStatus(inst: string, key: string, rec: any, indexKeys: string[]): Promise<void> {
  const rows = [
    { institution_id: inst, key, data: rec, updated_at: new Date().toISOString() },
    ...indexKeys.map((ix) => ({ institution_id: inst, key: ix, data: { rk: key }, updated_at: new Date().toISOString() }))
  ];
  const { error } = await supabase.from('public_admission_status').upsert(rows, { onConflict: 'institution_id,key' });
  if (error) throw error;
}

export async function removeAdmissionStatus(inst: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await supabase.from('public_admission_status').delete().eq('institution_id', inst).in('key', keys);
  if (error) throw error;
}

export async function countAdmissionRequests(inst: string): Promise<number> {
  const { count, error } = await supabase.from('public_admission_requests')
    .select('id', { count: 'exact', head: true }).eq('institution_id', inst);
  if (error) throw error;
  return count ?? 0;
}

/** Pedidos pendentes por ordem de chegada; `afterId` + `limit` para importar por fases. */
export async function listAdmissionRequests(inst: string, opts: { afterId?: string; limit?: number } = {}): Promise<Record<string, any>> {
  let q = supabase.from('public_admission_requests').select('id,data,created_at').eq('institution_id', inst).order('id', { ascending: true });
  if (opts.afterId) q = q.gt('id', opts.afterId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  const out: Record<string, any> = {};
  for (const r of data ?? []) out[r.id] = r.data;
  return out;
}

export async function deleteAdmissionRequest(inst: string, id: string): Promise<void> {
  const { error } = await supabase.from('public_admission_requests').delete().eq('institution_id', inst).eq('id', id);
  if (error) throw error;
}

// Reclamações
export async function submitComplaint(inst: string, rk: string, data: any): Promise<void> {
  const { error } = await supabase.rpc('public_admission_complaint_submit', { p_inst: inst, p_rk: rk, p_data: data });
  if (error) throw error;
}
export async function getComplaintPublic(inst: string, rk: string): Promise<any | null> {
  const { data, error } = await supabase.rpc('public_admission_complaint_get', { p_inst: inst, p_rk: rk });
  if (error) throw error;
  return data ?? null;
}
export async function listComplaints(inst: string): Promise<Record<string, any>> {
  const { data, error } = await supabase.from('public_admission_complaints').select('id,data').eq('institution_id', inst);
  if (error) throw error;
  const out: Record<string, any> = {};
  for (const r of data ?? []) out[r.id] = r.data;
  return out;
}
/** Junta `patch` ao conteúdo actual (a reclamação do candidato nunca é substituída, só acrescentada). */
export async function patchComplaint(inst: string, id: string, patch: Record<string, any>): Promise<void> {
  const { data, error } = await supabase.from('public_admission_complaints').select('data').eq('institution_id', inst).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Reclamação inexistente');
  const next: Record<string, any> = { ...(data.data as object), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];   // null = apagar o campo (como no Firebase)
  const { error: ue } = await supabase.from('public_admission_complaints')
    .update({ data: next }).eq('institution_id', inst).eq('id', id);
  if (ue) throw ue;
}
export async function deleteComplaint(inst: string, id: string): Promise<void> {
  const { error } = await supabase.from('public_admission_complaints').delete().eq('institution_id', inst).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Transferências entre escolas + lista de escolas
// ---------------------------------------------------------------------------

export async function listInstitutionsRpc(): Promise<Array<{ id: string; name: string; created_at: string }>> {
  const { data, error } = await supabase.rpc('list_institutions');
  if (error) throw error;
  return (data ?? []) as any[];
}

/** Envia (ou reenvia, enquanto pendente) um pedido de transferência para a escola de destino. */
export async function sendTransfer(fromInst: string, toInst: string, request: any): Promise<void> {
  const { error } = await supabase.from('institution_transfers').upsert({
    to_institution_id: toInst, id: request.id, from_institution_id: fromInst, status: 'pendente', data: request
  }, { onConflict: 'to_institution_id,id' });
  if (error) throw error;
}

export async function listIncomingTransfers(ownInst: string): Promise<any[]> {
  const { data, error } = await supabase.from('institution_transfers').select('data,status').eq('to_institution_id', ownInst);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...(r.data as object), status: r.status }));
}

/** Origem: decisão tomada pela escola de destino nos pedidos que esta escola enviou (RLS it_select já o permite). */
export async function listSentTransfers(ownInst: string): Promise<Array<{ id: string; status: string; decidedBy?: string; decidedAt?: string; decisionNote?: string }>> {
  const { data, error } = await supabase.from('institution_transfers').select('id,status,data').eq('from_institution_id', ownInst);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, status: r.status, decidedBy: r.data?.decidedBy, decidedAt: r.data?.decidedAt, decisionNote: r.data?.decisionNote
  }));
}

export function listenIncomingTransfers(ownInst: string, onList: (l: any[]) => void, onError: (e: unknown) => void): () => void {
  let stopped = false;
  const refresh = async () => { try { const l = await listIncomingTransfers(ownInst); if (!stopped) onList(l); } catch (e) { if (!stopped) onError(e); } };
  const channel = supabase.channel(`tr-${ownInst}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'institution_transfers', filter: `to_institution_id=eq.${ownInst}` }, () => { void refresh(); })
    .subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
  void refresh();
  return () => { stopped = true; void supabase.removeChannel(channel); };
}

/** Destino: regista a decisão (ou a conclusão). Só estes campos podem mudar (gatilho guard_transfer). */
export async function patchTransfer(ownInst: string, id: string, patch: Record<string, any>): Promise<void> {
  const { data, error } = await supabase.from('institution_transfers').select('data').eq('to_institution_id', ownInst).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Pedido inexistente');
  const next: Record<string, any> = { ...(data.data as object), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];   // null = apagar o campo (como no Firebase)
  const { error: ue } = await supabase.from('institution_transfers').update({ data: next, status: next.status }).eq('to_institution_id', ownInst).eq('id', id);
  if (ue) throw ue;
}

// ---------------------------------------------------------------------------
// Contas (Edge Functions — o cliente nunca cria nem apaga contas directamente)
// ---------------------------------------------------------------------------

async function fnError(error: any, fallback: string): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) { reportPlanLimit(body.error); return String(body.error); }
  } catch { /* ignora */ }
  return error?.message || fallback;
}

export async function createAccountViaServer(a: {
  email: string; password: string; name: string; role: string; phone?: string; username?: string; processNumber?: string;
  linkedStudentId?: string; linkedTeacherId?: string; linkedFuncionarioId?: string; avatar?: string; roleTitle?: string;
}, expectInstitutionId?: string): Promise<{ success: boolean; uid?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('create-user', { body: a });
  if (error) return { success: false, error: await fnError(error, 'Não foi possível criar a conta.') };
  const id = (data as any)?.id;
  if (!id) return { success: false, error: (data as any)?.error || 'Não foi possível criar a conta.' };

  // Confirmação: a conta tem de ter ficado na escola em que o administrador está a trabalhar.
  // Uma função `create-user` publicada antes da migração 0024 cria sempre na escola mãe (e não devolve `institutionId`).
  const gotInst = (data as any)?.institutionId as string | undefined;
  if (expectInstitutionId && gotInst !== expectInstitutionId) {
    const stale = !gotInst;
    // Só desfaz se a conta ficou noutra escola (ou se a função é antiga e o administrador está numa filial).
    await supabase.functions.invoke('delete-user', { body: { id } }).catch(() => {});
    return {
      success: false,
      error: stale
        ? 'A função «create-user» publicada no Supabase está desatualizada e criaria a conta na escola mãe. Publique-a de novo (supabase functions deploy create-user delete-user) e repita. A conta não foi criada.'
        : 'A conta ficaria registada noutra escola do grupo. A operação foi anulada.'
    };
  }
  return { success: true, uid: id };
}

export async function deleteAccountViaServer(uid: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('delete-user', { body: { id: uid } });
  if (error) return { success: false, error: await fnError(error, 'Não foi possível eliminar a conta.') };
  return (data as any)?.ok ? { success: true } : { success: false, error: (data as any)?.error || 'Não foi possível eliminar a conta.' };
}

// ---------------------------------------------------------------------------
// Plano (teste de 30 dias → pendente até pagar). O bloqueio real é feito pela base de dados (migração 0013).
// ---------------------------------------------------------------------------
export interface MyPlan {
  status: 'trial' | 'pago' | 'pendente'; active: boolean; daysLeft: number | null; paidUntil: string | null;
  paidDaysLeft: number | null; trialEndsAt: string | null; schoolName: string;
  /** Plano expirado mas dentro dos dias de tolerância dados pelo Admin Master (migração 0020). */
  inGrace?: boolean; graceUntil?: string | null; graceDaysLeft?: number | null;
}

export async function getMyPlan(): Promise<MyPlan | null> {
  const { data, error } = await supabase.rpc('my_plan');
  if (error || !data) return null;
  return data as MyPlan;
}

// ---------------------------------------------------------------------------
// Plano e Subscrição (Configurações) — migração 0020. Só admin/diretor recebem dados.
// ---------------------------------------------------------------------------
export type SubscriptionPhase = 'trial' | 'pago' | 'tolerancia' | 'expirada';

export interface MySubscription {
  schoolName: string;
  phase: SubscriptionPhase;
  active: boolean;
  activatedAt: string | null;
  createdAt: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  /** Fim do período em vigor (teste, plano pago ou tolerância). */
  expiresAt: string | null;
  planEndedAt: string | null;
  graceUntil: string | null;
  graceNote: string | null;
  plan: { name: string; cycle: string; priceKz: number; trialDays: number } | null;
  /** null = ilimitado */
  limits: { students: number | null; users: number | null; storageBytes: number | null };
  usage: { students: number; users: number; storageBytes: number; dbBytes: number; filesBytes: number };
  /** Consumo de cada escola do grupo (mãe + filiais); só tem mais de uma linha quando há filiais (migração 0025). */
  breakdown?: Array<{ id: string; name: string; isMother: boolean; students: number; users: number; storageBytes: number }>;
  blocked: { students: boolean; users: boolean; storage: boolean };
  serverTime: string;
}

export async function getMySubscription(): Promise<MySubscription | null> {
  const { data, error } = await supabase.rpc('my_subscription');
  if (error || !data) return null;
  return data as MySubscription;
}

export interface SupportReply { by: 'escola' | 'plataforma'; name: string; at: string; text: string }
export interface SupportTicket {
  id: string; subject: string; message: string | null; priority: 'baixa' | 'media' | 'alta';
  status: 'aberto' | 'em_curso' | 'fechado'; origin: 'plataforma' | 'escola';
  replies: SupportReply[]; createdAt: string; updatedAt: string; unread: boolean;
}

export async function getMySupportTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase.rpc('my_support_tickets');
  if (error || !Array.isArray(data)) return [];
  return data as SupportTicket[];
}
export async function markSupportTicketSeen(id: string): Promise<void> {
  await supabase.rpc('my_ticket_seen', { p_id: id });
}
export async function replySupportTicket(id: string, text: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('my_ticket_reply', { p_id: id, p_text: text });
  return error ? { success: false, error: error.message } : { success: true };
}
export async function createSupportTicket(subject: string, message: string, priority: 'baixa' | 'media' | 'alta'): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc('my_ticket_create', { p_subject: subject, p_message: message, p_priority: priority });
  return error ? { success: false, error: error.message } : { success: true };
}
