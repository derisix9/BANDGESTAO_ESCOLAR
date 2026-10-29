/**
 * Formatação própria de documentos oficiais angolanos: datas por extenso, notas por extenso,
 * "N.ª Classe" → número, etc. Funções puras (testáveis em Node).
 */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const EXTENSO: Record<number, string> = {
  0: 'Zero', 1: 'Um', 2: 'Dois', 3: 'Três', 4: 'Quatro', 5: 'Cinco', 6: 'Seis', 7: 'Sete', 8: 'Oito', 9: 'Nove', 10: 'Dez',
  11: 'Onze', 12: 'Doze', 13: 'Treze', 14: 'Catorze', 15: 'Quinze', 16: 'Dezasseis', 17: 'Dezassete', 18: 'Dezoito', 19: 'Dezanove', 20: 'Vinte'
};

/** Nota (0–20) por extenso, como nos certificados oficiais: 12 → "Doze". */
export function notaPorExtenso(n: number | '' | undefined | null): string {
  if (n === '' || n === undefined || n === null || Number.isNaN(Number(n))) return '';
  const v = Math.round(Number(n));
  return EXTENSO[v] ?? String(v);
}

/** "2026-09-09" | Date → "09 de Setembro de 2026". */
export function dataPorExtenso(input?: string | Date | null, pad = true): string {
  const d = parseDate(input);
  if (!d) return '';
  const dia = pad ? String(d.getDate()).padStart(2, '0') : String(d.getDate());
  return `${dia} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "2011-03-17" → "17/03/2011". */
export function dataCurta(input?: string | Date | null): string {
  const d = parseDate(input);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function parseDate(input?: string | Date | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const s = String(input).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "7.ª Classe" | "7ª Classe" | "13.ª Classe (Técnico-Profissional)" → 7 | 13. null se não for classe. */
export function classNumber(grade?: string | null): number | null {
  if (!grade) return null;
  const m = /(\d{1,2})\s*[.ºª°]*\s*(?:ª|a|º)?\s*classe/i.exec(grade) || /^(\d{1,2})\s*[.ºª°]/.exec(grade.trim());
  return m ? Number(m[1]) : null;
}

export function classLabel(n: number): string {
  return `${n}.ª Classe`;
}

export function slug(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

/** "Santo Domingos" → "SANTO DOMINGOS" sem partir acentos. */
export const upper = (s?: string | null) => String(s ?? '').toLocaleUpperCase('pt-PT');

/** Ano lectivo "2025/2026" ou "2025-2026" → [2025, 2026]. */
export function parseYears(y?: string | null): [number, number] | null {
  const m = /(\d{4})\D+(\d{4})/.exec(y || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Escapa HTML para texto livre. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
