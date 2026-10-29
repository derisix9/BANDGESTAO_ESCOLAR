/**
 * QUEBRA AUTOMÁTICA DE LINHA NO TELEMÓVEL — função global.
 *
 * Chamada UMA vez no arranque (ver main.tsx). Em ecrãs estreitos, sempre que uma
 * fila de componentes (botões, cards, filtros, abas, KPIs…) fica maior do que o
 * ecrã e o último componente estaria a ser cortado ou a ficar fora da vista, essa
 * fila passa a quebrar linha: o que não cabe desce para a linha de baixo, em vez
 * de continuar numa linha reta.
 *
 * Como funciona:
 *   • observa o DOM (novos elementos), a rotação/redimensionamento e o fim do
 *     carregamento de fontes;
 *   • para cada contentor `flex` em linha ou `grid` que ultrapasse a sua largura,
 *     acrescenta `data-gr-wrap` (flex → `flex-wrap: wrap`) ou `data-gr-wrap-grid`
 *     (grid → colunas automáticas que quebram). O aspeto vive em
 *     `styles/global-layout.css`, só dentro de `@media (max-width: 767px)`;
 *   • filas que já têm scroll horizontal de propósito (`overflow-x: auto|scroll`),
 *     tabelas e `nav` ficam de fora, tal como qualquer elemento (ou descendente de)
 *     com `data-no-wrap`.
 *
 * Como o programador usa: nada — qualquer nova fila já fica protegida.
 * `data-no-wrap` exclui uma fila; `data-wrap` força a quebra numa fila.
 */

export interface MobileWrapOptions {
  /** Largura máxima (px) considerada "telemóvel". Predefinição: 767. */
  maxWidth?: number;
}

const CANDIDATES = '.flex, .inline-flex, .grid, .inline-grid, [data-wrap]';

let disposeGlobal: (() => void) | null = null;

export function enableMobileWrap(options: MobileWrapOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (disposeGlobal) return disposeGlobal; // idempotente

  const maxWidth = options.maxWidth ?? 767;
  const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);

  const pending = new Set<HTMLElement>();
  let full = false;
  let raf = 0;
  let passes = 0;

  const isScrollX = (cs: CSSStyleDeclaration) => cs.overflowX === 'auto' || cs.overflowX === 'scroll';

  /** Um filho ultrapassa a caixa da própria célula (texto/botão sem quebra). */
  const childOverflows = (el: HTMLElement): boolean => {
    for (const c of Array.from(el.children)) {
      if (!(c instanceof HTMLElement)) continue;
      if (c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'visible') return true;
    }
    return false;
  };

  function check(el: HTMLElement): boolean {
    if (el.hasAttribute('data-gr-wrap') || el.hasAttribute('data-gr-wrap-grid')) return false;
    if (el.tagName === 'NAV' || el.closest('[data-no-wrap], table, nav')) return false;
    if (!el.isConnected || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;

    const cs = getComputedStyle(el);
    if (isScrollX(cs)) return false; // scroll horizontal intencional

    const forced = el.hasAttribute('data-wrap');
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      if (cs.flexDirection.startsWith('column')) return false;
      if (cs.flexWrap !== 'nowrap') return false; // já quebra
      if (el.children.length < 2) return false;
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      if (forced || overflowing) {
        el.setAttribute('data-gr-wrap', '');
        return true;
      }
    } else if (cs.display === 'grid' || cs.display === 'inline-grid') {
      if (el.children.length < 2) return false;
      const overflowing = el.scrollWidth > el.clientWidth + 1 || childOverflows(el);
      if (forced || overflowing) {
        el.setAttribute('data-gr-wrap-grid', '');
        return true;
      }
    }
    return false;
  }

  function scanRoot(root: HTMLElement): boolean {
    let changed = false;
    if (root.matches?.(CANDIDATES)) changed = check(root) || changed;
    root.querySelectorAll<HTMLElement>(CANDIDATES).forEach((el) => {
      changed = check(el) || changed;
    });
    return changed;
  }

  function run() {
    raf = 0;
    if (!mq.matches) {
      pending.clear();
      full = false;
      return;
    }
    const roots = full ? [document.body] : Array.from(pending).filter((n) => n.isConnected);
    pending.clear();
    full = false;
    let changed = false;
    roots.forEach((r) => {
      changed = scanRoot(r) || changed;
    });
    // Uma quebra pode resolver o excesso do contentor pai (ou revelar outro): revê
    // mais um par de vezes, sem nunca entrar em ciclo.
    if (changed && passes < 3) {
      passes++;
      full = true;
      schedule();
    } else {
      passes = 0;
    }
  }

  function schedule() {
    if (raf) return;
    raf = window.requestAnimationFrame(() => window.setTimeout(run, 60));
  }

  const mo = new MutationObserver((records) => {
    if (!mq.matches) return;
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) pending.add(n);
      });
      if (r.type === 'attributes' && r.target instanceof HTMLElement) pending.add(r.target.parentElement || r.target);
    }
    schedule();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  const requestFull = () => {
    full = true;
    schedule();
  };
  window.addEventListener('resize', requestFull);
  window.addEventListener('orientationchange', requestFull);
  window.addEventListener('load', requestFull);
  mq.addEventListener?.('change', requestFull);
  (document as any).fonts?.ready?.then?.(requestFull);

  requestFull();

  disposeGlobal = () => {
    mo.disconnect();
    window.removeEventListener('resize', requestFull);
    window.removeEventListener('orientationchange', requestFull);
    window.removeEventListener('load', requestFull);
    mq.removeEventListener?.('change', requestFull);
    if (raf) window.cancelAnimationFrame(raf);
    document.querySelectorAll('[data-gr-wrap], [data-gr-wrap-grid]').forEach((el) => {
      el.removeAttribute('data-gr-wrap');
      el.removeAttribute('data-gr-wrap-grid');
    });
    disposeGlobal = null;
  };
  return disposeGlobal;
}
