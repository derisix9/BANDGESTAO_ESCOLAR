/**
 * Backup para eliminação: um .zip com o JSON completo (restaurável) e um Excel legível (uma folha por módulo).
 * `payload` é o backup que devolve `school_delete_prepare` (formato bandmed-school-backup v1, o mesmo do backup normal):
 *   { schoolName, institutionId, exportedAt, counts, records, docs, userAccess, archive: { payments, fiscalDocuments, fiscalSeries } }.
 * Continua a aceitar o formato antigo { institution_name, data: { records, institution_docs, user_access }, reference: {...} }.
 */
import type { SheetMatrix } from './xlsxSafe';

const EXCEL_CELL_MAX = 32000;   // limite do Excel: 32 767 caracteres por célula
const SHEET_BAD = /[\[\]:*?/\\]/g;

const cell = (v: unknown): string | number | boolean => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > EXCEL_CELL_MAX ? s.slice(0, EXCEL_CELL_MAX) + '…[cortado; o valor completo está no JSON]' : s;
};

function uniqueSheetName(wanted: string, used: Set<string>): string {
  const base = (wanted || 'folha').replace(SHEET_BAD, '_').slice(0, 28) || 'folha';
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 27)}_${i++}`;
  used.add(name.toLowerCase());
  return name;
}

/** Linhas já planas (tabelas de referência): todas as colunas de topo. */
function plain(rows: any[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, cell(v)])));
}

/** Linhas planas: colunas de topo do registo + as chaves de 1.º nível de `data`. */
function flatten(rows: any[], fixed: string[], dataKey = 'data'): Record<string, unknown>[] {
  const keys: string[] = [];
  const seen = new Set<string>(fixed);
  for (const r of rows) {
    const d = r?.[dataKey];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const k of Object.keys(d)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const f of fixed) o[f] = cell(r?.[f]);
    const d = r?.[dataKey];
    if (d && typeof d === 'object' && !Array.isArray(d)) for (const k of keys) o[k] = cell((d as any)[k]);
    else if (d !== undefined) o[dataKey] = cell(d);
    return o;
  });
}

export function backupZipName(schoolName: string, when = new Date()): string {
  const slug = (schoolName || 'escola').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'escola';
  const p = (n: number) => String(n).padStart(2, '0');
  return `bandmed_${slug}_antes-de-eliminar_${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}_${p(when.getHours())}${p(when.getMinutes())}.zip`;
}

/** Uniformiza o backup (formato novo ou antigo) para o que o Excel e o LEIA-ME precisam. */
export function normalizeBackupForZip(payload: any) {
  const p = payload ?? {};
  return {
    schoolName: String(p.schoolName ?? p.institution_name ?? ''),
    institutionId: String(p.institutionId ?? p.institution_id ?? ''),
    exportedAt: String(p.exportedAt ?? p.exported_at ?? ''),
    counts: (p.counts && typeof p.counts === 'object' ? p.counts : {}) as Record<string, unknown>,
    records: (p.records ?? p.data?.records ?? []) as any[],
    docs: (p.docs ?? p.data?.institution_docs ?? []) as any[],
    userAccess: (p.userAccess ?? p.data?.user_access ?? []) as any[],
    payments: (p.archive?.payments ?? p.reference?.payments ?? []) as any[],
    fiscalDocuments: (p.archive?.fiscalDocuments ?? p.reference?.fiscal_documents ?? []) as any[]
  };
}

/** Lista de objectos → matriz com cabeçalho (as chaves, pela ordem em que aparecem), como fazia o json_to_sheet. */
export function objectsToMatrix(rows: Record<string, unknown>[]): unknown[][] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))];
}

export async function buildBackupZip(payload: any): Promise<Blob> {
  const b = normalizeBackupForZip(payload);
  const [{ default: JSZip }, { xlsxLib }] = await Promise.all([import('jszip'), import('./xlsxSafe')]);

  const sheets: SheetMatrix[] = [];
  const used = new Set<string>();
  const add = (name: string, rows: Record<string, unknown>[]) => {
    sheets.push({ name: uniqueSheetName(name, used), rows: objectsToMatrix(rows.length ? rows : [{ info: 'sem dados' }]) });
  };

  // Resumo
  add('Resumo', [
    { campo: 'Escola', valor: b.schoolName },
    { campo: 'ID da escola', valor: b.institutionId },
    { campo: 'Exportado em', valor: b.exportedAt },
    ...Object.entries(b.counts).map(([k, v]) => ({ campo: `Total: ${k}`, valor: v as number }))
  ]);

  // Uma folha por colecção (módulo)
  const records: any[] = b.records;
  const byCollection = new Map<string, any[]>();
  for (const r of records) {
    const c = String(r?.collection ?? 'sem_colecao');
    if (!byCollection.has(c)) byCollection.set(c, []);
    byCollection.get(c)!.push(r);
  }
  for (const [c, rows] of [...byCollection.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    add(c, flatten(rows, ['id', 'academic_year', 'version', 'created_at', 'updated_at']));
  }
  add('documentos', flatten(b.docs, ['key', 'updated_at']));
  add('acessos', flatten(b.userAccess, ['user_id', 'updated_at'], 'sections'));
  // Só referência (não são apagados): pagamentos e documentos fiscais
  add('ref_pagamentos', plain(b.payments));
  add('ref_docs_fiscais', plain(b.fiscalDocuments));

  const xlsx: Uint8Array = await xlsxLib.write(sheets);
  const json = JSON.stringify(payload);

  const zip = new JSZip();
  zip.file('backup.json', json);
  zip.file('backup.xlsx', xlsx);
  zip.file('LEIA-ME.txt',
    `Backup da escola "${b.schoolName}" criado antes de eliminar os dados.\n` +
    `- backup.json : cópia completa (formato bandmed-school-backup), serve para restaurar em Configurações > Segurança & Backups.\n` +
    `- backup.xlsx : o mesmo conteúdo em folhas de Excel, para consulta.\n` +
    `Contém dados pessoais: guarde-o num local seguro.\n`);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (!blob.size) throw new Error('Não foi possível gerar o ficheiro ZIP do backup.');
  return blob;
}

/** Inicia o download no navegador. */
export function startDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
