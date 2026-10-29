import React, { useState, useEffect, useCallback } from 'react';
import { notificationChannelsApi } from '../../services/notificationChannels';
import { InstitutionSettings, UserRole } from '../../types';
import { dbService } from '../../services/db';
import { isGatewayConfigured } from '../../utils/notificationGateway';
import { PaymentGateway } from './PaymentGateway';
import { NotificationChannels } from './NotificationChannels';
import { paymentsEnabled } from '../../services/paymentGateway';
import { notify } from '../../components/Notice';

interface TabIntegracoesProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  /** Estes separadores propagam as alterações em tempo real; nada há a recolher. */
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

type View = 'hub' | 'sms' | 'whatsapp' | 'express' | 'cobranca' | 'agt';
type Tone = 'ok' | 'warn' | 'off';

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  off: 'bg-slate-100 text-slate-600 border-slate-200'
};

/** Cartão de serviço: imagem + estado. Ao clicar abre a área de configuração desse serviço. */
const ServiceCard: React.FC<{ img: string; title: string; desc: string; status: string; tone: Tone; onOpen: () => void }> = ({ img, title, desc, status, tone, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label={`Configurar ${title}`}
    className="group text-left p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-[#0b1f3a]/40 transition-all cursor-pointer flex flex-col items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b1f3a]"
  >
    <img src={img} alt="" width={80} height={80} loading="lazy" className="w-20 h-20 object-contain rounded-2xl shadow-sm" />
    <span className="font-headline font-bold text-slate-900 text-sm text-center">{title}</span>
    <span className="text-[11px] text-slate-500 text-center leading-snug">{desc}</span>
    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${TONE[tone]}`}>{status}</span>
    <span className="mt-auto text-[11px] font-bold text-[#0b1f3a] group-hover:text-[#ac332b] flex items-center gap-1">
      Configurar <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
    </span>
  </button>
);

export const TabIntegracoes: React.FC<TabIntegracoesProps> = ({
  settings,
  currentUserRole,
  onSaveAll,
  registerCommit
}) => {
  // Todos os parâmetros deste separador vivem em settings.integrations e são
  // gravados pelo botão «Guardar Alterações» do topo do módulo. Nada aqui é
  // fixo no código. Os pagamentos por referência Multicaixa (fornecedor, entidade e chave de API) NÃO passam por aqui:
  // são geridos pelo componente PaymentGateway, que guarda a chave cifrada no servidor (nunca em settings).
  const integrations = settings.integrations || {};

  const [agtCertificate, setAgtCertificate] = useState(integrations.agtSoftwareCertificate || '');
  const [agtSeries, setAgtSeries] = useState(integrations.agtInvoiceSeries || '');
  const [agtSeriesStart, setAgtSeriesStart] = useState(integrations.agtSeriesStartIso || '');
  const [smsProvider, setSmsProvider] = useState(integrations.smsProvider || '');
  const [smsSenderId, setSmsSenderId] = useState(integrations.smsSenderId || '');
  const [smsBalance, setSmsBalance] = useState<string>(
    integrations.smsBalance !== undefined ? String(integrations.smsBalance) : ''
  );
  const [smsNotifyCharges, setSmsNotifyCharges] = useState(integrations.smsNotifyCharges === true);
  const [smsNotifyAbsences, setSmsNotifyAbsences] = useState(integrations.smsNotifyAbsences === true);
  const [smsNotifyGrades, setSmsNotifyGrades] = useState(integrations.smsNotifyGrades === true);
  const [notifyGatewayUrl, setNotifyGatewayUrl] = useState(integrations.notifyGatewayUrl || '');

  // O endereço do gateway só é aceite em HTTPS (ou http://localhost para desenvolvimento).
  const gatewayUrlTrimmed = notifyGatewayUrl.trim();
  const gatewayUrlValid = gatewayUrlTrimmed === '' || isGatewayConfigured({ url: gatewayUrlTrimmed });

  const [view, setView] = useState<View>('hub');
  const [chOn, setChOn] = useState<{ sms: boolean; whatsapp: boolean }>({ sms: false, whatsapp: false });
  const [expressOn, setExpressOn] = useState(false);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [view]);
  useEffect(() => {
    let alive = true;
    paymentsEnabled(true).then((v) => { if (alive) setExpressOn(!!v); }).catch(() => {});
    if (currentUserRole === 'admin') {
      notificationChannelsApi.status().then((st) => {
        if (!alive) return;
        const c = st.channels;
        setChOn({ sms: !!(c.sms?.enabled && c.sms?.hasSecret), whatsapp: !!(c.whatsapp?.enabled && c.whatsapp?.hasSecret) });
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [currentUserRole, view]);

  const [testingPing, setTestingPing] = useState(false);

  const connectedCount =
    (agtCertificate.trim() ? 1 : 0) +
    (smsProvider.trim() && smsSenderId.trim() ? 1 : 0);

  // Recolha das alterações para o botão «Guardar Alterações» do topo.
  const buildPendingSettings = useCallback(
    (): Partial<InstitutionSettings> => {
      // Chaves antigas da EMIS (e o webhook manual) guardadas em texto simples nas definições: ao guardar, deixam de existir.
      // A chave do fornecedor de pagamentos vive cifrada no servidor (PaymentGateway).
      const { emisClientId: _c, emisSecretKey: _k, emisEntity: _e, emisSandbox: _s, webhookUrl: _w, pushVapidPublicKey: _v, ...kept } = integrations as Record<string, unknown>;
      void _c; void _k; void _e; void _s; void _w; void _v;
      return {
      integrations: {
        ...(kept as typeof integrations),
        agtSoftwareCertificate: agtCertificate.trim(),
        agtInvoiceSeries: agtSeries.trim(),
        agtSeriesStartIso: agtSeriesStart,
        smsProvider: smsProvider.trim(),
        smsSenderId: smsSenderId.trim(),
        smsBalance: smsBalance.trim() === '' ? undefined : Number(smsBalance),
        smsNotifyCharges,
        smsNotifyAbsences,
        smsNotifyGrades,
        notifyGatewayUrl: gatewayUrlTrimmed
      }
      };
    },
    [
      integrations,
      agtCertificate,
      agtSeries,
      agtSeriesStart,
      smsProvider,
      smsSenderId,
      smsBalance,
      smsNotifyCharges,
      smsNotifyAbsences,
      smsNotifyGrades,
      gatewayUrlTrimmed
    ]
  );

  useEffect(() => {
    registerCommit?.(buildPendingSettings);
    return () => registerCommit?.(null);
  }, [registerCommit, buildPendingSettings]);

  /**
   * Verificação real das interfaces: em vez de simular um "200 OK", confirma o
   * que está efetivamente parametrizado na base de dados e regista o resultado
   * na trilha de auditoria.
   */
  const handleTestPing = async () => {
    setTestingPing(true);
    const report: string[] = [];
    const paymentsOn = await paymentsEnabled(true).catch(() => false);

    report.push(
      paymentsOn
        ? 'Pagamentos por referência Multicaixa: fornecedor ligado e activo (use «Testar ligação» na secção 2 para confirmar a chave).'
        : 'Pagamentos por referência Multicaixa: sem fornecedor activo — as faturas ficam sem referência e são pagas ao balcão.'
    );

    report.push(
      agtCertificate.trim()
        ? `AGT / SAF-T (AO): certificado ${agtCertificate.trim()}${agtSeries.trim() ? `, série ${agtSeries.trim()}` : ''}.`
        : 'AGT / SAF-T (AO): certificado de software por preencher.'
    );

    report.push(
      smsProvider.trim() && smsSenderId.trim()
        ? `SMS (${smsProvider.trim()}): remetente ${smsSenderId.trim()}${smsBalance.trim() ? `, saldo de ${smsBalance.trim()} mensagens` : ''}.`
        : 'Gateway SMS: operadora ou remetente por configurar — as notificações não são enviadas.'
    );

    report.push(
      gatewayUrlTrimmed
        ? gatewayUrlValid
          ? `Servidor de notificações: ${gatewayUrlTrimmed} (o envio real de SMS/WhatsApp fica ativo; o endereço não foi contactado neste teste).`
          : 'Servidor de notificações: endereço inválido — use HTTPS.'
        : 'Servidor de notificações: sem endereço — SMS/WhatsApp pelo servidor ficam desativados (o WhatsApp manual por wa.me continua a funcionar).'
    );
    report.push('Notificações push/SMS/WhatsApp por escola: configure-as no cartão «Notificações da escola» (as chaves ficam no servidor).');

    const allOk = connectedCount === 2 && paymentsOn;
    setTestingPing(false);
    notify[allOk ? 'success' : 'warn'](
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{report.map((l) => <span key={l}>{l}</span>)}</div>,
      { title: allOk ? 'Todas as interfaces estão parametrizadas na base de dados.' : 'Há interfaces por configurar — veja o detalhe abaixo.', duration: 0 }
    );

    try {
      dbService.addAuditLog({
        userName: dbService.getCurrentUser()?.name || 'Administrador',
        userRole: String(currentUserRole || 'admin'),
        action: 'Verificação de Integrações Externas',
        details: report.join(' | '),
        module: 'sistema',
        timestamp: new Date().toLocaleString('pt-PT'),
        badgeColor: '#0b1f3a'
      } as any);
    } catch {
      // auditoria best-effort
    }

  };

  const cobrancaOn = smsNotifyCharges || smsNotifyAbsences || smsNotifyGrades;
  const meta: Record<Exclude<View, 'hub'>, { img: string; title: string }> = {
    sms: { img: '/integracoes/sms.png', title: 'SMS' },
    whatsapp: { img: '/integracoes/whatsapp.png', title: 'WhatsApp' },
    express: { img: '/integracoes/express.png', title: 'Multicaixa Express' },
    cobranca: { img: '/integracoes/cobranca.svg', title: 'Notificações de Cobrança' },
    agt: { img: '/integracoes/agt.svg', title: 'AGT · SAF-T (AO)' }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">hub</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 06</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">Integrações de API</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              Gateways Bancários &amp; Comunicações
            </h2>
          </div>
        </div>

        {view === 'hub' && (
          <button
            type="button"
            onClick={handleTestPing}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[16px]">network_check</span>
            <span>{testingPing ? 'A testar conexões...' : 'Testar Conexões de API'}</span>
          </button>
        )}
      </div>

      {/* ── Cartões dos serviços ── */}
      {view === 'hub' && (
        <section className="flex flex-col gap-4" aria-label="Serviços integrados">
          <p className="text-xs text-slate-500">Escolha um serviço para abrir a respetiva configuração.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <ServiceCard
              img="/integracoes/express.png" title="Multicaixa Express"
              desc="Pagamentos por referência no ATM, no Express ou no banco. A propina fica paga sozinha."
              status={expressOn ? 'LIGADO' : 'NÃO LIGADO'} tone={expressOn ? 'ok' : 'off'} onOpen={() => setView('express')}
            />
            <ServiceCard
              img="/integracoes/sms.png" title="SMS"
              desc="Avisos críticos aos encarregados (ex.: propina em atraso). Operadora e remetente."
              status={chOn.sms ? 'LIGADO' : smsProvider.trim() && smsSenderId.trim() ? 'PARAMETRIZADO' : 'NÃO LIGADO'}
              tone={chOn.sms ? 'ok' : smsProvider.trim() && smsSenderId.trim() ? 'warn' : 'off'} onOpen={() => setView('sms')}
            />
            <ServiceCard
              img="/integracoes/whatsapp.png" title="WhatsApp"
              desc="Mensagens com modelo aprovado (Meta Cloud ou Twilio)."
              status={chOn.whatsapp ? 'LIGADO' : 'NÃO LIGADO'} tone={chOn.whatsapp ? 'ok' : 'off'} onOpen={() => setView('whatsapp')}
            />
            <ServiceCard
              img="/integracoes/cobranca.svg" title="Notificações de Cobrança"
              desc="Disparos automáticos, push e servidor de notificações."
              status={cobrancaOn ? 'AUTOMÁTICO ATIVO' : 'DESLIGADO'} tone={cobrancaOn ? 'ok' : 'off'} onOpen={() => setView('cobranca')}
            />
            <ServiceCard
              img="/integracoes/agt.svg" title="AGT · SAF-T (AO)"
              desc="Certificado de software e série de faturação."
              status={agtCertificate.trim() ? 'CERTIFICADO DECLARADO' : 'SEM CERTIFICADO'} tone={agtCertificate.trim() ? 'ok' : 'warn'} onOpen={() => setView('agt')}
            />
          </div>
        </section>
      )}

      {/* ── Área de configuração do serviço escolhido ── */}
      {view !== 'hub' && (
        <div className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <button
            type="button"
            onClick={() => setView('hub')}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Voltar às integrações
          </button>
          <img src={meta[view].img} alt="" width={36} height={36} className="w-9 h-9 rounded-lg object-contain" />
          <span className="font-headline font-bold text-slate-900 text-sm lg:text-base">{meta[view].title}</span>
        </div>
      )}

      {view === 'agt' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div className="grid grid-cols-1 gap-4">
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#0b1f3a] text-[22px]">verified_user</span>
                  <span className="font-bold text-slate-900 text-sm">AGT-SAFT</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    agtCertificate.trim() ? 'bg-blue-50 text-[#0b1f3a]' : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {agtCertificate.trim() ? 'CERTIFICADO DECLARADO' : 'SEM CERTIFICADO'}
                </span>
              </div>
              

              <div className="space-y-2 mt-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Certificado de Software</span>
                  <input
                    type="text"
                    value={agtCertificate}
                    onChange={(e) => setAgtCertificate(e.target.value)}
                    placeholder="ex: 312/AGT/2024"
                    className="w-full mt-0.5 p-1.5 font-mono font-bold text-slate-900 bg-white border border-slate-200 rounded-lg text-[11px]"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Série em Emissão</span>
                  <div className="flex gap-1.5 mt-0.5">
                    <input
                      type="text"
                      value={agtSeries}
                      onChange={(e) => setAgtSeries(e.target.value)}
                      placeholder="ex: FT 2026/A"
                      className="flex-1 p-1.5 font-mono text-[11px] text-slate-800 bg-white border border-slate-200 rounded-lg"
                    />
                    <input
                      type="date"
                      value={agtSeriesStart}
                      onChange={(e) => setAgtSeriesStart(e.target.value)}
                      className="p-1.5 font-mono text-[11px] text-slate-800 bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-[11px] text-amber-800 leading-snug">
                A validade fiscal exige software validado pela AGT. Para emitir documentos válidos e submeter o SAF-T (AO), use um programa de faturação certificado e registe aqui o seu número de certificado.
              </span>
            </div>
          </div>

          </div>
        </section>
      )}

      {view === 'sms' && (
        <>
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
            <div className="grid grid-cols-1 gap-4">
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#0b1f3a] text-[22px]">sms</span>
                  <span className="font-bold text-slate-900 text-sm">{smsProvider.trim() || 'Gateway SMS'}</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-[#0b1f3a] font-bold text-[10px]">
                  {smsBalance.trim() ? `${Number(smsBalance).toLocaleString('pt-PT')} SMS` : 'SEM SALDO REGISTADO'}
                </span>
              </div>
             

              <div className="space-y-2 mt-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Operadora / Gateway</span>
                  <input
                    type="text"
                    value={smsProvider}
                    onChange={(e) => setSmsProvider(e.target.value)}
                    placeholder="ex: Unitel, Africell"
                    className="w-full mt-0.5 p-1.5 text-[11px] text-slate-800 bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Saldo de Mensagens</span>
                  <input
                    type="number"
                    min={0}
                    value={smsBalance}
                    onChange={(e) => setSmsBalance(e.target.value)}
                    placeholder="Saldo contratado com a operadora"
                    className="w-full mt-0.5 p-1.5 font-mono text-[11px] text-slate-800 bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Remetente Autorizado</span>
                  <input
                    type="text"
                    value={smsSenderId}
                    onChange={(e) => setSmsSenderId(e.target.value.toUpperCase().slice(0, 11))}
                    placeholder="ex: ESCOLA-AO"
                    className="w-full mt-0.5 p-1.5 font-mono text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500 text-[11px]">Entrega direta</span>
              <button
                type="button"
                onClick={() => notify.info('Para recarregar o pacote de SMS da escola, contate a operadora ou adicione via fatura.', { duration: 0 })}
                className="text-[#0b1f3a] hover:text-[#ac332b] font-bold"
              >
                Recarregar Pacote
              </button>
            </div>
          </div>
            </div>
          </section>
          <NotificationChannels isAdmin={currentUserRole === 'admin'} only="sms" />
        </>
      )}

      {view === 'whatsapp' && <NotificationChannels isAdmin={currentUserRole === 'admin'} only="whatsapp" />}

      {view === 'express' && <PaymentGateway isAdmin={currentUserRole === 'admin'} />}

      {view === 'cobranca' && (
        <>
      {/* Notificações */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
            Notificações de Cobrança
          </h3>
          <p className="text-xs text-slate-500">
            Avisos aos encarregados. A confirmação dos pagamentos Multicaixa é automática (cartão «Multicaixa Express»).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-2">
            <span className="font-bold text-slate-900">Servidor de Notificações (SMS/WhatsApp reais) e Push</span>
            <span className="text-[11px] text-slate-500">
              O navegador nunca guarda chaves do fornecedor: envia o pedido a este servidor (ver server/notify.ts), que valida
              quem pede e fala com o Twilio. As chaves do Twilio ficam só nas variáveis de ambiente do servidor.
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Endereço do servidor (HTTPS)</span>
                <input
                  type="url"
                  value={notifyGatewayUrl}
                  onChange={(e) => setNotifyGatewayUrl(e.target.value)}
                  placeholder="https://notificacoes.escola.exemplo.ao"
                  className={`w-full mt-0.5 p-1.5 font-mono text-[11px] text-slate-800 bg-white border rounded-lg ${gatewayUrlValid ? 'border-slate-200' : 'border-red-400'}`}
                />
                {!gatewayUrlValid && <span className="text-[10px] text-red-600 font-semibold">Use um endereço HTTPS válido.</span>}
                {!gatewayUrlTrimmed && (
                  <span className="text-[10px] text-slate-500 block">Sem endereço, o botão de envio real fica desativado.</span>
                )}
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Push, SMS e WhatsApp da escola</span>
                <span className="text-[10px] text-slate-500 block">Cada escola liga os seus serviços nos cartões «SMS» e «WhatsApp». Este endereço serve só o servidor global antigo.</span>
              </div>
            </div>
            <div className="mt-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Cópias de segurança</span>
              <span className="text-[10px] text-slate-500 block">
                Já não precisa de servidor externo: em Segurança &amp; Backups baixa-se um ficheiro com todos os dados da escola
                e carrega-se o mesmo ficheiro para restaurar (tudo feito pelo próprio Supabase).
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-2">
            <span className="font-bold text-slate-900">Disparos Automáticos de SMS</span>
            <div className="space-y-1.5 text-[11px] text-slate-600">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsNotifyCharges}
                  onChange={(e) => setSmsNotifyCharges(e.target.checked)}
                />
                <span>
                  Cobrança preventiva, antes do dia {settings.financialRules?.paymentDueDay ?? 10} de cada mês
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsNotifyAbsences}
                  onChange={(e) => setSmsNotifyAbsences(e.target.checked)}
                />
                <span>Alerta de faltas injustificadas acumuladas no trimestre</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsNotifyGrades}
                  onChange={(e) => setSmsNotifyGrades(e.target.checked)}
                />
                <span>Publicação de Pautas: resumo das notas trimestrais</span>
              </label>
            </div>
          </div>
        </div>
      </section>

          <NotificationChannels isAdmin={currentUserRole === 'admin'} only="push" />
        </>
      )}

      {/* Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <span className="material-symbols-outlined text-slate-400">lock</span>
          <span>Tokens de API protegidos e compatíveis com a infraestrutura bancária de Angola.</span>
        </div>
      </div>
    </div>
  );
};
