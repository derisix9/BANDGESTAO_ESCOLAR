/**
 * Ordenação alfabética central (A–Z) por nome.
 *
 * Usada em: Alunos, Matrículas, Professores, Funcionários, Mini-Pauta e Pauta.
 * - Ignora maiúsculas/minúsculas e acentos ("Álvaro" fica junto de "Alvaro").
 * - Ignora espaços no início/fim.
 * - Nomes vazios vão para o fim da lista.
 */
const collator = new Intl.Collator('pt', { sensitivity: 'base', numeric: true });

const clean = (value: unknown): string => String(value ?? '').trim();

export function compareNames(a: unknown, b: unknown): number {
  const x = clean(a);
  const y = clean(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return collator.compare(x, y);
}

/** Devolve uma CÓPIA ordenada por nome (não altera a lista original). */
export function sortByName<T>(list: readonly T[] | null | undefined, getName: (item: T) => unknown = (item) => (item as any)?.name): T[] {
  return [...(list || [])].sort((a, b) => compareNames(getName(a), getName(b)));
}

/**
 * Linhas de Mini-Pauta / Pauta: ordena por nome e renumera `num` (1, 2, 3…),
 * para que o número de ordem acompanhe a ordem alfabética.
 */
export function sortPautaRowsByName<T extends { name?: string; num?: unknown }>(rows: readonly T[] | null | undefined): T[] {
  return sortByName(rows, (r) => r.name).map((r, i) => ({ ...r, num: i + 1 }));
}
