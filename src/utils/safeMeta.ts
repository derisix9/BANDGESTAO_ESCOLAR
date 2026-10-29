/**
 * Tabelas de metadados (rótulo, ícone, cor...) indexadas por estado/tipo, ex.:
 * `ACTIVITY_STATUS_META[a.status].final`. Se um registo guardado na nuvem trouxer um valor
 * que a versão atual não conhece (dados de uma versão anterior, campo em falta, valor
 * escrito à mão), `META[valor]` devolvia `undefined` e o ecrã inteiro rebentava com
 * "Cannot read properties of undefined (reading 'icon' / 'badge' / 'final')".
 *
 * `withFallback` devolve a mesma tabela, mas qualquer chave desconhecida resolve para a
 * entrada `fallbackKey`. Object.keys / Object.entries continuam a listar só as chaves reais.
 */
export function withFallback<T extends Record<string, any>>(table: T, fallbackKey: keyof T & string): T {
  return new Proxy(table, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
      // Evita interferir com sondagens de Promise/JSON/React (`then`, `toJSON`, `$$typeof`...).
      if (prop === 'then' || prop === 'toJSON' || prop === '$$typeof') return undefined;
      return target[fallbackKey];
    }
  }) as T;
}

/**
 * Garante um array a partir de qualquer valor vindo da nuvem: array → o próprio; objeto
 * (o Realtime Database devolve um objeto quando o array tinha "buracos") → os seus valores;
 * texto, número, null ou undefined (formatos antigos / campo em falta) → [].
 * Sem isto, `list.length` podia ser verdadeiro e `list.map` ainda assim não existir
 * ("list.map is not a function").
 */
export function toArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined) as T[];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter((v) => v !== null && v !== undefined) as T[];
  }
  return [];
}

/** Só registos que são objetos (ignora null / texto perdido dentro da coleção). */
export function toRecords<T = any>(value: unknown): T[] {
  return toArray<T>(value).filter((v) => typeof v === 'object' && !Array.isArray(v));
}
