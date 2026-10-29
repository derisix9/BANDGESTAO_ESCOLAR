/**
 * Que canal para que aviso (parte pura):
 *   • push  → avisos normais (grátis); a audiência é resolvida no SERVIDOR a partir dos ids (nunca de telefones);
 *   • SMS   → só avisos críticos (ex.: propina em atraso) quando a escola deixou "só crítico" ligado (omissão);
 *   • WhatsApp → só com modelo aprovado (configurado em Integrações).
 */
import type { CommunicationChannel, NotificationAudienceType, Student } from '../types';
import type { ChannelsEnabled } from './notificationChannelsApi';

export interface PushAudienceInput { kind: 'todos' | 'professores' | 'funcionarios' | 'alunos'; ids?: string[] }

/** Audiência do push para o público-alvo escolhido. 'alunos' = o próprio aluno e os seus encarregados. */
export function pushAudienceFor(type: NotificationAudienceType, students: Student[], classId?: string, studentIds?: string[]): PushAudienceInput {
  switch (type) {
    case 'professores': return { kind: 'professores' };
    case 'funcionarios': return { kind: 'funcionarios' };
    case 'turma': return { kind: 'alunos', ids: students.filter((s) => s.status === 'active' && s.classId === classId).map((s) => String(s.id)) };
    case 'aluno': return { kind: 'alunos', ids: (studentIds ?? []).map(String) };
    default: return { kind: 'todos' };
  }
}

/** Título e texto do push (o service worker corta a 80/200 caracteres). */
export function pushText(title: string, message: string): { title: string; body: string } {
  return { title: title.trim().slice(0, 80), body: message.trim().slice(0, 200) };
}

export const SMS_RESERVED_TEXT = 'O SMS desta escola está reservado a avisos críticos (ex.: propina em atraso). Use o push, ou marque o aviso como crítico.';

export interface RouteCheck { ok: boolean; error?: string; warnings: string[] }

/** Valida, antes de enviar, se o canal escolhido está ligado e permitido para este aviso. */
export function checkRoute(channel: CommunicationChannel, critical: boolean, ch: ChannelsEnabled, legacyGateway: boolean): RouteCheck {
  const warnings: string[] = [];
  if (channel === 'push') {
    return ch.push ? { ok: true, warnings } : { ok: false, warnings, error: 'O push não está ligado nesta escola (Configurações → Integrações → Notificações).' };
  }
  const wantsSms = channel === 'sms' || channel === 'ambos';
  const wantsWa = channel === 'whatsapp' || channel === 'ambos';
  const smsOn = ch.sms || legacyGateway, waOn = ch.whatsapp || legacyGateway;
  if (wantsSms && !smsOn) return { ok: false, warnings, error: 'O SMS não está ligado nesta escola (Configurações → Integrações → Notificações).' };
  if (wantsWa && !waOn) return { ok: false, warnings, error: 'O WhatsApp não está ligado nesta escola (Configurações → Integrações → Notificações).' };
  if (wantsSms && ch.sms && ch.smsCriticalOnly && !critical) {
    if (channel === 'sms') return { ok: false, warnings, error: SMS_RESERVED_TEXT };
    warnings.push('O SMS foi ignorado (reservado a avisos críticos); o WhatsApp segue normalmente.');
  }
  return { ok: true, warnings };
}
