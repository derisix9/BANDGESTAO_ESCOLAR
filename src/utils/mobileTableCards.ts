/**
 * TABELAS → CARDS NO TELEMÓVEL — função global (par de `mobileWrap.ts`).
 *
 * Chamada UMA vez no arranque (ver main.tsx). Em ecrãs estreitos (≤767px), TODA a
 * tabela do sistema (Alunos, Matrículas, Turmas, Disciplinas, Cursos, Atribuições,
 * Exames Nacionais, Banco de Questões, Plano Individual…) passa a ser mostrada como
 * uma lista de cards: cada linha vira um card e cada célula mostra "Cabeçalho: valor".
 * Nenhum ecrã precisa de mudar — qualquer tabela futura herda o comportamento.
 *
 * Como funciona
 *   • JS só acrescenta atributos: `data-gr-mcards` na tabela e `data-label` em cada
 *     célula (texto do <th> da mesma coluna, respeitando colspan). Observa o DOM,
 *     por isso tabelas que aparecem depois (modais, separadores) também são tratadas;
 *   • o aspeto vive em `styles/global-layout.css` (secção "Tabelas em cards"), só
 *     dentro de `@media (max-width: 767px)` e `@media screen` — a impressão não muda;
 *   • a 1.ª coluna é o título do card; a última (ações) fica em rodapé;
 *   • a coluna de seleção em lote e linhas de aviso (colspan) são respeitadas.
 *
 * Exclusões
 *   • `data-no-cards` na tabela ou num ancestral;
 *   • documentos imprimíveis (.printable-*), tabelas aninhadas, tabelas sem <thead>
 *     com <th> (sem cabeçalho não há rótulos);
 *   • tabelas de pauta/grelhas largas: use `data-no-cards` (ex.: pautas, horários).
 */

const MQ = '(max-width: 767px)';
const SKIP =
  '[data-no-cards], .printable-document, .printable-page, .printable-report, .printable-pauta, .printable-pauta *';
/** Tabelas com muitas colunas são grelhas (pautas, horários): ficam em scroll horizontal. */
const MAX_COLS = 14;

let disposeGlobal: (() => void) | null = null;

export function enableMobileTableCards(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (disposeGlobal) return disposeGlobal;

  const mq = window.matchMedia(MQ);
  const seen = new WeakMap<HTMLTableElement, string>();
  const pending = new Set<HTMLTableElement>();
  let raf = 0;

  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

  /** Rótulos por coluna lógica (respeita colspan do cabeçalho; usa a última linha do thead). */
  function headerLabels(table: HTMLTableElement): string[] {
    const head = table.tHead;
    if (!head || !head.rows.length) return [];
    const row = head.rows[head.rows.length - 1];
    const out: string[] = [];
    for (const c of Array.from(row.cells)) {
      const label = clean(c.getAttribute('data-label-override') || c.textContent || '');
      const span = Math.max(1, c.colSpan || 1);
      for (let i = 0; i < span; i++) out.push(label);
    }
    return out;
  }

  function eligible(table: HTMLTableElement): boolean {
    if (!table.isConnected || table.closest(SKIP)) return false;
    if (table.parentElement?.closest('table')) return false;
    if (!table.tHead || !table.tHead.querySelector('th')) return false;
    if (!table.tBodies.length) return false;
    const labels = headerLabels(table);
    return labels.length > 0 && labels.length <= MAX_COLS;
  }

  function apply(table: HTMLTableElement) {
    if (!eligible(table)) {
      if (table.hasAttribute('data-gr-mcards')) {
        table.removeAttribute('data-gr-mcards');
      }
      return;
    }
    const labels = headerLabels(table);
    const sig = labels.join('|') + '#' + table.rows.length;
    if (!table.hasAttribute('data-gr-mcards')) table.setAttribute('data-gr-mcards', '');

    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        const cells = Array.from(row.cells);
        const real = cells.filter((c) => !c.hasAttribute('data-gr-sel'));
        // Linha de aviso ("Sem registos"): 1 célula com colspan → bloco simples.
        const isSpan = real.length === 1 && real[0].colSpan > 1;
        if (isSpan) {
          if (row.getAttribute('data-gr-mrow') !== 'span') row.setAttribute('data-gr-mrow', 'span');
          continue;
        }
        if (row.hasAttribute('data-gr-mrow')) row.removeAttribute('data-gr-mrow');

        let col = 0;
        const lastIdx = cells.length - 1;
        cells.forEach((cell, i) => {
          const span = Math.max(1, cell.colSpan || 1);
          if (cell.hasAttribute('data-gr-sel')) return; // checkbox de seleção: sem rótulo
          const label = labels[col] ?? '';
          col += span;
          if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
          // Papéis: título (1.ª coluna de dados), ações (última coluna sem texto útil / só botões).
          const firstData = real[0] === cell;
          const role = firstData ? 'title' : isActions(cell, label, i === lastIdx) ? 'actions' : '';
          if (role) { if (cell.getAttribute('data-gr-mrole') !== role) cell.setAttribute('data-gr-mrole', role); }
          else if (cell.hasAttribute('data-gr-mrole')) cell.removeAttribute('data-gr-mrole');
          // Células vazias não ocupam espaço no card.
          const empty = !clean(cell.textContent || '') && !cell.querySelector('button, a, input, select, img, svg, span[class*="rounded"]');
          if (empty) { if (!cell.hasAttribute('data-gr-mempty')) cell.setAttribute('data-gr-mempty', ''); }
          else if (cell.hasAttribute('data-gr-mempty')) cell.removeAttribute('data-gr-mempty');
        });
      }
    }
    seen.set(table, sig);
  }

  function isActions(cell: HTMLTableCellElement, label: string, isLast: boolean): boolean {
    if (/^(a[cç][oõ]es?|op[cç][oõ]es|actions?)$/i.test(label)) return true;
    if (!isLast) return false;
    // Última coluna só com botões (texto vem apenas dos nomes dos ícones Material).
    const clone = cell.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.material-symbols-outlined, .material-symbols-rounded, .material-icons').forEach((e) => e.remove());
    return !!cell.querySelector('button, a[role="button"]') && clean(clone.textContent || '').length < 3;
  }

  function flush() {
    raf = 0;
    const list = Array.from(pending);
    pending.clear();
    for (const t of list) apply(t);
  }

  function schedule(t: HTMLTableElement) {
    pending.add(t);
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function scanAll() {
    document.querySelectorAll('table').forEach((t) => schedule(t as HTMLTableElement));
  }

  const mo = new MutationObserver((muts) => {
    if (!mq.matches) return;
    for (const m of muts) {
      const target = m.target instanceof Element ? m.target : m.target.parentElement;
      const table = target?.closest('table');
      if (table) { schedule(table as HTMLTableElement); continue; }
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.tagName === 'TABLE') schedule(n as HTMLTableElement);
        else n.querySelectorAll?.('table').forEach((t) => schedule(t as HTMLTableElement));
      });
    }
  });

  function onMq() {
    if (mq.matches) { scanAll(); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); }
    else {
      mo.disconnect();
      document.querySelectorAll('table[data-gr-mcards]').forEach((t) => t.removeAttribute('data-gr-mcards'));
    }
  }

  const start = () => {
    mq.addEventListener?.('change', onMq);
    onMq();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  disposeGlobal = () => {
    mo.disconnect();
    mq.removeEventListener?.('change', onMq);
    if (raf) cancelAnimationFrame(raf);
    document.querySelectorAll('table[data-gr-mcards]').forEach((t) => t.removeAttribute('data-gr-mcards'));
    disposeGlobal = null;
  };
  return disposeGlobal;
}
