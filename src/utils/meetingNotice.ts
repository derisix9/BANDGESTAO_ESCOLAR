/**
 * Convocatória de reunião de pais/encarregados por SMS e WhatsApp (parte pura, testável).
 *  • WhatsApp: leva o texto com os detalhes e o PDF da agenda/acta é enviado DIRECTAMENTE (anexo), quando o fornecedor
 *    tem um modelo com documento; senão segue o texto com o link.
 *  • SMS: não leva ficheiros — o texto leva o LINK de descarga do PDF.
 */
import type { ParentTeacherMeeting } from '../types';
import { toE164 } from './notificationGateway';

export const MEETING_NOTICE_MAX = 480;

const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, Math.max(0, n - 1)).trimEnd()}…` : v);
const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso);

/** Endereço público (sem login) de descarga do PDF — função `meeting-file` do Supabase. */
export function meetingFileLink(supabaseUrl: string, institutionId: string, m: Pick<ParentTeacherMeeting, 'id' | 'agendaFile'>): string | null {
  if (!m.agendaFile?.token || !supabaseUrl || !institutionId) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/functions/v1/meeting-file?i=${encodeURIComponent(institutionId)}&m=${encodeURIComponent(m.id)}&t=${encodeURIComponent(m.agendaFile.token)}`;
}

export interface MeetingNoticeRecipient {
  /** Identificador estável do destinatário (um por número de telefone). */
  id: string;
  phone: string;
  guardianName: string;
  studentNames: string[];
}

/** Um destinatário por número de telefone (um encarregado com vários educandos recebe uma única mensagem). */
export function meetingNoticeRecipients(m: ParentTeacherMeeting): { recipients: MeetingNoticeRecipient[]; withoutPhone: string[] } {
  const byPhone = new Map<string, MeetingNoticeRecipient>();
  const withoutPhone: string[] = [];
  for (const p of m.participants || []) {
    const e164 = toE164(p.guardianPhone);
    if (!e164) { withoutPhone.push(p.studentName); continue; }
    const cur = byPhone.get(e164);
    if (cur) { if (!cur.studentNames.includes(p.studentName)) cur.studentNames.push(p.studentName); continue; }
    byPhone.set(e164, { id: `${m.id}:${e164.replace(/\D/g, '')}`, phone: e164, guardianName: p.guardianName, studentNames: [p.studentName] });
  }
  return { recipients: [...byPhone.values()], withoutPhone };
}

export interface MeetingMessageOpts {
  schoolName?: string;
  /** Link de descarga do PDF (se a reunião tiver agenda anexada). */
  link?: string | null;
}

/** Texto da convocatória (≤ 480 caracteres, o limite do servidor). O link nunca é cortado. */
export function buildMeetingNoticeText(channel: 'sms' | 'whatsapp', m: ParentTeacherMeeting, r: Pick<MeetingNoticeRecipient, 'studentNames'>, o: MeetingMessageOpts = {}): string {
  const school = clip(o.schoolName?.trim() || 'Escola', 40);
  const when = `${fmtDate(m.date)}, ${m.startTime}${m.endTime ? `–${m.endTime}` : ''}`;
  const where = m.location?.trim() ? clip(m.location.trim(), 50) : '';
  const kids = r.studentNames.length ? clip(r.studentNames.join(', '), 70) : '';
  const link = o.link || '';

  if (channel === 'sms') {
    const head = `${school}: reunião de pais "${clip(m.title, 50)}" a ${when}${where ? `, ${where}` : ''}.${kids ? ` Educando: ${kids}.` : ''}`;
    const tail = link ? ` Agenda: ${link}` : '';
    return clip(head, MEETING_NOTICE_MAX - tail.length) + tail;
  }
  const lines = [
    `${school} — convocatória de reunião de pais/encarregados`,
    `Assunto: ${clip(m.title, 100)}`,
    `Data: ${when}`,
    where ? `Local: ${where}` : '',
    kids ? `Educando(s): ${kids}` : ''
  ].filter(Boolean);
  const tail = link ? `\nAgenda/acta (PDF): ${link}` : '';
  return clip(lines.join('\n'), MEETING_NOTICE_MAX - tail.length) + tail;
}
