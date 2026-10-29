import React, { useCallback, useEffect, useState } from 'react';
import { dbService } from '../../services/db';
import { notificationChannelsApi, notificationChannelsEnabled } from '../../services/notificationChannels';
import { registerPushDevice } from '../../services/pushDevice';
import { showOperationSuccess, beginOperationLoading, cancelOperationLoading } from '../../context/OperationContext';

import {
  SMS_PROVIDERS, WHATSAPP_PROVIDERS, friendlyNotificationError,
  type NotificationStatus, type NotifyChannel
} from '../../utils/notificationChannelsApi';
import { Notice } from '../../components/Notice';

interface Props {
  isAdmin: boolean;
  /** Mostra só este canal (usado pelos cartões de Integrações). Sem valor, mostra os três. */
  only?: 'push' | 'sms' | 'whatsapp';
}

const inputCls = 'p-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 font-normal w-full';
const labelCls = 'flex flex-col gap-1 text-[11px] font-bold text-slate-600';
const btnPrimary = 'px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed';
const btnGhost = 'px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed';
const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return String(iso); } };

/**
 * Configurações → Integrações → Notificações. Cada escola liga os SEUS serviços: push (chaves VAPID da escola, grátis), SMS
 * (Twilio, Infobip ou agregador local) e WhatsApp (Meta ou Twilio, só com modelo aprovado). As credenciais ficam cifradas no
 * servidor e nunca voltam ao navegador. Regras: push para avisos normais; SMS só para o crítico; WhatsApp só com modelo.
 */
export const NotificationChannels: React.FC<Props> = ({ isAdmin, only }) => {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Sucesso → diálogo global (carregamento → visto animado), igual ao login/pagamentos; o texto vai como pormenor.
  // Erros continuam na faixa vermelha do painel.
  const say = (kind: 'ok' | 'err', text: string) => {
    if (kind === 'ok') { setNotice(null); void showOperationSuccess('Operação feita com sucesso!', { details: text }); }
    else setNotice({ kind, text });
  };

  // push
  const [pushOn, setPushOn] = useState(false);
  const [subject, setSubject] = useState('');
  // sms
  const [smsProv, setSmsProv] = useState<string>('twilio');
  const [smsOn, setSmsOn] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(true);
  const [sms, setSms] = useState<Record<string, string>>({});
  const [smsSec, setSmsSec] = useState<Record<string, string>>({});
  // whatsapp
  const [waProv, setWaProv] = useState<string>('meta_cloud');
  const [waOn, setWaOn] = useState(false);
  const [wa, setWa] = useState<Record<string, string>>({});
  const [waSec, setWaSec] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState('');

  const audit = (action: string, details: string) => {
    try {
      const u = dbService.getDatabase().currentUser;
      dbService.addAuditLog({ userName: u?.name || 'Administrador', userRole: u?.roleTitle || 'Administrador Geral', action, details, module: 'sistema', timestamp: 'Agora mesmo', badgeColor: '#0b1f3a' });
    } catch { /* a auditoria do servidor permanece */ }
  };

  const fill = useCallback((s: NotificationStatus) => {
    const p = s.channels.push, m = s.channels.sms, w = s.channels.whatsapp;
    setPushOn(!!p?.enabled); setSubject(String(p?.config?.subject ?? ''));
    if (m) { setSmsProv(m.provider); setSmsOn(m.enabled); setCriticalOnly(m.criticalOnly); setSms(Object.fromEntries(Object.entries(m.config).map(([k, v]) => [k, String(v)]))); }
    if (w) { setWaProv(w.provider); setWaOn(w.enabled); setWa(Object.fromEntries(Object.entries(w.config).map(([k, v]) => [k, String(v)]))); }
    setSmsSec({}); setWaSec({});
  }, []);

  const load = useCallback(async (keepForm = false) => {
    try { const s = await notificationChannelsApi.status(); setStatus(s); setLoadError(null); if (!keepForm) fill(s); }
    catch (e) { setLoadError(friendlyNotificationError(e)); }
  }, [fill]);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label); setNotice(null); beginOperationLoading(label);
    try { return await fn(); } catch (e) { say('err', friendlyNotificationError(e)); return undefined; } finally { setBusy(null); cancelOperationLoading(); }
  }, []);

  const after = async () => { await load(); void notificationChannelsEnabled(true); };

  const savePush = async () => {
    const r = await run('A guardar o push…', () => notificationChannelsApi.save({ channel: 'push', enabled: pushOn, subject: subject.trim(), generate: !status?.channels.push }));
    if (!r) return;
    audit('Notificações Push Guardadas', `Push ${pushOn ? 'ligado' : 'desligado'}${r.keysRotated ? '; chaves geradas' : ''}.`);
    say('ok', `Guardado.${r.keysRotated ? ' As chaves VAPID da escola foram geradas (a privada fica só no servidor).' : ''}`);
    await after(); void registerPushDevice(true);
  };
  const rotatePush = async () => {
    if (!window.confirm('Gerar novas chaves? Todos os aparelhos já registados deixam de receber até voltarem a abrir a app.')) return;
    const r = await run('A gerar chaves…', () => notificationChannelsApi.generatePush(subject.trim()));
    if (!r) return;
    audit('Chaves de Push Renovadas', `${r.devicesReset ?? 0} aparelho(s) repostos.`);
    say('ok', `Novas chaves geradas. ${r.devicesReset ?? 0} aparelho(s) voltam a registar-se ao abrir a app.`);
    await after(); void registerPushDevice(true);
  };
  const saveSms = async () => {
    const secret = Object.fromEntries(Object.entries(smsSec).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
    const r = await run('A guardar o SMS…', () => notificationChannelsApi.save({ channel: 'sms', provider: smsProv, enabled: smsOn, criticalOnly, config: sms, secret }));
    if (!r) return;
    audit('SMS Guardado', `${smsProv}; ${smsOn ? 'ligado' : 'desligado'}; ${criticalOnly ? 'só críticos' : 'todos os avisos'}.`);
    say('ok', 'SMS guardado.'); await after();
  };
  const saveWa = async () => {
    const secret = Object.fromEntries(Object.entries(waSec).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0));
    const r = await run('A guardar o WhatsApp…', () => notificationChannelsApi.save({ channel: 'whatsapp', provider: waProv, enabled: waOn, config: wa, secret }));
    if (!r) return;
    audit('WhatsApp Guardado', `${waProv}; ${waOn ? 'ligado' : 'desligado'}.`);
    say('ok', 'WhatsApp guardado.'); await after();
  };
  const test = async (ch: NotifyChannel) => {
    const r = await run('A testar…', () => notificationChannelsApi.test(ch));
    if (!r) return;
    say(r.ok ? 'ok' : 'err', r.ok ? (r.detail || 'Ligação confirmada.') : (r.error || 'O teste falhou.')); await load(true);
  };
  const pushTest = async () => {
    const r = await run('A enviar o push de teste…', () => notificationChannelsApi.pushTest());
    if (!r) return;
    say(r.ok ? 'ok' : 'err', r.ok ? `Push de teste enviado a ${r.sent} aparelho(s).` : (r.error || 'O teste falhou.'));
  };
  const sendTest = async (ch: 'sms' | 'whatsapp') => {
    const r = await run('A enviar mensagem de teste…', () => notificationChannelsApi.smsTest(ch, testTo.trim()));
    if (!r) return;
    say(r.ok ? 'ok' : 'err', r.ok ? 'Mensagem de teste aceite pelo fornecedor.' : (r.error || 'O envio falhou.'));
  };
  const disconnect = async (ch: NotifyChannel) => {
    if (!window.confirm('Desligar e apagar as credenciais deste canal no servidor?')) return;
    const ok = await run('A desligar…', async () => { await notificationChannelsApi.disconnect(ch); return true; });
    if (!ok) return;
    audit('Canal de Notificação Removido', ch); say('ok', 'Canal desligado e credenciais apagadas.');
    if (ch === 'sms') { setSms({}); setSmsOn(false); } if (ch === 'whatsapp') { setWa({}); setWaOn(false); }
    await after();
  };

  const setF = (set: React.Dispatch<React.SetStateAction<Record<string, string>>>, k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set((p) => ({ ...p, [k]: e.target.value }));
  const field = (label: string, v: Record<string, string>, set: React.Dispatch<React.SetStateAction<Record<string, string>>>, k: string, ph = '', secret = false, has = false) => (
    <label className={labelCls}>{label}
      <input className={inputCls} type={secret ? 'password' : 'text'} autoComplete="off" value={v[k] ?? ''} onChange={setF(set, k)}
        placeholder={secret && has ? '•••••••• (guardado; escreva só para trocar)' : ph} />
    </label>
  );
  const chip = (c?: { enabled: boolean; hasSecret: boolean; lastTestOk: boolean | null }) => !c ? <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">NÃO LIGADO</span>
    : <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.enabled && c.hasSecret ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{c.enabled && c.hasSecret ? 'LIGADO' : 'DESLIGADO'}{c.lastTestOk === false ? ' · TESTE FALHOU' : ''}</span>;
  const card = 'p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3';
  const ch = status?.channels;
  const smsHas = !!ch?.sms?.hasSecret, waHas = !!ch?.whatsapp?.hasSecret;
  const smsInfo = SMS_PROVIDERS.find((p) => p.id === smsProv), waInfo = WHATSAPP_PROVIDERS.find((p) => p.id === waProv);

  return (
    <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4" data-testid="notification-channels">
      {!only && <div className="pb-3 border-b border-slate-100">
        <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">Notificações da escola (Push, SMS e WhatsApp)</h3>
        <p className="text-xs text-slate-500">
          Cada escola liga os <strong>seus</strong> serviços. <strong>Push</strong> (grátis) para avisos normais; <strong>SMS</strong> só para o crítico
          (ex.: propina em atraso); <strong>WhatsApp</strong> só com modelo aprovado. As chaves ficam cifradas no servidor e nunca voltam ao navegador.
        </p>
      </div>}
      {!isAdmin && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">Só o administrador da escola gere as notificações.</p>}
      {isAdmin && (<>
        {loadError && <Notice tone="error">{loadError}</Notice>}
        {notice && <Notice tone={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Notice>}
        {busy && <div className="text-xs text-slate-500" aria-live="polite">{busy}</div>}
        {status && <p className="text-[11px] text-slate-600">Últimos 7 dias: {status.counts.enviadas7d ?? 0} enviada(s), {status.counts.falhadas7d ?? 0} falhada(s), {status.counts.naFila ?? 0} na fila · Push: {status.pushDevices} aparelho(s) de {status.pushUsers} utilizador(es){status.counts.ultimoErro ? ` · Último erro: ${status.counts.ultimoErro}` : ''}</p>}

        {/* PUSH */}
        {(!only || only === 'push') && <div className={card}>
          <div className="flex items-center justify-between"><span className="font-bold text-slate-900 text-sm">Push (Web Push) — grátis</span>{chip(ch?.push)}</div>
          <p className="text-[11px] text-slate-500">Os utilizadores activam as notificações no sino do topo. No iPhone/iPad só funciona com a app instalada no ecrã inicial (iOS 16.4+).</p>
          <label className={labelCls}>Contacto da escola para o serviço de push (e-mail ou https)
            <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="mailto:secretaria@escola.ao" /></label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={pushOn} onChange={(e) => setPushOn(e.target.checked)} /> Push ligado</label>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={!!busy || !subject.trim()} onClick={savePush}>{ch?.push ? 'Guardar' : 'Gerar chaves e guardar'}</button>
            {ch?.push && <button className={btnGhost} disabled={!!busy} onClick={() => test('push')}>Testar chaves</button>}
            {ch?.push && <button className={btnGhost} disabled={!!busy} onClick={pushTest}>Enviar push de teste a mim</button>}
            {ch?.push && <button className={btnGhost} disabled={!!busy} onClick={rotatePush}>Gerar novas chaves</button>}
            {ch?.push && <button className={btnGhost} disabled={!!busy} onClick={() => disconnect('push')}>Desligar</button>}
          </div>
        </div>}

        {/* SMS */}
        {(!only || only === 'sms') && <div className={card}>
          <div className="flex items-center justify-between"><span className="font-bold text-slate-900 text-sm">SMS — só para o crítico</span>{chip(ch?.sms)}</div>
          <label className={labelCls}>Fornecedor
            <select className={inputCls} value={smsProv} onChange={(e) => setSmsProv(e.target.value)}>{SMS_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          {smsInfo && <p className="text-[11px] text-slate-500">{smsInfo.help}</p>}
          {smsProv === 'twilio' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field('Account SID', smsSec, setSmsSec, 'accountSid', 'ACxxxxxxxx…', true, smsHas)}{field('Auth Token', smsSec, setSmsSec, 'authToken', '', true, smsHas)}
            {field('Remetente (número com + ou nome)', sms, setSms, 'from', '+12025550123')}{field('Messaging Service SID (opcional)', sms, setSms, 'messagingServiceSid', 'MGxxxxxxxx…')}</div>)}
          {smsProv === 'infobip' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field('Endereço base da conta', sms, setSms, 'baseUrl', 'https://xxxx.api.infobip.com')}{field('Remetente', sms, setSms, 'sender', 'ESCOLA')}
            {field('Chave de API', smsSec, setSmsSec, 'apiKey', '', true, smsHas)}</div>)}
          {smsProv === 'http' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field('Endereço (https)', sms, setSms, 'url', 'https://api.agregador.ao/sms')}
            <label className={labelCls}>Formato do corpo<select className={inputCls} value={sms.contentType || 'json'} onChange={setF(setSms, 'contentType')}><option value="json">JSON</option><option value="form">Formulário</option></select></label>
            <label className={`${labelCls} md:col-span-2`}>Modelo do corpo (use {'{{to}}'} e {'{{message}}'})<textarea className={inputCls} rows={3} value={sms.bodyTemplate ?? ''} onChange={setF(setSms, 'bodyTemplate')} placeholder='{"to":"{{to}}","text":"{{message}}"}' /></label>
            <label className={labelCls}>Autenticação<select className={inputCls} value={sms.authMode || 'none'} onChange={setF(setSms, 'authMode')}><option value="none">Nenhuma</option><option value="bearer">Bearer</option><option value="basic">Basic (utilizador:senha)</option><option value="header">Cabeçalho</option><option value="query">Parâmetro no endereço</option></select></label>
            {(sms.authMode === 'header' || sms.authMode === 'query') && field('Nome do cabeçalho/parâmetro', sms, setSms, 'authName', 'X-Api-Key')}
            {sms.authMode && sms.authMode !== 'none' && field('Token / chave', smsSec, setSmsSec, 'token', '', true, smsHas)}
            <label className={labelCls}>Formato do número<select className={inputCls} value={sms.phoneFormat || 'e164'} onChange={setF(setSms, 'phoneFormat')}><option value="e164">+244923456789</option><option value="digits">244923456789</option><option value="local">923456789</option></select></label>
            {field('Remetente (opcional)', sms, setSms, 'sender', '')}{field('Texto de sucesso na resposta (opcional)', sms, setSms, 'successContains', '"success"')}</div>)}
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} /> Só avisos críticos (recomendado: poupa dinheiro)</label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} /> SMS ligado</label>
          <div className="flex flex-wrap gap-2 items-center">
            <button className={btnPrimary} disabled={!!busy} onClick={saveSms}>Guardar SMS</button>
            {ch?.sms && <button className={btnGhost} disabled={!!busy} onClick={() => test('sms')}>Testar ligação</button>}
            {ch?.sms && <input className={`${inputCls} !w-40`} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Nº para teste" />}
            {ch?.sms && <button className={btnGhost} disabled={!!busy || !testTo.trim()} onClick={() => sendTest('sms')}>Enviar SMS de teste</button>}
            {ch?.sms && <button className={btnGhost} disabled={!!busy} onClick={() => disconnect('sms')}>Desligar</button>}
          </div>
        </div>}

        {/* WHATSAPP */}
        {(!only || only === 'whatsapp') && <div className={card}>
          <div className="flex items-center justify-between"><span className="font-bold text-slate-900 text-sm">WhatsApp — só com modelo aprovado</span>{chip(ch?.whatsapp)}</div>
          <label className={labelCls}>Fornecedor
            <select className={inputCls} value={waProv} onChange={(e) => setWaProv(e.target.value)}>{WHATSAPP_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          {waInfo && <p className="text-[11px] text-slate-500">{waInfo.help} O texto do aviso entra no modelo como variável {'{{1}}'}.</p>}
          {waProv === 'meta_cloud' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field('Phone Number ID', wa, setWa, 'phoneNumberId', '1234567890')}{field('Token de acesso permanente', waSec, setWaSec, 'accessToken', '', true, waHas)}
            {field('Nome do modelo aprovado', wa, setWa, 'templateName', 'aviso_escola')}{field('Idioma do modelo', wa, setWa, 'templateLang', 'pt_PT')}
            {field('Modelo com documento (opcional)', wa, setWa, 'documentTemplateName', 'reuniao_com_pdf')}</div>)}
          {waProv === 'twilio' && (<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field('Account SID', waSec, setWaSec, 'accountSid', 'ACxxxxxxxx…', true, waHas)}{field('Auth Token', waSec, setWaSec, 'authToken', '', true, waHas)}
            {field('Número WhatsApp do Twilio', wa, setWa, 'from', '+14155238886')}{field('Content SID do modelo', wa, setWa, 'contentSid', 'HXxxxxxxxx…')}
            {field('Content SID do modelo com documento (opcional)', wa, setWa, 'documentContentSid', 'HXxxxxxxxx…')}</div>)}
          <p className="text-[11px] text-slate-500">O «modelo com documento» (aprovado, com cabeçalho Documento) permite enviar o PDF da agenda das reuniões directamente no WhatsApp. Sem ele, o WhatsApp envia o texto com o link do PDF.</p>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={waOn} onChange={(e) => setWaOn(e.target.checked)} /> WhatsApp ligado</label>
          <div className="flex flex-wrap gap-2 items-center">
            <button className={btnPrimary} disabled={!!busy} onClick={saveWa}>Guardar WhatsApp</button>
            {ch?.whatsapp && <button className={btnGhost} disabled={!!busy} onClick={() => test('whatsapp')}>Testar ligação</button>}
            {ch?.whatsapp && <button className={btnGhost} disabled={!!busy || !testTo.trim()} onClick={() => sendTest('whatsapp')}>Enviar mensagem de teste</button>}
            {ch?.whatsapp && <button className={btnGhost} disabled={!!busy} onClick={() => disconnect('whatsapp')}>Desligar</button>}
          </div>
        </div>}
      </>)}
    </section>
  );
};
