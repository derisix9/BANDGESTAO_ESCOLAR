import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { dbService } from '../../services/db';
import { supabaseUrl } from '../../services/supabase';
import { paymentGatewayApi, paymentsEnabled } from '../../services/paymentGateway';
import { showOperationSuccess, beginOperationLoading, cancelOperationLoading } from '../../context/OperationContext';

import {
  OUTCOME_LABEL, PROVIDERS, VALIDITY_OPTIONS, formatKz, friendlyPaymentError, providerInfo, webhookUrl,
  type GatewayProvider, type GatewayStatus
} from '../../utils/paymentGatewayApi';
import { Notice } from '../../components/Notice';

interface Props { isAdmin: boolean }

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return String(iso); }
};

const TONE: Record<'ok' | 'warn' | 'bad' | 'info', string> = {
  ok: 'bg-emerald-50 text-emerald-800', warn: 'bg-amber-50 text-amber-900', bad: 'bg-red-50 text-red-800', info: 'bg-sky-50 text-sky-800'
};

/**
 * Configurações → Integrações → Pagamentos por referência Multicaixa.
 * Cada escola escolhe o SEU fornecedor e cola a SUA chave: a partir daí as facturas ganham uma referência que se paga no ATM,
 * no Multicaixa Express ou no banco, e a propina fica paga sozinha. A chave fica cifrada no servidor e nunca volta ao navegador.
 */
export const PaymentGateway: React.FC<Props> = ({ isAdmin }) => {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);

  const [provider, setProvider] = useState<GatewayProvider>('proxypay');
  const [sandbox, setSandbox] = useState(true);
  const [entity, setEntity] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validityDays, setValidityDays] = useState(30);
  const [enabled, setEnabled] = useState(false);
  const [simInvoice, setSimInvoice] = useState('');

  const info = providerInfo(provider);
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

  const fillForm = useCallback((s: GatewayStatus) => {
    if (s.provider) setProvider(s.provider);
    setSandbox(s.configured ? s.sandbox : true);
    setEntity(s.entity || ''); setValidityDays(s.validityDays || 30); setEnabled(s.enabled);
    setApiKey('');
  }, []);

  const load = useCallback(async (keepForm = false) => {
    try {
      const s = await paymentGatewayApi.status();
      setStatus(s); setLoadError(null);
      if (!keepForm) fillForm(s);
    } catch (e) { setLoadError(friendlyPaymentError(e)); }
  }, [fillForm]);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label); setNotice(null); beginOperationLoading(label);
    try { return await fn(); } catch (e) { say('err', friendlyPaymentError(e)); return undefined; } finally { setBusy(null); cancelOperationLoading(); }
  }, []);

  const connected = !!status?.hasSecret;
  const hook = status?.institutionId ? webhookUrl(supabaseUrl, status.institutionId) : '';
  const entityOk = /^\d{1,5}$/.test(entity.trim());
  const envChanging = !!status?.configured && status.sandbox !== sandbox;
  const keyRequired = !connected || envChanging;

  // Facturas com referência activa (para a simulação no ambiente de testes).
  const withReference = useMemo(() => {
    try {
      return (dbService.getDatabase().invoices || []).filter((i: any) => i.multicaixaRef && i.status !== 'pago')
        .map((i: any) => ({ id: String(i.id), label: `${i.invoiceNumber} · ${i.studentName} · ${formatKz(i.totalAmountKz)}` }));
    } catch { return []; }
  }, [status]);

  const handleSave = async () => {
    const body: Parameters<typeof paymentGatewayApi.save>[0] = { provider, enabled, sandbox, entity: entity.trim(), validityDays };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const r = await run('A guardar…', () => paymentGatewayApi.save(body));
    if (!r) return;
    audit('Pagamentos por Referência Guardados', `${info.label}; ${sandbox ? 'TESTES' : 'PRODUÇÃO'}; entidade ${entity.trim()}; ${enabled ? 'activo' : 'desligado'}.`);
    say('ok', [
      enabled ? `Guardado. As facturas já podem ter referência de pagamento (${sandbox ? 'ambiente de TESTES' : 'PRODUÇÃO'}).` : 'Guardado. Os pagamentos por referência estão desligados.',
      r.referencesCancelled ? `${r.referencesCancelled} referência(s) do ambiente anterior foram canceladas.` : '',
      r.warning || ''
    ].filter(Boolean).join(' '));
    await load();
    void paymentsEnabled(true);
  };

  const handleTest = async () => {
    const r = await run('A testar a ligação ao fornecedor…', () => paymentGatewayApi.test());
    if (!r) return;
    if (r.ok) say('ok', 'Ligação confirmada: o fornecedor aceitou a chave.'); else say('err', r.error || 'O teste falhou.');
    await load(true);
  };

  const handleSync = async () => {
    const r = await run('A consultar pagamentos no fornecedor…', () => paymentGatewayApi.syncNow());
    if (!r) return;
    if (!r.ok) { say('err', r.error || 'A consulta falhou.'); return; }
    say('ok', r.seen ? `Consulta feita: ${r.applied ?? 0} pagamento(s) registado(s)${r.review ? `, ${r.review} para rever` : ''}.` : 'Consulta feita: não há pagamentos novos.');
    await load(true);
  };

  const handleSimulate = async () => {
    if (!simInvoice) return;
    const r = await run('A simular o pagamento…', () => paymentGatewayApi.simulate(simInvoice));
    if (!r) return;
    say(r.ok ? 'ok' : 'err', r.ok ? `Pagamento simulado: ${r.applied ?? 0} registado(s). A factura passa a "Paga" em instantes.` : r.error || 'A simulação falhou.');
    await load(true);
  };

  const handleDisconnect = async () => {
    const ok = await run('A desligar…', async () => { await paymentGatewayApi.disconnect(); return true; });
    setConfirmDisconnect(false);
    if (!ok) return;
    audit('Pagamentos por Referência Desligados', 'A chave foi apagada do servidor e as referências activas foram canceladas.');
    say('ok', 'Fornecedor desligado: a chave foi apagada do servidor. As facturas voltam a ser pagas ao balcão.');
    setEntity(''); setApiKey(''); setEnabled(false); setSandbox(true);
    await load();
    void paymentsEnabled(true);
  };

  const copyHook = () => { void navigator.clipboard?.writeText(hook); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const inputCls = 'p-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-normal w-full';
  const labelCls = 'flex flex-col gap-1 text-[11px] font-bold text-slate-600';
  const btnPrimary = 'px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5';
  const btnGhost = 'px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5';

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4" data-testid="payment-gateway">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">2. Pagamentos por Referência Multicaixa (automático)</h3>
        <p className="text-xs text-slate-500">
          Cada factura ganha uma <strong>referência</strong> que o encarregado paga no ATM, no Multicaixa Express ou no banco. Quando paga,
          a propina fica <strong>paga sozinha</strong>, com recibo e registo no caixa, sem a secretaria fazer nada. O dinheiro vai
          para a conta da escola no fornecedor que ela escolher.
        </p>
      </div>

      {!isAdmin && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">Só o administrador da escola gere os pagamentos por referência.</p>}

      {isAdmin && (
        <>
          {loadError && <Notice tone="error">{loadError}</Notice>}
          {notice && <Notice tone={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Notice>}
          {busy && <div className="text-xs text-slate-500" aria-live="polite">{busy}</div>}

          {status && (
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1 text-xs" data-testid="payment-gateway-status">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">{connected ? `${providerInfo(status.provider).label} · entidade ${status.entity}` : 'Nenhum fornecedor ligado'}</span>
                {connected && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                    {status.enabled ? 'ACTIVO' : 'DESLIGADO'}
                  </span>
                )}
                {connected && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.sandbox ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-800'}`}>
                    {status.sandbox ? 'AMBIENTE DE TESTES' : 'PRODUÇÃO (DINHEIRO REAL)'}
                  </span>
                )}
              </div>
              {connected ? (
                <>
                  <span className="text-slate-600">
                    Referências activas: <strong>{status.counts.ativas ?? 0}</strong> · pagas: <strong>{status.counts.pagas ?? 0}</strong> · expiradas: <strong>{status.counts.expiradas ?? 0}</strong>
                    {(status.counts.paraRever ?? 0) > 0 && <span className="text-amber-800 font-bold"> · {status.counts.paraRever} aviso(s) para rever</span>}
                  </span>
                  <span className="text-slate-500">
                    Último teste: {status.lastTestAt ? `${fmtDate(status.lastTestAt)} (${status.lastTestOk ? 'ok' : 'falhou'})` : 'nunca'} · última consulta ao fornecedor: {status.lastSyncAt ? `${fmtDate(status.lastSyncAt)} (${status.lastSyncOk === false ? 'falhou' : 'ok'})` : 'nunca'}
                  </span>
                  {status.lastTestOk === false && status.lastTestError && <span className="text-red-700">Teste falhou: {status.lastTestError}</span>}
                  {status.lastSyncOk === false && status.lastSyncError && <span className="text-red-700">Consulta falhou: {status.lastSyncError}</span>}
                </>
              ) : <span className="text-slate-500">Preencha os dados abaixo e guarde para começar. Começa sempre no ambiente de testes.</span>}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
              <span className="text-[11px] font-bold text-slate-600 uppercase">1. O fornecedor da escola</span>
              <label className={labelCls}>Fornecedor
                <select value={provider} disabled={!!busy} onChange={(e) => setProvider(e.target.value as GatewayProvider)} className={inputCls} data-testid="pay-provider">
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <p className="text-[11px] text-slate-500">{info.help}</p>

              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-800">
                Ambiente de testes (sem dinheiro real)
                <button type="button" disabled={!!busy} onClick={() => setSandbox(!sandbox)} aria-pressed={sandbox} aria-label="Ambiente de testes"
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${sandbox ? 'bg-[#0b1f3a]' : 'bg-slate-300'}`} data-testid="pay-sandbox">
                  <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${sandbox ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {!sandbox && <p className="text-[11px] text-rose-700 font-semibold">Produção: as referências são reais e os pagamentos são dinheiro verdadeiro. Use a chave de PRODUÇÃO do fornecedor.</p>}
              {envChanging && <p className="text-[11px] text-amber-800 font-semibold">Ao mudar de ambiente, as referências activas são canceladas e tem de indicar a chave desse ambiente.</p>}

              <label className={labelCls}>Entidade Multicaixa
                <input value={entity} disabled={!!busy} onChange={(e) => setEntity(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="ex: 00411" inputMode="numeric"
                  className={`${inputCls} font-mono`} data-testid="pay-entity" />
                <span className="font-normal text-slate-500">{info.entityHelp}</span>
              </label>

              <label className={labelCls}>{info.keyLabel}
                <div className="flex gap-1.5">
                  <input type={showKey ? 'text' : 'password'} value={apiKey} disabled={!!busy} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" spellCheck={false}
                    placeholder={connected && !envChanging ? '•••• guardada (deixe em branco para manter)' : 'Cole aqui a chave'} className={`${inputCls} font-mono`} data-testid="pay-key" />
                  <button type="button" onClick={() => setShowKey(!showKey)} className="px-2 rounded-lg border border-slate-300 bg-white text-slate-500 cursor-pointer" aria-label={showKey ? 'Esconder a chave' : 'Mostrar a chave'}>
                    <span className="material-symbols-outlined text-[16px]">{showKey ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
                <span className="font-normal text-slate-500">Fica cifrada no servidor e nunca volta a aparecer aqui. Obtenha-a no painel do fornecedor (<a className="underline" href={info.site} target="_blank" rel="noreferrer">{info.site.replace('https://', '')}</a>).</span>
              </label>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
              <span className="text-[11px] font-bold text-slate-600 uppercase">2. Funcionamento</span>
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-800">
                Pagamentos por referência activos
                <button type="button" disabled={!!busy} onClick={() => setEnabled(!enabled)} aria-pressed={enabled} aria-label="Pagamentos por referência activos"
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${enabled ? 'bg-[#0b1f3a]' : 'bg-slate-300'}`} data-testid="pay-enabled">
                  <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${enabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              <label className={labelCls}>Validade de cada referência
                <select value={validityDays} disabled={!!busy} onChange={(e) => setValidityDays(Number(e.target.value))} className={inputCls}>
                  {VALIDITY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
                </select>
                <span className="font-normal text-slate-500">Depois deste prazo a referência deixa de funcionar no ATM e a factura pode pedir outra.</span>
              </label>

              <div className="flex flex-col gap-1 text-[11px] text-slate-600" data-testid="pay-webhook">
                <span className="font-bold text-slate-600 uppercase">Endereço de aviso (webhook)</span>
                {hook ? (
                  <>
                    <div className="flex gap-1.5">
                      <input readOnly value={hook} className={`${inputCls} font-mono`} onFocus={(e) => e.currentTarget.select()} />
                      <button type="button" onClick={copyHook} className={btnGhost} aria-label="Copiar o endereço"><span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span></button>
                    </div>
                    <span className="text-slate-500">
                      Já vai incluído em cada referência, por isso <strong>não precisa de configurar nada no fornecedor</strong>. Se preferir, pode também colá-lo
                      no painel do ProxyPay como webhook fixo (o mesmo pagamento nunca é contado duas vezes). Mesmo sem webhook, o sistema consulta o
                      fornecedor de 5 em 5 minutos.
                    </span>
                  </>
                ) : <span className="text-slate-500">Aparece depois de guardar.</span>}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={!!busy || !entityOk || (keyRequired && !apiKey.trim())} onClick={handleSave} data-testid="pay-save" className={btnPrimary}>
                  <span className="material-symbols-outlined text-[16px]">save</span>Guardar
                </button>
                <button type="button" disabled={!!busy || !connected} onClick={handleTest} className={btnGhost}>
                  <span className="material-symbols-outlined text-[16px]">wifi_tethering</span>Testar ligação
                </button>
                <button type="button" disabled={!!busy || !connected} onClick={handleSync} className={btnGhost}>
                  <span className="material-symbols-outlined text-[16px]">sync</span>Consultar pagamentos
                </button>
                {connected && (
                  <button type="button" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}
                    className="px-3 py-2 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">link_off</span>Desligar
                  </button>
                )}
              </div>
            </div>
          </div>

          {connected && status?.sandbox && (
            <div className="p-4 rounded-xl border border-sky-200 bg-sky-50 flex flex-col gap-2 text-xs" data-testid="pay-simulate">
              <span className="text-[11px] font-bold text-sky-900 uppercase">Experimentar sem dinheiro (ambiente de testes)</span>
              <p className="text-sky-900">
                1) Na Tesouraria, abra uma factura em dívida e gere a referência. 2) Escolha-a aqui e simule o pagamento: a factura passa a
                <strong> Paga</strong> sozinha, com recibo. É assim que verifica que tudo funciona antes de passar a produção.
              </p>
              {withReference.length === 0 ? (
                <span className="text-sky-800">Ainda não há facturas com referência. Gere uma na Tesouraria (botão "Gerar referência").</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select value={simInvoice} disabled={!!busy} onChange={(e) => setSimInvoice(e.target.value)} className={`${inputCls} max-w-md`} aria-label="Factura a pagar na simulação">
                    <option value="">Escolha uma factura…</option>
                    {withReference.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <button type="button" disabled={!!busy || !simInvoice} onClick={handleSimulate} className={btnPrimary}>
                    <span className="material-symbols-outlined text-[16px]">payments</span>Simular pagamento
                  </button>
                </div>
              )}
            </div>
          )}

          {status && status.events.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#0b1f3a] text-white uppercase tracking-wider font-bold border-b border-slate-800 text-[11px]">
                    <th className="py-2.5 px-3 rounded-l-lg">Quando</th>
                    <th className="py-2.5 px-3">Referência</th>
                    <th className="py-2.5 px-3">Valor</th>
                    <th className="py-2.5 px-3">Resultado</th>
                    <th className="py-2.5 px-3 rounded-r-lg">Pormenor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {status.events.map((ev, i) => {
                    const o = OUTCOME_LABEL[ev.outcome] ?? OUTCOME_LABEL.recebido;
                    return (
                      <tr key={`${ev.at}-${i}`}>
                        <td className="py-2 px-3 whitespace-nowrap font-mono text-[11px]">{fmtDate(ev.at)}</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{ev.reference || '—'}</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{formatKz(ev.amountKz)}</td>
                        <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${TONE[o.tone]}`}>{o.text}</span></td>
                        <td className="py-2 px-3 text-[11px] max-w-md truncate" title={ev.detail || ''}>{ev.detail || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] text-slate-500 mt-2">
                "Rever" = o dinheiro entrou mas algo não bate certo (valor diferente, factura já paga, referência desconhecida). Fica tudo registado e
                na auditoria; decida com a secretaria (por exemplo, reembolsar um pagamento em duplicado).
              </p>
            </div>
          )}
        </>
      )}

      {confirmDisconnect && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Desligar fornecedor">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 flex flex-col gap-3 shadow-2xl">
            <h4 className="font-headline text-lg font-bold text-red-700">Desligar os pagamentos por referência?</h4>
            <p className="text-xs text-slate-700">
              A chave é apagada do servidor e as referências activas são canceladas (as facturas voltam a "Balcão / Caixa").
              Os pagamentos que já foram registados <strong>não são alterados</strong>. Referências já impressas deixam de ser aceites pelo sistema.
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
