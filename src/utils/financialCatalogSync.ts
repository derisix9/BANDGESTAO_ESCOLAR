/**
 * Ligação Tabela Financeira → Catálogo de Serviços & Emolumentos
 * ==============================================================
 * A Tabela Financeira (Configurações → Financeiro → Tabela, `settings.tuitionRows`) é a ÚNICA fonte
 * dos preços de Propina Mensal, Matrícula e Confirmação de Matrícula de cada classe. O Catálogo de
 * Serviços (secção Pagamentos) mostra esses mesmos valores como serviços "bloqueados" e é
 * reconciliado automaticamente sempre que a tabela muda: preços alterados, classes novas
 * (adicionadas) e classes que deixaram de existir (removidas).
 *
 * Funções puras: não tocam na base de dados; devolvem a lista reconciliada.
 */
import type { SchoolServiceItem, TuitionRow } from '../types';

export const FINANCIAL_TABLE_SOURCE = 'tabela-financeira' as const;

const LEGACY_DESC_PREFIX = 'Gerado automaticamente a partir da Tabela Financeira';

export function gradeSlug(grade: string): string {
  return String(grade || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toUpperCase()
    .replace(/^-+|-+$/g, '');
}

/** Serviços que a Tabela Financeira deve ter no Catálogo (3 por classe). */
export function buildCatalogFromTuitionRows(rows: TuitionRow[]): SchoolServiceItem[] {
  const out: SchoolServiceItem[] = [];
  (rows || []).forEach((row) => {
    if (!row || !row.grade) return;
    const slug = gradeSlug(row.grade);
    if (!slug) return;
    const desc = `Tabela Financeira — ${row.levelName || row.cycle || row.grade}. Valor definido em Configurações → Financeiro; atualiza automaticamente.`;
    const entries: { code: string; name: string; category: SchoolServiceItem['category']; price: number }[] = [
      { code: `PROP-${slug}`, name: `Propina Mensal — ${row.grade}`, category: 'propinas', price: Number(row.monthlyTuitionKz) || 0 },
      { code: `MAT-${slug}`, name: `Matrícula — ${row.grade}`, category: 'matricula', price: Number(row.matriculaKz) || 0 },
      { code: `CONF-${slug}`, name: `Confirmação de Matrícula — ${row.grade}`, category: 'matricula', price: Number(row.confirmacaoKz) || 0 },
    ];
    entries.forEach((e) => {
      out.push({
        id: `srv-fin-${e.code}`,
        code: e.code,
        name: e.name,
        description: desc,
        category: e.category,
        defaultPriceKz: e.price,
        taxRegime: 'Isento (Art. 12 CIVA)',
        active: true,
        source: FINANCIAL_TABLE_SOURCE,
      });
    });
  });
  return out;
}

const isFinancialItem = (s: SchoolServiceItem) =>
  s.source === FINANCIAL_TABLE_SOURCE ||
  (/^(PROP|MAT|CONF)-/.test(s.code || '') && String(s.description || '').startsWith(LEGACY_DESC_PREFIX));

/**
 * Reconcilia o catálogo com a tabela. Devolve a MESMA referência (`changed: false`) se nada mudou.
 * - Cria o que falta e atualiza nome/preço/categoria do que existe (por código).
 * - Remove os serviços que a tabela gerou antes e que já não têm classe correspondente.
 * - Serviços criados à mão pelo utilizador (outros códigos) nunca são tocados.
 * - Tabela vazia/indefinida: não faz nada (evita apagar o catálogo enquanto as definições carregam).
 */
export function reconcileServicesWithFinancialTable(
  services: SchoolServiceItem[] | undefined,
  tuitionRows: TuitionRow[] | undefined
): { services: SchoolServiceItem[]; changed: boolean } {
  const current = Array.isArray(services) ? services : [];
  if (!Array.isArray(tuitionRows) || tuitionRows.length === 0) return { services: current, changed: false };

  const expected = buildCatalogFromTuitionRows(tuitionRows);
  const expectedByCode = new Map(expected.map((e) => [e.code, e]));
  let changed = false;
  const seen = new Set<string>();
  const next: SchoolServiceItem[] = [];

  for (const s of current) {
    const want = expectedByCode.get(s.code);
    if (want) {
      if (seen.has(s.code)) { changed = true; continue; } // duplicado do mesmo código
      seen.add(s.code);
      const merged: SchoolServiceItem = {
        ...s,
        name: want.name,
        category: want.category,
        defaultPriceKz: want.defaultPriceKz,
        description: want.description,
        active: true,
        source: FINANCIAL_TABLE_SOURCE,
      };
      const same =
        s.name === merged.name && s.category === merged.category && s.defaultPriceKz === merged.defaultPriceKz &&
        s.description === merged.description && s.active === true && s.source === FINANCIAL_TABLE_SOURCE;
      if (!same) changed = true;
      next.push(same ? s : merged);
    } else if (isFinancialItem(s)) {
      changed = true; // classe removida / subsistema desativado
    } else {
      next.push(s);
    }
  }
  for (const e of expected) {
    if (!seen.has(e.code)) {
      next.push({ ...e, createdAt: new Date().toISOString() });
      changed = true;
    }
  }
  return changed ? { services: next, changed: true } : { services: current, changed: false };
}
