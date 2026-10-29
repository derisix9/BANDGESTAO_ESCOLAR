/**
 * Abreviatura oficial do nome de uma disciplina para cabeçalhos de pauta impressa.
 *
 * Regras:
 *  - Uma só palavra .................. 3 primeiras letras            FISICA → FIS
 *                                                                    MATEMATICA → MAT
 *  - Duas palavras ................... 3 letras de cada, separadas   EDUCAÇÃO FISICA → EDU. FIS
 *  - Três ou mais palavras ........... letra inicial de cada palavra EDUCAÇÃO MORAL CIVICA → EMC
 *                                      INSTITUTO SUPERIOR INTERNACIONAL DE ANGOLA → ISIA
 *
 * As partículas de ligação (de, da, do, das, dos, e, em, a, o, com, para) não contam como
 * palavra — é por isso que "… INTERNACIONAL DE ANGOLA" dá ISIA e não ISIDA.
 */

const CONNECTIVES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os',
  'com', 'para', 'por', 'ao', 'aos', 'à', 'às', 'no', 'na', 'nos', 'nas'
]);

function significantWords(name: string): string[] {
  return (name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !CONNECTIVES.has(w.toLowerCase()));
}

export function abbreviateSubjectName(name: string): string {
  const words = significantWords(name);
  if (words.length === 0) return (name || '').toUpperCase();

  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }

  if (words.length === 2) {
    return `${words[0].slice(0, 3).toUpperCase()}. ${words[1].slice(0, 3).toUpperCase()}`;
  }

  return words.map((w) => w[0].toUpperCase()).join('');
}

/**
 * Garante abreviaturas únicas dentro de uma mesma pauta: se duas disciplinas gerarem a
 * mesma sigla (por exemplo "FISICA" e "FISIOLOGIA" → FIS), acrescenta-se um dígito
 * sequencial para que a pauta impressa continue inequívoca.
 */
export function buildUniqueSubjectAbbreviations(names: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Map<string, number>();

  names.forEach((name) => {
    if (result.has(name)) return;
    const base = abbreviateSubjectName(name);
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    result.set(name, seen === 0 ? base : `${base}${seen + 1}`);
  });

  return result;
}
