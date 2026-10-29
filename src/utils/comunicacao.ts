import {
  CommunicationChannel,
  Funcionario,
  MeetingParticipant,
  MeetingParticipantStatus,
  MeetingStatus,
  MeetingType,
  NotificationAudienceType,
  NotificationRecipient,
  NotificationStatus,
  Student,
  Teacher
} from '../types';

/**
 * COMUNICAÇÃO — regras de negócio (sem React nem Firebase).
 *
 * 2. Notificações SMS/WhatsApp — envio em massa para encarregados de
 *    educação, professores ou funcionários, com registo de destinatários e
 *    estado de entrega.
 *    - WhatsApp: envio REAL através do mecanismo oficial "click-to-chat" do
 *      próprio WhatsApp (wa.me), sem necessidade de token de API nem
 *      servidor próprio — a mensagem é efetivamente despachada quando o
 *      operador prime "Enviar" na conversa aberta.
 *    - SMS: continua simulado, por não existir integração configurada com
 *      operadora/gateway (ver Configurações → Integrações).
 * 3. Reuniões Pais-Professores — agendamento de reuniões individuais (um
 *    aluno/encarregado) ou coletivas (turma inteira), com lista de
 *    participantes, confirmação/comparência e resumo final.
 */

// =============================================================
// 2. Notificações SMS/WhatsApp
// =============================================================

export const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  ambos: 'SMS + WhatsApp',
  push: 'Push (grátis)'
};

export const AUDIENCE_TYPE_LABELS: Record<NotificationAudienceType, string> = {
  toda_escola: 'Toda a Escola (Encarregados)',
  turma: 'Uma Turma (Encarregados)',
  aluno: 'Alunos Específicos (Encarregados)',
  professores: 'Corpo Docente',
  funcionarios: 'Funcionários'
};

export const NOTIFICATION_STATUS_META: Record<NotificationStatus, { label: string; badge: string }> = {
  rascunho: { label: 'Rascunho', badge: 'bg-slate-100 text-slate-700' },
  agendada: { label: 'Agendada', badge: 'bg-amber-100 text-amber-800' },
  enviada: { label: 'Enviada', badge: 'bg-emerald-100 text-emerald-800' },
  falhada: { label: 'Falhada', badge: 'bg-red-100 text-red-800' }
};

export interface NotificationFieldsInput {
  channel: CommunicationChannel;
  audienceType: NotificationAudienceType;
  classId?: string;
  studentIds?: string[];
  title: string;
  message: string;
  critical?: boolean;
  scheduledFor?: string;
}

export function validateNotification(fields: NotificationFieldsInput): string[] {
  const errors: string[] = [];
  if (!fields.title.trim()) errors.push('Indique um título/assunto para a notificação.');
  if (!fields.message.trim()) errors.push('Escreva o texto da mensagem.');
  if (fields.message.length > 480) errors.push('A mensagem não pode exceder 480 caracteres (aprox. 3 SMS).');
  if (fields.audienceType === 'turma' && !fields.classId) {
    errors.push('Selecione a turma destinatária.');
  }
  if (fields.audienceType === 'aluno' && (!fields.studentIds || fields.studentIds.length === 0)) {
    errors.push('Selecione pelo menos um aluno.');
  }
  return errors;
}

/** Constrói a lista de destinatários (deduplicada por telefone) a partir do público-alvo escolhido. */
export function buildRecipientsForAudience(
  audienceType: NotificationAudienceType,
  students: Student[],
  teachers: Teacher[],
  funcionarios: Funcionario[],
  classId?: string,
  studentIds?: string[]
): NotificationRecipient[] {
  const seenPhones = new Set<string>();
  const recipients: NotificationRecipient[] = [];

  const pushGuardian = (s: Student) => {
    const phone = (s.guardianPhone || '').trim();
    if (!phone || !s.guardianName?.trim() || seenPhones.has(phone)) return;
    seenPhones.add(phone);
    recipients.push({
      id: `enc-${s.id}`,
      name: s.guardianName,
      phone,
      kind: 'encarregado',
      studentId: s.id,
      studentName: s.name,
      deliveryStatus: 'pendente'
    });
  };

  if (audienceType === 'toda_escola') {
    students.filter((s) => s.status === 'active').forEach(pushGuardian);
  } else if (audienceType === 'turma' && classId) {
    students.filter((s) => s.status === 'active' && s.classId === classId).forEach(pushGuardian);
  } else if (audienceType === 'aluno' && studentIds) {
    const ids = new Set(studentIds);
    students.filter((s) => ids.has(s.id)).forEach(pushGuardian);
  } else if (audienceType === 'professores') {
    teachers.forEach((t) => {
      const phone = (t.phone || '').trim();
      if (!phone || seenPhones.has(phone)) return;
      seenPhones.add(phone);
      recipients.push({ id: `prof-${t.id}`, name: t.name, phone, kind: 'professor', deliveryStatus: 'pendente' });
    });
  } else if (audienceType === 'funcionarios') {
    funcionarios.forEach((f) => {
      const phone = (f.phone || '').trim();
      if (!phone || seenPhones.has(phone)) return;
      seenPhones.add(phone);
      recipients.push({ id: `func-${f.id}`, name: f.name, phone, kind: 'funcionario', deliveryStatus: 'pendente' });
    });
  }

  return recipients;
}

/**
 * Normaliza um número de telefone (angolano ou já internacional) para o
 * formato E.164 sem "+" exigido pelo WhatsApp: remove tudo o que não seja
 * dígito e, se restarem exatamente 9 dígitos (formato local, ex.: 923 456
 * 789), prefixa o indicativo de Angola (244). Devolve null se não houver
 * dígitos suficientes para um número válido.
 */
export function normalizeWhatsAppPhone(value?: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return `244${digits}`;
  if (digits.length >= 10) return digits;
  return null;
}

/**
 * Constrói o link oficial "click-to-chat" do WhatsApp (wa.me) com a
 * mensagem já pré-preenchida. Abrir este link e premir "Enviar" na
 * conversa despacha uma mensagem WhatsApp REAL, através da própria conta
 * (WhatsApp Web/Desktop ou app) de quem está a operar o sistema — não há
 * simulação nem intermediário. Devolve null se o telefone for inválido.
 */
export function buildWhatsAppLink(phone: string, message: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

// =============================================================
// 3. Reuniões Pais-Professores
// =============================================================

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  individual: 'Individual',
  coletiva: 'Coletiva (Turma Inteira)'
};

export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; badge: string }> = {
  agendada: { label: 'Agendada', badge: 'bg-blue-100 text-blue-800' },
  realizada: { label: 'Realizada', badge: 'bg-emerald-100 text-emerald-800' },
  cancelada: { label: 'Cancelada', badge: 'bg-slate-200 text-slate-600' }
};

export const PARTICIPANT_STATUS_META: Record<MeetingParticipantStatus, { label: string; badge: string }> = {
  convocado: { label: 'Convocado', badge: 'bg-slate-100 text-slate-700' },
  confirmado: { label: 'Confirmado', badge: 'bg-blue-100 text-blue-800' },
  compareceu: { label: 'Compareceu', badge: 'bg-emerald-100 text-emerald-800' },
  faltou: { label: 'Faltou', badge: 'bg-red-100 text-red-800' }
};

export interface MeetingFieldsInput {
  type: MeetingType;
  title: string;
  teacherId: string;
  classId?: string;
  studentIds?: string[];
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  agenda?: string;
}

export function validateMeeting(fields: MeetingFieldsInput): string[] {
  const errors: string[] = [];
  if (!fields.title.trim()) errors.push('Indique o título/motivo da reunião.');
  if (!fields.teacherId) errors.push('Selecione o professor responsável.');
  if (!fields.date) errors.push('Indique a data da reunião.');
  if (!fields.startTime) errors.push('Indique a hora de início.');
  if (!fields.endTime) errors.push('Indique a hora de fim.');
  if (fields.startTime && fields.endTime && fields.endTime <= fields.startTime) {
    errors.push('A hora de fim deve ser posterior à hora de início.');
  }
  if (fields.type === 'coletiva' && !fields.classId) {
    errors.push('Selecione a turma para uma reunião coletiva.');
  }
  if (fields.type === 'individual' && (!fields.studentIds || fields.studentIds.length === 0)) {
    errors.push('Selecione pelo menos um aluno/encarregado para uma reunião individual.');
  }
  return errors;
}

/** Constrói a lista de participantes (aluno + encarregado) para a reunião, a partir da turma ou dos alunos escolhidos. */
export function buildMeetingParticipants(
  type: MeetingType,
  students: Student[],
  classId?: string,
  studentIds?: string[]
): MeetingParticipant[] {
  const source =
    type === 'coletiva'
      ? students.filter((s) => s.status === 'active' && s.classId === classId)
      : students.filter((s) => (studentIds || []).includes(s.id));

  return source
    .filter((s) => s.guardianName?.trim())
    .map((s) => ({
      studentId: s.id,
      studentName: s.name,
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone || '',
      status: 'convocado' as MeetingParticipantStatus
    }));
}

export function validateMeetingSummary(summary: string | undefined): string | null {
  if (!summary || !summary.trim()) return 'Escreva um resumo da reunião antes de a marcar como realizada.';
  return null;
}


