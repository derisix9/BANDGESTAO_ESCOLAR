/**
 * MODAIS REDIMENSIONÁVEIS — função global.
 *
 * Chamada UMA vez no arranque (ver main.tsx), torna redimensionável qualquer
 * modal/formulário em ecrã, existente ou futuro, sem ser preciso tocar em cada
 * componente. Funciona por observação do DOM: sempre que aparece um overlay de
 * modal (`fixed inset-0`), acrescenta-lhe 8 pegas (4 bordas + 4 cantos) à volta
 * do painel.
 *
 * Como o utilizador usa:
 *   • arrastar uma borda/canto  → redimensiona o modal;
 *   • duplo-clique numa pega    → repõe o tamanho original;
 *   • arrastar o cabeçalho do modal (ou a pega "mover" da barrinha que
 *     aparece por cima do modal) → move o modal para qualquer parte do ecrã;
 *   • o conteúdo de qualquer modal rola na vertical dentro do próprio modal
 *     (cabeçalho/rodapé fixos), como no modal de Nova Matrícula;
 *   • botão "maximizar" da barrinha, ou duplo-clique no cabeçalho → maximiza
 *     / repõe o modal.
 *
 * Como o programador usa:
 *   • nada, por defeito — qualquer novo modal já fica redimensionável;
 *   • `data-no-resize` no overlay (ou no painel) exclui um modal
 *     (usado nos avisos/confirmações pequenos);
 *   • `data-resizable-modal` num overlay que não use as classes
 *     `fixed inset-0` inclui-o.
 *
 * Notas de desenho:
 *   • Até o utilizador agarrar uma pega, o modal NÃO é alterado (mantém o
 *     layout/centragem original). Só no primeiro arrasto é que o painel passa
 *     a `position:absolute` dentro do overlay, com o tamanho atual.
 *   • As pegas são filhas do OVERLAY (não do painel): assim ficam cá fora, não
 *     são cortadas pelo `overflow-hidden` do painel, não tapam as barras de
 *     scroll internas e o clique nelas nunca fecha o modal (o `target` não é o
 *     overlay).
 *   • Em impressão as pegas desaparecem e o painel volta ao fluxo normal
 *     (regras em styles/global-layout.css).
 */

export interface ResizableModalsOptions {
  /** Largura mínima do modal, em px. Predefinição: 360. */
  minWidth?: number;
  /** Altura mínima do modal, em px. Predefinição: 240. */
  minHeight?: number;
  /** Folga mantida em relação às bordas do ecrã ao redimensionar, em px. Predefinição: 8. */
  edgeMargin?: number;
  /** Seletor dos overlays de modal. Predefinição: `.fixed.inset-0, [data-resizable-modal]`. */
  overlaySelector?: string;
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const DIRS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ModalState {
  overlay: HTMLElement;
  panel: HTMLElement | null;
  frame: HTMLElement;
  ro: ResizeObserver;
  mo: MutationObserver;
  frozen: boolean;
  /** Modal maximizado (ocupa o ecrã todo, menos a folga). */
  maximized: boolean;
  /** Caixa antes de maximizar — usada para repor. */
  preMax: Box | null;
  bar: HTMLElement;
  maxBtn: HTMLButtonElement;
  /** Atributo `style` do painel antes do primeiro arrasto (para o duplo-clique repor). */
  origStyle: string | null;
  timers: number[];
  dispose: () => void;
}

const DEFAULT_SELECTOR = '.fixed.inset-0, [data-resizable-modal]';
const FRAME_CLASS = 'gr-rz-frame';

const svg = (inner: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_MOVE = svg('<path d="M8 2v12M2 8h12M8 2 6.3 3.7M8 2l1.7 1.7M8 14l-1.7-1.7M8 14l1.7-1.7M2 8l1.7-1.7M2 8l1.7 1.7M14 8l-1.7-1.7M14 8l-1.7 1.7"/>');
const ICON_MAXIMIZE = svg('<rect x="3" y="3" width="10" height="10" rx="1"/>');
const ICON_RESTORE = svg('<rect x="3" y="5.5" width="7.5" height="7.5" rx="1"/><path d="M5.5 5.5V3.5a1 1 0 0 1 1-1H12.5a1 1 0 0 1 1 1V9.5a1 1 0 0 1-1 1H10.5"/>');

let disposeGlobal: (() => void) | null = null;

export function enableResizableModals(options: ResizableModalsOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (disposeGlobal) return disposeGlobal; // idempotente

  const minWidth = options.minWidth ?? 360;
  const minHeight = options.minHeight ?? 240;
  const edgeMargin = options.edgeMargin ?? 8;
  const selector = options.overlaySelector ?? DEFAULT_SELECTOR;

  const states = new Map<HTMLElement, ModalState>();

  /* ------------------------------------------------------------ painel -- */

  /** O painel é o primeiro filho "real" do overlay: ignora <style>/<script>,
   *  a nossa moldura e elementos absolutos/fixos (botões flutuantes, fundos). */
  function findPanel(overlay: HTMLElement, frame: HTMLElement): HTMLElement | null {
    for (const child of Array.from(overlay.children)) {
      if (child === frame || !(child instanceof HTMLElement)) continue;
      const tag = child.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT') continue;
      if (child.hasAttribute('data-gr-rz-frozen')) return child; // já é o nosso painel
      const cs = getComputedStyle(child);
      if (cs.display === 'none') continue;
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      return child;
    }
    return null;
  }

  function isExcluded(s: ModalState): boolean {
    return (
      s.overlay.hasAttribute('data-no-resize') ||
      !!s.panel?.hasAttribute('data-no-resize') ||
      !!s.overlay.closest('[data-no-resize]')
    );
  }

  /** Caixa do painel em coordenadas do overlay (contam o scroll do overlay). */
  function panelBox(s: ModalState): Box | null {
    if (!s.panel) return null;
    const pr = s.panel.getBoundingClientRect();
    const or = s.overlay.getBoundingClientRect();
    return {
      left: pr.left - or.left + s.overlay.scrollLeft,
      top: pr.top - or.top + s.overlay.scrollTop,
      width: pr.width,
      height: pr.height,
    };
  }

  /** Mostra a moldura (e as pegas) só se isto for de facto um diálogo:
   *  um painel menor que o overlay. Backdrops sem painel, ou painéis a ocupar
   *  o ecrã todo, não são modais redimensionáveis. */
  function syncFrame(s: ModalState) {
    const box = panelBox(s);
    const or = s.overlay.getBoundingClientRect();
    const isDialog =
      !!box &&
      !isExcluded(s) &&
      box.width > 40 &&
      box.height > 40 &&
      (s.frozen || box.width < or.width - 1 || box.height < or.height - 1);
    if (!isDialog || !box) {
      s.frame.style.display = 'none';
      return;
    }
    s.frame.style.display = '';
    // Sem espaço por cima do painel (encostado ao topo): a barra passa para dentro.
    if (box.top - s.overlay.scrollTop < 30) s.frame.setAttribute('data-bar-inside', '');
    else s.frame.removeAttribute('data-bar-inside');
    s.maxBtn.innerHTML = s.maximized ? ICON_RESTORE : ICON_MAXIMIZE;
    s.maxBtn.title = s.maximized ? 'Repor tamanho' : 'Maximizar';
    s.maxBtn.setAttribute('aria-label', s.maxBtn.title);
    s.frame.style.left = `${box.left}px`;
    s.frame.style.top = `${box.top}px`;
    s.frame.style.width = `${box.width}px`;
    s.frame.style.height = `${box.height}px`;
  }

  /* ------------------------------------------------------------- estado -- */

  function freeze(s: ModalState): Box | null {
    if (!s.panel) return null;
    const box = panelBox(s);
    if (!box) return null;
    if (!s.frozen) {
      s.origStyle = s.panel.getAttribute('style');
      const st = s.panel.style;
      st.position = 'absolute';
      st.margin = '0';
      st.maxWidth = 'none';
      st.maxHeight = 'none';
      st.minWidth = `${Math.min(minWidth, box.width)}px`;
      st.minHeight = `${Math.min(minHeight, box.height)}px`;
      st.boxSizing = 'border-box';
      // Painéis com `overflow-hidden` cortariam o conteúdo ao encolher; assim
      // ganham scroll vertical próprio quando o conteúdo não cabe.
      if (getComputedStyle(s.panel).overflowY === 'hidden') st.overflowY = 'auto';
      s.panel.setAttribute('data-gr-rz-frozen', '');
      s.frozen = true;
    }
    applyBox(s, box);
    return box;
  }

  function applyBox(s: ModalState, b: Box) {
    if (!s.panel) return;
    const st = s.panel.style;
    st.left = `${b.left}px`;
    st.top = `${b.top}px`;
    st.width = `${b.width}px`;
    st.height = `${b.height}px`;
  }

  function reset(s: ModalState) {
    if (!s.panel || !s.frozen) return;
    if (s.origStyle === null) s.panel.removeAttribute('style');
    else s.panel.setAttribute('style', s.origStyle);
    s.panel.removeAttribute('data-gr-rz-frozen');
    s.frozen = false;
    s.maximized = false;
    s.preMax = null;
    s.origStyle = null;
    syncFrame(s);
  }

  /** Se a janela do browser encolher, mantém o modal (já redimensionado) dentro do ecrã. */
  function clampFrozen(s: ModalState) {
    if (!s.frozen || !s.panel) return;
    if (s.maximized) {
      applyMaximize(s);
      return;
    }
    const W = s.overlay.clientWidth;
    const H = s.overlay.clientHeight;
    const st = s.panel.style;
    let left = parseFloat(st.left) || 0;
    let top = parseFloat(st.top) || 0;
    let width = parseFloat(st.width) || 0;
    let height = parseFloat(st.height) || 0;
    const maxW = Math.max(120, W - 2 * edgeMargin);
    width = Math.min(width, maxW);
    left = Math.min(Math.max(left, edgeMargin), Math.max(edgeMargin, W - width - edgeMargin));
    // Overlays com scroll vertical (ex.: boletim mais alto que o ecrã) deixam o
    // painel ser mais alto que a janela — o utilizador faz scroll. Só se limita
    // a altura quando o overlay NÃO tem scroll.
    const oy = getComputedStyle(s.overlay).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') {
      const maxH = Math.max(120, H - 2 * edgeMargin);
      height = Math.min(height, maxH);
      top = Math.min(Math.max(top, edgeMargin), Math.max(edgeMargin, H - height - edgeMargin));
    }
    applyBox(s, { left, top, width, height });
  }

  /* ------------------------------------------------------------ arrasto -- */

  function startDrag(s: ModalState, dir: Dir, ev: PointerEvent, handle: HTMLElement) {
    const start = freeze(s);
    if (!start) return;
    ev.preventDefault();
    s.maximized = false;
    s.preMax = null;

    const W = Math.max(s.overlay.clientWidth, start.left + start.width);
    const H = Math.max(s.overlay.clientHeight, start.top + start.height);
    const minW = Math.min(minWidth, W - 2 * edgeMargin);
    const minH = Math.min(minHeight, H - 2 * edgeMargin);
    // Limites: dentro do ecrã, salvo se o painel já os ultrapassava à partida.
    const lo = { x: Math.min(edgeMargin, start.left), y: Math.min(edgeMargin, start.top) };
    const hi = {
      x: Math.max(W - edgeMargin, start.left + start.width),
      y: Math.max(H - edgeMargin, start.top + start.height),
    };
    const x0 = ev.clientX;
    const y0 = ev.clientY;

    handle.setPointerCapture(ev.pointerId);
    handle.setAttribute('data-active', '');
    document.documentElement.classList.add('gr-rz-dragging');

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      let { left, top, width, height } = start;

      if (dir.includes('e')) {
        width = Math.min(Math.max(start.width + dx, minW), hi.x - start.left);
      }
      if (dir.includes('s')) {
        height = Math.min(Math.max(start.height + dy, minH), hi.y - start.top);
      }
      if (dir.includes('w')) {
        const right = start.left + start.width;
        left = Math.min(Math.max(start.left + dx, lo.x), right - minW);
        width = right - left;
      }
      if (dir.includes('n')) {
        const bottom = start.top + start.height;
        top = Math.min(Math.max(start.top + dy, lo.y), bottom - minH);
        height = bottom - top;
      }
      applyBox(s, { left, top, width, height });
      syncFrame(s);
    };

    const onEnd = (e: PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      handle.removeAttribute('data-active');
      document.documentElement.classList.remove('gr-rz-dragging');
      // Se o rato for solto sobre o fundo escuro, o browser pode gerar um
      // `click` que fecharia o modal. Engole esse (único) clique.
      const swallow = (c: Event) => c.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      syncFrame(s);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  /* ------------------------------------------------- rolagem vertical -- */

  const isScrollable = (el: HTMLElement) => {
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll';
  };

  /**
   * Garante que o conteúdo de QUALQUER modal rola na vertical dentro do painel
   * (cabeçalho e rodapé ficam fixos), em vez de o modal sair do ecrã:
   *  • o painel nunca passa da altura da janela e vira coluna flex;
   *  • a zona de conteúdo (o filho mais alto que ainda não rola) ganha overflow-y:auto;
   *  • se não houver filho adequado, o próprio painel rola.
   * Modais que já tratam do seu scroll (ex.: Nova Matrícula) ficam como estão.
   */
  function ensureScroll(s: ModalState) {
    const panel = s.panel;
    if (!panel || isExcluded(s) || s.overlay.hasAttribute('data-no-scroll-fix')) return;
    const st = panel.style;
    if (!s.frozen) st.maxHeight = `${Math.max(160, s.overlay.clientHeight - 2 * edgeMargin)}px`;

    const kids = Array.from(panel.children).filter((c): c is HTMLElement => {
      if (!(c instanceof HTMLElement) || c === s.frame) return false;
      if (c.tagName === 'STYLE' || c.tagName === 'SCRIPT') return false;
      const cs = getComputedStyle(c);
      return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
    });
    if (kids.some(isScrollable)) return; // já tem a sua própria zona com scroll

    const pcs = getComputedStyle(panel);
    if (kids.length >= 2 || (kids.length === 1 && pcs.display === 'flex' && pcs.flexDirection === 'column')) {
      if (pcs.display !== 'flex' && pcs.display !== 'grid') {
        st.display = 'flex';
        st.flexDirection = 'column';
      }
      // Zona de conteúdo = o filho mais alto (o cabeçalho/rodapé são baixos).
      const body = kids.reduce((a, b) => (b.scrollHeight > a.scrollHeight ? b : a));
      body.style.overflowY = 'auto';
      body.style.minHeight = '0';
      if (getComputedStyle(body).flexGrow === '0') body.style.flexGrow = '1';
      body.setAttribute('data-gr-scroll-body', '');
      // O painel corta o excesso (o scroll é do conteúdo) — não mexe se já cortava.
      if (pcs.overflowY === 'visible') st.overflowY = 'hidden';
    } else {
      // Painel com um único bloco: o próprio painel rola.
      st.overflowY = 'auto';
    }
    panel.setAttribute('data-gr-scroll', '');
  }

  /* ---------------------------------------------------- maximizar / mover -- */

  function applyMaximize(s: ModalState) {
    if (!s.panel) return;
    s.overlay.scrollTop = 0;
    s.overlay.scrollLeft = 0;
    const W = s.overlay.clientWidth;
    const H = s.overlay.clientHeight;
    applyBox(s, {
      left: edgeMargin,
      top: edgeMargin,
      width: Math.max(120, W - 2 * edgeMargin),
      height: Math.max(120, H - 2 * edgeMargin),
    });
  }

  function toggleMaximize(s: ModalState) {
    if (!s.panel || isExcluded(s)) return;
    if (s.maximized) {
      if (s.preMax) applyBox(s, s.preMax);
      s.maximized = false;
      s.preMax = null;
    } else {
      const box = freeze(s);
      if (!box) return;
      s.preMax = box;
      s.maximized = true;
      applyMaximize(s);
    }
    syncFrame(s);
  }

  const INTERACTIVE =
    'button, a, input, select, textarea, label, summary, [role="button"], [contenteditable="true"], [data-no-drag]';

  /** Cabeçalho do modal: `[data-modal-header]`, `<header>` ou o primeiro bloco baixo no topo do painel. */
  function findHeader(s: ModalState): HTMLElement | null {
    const panel = s.panel;
    if (!panel) return null;
    const explicit = panel.querySelector<HTMLElement>('[data-modal-header], header');
    if (explicit) return explicit;
    const pTop = panel.getBoundingClientRect().top;
    const visit = (el: HTMLElement, depth: number): HTMLElement | null => {
      for (const child of Array.from(el.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child === s.frame || child.tagName === 'STYLE' || child.tagName === 'SCRIPT') continue;
        const cs = getComputedStyle(child);
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
        const r = child.getBoundingClientRect();
        if (Math.abs(r.top - pTop) > 6) return null; // o primeiro bloco visível já não está no topo
        if (r.height >= 28 && r.height <= 140) return child;
        return depth < 2 ? visit(child, depth + 1) : null;
      }
      return null;
    };
    return visit(panel, 0);
  }

  /** Move o modal arrastando `source` (cabeçalho ou pega "mover"). Limiar de 4px para não estragar cliques. */
  function startMove(s: ModalState, ev: PointerEvent) {
    if (!s.panel) return;
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let started = false;
    let start: Box | null = null;
    let W = 0;
    let H = 0;

    const begin = () => {
      const wasMax = s.maximized;
      const pre = s.preMax;
      start = freeze(s);
      if (!start) return false;
      if (wasMax) {
        // Arrastar um modal maximizado repõe o tamanho anterior, preso ao cursor.
        s.maximized = false;
        s.preMax = null;
        const w = pre?.width ?? Math.min(start.width, 900);
        const h = pre?.height ?? Math.min(start.height, 600);
        const orect = s.overlay.getBoundingClientRect();
        const ratio = start.width > 0 ? (x0 - orect.left) / start.width : 0.5;
        start = {
          left: Math.max(0, x0 - orect.left - w * ratio),
          top: Math.max(0, y0 - orect.top - 16),
          width: w,
          height: h,
        };
        applyBox(s, start);
      }
      W = s.overlay.clientWidth;
      H = s.overlay.clientHeight;
      window.getSelection()?.removeAllRanges();
      document.documentElement.classList.add('gr-rz-dragging');
      s.frame.setAttribute('data-moving', '');
      return true;
    };

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!started) {
        if (Math.hypot(dx, dy) < 4) return;
        if (!begin() || !start) {
          cleanup();
          return;
        }
        started = true;
      }
      if (!start) return;
      // Mantém pelo menos uma faixa do modal visível para poder voltar a agarrá-lo.
      const keepX = 80;
      const keepY = 40;
      const left = Math.min(Math.max(start.left + dx, keepX - start.width), Math.max(W - keepX, start.left));
      const top = Math.min(Math.max(start.top + dy, 0), Math.max(H - keepY, start.top));
      applyBox(s, { left, top, width: start.width, height: start.height });
      syncFrame(s);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    const onEnd = () => {
      cleanup();
      if (!started) return;
      document.documentElement.classList.remove('gr-rz-dragging');
      s.frame.removeAttribute('data-moving');
      // Soltar sobre o fundo escuro geraria um `click` que fecharia o modal: engole-o.
      const swallow = (c: Event) => c.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      syncFrame(s);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  /* ------------------------------------------------------------- registo -- */

  function buildFrame(): HTMLElement {
    const frame = document.createElement('div');
    frame.className = FRAME_CLASS;
    frame.setAttribute('aria-hidden', 'true');
    for (const d of DIRS) {
      const h = document.createElement('div');
      h.className = 'gr-rz-h';
      h.dataset.dir = d;
      frame.appendChild(h);
    }
    const bar = document.createElement('div');
    bar.className = 'gr-rz-bar';
    const grip = document.createElement('div');
    grip.className = 'gr-rz-grip';
    grip.title = 'Arraste para mover';
    grip.innerHTML = ICON_MOVE;
    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'gr-rz-max';
    maxBtn.innerHTML = ICON_MAXIMIZE;
    bar.appendChild(grip);
    bar.appendChild(maxBtn);
    frame.appendChild(bar);
    return frame;
  }

  function register(overlay: HTMLElement) {
    if (states.has(overlay)) return;
    if (overlay.classList.contains(FRAME_CLASS)) return;

    const frame = buildFrame();
    const s: ModalState = {
      overlay,
      panel: null,
      frame,
      frozen: false,
      maximized: false,
      preMax: null,
      bar: frame.querySelector<HTMLElement>('.gr-rz-bar') as HTMLElement,
      maxBtn: frame.querySelector<HTMLButtonElement>('.gr-rz-max') as HTMLButtonElement,
      origStyle: null,
      timers: [],
      ro: new ResizeObserver(() => {
        if (!s.panel) return;
        clampFrozen(s);
        syncFrame(s);
      }),
      mo: new MutationObserver(() => resolve(s)),
      dispose: () => {},
    };

    s.dispose = () => {
      s.timers.forEach((t) => window.clearTimeout(t));
      s.ro.disconnect();
      s.mo.disconnect();
      s.panel?.removeEventListener('animationend', onAnim);
      s.panel?.removeEventListener('transitionend', onAnim);
      overlay.removeEventListener('pointerdown', onHeaderDown);
      overlay.removeEventListener('dblclick', onHeaderDbl);
      frame.remove();
      states.delete(overlay);
    };
    const onAnim = () => syncFrame(s);

    /** (Re)descobre o painel — o React pode trocá-lo ou montá-lo mais tarde. */
    function resolve(st: ModalState) {
      const next = findPanel(overlay, frame);
      if (next === st.panel) return;
      st.panel?.removeEventListener('animationend', onAnim);
      st.panel?.removeEventListener('transitionend', onAnim);
      st.ro.disconnect();
      st.panel = next;
      st.frozen = !!next?.hasAttribute('data-gr-rz-frozen');
      st.origStyle = null;
      st.ro.observe(overlay);
      if (next) {
        ensureScroll(st);
        st.ro.observe(next);
        next.addEventListener('animationend', onAnim);
        next.addEventListener('transitionend', onAnim);
      }
      syncFrame(st);
    }

    // Pegas: arrastar = redimensionar; duplo-clique = repor.
    // Barra: "mover" arrasta o modal; botão maximiza/repõe.
    frame.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const h = target.closest<HTMLElement>('.gr-rz-h');
      if (h) {
        e.stopPropagation();
        startDrag(s, h.dataset.dir as Dir, e, h);
        return;
      }
      if (target.closest('.gr-rz-grip')) {
        e.stopPropagation();
        e.preventDefault();
        startMove(s, e);
      }
    });
    s.maxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMaximize(s);
    });
    frame.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.gr-rz-h')) {
        e.preventDefault();
        e.stopPropagation();
        reset(s);
      } else if (target.closest('.gr-rz-grip')) {
        e.preventDefault();
        e.stopPropagation();
        toggleMaximize(s);
      }
    });

    // Cabeçalho do próprio modal: arrastar move; duplo-clique maximiza/repõe.
    const onHeaderDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      if (!s.panel || s.frame.style.display === 'none' || isExcluded(s)) return;
      const target = e.target as HTMLElement;
      if (!s.panel.contains(target) || target.closest(INTERACTIVE)) return;
      const header = findHeader(s);
      if (!header || !header.contains(target)) return;
      startMove(s, e);
    };
    const onHeaderDbl = (e: MouseEvent) => {
      if (!s.panel || s.frame.style.display === 'none' || isExcluded(s)) return;
      const target = e.target as HTMLElement;
      if (!s.panel.contains(target) || target.closest(INTERACTIVE)) return;
      const header = findHeader(s);
      if (!header || !header.contains(target)) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      toggleMaximize(s);
    };
    overlay.addEventListener('pointerdown', onHeaderDown);
    overlay.addEventListener('dblclick', onHeaderDbl);
    // Nada do que se passa nas pegas deve chegar aos handlers de "clicar fora
    // para fechar" do modal. O preventDefault no mousedown impede que o duplo-
    // clique / arrasto selecione o texto da página que está por trás do fundo.
    frame.addEventListener('click', (e) => e.stopPropagation());
    frame.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('.gr-rz-h')) e.preventDefault();
    });

    overlay.appendChild(frame);
    states.set(overlay, s);
    s.mo.observe(overlay, { childList: true });

    // O painel pode ainda estar a animar (escala/opacidade) ou a montar-se:
    // resolve já e volta a sincronizar quando assentar.
    requestAnimationFrame(() => {
      if (!states.has(overlay)) return;
      if (getComputedStyle(overlay).position !== 'fixed' && !overlay.hasAttribute('data-resizable-modal')) {
        s.dispose(); // era só uma classe `fixed` sem ser um overlay
        return;
      }
      resolve(s);
      [80, 350, 900].forEach((ms) =>
        s.timers.push(
          window.setTimeout(() => {
            if (!states.has(overlay)) return;
            ensureScroll(s);
            syncFrame(s);
          }, ms)
        ),
      );
    });
  }

  function scan(node: HTMLElement) {
    if (node.classList.contains(FRAME_CLASS) || node.classList.contains('gr-rz-h')) return;
    if (node.matches(selector)) register(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(register);
  }

  function unscan(node: HTMLElement) {
    if (node.matches(selector)) states.get(node)?.dispose();
    node.querySelectorAll<HTMLElement>(selector).forEach((el) => states.get(el)?.dispose());
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      r.removedNodes.forEach((n) => n instanceof HTMLElement && !n.isConnected && unscan(n));
    }
  });

  const onWinResize = () => states.forEach((s) => (clampFrozen(s), ensureScroll(s), syncFrame(s)));
  window.addEventListener('resize', onWinResize);

  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body); // modais que já existam no arranque

  disposeGlobal = () => {
    mo.disconnect();
    window.removeEventListener('resize', onWinResize);
    Array.from(states.values()).forEach((s) => {
      reset(s);
      s.dispose();
    });
    disposeGlobal = null;
  };
  return disposeGlobal;
}
