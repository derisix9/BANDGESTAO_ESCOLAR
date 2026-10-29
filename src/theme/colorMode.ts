/**
 * Modo de cor da aplicação: claro (dia) ou escuro (noite).
 *
 * É independente do tema visual (src/theme/uiTheme.ts): o tema define o
 * "desenho" (Laravel); o modo de cor define se esse desenho aparece com
 * fundo claro ou escuro.
 *
 * O modo é aplicado através do atributo `data-color-mode` no <html>. As regras
 * do modo escuro vivem em src/styles/theme-dark.css e estão TODAS dentro de
 * `@media screen`, por isso nunca afetam a impressão: ao imprimir, o
 * documento sai sempre com fundo branco e texto preto.
 *
 * A escolha fica guardada neste dispositivo (localStorage). O mesmo código
 * corre também num pequeno script em index.html, antes do primeiro render,
 * para a página nunca "piscar" com o modo errado.
 */

import { useSyncExternalStore } from 'react';

export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'bandmed:color-mode';
const CHANGE_EVENT = 'bandmed:color-mode-change';

function readStored(): ColorMode | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null; // armazenamento bloqueado (modo privado, etc.)
  }
}

/** Modo atualmente aplicado ao documento. */
export function getColorMode(): ColorMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-color-mode') === 'dark' ? 'dark' : 'light';
}

function apply(mode: ColorMode): void {
  const root = document.documentElement;
  root.setAttribute('data-color-mode', mode);
  // Ajusta a cor da barra do navegador no telemóvel.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = mode === 'dark' ? '#1f3960' : '#12498A';
}

/** Define e memoriza o modo de cor. */
export function setColorMode(mode: ColorMode): void {
  apply(mode);
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* sem armazenamento: a escolha vale só para esta sessão */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleColorMode(): void {
  setColorMode(getColorMode() === 'dark' ? 'light' : 'dark');
}

/** Aplica o modo guardado (ou claro, por omissão) no arranque. */
export function initColorMode(): void {
  if (typeof document === 'undefined') return;
  apply(readStored() ?? 'light');

  // Mantém vários separadores do navegador em sintonia.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      apply(readStored() ?? 'light');
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  });
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

/** Hook: devolve o modo atual e reage às mudanças. */
export function useColorMode(): { mode: ColorMode; toggle: () => void; setMode: (m: ColorMode) => void } {
  const mode = useSyncExternalStore(subscribe, getColorMode, () => 'light' as ColorMode);
  return { mode, toggle: toggleColorMode, setMode: setColorMode };
}
