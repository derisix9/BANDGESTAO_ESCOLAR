import { AutomaticBackupSchedule, BackupFrequency } from '../types';

/**
 * BACKUP AUTOMÁTICO AGENDADO — regras de negócio (sem React nem Firebase).
 *
 * Decide QUANDO a rotina automática deve correr, a partir da frequência, hora
 * e (para semanal/mensal) dia configurados na secção "7. Segurança & Backups"
 * (onde a configuração da rotina foi fundida, ao lado do backup manual). A
 * execução em si (gerar o instantâneo e registá-lo no histórico) é feita pelo
 * `dbService`.
 */

export const BACKUP_FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  diario: 'Diário',
  semanal: 'Semanal',
  mensal: 'Mensal'
};

export const WEEKDAY_LABELS = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];

export function defaultAutomaticBackupSchedule(): AutomaticBackupSchedule {
  return {
    enabled: false,
    frequency: 'diario',
    time: '23:00',
    weekday: 0,
    dayOfMonth: 1,
    retentionCount: 14
  };
}

function parseTime(time: string): { h: number; m: number } {
  const [h, m] = (time || '23:00').split(':').map((n) => parseInt(n, 10));
  return { h: Number.isFinite(h) ? h : 23, m: Number.isFinite(m) ? m : 0 };
}

/**
 * Calcula a próxima data/hora (ISO) em que o backup automático deve correr,
 * a partir da última execução (ou de agora, se nunca correu).
 */
export function computeNextRunIso(schedule: AutomaticBackupSchedule, fromIso?: string): string {
  const { h, m } = parseTime(schedule.time);
  const base = fromIso ? new Date(fromIso) : new Date();
  const candidate = new Date(base);
  candidate.setHours(h, m, 0, 0);

  if (schedule.frequency === 'diario') {
    if (candidate <= base) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }

  if (schedule.frequency === 'semanal') {
    const targetDay = schedule.weekday ?? 0;
    while (candidate.getDay() !== targetDay || candidate <= base) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  // mensal
  const targetDom = Math.min(Math.max(schedule.dayOfMonth || 1, 1), 28);
  candidate.setDate(targetDom);
  if (candidate <= base) {
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(targetDom);
  }
  return candidate.toISOString();
}

/** Verdadeiro se, dada a configuração e a hora atual, o backup automático já devia ter corrido. */
export function isBackupDue(schedule: AutomaticBackupSchedule | undefined, nowIso: string = new Date().toISOString()): boolean {
  if (!schedule || !schedule.enabled) return false;
  const next = schedule.nextRunIso || computeNextRunIso(schedule, schedule.lastRunIso);
  return new Date(nowIso) >= new Date(next);
}

export function describeSchedule(schedule: AutomaticBackupSchedule): string {
  if (!schedule.enabled) return 'Desativado';
  if (schedule.frequency === 'diario') return `Diariamente às ${schedule.time}`;
  if (schedule.frequency === 'semanal') return `Toda(o)s as ${WEEKDAY_LABELS[schedule.weekday ?? 0]} às ${schedule.time}`;
  return `No dia ${schedule.dayOfMonth || 1} de cada mês às ${schedule.time}`;
}
