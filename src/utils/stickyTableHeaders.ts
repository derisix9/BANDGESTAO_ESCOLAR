/**
 * CABEÇALHOS DE TABELA CONGELADOS — função global.
 *
 * Chamada UMA vez no arranque (ver main.tsx), faz com que o `<thead>` de TODA
 * a tabela do sistema (existente ou futura) fique fixo enquanto se faz scroll
 * pelas linhas. Funciona por observação do DOM; nenhum ecrã precisa de mudar.
 *
 * Porque é que não basta `thead { position: sticky }`?
 *   O `sticky` prende-se ao ancestral que faz scroll mais próximo. Quase todas
 *   as tabelas do projeto estão dentro de um `<div class="overflow-x-auto">`,
 *   que é um contentor de scroll (nos dois eixos) mas SEM altura limitada — por
 *   isso nunca faz scroll vertical e o cabeçalho ficaria preso a nada. Logo,
 *   a função trata cada tabela num de três modos:
 *
 *   • "box"     — a tabela está sozinha num wrapper `overflow-x-auto`: o wrapper
 *                 ganha uma altura máxima (o que resta do ecrã) e passa a ter
 *                 scroll vertical próprio; o cabeçalho fica preso a esse scroll.
 *   • "natural" — a tabela já está num contentor com scroll de altura limitada
 *                 (corpo de um modal, lista com `max-h-…`): basta o `sticky`.
 *   • "doc"     — sem nenhum contentor de scroll: o cabeçalho prende-se ao
 *                 scroll da página, por baixo da barra de topo fixa.
 *
 *   Em "natural" e "doc", os ancestrais com `overflow:hidden` entre a tabela e o
 *   scroll (típicos cartões de cantos cortados) passam a `overflow:clip`: corta
 *   igual, mas não é contentor de scroll, por isso não rouba o `sticky`.
 *
 * Como o programador usa:
 *   • nada, por defeito;
 *   • `data-no-sticky-header` na tabela (ou num ancestral) exclui-a;
 *   • as tabelas dentro de `.printable-document/.printable-page/.printable-report`
 *     (documentos para imprimir: boletins, recibos…) são ignoradas.
 *   • Em impressão tudo volta ao normal (regras em styles/global-layout.css).
 */

export interface StickyTableHeadersOptions {
  /**
   * Distância ao topo (px) a que o cabeçalho fica quando é a PÁGINA que faz
   * scroll (modo "doc"). Predefinição: a altura da barra de topo fixa
   * (`header.fixed`), ou 0 se não existir.
   */
  topOffset?: number | (() => number);
  /** Folga (px) deixada por baixo de uma tabela em modo "box". Predefinição: 56. */
  bottomPadding?: number;
  /** Altura mínima (px) de uma tabela em modo "box". Predefinição: 240. */
  minHeight?: number;
}

type Mode = 'box' | 'natural' | 'doc';

interface Measure {
  table: HTMLTableElement;
  thead: HTMLTableSectionElement;
  mode: Mode;
  /** Wrapper que passa a ter scroll vertical (modo "box"). */
  box: HTMLElement | null;
  boxMaxHeight: number;
  top: number;
  clipChain: HTMLElement[];
  needsBg: boolean;
}

/** Fração da altura do ecrã dada a uma tabela dentro de um contentor de scroll. */
const SCROLL_PARENT_VIEWPORT_RATIO = 0.6;

const SKIP_SELECTOR =
  '[data-no-sticky-header], .printable-document, .printable-page, .printable-report';

let disposeGlobal: (() => void) | null = null;

export function enableStickyTableHeaders(options: StickyTableHeadersOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (disposeGlobal) return disposeGlobal; // idempotente

  const bottomPadding = options.bottomPadding ?? 56;
  const minHeight = options.minHeight ?? 240;

  const tracked = new Set<HTMLTableElement>();
  const dirty = new Set<HTMLTableElement>();
  const observedScrollers = new WeakSet<Element>();
  let raf = 0;

  /* ------------------------------------------------------------ helpers -- */

  const isScroll = (v: string) => v === 'auto' || v === 'scroll';

  function topOffset(): number {
    if (typeof options.topOffset === 'function') return options.topOffset();
    if (typeof options.topOffset === 'number') return options.topOffset;
    const header = document.querySelector<HTMLElement>('header.fixed');
    if (!header) return 0;
    const r = header.getBoundingClientRect();
    return r.top <= 1 ? Math.round(r.bottom) : 0;
  }

  /** Elementos-filho que contam como "conteúdo" (ignora <style>/<script>). */
  function contentChildren(el: HTMLElement): Element[] {
    return Array.from(el.children).filter((c) => c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT' && !c.classList.contains('gr-pager'));
  }

  function isTransparent(color: string): boolean {
    if (!color || color === 'transparent') return true;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    const alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    return alpha < 0.95;
  }

  /** O cabeçalho tem de ser opaco, senão as linhas veem-se "por baixo" ao
   *  fazer scroll. Se alguma célula não tiver fundo (nem a linha, nem o thead),
   *  o thead recebe um fundo de segurança. */
  function headerNeedsBackground(thead: HTMLTableSectionElement): boolean {
    if (!isTransparent(getComputedStyle(thead).backgroundColor)) return false;
    for (const row of Array.from(thead.rows)) {
      if (!isTransparent(getComputedStyle(row).backgroundColor)) continue;
      for (const cell of Array.from(row.cells)) {
        if (isTransparent(getComputedStyle(cell).backgroundColor)) return true;
      }
    }
    return false;
  }

  /** Ancestral com scroll vertical mais próximo de `el` (sem contar o próprio). */
  function scrollParentY(el: HTMLElement): HTMLElement | null {
    let a = el.parentElement;
    while (a && a !== document.body && a !== document.documentElement) {
      if (isScroll(getComputedStyle(a).overflowY)) return a;
      a = a.parentElement;
    }
    return null;
  }

  /* ----------------------------------------------------- medir (só ler) -- */

  function measure(table: HTMLTableElement): Measure | 'clear' | null {
    if (!table.isConnected) return 'clear';
    const thead = table.tHead;
    if (!thead || thead.rows.length === 0) return 'clear';
    if (table.closest(SKIP_SELECTOR)) return 'clear';
    if (table.parentElement?.closest('table')) return 'clear'; // tabela dentro de célula
    if (table.getClientRects().length === 0) return null; // escondida: tenta mais tarde

    // Sobe até ao primeiro contentor de scroll, anotando os `hidden` pelo caminho.
    const clipChain: HTMLElement[] = [];
    let scroller: HTMLElement | null = null;
    let a = table.parentElement;
    while (a && a !== document.body && a !== document.documentElement) {
      const cs = getComputedStyle(a);
      if (isScroll(cs.overflowX) || isScroll(cs.overflowY)) {
        scroller = a;
        break;
      }
      if (cs.overflowX === 'hidden' || cs.overflowY === 'hidden') clipChain.push(a);
      a = a.parentElement;
    }

    // Wrapper "só da tabela": scroll horizontal sem altura limitada (sem
    // `max-height` próprio) e sem mais conteúdo além da tabela.
    let mode: Mode;
    let box: HTMLElement | null = null;
    if (scroller) {
      const cs = getComputedStyle(scroller);
      const soleContent = contentChildren(scroller).length === 1;
      // Um wrapper que já marcámos tem `max-height` por nossa causa — continua a contar.
      const unbounded = cs.maxHeight === 'none' || scroller.hasAttribute('data-gr-scroll-box');
      if (soleContent && unbounded) {
        mode = 'box';
        box = scroller;
      } else {
        mode = 'natural';
      }
    } else {
      mode = 'doc';
    }

    const top = mode === 'doc' ? topOffset() : 0;

    // Altura disponível para o modo "box".
    //  • Sem contentor de scroll (página): o que resta do ecrã desde o topo do
    //    wrapper, para a tabela caber quando se está no início da página.
    //  • Dentro de um contentor de scroll (corpo de um modal…): NÃO se pode
    //    derivar da altura desse contentor — se ele tiver altura "de conteúdo",
    //    depende da própria tabela e a medição entra em círculo (encolhe até ao
    //    mínimo). Usa-se uma fração do ecrã. A exceção é o painel de um modal
    //    redimensionado pelo utilizador: aí a altura é fixa (logo, limitada de
    //    verdade) e a tabela acompanha o corpo do modal.
    let boxMaxHeight = 0;
    if (box) {
      const wr = box.getBoundingClientRect();
      const sp = scrollParentY(box);
      let avail: number;
      if (sp) {
        avail = window.innerHeight * SCROLL_PARENT_VIEWPORT_RATIO;
        if (sp.closest('[data-gr-rz-frozen]')) {
          const sr = sp.getBoundingClientRect();
          const offsetInParent = wr.top - sr.top + sp.scrollTop;
          avail = Math.min(avail, sp.clientHeight - offsetInParent - 16);
        }
      } else {
        const docTop = wr.top + window.scrollY;
        avail = window.innerHeight - docTop - bottomPadding;
        // Tabela lá em baixo na página: ocupa o ecrã inteiro quando lá chegarem.
        if (avail < minHeight + 80) avail = window.innerHeight - topOffset() - bottomPadding;
      }
      boxMaxHeight = Math.max(minHeight, Math.floor(avail));
    }

    return {
      table,
      thead,
      mode,
      box,
      boxMaxHeight,
      top,
      clipChain: mode === 'box' && box ? clipChainInside(table, box) : clipChain,
      needsBg: headerNeedsBackground(thead),
    };
  }

  /** No modo "box" só interessam os `hidden` ENTRE a tabela e o wrapper. */
  function clipChainInside(table: HTMLElement, box: HTMLElement): HTMLElement[] {
    const chain: HTMLElement[] = [];
    let a = table.parentElement;
    while (a && a !== box) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'hidden' || cs.overflowY === 'hidden') chain.push(a);
      a = a.parentElement;
    }
    return chain;
  }

  /* ------------------------------------------------- aplicar (só escrever) -- */

  function apply(m: Measure) {
    const { thead, mode } = m;
    if (thead.getAttribute('data-gr-sticky') !== mode) thead.setAttribute('data-gr-sticky', mode);
    const topPx = `${m.top}px`;
    if (thead.style.getPropertyValue('--gr-sticky-top') !== topPx) {
      thead.style.setProperty('--gr-sticky-top', topPx);
    }
    thead.toggleAttribute('data-gr-sticky-bg', m.needsBg);

    if (m.box) {
      const px = `${m.boxMaxHeight}px`;
      if (m.box.getAttribute('data-gr-scroll-box') === null) m.box.setAttribute('data-gr-scroll-box', '');
      if (m.box.style.getPropertyValue('--gr-box-max-h') !== px) {
        m.box.style.setProperty('--gr-box-max-h', px);
      }
      watchScroller(scrollParentY(m.box));
    } else {
      watchScroller(scrollParentY(m.table));
    }

    for (const el of m.clipChain) {
      if (!el.hasAttribute('data-gr-clip')) el.setAttribute('data-gr-clip', '');
    }
  }

  function clear(table: HTMLTableElement) {
    table.tHead?.removeAttribute('data-gr-sticky');
    table.tHead?.removeAttribute('data-gr-sticky-bg');
    table.tHead?.style.removeProperty('--gr-sticky-top');
    // Desfaz o wrapper "box" se só servia esta tabela.
    const box = table.parentElement?.closest<HTMLElement>('[data-gr-scroll-box]');
    if (box && box.querySelectorAll('table').length === 1) {
      box.removeAttribute('data-gr-scroll-box');
      box.style.removeProperty('--gr-box-max-h');
    }
  }

  /** Quando o contentor de scroll (ex.: corpo do modal) muda de tamanho, a
   *  altura disponível das tabelas lá dentro muda — recalcula-as. */
  function watchScroller(sp: HTMLElement | null) {
    if (!sp || observedScrollers.has(sp)) return;
    observedScrollers.add(sp);
    scrollerRO.observe(sp);
  }

  /* ------------------------------------------------------------ agenda -- */

  function flush() {
    raf = 0;
    const batch = Array.from(dirty);
    dirty.clear();
    // 1.º só leituras, 2.º só escritas — evita reflows em cadeia.
    const results = batch.map((t) => [t, measure(t)] as const);
    for (const [table, res] of results) {
      if (res === 'clear') {
        clear(table);
        if (!table.isConnected) {
          tracked.delete(table);
          tableRO.unobserve(table);
        }
      } else if (res) {
        apply(res);
      }
    }
  }

  function queue(table: HTMLTableElement) {
    dirty.add(table);
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function queueAll() {
    tracked.forEach(queue);
  }

  const tableRO = new ResizeObserver((entries) => {
    for (const e of entries) queue(e.target as HTMLTableElement);
  });
  const scrollerRO = new ResizeObserver(queueAll);

  function track(table: HTMLTableElement) {
    if (tracked.has(table)) return;
    tracked.add(table);
    tableRO.observe(table);
    queue(table);
  }

  function scan(node: HTMLElement) {
    if (node instanceof HTMLTableElement) track(node);
    node.querySelectorAll<HTMLTableElement>('table').forEach(track);
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) scan(n);
      });
      // Um <thead> que apareça depois (renderização condicional) também conta.
      if (r.target instanceof HTMLTableElement && r.addedNodes.length) queue(r.target);
    }
  });

  window.addEventListener('resize', queueAll);
  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body); // tabelas que já existam no arranque

  disposeGlobal = () => {
    mo.disconnect();
    tableRO.disconnect();
    scrollerRO.disconnect();
    window.removeEventListener('resize', queueAll);
    if (raf) cancelAnimationFrame(raf);
    tracked.forEach(clear);
    tracked.clear();
    dirty.clear();
    disposeGlobal = null;
  };
  return disposeGlobal;
}
