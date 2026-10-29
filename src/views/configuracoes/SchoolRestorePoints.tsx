import { zipBackupFile, zipFileName } from '../../utils/backupCompress';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import { dbService } from '../../services/db';
import { showOperationSuccess } from '../../context/OperationContext';

import {
  RESTORE_CONFIRM_WORD, SchoolBackupApiError, backupFileName, createBackupApi, describeRestoreSummary,
  formatBackupSize, friendlyBackupError, purgeLocalSchoolCache, saveFile,
  type ExportProgress, type ProgressStatus, type RestoreProgress
} from '../../utils/schoolBackupApi';
import {
  BACKUP_FORMATS, BACKUP_FORMAT_ORDER, isBackupFormat, serializeBackup,
  type BackupFormat
} from '../../utils/backupFormats';
import { loadXlsx } from '../../utils/xlsxSafe';
import {
  BACKUP_ACCEPT, analyzeBackupSources, buildTableItems, buildTablesPayload, isTableLoadable, readBackupSources,
  type Analysis, type PreviewTable
} from '../../utils/backupImport';
import { Notice } from '../../components/Notice';

interface Props {
  /** Só o administrador descarrega/restaura (a base de dados volta a verificar). */
  isAdmin: boolean;
}

const PREVIEW_ROWS = 200;
/** Chave da aba "Todos" (resumo de todas as tabelas, com seleção). */
const ALL_KEY = '__todos__';
const TABLE_ICON: Record<PreviewTable['kind'], string> = {
  registos: 'table_rows', documentos: 'description', prematricula_config: 'tune', prematriculas: 'how_to_reg', referencia: 'lock'
};

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' }); } catch { return iso; }
};

const STATUS_TEXT: Record<ProgressStatus, string> = {
  pendente: 'Pendente', 'a enviar': 'A enviar', 'a aplicar': 'A aplicar', concluida: 'Concluída', erro: 'Erro'
};

/** Barra de progresso global + uma barra por tabela (envio → aplicação). */
const ProgressPanel: React.FC<{ progress: RestoreProgress }> = ({ progress }) => (
  <div className="flex flex-col gap-2" data-testid="restore-progress" aria-live="polite">
    <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-slate-700">
      <span className="truncate">{progress.message}</span>
      <span className="font-mono shrink-0">{progress.percent}%</span>
    </div>
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}
      className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
      <div className="h-full rounded-full bg-[#0b1f3a] transition-all duration-300" style={{ width: `${progress.percent}%` }} />
    </div>
    {progress.tables.length > 0 && (
      <ul className="text-[11px] text-slate-700 border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100" data-testid="restore-progress-tables">
        {progress.tables.map((t) => {
          const pct = t.status === 'concluida' ? 100 : t.status === 'a aplicar' && t.total ? Math.min(100, Math.round(((t.applied ?? 0) / t.total) * 100)) : t.total ? Math.min(100, Math.round((t.sent / t.total) * 100)) : t.status === 'pendente' ? 0 : 100;
          const color = t.status === 'erro' ? 'bg-red-600' : t.status === 'concluida' ? 'bg-emerald-600' : t.status === 'a aplicar' ? 'bg-amber-500' : 'bg-blue-600';
          return (
            <li key={t.key} className="px-3 py-1.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <strong className="truncate">{t.label}</strong>
                <span className="font-mono shrink-0 text-slate-500">{t.status === 'concluida' || t.status === 'pendente' ? `${t.total}` : t.status === 'a aplicar' ? `${t.applied ?? 0}/${t.total}` : `${t.sent}/${t.total}`} · {STATUS_TEXT[t.status]}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

/**
 * Configurações → Segurança & Backups → Cópias de Segurança & Restauro.
 *   • "Baixar backup": um ficheiro .json com todos os dados da escola.
 *   • "Carregar backup": o mesmo ficheiro volta a entrar e substitui os dados da escola (tudo ou nada) —
 *     serve para repor uma versão anterior (downgrade) ou recuperar dados.
 * Antes de restaurar, descarrega-se automaticamente o estado actual (para poder desfazer).
 * Tudo corre no Supabase (funções SQL da migração 0012): sem Storage, cron nem Edge Function.
 */
export const SchoolRestorePoints: React.FC<Props> = ({ isAdmin }) => {
  const api = useMemo(() => createBackupApi((fn, args) => supabase.rpc(fn, args)), []);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** Tabelas marcadas para importar (chaves de PreviewTable). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipErrors, setSkipErrors] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<BackupFormat>('json');
  const [confirming, setConfirming] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');
  const [progress, setProgress] = useState<RestoreProgress | null>(null);

  // Sucesso → diálogo global (carregamento → visto animado), igual ao login/pagamentos; o texto vai como pormenor.
  // Erros continuam na faixa vermelha do painel.
  const say = (kind: 'ok' | 'err', text: string) => {
    if (kind === 'ok') { setNotice(null); void showOperationSuccess('Operação feita com sucesso!', { details: text, minDuration: 0 }); }
    else setNotice({ kind, text });
  };

  const audit = (action: string, details: string) => {
    try {
      dbService.addAuditLog({
        userName: dbService.getDatabase().currentUser?.name || 'Administrador',
        userRole: dbService.getDatabase().currentUser?.roleTitle || 'Administrador Geral',
        action, details, module: 'sistema', timestamp: 'Agora mesmo', badgeColor: '#0b1f3a'
      });
    } catch { /* a auditoria do servidor permanece */ }
  };

  const schoolName = () => dbService.getDatabase().settings?.schoolName || 'escola';

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label); setNotice(null);
    try { return await fn(); }
    catch (e) { say('err', friendlyBackupError(e)); return undefined; }
    finally { setBusy(null); }
  }, []);

  /** Exporta em lotes (com progresso); se a migração 0033 não existir, usa a exportação antiga numa só chamada. */
  const exportAny = async (onProgress: (p: ExportProgress) => void) => {
    try { return await api.exportBackupChunked(onProgress); }
    catch (e) {
      if (String((e as any)?.code) === 'PGRST202' || /Could not find the function/i.test(String((e as any)?.message))) {
        onProgress({ message: 'A descarregar o backup…', percent: 50 });
        return await api.exportBackup();
      }
      throw e;
    }
  };

  // ---------- Baixar ----------
  const handleDownload = async () => {
    const fmt = downloadFormat;
    setProgress({ phase: 'seguranca', percent: 0, message: 'A preparar o backup…', tables: [] });
    const r = await run('A preparar o backup…', async () => {
      const exp = await exportAny((p) => setProgress({ phase: 'seguranca', percent: p.percent, message: p.message, tables: [] }));
      return { exp, file: await serializeBackup(exp.payload, fmt, loadXlsx) };
    });
    setProgress(null);
    if (!r) return;
    const inner = backupFileName(r.exp.info.schoolName || schoolName(), new Date(), undefined, r.file.ext);
    // Compacta em .zip (o ficheiro de dentro mantém o formato escolhido). Se a compressão falhar, guarda o ficheiro simples.
    let name = inner; let bytes = r.file.bytes;
    const zipped = await run('A comprimir o backup…', async () => {
      setProgress({ phase: 'seguranca', percent: 100, message: 'A comprimir o backup (.zip)…', tables: [] });
      try { return await zipBackupFile(inner, r.file.data); } catch { return null; }
    });
    setProgress(null);
    if (zipped) { name = zipFileName(inner); bytes = zipped.length; saveFile(name, zipped, 'application/zip'); }
    else saveFile(name, r.file.data, r.file.mime);
    audit('Backup da Escola Descarregado', `Ficheiro ${name} (${formatBackupSize(bytes)}) com ${r.exp.info.counts.records} registos.`);
    say('ok', `Backup guardado: ${name} (${formatBackupSize(bytes)}${zipped ? `, comprimido de ${formatBackupSize(r.file.bytes)}` : ''}). Guarde-o num local seguro: contém dados pessoais dos alunos e funcionários.`);
  };

  // ---------- Carregar ----------
  const clearLoaded = () => {
    setAnalysis(null); setActiveKey(null); setSkipErrors(false); setSelected(new Set());
    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePick = async (list: FileList | null) => {
    setAnalysis(null); setActiveKey(null); setSkipErrors(false); setSelected(new Set()); setNotice(null);
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    const a = await run('A ler os ficheiros…', async () => {
      const sources = await readBackupSources(files, loadXlsx);
      return analyzeBackupSources(sources, dbService.activeInstitutionId);
    });
    if (!a) return;
    setAnalysis(a);
    setActiveKey(a.tables.length ? ALL_KEY : null);
    if (!a.tables.length) say('err', a.globalIssues.map((i) => i.message).join(' ') || 'Nenhum ficheiro de backup válido.');
  };

  const isAll = activeKey === ALL_KEY;
  const active = isAll ? null : analysis?.tables.find((t) => t.key === activeKey) ?? null;
  const loadable = useMemo(() => (analysis?.tables ?? []).filter(isTableLoadable), [analysis]);
  const selectedTables = useMemo(() => (analysis?.tables ?? []).filter((t) => selected.has(t.key) && isTableLoadable(t)), [analysis, selected]);
  const selectedRecords = selectedTables.reduce((n, t) => n + t.count, 0);
  const needSkip = selectedTables.some((t) => t.errorRows > 0);
  const errRowsSelected = selectedTables.reduce((n, t) => n + t.errorRows, 0);
  const canLoadTable = selectedTables.length > 0 && (!needSkip || skipErrors) && !busy;

  const toggleTable = (t: PreviewTable) => {
    if (!isTableLoadable(t)) return;
    setSelected((prev) => { const n = new Set(prev); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; });
  };
  const selectAll = () => setSelected(new Set(loadable.map((t) => t.key)));
  const selectNone = () => setSelected(new Set());
  const allSelected = loadable.length > 0 && loadable.every((t) => selected.has(t.key));

  const closeConfirm = () => { setConfirming(false); setConfirmWord(''); };
  const canRestore = canLoadTable && confirmWord === RESTORE_CONFIRM_WORD;

  const handleRestore = async () => {
    if (!analysis || !canRestore) return;
    const chosen = selectedTables.map((t) => ({ key: t.key, label: t.label, count: t.count }));
    const labels = chosen.map((t) => t.label).join(', ');
    const pending = chosen.map((t) => ({ key: t.key, label: t.label, total: t.count, sent: 0, status: 'pendente' as ProgressStatus }));
    // 1) Ponto de segurança: descarrega o estado ACTUAL (em lotes, com progresso). Se falhar, não se restaura.
    setProgress({ phase: 'seguranca', percent: 0, message: 'A guardar o estado actual (ponto de segurança)…', tables: pending });
    const safety = await run('A guardar o estado actual (ponto de segurança)…', async () => {
      const cur = await exportAny((p) => setProgress({ phase: 'seguranca', percent: p.percent, message: `Ponto de segurança: ${p.message}`, tables: pending }));
      const inner = backupFileName(cur.info.schoolName || schoolName(), new Date(), 'antes-do-restauro');
      // A cópia de segurança é sempre JSON (formato completo), comprimido em .zip. Se a compressão falhar, guarda-se o JSON simples:
      // o ponto de segurança nunca pode faltar.
      setProgress({ phase: 'seguranca', percent: 99, message: 'Ponto de segurança: a comprimir (.zip)…', tables: pending });
      let name = inner;
      try {
        const z = await zipBackupFile(inner, cur.text);
        name = zipFileName(inner);
        saveFile(name, z, 'application/zip');
      } catch { saveFile(inner, cur.text, BACKUP_FORMATS.json.mime); }
      return { name, payload: cur.payload };
    });
    if (!safety) { setProgress(null); return; }
    // 2) Só as tabelas escolhidas são substituídas, uma a uma, depois de tudo estar enviado ao servidor.
    const result = await run('A restaurar… (não feche esta página)', async () => {
      const built = buildTableItems(analysis, chosen.map((t) => t.key), skipErrors);
      try {
        const r = await api.restoreTablesChunked(built.tables, confirmWord, setProgress, analysis.info?.exportedAt);
        return { built, summary: r, legacy: false as const };
      } catch (e) {
        const msg = String((e as any)?.message ?? '');
        const missing = String((e as any)?.code) === 'PGRST202' || /Could not find the function/i.test(msg);
        if (missing && /school_restore_begin/i.test(msg)) {
          // Migração 0033 em falta: o restauro numa só chamada serve para backups pequenos.
          if (built.loaded > 3000) throw new SchoolBackupApiError('migration', 'A migração 0033 ainda não foi aplicada no Supabase (restauro em lotes). Cole o ficheiro supabase/migrations/0033_backup_restore_chunked.sql no SQL Editor do Supabase e clique em Run. Nada foi alterado.');
          setProgress({ phase: 'aplicacao', percent: 50, message: 'A restaurar numa só chamada…', tables: [] });
          const payload = buildTablesPayload(safety.payload, analysis, chosen.map((t) => t.key), skipErrors).payload;
          return { built, summary: await api.restoreBackup(payload, confirmWord), legacy: true as const };
        }
        const applied: string[] = (e as any)?.appliedTables ?? [];
        if (applied.length || (e as any)?.failedTable) {
          const failed = (e as any)?.failedTable as string | undefined;
          throw new SchoolBackupApiError('partial',
            `${failed ? `Falhou na tabela “${failed}”. ` : ''}${friendlyBackupError(e)} ` +
            `${applied.length ? `Já foram aplicadas: ${applied.join(', ')}. ` : 'Nenhuma tabela foi alterada. '}` +
            `As restantes não foram tocadas. Para desfazer, carregue o ficheiro ${safety.name}.`);
        }
        throw e;
      }
    });
    if (!result) { setProgress((p) => (p && p.phase !== 'fim' ? { ...p, message: 'Restauro interrompido' } : p)); return; }      // erro já mostrado
    closeConfirm(); clearLoaded();
    const what = chosen.length === 1 ? `Tabela "${labels}"` : `${chosen.length} tabelas (${labels})`;
    const detail = result.legacy
      ? describeRestoreSummary(result.summary as any)
      : `Restaurado: ${(result.summary as any).applied} registo(s).${(result.summary as any).invoicesKept ? ` ${(result.summary as any).invoicesKept} factura(s) existente(s) ficaram como estavam (ligadas a pagamentos).` : ''}${(result.summary as any).ignored ? ` ${(result.summary as any).ignored} registo(s) de módulos desconhecidos foram ignorados.` : ''}`;
    say('ok', `${what} carregada(s): ${result.built.loaded} registo(s)${result.built.skipped ? `, ${result.built.skipped} com erro ignorado(s)` : ''}. ${detail} O estado anterior ficou guardado em ${safety.name}. A recarregar…`);
    audit('Restauro de Tabelas a partir de Backup', `Tabelas ${labels} (${result.built.loaded} registos) carregadas de ${analysis.sources.filter((x) => x.payload).map((x) => x.name).join(', ')}; estado anterior guardado em ${safety.name}.`);
    // A cópia local está desactualizada: apaga-a e recarrega a app a partir da nuvem.
    await purgeLocalSchoolCache(dbService.activeInstitutionId);
    setTimeout(() => window.location.reload(), 4500);   // dá tempo de ler a confirmação antes de recarregar
  };

  const tabBase = (isActive: boolean) => `flex items-center gap-2 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
    isActive ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-[#0b1f3a]'
  }`;

  const allTab = (
    <button key={ALL_KEY} type="button" role="tab" aria-selected={isAll} data-testid="backup-tab-todos"
      onClick={() => setActiveKey(ALL_KEY)} className={tabBase(isAll) + ' px-4'}>
      <span className="material-symbols-outlined text-[18px]">select_all</span>
      <span>Todos</span>
      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{analysis?.tables.length ?? 0}</span>
      {selected.size > 0 && <span className="font-mono text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded" title="Tabelas seleccionadas">{selected.size} sel.</span>}
    </button>
  );

  const tabBtn = (t: PreviewTable) => {
    const ok = isTableLoadable(t);
    const checked = selected.has(t.key);
    return (
      <div key={t.key} className={`flex items-center shrink-0 border-b-2 ${t.key === activeKey ? 'border-[#0b1f3a]' : 'border-transparent'}`}>
        <input type="checkbox" checked={checked} disabled={!ok || !!busy} onChange={() => toggleTable(t)}
          aria-label={`Importar a tabela ${t.label}`} data-testid={`backup-select-${t.label}`}
          title={ok ? 'Seleccionar para importar' : 'Esta tabela não pode ser carregada'}
          className="ml-3 h-4 w-4 cursor-pointer accent-[#0b1f3a] disabled:cursor-not-allowed disabled:opacity-40" />
        <button
          type="button" role="tab" aria-selected={t.key === activeKey} data-testid={`backup-tab-${t.label}`}
          onClick={() => { setActiveKey(t.key); }}
          className={tabBase(false).replace('border-b-2', 'border-b-0') + (t.key === activeKey ? ' text-[#0b1f3a]' : '')}
        >
          <span className="material-symbols-outlined text-[18px]">{TABLE_ICON[t.kind]}</span>
          <span>{t.label}</span>
          <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{t.count}</span>
          {t.errorRows > 0 && <span className="font-mono text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded" title="Linhas com erro">{t.errorRows}</span>}
          {t.errorRows === 0 && t.issues.length > 0 && <span className="material-symbols-outlined text-[16px] text-amber-600" title="Avisos">warning</span>}
        </button>
      </div>
    );
  };

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4" data-testid="school-restore-points">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">2. Backup e Restauração</h3>
      </div>

      {!isAdmin && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">Só o administrador da escola descarrega e restaura backups.</p>}

      {isAdmin && (
        <>
          {progress && !confirming && <ProgressPanel progress={progress} />}
          {notice && <Notice tone={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Notice>}
          {busy && <div className="text-xs text-slate-500" aria-live="polite">{busy}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-600 uppercase">Baixar</span>
              <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-600">
                Tipo de ficheiro
                           <select value={downloadFormat} disabled={!!busy} onChange={(e) => isBackupFormat(e.target.value) && setDownloadFormat(e.target.value)}
                  data-testid="backup-download-format" className="p-2 text-xs border border-slate-300 rounded-lg bg-white font-normal text-slate-800">
                  {BACKUP_FORMAT_ORDER.map((f) => <option key={f} value={f}>{BACKUP_FORMATS[f].label} ({BACKUP_FORMATS[f].ext})</option>)}
                </select>
              </label>
              <div>
                <button type="button" disabled={!!busy} onClick={handleDownload} className="px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Baixar backup (.zip com {BACKUP_FORMATS[downloadFormat].ext})
                </button>
              </div>
              <span className="text-[11px] text-amber-1500">O ficheiro não está cifrado e tem dados pessoais: guarde-o num local seguro.</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-600 uppercase">Carregar</span>
              <input ref={fileRef} type="file" multiple accept={BACKUP_ACCEPT} disabled={!!busy} data-testid="backup-restore-files"
                onChange={(e) => handlePick(e.target.files)} className="text-xs" />
              {analysis && (
                <div className="text-[11px] text-slate-700 bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-0.5" data-testid="loaded-backup-info">
                  <span><strong>{analysis.info?.schoolName || 'Escola'}</strong> · {analysis.sources.filter((x) => x.payload).length} de {analysis.sources.length} ficheiro(s) lido(s)</span>
                  {analysis.info && <span>Criado em {fmtDate(analysis.info.exportedAt)}</span>}
                  <span>{analysis.errors} erro(s) · {analysis.warnings} aviso(s)</span>
                </div>
              )}
              <div>
                <button type="button" disabled={!analysis || !!busy} onClick={clearLoaded} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                  Limpar
                </button>
              </div>
            </div>
          </div>

          {analysis && (
            <div className="flex flex-col gap-3" data-testid="backup-preview">
              {analysis.sources.length > 0 && (
                <ul className="text-[11px] flex flex-col gap-1">
                  {analysis.sources.map((f, i) => (
                    <li key={i} className={`flex items-center gap-1.5 ${f.error ? 'text-red-700' : 'text-slate-700'}`}>
                      <span className="material-symbols-outlined text-[14px]">{f.error ? 'error' : 'check_circle'}</span>
                      <span className="font-mono">{f.origin ? `${f.origin} › ` : ''}{f.name}</span>
                      <span className="text-slate-400">({formatBackupSize(f.size)})</span>
                      {f.error && <span>— {f.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {analysis.globalIssues.filter((i) => !analysis.sources.some((x) => x.error && i.message.includes(x.name))).map((i, k) => (
                <div key={k} role={i.severity === 'erro' ? 'alert' : 'status'} className={`text-xs rounded-lg p-2 border ${i.severity === 'erro' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>{i.message}</div>
              ))}

              {analysis.tables.length > 0 && (
                <>
                  <div className="flex border-b border-slate-200 overflow-x-auto" role="tablist">{allTab}{analysis.tables.map(tabBtn)}</div>

                  {isAll && (
                    <div className="flex flex-col gap-3" data-testid="backup-all-tables">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={allSelected ? selectNone : selectAll} disabled={!!busy || !loadable.length} data-testid="backup-select-all"
                          className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px]">{allSelected ? 'deselect' : 'select_all'}</span>
                          {allSelected ? 'Desmarcar todas' : `Seleccionar todas (${loadable.length})`}
                        </button>
                        <span className="text-[11px] text-slate-500">Marque as tabelas que quer importar para o sistema (ou use a caixa em cada aba).</span>
                      </div>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold text-[11px]">
                              <th className="py-2 px-3 w-8"></th>
                              <th className="py-2 px-3">Tabela</th>
                              <th className="py-2 px-3 text-right">Registos</th>
                              <th className="py-2 px-3 text-right">Com erro</th>
                              <th className="py-2 px-3">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.tables.map((t) => {
                              const ok = isTableLoadable(t);
                              return (
                                <tr key={t.key} onClick={() => toggleTable(t)} className={`border-t border-slate-100 ${ok ? 'cursor-pointer hover:bg-slate-50' : 'opacity-60'} ${selected.has(t.key) ? 'bg-emerald-50' : ''}`}>
                                  <td className="py-1.5 px-3"><input type="checkbox" checked={selected.has(t.key)} disabled={!ok || !!busy} onChange={() => toggleTable(t)} onClick={(e) => e.stopPropagation()} aria-label={`Importar a tabela ${t.label}`} className="h-4 w-4 cursor-pointer accent-[#0b1f3a] disabled:cursor-not-allowed" /></td>
                                  <td className="py-1.5 px-3 font-bold text-slate-800"><span className="material-symbols-outlined text-[16px] align-middle mr-1.5 text-slate-500">{TABLE_ICON[t.kind]}</span>{t.label}</td>
                                  <td className="py-1.5 px-3 text-right font-mono">{t.count}</td>
                                  <td className={`py-1.5 px-3 text-right font-mono ${t.errorRows ? 'text-red-700 font-bold' : 'text-slate-400'}`}>{t.errorRows}</td>
                                  <td className="py-1.5 px-3 text-[11px] text-slate-600">{!t.restorable ? 'Só consulta' : !ok ? 'Com erros — não carregável' : t.errorRows ? 'Linhas com erro' : t.issues.length ? 'Com avisos' : 'OK'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {active && (
                    <div className="flex flex-col gap-3" data-testid="backup-active-table">
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold text-[11px]">
                              <th className="py-2 px-3 w-8"></th>
                              {active.columns.map((c) => <th key={c} className="py-2 px-3 whitespace-nowrap">{c}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {active.rows.slice(0, PREVIEW_ROWS).map((r, i) => {
                              const hasErr = r.issues.some((x) => x.severity === 'erro');
                              return (
                                <tr key={i} className={`border-t border-slate-100 ${hasErr ? 'bg-red-50' : r.issues.length ? 'bg-amber-50' : ''}`}>
                                  <td className="py-1.5 px-3">
                                    {r.issues.length > 0 && <span className={`material-symbols-outlined text-[16px] ${hasErr ? 'text-red-600' : 'text-amber-600'}`} title={r.issues.map((x) => x.message).join('\n')}>{hasErr ? 'error' : 'warning'}</span>}
                                  </td>
                                  {r.cells.map((c, j) => <td key={j} className="py-1.5 px-3 text-slate-700 max-w-[220px] truncate">{c}</td>)}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {active.count > PREVIEW_ROWS && <span className="text-[11px] text-slate-500">A mostrar as primeiras {PREVIEW_ROWS} de {active.count} linhas (todas são verificadas e carregadas).</span>}

                      {active.issues.length > 0 && (
                        <div className="border border-slate-200 rounded-xl p-3 flex flex-col gap-1 max-h-48 overflow-y-auto" data-testid="backup-issues">
                          <span className="text-[11px] font-bold text-slate-700 uppercase">Verificação de dados</span>
                          {active.issues.map((i, k) => (
                            <span key={k} className={`text-[11px] ${i.severity === 'erro' ? 'text-red-700' : 'text-amber-800'}`}>
                              <strong>{i.severity === 'erro' ? 'Erro' : 'Aviso'}</strong>{i.rowId ? ` · ${i.rowId}` : ''}: {i.message}
                            </span>
                          ))}
                        </div>
                      )}

                      {!active.restorable && <span className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">Esta tabela é só de consulta e nunca é carregada.</span>}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-3" data-testid="backup-load-bar">
                    {needSkip && (
                      <label className="flex items-center gap-2 text-[11px] text-slate-700">
                        <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                        Carregar só as linhas sem erro ({errRowsSelected} linha(s) com erro ficam de fora)
                      </label>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" disabled={!canLoadTable} onClick={() => setConfirming(true)} data-testid="backup-load-table"
                        className="px-3 py-2 rounded-lg bg-[#ac332b] text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px]">upload</span>
                        {selectedTables.length === 0 ? 'Seleccione tabelas para carregar'
                          : selectedTables.length === 1 ? `Carregar dados da tabela “${selectedTables[0].label}”`
                          : `Carregar ${selectedTables.length} tabelas seleccionadas`}
                      </button>
                      {selectedTables.length > 0 && <span className="text-[11px] text-slate-500">{selectedRecords} registo(s) no total</span>}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {confirming && analysis && selectedTables.length > 0 && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirmar restauro">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 flex flex-col gap-3 shadow-2xl">
            <h4 className="font-headline text-lg font-bold text-red-700">
              {selectedTables.length === 1 ? `Carregar a tabela “${selectedTables[0].label}”?` : `Carregar ${selectedTables.length} tabelas?`}
            </h4>
            <p className="text-xs text-slate-700">
              Vai substituir os dados actuais {selectedTables.length === 1 ? 'da tabela' : 'das tabelas abaixo'} pelos {selectedRecords - (skipErrors ? errRowsSelected : 0)} registo(s) do ficheiro
              (backup de <strong>{fmtDate(analysis.info?.exportedAt ?? '')}</strong>). As restantes tabelas, os pagamentos, documentos fiscais e a auditoria não são tocados.
              Antes de carregar, o estado actual é descarregado como ficheiro, para poder desfazer.
              Os outros utilizadores com a app aberta devem recarregá-la.
            </p>
            <ul className="text-[11px] text-slate-700 border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100" data-testid="backup-confirm-list">
              {selectedTables.map((t) => (
                <li key={t.key} className="flex justify-between px-3 py-1.5"><strong>{t.label}</strong><span className="font-mono">{t.count}</span></li>
              ))}
            </ul>
            <input type="text" autoComplete="off" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} placeholder={`Escreva ${RESTORE_CONFIRM_WORD} para confirmar`} className="p-2 text-xs border border-slate-300 rounded-lg font-mono" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { closeConfirm(); setProgress(null); }} disabled={!!busy} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={handleRestore} disabled={!canRestore} className="px-3 py-2 rounded-lg bg-red-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">{busy ? 'A trabalhar…' : 'Carregar'}</button>
            </div>
            {busy && !progress && <div className="text-xs text-slate-500" aria-live="polite">{busy}</div>}
            {progress && <ProgressPanel progress={progress} />}
            
          </div>
        </div>
      )}
    </section>
  );
};
