/**
 * O tradutor do navegador (Chrome/Edge "Traduzir esta página") traduz o NOME dos ícones (Material Symbols são texto:
 * "dashboard", "school", "payments"…) e a interface fica cheia de palavras no lugar dos desenhos.
 * Marca todos os ícones com translate="no" (e class notranslate) à medida que aparecem. O texto normal continua a traduzir-se.
 */
const ICON_SELECTOR = '.material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons, .material-icons-outlined, i.bi, span.bi';

function protect(el: Element) {
  if (el.getAttribute('translate') !== 'no') el.setAttribute('translate', 'no');
  if (!el.classList.contains('notranslate')) el.classList.add('notranslate');
}

function scan(root: ParentNode) {
  if (root instanceof Element && root.matches(ICON_SELECTOR)) protect(root);
  root.querySelectorAll?.(ICON_SELECTOR).forEach(protect);
}

let started = false;
export function protectIconsFromBrowserTranslate(doc: Document = document): void {
  if (started || typeof MutationObserver === 'undefined') return;
  started = true;
  scan(doc);
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n as Element); });
      // o React reaproveita o <span> e só muda a classe/nome do ícone
      if (r.type === 'attributes' && r.target.nodeType === 1 && (r.target as Element).matches(ICON_SELECTOR)) protect(r.target as Element);
    }
  }).observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
