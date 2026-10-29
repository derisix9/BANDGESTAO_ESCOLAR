/**
 * TABELAS → CARTÕES NO TELEMÓVEL (função global, chamada uma vez no main.tsx).
 *
 * Em ecrãs < 768px, tabelas com poucas colunas passam a ser mostradas como uma
 * lista de cartões (cada linha = um cartão, "Coluna: valor"). O JS só marca o
 * DOM (data-mt-cards + data-label em cada célula); o aspeto vive em
 * styles/mobile-app.css. Não altera dados nem handlers: são as mesmas linhas.
 *
 * Ficam de fora (continuam com scroll horizontal): tabelas com mais de MAX_COLS
 * colunas (grelhas estilo Excel, pautas, mapas), e tudo dentro de [data-no-cards].
 */

const MAX_COLS = 7;
let started = false;

function process(table: HTMLTableElement) {
  if (table.closest('[data-no-cards]') || table.hasAttribute('data-no-cards')) return;
  const headRow = table.tHead?.rows[0] ?? table.querySelector('tr');
  if (!headRow) return;
  const heads = Array.from(headRow.cells).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
  if (heads.length < 2 || heads.length > MAX_COLS) { table.removeAttribute('data-mt-cards'); return; }
  table.setAttribute('data-mt-cards', '');
  table.querySelectorAll('tbody tr').forEach((tr) => {
    Array.from((tr as HTMLTableRowElement).cells).forEach((td, i) => {
      if (td.hasAttribute('colspan') && td.getAttribute('colspan') !== '1') { td.setAttribute('data-span', ''); return; }
      const label = heads[i] || '';
      if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
    });
  });
}

export function enableMobileTables(maxWidth = 767): () => void {
  if (typeof window === 'undefined' || started) return () => {};
  started = true;
  const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
  let raf = 0;
  const run = () => {
    raf = 0;
    if (!mq.matches) return;
    document.querySelectorAll<HTMLTableElement>('table').forEach(process);
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(run); };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });
  mq.addEventListener?.('change', schedule);
  schedule();
  return () => { mo.disconnect(); mq.removeEventListener?.('change', schedule); started = false; };
}
