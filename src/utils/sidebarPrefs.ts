/**
 * Personalizar sistema → preferências do menu lateral e da transição de páginas.
 *
 *  - pageAnim     : ao clicar numa subsecção, a página surge da esquerda para a direita (efeito do "Registar" do login).
 *  - dotIcons     : subsecções com ponto em vez de ícone; as secções passam a mostrar o seu ícone.
 *  - dropAnim     : ao expandir uma secção, as subsecções surgem de cima para baixo.
 *  - fixedMenu    : menu não expansível: secções e subsecções sempre visíveis (as subsecções usam ponto).
 */
import { useSyncExternalStore } from 'react';

export interface SidebarPrefs {
  pageAnim: boolean;
  dotIcons: boolean;
  dropAnim: boolean;
  fixedMenu: boolean;
}

const EVT = 'bm-sidebar-prefs';
const DEFAULTS: SidebarPrefs = { pageAnim: false, dotIcons: false, dropAnim: false, fixedMenu: false };

/**
 * As preferências vivem na base de dados, nas definições DA ESCOLA (`settings.uiPrefs.sidebar`): o administrador
 * altera e todos os utilizadores dessa escola passam a ver o mesmo, sem afectar outras escolas.
 * Aqui fica só a cópia em memória; quem a preenche é `applyUiPrefs` (chamado pelo App sempre que as definições mudam).
 */
let cache: SidebarPrefs = { ...DEFAULTS };

export function getSidebarPrefs(): SidebarPrefs {
  return cache;
}

/** Aplica as preferências vindas das definições da escola (valores em falta = desligado). */
export function applySidebarPrefs(p?: Partial<SidebarPrefs> | null) {
  const next: SidebarPrefs = { pageAnim: !!p?.pageAnim, dotIcons: !!p?.dotIcons, dropAnim: !!p?.dropAnim, fixedMenu: !!p?.fixedMenu };
  if (next.pageAnim === cache.pageAnim && next.dotIcons === cache.dotIcons && next.dropAnim === cache.dropAnim && next.fixedMenu === cache.fixedMenu) return;
  cache = next;
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

export function useSidebarPrefs(): SidebarPrefs {
  return useSyncExternalStore(subscribe, getSidebarPrefs, () => DEFAULTS);
}

/** Duração (ms) da animação de entrada das páginas. Mais alto = mais lento (650 era rápido; 700 = atual). */
export const PAGE_ANIM_DURATION_MS = 700;

/**
 * Faz a área de conteúdo surgir da esquerda para a direita (revelação com a mesma curva do "Registar").
 * Anima o contentor do <main>, que é o mesmo elemento entre páginas, por isso a animação sobrevive à troca de view.
 */
export function playPageAnimation() {
  if (!getSidebarPrefs().pageAnim || typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>('main > div');
  if (!el || typeof el.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [
      { clipPath: 'inset(0 100% 0 0)', opacity: 0.2, transform: 'translateX(-24px)' },
      { clipPath: 'inset(0 0 0 0)', opacity: 1, transform: 'none' },
    ],
    { duration: PAGE_ANIM_DURATION_MS, easing: 'cubic-bezier(.77,0,.18,1)' },
  );
}
