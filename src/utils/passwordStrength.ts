/** Força da palavra-passe (4 níveis, como no Supabase). A regra mínima do servidor (10 caracteres, a-z, A-Z, 0-9) mantém-se. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;   // 0 = vazia

export interface PasswordStrength {
  level: StrengthLevel;
  label: '' | 'Baixo' | 'Normal' | 'Forte' | 'Muito forte';
  color: string;           // cor da barra
  textColor: string;
  checks: { ok: boolean; text: string }[];
}

const COMMON = ['password', 'palavra', 'senha', 'qwerty', 'abcdef', '123456', '654321', 'admin', 'bandmed', 'escola', 'angola', 'letmein', 'welcome'];
const SEQ = 'abcdefghijklmnopqrstuvwxyz0123456789';

function hasSequence(p: string): boolean {
  const l = p.toLowerCase();
  for (let i = 0; i + 3 < l.length + 0; i++) {
    const s = l.slice(i, i + 4);
    if (SEQ.includes(s) || SEQ.split('').reverse().join('').includes(s)) return true;
  }
  return false;
}

export function passwordStrength(p: string): PasswordStrength {
  const hasLower = /[a-z]/.test(p), hasUpper = /[A-Z]/.test(p), hasDigit = /\d/.test(p), hasSymbol = /[^A-Za-z0-9]/.test(p);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  const weakPattern = /(.)\1{2,}/.test(p) || hasSequence(p) || COMMON.some((w) => p.toLowerCase().includes(w));

  const checks = [
    { ok: p.length >= 10, text: 'Pelo menos 10 caracteres' },
    { ok: hasLower && hasUpper, text: 'Letras maiúsculas e minúsculas' },
    { ok: hasDigit, text: 'Pelo menos um número' },
    { ok: hasSymbol, text: 'Um símbolo (!@#…) torna-a mais forte' },
    { ok: !!p && !weakPattern, text: 'Sem sequências (abc, 123), repetições ou palavras comuns' }
  ];

  let level: StrengthLevel = 0;
  if (p) {
    if (p.length < 10 || !(hasLower && hasUpper && hasDigit) || weakPattern) {
      level = 1;
    } else {
      const score = (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (hasSymbol ? 1 : 0);
      level = (score >= 2 ? 4 : score === 1 ? 3 : 2) as StrengthLevel;
    }
  }
  const map = {
    0: { label: '' as const, color: '#e2e8f0', textColor: '#64748b' },
    1: { label: 'Baixo' as const, color: '#dc2626', textColor: '#b91c1c' },
    2: { label: 'Normal' as const, color: '#f59e0b', textColor: '#b45309' },
    3: { label: 'Forte' as const, color: '#22c55e', textColor: '#15803d' },
    4: { label: 'Muito forte' as const, color: '#059669', textColor: '#047857' }
  }[level];
  return { level, ...map, checks };
}

/** Aceite para criar escola: pelo menos "Normal". */
export const isPasswordAcceptable = (p: string) => passwordStrength(p).level >= 2;
