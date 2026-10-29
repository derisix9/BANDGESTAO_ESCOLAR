/**
 * Supabase como destino de uma colecção por registo (alternativa ao Realtime Database do Firebase).
 * Fala o mesmo "idioma" do db.ts: mapa de registos {chave → registo} e caminhos "id" / "id/campo".
 * Quem pode ler/escrever o quê decide a base (RLS + gatilhos); este ficheiro nunca confia no papel do cliente.
 */
import { reportPlanLimit } from '../utils/planLimits';
import { supabase } from './supabase';
import { encodeKey, type RecordMap, type ShardUpdates } from '../utils/shardSync';
import { splitPatchByConflict, type FieldConflict } from '../utils/syncConflicts';
import { rowsToRecordMap, updatesToOps, applyPatch, type RecordRow } from '../utils/shardSupabase';
import { registerPayment, homologatePauta } from './supabaseData';

/** Campos que só o servidor pode alterar numa factura (gatilho guard_record_write). */
const INVOICE_PAY_FIELDS = ['status', 'totalPaidKz', 'paymentDate'] as const;

const PAGE = 1000;

/**
 * Conflito de versão (bloqueio optimista). O servidor devolve PT409 (HTTP 409); '40001' fica aceite para
 * bases ainda sem a migração 0031. NUNCA usar 40001 no servidor: o PostgREST repete essas transacções sem parar.
 */
export function isVersionConflict(e: unknown): boolean {
  const x = e as any;
  return x?.code === 'PT409' || x?.code === '40001' || x?.status === 409 || /Conflito de vers/i.test(String(x?.message ?? ''));
}

/** Corre `fn` sobre os itens com no máximo `limit` pedidos em simultâneo (não afoga a base de dados). */
async function pooled<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function currentInstitution(): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) throw new Error('Sem sessão Supabase');
  const { data, error } = await supabase.from('profiles').select('institution_id, role, active_institution_id').eq('id', uid).maybeSingle();
  if (error || !data) throw new Error('Perfil Supabase não encontrado');
  // Escola ATIVA (migração 0024): o administrador de um grupo pode estar a trabalhar numa filial.
  // Antes isto devolvia sempre a escola mãe, e por isso alunos/registos criados numa filial iam para o sítio errado
  // (ou eram recusados pela RLS) e o painel do administrador não os contava. O servidor volta a validar tudo.
  if (data.role === 'admin' && data.active_institution_id) return data.active_institution_id as string;
  return data.institution_id as string;
}
let instCache: { uid: string; inst: string } | null = null;
/** Esquece a escola em cache (chamar ao trocar de escola). */
export function resetInstitutionCache(): void {
  instCache = null;
  // Mudou a escola activa: o canal Realtime estava filtrado pela anterior — fecha e reabre para a nova.
  if (recChan) { recClose(); if (recSubs.size) void recOpen(); }
}
async function inst(): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id ?? '';
  if (instCache && instCache.uid === uid) return instCache.inst;
  const i = await currentInstitution();
  instCache = { uid, inst: i };
  return i;
}

export async function sbHasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

/** Lê a colecção toda (ou só um ano lectivo), por páginas. */
export async function sbLoad(collection: string, year?: string): Promise<RecordMap> {
  const institution = await inst();
  const rows: RecordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('records').select('id,data,ord,academic_year,version')
      .eq('institution_id', institution).eq('collection', collection)
      .order('ord', { ascending: true, nullsFirst: false }).order('id');
    // Registos antigos sem ano (academic_year NULL) continuam visíveis em vez de "desaparecerem".
    if (year) q = q.or(`academic_year.eq.${year},academic_year.is.null`);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RecordRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rowsToRecordMap(rows);
}

/** Envia o diff. Novos → INSERT; apagados → DELETE; campos → lê a linha actual, junta e grava (sem sobrepor o que outros mudaram). */
export interface PushConflictOptions {
  /** Impressão do valor que o utilizador viu, por caminho "id/campo" (o id já codificado, como nas actualizações). */
  bases?: Record<string, string>;
  /** Caminhos em que o utilizador já decidiu manter a sua versão. */
  forced?: ReadonlySet<string>;
  /** Chamado por cada campo que NÃO foi gravado porque outra pessoa o mudou para outro valor. */
  onConflict?: (c: FieldConflict & { recordId: string; record: Record<string, any> }) => void;
}

export async function sbPush(collection: string, updates: ShardUpdates, opts: PushConflictOptions = {}): Promise<void> {
  try {
    await sbPushInner(collection, updates, opts);
  } catch (e) {
    reportPlanLimit(e);   // limite do plano (alunos/armazenamento): avisa o utilizador
    throw e;
  }
}

async function sbPushInner(collection: string, updates: ShardUpdates, opts: PushConflictOptions = {}): Promise<void> {
  const institution = await inst();
  const ops = updatesToOps(updates);

  // Homologações: só pela função do servidor (assina com o utilizador autenticado, não com o que o cliente diz).
  let inserts = ops.inserts;
  if (collection === 'homologations') {
    for (const r of inserts) await homologatePauta({ ...r.data, id: r.id });
    inserts = [];
  }
  // Facturas: o estado "pago" e o valor pago nunca se escrevem à mão; entram como pendentes e o pagamento
  // é registado pela função do servidor (que soma os pagamentos e decide o estado).
  const pendingPayments: Array<{ id: string; amount: number; method: string; ref: string | null; key: string }> = [];
  if (collection === 'invoices') {
    inserts = inserts.map((r) => {
      const d = { ...r.data };
      const total = Number(d.totalAmountKz) || 0;
      const paid = d.status === 'pago' ? Number(d.totalPaidKz ?? total) : Number(d.totalPaidKz) || 0;
      if (paid > 0) pendingPayments.push({ id: r.id, amount: paid, method: String(d.method || 'outro'), ref: d.transactionNumber ? String(d.transactionNumber) : null, key: 'ins-' + r.id + '-' + paid });
      if (d.status === 'pago') d.status = 'pendente';
      delete d.totalPaidKz; delete d.paymentDate;
      return { ...r, data: d };
    });
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const batch = inserts.slice(i, i + 200).map((r) => ({ institution_id: institution, collection, ...r }));
    const { error } = await supabase.from('records').insert(batch);
    if (error) throw error;
  }
  for (const p of pendingPayments) await registerPayment(p.id, p.amount, p.method, p.ref, p.key);
  for (let i = 0; i < ops.deletes.length; i += 100) {
    const { error } = await supabase.from('records').delete()
      .eq('institution_id', institution).eq('collection', collection).in('id', ops.deletes.slice(i, i + 100));
    if (error) throw error;
  }
  const ids = Object.keys(ops.patches);
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    const { data, error } = await supabase.from('records').select('id,data,ord,academic_year,version')
      .eq('institution_id', institution).eq('collection', collection).in('id', slice);
    if (error) throw error;
    const byId = new Map((data as RecordRow[]).map((r) => [r.id, r]));
    await pooled(slice, 8, async (id) => {
      const row = byId.get(id);
      if (!row) return;   // apagado entretanto por outro utilizador: nada a alterar
      let patch = ops.patches[id];
      let payAfter: { amount: number; method: string; ref: string | null; key: string } | null = null;
      if (collection === 'invoices' && INVOICE_PAY_FIELDS.some((f) => f in patch)) {
        const before = Number(row.data?.totalPaidKz) || 0;
        const total = Number(row.data?.totalAmountKz) || 0;
        const wanted = patch.totalPaidKz !== undefined && patch.totalPaidKz !== null ? Number(patch.totalPaidKz)
          : patch.status === 'pago' ? Math.max(total, before) : before;
        if (wanted > before) {
          const m = String(patch.method ?? row.data?.method ?? 'outro');
          payAfter = { amount: wanted - before, method: m, ref: row.data?.transactionNumber ? String(row.data.transactionNumber) : null, key: 'upd-' + id + '-' + wanted };
        }
        patch = Object.fromEntries(Object.entries(patch).filter(([k]) => !(INVOICE_PAY_FIELDS as readonly string[]).includes(k)));
      }
      if (Object.keys(patch).length > 0) {
      // Bloqueio optimista: se outro envio gravou este registo entretanto (conflito PT409/409), volta a ler a versão
      // actual e reaplica SÓ as nossas alterações — em vez de falhar o envio todo e repeti-lo em tempestade.
      // Em cada leitura compara-se campo a campo com o que o utilizador viu: se outra pessoa mudou o mesmo campo
      // para outro valor, esse campo NÃO é gravado (fica como conflito para o utilizador decidir).
      const bases: Record<string, string | undefined> = {};
      const forced = new Set<string>();
      for (const f of Object.keys(patch)) {
        const key = `${encodeKey(id)}/${f}`;
        bases[f] = opts.bases?.[key];
        if (opts.forced?.has(key)) forced.add(f);
      }
      let cur: RecordRow = row;
      let lastConflicts: FieldConflict[] = [];
      for (let attempt = 0; ; attempt++) {
        const split = splitPatchByConflict(patch, cur.data || {}, bases, forced);
        lastConflicts = split.conflicts;
        if (Object.keys(split.safe).length === 0) break;   // só havia conflitos: nada a gravar
        const next = applyPatch(cur, split.safe);
        const { error: ue, count } = await supabase.from('records')
          .update({ ...next, version: cur.version }, { count: 'exact' })
          .eq('institution_id', institution).eq('collection', collection).eq('id', id);
        if (!ue) {
          if (!count) throw new Error('Sem permissão para alterar ' + collection + '/' + id);
          break;
        }
        if (!isVersionConflict(ue) || attempt >= 4) throw ue;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 150));
        const { data: fresh, error: fe } = await supabase.from('records').select('id,data,ord,academic_year,version')
          .eq('institution_id', institution).eq('collection', collection).eq('id', id).maybeSingle();
        if (fe) throw fe;
        if (!fresh) return;   // apagado entretanto
        cur = fresh as RecordRow;
      }
      for (const c of lastConflicts) opts.onConflict?.({ ...c, recordId: id, record: cur.data || {} });
      }
      if (payAfter) await registerPayment(id, payAfter.amount, payAfter.method, payAfter.ref, payAfter.key);
    });
  }
}

// ---- Realtime de `records`: UM canal por escola, partilhado por todas as colecções ----
// Antes: 1 canal por colecção (8+) com filtro só por `collection`, ou seja, escutava a colecção de
// TODAS as escolas e cada evento era validado por RLS para cada subscritor (carga enorme no Realtime).
// Agora: 1 canal com filtro `institution_id=eq.<escola>` e o evento é reencaminhado só para quem
// escuta essa colecção. (A PK de records inclui institution_id, por isso os DELETE também chegam.)
type RecListener = { later: () => void; onStatus: (status: string) => void };
const recSubs = new Map<string, Set<RecListener>>();
let recChan: ReturnType<typeof supabase.channel> | null = null;
let recStatus = 'CLOSED';
let recOpening = false;
const recAll = (fn: (l: RecListener) => void) => recSubs.forEach((set) => set.forEach(fn));

async function recOpen(): Promise<void> {
  if (recChan || recOpening || !recSubs.size) return;
  recOpening = true;
  try {
    const i = await inst();
    if (recChan || !recSubs.size) return;
    recChan = supabase.channel(`rec-${i}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `institution_id=eq.${i}` }, (p: any) => {
        const c = p?.new?.collection ?? p?.old?.collection;
        if (c) recSubs.get(c)?.forEach((l) => l.later());
        else recAll((l) => l.later());
      })
      .subscribe((status: string) => { recStatus = status; recAll((l) => l.onStatus(status)); });
  } catch {
    recAll((l) => l.onStatus('CHANNEL_ERROR'));   // sem canal: cada ouvinte cai para o polling de 30 s
  } finally {
    recOpening = false;
  }
}
function recClose(): void {
  if (recChan) { void supabase.removeChannel(recChan); recChan = null; }
  recStatus = 'CLOSED';
}

/** Escuta alterações (Realtime) e volta a ler a colecção; se o Realtime falhar, vai verificando de 30 em 30 s. */
export function sbListen(collection: string, year: string | undefined, onMap: (m: RecordMap) => void, onError: (e: unknown) => void, opts: { skipInitial?: boolean } = {}): () => void {
  // skipInitial: o chamador acabou de ler a coleção; a 1.ª subscrição não a relê (era uma 2.ª leitura completa).
  // Só vale se o canal ficar pronto em poucos segundos; se demorar, relê para não perder alterações pelo caminho.
  const createdAt = Date.now();
  let skipFirst = !!opts.skipInitial;
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null, poll: ReturnType<typeof setInterval> | null = null;
  const refresh = async () => { try { const m = await sbLoad(collection, year); if (!stopped) onMap(m); } catch (e) { if (!stopped) onError(e); } };
  const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 1000); };
  const listener: RecListener = {
    later,
    onStatus: (status) => {
      if (stopped) return;
      if (status === 'SUBSCRIBED') { if (poll) { clearInterval(poll); poll = null; } if (skipFirst) { skipFirst = false; if (Date.now() - createdAt < 3000) return; } void refresh(); }
      else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !poll) poll = setInterval(refresh, 30000);
    }
  };
  let set = recSubs.get(collection);
  if (!set) { set = new Set(); recSubs.set(collection, set); }
  set.add(listener);
  if (recChan && recStatus === 'SUBSCRIBED') listener.onStatus('SUBSCRIBED');   // canal já aberto: só lê
  else void recOpen();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    set!.delete(listener);
    if (!set!.size) recSubs.delete(collection);
    if (!recSubs.size) recClose();
  };
}

export interface PageQuery { year?: string; classId?: string; status?: string; search?: string; page?: number; pageSize?: number }

/** Uma página (por omissão 50) filtrada NO SERVIDOR — é o que os ecrãs novos devem usar em vez de carregar tudo. */
export async function sbPage(collection: string, q: PageQuery = {}): Promise<{ rows: any[]; total: number }> {
  const institution = await inst();
  const size = Math.min(Math.max(q.pageSize ?? 50, 1), 200);
  const from = Math.max(q.page ?? 0, 0) * size;
  let query = supabase.from('records').select('id,data,ord', { count: 'exact' })
    .eq('institution_id', institution).eq('collection', collection);
  if (q.year) query = query.eq('academic_year', q.year);
  if (q.classId) query = query.eq('data->>classId', q.classId);
  if (q.status) query = query.eq('data->>status', q.status);
  if (q.search?.trim()) query = query.ilike('data->>name', '%' + q.search.trim().replace(/[%_\\]/g, (c) => '\\' + c) + '%');
  const { data, error, count } = await query.order('ord', { ascending: true, nullsFirst: false }).order('id').range(from, from + size - 1);
  if (error) throw error;
  return { rows: (data ?? []).map((r: any) => ({ ...r.data, id: r.data?.id ?? r.id })), total: count ?? 0 };
}
