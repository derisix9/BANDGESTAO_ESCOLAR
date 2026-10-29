/**
 * Personalizar sistema → "Botões de ações nas tabelas".
 *
 *  - listagem (por omissão): os botões de ação ficam todos à vista, como sempre.
 *  - menu: em cada linha de tabela com 3 ou mais botões ficam visíveis só Editar e Eliminar (ou, em tabelas sem esses botões, os 2 primeiros),
 *    mais um botão "⋮" que abre uma lista com os restantes (quadrado com o ícone no estilo do
 *    botão + o texto, um por linha). Os botões originais continuam a ser os do React: o menu
 *    apenas os esconde (CSS) e, ao escolher um item, faz clique no botão original.
 */
export type ActionMode = 'lista' | 'menu';

const EVT = 'bm-ui-settings';

/**
 * O modo vive na base de dados, nas definições DA ESCOLA (`settings.uiPrefs.actionMode`): o administrador escolhe
 * e todos os utilizadores dessa escola passam a ver o mesmo. Aqui fica só a cópia em memória (ver `applyActionMode`).
 */
let memoryMode: ActionMode = 'lista';
export function getActionMode(): ActionMode { return memoryMode; }

/** Aplica o modo vindo das definições da escola. */
export function applyActionMode(m?: string | null) {
  const next: ActionMode = m === 'menu' ? 'menu' : 'lista';
  if (next === memoryMode) return;
  memoryMode = next;
  window.dispatchEvent(new Event(EVT));
}

const currentMode = (): ActionMode => memoryMode;

export function subscribeActionMode(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

const HIDDEN = 'bm-act-hidden';
const MORE = 'bm-more';
let popover: HTMLElement | null = null;

const iconOf = (b: Element) => b.querySelector('.material-symbols-outlined')?.textContent?.trim() || '';

function labelOf(b: HTMLElement): string {
  const t = b.getAttribute('title') || b.getAttribute('aria-label');
  if (t && t.trim()) return t.trim();
  let txt = '';
  b.childNodes.forEach((n) => {
    if (n.nodeType === 3) txt += n.textContent;
    else if (n instanceof HTMLElement && !n.classList.contains('material-symbols-outlined')) txt += n.textContent;
  });
  return txt.trim() || 'Ação';
}

const PRIMARY_LABEL = /^(editar|eliminar|apagar|excluir|remover)\b/i;
function isPrimary(b: HTMLElement): boolean {
  const ic = iconOf(b);
  if (ic === 'edit' || ic === 'delete') return true;
  return PRIMARY_LABEL.test(labelOf(b));
}

function closePopover() {
  popover?.remove();
  popover = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', closePopover, true);
  window.removeEventListener('resize', closePopover);
}
function onOutside(e: Event) { if (popover && !popover.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(`.${MORE}`)) closePopover(); }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closePopover(); }

function openPopover(toggle: HTMLElement) {
  closePopover();
  const list: HTMLElement[] = ((toggle as any)._bmRest || []).filter((b: HTMLElement) => b.isConnected);
  if (!list.length) return;
  const dark = document.documentElement.getAttribute('data-color-mode') === 'dark';
  const pop = document.createElement('div');
  pop.setAttribute('data-bm-pop', '1');
  Object.assign(pop.style, {
    position: 'fixed', zIndex: '99999', background: dark ? '#0f1b2d' : '#ffffff', color: dark ? '#e5edf7' : '#0b1f3a',
    border: `1px solid ${dark ? '#334155' : '#cbd5e1'}`, boxShadow: '0 12px 30px rgba(0,0,0,.28)', padding: '6px',
    display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '190px', maxWidth: '280px', maxHeight: '70vh', overflowY: 'auto'
  } as Partial<CSSStyleDeclaration>);
  list.forEach((b) => {
    const cs = getComputedStyle(b);
    const transparent = !cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
    const row = document.createElement('div');
    const disabled = (b as HTMLButtonElement).disabled;
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '10px', padding: '3px 6px', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? '.4' : '1', fontSize: '12px', fontWeight: '700'
    } as Partial<CSSStyleDeclaration>);
    row.onmouseenter = () => { if (!disabled) row.style.background = dark ? '#1e293b' : '#f1f5f9'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    const sq = document.createElement('div');
    Object.assign(sq.style, {
      width: '30px', height: '30px', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: transparent ? '#475569' : cs.backgroundColor,
      color: '#ffffff', border: cs.borderTopWidth !== '0px' ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : 'none',
      borderRadius: '0'
    } as Partial<CSSStyleDeclaration>);
    const ic = b.querySelector('.material-symbols-outlined, svg');
    if (ic) {
      const c = ic.cloneNode(true) as HTMLElement;
      c.style.setProperty('color', '#ffffff', 'important');
      c.querySelectorAll<HTMLElement>('*').forEach((n) => n.style.setProperty('color', '#ffffff', 'important'));
      c.style.setProperty('fill', 'currentColor');
      c.style.fontSize = '18px';
      sq.appendChild(c);
    } else sq.textContent = labelOf(b).charAt(0).toUpperCase();
    const txt = document.createElement('span');
    txt.textContent = labelOf(b);
    row.append(sq, txt);
    row.onclick = () => { if (disabled) return; closePopover(); b.click(); };
    pop.appendChild(row);
  });
  document.body.appendChild(pop);
  const r = toggle.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  popover = pop;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', closePopover, true);
  window.addEventListener('resize', closePopover);
}

function makeToggle(): HTMLElement {
  const t = document.createElement('span');
  t.className = MORE;
  t.setAttribute('role', 'button');
  t.setAttribute('tabindex', '0');
  t.setAttribute('title', 'Mais ações');
  t.setAttribute('aria-label', 'Mais ações');
  t.innerHTML = '<span class="material-symbols-outlined" style="font-size:28px;line-height:1">more_vert</span>';
  Object.assign(t.style, {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', cursor: 'pointer',
    background: 'transparent', color: 'inherit', border: 'none', padding: '0', marginLeft: '6px', flexShrink: '0', userSelect: 'none'
  } as Partial<CSSStyleDeclaration>);
  t.onclick = (e) => { e.stopPropagation(); e.preventDefault(); popover ? closePopover() : openPopover(t); };
  t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPopover(t); } };
  return t;
}

function cleanup() {
  closePopover();
  document.querySelectorAll(`.${HIDDEN}`).forEach((n) => n.classList.remove(HIDDEN));
  document.querySelectorAll(`.${MORE}`).forEach((n) => n.remove());
}

function enhance() {
  if (currentMode() !== 'menu') { if (document.querySelector(`.${HIDDEN}, .${MORE}`)) cleanup(); return; }
  const cells = Array.from(document.querySelectorAll<HTMLElement>('table tbody tr > td:last-child'));
  const listBtns = (td: HTMLElement) => Array.from(td.querySelectorAll<HTMLElement>('button')).filter((b) => !b.closest('[data-bm-pop]'));
  // Tabelas sem Editar/Eliminar em nenhuma linha: ficam visíveis os 2 primeiros botões; o resto vai para o menu.
  const tableHasPrimary = new Map<Element, boolean>();
  cells.forEach((td) => {
    const t = td.closest('table');
    if (!t) return;
    if (listBtns(td).some(isPrimary)) tableHasPrimary.set(t, true);
    else if (!tableHasPrimary.has(t)) tableHasPrimary.set(t, false);
  });
  cells.forEach((td) => {
    const usePrimary = tableHasPrimary.get(td.closest('table') as Element) !== false;
    const btns = listBtns(td);
    const existing = td.querySelector<HTMLElement>(`.${MORE}`);
    if (btns.length < 3) {
      if (existing) { existing.remove(); btns.forEach((b) => b.classList.remove(HIDDEN)); }
      return;
    }
    const keep = usePrimary ? btns.filter(isPrimary) : btns.slice(0, 2);
    const rest = btns.filter((b) => !keep.includes(b));
    if (!rest.length) { existing?.remove(); return; }
    btns.forEach((b) => {
      const hide = !keep.includes(b);
      if (b.classList.contains(HIDDEN) !== hide) b.classList.toggle(HIDDEN, hide);
    });
    let toggle = existing;
    if (!toggle) {
      toggle = makeToggle();
      (keep[keep.length - 1] || rest[0]).parentElement?.appendChild(toggle);
    }
    (toggle as any)._bmRest = rest;
  });
}

let timer: number | undefined;
const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(enhance, 80); };

let started = false;
export function initActionMenu() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const style = document.createElement('style');
  style.textContent = `html body .${HIDDEN}, html body [data-gr-act].${HIDDEN}, html body button.${HIDDEN}{display:none !important}`
    + ` html body .${MORE}, html body .${MORE}:hover, html body .${MORE}:focus{background:transparent !important;border:0 !important;box-shadow:none !important;filter:none !important;outline:none !important}`;
  document.head.appendChild(style);
  subscribeActionMode(() => { memoryMode = getActionMode(); enhance(); });
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'title'] });
  enhance();
}
