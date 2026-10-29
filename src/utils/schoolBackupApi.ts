/**
 * Backup e restauro da escola num ÚNICO ficheiro (JSON, XLSX, SQL ou CSV — ver backupFormats.ts), tudo pelo próprio Supabase:
 *   • descarregar: RPC `school_backup_export()`            → o navegador guarda o ficheiro;
 *   • carregar:    RPC `school_backup_restore(ficheiro, 'RESTAURAR')` → a base de dados substitui os dados da escola, tudo ou nada.
 * (migração supabase/migrations/0012_school_backup_file.sql). Parte pura: sem React; o `rpc` vem de fora.
 * A escola nunca vem do pedido: a base de dados usa a escola do administrador autenticado.
 */

export const BACKUP_FORMAT = 'bandmed-school-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_EXT = '.json';
export const RESTORE_CONFIRM_WORD = 'RESTAURAR';
/** Limite de segurança do lado do navegador (o ficheiro é lido em memória e enviado numa só chamada). */
export const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024;

export interface BackupFileInfo {
  schoolName: string;
  institutionId: string;
  exportedAt: string;
  counts: { records: number; docs: number; publicAdmissionRequests: number; payments: number; fiscalDocuments: number };
}
export interface RestoreSummary {
  records: number; recordsIgnored: number; invoicesRecreated: number; invoicesKept: number;
  docs: number; publicAdmissionRequests: number; backupExportedAt?: string | null;
}

export class SchoolBackupApiError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'SchoolBackupApiError'; }
}

/** Ponte para o Supabase: `supabase.rpc.bind(supabase)` serve. */
export type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message?: string; code?: string } | null }>;

export function formatBackupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const slug = (s: string) =>
  (s || 'escola').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'escola';
const two = (n: number) => String(n).padStart(2, '0');

/** `bandmed_<escola>_2026-10-11_1813.json` (hora local); `tag` marca "antes-do-restauro"; `ext` = .json/.xlsx/.sql/.csv. */
export function backupFileName(schoolName: string, when: Date = new Date(), tag?: string, ext: string = BACKUP_FILE_EXT): string {
  const d = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}_${two(when.getHours())}${two(when.getMinutes())}`;
  return `bandmed_${slug(schoolName)}${tag ? `_${tag}` : ''}_${d}${ext}`;
}

/** Valida um backup já em objecto (qualquer formato acaba aqui). Lança SchoolBackupApiError com código útil. */
export function validateBackupPayload(payload: any, expectedInstitutionId?: string): { payload: any; info: BackupFileInfo } {
  if (!payload || typeof payload !== 'object' || payload.format !== BACKUP_FORMAT) {
    throw new SchoolBackupApiError('invalid-backup', 'O ficheiro não é um backup válido do BandMed.');
  }
  if (!Number.isInteger(payload.formatVersion) || payload.formatVersion < 1 || payload.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new SchoolBackupApiError('invalid-backup', 'Este backup foi criado por uma versão mais recente do BandMed. Actualize a aplicação.');
  }
  if (!Array.isArray(payload.records) || !Array.isArray(payload.docs)) {
    throw new SchoolBackupApiError('invalid-backup', 'O ficheiro está incompleto ou corrompido. Nada foi alterado na escola.');
  }
  if (expectedInstitutionId && payload.institutionId !== expectedInstitutionId) {
    throw new SchoolBackupApiError('wrong-school', 'Este backup pertence a outra escola.');
  }
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    payload,
    info: {
      schoolName: String(payload.schoolName ?? ''),
      institutionId: String(payload.institutionId ?? ''),
      exportedAt: String(payload.exportedAt ?? ''),
      counts: {
        records: payload.records.length, docs: payload.docs.length,
        publicAdmissionRequests: len(payload.publicAdmissionRequests),
        payments: len(payload.archive?.payments), fiscalDocuments: len(payload.archive?.fiscalDocuments)
      }
    }
  };
}

/** Lê e valida um ficheiro de backup JSON (sem rede). */
export function parseBackupText(text: string, expectedInstitutionId?: string): { payload: any; info: BackupFileInfo } {
  let payload: any;
  try { payload = JSON.parse(text); }
  catch { throw new SchoolBackupApiError('invalid-backup', 'O ficheiro não é um backup válido do BandMed (não é JSON legível).'); }
  return validateBackupPayload(payload, expectedInstitutionId);
}

/** Mensagem em português para erros do Supabase/Postgres e do ficheiro. */
export function friendlyBackupError(e: unknown): string {
  if (e instanceof SchoolBackupApiError) return e.message;
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : '';
  const code = (e as any)?.code as string | undefined;
  if (/wrong-school/i.test(msg)) return 'Este backup pertence a outra escola. Nada foi alterado.';
  if (/invalid-backup/i.test(msg)) return 'O ficheiro não é um backup válido do BandMed (ou está corrompido). Nada foi alterado na escola.';
  if (/busy/i.test(msg) || code === '55P03') return 'Já há um restauro a decorrer nesta escola. Aguarde que termine.';
  if (code === '57014' || /statement timeout|canceling statement/i.test(msg)) {
    return 'O servidor demorou demasiado e cancelou a operação. Nada foi alterado. Peça ao responsável técnico para aumentar o limite de tempo (ver docs/BACKUPS_SUPABASE.md).';
  }
  if (code === '42501' || /Só o administrador|permission denied/i.test(msg)) return 'Sem permissão: só o administrador da escola, com sessão iniciada, descarrega e restaura backups.';
  if (/upstream request timeout|gateway time-?out|\b50[234]\b/i.test(msg)) {
    return 'O servidor demorou demasiado a responder (ou a ligação falhou). Nada foi perdido: tente de novo. Se continuar, verifique a internet.';
  }
  if (/nothing-staged/i.test(msg)) return 'A preparação do restauro expirou. Nada foi alterado nessa tabela; volte a carregar o backup.';
  if ((code === 'PGRST202' || /Could not find the function/i.test(msg)) && /school_(restore|backup_(meta|page))/i.test(msg)) {
    return 'A migração 0033 ainda não foi aplicada no Supabase (restauro em lotes). Cole o ficheiro supabase/migrations/0033_backup_restore_chunked.sql no SQL Editor do Supabase e clique em Run.';
  }
  if (code === 'PGRST202' || /Could not find the function/i.test(msg)) return 'A migração 0012 ainda não foi aplicada no Supabase (funções de backup em falta). Cole o ficheiro supabase/migrations/0012_school_backup_file.sql no SQL Editor do Supabase e clique em Run.';
  if (/failed to fetch|network/i.test(msg)) return 'Sem ligação ao Supabase. Verifique a internet e tente de novo.';
  return msg || 'Erro desconhecido.';
}

export function createBackupApi(rpc: RpcFn) {
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
    return data;
  };
  return {
    /** Todos os dados da escola do administrador, prontos para guardar em ficheiro. */
    async exportBackup(): Promise<{ payload: any; text: string; info: BackupFileInfo }> {
      const payload = await call('school_backup_export');
      const text = JSON.stringify(payload);
      return { payload, text, info: parseBackupText(text).info };
    },
    /** Substitui os dados da escola pelos do ficheiro (a base de dados volta a validar tudo). */
    async restoreBackup(payload: unknown, confirm: string): Promise<RestoreSummary> {
      return (await call('school_backup_restore', { p_payload: payload, p_confirm: confirm })) as RestoreSummary;
    },

    /**
     * Exporta a escola em páginas pequenas (migração 0033), com progresso e repetição automática.
     * O resultado tem o mesmo formato do `exportBackup` (é um backup completo).
     */
    async exportBackupChunked(onProgress?: (p: ExportProgress) => void): Promise<{ payload: any; text: string; info: BackupFileInfo }> {
      const meta = await withRetry(() => call('school_backup_meta'), APPLY_TRIES, 1500);
      const cols: { collection: string; n: number }[] = Array.isArray(meta?.collections) ? meta.collections : [];
      type Step = { label: string; kind: string; collection: string; n: number };
      const steps: Step[] = [
        ...cols.map((c) => ({ label: c.collection, kind: 'records', collection: c.collection, n: Number(c.n) || 0 })),
        { label: 'documentos', kind: 'docs', collection: '', n: Number(meta?.docs) || 0 },
        { label: 'pré-matrículas', kind: 'requests', collection: '', n: Number(meta?.publicAdmissionRequests) || 0 },
        { label: 'configuração de pré-matrícula', kind: 'config', collection: '', n: 1 },
        { label: 'pagamentos', kind: 'payments', collection: '', n: Number(meta?.payments) || 0 },
        { label: 'documentos fiscais', kind: 'fiscalDocuments', collection: '', n: Number(meta?.fiscalDocuments) || 0 },
        { label: 'séries fiscais', kind: 'fiscalSeries', collection: '', n: Number(meta?.fiscalSeries) || 0 }
      ];
      const totalRows = Math.max(1, steps.reduce((n, s) => n + Math.max(1, s.n), 0));
      let doneRows = 0;
      const got: Record<string, any[]> = {};
      const fetchAll = async (st: Step): Promise<any[]> => {
        const out: any[] = [];
        if (st.kind === 'config') {
          const r = await withRetry(() => call('school_backup_page', { p_kind: 'config', p_collection: '', p_offset: 0, p_limit: 1 }), APPLY_TRIES, 1500);
          return Array.isArray(r) ? r : [];
        }
        let offset = 0;
        for (;;) {
          const page = await withRetry(() => call('school_backup_page', { p_kind: st.kind, p_collection: st.collection, p_offset: offset, p_limit: EXPORT_PAGE_ROWS }), APPLY_TRIES, 1500);
          const rows: any[] = Array.isArray(page) ? page : [];
          out.push(...rows);
          offset += rows.length;
          doneRows += rows.length;
          onProgress?.({ message: `A ler “${st.label}” (${out.length}${st.n ? ` de ${st.n}` : ''})`, percent: Math.min(99, Math.round((doneRows / totalRows) * 100)) });
          if (rows.length < EXPORT_PAGE_ROWS) break;
        }
        return out;
      };
      for (const st of steps) {
        onProgress?.({ message: `A ler “${st.label}”…`, percent: Math.min(99, Math.round((doneRows / totalRows) * 100)) });
        const rows = await fetchAll(st);
        got[`${st.kind}:${st.collection}`] = rows;
        if (st.n === 0 || st.kind === 'config') doneRows += 1;
      }
      const records = cols.flatMap((c) => got[`records:${c.collection}`] ?? []);
      const cfg = (got['config:'] ?? [])[0] ?? null;
      const payload = {
        format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION,
        institutionId: meta?.institutionId, schoolName: meta?.schoolName, exportedAt: meta?.exportedAt,
        counts: {
          records: records.length, docs: (got['docs:'] ?? []).length, publicAdmissionRequests: (got['requests:'] ?? []).length,
          payments: (got['payments:'] ?? []).length, fiscalDocuments: (got['fiscalDocuments:'] ?? []).length
        },
        records, docs: got['docs:'] ?? [],
        publicAdmissionConfig: cfg, publicAdmissionRequests: got['requests:'] ?? [],
        archive: { payments: got['payments:'] ?? [], fiscalDocuments: got['fiscalDocuments:'] ?? [], fiscalSeries: got['fiscalSeries:'] ?? [] }
      };
      onProgress?.({ message: 'A montar o ficheiro…', percent: 100 });
      const text = JSON.stringify(payload);
      return { payload, text, info: parseBackupText(text).info };
    },

    /**
     * Restauro em lotes: (1) envia cada tabela para uma área de preparação, em lotes pequenos;
     * (2) só depois substitui as tabelas, uma a uma. Se o envio falhar, a escola não é tocada.
     */
    async restoreTablesChunked(
      tables: StagedTable[], confirm: string, onProgress: (p: RestoreProgress) => void, backupExportedAt?: string | null
    ): Promise<{ applied: number; ignored: number; invoicesRecreated: number; invoicesKept: number; appliedTables: string[] }> {
      const prog: TableProgress[] = tables.map((t) => ({ key: t.key, label: t.label, total: t.items.length, sent: 0, status: 'pendente' }));
      const emit = (phase: RestoreProgress['phase'], message: string) => onProgress({ phase, message, percent: overallPercent(prog), tables: prog.map((t) => ({ ...t })) });
      emit('envio', 'A abrir a sessão de restauro…');
      const session = (await withRetry(() => call('school_restore_begin', { p_confirm: confirm }), APPLY_TRIES, 1500)) as string;

      // 1) Envio (não toca nos dados vivos)
      const batchCounts: number[] = []; const splitCounts: number[][] = [];
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i]; const pt = prog[i];
        pt.status = 'a enviar'; emit('envio', `A enviar “${t.label}”…`);
        const batches = splitIntoBatches(t.items);
        batchCounts.push(batches.length); splitCounts.push(batches.map((x) => x.length));
        for (let b = 0; b < batches.length; b++) {
          await withRetry(() => call('school_restore_stage', { p_session: session, p_kind: t.kind, p_collection: t.collection, p_seq: b, p_items: batches[b] }), APPLY_TRIES, 1500);
          pt.sent += batches[b].length;
          emit('envio', `A enviar “${t.label}” (${pt.sent} de ${pt.total})`);
        }
      }

      // 2) Aplicação, tabela a tabela. Migração 0034: cada tabela é aplicada em lotes pequenos (prepare → apply_batch → complete),
      //    todos repetíveis sem risco; se a 0034 não estiver aplicada, usa a função única da 0033.
      let applied = 0; let ignored = 0; let invoicesRecreated = 0; let invoicesKept = 0;
      const appliedTables: string[] = [];
      let batched = true;
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i]; const pt = prog[i];
        pt.status = 'a aplicar'; pt.applied = 0; emit('aplicacao', `A aplicar “${t.label}”…`);
        try {
          if (batched) {
            try {
              await withRetry(() => call('school_restore_prepare', { p_session: session, p_kind: t.kind, p_collection: t.collection }), APPLY_TRIES, 1500);
            } catch (e) {
              if (isMissingFunction(e, 'school_restore_prepare')) batched = false; else throw e;
            }
          }
          if (batched) {
            const n = batchCounts[i];
            for (let b = 0; b < n; b++) {
              const r = await withRetry(() => call('school_restore_apply_batch', { p_session: session, p_kind: t.kind, p_collection: t.collection, p_seq: b }), APPLY_TRIES, 1500);
              applied += Number(r?.applied) || 0; ignored += Number(r?.ignored) || 0;
              invoicesRecreated += Number(r?.invoicesRecreated) || 0; invoicesKept += Number(r?.invoicesKept) || 0;
              pt.applied = Math.min(pt.total, (pt.applied ?? 0) + (splitCounts[i][b] ?? 0));
              emit('aplicacao', `A aplicar “${t.label}” (lote ${b + 1} de ${n})`);
            }
            await withRetry(() => call('school_restore_complete', { p_session: session, p_kind: t.kind, p_collection: t.collection }), APPLY_TRIES, 1500);
          } else {
            const r = await withRetry((attempt) =>
              call('school_restore_apply', { p_session: session, p_kind: t.kind, p_collection: t.collection })
                .catch((e) => { if (attempt > 1 && /nothing-staged/i.test(String(e?.message))) return { applied: pt.total, ignored: 0 }; throw e; }), APPLY_TRIES, 1500);
            applied += Number(r?.applied) || 0; ignored += Number(r?.ignored) || 0;
            invoicesRecreated += Number(r?.invoicesRecreated) || 0; invoicesKept += Number(r?.invoicesKept) || 0;
          }
          pt.status = 'concluida'; pt.applied = pt.total; appliedTables.push(t.label);
          emit('aplicacao', `“${t.label}” concluída`);
        } catch (e) {
          pt.status = 'erro'; emit('aplicacao', `Erro em “${t.label}”`);
          throw Object.assign(e instanceof Error ? e : new Error(String((e as any)?.message ?? e)), { appliedTables, failedTable: t.label });
        }
      }
      await withRetry(() => call('school_restore_finish', { p_session: session, p_summary: { records: applied, tables: appliedTables, backupExportedAt: backupExportedAt ?? null } }));
      emit('fim', 'Restauro concluído');
      return { applied, ignored, invoicesRecreated, invoicesKept, appliedTables };
    }
  };
}


// ---------------------------------------------------------------------------------------------
// Backup / restauro EM LOTES (migração 0033): pedidos pequenos + progresso por tabela.
// ---------------------------------------------------------------------------------------------

/** Tamanho máximo de um lote enviado ao servidor (texto JSON) e número máximo de linhas por lote. */
export const CHUNK_MAX_BYTES = 900_000;
export const CHUNK_MAX_ROWS = 250;
/** Linhas pedidas por página na exportação (fotos grandes → páginas mais pequenas). */
export const EXPORT_PAGE_ROWS = 150;

/** Divide uma lista em lotes pequenos (por nº de linhas e por tamanho aproximado). Sempre devolve pelo menos um lote. */
export function splitIntoBatches<T>(items: T[], maxBytes = CHUNK_MAX_BYTES, maxRows = CHUNK_MAX_ROWS): T[][] {
  const out: T[][] = [];
  let cur: T[] = []; let bytes = 0;
  for (const it of items) {
    const size = JSON.stringify(it)?.length ?? 2;
    if (cur.length && (cur.length >= maxRows || bytes + size > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it); bytes += size;
  }
  if (cur.length || !out.length) out.push(cur);
  return out;
}

export type ProgressStatus = 'pendente' | 'a enviar' | 'a aplicar' | 'concluida' | 'erro';
export interface TableProgress { key: string; label: string; total: number; sent: number; status: ProgressStatus; /** linhas já aplicadas (restauro em lotes, migração 0034) */ applied?: number }
export interface RestoreProgress {
  phase: 'seguranca' | 'envio' | 'aplicacao' | 'fim';
  /** 0..100, global. */
  percent: number;
  message: string;
  tables: TableProgress[];
}

/** Percentagem global: envio vale 60% e aplicação 40% do trabalho de cada tabela (pesado pelas linhas). */
export function overallPercent(tables: TableProgress[]): number {
  const weight = (t: TableProgress) => Math.max(1, t.total);
  const sum = tables.reduce((n, t) => n + weight(t), 0);
  if (!sum) return 0;
  let done = 0;
  for (const t of tables) {
    const frac = t.total ? Math.min(1, t.sent / t.total) : (t.status === 'pendente' || t.status === 'a enviar' ? 0 : 1);
    const part = t.status === 'concluida' ? 1 : t.status === 'a aplicar' ? 0.6 + 0.4 * (t.total ? Math.min(1, (t.applied ?? 0) / t.total) : 0) : t.status === 'erro' ? 0.6 * frac : 0.6 * frac;
    done += part * weight(t);
  }
  return Math.max(0, Math.min(100, Math.round((done / sum) * 100)));
}

/** Tentativas por pedido no restauro (com espera crescente): o servidor lento ou a ligação instável não devem falhar o restauro. */
export const APPLY_TRIES = 6;

/** A função RPC ainda não existe no Supabase (migração por aplicar). */
export function isMissingFunction(e: unknown, fn: string): boolean {
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : '';
  const code = String((e as any)?.code ?? '');
  return (code === 'PGRST202' || /Could not find the function/i.test(msg)) && msg.includes(fn);
}

/** Erros que valem a pena repetir (ligação instável, tempo esgotado do gateway). */
export function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : '';
  const code = String((e as any)?.code ?? '');
  if (code === '57014') return false;       // o servidor cancelou por tempo: repetir não ajuda
  if (code === '55P03' || /\bbusy\b/i.test(msg)) return true;   // o pedido anterior ainda está a terminar no servidor
  return /failed to fetch|network|load failed|upstream request timeout|gateway|timeout|timed out|ERR_|\b50[234]\b|fetch/i.test(msg);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, tries = 4, baseMs = 800, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      last = e;
      if (attempt >= tries || !isTransientError(e)) throw e;
      await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
  throw last;
}

export interface StagedTable {
  key: string; label: string;
  kind: 'records' | 'docs' | 'requests' | 'config';
  collection: string;
  items: any[];
}
export interface ExportProgress { message: string; percent: number }

/** Texto curto para mostrar o resultado de um restauro. */
export function describeRestoreSummary(s: RestoreSummary): string {
  let t = `Restaurado: ${s.records} registos e ${s.docs} documentos da escola.`;
  if (s.invoicesRecreated) t += ` ${s.invoicesRecreated} factura(s) em falta foram recriadas.`;
  if (s.invoicesKept) t += ` ${s.invoicesKept} factura(s) existente(s) ficaram como estavam (ligadas a pagamentos).`;
  if (s.recordsIgnored > 0) t += ` ${s.recordsIgnored} registo(s) de módulos desconhecidos foram ignorados.`;
  return t;
}

/** Guarda um ficheiro (texto ou binário) no computador do utilizador. */
export function saveFile(name: string, data: string | Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Compatibilidade: guarda texto como JSON. */
export function saveTextFile(name: string, text: string): void { saveFile(name, text, 'application/json'); }

/**
 * Depois de um restauro a cópia guardada neste navegador (localStorage/IndexedDB) está desactualizada.
 * Apaga-a para a app voltar a ler a nuvem e nunca reenviar dados antigos por cima do restauro.
 * (Esvazia o IndexedDB em vez de o apagar: apagar fica pendente enquanto a página o mantém aberto.)
 */
export async function purgeLocalSchoolCache(
  institutionId: string,
  storage: Pick<Storage, 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
  idb: Pick<IDBFactory, 'open'> | null = typeof indexedDB !== 'undefined' ? indexedDB : null
): Promise<void> {
  try {
    storage?.removeItem('escola_inst_' + institutionId);
    storage?.removeItem('escola_access_map_' + institutionId);
    if (institutionId === 'inst_bandmed') storage?.removeItem('bandmed_escola_db_v1');
  } catch { /* sem localStorage */ }
  if (!idb) return;
  await new Promise<void>((resolve) => {
    try {
      const open = idb.open('bandmed_school_db', 1);
      open.onerror = () => resolve();
      open.onsuccess = () => {
        try {
          const db = open.result;
          if (!db.objectStoreNames.contains('school_database')) { db.close(); resolve(); return; }
          const tx = db.transaction('school_database', 'readwrite');
          tx.objectStore('school_database').clear();
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); resolve(); };
        } catch { resolve(); }
      };
    } catch { resolve(); }
  });
}
