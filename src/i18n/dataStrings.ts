/** Recolhe os textos que são DADOS inseridos na base de dados (nomes, turmas, moradas…) para a tradução os deixar intactos. */
export function collectDataStrings(db: unknown, cap = 60000): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t.length >= 3 && t.length <= 160 && !t.startsWith('data:') && !/^https?:\/\//.test(t)) out.add(t);
  };
  if (!db || typeof db !== 'object') return [];
  for (const val of Object.values(db as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') for (const v of Object.values(item as Record<string, unknown>)) add(v);
        else add(item);
        if (out.size >= cap) return Array.from(out);
      }
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) add(v);
    }
  }
  return Array.from(out);
}
