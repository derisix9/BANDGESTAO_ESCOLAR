/**
 * Personalizar sistema → onde aparece o catálogo de navegação das secções.
 *
 *  - 'sidebar' (padrão): menu lateral à esquerda.
 *  - 'header'          : barra de navegação por baixo do cabeçalho; ao passar o rato numa secção abrem-se as subsecções.
 *
 * Guardado na base de dados, nas definições DA ESCOLA (`settings.uiPrefs.navMode`): vale para todos os utilizadores.
 */
import { useSyncExternalStore } from 'react';

export type NavMode = 'sidebar' | 'header';

const EVT = 'bm-nav-mode';
let cache: NavMode = 'sidebar';

export function getNavMode(): NavMode {
  return cache;
}

export function applyNavMode(m?: string | null) {
  const next: NavMode = m === 'header' ? 'header' : 'sidebar';
  if (next === cache) return;
  cache = next;
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

export function useNavMode(): NavMode {
  return useSyncExternalStore(subscribe, getNavMode, () => 'sidebar' as NavMode);
}

/** Altura (rem) do cabeçalho fixo e da barra de navegação, para o conteúdo e os cabeçalhos "colantes". */
export const HEADER_NAV_BAR_REM = 2.75;
