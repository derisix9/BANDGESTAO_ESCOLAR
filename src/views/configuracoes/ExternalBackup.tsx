import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import { dbService } from '../../services/db';
import {
  DRIVE_CHANNEL, DRIVE_STORAGE_KEY, RETENTION_OPTIONS, S3_PRESETS, createExternalBackupApi, describeTarget,
  formatSize, friendlyExternalError, hourLabel, presetForEndpoint,
  type DestinationStatus, type ExternalProvider, type InvokeFn
} from '../../utils/externalBackupApi';
import { TablePagination, usePagedList } from '../../components/TablePagination';

import { showOperationSuccess, beginOperationLoading, cancelOperationLoading } from '../../context/OperationContext';
import { Notice } from '../../components/Notice';

interface Props { isAdmin: boolean }

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return String(iso); }
};

const invoke: InvokeFn = async (body) => {
  const { data, error } = await supabase.functions.invoke('school-backups', { body });
  if (error) {
    let m = error.message || 'Erro ao contactar o servidor de backups.';
    try { const b = await (error as any).context?.json?.(); if (b?.error) m = String(b.error); } catch { /* ignora */ }
    return { data: null, error: m };
  }
  if ((data as any)?.error) return { data: null, error: String((data as any).error) };
  return { data, error: null };
};

/**
 * Configurações → Segurança & Backups → Cópia diária para a nuvem da escola.
 * A escola liga a SUA conta; todos os dias, à hora escolhida (hora de Angola), o servidor envia o backup SÓ desta escola.
 * As chaves ficam cifradas no servidor e nunca voltam ao navegador. Para repor: descarregue o .json da nuvem e use "Carregar backup".
 */
export const ExternalBackup: React.FC<Props> = ({ isAdmin }) => {
  const api = useMemo(() => createExternalBackupApi((fn, args) => supabase.rpc(fn, args), invoke), []);

  const [status, setStatus] = useState<DestinationStatus | null>(null);
  const { page: pgRuns, setPage: setPgRuns, pageItems: visibleRuns } = usePagedList(status?.runs ?? [], [status?.runs?.length ?? 0]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [provider, setProvider] = useState<ExternalProvider>('s3');
  const [presetId, setPresetId] = useState('b2');
  const [region, setRegion] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [runHour, setRunHour] = useState(23);
  const [retentionDays, setRetentionDays] = useState(30);

  const preset = S3_PRESETS.find((p) => p.id === presetId) ?? S3_PRESETS[0];
  // Sucesso → diálogo global (carregamento → visto animado), igual ao login/pagamentos; o texto vai como pormenor.
  // Erros continuam na faixa vermelha do painel.
  const say = (kind: 'ok' | 'err', text: string) => {
    if (kind === 'ok') { setNotice(null); void showOperationSuccess('Operação feita com sucesso!', { details: text }); }
    else setNotice({ kind, text });
  };

  const audit = (action: string, details: string) => {
    try {
      const u = dbService.getDatabase().currentUser;
      dbService.addAuditLog({ userName: u?.name || 'Administrador', userRole: u?.roleTitle || 'Administrador Geral', action, details, module: 'sistema', timestamp: 'Agora mesmo', badgeColor: '#0b1f3a' });
    } catch { /* a auditoria do servidor permanece */ }
  };

  const fillForm = useCallback((s: DestinationStatus) => {
    if (s.provider) setProvider(s.provider);
    if (s.provider === 's3') {
      setPresetId(presetForEndpoint(s.config.endpoint).id); setEndpoint(s.config.endpoint || ''); setRegion(s.config.region || '');
      setBucket(s.config.bucket || ''); setPrefix(s.config.prefix || '');
    }
    setEnabled(s.enabled); setRunHour(s.runHour); setRetentionDays(s.retentionDays);
    setAccessKeyId(''); setSecretAccessKey('');
  }, []);

  const load = useCallback(async (keepForm = false) => {
    try {
      const s = await api.status();
      setStatus(s); setLoadError(null);
      if (!keepForm) fillForm(s);
    } catch (e) { setLoadError(friendlyExternalError(e)); }
  }, [api, fillForm]);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const popupRef = useRef<Window | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    const onResult = (m: any) => {
      if (m?.result === 'ok') { say('ok', 'Google Drive ligado. Escolha a hora e a retenção e clique em "Guardar" para activar o backup diário.'); void load(); }
      else if (m?.result === 'erro') say('err', `Não foi possível ligar o Google Drive${m.msg ? `: ${m.msg}` : '.'}`);
    };
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(DRIVE_CHANNEL); ch.onmessage = (e) => onResult(e.data); } catch { /* sem BroadcastChannel */ }
    const onStorage = (e: StorageEvent) => { if (e.key === DRIVE_STORAGE_KEY && e.newValue) { try { onResult(JSON.parse(e.newValue)); } catch { /* ignora */ } } };
    const onFocus = () => { if (popupRef.current) { popupRef.current = null; void load(true); } };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => { ch?.close(); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); };
  }, [isAdmin, load]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label); setNotice(null); beginOperationLoading(label);
    try { return await fn(); } catch (e) { say('err', friendlyExternalError(e)); return undefined; } finally { setBusy(null); cancelOperationLoading(); }
  }, []);

  const secretTyped = accessKeyId.trim() !== '' || secretAccessKey.trim() !== '';
  const connectedS3 = status?.provider === 's3' && status.hasSecret;

  const handleSave = async () => {
    const body: Parameters<typeof api.save>[0] = { provider, enabled, runHour, retentionDays };
    if (provider === 's3') {
      body.config = { endpoint: endpoint.trim(), region: region.trim(), bucket: bucket.trim(), prefix: prefix.trim() };
      if (secretTyped) body.secret = { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() };
    }
    const ok = await run('A guardar…', async () => { await api.save(body); return true; });
    if (!ok) return;
    audit('Destino de Backup na Nuvem Guardado', `${provider === 's3' ? preset.label : 'Google Drive'}; diário ${enabled ? `às ${hourLabel(runHour)}` : 'desligado'}.`);
    say('ok', enabled ? `Guardado. O backup diário vai para ${provider === 's3' ? preset.label : 'o Google Drive'} às ${hourLabel(runHour)} (hora de Angola).` : 'Guardado. O backup diário está desligado.');
    await load();
  };

  const handleTest = async () => {
    const r = await run('A testar a ligação…', () => api.test());
    if (!r) return;
    if (r.ok) say('ok', 'Ligação confirmada: foi enviado e apagado um ficheiro de teste.'); else say('err', r.error || 'O teste falhou.');
    await load(true);
  };

  const handleRunNow = async () => {
    const r = await run('A criar o backup e a enviá-lo… (pode demorar)', () => api.runNow());
    if (!r) return;
    if (r.ok) {
      audit('Backup na Nuvem Executado Manualmente', `Ficheiro ${r.file} (${formatSize(r.size)}).`);
      say('ok', `Backup enviado: ${r.file} (${formatSize(r.size)})${r.deleted ? ` · ${r.deleted} cópia(s) antiga(s) apagada(s) pela retenção` : ''}.`);
    } else say('err', r.error || 'O backup falhou.');
    await load(true);
  };

  const handleConnectDrive = async () => {
    const url = await run('A abrir o Google…', () => api.gdriveUrl(window.location.origin));
    if (!url) return;
    const w = window.open(url, 'bandmed-drive', 'width=520,height=720');
    if (!w) { say('err', 'O navegador bloqueou a janela. Permita pop-ups para este site e tente de novo.'); return; }
    popupRef.current = w;
  };

  const handleDisconnect = async () => {
    const ok = await run('A desligar…', async () => { await api.disconnect(); return true; });
    setConfirmDisconnect(false);
    if (!ok) return;
    audit('Destino de Backup na Nuvem Removido', 'As credenciais foram apagadas do servidor.');
    say('ok', 'Destino desligado e credenciais apagadas. Os backups que já estão na sua nuvem não foram tocados.');
    setProvider('s3'); setPresetId('b2'); setRegion(''); setEndpoint(''); setBucket(''); setPrefix(''); setEnabled(false);
    await load();
  };

  const onPreset = (id: string) => {
    setPresetId(id);
    const p = S3_PRESETS.find((x) => x.id === id) ?? S3_PRESETS[0];
    const r = region || p.regionHint;
    if (!region && p.regionHint) setRegion(p.regionHint);
    setEndpoint(p.endpoint(r));
  };
  const onRegion = (r: string) => {
    setRegion(r);
    if (!preset.endpointEditable) setEndpoint(preset.endpoint(r.trim()));
  };

  const inputCls = 'p-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-normal w-full';
  const labelCls = 'flex flex-col gap-1 text-[11px] font-bold text-slate-600';
  const btnPrimary = 'px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5';
  const btnGhost = 'px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5';

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4" data-testid="external-backup">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">3. Backup Automático</h3>
        <p className="text-xs text-slate-500">
          Todos os dias o sistema envia, sozinho, uma cópia dos dados <strong>desta escola</strong> para a conta de armazenamento que escolher
          (Google Drive, Backblaze B2, Wasabi, Cloudflare R2, Amazon S3…).
        </p>
      </div>

      {!isAdmin && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">Só o administrador da escola gere a cópia para a nuvem.</p>}

      {isAdmin && (
        <>
          {loadError && <Notice tone="error">{loadError}</Notice>}
          {notice && <Notice tone={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Notice>}
          {busy && <div className="text-xs text-slate-500" aria-live="polite">{busy}</div>}

          {status && (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1 text-xs" data-testid="external-backup-status">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">{describeTarget(status)}</span>
                {status.hasSecret && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                    {status.enabled ? `DIÁRIO ACTIVO · ${hourLabel(status.runHour)}` : 'DIÁRIO DESLIGADO'}
                  </span>
                )}
                {status.running && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-800">A EXECUTAR…</span>}
              </div>
              {status.hasSecret ? (
                <>
                  <span className="text-slate-600">Último backup bem sucedido: <strong>{fmtDate(status.lastSuccessAt)}</strong>{status.lastFile ? ` · ${status.lastFile} (${formatSize(status.lastSize)})` : ''}</span>
                  {status.lastStatus === 'error' && <span className="text-red-700">Última tentativa falhou ({fmtDate(status.lastAttemptAt)}): {status.lastError}</span>}
                  {status.enabled && !status.lastSuccessAt && !status.lastError && <span className="text-slate-500">Ainda não houve nenhum backup. O primeiro é feito à hora marcada (ou clique em "Fazer backup agora").</span>}
                </>
              ) : <span className="text-slate-500">Ligue uma conta abaixo para começar.</span>}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
              <span className="text-[11px] font-bold text-slate-600 uppercase">1. Onde guardar</span>
              <label className={labelCls}>Serviço
                <select value={provider} disabled={!!busy} onChange={(e) => setProvider(e.target.value as ExternalProvider)} className={inputCls} data-testid="external-provider">
                  <option value="s3">Armazenamento S3 (Backblaze B2, Wasabi, Cloudflare R2, Amazon S3…)</option>
                  <option value="gdrive">Google Drive</option>
                </select>
              </label>

              {provider === 'gdrive' && (
                <div className="flex flex-col gap-2 text-[11px] text-slate-600">
                  <p>
                    Clique em <strong>Ligar Google Drive</strong>, entre com a conta Google <strong>da escola</strong> e autorize. O BandMed só
                    consegue ver e apagar os ficheiros que ele próprio criar (na pasta <em>BandMed Backups</em>); não acede ao resto do Drive.
                  </p>
                  {status?.provider === 'gdrive' && status.hasSecret && <p className="text-emerald-800 font-semibold">Ligado a {status.config.account || 'uma conta Google'}.</p>}
                  <div>
                    <button type="button" disabled={!!busy} onClick={handleConnectDrive} className={btnPrimary}>
                      <span className="material-symbols-outlined text-[16px]">add_to_drive</span>
                      {status?.provider === 'gdrive' && status.hasSecret ? 'Ligar outra conta Google' : 'Ligar Google Drive'}
                    </button>
                  </div>
                </div>
              )}

              {provider === 's3' && (
                <div className="flex flex-col gap-2">
                  <label className={labelCls}>Fornecedor
                    <select value={presetId} disabled={!!busy} onChange={(e) => onPreset(e.target.value)} className={inputCls} data-testid="external-preset">
                      {S3_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </label>
                  <p className="text-[11px] text-slate-500">{preset.help}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={labelCls}>Região
                      <input value={region} disabled={!!busy} onChange={(e) => onRegion(e.target.value)} placeholder={preset.regionHint} className={inputCls} spellCheck={false} />
                    </label>
                    <label className={labelCls}>Bucket
                      <input value={bucket} disabled={!!busy} onChange={(e) => setBucket(e.target.value)} placeholder="meu-bucket-privado" className={inputCls} spellCheck={false} />
                    </label>
                  </div>
                  <label className={labelCls}>Endereço (endpoint)
                    <input value={endpoint} disabled={!!busy || !preset.endpointEditable} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…" className={inputCls} spellCheck={false} />
                  </label>
                  <label className={labelCls}>Pasta dentro do bucket (opcional)
                    <input value={prefix} disabled={!!busy} onChange={(e) => setPrefix(e.target.value)} placeholder="bandmed/escola" className={inputCls} spellCheck={false} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={labelCls}>Chave de acesso (Key ID)
                      <input value={accessKeyId} disabled={!!busy} onChange={(e) => setAccessKeyId(e.target.value)} autoComplete="off" spellCheck={false}
                        placeholder={connectedS3 ? '•••• guardada' : ''} className={inputCls} />
                    </label>
                    <label className={labelCls}>Chave secreta
                      <input type="password" value={secretAccessKey} disabled={!!busy} onChange={(e) => setSecretAccessKey(e.target.value)} autoComplete="new-password"
                        placeholder={connectedS3 ? '•••• guardada' : ''} className={inputCls} />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
              <span className="text-[11px] font-bold text-slate-600 uppercase">2. Quando e quanto tempo guardar</span>
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-800">
                Backup diário automático
                <button type="button" disabled={!!busy} onClick={() => setEnabled(!enabled)} aria-pressed={enabled} aria-label="Backup diário automático"
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${enabled ? 'bg-[#0b1f3a]' : 'bg-slate-300'}`} data-testid="external-enabled">
                  <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${enabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              <label className={labelCls}>Hora do backup (hora de Angola)
                <select value={runHour} disabled={!!busy} onChange={(e) => setRunHour(Number(e.target.value))} className={inputCls}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}{h === 23 ? ' (recomendado: fim do dia)' : ''}</option>)}
                </select>
                <span className="font-normal text-slate-500">Se o servidor falhar nessa hora, tenta de novo (até 4 vezes por dia).</span>
              </label>
              <label className={labelCls}>Guardar as cópias durante
                <select value={retentionDays} disabled={!!busy} onChange={(e) => setRetentionDays(Number(e.target.value))} className={inputCls}>
                  {RETENTION_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
                </select>
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={!!busy} onClick={handleSave} data-testid="external-save" className={btnPrimary}>
                  <span className="material-symbols-outlined text-[16px]">save</span>Guardar
                </button>
                <button type="button" disabled={!!busy || !status?.hasSecret} onClick={handleTest} className={btnGhost}>
                  <span className="material-symbols-outlined text-[16px]">wifi_tethering</span>Testar ligação
                </button>
                <button type="button" disabled={!!busy || !status?.hasSecret} onClick={handleRunNow} className={btnGhost}>
                  <span className="material-symbols-outlined text-[16px]">cloud_upload</span>Fazer backup agora
                </button>
                {status?.hasSecret && (
                  <button type="button" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}
                    className="px-3 py-2 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">link_off</span>Desligar
                  </button>
                )}
              </div>
            </div>
          </div>

          {status && status.runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                    <th className="py-2.5 px-3 rounded-l-lg">Quando</th>
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Resultado</th>
                    <th className="py-2.5 px-3 rounded-r-lg">Ficheiro / erro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {visibleRuns.map((r, i) => (
                    <tr key={`${r.at}-${i}`}>
                      <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">{fmtDate(r.at)}</td>
                      <td className="py-2 px-3 capitalize">{r.trigger}</td>
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{r.ok ? 'Sucesso' : 'Falhou'}</span></td>
                      <td className="py-2 px-3 text-[11px] max-w-md truncate" title={r.ok ? r.file || '' : r.error || ''}>{r.ok ? `${r.file || ''}${r.size ? ` (${formatSize(r.size)})` : ''}` : r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination total={status.runs.length} page={pgRuns} onPageChange={setPgRuns} />
            </div>
          )}
        </>
      )}

      {confirmDisconnect && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Desligar destino">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 flex flex-col gap-3 shadow-2xl">
            <h4 className="font-headline text-lg font-bold text-red-700">Desligar a cópia para a nuvem?</h4>
            <p className="text-xs text-slate-700">
              O backup diário pára e as credenciais são apagadas do servidor (no Google Drive o acesso do BandMed também é revogado).
              Os ficheiros que já estão na sua nuvem <strong>não são apagados</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={!!busy} className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold cursor-pointer">Cancelar</button>
              <button type="button" onClick={handleDisconnect} disabled={!!busy} className="px-3 py-2 rounded-lg bg-red-700 text-white text-xs font-bold disabled:opacity-40 cursor-pointer">{busy ? 'A trabalhar…' : 'Desligar'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
