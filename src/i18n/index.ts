/**
 * Internacionalização (passo 6) — infraestrutura + menu e módulos novos.
 *
 * Idiomas: pt (Português de Angola, base) e en. O inglês cobre todo o sistema através da tradução automática
 * (src/i18n/autoTranslate.ts); este dicionário traz as traduções exactas do menu e dos módulos novos. O texto original em português serve de
 * chave: `tr("Notas")` devolve a tradução se existir e, se não existir, o próprio texto.
 * Assim nada se parte quando falta uma tradução, e os ecrãs antigos continuam em português
 * até serem traduzidos um a um (só o menu e os módulos novos estão traduzidos).
 */
import { EN } from './en';

export type Lang = 'pt' | 'en';
export const LANGS: Array<{ id: Lang; label: string; locale: string; flag: string }> = [
  { id: 'pt', label: 'Português', locale: 'pt-AO', flag: '🇦🇴' },
  { id: 'en', label: 'English', locale: 'en-GB', flag: '🇺🇸' }
];

const DICTS: Record<Lang, Record<string, string>> = { pt: {}, en: EN };
const STORAGE_KEY = 'bandgest.lang';

export function isLang(v: unknown): v is Lang {
  return v === 'pt' || v === 'en';
}

export function getLang(): Lang {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return isLang(v) ? v : 'pt';
  } catch {
    return 'pt';
  }
}

export function setLang(lang: Lang): void {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* sem armazenamento: fica só nesta sessão */ }
  listeners.forEach((l) => l(lang));
}

const listeners = new Set<(l: Lang) => void>();
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Traduz o texto em português. Aceita {nome} para valores. */
export function tr(text: string, lang: Lang = getLang(), vars?: Record<string, string | number>): string {
  const base = DICTS[lang]?.[text] ?? text;
  return vars ? base.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : base;
}

export function localeOf(lang: Lang = getLang()): string {
  return LANGS.find((l) => l.id === lang)?.locale || 'pt-AO';
}

/** Moeda da escola (por defeito Kwanza). Outro país = outro código ISO 4217 em Configurações. */
export function formatMoney(amount: number, lang: Lang = getLang(), currency = 'AOA'): string {
  try {
    return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

export function formatDate(iso: string, lang: Lang = getLang()): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(localeOf(lang), { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}
