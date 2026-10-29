/**
 * Limites do plano contratado (alunos, utilizadores, armazenamento).
 *
 * Quem IMPÕE os limites é a base de dados (migração 0020): os gatilhos recusam o
 * INSERT/UPDATE e a mensagem de erro começa por  "LIMITE_PLANO:<tipo> — texto".
 * Este ficheiro só reconhece esse erro, onde quer que ele apareça (gravação de
 * registos, criação de contas, envio de ficheiros) e avisa a interface, que
 * mostra uma janela clara em vez de uma falha silenciosa.
 */
export type PlanLimitKind = 'alunos' | 'utilizadores' | 'armazenamento';

export interface PlanLimitInfo { kind: PlanLimitKind; message: string }

const EVENT = 'bandmed:plan-limit';
const RE = /LIMITE_PLANO:(alunos|utilizadores|armazenamento)\s*[—-]?\s*([^\n]*)/i;

const DEFAULT_TEXT: Record<PlanLimitKind, string> = {
  alunos: 'O limite de alunos do plano foi atingido. Peça um plano maior para cadastrar mais.',
  utilizadores: 'O limite de utilizadores do plano foi atingido. Desative um utilizador ou peça um plano maior.',
  armazenamento: 'O armazenamento do plano está cheio. Elimine registos ou ficheiros para libertar espaço, ou peça um plano maior.'
};

/** Reconhece um erro de limite do plano (Error, erro do Supabase ou texto). */
export function parsePlanLimit(e: unknown): PlanLimitInfo | null {
  const text = typeof e === 'string' ? e : String((e as any)?.message ?? (e as any)?.error ?? (e as any)?.details ?? '');
  const m = RE.exec(text);
  if (!m) return null;
  const kind = m[1].toLowerCase() as PlanLimitKind;
  return { kind, message: (m[2] || '').trim() || DEFAULT_TEXT[kind] };
}

/** Se `e` é um erro de limite, avisa a interface e devolve true. */
export function reportPlanLimit(e: unknown): boolean {
  const info = parsePlanLimit(e);
  if (!info) return false;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<PlanLimitInfo>(EVENT, { detail: info }));
  return true;
}

export function onPlanLimit(fn: (info: PlanLimitInfo) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = (ev: Event) => fn((ev as CustomEvent<PlanLimitInfo>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

export const PLAN_LIMIT_TITLE: Record<PlanLimitKind, string> = {
  alunos: 'Limite de alunos atingido',
  utilizadores: 'Limite de utilizadores atingido',
  armazenamento: 'Armazenamento cheio'
};

/** Texto do erro de gravação num ficheiro: a política do Storage não devolve a mensagem do plano. */
export const STORAGE_FULL_TEXT = DEFAULT_TEXT.armazenamento;
