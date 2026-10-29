import React, { useEffect, useMemo, useState } from 'react';
import {
  CommunicationChannel,
  MeetingParticipantStatus,
  MeetingStatus,
  MeetingType,
  NotificationAudienceType,
  NotificationRecipient,
  NotificationStatus,
  SchoolDatabase,
  SmsWhatsappNotification,
  UserRole
} from '../types';
import { dbService } from '../services/db';
import { isGatewayConfigured } from '../utils/notificationGateway';
import { NO_CHANNELS, type ChannelsEnabled } from '../utils/notificationChannelsApi';
import { notificationChannelsEnabled } from '../services/notificationChannels';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { AppConfirmModal } from '../components/AppConfirmModal';
import {
  AUDIENCE_TYPE_LABELS,
  buildWhatsAppLink,
  CHANNEL_LABELS,
  MEETING_STATUS_META,
  MEETING_TYPE_LABELS,
  NOTIFICATION_STATUS_META,
  PARTICIPANT_STATUS_META
} from '../utils/comunicacao';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';
import { MeetingNoticeModal } from '../components/MeetingNoticeModal';

export type ComunicacaoSection = 'comunicacao_notificacoes' | 'comunicacao_reunioes';

interface ComunicacaoViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  section?: ComunicacaoSection;
}

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const textareaCls =
  'w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

import { printMeetingAttendance } from '../utils/meetingAttendanceSheet';
const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-PT') : '—');
const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('pt-PT') : '—');

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${tone}`}>{children}</span>;
}

function SectionHeader({
  subsection,
  title,
  description,
  actions
}: {
  subsection: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">COMUNICAÇÃO</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
          <span className="text-xs font-semibold text-[#0b1f3a]">{subsection}</span>
        </div>
        <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">{title}</h1>
        <p className="text-xs text-slate-500 mt-0.5 max-w-3xl">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

function KpiGrid({ items }: { items: Array<{ label: string; value: React.ReactNode; icon: string; tone?: 'default' | 'warn' | 'danger' }> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((k) => {
        const tone =
          k.tone === 'danger' ? 'bg-red-50 text-red-700' : k.tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-[#0b1f3a]';
        return (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${tone}`}>
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none truncate">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs rounded-lg"
      />
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
      <span className="material-symbols-outlined text-[40px]">{icon}</span>
      <p className="text-xs font-semibold">{text}</p>
    </div>
  );
}

export const ComunicacaoView: React.FC<ComunicacaoViewProps> = ({ db, currentUserRole, section = 'comunicacao_notificacoes' }) => {
  const acl = useAccessControl(currentUserRole);

  const run = async (
    action: () => void | Promise<void>,
    loadingMessage: string,
    rule: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await runGlobalOperation(action, { loadingMessage, requiredRule: rule, userRole: currentUserRole });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  };

  if (section === 'comunicacao_reunioes') return <ReunioesTab db={db} currentUserRole={currentUserRole} acl={acl} run={run} />;
  return <NotificacoesTab db={db} currentUserRole={currentUserRole} acl={acl} run={run} />;
};

type RunFn = (action: () => void | Promise<void>, loadingMessage: string, rule: string) => Promise<{ ok: boolean; error?: string }>;
interface TabProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  acl: ReturnType<typeof useAccessControl>;
  run: RunFn;
}

// =============================================================
// 2. Notificações SMS/WhatsApp
// =============================================================

/**
 * Fila de envio REAL de WhatsApp: percorre, um a um, os destinatários
 * ainda "pendente" e abre o link oficial wa.me (click-to-chat) com a
 * mensagem já pré-preenchida numa nova aba. Não há nenhuma API/servidor
 * intermediário — é a própria conta de WhatsApp (Web, Desktop ou app) de
 * quem está a operar o sistema que despacha a mensagem quando prime
 * "Enviar" na conversa que se abre. Por isso cada destinatário só é
 * marcado como "entregue" depois de o operador confirmar que enviou.
 */
function WhatsAppQueueModal({
  notification,
  onMarkSent,
  onClose
}: {
  notification: SmsWhatsappNotification;
  onMarkSent: (recipientId: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const pending = notification.recipients.filter((r) => r.deliveryStatus === 'pendente');
  const [index, setIndex] = useState(0);
  const [marking, setMarking] = useState(false);
  const current = pending[index];
  const link = current ? buildWhatsAppLink(current.phone, notification.message) : null;

  const handleOpenAndAdvance = async () => {
    if (!current || !link) return;
    window.open(link, '_blank', 'noopener,noreferrer');
    setMarking(true);
    await onMarkSent(current.id);
    setMarking(false);
    setIndex((i) => i + 1);
  };

  const handleSkip = () => setIndex((i) => i + 1);

  const done = notification.recipients.filter((r) => r.deliveryStatus === 'entregue').length;
  const finished = index >= pending.length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col">
        <FormModalHeader
          title="Fila de Envio WhatsApp (real)"
          subtitle={`${notification.code} — ${notification.title}`}
          icon="chat"
          onClose={onClose}
        />
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-blue-50 text-[#0b1f3a] p-3 rounded-lg leading-relaxed">
            Ao clicar em <span className="font-bold">"Abrir WhatsApp e Enviar"</span>, o WhatsApp Web/Desktop (ou a
            app, no telemóvel) abre-se numa nova aba com a conversa e a mensagem já preenchidas. A mensagem só é
            despachada de verdade quando premir <span className="font-bold">Enviar dentro do WhatsApp</span>.
          </div>

          {finished ? (
            <div className="text-center py-6">
              <span className="material-symbols-outlined text-emerald-600 text-[40px]">task_alt</span>
              <p className="font-bold text-slate-800 mt-2">Fila concluída.</p>
              <p className="text-slate-500 mt-1">
                {done} de {notification.recipients.length} destinatário(s) marcados como entregues.
              </p>
            </div>
          ) : current ? (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold uppercase">
                <span>
                  Destinatário {index + 1} de {pending.length}
                </span>
                <span>
                  {done}/{notification.recipients.length} entregues
                </span>
              </div>
              <div>
                <p className="font-bold text-slate-900">{current.name}</p>
                <p className="text-slate-500 font-mono">{current.phone}</p>
                {current.studentName && <p className="text-slate-400">Aluno: {current.studentName}</p>}
              </div>
              <p className="text-slate-700 whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg">{notification.message}</p>
              {!link && (
                <p className="text-red-600 font-semibold">
                  Número de telefone inválido para WhatsApp — não é possível gerar o link de envio.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSkip}
                  disabled={marking}
                  className="h-9 px-4 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg"
                >
                  Saltar
                </button>
                <button
                  onClick={handleOpenAndAdvance}
                  disabled={!link || marking}
                  className="flex-1 h-9 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  {marking ? 'A registar...' : 'Abrir WhatsApp e Enviar'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="h-9 px-4 text-xs font-bold text-slate-600">
            {finished ? 'Fechar' : 'Terminar mais tarde'}
          </button>
        </div>
      </div>
    </div>
  );
}

const RULE_NOTIF = 'comunicacao.notificacoes.manage';

function NotificacoesTab({ db, currentUserRole, acl, run }: TabProps) {
  const canManage = acl.can(RULE_NOTIF);
  const notifications = db.smsWhatsappNotifications || [];
  const students = db.students || [];
  const classes = db.classes || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<(typeof notifications)[number] | null>(null);
  const [deleting, setDeleting] = useState<(typeof notifications)[number] | null>(null);
  const [formError, setFormError] = useState('');
  const [sendingQueue, setSendingQueue] = useState<SmsWhatsappNotification | null>(null);

  const [channel, setChannel] = useState<CommunicationChannel>('sms');
  const [audienceType, setAudienceType] = useState<NotificationAudienceType>('toda_escola');
  const [classId, setClassId] = useState('');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [critical, setCritical] = useState(false);
  const [channels, setChannels] = useState<ChannelsEnabled>(NO_CHANNELS);
  useEffect(() => { let on = true; void notificationChannelsEnabled().then((c) => { if (on) setChannels(c); }); return () => { on = false; }; }, []);

  const classOptions = useMemo(() => classes.map((c) => ({ value: c.id, label: c.name })), [classes]);
  const studentOptions = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: s.name, sublabel: `Nº ${s.procNumber}${s.className ? ' · ' + s.className : ''}` })),
    [students]
  );

  const q = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      notifications.filter(
        (n) => !q || n.title.toLowerCase().includes(q) || n.code.toLowerCase().includes(q) || n.message.toLowerCase().includes(q)
      ),
    [notifications, q]
  );
  const { page: pgA, setPage: setPgA, pageItems: visibleA } = usePagedList(filtered, [filtered.length]);

  const sentCount = notifications.filter((n) => n.status === 'enviada').length;
  const scheduledCount = notifications.filter((n) => n.status === 'agendada').length;
  const totalRecipients = notifications.reduce((sum, n) => sum + n.sentCount, 0);

  const resetForm = () => {
    setChannel(channels.push ? 'push' : 'sms');
    setCritical(false);
    setAudienceType('toda_escola');
    setClassId('');
    setStudentIds([]);
    setTitle('');
    setMessage('');
    setScheduledFor('');
    setFormError('');
  };

  const openNew = () => {
    setEditingId(null);
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (n: (typeof notifications)[number]) => {
    setEditingId(n.id);
    setChannel(n.channel);
    setAudienceType(n.audienceType);
    setClassId(n.classId || '');
    setStudentIds(n.studentIds || []);
    setTitle(n.title);
    setMessage(n.message);
    setScheduledFor(n.scheduledFor || '');
    setCritical(n.critical === true);
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSubmit = async () => {
    const { ok, error } = await run(
      () => {
        const result = dbService.saveNotificationDraft({
          id: editingId || undefined,
          channel,
          audienceType,
          classId: audienceType === 'turma' ? classId : undefined,
          studentIds: audienceType === 'aluno' ? studentIds : undefined,
          title,
          message,
          critical,
          scheduledFor: scheduledFor || undefined
        });
        if (!result.success) throw new Error(result.error || 'Não foi possível guardar a notificação.');
      },
      editingId ? 'A atualizar notificação...' : 'A criar notificação...',
      RULE_NOTIF
    );
    if (ok) {
      setIsFormOpen(false);
      resetForm();
    } else {
      setFormError(error || 'Ocorreu um erro.');
    }
  };

  // Com o servidor de notificações configurado (Configurações → Integrações) o envio é
  // feito de verdade pelo fornecedor. Sem ele, só o WhatsApp manual (wa.me) está disponível.
  // Também conta o que a escola ligou por conta própria (push, SMS, WhatsApp) em Integrações → Notificações.
  const gatewayOn = isGatewayConfigured({ url: db.settings?.integrations?.notifyGatewayUrl }) || channels.push || channels.sms || channels.whatsapp;

  const handleSend = async (id: string) => {
    if (gatewayOn) {
      const { ok } = await run(
        async () => {
          const result = await dbService.dispatchNotificationViaGateway(id);
          if (!result.success) throw new Error(result.error || 'O fornecedor não aceitou nenhuma mensagem.');
        },
        'A enviar pelo servidor de notificações...',
        RULE_NOTIF
      );
      // O modal de erro já é mostrado pelo runGlobalOperation.
      if (!ok) return;
      return;
    }
    let sent: SmsWhatsappNotification | undefined;
    const { ok } = await run(
      () => {
        const result = dbService.sendNotification(id);
        if (!result.success) throw new Error(result.error);
        sent = result.notification;
      },
      'A preparar notificação...',
      RULE_NOTIF
    );
    if (!ok) return;
    // Canal WhatsApp (ou "Ambos"): abre de imediato a fila de despacho manual (wa.me),
    // para o operador ir enviando cada mensagem uma a uma.
    const usesWhatsApp = sent && (sent.channel === 'whatsapp' || sent.channel === 'ambos');
    const hasPending = sent?.recipients.some((r) => r.deliveryStatus === 'pendente');
    if (usesWhatsApp && hasPending && sent) {
      setSendingQueue(sent);
    }
  };

  const handleMarkWhatsAppSent = async (recipientId: string) => {
    if (!sendingQueue) return;
    const result = dbService.markWhatsAppRecipientSent(sendingQueue.id, recipientId);
    if (result.success && result.notification) {
      setSendingQueue(result.notification);
      if (viewing && viewing.id === result.notification.id) setViewing(result.notification);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await run(
      () => {
        const result = dbService.deleteSmsWhatsappNotification(deleting.id);
        if (!result.success) throw new Error(result.error);
      },
      'A eliminar notificação...',
      RULE_NOTIF
    );
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        subsection="NOTIFICAÇÃO SMS/WHATSAPP"
        title="NOTIFICAÇÕES EM MASSA"
        description={gatewayOn ? "Envio de mensagens a encarregados de educação, professores ou funcionários. O envio é feito pelo servidor de notificações da escola" : "Envio de mensagens a encarregados de educação, professores ou funcionários. Sem servidor de notificações configurado."}
        actions={
          canManage && (
            <button
              onClick={openNew}
              className="h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold uppercase tracking-wide rounded-lg flex items-center gap-2 hover:bg-[#132a4d]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Nova Notificação
            </button>
          )
        }
      />

      <KpiGrid
        items={[
          { label: 'Total de Notificações', value: notifications.length, icon: 'sms' },
          { label: 'Enviadas', value: sentCount, icon: 'mark_email_read' },
          { label: 'Agendadas', value: scheduledCount, icon: 'schedule_send', tone: 'warn' },
          { label: 'Destinatários Alcançados', value: totalRecipients, icon: 'groups' }
        ]}
      />

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Pesquisar por título, código ou mensagem..." />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="sms" text="Nenhuma notificação encontrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-white">Código</th>
                  <th className="text-left px-4 py-3 text-white">Título</th>
                  <th className="text-left px-4 py-3 text-white">Canal</th>
                  <th className="text-left px-4 py-3 text-white">Público-Alvo</th>
                  <th className="text-left px-4 py-3 text-white">Estado</th>
                  <th className="text-left px-4 py-3 text-white">Destinatários</th>
                  <th className="text-right px-4 py-3 text-white">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleA.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-500">{n.code}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{n.title}</td>
                    <td className="px-4 py-3 text-slate-600">{CHANNEL_LABELS[n.channel]}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {AUDIENCE_TYPE_LABELS[n.audienceType]}
                      {n.className ? ` · ${n.className}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={NOTIFICATION_STATUS_META[n.status].badge}>{NOTIFICATION_STATUS_META[n.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{n.status === 'enviada' ? n.sentCount : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setViewing(n)} title="Ver detalhes" className="p-1.5 text-slate-500 hover:text-[#0b1f3a]">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {canManage && (n.status === 'rascunho' || n.status === 'agendada') && (
                          <>
                            <button onClick={() => openEdit(n)} title="Editar" className="p-1.5 text-slate-500 hover:text-[#0b1f3a]">
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button onClick={() => handleSend(n.id)} title={gatewayOn ? "Enviar pelo servidor (SMS/WhatsApp reais)" : "Enviar agora"} className="p-1.5 text-emerald-600 hover:text-emerald-800">
                              <span className="material-symbols-outlined text-[18px]">send</span>
                            </button>
                          </>
                        )}
                        {canManage &&
                          n.status === 'enviada' &&
                          (n.channel === 'whatsapp' || n.channel === 'ambos') &&
                          n.recipients.some((r) => r.deliveryStatus === 'pendente') && (
                            <button
                              onClick={() => setSendingQueue(n)}
                              title="Continuar fila de envio WhatsApp"
                              className="p-1.5 text-emerald-600 hover:text-emerald-800"
                            >
                              <span className="material-symbols-outlined text-[18px]">chat</span>
                            </button>
                          )}
                        {canManage && (
                          <button onClick={() => setDeleting(n)} title="Eliminar" className="p-1.5 text-red-500 hover:text-red-700">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={filtered.length} page={pgA} onPageChange={setPgA} />
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
            <FormModalHeader
              title={editingId ? 'Editar Notificação' : 'Nova Notificação'}
              subtitle="SMS / WhatsApp em massa"
              icon="sms"
              onClose={() => setIsFormOpen(false)}
            />
            <div className="p-6 space-y-4">
              {formError && <Notice tone="error">{formError}</Notice>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Canal</label>
                  <select value={channel} onChange={(e) => setChannel(e.target.value as CommunicationChannel)} className={inputCls}>
                    {Object.entries(CHANNEL_LABELS).filter(([k]) => k !== 'push' || channels.push || channel === 'push').map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Público-Alvo</label>
                  <select
                    value={audienceType}
                    onChange={(e) => setAudienceType(e.target.value as NotificationAudienceType)}
                    className={inputCls}
                  >
                    {Object.entries(AUDIENCE_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {channel === 'push' && (
                <Notice tone="info">
                  O push é grátis e chega só a quem activou as notificações na app (no iPhone, com a app instalada no ecrã inicial).
                </Notice>
              )}
              {channel !== 'push' && (
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="mt-0.5" />
                  <span>
                    <strong>Aviso crítico</strong> (ex.: propina em atraso).
                    {channels.sms && channels.smsCriticalOnly ? ' O SMS desta escola só segue avisos críticos.' : ' Os avisos normais devem ir por push, que é grátis.'}
                  </span>
                </label>
              )}
              {audienceType === 'turma' && (
                <SearchableSelect label="Turma" options={classOptions} value={classId} onChange={setClassId} placeholder="Selecione a turma" />
              )}
              {audienceType === 'aluno' && (
                <div>
                  <label className={labelCls}>Alunos ({studentIds.length} selecionado(s))</label>
                  <div className="border border-slate-300 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                    {studentOptions.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={studentIds.includes(opt.value)}
                          onChange={(e) =>
                            setStudentIds((prev) => (e.target.checked ? [...prev, opt.value] : prev.filter((id) => id !== opt.value)))
                          }
                        />
                        <span className="font-semibold text-slate-700">{opt.label}</span>
                        <span className="text-slate-400">{opt.sublabel}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Título/Assunto</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Ex.: Suspensão de aulas" />
              </div>
              <div>
                <label className={labelCls}>Mensagem ({message.length}/480)</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={480} className={textareaCls} />
              </div>
              <div>
                <label className={labelCls}>Agendar Envio Para (opcional)</label>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsFormOpen(false)} className="h-9 px-4 text-xs font-bold text-slate-600">
                Cancelar
              </button>
              <button onClick={handleSubmit} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <FormModalHeader title={viewing.title} subtitle={viewing.code} icon="sms" onClose={() => setViewing(null)} />
            <div className="p-6 space-y-3 text-xs">
              <p className="text-slate-700 whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg">{viewing.message}</p>
              <div className="grid grid-cols-2 gap-3 text-slate-600">
                <div>
                  <span className="font-bold text-slate-800">Canal:</span> {CHANNEL_LABELS[viewing.channel]}
                </div>
                <div>
                  <span className="font-bold text-slate-800">Estado:</span> {NOTIFICATION_STATUS_META[viewing.status].label}
                </div>
                <div>
                  <span className="font-bold text-slate-800">Criada por:</span> {viewing.createdBy}
                </div>
                <div>
                  <span className="font-bold text-slate-800">Em:</span> {fmtDateTime(viewing.createdAt)}
                </div>
              </div>
              {viewing.recipients.length > 0 && (
                <div>
                  <p className="font-bold text-slate-800 mb-1">Destinatários ({viewing.recipients.length})</p>
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                    {viewing.recipients.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                        <span className="text-slate-700 truncate">{r.name} — {r.phone}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            tone={
                              r.deliveryStatus === 'entregue'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.deliveryStatus === 'pendente'
                                ? 'bg-amber-100 text-amber-800'
                                : r.deliveryStatus === 'na_fila'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-red-100 text-red-800'
                            }
                          >
                            {r.deliveryStatus === 'na_fila' ? 'na fila' : r.deliveryStatus}
                          </Badge>
                          {r.deliveryStatus === 'pendente' && (viewing.channel === 'whatsapp' || viewing.channel === 'ambos') && (
                            <button
                              onClick={() => setSendingQueue(viewing)}
                              title="Enviar via fila de WhatsApp"
                              className="p-1 text-emerald-600 hover:text-emerald-800"
                            >
                              <span className="material-symbols-outlined text-[16px]">chat</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AppConfirmModal
        isOpen={!!deleting}
        title="Eliminar Notificação"
        message={`Tem a certeza que pretende eliminar a notificação "${deleting?.title}"? Esta ação não pode ser revertida.`}
        variant="error"
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      {sendingQueue && (
        <WhatsAppQueueModal
          notification={sendingQueue}
          onMarkSent={handleMarkWhatsAppSent}
          onClose={() => setSendingQueue(null)}
        />
      )}
    </div>
  );
}

// =============================================================
// 3. Reuniões Pais-Professores
// =============================================================

const RULE_MEETING = 'comunicacao.reunioes.manage';

function ReunioesTab({ db, currentUserRole, acl, run }: TabProps) {
  const canManage = acl.can(RULE_MEETING);
  const meetings = db.parentTeacherMeetings || [];
  const students = db.students || [];
  const classes = db.classes || [];
  const teachers = db.teachers || [];

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<(typeof meetings)[number] | null>(null);
  const [deleting, setDeleting] = useState<(typeof meetings)[number] | null>(null);
  const [completing, setCompleting] = useState<(typeof meetings)[number] | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [formError, setFormError] = useState('');

  const [type, setType] = useState<MeetingType>('individual');
  const [title, setTitle] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState('');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  // Agenda/acta em PDF: ficheiro novo escolhido, remoção do existente e convocatória logo após guardar.
  const [agendaPdf, setAgendaPdf] = useState<File | null>(null);
  const [removePdf, setRemovePdf] = useState(false);
  const [notifyAfter, setNotifyAfter] = useState(false);
  const [noticeFor, setNoticeFor] = useState<(typeof meetings)[number] | null>(null);

  const teacherOptions = useMemo(() => teachers.map((t) => ({ value: t.id, label: t.name, sublabel: t.department })), [teachers]);
  const classOptions = useMemo(() => classes.map((c) => ({ value: c.id, label: c.name })), [classes]);
  const studentOptions = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active' && s.guardianName?.trim())
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
        .map((s) => ({ value: s.id, label: s.name, sublabel: `Enc.: ${s.guardianName}` })),
    [students]
  );

  const q = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      meetings.filter(
        (m) => !q || m.title.toLowerCase().includes(q) || m.code.toLowerCase().includes(q) || m.teacherName.toLowerCase().includes(q)
      ),
    [meetings, q]
  );
  const { page: pgB, setPage: setPgB, pageItems: visibleB } = usePagedList(filtered, [filtered.length]);

  const scheduledCount = meetings.filter((m) => m.status === 'agendada').length;
  const doneCount = meetings.filter((m) => m.status === 'realizada').length;

  const resetForm = () => {
    setType('individual');
    setTitle('');
    setTeacherId('');
    setClassId('');
    setStudentIds([]);
    setDate('');
    setStartTime('');
    setEndTime('');
    setLocation('');
    setAgenda('');
    setAgendaPdf(null);
    setRemovePdf(false);
    setNotifyAfter(false);
    setFormError('');
  };

  const openNew = () => {
    setEditingId(null);
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (m: (typeof meetings)[number]) => {
    setEditingId(m.id);
    setAgendaPdf(null);
    setRemovePdf(false);
    setNotifyAfter(false);
    setType(m.type);
    setTitle(m.title);
    setTeacherId(m.teacherId);
    setClassId(m.classId || '');
    setStudentIds(m.participants.map((p) => p.studentId));
    setDate(m.date);
    setStartTime(m.startTime);
    setEndTime(m.endTime);
    setLocation(m.location || '');
    setAgenda(m.agenda || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSubmit = async () => {
    if (agendaPdf && !(agendaPdf.type === 'application/pdf' || /\.pdf$/i.test(agendaPdf.name))) {
      setFormError('A agenda tem de ser um ficheiro PDF.');
      return;
    }
    if (agendaPdf && agendaPdf.size > 5 * 1024 * 1024) {
      setFormError('O PDF é demasiado grande (máximo 5 MB).');
      return;
    }
    let savedId = editingId || '';
    const { ok, error } = await run(
      async () => {
        const result = dbService.saveMeeting({
          id: editingId || undefined,
          type,
          title,
          teacherId,
          classId: type === 'coletiva' ? classId : undefined,
          studentIds: type === 'individual' ? studentIds : undefined,
          date,
          startTime,
          endTime,
          location: location || undefined,
          agenda: agenda || undefined
        });
        if (!result.success) throw new Error(result.error || 'Não foi possível guardar a reunião.');
        savedId = result.meeting?.id || savedId;
        // A reunião já está guardada: o PDF é um passo à parte (precisa de ligação ao servidor).
        if (savedId && removePdf && !agendaPdf) await dbService.removeMeetingAgendaFile(savedId);
        if (savedId && agendaPdf) {
          const up = await dbService.attachMeetingAgendaFile(savedId, agendaPdf);
          if (!up.success) throw new Error(`A reunião foi guardada, mas o PDF não seguiu: ${up.error}`);
        }
      },
      editingId ? 'A atualizar reunião...' : 'A agendar reunião...',
      RULE_MEETING
    );
    if (ok) {
      setIsFormOpen(false);
      const wantNotice = notifyAfter;
      resetForm();
      if (wantNotice && savedId) {
        const fresh = dbService.getMeetings().find((x) => x.id === savedId);
        if (fresh) setNoticeFor(fresh);
      }
    } else {
      setFormError(error || 'Ocorreu um erro.');
    }
  };

  const handleParticipantStatus = (meetingId: string, studentId: string, status: MeetingParticipantStatus) =>
    run(
      () => {
        const result = dbService.updateMeetingParticipantStatus(meetingId, studentId, status);
        if (!result.success) throw new Error(result.error);
      },
      'A atualizar participante...',
      RULE_MEETING
    );

  const handleComplete = async () => {
    if (!completing) return;
    const { ok } = await run(
      () => {
        const result = dbService.completeMeeting(completing.id, summaryText);
        if (!result.success) throw new Error(result.error);
      },
      'A concluir reunião...',
      RULE_MEETING
    );
    if (ok) {
      setCompleting(null);
      setSummaryText('');
    }
  };

  const handleCancel = (id: string) =>
    run(
      () => {
        const result = dbService.cancelMeeting(id);
        if (!result.success) throw new Error(result.error);
      },
      'A cancelar reunião...',
      RULE_MEETING
    );

  const handleDelete = async () => {
    if (!deleting) return;
    await run(
      () => {
        const result = dbService.deleteMeeting(deleting.id);
        if (!result.success) throw new Error(result.error);
      },
      'A eliminar reunião...',
      RULE_MEETING
    );
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        subsection="REUNIÕES ESCOLAR"
        title="REUNIÕES DE PAIS-ENCARREGADOS"
        description="Agendamento de reuniões individuais ou coletivas (turma inteira), com lista de participantes."
        actions={
          canManage && (
            <button
              onClick={openNew}
              className="h-10 px-4 bg-[#0b1f3a] text-white text-xs font-bold uppercase tracking-wide rounded-lg flex items-center gap-2 hover:bg-[#132a4d]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Nova Reunião
            </button>
          )
        }
      />

      <KpiGrid
        items={[
          { label: 'Total de Reuniões', value: meetings.length, icon: 'groups_2' },
          { label: 'Agendadas', value: scheduledCount, icon: 'event_upcoming', tone: 'warn' },
          { label: 'Realizadas', value: doneCount, icon: 'task_alt' },
          { label: 'Participantes Convocados', value: meetings.reduce((s, m) => s + m.participants.length, 0), icon: 'diversity_3' }
        ]}
      />

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Pesquisar por título, código ou professor..." />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="groups_2" text="Nenhuma reunião encontrada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-white">Código</th>
                  <th className="text-left px-4 py-3 text-white">Título</th>
                  <th className="text-left px-4 py-3 text-white">Tipo</th>
                  <th className="text-left px-4 py-3 text-white">Professor</th>
                  <th className="text-left px-4 py-3 text-white">Data/Hora</th>
                  <th className="text-left px-4 py-3 text-white">Estado</th>
                  <th className="text-right px-4 py-3 text-white">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleB.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-500">{m.code}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{m.title}</td>
                    <td className="px-4 py-3 text-slate-600">{MEETING_TYPE_LABELS[m.type]}</td>
                    <td className="px-4 py-3 text-slate-600">{m.teacherName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {fmtDate(m.date)} · {m.startTime}–{m.endTime}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={MEETING_STATUS_META[m.status].badge}>{MEETING_STATUS_META[m.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && m.status === 'agendada' && (
                          <button onClick={() => setNoticeFor(m)} title="Convocar encarregados por SMS / WhatsApp" className="p-1.5 text-emerald-600 hover:text-emerald-800">
                            <span className="material-symbols-outlined text-[18px]">campaign</span>
                          </button>
                        )}
                        {m.agendaFile && (
                          <span title={`Agenda em PDF: ${m.agendaFile.name}`} className="p-1.5 text-red-600 inline-flex">
                            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                          </span>
                        )}
                        {m.status !== 'cancelada' && (
                          <button
                            onClick={() => printMeetingAttendance(m, { schoolName: db.settings?.schoolName, logoUrl: db.settings?.logoUrl, typeLabel: MEETING_TYPE_LABELS[m.type] })}
                            title="Imprimir lista de presença (com assinatura)"
                            className="p-1.5 text-slate-500 hover:text-[#0b1f3a]"
                          >
                            <span className="material-symbols-outlined text-[18px]">print</span>
                          </button>
                        )}
                        <button onClick={() => setViewing(m)} title="Ver participantes" className="p-1.5 text-slate-500 hover:text-[#0b1f3a]">
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                        </button>
                        {canManage && m.status === 'agendada' && (
                          <>
                            <button onClick={() => openEdit(m)} title="Editar" className="p-1.5 text-slate-500 hover:text-[#0b1f3a]">
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => {
                                setCompleting(m);
                                setSummaryText(m.summary || '');
                              }}
                              title="Marcar como realizada"
                              className="p-1.5 text-emerald-600 hover:text-emerald-800"
                            >
                              <span className="material-symbols-outlined text-[18px]">task_alt</span>
                            </button>
                            <button onClick={() => handleCancel(m.id)} title="Cancelar" className="p-1.5 text-amber-600 hover:text-amber-800">
                              <span className="material-symbols-outlined text-[18px]">event_busy</span>
                            </button>
                          </>
                        )}
                        {canManage && (
                          <button onClick={() => setDeleting(m)} title="Eliminar" className="p-1.5 text-red-500 hover:text-red-700">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination total={filtered.length} page={pgB} onPageChange={setPgB} />
          </div>
        )}
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
            <FormModalHeader
              title={editingId ? 'Editar Reunião' : 'Nova Reunião'}
              subtitle="Pais / Encarregados de Educação"
              icon="groups_2"
              onClose={() => setIsFormOpen(false)}
            />
            <div className="p-6 space-y-4">
              {formError && <Notice tone="error">{formError}</Notice>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Tipo de Reunião</label>
                  <select value={type} onChange={(e) => setType(e.target.value as MeetingType)} className={inputCls}>
                    {Object.entries(MEETING_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <SearchableSelect label="Professor Responsável" options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Selecione o professor" />
              </div>
              <div>
                <label className={labelCls}>Título/Motivo</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Ex.: Ponto de situação do trimestre" />
              </div>
              {type === 'coletiva' ? (
                <SearchableSelect label="Turma" options={classOptions} value={classId} onChange={setClassId} placeholder="Selecione a turma" />
              ) : (
                <div>
                  <label className={labelCls}>Alunos/Encarregados ({studentIds.length} selecionado(s))</label>
                  <div className="border border-slate-300 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                    {studentOptions.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={studentIds.includes(opt.value)}
                          onChange={(e) =>
                            setStudentIds((prev) => (e.target.checked ? [...prev, opt.value] : prev.filter((id) => id !== opt.value)))
                          }
                        />
                        <span className="font-semibold text-slate-700">{opt.label}</span>
                        <span className="text-slate-400">{opt.sublabel}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Data</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Hora Início</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Hora Fim</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Local (opcional)</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="Ex.: Sala de Reuniões" />
              </div>
              <div>
                <label className={labelCls}>Agenda (opcional)</label>
                <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} className={textareaCls} />
              </div>
              <div>
                <label className={labelCls}>Agenda / Acta da reunião em PDF (opcional)</label>
                {(() => {
                  const existing = editingId ? meetings.find((x) => x.id === editingId)?.agendaFile : undefined;
                  return (
                    <div className="space-y-2">
                      {existing && !removePdf && !agendaPdf && (
                        <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="material-symbols-outlined text-[18px] text-red-600">picture_as_pdf</span>
                            <span className="truncate font-semibold text-slate-700">{existing.name}</span>
                          </span>
                          <button type="button" onClick={() => setRemovePdf(true)} className="text-red-600 font-bold shrink-0">Remover</button>
                        </div>
                      )}
                      {removePdf && !agendaPdf && (
                        <p className="text-[11px] text-amber-700">O PDF atual será removido ao guardar. <button type="button" onClick={() => setRemovePdf(false)} className="font-bold underline">Desfazer</button></p>
                      )}
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => { setAgendaPdf(e.target.files?.[0] || null); setRemovePdf(false); }}
                        className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:px-3 file:border-0 file:rounded-lg file:bg-slate-100 file:text-[#0b1f3a] file:font-bold file:cursor-pointer"
                      />
                      <p className="text-[11px] text-slate-500">Máximo 5 MB. No WhatsApp o ficheiro segue directamente; por SMS segue um link para o descarregar.</p>
                    </div>
                  );
                })()}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={notifyAfter} onChange={(e) => setNotifyAfter(e.target.checked)} />
                <span className="font-semibold">Convocar os encarregados por SMS / WhatsApp depois de guardar</span>
              </label>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsFormOpen(false)} className="h-9 px-4 text-xs font-bold text-slate-600">
                Cancelar
              </button>
              <button onClick={handleSubmit} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <FormModalHeader title={viewing.title} subtitle={viewing.code} icon="groups_2" onClose={() => setViewing(null)} />
            <div className="p-6 space-y-3 text-xs">
              {viewing.summary && (
                <div>
                  <p className="font-bold text-slate-800 mb-1">Resumo Final</p>
                  <p className="text-slate-700 bg-slate-50 p-3 rounded-lg whitespace-pre-wrap break-words">{viewing.summary}</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-800">Participantes ({viewing.participants.length})</p>
                {canManage && viewing.status === 'agendada' && (
                  <button
                    type="button"
                    onClick={() => { const v = viewing; setViewing(null); setNoticeFor(v); }}
                    className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-bold flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">campaign</span>
                    Convocar
                  </button>
                )}
                {viewing.status !== 'cancelada' && (
                  <button
                    type="button"
                    onClick={() => printMeetingAttendance(viewing, { schoolName: db.settings?.schoolName, logoUrl: db.settings?.logoUrl, typeLabel: MEETING_TYPE_LABELS[viewing.type] })}
                    className="h-8 px-3 rounded-lg bg-[#0b1f3a] text-white text-[11px] font-bold flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">print</span>
                    Imprimir lista de presença
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {viewing.participants.map((p) => (
                  <div key={p.studentId} className="flex items-center justify-between px-3 py-2 gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 truncate">{p.studentName}</p>
                      <p className="text-slate-400 truncate">{p.guardianName}</p>
                    </div>
                    {canManage && viewing.status === 'agendada' ? (
                      <select
                        value={p.status}
                        onChange={(e) => handleParticipantStatus(viewing.id, p.studentId, e.target.value as MeetingParticipantStatus)}
                        className="h-8 px-2 text-[11px] border border-slate-300 rounded"
                      >
                        {Object.entries(PARTICIPANT_STATUS_META).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={PARTICIPANT_STATUS_META[p.status].badge}>{PARTICIPANT_STATUS_META[p.status].label}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {completing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md flex flex-col">
            <FormModalHeader title="Concluir Reunião" subtitle={completing.title} icon="task_alt" onClose={() => setCompleting(null)} />
            <div className="p-6 space-y-3">
              <label className={labelCls}>Resumo da Reunião</label>
              <textarea value={summaryText} onChange={(e) => setSummaryText(e.target.value)} rows={5} className={textareaCls} />
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setCompleting(null)} className="h-9 px-4 text-xs font-bold text-slate-600">
                Cancelar
              </button>
              <button onClick={handleComplete} className="h-9 px-5 bg-[#0b1f3a] text-white text-xs font-bold rounded-lg">
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {noticeFor && <MeetingNoticeModal meeting={noticeFor} db={db} onClose={() => setNoticeFor(null)} />}

      <AppConfirmModal
        isOpen={!!deleting}
        title="Eliminar Reunião"
        message={`Tem a certeza que pretende eliminar a reunião "${deleting?.title}"? Esta ação não pode ser revertida.`}
        variant="error"
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}


