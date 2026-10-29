/**
 * BOTÕES DE FORMULÁRIOS, MODAIS E CAIXAS DE DIÁLOGO — função global (par do `tableEnhancements.ts`).
 *
 * Chamada UMA vez no arranque (main.tsx). Todo o botão COM TEXTO dentro de <form>, [role=dialog],
 * <dialog> ou de uma janela sobreposta (.fixed.inset-0) ganha `data-gr-btn`:
 *   • "cancel" → Cancelar/Fechar/Voltar…: sem cor de fundo (só contorno);
 *   • "danger" → Eliminar/Apagar/Anular/Remover…: fundo vermelho, letra branca;
 *   • "primary" → todos os outros: fundo azul, letra branca.
 * O aspeto vive em global-layout.css. Fica de fora: botões só com ícone (o X de fechar),
 * botões de tabela (têm a sua lógica), grupos de escolha (data-gr-choice, aria-pressed/checked,
 * role radio/tab), cartões-botão (com blocos lá dentro) e o que estiver em [data-no-btn-style].
 */
const MODAL_OR_FORM = 'form, [role="dialog"], dialog, .fixed.inset-0';
const CANCEL_RX = /^(cancelar|fechar|voltar|não|nao|dispensar|ignorar|descartar|sair|limpar|cancel|close)$/i;
const DANGER_RX = /^(elimin|apag|anular|remov|exclu|delet|revogar|rejeit|recus|bloquear)/i;

let dispose: (() => void) | null = null;

function labelOf(btn: HTMLElement): string {
  const clone = btn.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.material-symbols-outlined, .material-symbols-rounded, .material-icons, svg').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function kindOf(btn: HTMLElement): 'cancel' | 'danger' | 'primary' | null {
  if (btn.hasAttribute('data-gr-act') || btn.hasAttribute('data-gr-choice')) return null;
  if (btn.closest('[data-no-btn-style], table, .gr-pager, .printable-document, .lg-root, nav, aside, [role="tablist"]')) return null;
  const cls = btn.className && typeof btn.className === 'string' ? btn.className : '';
  // Abas sublinhadas (border-b-2 / -mb-px) são navegação, não botões de ação (mesmo que sejam só 2).
  if (/(^|\s)(border-b-2|-mb-px)(\s|$)/.test(cls)) return null;
  // Botões em forma de ligação (sem fundo nem contorno, ex.: "Esqueceu a palavra-passe?") não são tocados.
  if (!/(^|\s)(bg-|border(\s|$|-))/.test(cls) || /\bunderline\b/.test(cls)) return null;
  // Fora de janelas/formulários: só botões de ação isolados (não grupos de escolha, separadores ou filtros).
  if (!btn.closest(MODAL_OR_FORM)) {
    const sibs = btn.parentElement ? Array.from(btn.parentElement.children).filter((c) => c.tagName === 'BUTTON') : [];
    if (sibs.length > 2 || !/(^|\s)(px-|py-|h-)/.test(cls)) return null;
  }
  const role = btn.getAttribute('role');
  if (role && /^(radio|tab|switch|checkbox|menuitem|option)$/.test(role)) return null;
  if (btn.hasAttribute('aria-pressed') || btn.hasAttribute('aria-checked') || btn.hasAttribute('aria-haspopup')) return null;
  if (btn.querySelector('div, p, img, h1, h2, h3, h4, input')) return null;
  if (/\btext-left\b/.test(btn.className || '')) return null;
  const label = labelOf(btn);
  if (!label || label.length > 40 || label.split(' ').length > 6) return null;
  const norm = label.replace(/[.…!?]+$/g, '').trim();
  if (CANCEL_RX.test(norm)) return 'cancel';
  if (DANGER_RX.test(norm)) return 'danger';
  return 'primary';
}

export function enableDialogButtons(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (dispose) return dispose;

  let raf = 0;
  const scan = () => {
    raf = 0;
    document.querySelectorAll<HTMLElement>('button').forEach((b) => {
      const k = kindOf(b);
      if (k) { if (b.getAttribute('data-gr-btn') !== k) b.setAttribute('data-gr-btn', k); }
      else if (b.hasAttribute('data-gr-btn')) b.removeAttribute('data-gr-btn');
    });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(scan); };

  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });
  schedule();

  dispose = () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); dispose = null; };
  return dispose;
}
