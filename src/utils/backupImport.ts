/**
 * Carregar backups: vários ficheiros (JSON, XML, XLSX, SQL, CSV) e/ou .zip → uma pré-visualização por tabela.
 *
 * Parte pura (sem React nem rede; `xlsx` e `jszip` entram por parâmetro/import dinâmico):
 *   1. `readBackupSources`   — lê cada ficheiro (ou cada ficheiro dentro de um .zip) para o objecto canónico do backup;
 *   2. `analyzeBackupSources` — junta tudo num só backup, verifica erros e anomalias e monta as tabelas
 *      (uma por colecção de registos + documentos + pré-matrículas + referência);
 *   3. `buildTablePayload`   — constrói o backup a enviar ao restauro para UMA tabela: o estado actual da escola com
 *      só essa tabela substituída pela do ficheiro (o restauro continua a ser "tudo ou nada" na base de dados).
 *
 * Erros (a linha/tabela não pode ser carregada) vs. avisos (carrega-se, mas convém rever).
 */
import { BACKUP_FORMATS, formatFromFileName, readBackupFile, type BackupFormat, type XlsxLoader } from './backupFormats';
import { MAX_BACKUP_FILE_BYTES, SchoolBackupApiError, validateBackupPayload, type BackupFileInfo } from './schoolBackupApi';

/** Extensões aceites pelo selector de ficheiros (todos os tipos do backup + .zip). */
export const BACKUP_ACCEPT = [...Object.values(BACKUP_FORMATS).map((f) => f.ext), '.zip'].join(',');

const MAX_ZIP_ENTRIES = 60;
const MAX_ZIP_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_ISSUES_PER_TABLE = 500;

export type Severity = 'erro' | 'aviso';
export interface Issue { severity: Severity; message: string; rowId?: string }

export interface SourceFile {
  name: string;
  /** Se veio de dentro de um .zip, o nome do .zip. */
  origin?: string;
  size: number;
  format: BackupFormat;
  payload?: any;
  /** Motivo pelo qual o ficheiro não foi lido (fica de fora da junção). */
  error?: string;
}

export interface InputFile { name: string; size: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }
export type ZipLoader = () => Promise<{ loadAsync(data: ArrayBuffer): Promise<any> }>;

const defaultZipLoader: ZipLoader = async () => (await import('jszip')).default as any;

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const errText = (e: unknown) => (e instanceof SchoolBackupApiError ? e.message : e instanceof Error ? e.message : 'Erro desconhecido.');

/** Lê cada ficheiro escolhido; os .zip são abertos e cada ficheiro suportado lá dentro é lido à parte. */
export async function readBackupSources(files: InputFile[], loadXlsx?: XlsxLoader, loadZip: ZipLoader = defaultZipLoader): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const readOne = async (f: InputFile, origin?: string) => {
    const format = formatFromFileName(f.name);
    const base: SourceFile = { name: f.name, origin, size: f.size, format: format ?? 'json' };
    if (!format) { out.push({ ...base, error: 'Tipo de ficheiro não suportado (aceites: JSON, XML, XLSX, SQL, CSV e ZIP).' }); return; }
    if (f.size > MAX_BACKUP_FILE_BYTES) { out.push({ ...base, error: 'Ficheiro demasiado grande.' }); return; }
    try { out.push({ ...base, payload: await readBackupFile(f, format, loadXlsx) }); }
    catch (e) { out.push({ ...base, error: errText(e) }); }
  };

  for (const f of files) {
    if (!/\.zip$/i.test(f.name)) { await readOne(f); continue; }
    let zip: any;
    try { zip = await (await loadZip()).loadAsync(await f.arrayBuffer()); }
    catch { out.push({ name: f.name, size: f.size, format: 'json', error: 'Não foi possível abrir o ficheiro ZIP (corrompido ou protegido por palavra-passe).' }); continue; }
    const entries = Object.values(zip.files as Record<string, any>)
      .filter((z) => !z.dir && !/(^|\/)(__MACOSX|\.)/.test(z.name) && !/(^|\/)\./.test(baseName(z.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > MAX_ZIP_ENTRIES) { out.push({ name: f.name, size: f.size, format: 'json', error: `O ZIP tem ficheiros a mais (máximo ${MAX_ZIP_ENTRIES}).` }); continue; }
    let total = 0; let found = 0;
    // O ZIP de "antes de eliminar" traz backup.json (completo) e backup.xlsx (só para consulta): lê-se só o JSON.
    const hasJson = entries.some((z) => baseName(z.name).toLowerCase() === 'backup.json');
    for (const z of entries) {
      const name = baseName(z.name);
      if (!formatFromFileName(name)) continue;                     // README, imagens, etc.: ignorados em silêncio
      if (hasJson && name.toLowerCase() === 'backup.xlsx') continue; // vista de consulta do mesmo backup
      found++;
      const bytes: ArrayBuffer = await z.async('arraybuffer');
      total += bytes.byteLength;
      if (total > MAX_ZIP_TOTAL_BYTES) { out.push({ name, origin: f.name, size: bytes.byteLength, format: formatFromFileName(name)!, error: 'O ZIP descomprimido é demasiado grande.' }); break; }
      await readOne({
        name, size: bytes.byteLength,
        arrayBuffer: async () => bytes,
        text: async () => new TextDecoder('utf-8').decode(bytes)
      }, f.name);
    }
    if (!found) out.push({ name: f.name, size: f.size, format: 'json', error: 'O ZIP não contém ficheiros de backup (JSON, XML, XLSX, SQL ou CSV).' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pré-visualização
// ---------------------------------------------------------------------------------------------------------------
export type TableKind = 'registos' | 'documentos' | 'prematricula_config' | 'prematriculas' | 'referencia';

export interface PreviewRow { id: string; cells: string[]; issues: Issue[] }
export interface PreviewTable {
  key: string;
  /** Nome mostrado no botão da aba (o nome da tabela). */
  label: string;
  kind: TableKind;
  count: number;
  columns: string[];
  rows: PreviewRow[];
  /** Problemas da tabela inteira (sem linha) + os das linhas. */
  issues: Issue[];
  errorRows: number;
  /** Só consulta: pagamentos e documentos fiscais nunca são restaurados. */
  restorable: boolean;
}
export interface Analysis {
  /** Backup único resultante da junção (null se nenhum ficheiro foi lido). */
  payload: any | null;
  info: BackupFileInfo | null;
  sources: SourceFile[];
  tables: PreviewTable[];
  /** Problemas de ficheiros e da junção (fora das tabelas). */
  globalIssues: Issue[];
  errors: number;
  warnings: number;
}

const ts = (s: unknown): number => { const t = Date.parse(String(s ?? '')); return Number.isFinite(t) ? t : -Infinity; };
const validDate = (s: unknown) => s === null || s === undefined || s === '' || Number.isFinite(Date.parse(String(s)));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const same = (a: unknown, b: unknown) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const shorten = (v: unknown, n = 60): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : Array.isArray(v) ? `[${v.length}]` : '{…}';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** Junta os backups lidos num só. Com um só ficheiro, devolve-o tal e qual. */
function mergePayloads(sources: SourceFile[], globalIssues: Issue[], dup: Map<string, string>): any | null {
  const ok = sources.filter((s) => s.payload);
  if (!ok.length) return null;
  const label = (s: SourceFile) => (s.origin ? `${s.origin} › ${s.name}` : s.name);

  const recKey = (r: any) => `${r.collection}\u0001${r.id}`;
  const records = new Map<string, any>(); const recFrom = new Map<string, SourceFile>();
  const docs = new Map<string, any>(); const docFrom = new Map<string, SourceFile>();
  const reqs = new Map<string, any>(); const reqFrom = new Map<string, SourceFile>();

  const put = (map: Map<string, any>, from: Map<string, SourceFile>, key: string, item: any, src: SourceFile, stamp: (x: any) => unknown, what: string) => {
    const prev = map.get(key);
    if (!prev) { map.set(key, item); from.set(key, src); return; }
    if (same(prev, item)) return;                                   // igual: nada a assinalar
    const newer = ts(stamp(item)) >= ts(stamp(prev));
    const prevSrc = from.get(key)!;
    dup.set(what, `Repetido em "${label(prevSrc)}" e "${label(src)}" com conteúdos diferentes: ficou o mais recente (${label(newer ? src : prevSrc)}).`);
    if (newer) { map.set(key, item); from.set(key, src); }
  };

  let latest = ok[0];
  let config: any = null; let configAt = -Infinity;
  const archive = { payments: [] as any[], fiscalDocuments: [] as any[], fiscalSeries: [] as any[] };
  const archSeen = new Set<string>();
  for (const s of ok) {
    const p = s.payload;
    if (ts(p.exportedAt) >= ts(latest.payload.exportedAt)) latest = s;
    for (const r of arr(p.records)) put(records, recFrom, recKey(r), r, s, (x) => x.updated_at, recKey(r));
    for (const d of arr(p.docs)) put(docs, docFrom, String(d.key), d, s, (x) => x.updated_at, `doc\u0001${d.key}`);
    for (const q of arr(p.publicAdmissionRequests)) put(reqs, reqFrom, String(q.id), q, s, (x) => x.created_at, `req\u0001${q.id}`);
    if (isObj(p.publicAdmissionConfig) && ts(p.exportedAt) >= configAt) { config = p.publicAdmissionConfig; configAt = ts(p.exportedAt); }
    for (const k of ['payments', 'fiscalDocuments', 'fiscalSeries'] as const) {
      for (const x of arr(p.archive?.[k])) { const sig = k + JSON.stringify(x); if (!archSeen.has(sig)) { archSeen.add(sig); archive[k].push(x); } }
    }
  }
  if (ok.length === 1) return ok[0].payload;

  const ids = new Set(ok.map((s) => String(s.payload.institutionId ?? '')));
  if (ids.size > 1) globalIssues.push({ severity: 'erro', message: 'Os ficheiros pertencem a escolas diferentes e não podem ser juntos.' });
  const lp = latest.payload;
  return {
    format: lp.format, formatVersion: lp.formatVersion, institutionId: lp.institutionId, schoolName: lp.schoolName, exportedAt: lp.exportedAt,
    records: [...records.values()], docs: [...docs.values()], publicAdmissionConfig: config,
    publicAdmissionRequests: [...reqs.values()], archive
  };
}

const REFS: Record<string, { coll: string; label: string }> = {
  studentId: { coll: 'students', label: 'aluno' },
  classId: { coll: 'classes', label: 'turma' },
  teacherId: { coll: 'teachers', label: 'professor' }
};
const STUDENT_STATUS = ['active', 'pending', 'transferred', 'suspended'];
const INVOICE_STATUS = ['pago', 'atraso', 'pendente', 'isento'];
const YEAR_RE = /^\d{4}([/-]\d{2,4})?$/;

/** Colunas mais comuns entre os campos simples de `data`. */
function pickColumns(rows: any[]): string[] {
  const freq = new Map<string, number>();
  for (const r of rows.slice(0, 200)) {
    if (!isObj(r.data)) continue;
    for (const [k, v] of Object.entries(r.data)) {
      if (v !== null && typeof v === 'object') continue;
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  const pref = ['name', 'nome', 'title', 'titulo', 'status', 'className', 'classId', 'studentId', 'period', 'date', 'amount'];
  return [...freq.entries()]
    .sort((a, b) => (pref.indexOf(a[0]) === -1 ? 99 : pref.indexOf(a[0])) - (pref.indexOf(b[0]) === -1 ? 99 : pref.indexOf(b[0])) || b[1] - a[1])
    .slice(0, 5).map(([k]) => k);
}

function capIssues(list: Issue[]): Issue[] {
  if (list.length <= MAX_ISSUES_PER_TABLE) return list;
  const extra = list.length - MAX_ISSUES_PER_TABLE;
  return [...list.slice(0, MAX_ISSUES_PER_TABLE), { severity: 'aviso', message: `… e mais ${extra} problema(s) não listados.` }];
}

function finish(t: Omit<PreviewTable, 'errorRows' | 'issues'> & { tableIssues: Issue[] }): PreviewTable {
  const all: Issue[] = [...t.tableIssues];
  let errorRows = 0;
  for (const r of t.rows) { if (r.issues.some((i) => i.severity === 'erro')) errorRows++; all.push(...r.issues.map((i) => ({ ...i, rowId: r.id }))); }
  const { tableIssues, ...rest } = t;
  return { ...rest, issues: capIssues(all), errorRows };
}

export function analyzeBackupSources(input: SourceFile[], expectedInstitutionId?: string): Analysis {
  const globalIssues: Issue[] = [];
  const sources = input.map((s) => ({ ...s }));
  // 1) cada ficheiro tem de ser um backup válido (estrutura + escola)
  for (const s of sources) {
    if (!s.payload) continue;
    try { s.payload = validateBackupPayload(s.payload, expectedInstitutionId).payload; }
    catch (e) { s.error = errText(e); s.payload = undefined; }
    // Avisos do Excel legível (valores cortados, campos que não vêm no Excel…): mostram-se e não seguem para o restauro.
    if (s.payload && Array.isArray(s.payload.__notes)) {
      for (const n of s.payload.__notes) globalIssues.push({ severity: 'aviso', message: `${s.origin ? `${s.origin} › ` : ''}${s.name}: ${n}` });
      delete s.payload.__notes;
    }
  }
  const okCount = sources.filter((s) => s.payload).length;
  for (const s of sources) {
    if (s.error) globalIssues.push({ severity: okCount ? 'aviso' : 'erro', message: `${s.origin ? `${s.origin} › ` : ''}${s.name}: ${s.error}${okCount ? ' (ficheiro ignorado)' : ''}` });
  }

  // 2) junção
  const dup = new Map<string, string>();
  const payload = mergePayloads(sources, globalIssues, dup);
  if (!payload) return { payload: null, info: null, sources, tables: [], globalIssues, errors: globalIssues.filter((i) => i.severity === 'erro').length, warnings: globalIssues.filter((i) => i.severity === 'aviso').length };

  const { info } = validateBackupPayload(payload);
  const records: any[] = arr(payload.records);
  const byColl = new Map<string, any[]>();
  for (const r of records) {
    const c = String(r?.collection ?? '');
    if (!byColl.has(c)) byColl.set(c, []);
    byColl.get(c)!.push(r);
  }
  const idsOf = (coll: string): Set<string> | null => (byColl.has(coll) ? new Set(byColl.get(coll)!.map((r) => String(r.id))) : null);
  const studentNames = new Map<string, string>((byColl.get('students') ?? []).map((r) => [String(r.id), norm(r.data?.name)]));
  const refIds: Record<string, Set<string> | null> = {};
  for (const k of Object.keys(REFS)) refIds[k] = idsOf(REFS[k].coll);

  const tables: PreviewTable[] = [];

  // 3) tabelas de registos
  for (const [coll, rows] of [...byColl.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt'))) {
    const columns = pickColumns(rows);
    const tableIssues: Issue[] = [];
    if (!coll) tableIssues.push({ severity: 'erro', message: 'Há registos sem nome de tabela (collection).' });
    const prows: PreviewRow[] = rows.map((r) => {
      const id = String(r.id ?? '');
      const issues: Issue[] = [];
      const err = (m: string) => issues.push({ severity: 'erro', message: m });
      const warn = (m: string) => issues.push({ severity: 'aviso', message: m });
      if (!id) err('Registo sem id.');
      if (!isObj(r.data)) err('O conteúdo (data) não é um objecto.');
      if (r.ord !== null && r.ord !== undefined && !Number.isFinite(Number(r.ord))) err('"ord" não é um número.');
      if (r.version !== null && r.version !== undefined && !Number.isInteger(Number(r.version))) err('"version" não é um número inteiro.');
      if (!validDate(r.created_at)) warn(`Data de criação inválida ("${shorten(r.created_at, 30)}").`);
      if (!validDate(r.updated_at)) warn(`Data de actualização inválida ("${shorten(r.updated_at, 30)}").`);
      else if (validDate(r.created_at) && r.created_at && r.updated_at && ts(r.updated_at) < ts(r.created_at)) warn('Actualizado antes de ter sido criado.');
      if (r.academic_year && !YEAR_RE.test(String(r.academic_year))) warn(`Ano lectivo com formato estranho ("${shorten(r.academic_year, 20)}").`);
      const d: Record<string, any> = isObj(r.data) ? (r.data as Record<string, any>) : {};
      if (d.id !== undefined && id && String(d.id) !== id) warn(`O id do registo (${id}) é diferente do id guardado no conteúdo (${shorten(d.id, 30)}).`);
      const dupMsg = dup.get(`${coll}\u0001${id}`); if (dupMsg) warn(dupMsg);

      // combinações entre tabelas
      for (const [field, ref] of Object.entries(REFS)) {
        const v = d[field];
        if (typeof v !== 'string' || !v || coll === ref.coll) continue;
        const known = refIds[field];
        if (known && !known.has(v)) warn(`Refere ${ref.label} "${v}" (${field}) que não existe na tabela ${ref.coll} do ficheiro.`);
      }
      if (coll === 'students') {
        if (typeof d.name !== 'string' || !d.name.trim()) warn('Aluno sem nome.');
        if (d.status !== undefined && !STUDENT_STATUS.includes(String(d.status))) warn(`Estado do aluno desconhecido ("${shorten(d.status, 20)}").`);
      }
      if (coll === 'invoices') {
        if (d.status !== undefined && !INVOICE_STATUS.includes(String(d.status))) warn(`Estado da factura desconhecido ("${shorten(d.status, 20)}").`);
        const base = Number(d.baseAmountKz), late = Number(d.lateFeeKz), total = Number(d.totalAmountKz);
        if (Number.isFinite(base) && Number.isFinite(late) && Number.isFinite(total) && Math.abs(base + late - total) > 0.5) {
          warn(`O total (${total}) não corresponde ao valor base + multa (${base} + ${late}).`);
        }
        if (Number.isFinite(total) && total < 0) warn('Total negativo.');
        const sid = typeof d.studentId === 'string' ? d.studentId : '';
        if (sid && studentNames.has(sid) && d.studentName && norm(d.studentName) !== studentNames.get(sid)) {
          warn(`O nome na factura ("${shorten(d.studentName, 30)}") é diferente do nome do aluno ${sid}.`);
        }
      }
      return { id: id || '(sem id)', cells: [id, String(r.academic_year ?? ''), ...columns.map((c) => shorten(d[c]))], issues };
    });
    tables.push(finish({ key: `registos:${coll}`, label: coll || '(sem nome)', kind: 'registos', count: rows.length, columns: ['id', 'ano lectivo', ...columns], rows: prows, tableIssues, restorable: !!coll }));
  }

  // 4) documentos
  const docs = arr(payload.docs);
  if (docs.length) {
    const rows: PreviewRow[] = docs.map((d) => {
      const key = String(d.key ?? ''); const issues: Issue[] = [];
      if (!key) issues.push({ severity: 'erro', message: 'Documento sem chave (key).' });
      if (d.data === undefined) issues.push({ severity: 'erro', message: 'Documento sem conteúdo.' });
      if (!validDate(d.updated_at)) issues.push({ severity: 'aviso', message: `Data de actualização inválida ("${shorten(d.updated_at, 30)}").` });
      const m = dup.get(`doc\u0001${key}`); if (m) issues.push({ severity: 'aviso', message: m });
      const kind = Array.isArray(d.data) ? `lista (${d.data.length})` : isObj(d.data) ? `objecto (${Object.keys(d.data).length} campos)` : d.data === null ? 'vazio' : typeof d.data;
      return { id: key || '(sem chave)', cells: [key, String(d.updated_at ?? ''), kind], issues };
    });
    tables.push(finish({ key: 'documentos', label: 'documentos', kind: 'documentos', count: docs.length, columns: ['chave', 'actualizado', 'conteúdo'], rows, tableIssues: [], restorable: true }));
  }

  // 5) pré-matrículas
  if (isObj(payload.publicAdmissionConfig)) {
    tables.push(finish({
      key: 'prematricula_config', label: 'prematricula_config', kind: 'prematricula_config', count: 1, columns: ['campos'],
      rows: [{ id: 'config', cells: [`${Object.keys(payload.publicAdmissionConfig).length} campos`], issues: [] }], tableIssues: [], restorable: true
    }));
  }
  const reqs = arr(payload.publicAdmissionRequests);
  if (reqs.length) {
    const columns = pickColumns(reqs);
    const rows: PreviewRow[] = reqs.map((q) => {
      const id = String(q.id ?? ''); const issues: Issue[] = [];
      if (!id) issues.push({ severity: 'erro', message: 'Pré-matrícula sem id.' });
      if (!isObj(q.data)) issues.push({ severity: 'erro', message: 'O conteúdo (data) não é um objecto.' });
      if (!validDate(q.created_at)) issues.push({ severity: 'aviso', message: `Data de criação inválida ("${shorten(q.created_at, 30)}").` });
      const m = dup.get(`req\u0001${id}`); if (m) issues.push({ severity: 'aviso', message: m });
      const d: Record<string, any> = isObj(q.data) ? (q.data as Record<string, any>) : {};
      return { id: id || '(sem id)', cells: [id, String(q.created_at ?? ''), ...columns.map((c) => shorten(d[c]))], issues };
    });
    tables.push(finish({ key: 'prematriculas', label: 'prematriculas', kind: 'prematriculas', count: reqs.length, columns: ['id', 'criado', ...columns], rows, tableIssues: [], restorable: true }));
  }

  // 6) referência (só consulta)
  const refTable = (key: string, label: string, list: any[], idOf: (x: any, i: number) => string) => {
    if (!list.length) return;
    const columns = pickColumns(list.map((x) => ({ data: x })));
    const rows: PreviewRow[] = list.map((x, i) => ({ id: idOf(x, i), cells: [idOf(x, i), ...columns.map((c) => shorten(x?.[c]))], issues: isObj(x) ? [] : [{ severity: 'erro', message: 'Registo inválido.' }] }));
    tables.push(finish({ key, label, kind: 'referencia', count: list.length, columns: ['id', ...columns], rows, tableIssues: [], restorable: false }));
  };
  refTable('ref:payments', 'pagamentos', arr(payload.archive?.payments), (x, i) => String(x?.id ?? i + 1));
  refTable('ref:fiscalDocuments', 'documentos_fiscais', arr(payload.archive?.fiscalDocuments), (x, i) => String(x?.doc_no ?? i + 1));
  refTable('ref:fiscalSeries', 'series_fiscais', arr(payload.archive?.fiscalSeries), (x, i) => `${x?.doc_type ?? ''}:${x?.series ?? i + 1}`);

  let errors = globalIssues.filter((i) => i.severity === 'erro').length;
  let warnings = globalIssues.filter((i) => i.severity === 'aviso').length;
  for (const t of tables) {
    for (const i of t.issues) { if (i.severity === 'erro') errors++; else warnings++; }
  }
  return { payload, info, sources, tables, globalIssues, errors, warnings };
}

/** Uma tabela pode ser carregada se não for só de consulta e não tiver erros ao nível da tabela. */
export function isTableLoadable(t: PreviewTable): boolean {
  return t.restorable && !t.issues.some((i) => i.severity === 'erro' && i.rowId === undefined);
}

/**
 * Backup a enviar ao restauro para UMA OU VÁRIAS tabelas: parte do estado actual da escola (`current`) e troca só as
 * tabelas escolhidas pelas do ficheiro. `skipErrorRows` deixa de fora as linhas com erro. Nunca toca em
 * pagamentos/documentos fiscais. As tabelas não escolhidas ficam exactamente como estão.
 */
export function buildTablesPayload(current: any, analysis: Analysis, tableKeys: string[], skipErrorRows = false): { payload: any; loaded: number; skipped: number; tables: { key: string; label: string; loaded: number }[] } {
  if (!analysis.payload) throw new SchoolBackupApiError('invalid-backup', 'Tabela não encontrada nos ficheiros carregados.');
  const keys = [...new Set(tableKeys)];
  if (!keys.length) throw new SchoolBackupApiError('invalid-backup', 'Nenhuma tabela seleccionada.');
  const out = JSON.parse(JSON.stringify(current ?? {}));
  const src = analysis.payload;
  let loaded = 0; let skipped = 0;
  const done: { key: string; label: string; loaded: number }[] = [];

  for (const tableKey of keys) {
    const table = analysis.tables.find((t) => t.key === tableKey);
    if (!table) throw new SchoolBackupApiError('invalid-backup', 'Tabela não encontrada nos ficheiros carregados.');
    if (!table.restorable) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" é só de consulta e nunca é restaurada.`);
    if (table.issues.some((i) => i.severity === 'erro' && i.rowId === undefined)) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" tem erros e não pode ser carregada.`);
    if (table.errorRows > 0 && !skipErrorRows) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" tem linhas com erro. Corrija o ficheiro ou escolha carregar só as linhas sem erro.`);

    const bad = new Set(table.rows.filter((r) => r.issues.some((i) => i.severity === 'erro')).map((r) => r.id));
    const keep = <T,>(list: T[], idOf: (x: T) => string) => list.filter((x) => !(skipErrorRows && bad.has(idOf(x) || '(sem id)')));
    let n = 0;
    switch (table.kind) {
      case 'registos': {
        const coll = table.label;
        const mine = keep(arr(src.records).filter((r) => String(r.collection) === coll), (r) => String(r.id ?? ''));
        out.records = [...arr(out.records).filter((r) => String(r.collection) !== coll), ...mine];
        n = mine.length; break;
      }
      case 'documentos': {
        const mine = keep(arr(src.docs), (d) => String(d.key ?? ''));
        out.docs = mine; n = mine.length; break;
      }
      case 'prematricula_config':
        out.publicAdmissionConfig = src.publicAdmissionConfig; n = 1; break;
      case 'prematriculas': {
        const mine = keep(arr(src.publicAdmissionRequests), (q) => String(q.id ?? ''));
        out.publicAdmissionRequests = mine; n = mine.length; break;
      }
      default: break;
    }
    loaded += n; skipped += table.count - n;
    done.push({ key: table.key, label: table.label, loaded: n });
  }
  return { payload: out, loaded, skipped, tables: done };
}

/**
 * Para o restauro em lotes: as linhas de cada tabela escolhida, já sem as linhas com erro (se `skipErrorRows`).
 * Mesmas regras de `buildTablesPayload`, mas só com o que vai ser substituído (não precisa do estado actual da escola).
 */
export function buildTableItems(analysis: Analysis, tableKeys: string[], skipErrorRows = false): {
  tables: { key: string; label: string; kind: 'records' | 'docs' | 'requests' | 'config'; collection: string; items: any[] }[];
  loaded: number; skipped: number;
} {
  if (!analysis.payload) throw new SchoolBackupApiError('invalid-backup', 'Tabela não encontrada nos ficheiros carregados.');
  const keys = [...new Set(tableKeys)];
  if (!keys.length) throw new SchoolBackupApiError('invalid-backup', 'Nenhuma tabela seleccionada.');
  const src = analysis.payload;
  const out: { key: string; label: string; kind: 'records' | 'docs' | 'requests' | 'config'; collection: string; items: any[] }[] = [];
  let loaded = 0; let skipped = 0;
  for (const tableKey of keys) {
    const table = analysis.tables.find((t) => t.key === tableKey);
    if (!table) throw new SchoolBackupApiError('invalid-backup', 'Tabela não encontrada nos ficheiros carregados.');
    if (!table.restorable) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" é só de consulta e nunca é restaurada.`);
    if (table.issues.some((i) => i.severity === 'erro' && i.rowId === undefined)) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" tem erros e não pode ser carregada.`);
    if (table.errorRows > 0 && !skipErrorRows) throw new SchoolBackupApiError('invalid-backup', `A tabela "${table.label}" tem linhas com erro. Corrija o ficheiro ou escolha carregar só as linhas sem erro.`);
    const bad = new Set(table.rows.filter((r) => r.issues.some((i) => i.severity === 'erro')).map((r) => r.id));
    const keep = <T,>(list: T[], idOf: (x: T) => string) => list.filter((x) => !(skipErrorRows && bad.has(idOf(x) || '(sem id)')));
    let items: any[] = []; let kind: 'records' | 'docs' | 'requests' | 'config' = 'records'; let collection = '';
    switch (table.kind) {
      case 'registos': kind = 'records'; collection = table.label; items = keep(arr(src.records).filter((r) => String(r.collection) === table.label), (r) => String(r.id ?? '')); break;
      case 'documentos': kind = 'docs'; items = keep(arr(src.docs), (d) => String(d.key ?? '')); break;
      case 'prematricula_config': kind = 'config'; items = src.publicAdmissionConfig ? [src.publicAdmissionConfig] : []; break;
      case 'prematriculas': kind = 'requests'; items = keep(arr(src.publicAdmissionRequests), (q) => String(q.id ?? '')); break;
      default: continue;
    }
    loaded += items.length; skipped += table.count - items.length;
    out.push({ key: table.key, label: table.label, kind, collection, items });
  }
  return { tables: out, loaded, skipped };
}

/** Compatibilidade: uma só tabela. */
export function buildTablePayload(current: any, analysis: Analysis, tableKey: string, skipErrorRows = false): { payload: any; loaded: number; skipped: number } {
  const { payload, loaded, skipped } = buildTablesPayload(current, analysis, [tableKey], skipErrorRows);
  return { payload, loaded, skipped };
}
