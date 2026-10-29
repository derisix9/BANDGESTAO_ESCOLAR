import React, { useEffect, useMemo, useState } from 'react';
import type { ParentTeacherMeeting, SchoolDatabase } from '../types';
import { dbService } from '../services/db';
import { FormModalHeader } from './FormModalHeader';
import { Notice } from './Notice';
import { Spinner } from './Spinner';
import { buildMeetingNoticeText, meetingNoticeRecipients } from '../utils/meetingNotice';
import { isGatewayConfigured, smsSegments } from '../utils/notificationGateway';
import { NO_CHANNELS, type ChannelsEnabled } from '../utils/notificationChannelsApi';
import { notificationChannelsEnabled } from '../services/notificationChannels';
import { buildWhatsAppLink } from '../utils/comunicacao';

type Channel = 'sms' | 'whatsapp' | 'ambos';

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Convocatória de uma reunião aos encarregados selecionados (SMS e/ou WhatsApp), com os detalhes da reunião.
 *  • WhatsApp: o PDF da agenda segue directamente (anexo); sem fornecedor ligado, abre-se o WhatsApp de cada encarregado
 *    (envio manual, com o link do PDF no texto).
 *  • SMS: o texto leva o link de descarga do PDF.
 */
export const MeetingNoticeModal: React.FC<{
  meeting: ParentTeacherMeeting;
  db: SchoolDatabase;
  onClose: () => void;
}> = ({ meeting, db, onClose }) => {
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [channels, setChannels] = useState<ChannelsEnabled>(NO_CHANNELS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { sent: number; failed: number; warnings: string[] }>(null);
  const [manualOpened, setManualOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    let on = true;
    void notificationChannelsEnabled().then((c) => { if (on) setChannels(c); }).catch(() => undefined);
    return () => { on = false; };
  }, []);

  // Sempre a versão mais recente da reunião (o PDF pode ter sido anexado agora mesmo).
  const m = (db.parentTeacherMeetings || []).find((x) => x.id === meeting.id) || meeting;
  const link = dbService.getMeetingFileLink(m.id);
  const { recipients, withoutPhone } = useMemo(() => meetingNoticeRecipients(m), [m]);
  const legacy = isGatewayConfigured({ url: db.settings?.integrations?.notifyGatewayUrl });
  const smsOn = channels.sms || legacy;
  const waOn = channels.whatsapp || legacy;
  const schoolName = db.settings?.schoolName;

  const sample = recipients[0];
  const smsText = sample ? buildMeetingNoticeText('sms', m, sample, { schoolName, link }) : '';
  const waText = sample ? buildMeetingNoticeText('whatsapp', m, sample, { schoolName, link }) : '';
  const seg = smsText ? smsSegments(smsText) : { segments: 0, encoding: 'GSM-7' as const };
  const wantsSms = channel === 'sms' || channel === 'ambos';
  const wantsWa = channel === 'whatsapp' || channel === 'ambos';
  const totalSms = wantsSms ? seg.segments * recipients.length : 0;

  // Sem fornecedor de WhatsApp ligado, só o envio manual (wa.me) é possível — e só para o canal WhatsApp.
  const manualWa = channel === 'whatsapp' && !waOn;
  const blocked =
    (wantsSms && !smsOn && 'O SMS não está ligado nesta escola. Ligue um fornecedor em Configurações → Integrações → Notificações.') ||
    (channel === 'ambos' && !waOn && 'Para enviar por SMS + WhatsApp ligue também o WhatsApp em Configurações → Integrações → Notificações.') ||
    '';

  const send = async () => {
    setError(''); setBusy(true);
    try {
      const r = await dbService.dispatchMeetingNotice(m.id, channel);
      if (!r.success) setError(r.error || 'Não foi possível enviar a convocatória.');
      else setDone({ sent: r.sent || 0, failed: r.failed || 0, warnings: r.warnings || [] });
    } catch (e: any) {
      setError(e?.message || 'Não foi possível enviar a convocatória.');
    } finally { setBusy(false); }
  };

  const openManual = (id: string, phone: string, studentNames: string[]) => {
    const text = buildMeetingNoticeText('whatsapp', m, { studentNames }, { schoolName, link });
    const url = buildWhatsAppLink(phone, text);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
    setManualOpened((s) => new Set(s).add(id));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto flex flex-col">
        <FormModalHeader title="Convocar encarregados" subtitle={`${m.code} — ${m.title}`} icon="campaign" onClose={onClose} />
        <div className="p-6 space-y-4 text-xs">
          {error && <Notice tone="error">{error}</Notice>}
          {done && (
            <Notice tone="success" icon="mark_chat_read">
              Convocatória aceite para {done.sent} mensagem(ns){done.failed ? ` (${done.failed} recusada(s))` : ''}. O envio segue pelo fornecedor ligado à escola.
            </Notice>
          )}
          {done?.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
            <div className="font-bold text-slate-800">{recipients.length} encarregado(s) com telefone válido</div>
            <div className="text-slate-500">de {m.participants.length} convocado(s). Um encarregado com vários educandos recebe uma só mensagem.</div>
            {withoutPhone.length > 0 && (
              <div className="text-amber-700">Sem telefone válido (não recebem): {withoutPhone.slice(0, 6).join(', ')}{withoutPhone.length > 6 ? ` e mais ${withoutPhone.length - 6}` : ''}.</div>
            )}
          </div>

          <div>
            <div className="uppercase font-bold text-slate-700 mb-1 text-[11px]">Enviar por</div>
            <div className="grid grid-cols-3 gap-2">
              {([['whatsapp', 'WhatsApp', 'chat'], ['sms', 'SMS', 'sms'], ['ambos', 'SMS + WhatsApp', 'forum']] as Array<[Channel, string, string]>).map(([k, label, icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setChannel(k); setDone(null); setError(''); }}
                  className={`h-10 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 ${channel === k ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                >
                  <span className="material-symbols-outlined text-[16px]">{icon}</span>{label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-1">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <span className="material-symbols-outlined text-[18px] text-red-700">picture_as_pdf</span>
              {m.agendaFile ? `${m.agendaFile.name} · ${fmtBytes(m.agendaFile.size)}` : 'Sem agenda/acta em PDF anexada'}
            </div>
            <div className="text-slate-500">
              {m.agendaFile
                ? <>WhatsApp: o PDF é enviado directamente na conversa (se o fornecedor tiver o modelo com documento; senão segue o link). SMS: o texto leva o link para descarregar o PDF.</>
                : <>A mensagem leva só os detalhes da reunião. Para incluir a agenda, anexe o PDF ao editar a reunião.</>}
            </div>
          </div>

          {wantsWa && waText && (
            <div>
              <div className="uppercase font-bold text-slate-700 mb-1 text-[11px]">Pré-visualização — WhatsApp</div>
              <p className="whitespace-pre-wrap break-words bg-emerald-50 text-slate-800 p-3 rounded-lg">{waText}</p>
            </div>
          )}
          {wantsSms && smsText && (
            <div>
              <div className="uppercase font-bold text-slate-700 mb-1 text-[11px]">Pré-visualização — SMS</div>
              <p className="whitespace-pre-wrap break-words bg-blue-50 text-slate-800 p-3 rounded-lg">{smsText}</p>
              <p className="text-slate-500 mt-1">
                {seg.segments} segmento(s) por mensagem ({seg.encoding}) · cerca de <strong>{totalSms} SMS</strong> no total. A convocatória conta como aviso crítico.
              </p>
            </div>
          )}

          {blocked && <Notice tone="warn">{blocked}</Notice>}

          {manualWa && recipients.length > 0 && (
            <div className="space-y-2">
              <Notice tone="info">
                O WhatsApp ainda não está ligado a um fornecedor, por isso o envio é manual: abra a conversa de cada encarregado e prima «Enviar».
                O PDF segue como link no texto (o WhatsApp não permite anexar ficheiros por este método).
              </Notice>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                {recipients.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 truncate">{r.guardianName}</p>
                      <p className="text-slate-400 truncate">{r.phone} · {r.studentNames.join(', ')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openManual(r.id, r.phone, r.studentNames)}
                      className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0 ${manualOpened.has(r.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]">{manualOpened.has(r.id) ? 'check' : 'open_in_new'}</span>
                      {manualOpened.has(r.id) ? 'Aberto' : 'Abrir WhatsApp'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(m.noticeLog?.length || 0) > 0 && (
            <div className="text-slate-500">
              Último envio: {new Date(m.noticeLog![0].at).toLocaleString('pt-PT')} por {m.noticeLog![0].by} ({m.noticeLog![0].sent} aceite(s){m.noticeLog![0].failed ? `, ${m.noticeLog![0].failed} recusada(s)` : ''}).
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 text-xs font-bold text-slate-600">{done ? 'Fechar' : 'Cancelar'}</button>
          {!manualWa && (
            <button
              onClick={send}
              disabled={busy || !recipients.length || !!blocked || !!done}
              className="h-9 px-5 bg-[#0b1f3a] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2"
            >
              {busy ? <><Spinner size={14} className="text-white" /> A enviar…</> : <><span className="material-symbols-outlined text-[16px]">send</span> Enviar convocatória</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
