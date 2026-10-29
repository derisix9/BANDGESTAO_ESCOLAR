/**
 * PAGINAÇÃO GLOBAL DE TABELAS — função global (par do `stickyTableHeaders.ts`).
 *
 * Chamada UMA vez no arranque (ver main.tsx). Qualquer tabela do sistema, existente
 * ou futura, com mais de 25 registos passa a mostrar só 25 de cada vez, com uma barra
 *
 *        1 - 25 de 237 registos                        [ ‹ ]  (2)  [ › ]
 *
 * em que `‹` volta aos 25 registos anteriores e `›` avança para os 25 seguintes.
 * Tabelas com 25 registos ou menos não ganham barra nenhuma.
 *
 * Como funciona
 *   • Observa o DOM (como o cabeçalho fixo): nenhum ecrã precisa de mudar.
 *   • As linhas fora da página atual recebem `data-gr-pg-hidden` (CSS: display:none,
 *     só no ecrã). O React continua a ser o dono das linhas; esta função só as esconde.
 *   • Um "registo" é uma linha normal mais as linhas de detalhe que a seguem (uma só
 *     célula com colSpan, ex.: linha expandida) — ficam sempre na mesma página.
 *   • Na IMPRESSÃO nada fica escondido: folhas de presença, pautas, listas… saem completas.
 *   • Ecrãs que já paginam por conta própria (ver `TablePagination.tsx`, usado nas
 *     Propinas) desenham no máximo 25 linhas, por isso esta função nem lhes toca.
 *
 * Como o programador usa
 *   • nada, por defeito;
 *   • `data-no-pagination` na tabela (ou num ancestral) exclui-a;
 *   • `data-page-size="25"` na tabela muda o tamanho da página dessa tabela.
 */

export const TABLE_PAGE_SIZE = 25;

export const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
export const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

const SKIP_SELECTOR = '[data-no-pagination]';
const HIDDEN_ATTR = 'data-gr-pg-hidden';

interface PagerState {
  page: number;
  bar: HTMLDivElement;
  info: HTMLSpanElement;
  pageLabel: HTMLSpanElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  firstRow: Element | null;
  total: number;
}

let disposeGlobal: (() => void) | null = null;

export function enableTablePagination(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (disposeGlobal) return disposeGlobal; // idempotente

  const states = new Map<HTMLTableElement, PagerState>();
  const tracked = new Set<HTMLTableElement>();
  const dirty = new Set<HTMLTableElement>();
  let raf = 0;

  const isScroll = (v: string) => v === 'auto' || v === 'scroll';

  function pageSizeOf(table: HTMLTableElement): number {
    const n = Number(table.getAttribute('data-page-size'));
    return Number.isFinite(n) && n >= 5 ? Math.floor(n) : TABLE_PAGE_SIZE;
  }

  /** Linhas de dados agrupadas em "registos" (linha + linhas de detalhe de uma só célula). */
  function recordsOf(table: HTMLTableElement): HTMLTableRowElement[][] {
    const groups: HTMLTableRowElement[][] = [];
    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) {
        const isDetail = row.cells.length === 1 && row.cells[0].colSpan > 1;
        if (isDetail && groups.length > 0) groups[groups.length - 1].push(row);
        else groups.push([row]);
      }
    }
    return groups;
  }

  /** Onde fica a barra: depois da tabela, ou depois do wrapper de scroll que só contém a tabela. */
  function anchorOf(table: HTMLTableElement): HTMLElement {
    let anchor: HTMLElement = table;
    for (;;) {
      const p = anchor.parentElement;
      if (!p || p === document.body) break;
      const cs = getComputedStyle(p);
      const soleContent = Array.from(p.children).filter((c) => c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT' && !c.classList.contains('gr-pager')).length === 1;
      if (soleContent && (isScroll(cs.overflowX) || isScroll(cs.overflowY))) anchor = p;
      else break;
    }
    return anchor;
  }

  function scrollerOf(table: HTMLTableElement): HTMLElement | null {
    let a = table.parentElement;
    while (a && a !== document.body && a !== document.documentElement) {
      if (isScroll(getComputedStyle(a).overflowY)) return a;
      a = a.parentElement;
    }
    return null;
  }

  function buildBar(table: HTMLTableElement): PagerState {
    const bar = document.createElement('div');
    bar.className = 'gr-pager';
    bar.setAttribute('data-gr-pager', '');
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Paginação da tabela');

    const info = document.createElement('span');
    info.className = 'gr-pager__info';

    const ctrl = document.createElement('div');
    ctrl.className = 'gr-pager__ctrl';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'gr-pager__btn';
    prev.innerHTML = CHEVRON_LEFT;
    prev.title = 'Registos anteriores';
    prev.setAttribute('aria-label', 'Registos anteriores');

    const pageLabel = document.createElement('span');
    pageLabel.className = 'gr-pager__page';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'gr-pager__btn';
    next.innerHTML = CHEVRON_RIGHT;
    next.title = 'Registos seguintes';
    next.setAttribute('aria-label', 'Registos seguintes');

    ctrl.append(prev, pageLabel, next);
    bar.append(info, ctrl);

    const st: PagerState = { page: 1, bar, info, pageLabel, prev, next, firstRow: null, total: 0 };
    const go = (delta: number) => {
      st.page += delta;
      queue(table);
      const sc = scrollerOf(table);
      if (sc) sc.scrollTop = 0;
    };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    return st;
  }

  function removeState(table: HTMLTableElement) {
    const st = states.get(table);
    if (!st) return;
    st.bar.remove();
    states.delete(table);
    table.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((r) => r.removeAttribute(HIDDEN_ATTR));
  }

  function update(table: HTMLTableElement) {
    if (!table.isConnected || table.closest(SKIP_SELECTOR) || table.parentElement?.closest('table')) {
      removeState(table);
      if (!table.isConnected) tracked.delete(table);
      return;
    }
    const size = pageSizeOf(table);
    const groups = recordsOf(table);
    const total = groups.length;

    if (total <= size) {
      removeState(table);
      return;
    }

    let st = states.get(table);
    if (!st) {
      st = buildBar(table);
      states.set(table, st);
    }

    // Se a primeira linha mudou (pesquisa/filtro novo) volta à página 1; se só mudou
    // a quantidade, mantém a página (ajustada ao novo total).
    const firstRow = groups[0][0] ?? null;
    if (st.firstRow && st.firstRow !== firstRow) st.page = 1;
    st.firstRow = firstRow;
    st.total = total;

    const pages = Math.max(1, Math.ceil(total / size));
    st.page = Math.min(Math.max(1, st.page), pages);
    const from = (st.page - 1) * size;
    const to = Math.min(from + size, total);

    groups.forEach((g, i) => {
      const hide = i < from || i >= to;
      for (const row of g) {
        if (hide) { if (!row.hasAttribute(HIDDEN_ATTR)) row.setAttribute(HIDDEN_ATTR, ''); }
        else if (row.hasAttribute(HIDDEN_ATTR)) row.removeAttribute(HIDDEN_ATTR);
      }
    });

    const infoText = `${from + 1} - ${to}`;
    st.info.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: infoText }),
      document.createTextNode(' '),
      Object.assign(document.createElement('span'), { textContent: 'de' }),
      document.createTextNode(' '),
      Object.assign(document.createElement('strong'), { textContent: String(total) }),
      document.createTextNode(' registos')
    );
    st.pageLabel.textContent = String(st.page);
    st.pageLabel.title = `Página ${st.page} de ${pages}`;
    st.prev.disabled = st.page <= 1;
    st.next.disabled = st.page >= pages;

    const anchor = anchorOf(table);
    if (anchor.nextElementSibling !== st.bar) anchor.after(st.bar);
  }

  function flush() {
    raf = 0;
    const batch = Array.from(dirty);
    dirty.clear();
    for (const t of batch) update(t);
  }

  function queue(table: HTMLTableElement) {
    dirty.add(table);
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function track(table: HTMLTableElement) {
    if (tracked.has(table)) return;
    tracked.add(table);
    queue(table);
  }

  function scan(node: HTMLElement) {
    if (node instanceof HTMLTableElement) track(node);
    node.querySelectorAll<HTMLTableElement>('table').forEach(track);
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const target = r.target as Element;
      if (target.classList?.contains('gr-pager') || target.closest?.('.gr-pager')) continue;
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && !n.classList.contains('gr-pager')) scan(n);
      });
      // Linhas acrescentadas/removidas numa tabela já seguida (nova pesquisa, novo registo…).
      const table = target.closest?.('table') as HTMLTableElement | null;
      if (table && (r.addedNodes.length || r.removedNodes.length)) {
        if (!tracked.has(table)) track(table); else queue(table);
      }
      // Tabelas removidas do ecrã: apaga a barra que ficou para trás.
      if (r.removedNodes.length && states.size) {
        r.removedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement) || n.classList.contains('gr-pager')) return;
          states.forEach((_st, t) => { if (!t.isConnected) queue(t); });
        });
      }
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body); // tabelas que já existam no arranque

  disposeGlobal = () => {
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
    Array.from(states.keys()).forEach(removeState);
    tracked.clear();
    dirty.clear();
    disposeGlobal = null;
  };
  return disposeGlobal;
}
