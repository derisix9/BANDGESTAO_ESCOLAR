/**
 * Imagem de fundo das páginas do sistema (utilizador com sessão iniciada).
 * Coloque na pasta `public/` (PNG ou JPG):
 *   • public/page-bg-light.(png|jpg|jpeg) → modo CLARO
 *   • public/page-bg-dark.(png|jpg|jpeg)  → modo ESCURO
 * Se o ficheiro do modo actual NÃO existir, esse modo fica como estava (sem imagem).
 * A opacidade ajusta-se em src/styles/page-background.css. Na impressão nunca aparece.
 * A deteção usa `new Image()`: um servidor SPA devolve index.html para ficheiros em falta, o que faz o Image falhar.
 */
import { getColorMode, type ColorMode } from './colorMode';

export const PAGE_BG_BASENAME: Record<ColorMode, string> = { light: 'page-bg-light', dark: 'page-bg-dark' };
export const PAGE_BG_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;
const CHANGE_EVENT = 'bandmed:color-mode-change';

export function pageBackgroundCandidates(mode: ColorMode, base = '/'): string[] {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return PAGE_BG_EXTENSIONS.map((ext) => `${prefix}${PAGE_BG_BASENAME[mode]}.${ext}`);
}

export async function findFirstLoadableImage(urls: string[], load: (url: string) => Promise<boolean>): Promise<string | null> {
  for (const u of urls) {
    try { if (await load(u)) return u; } catch { /* tenta o próximo */ }
  }
  return null;
}

const browserLoad = (url: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });

const found: Partial<Record<ColorMode, string | null>> = {};
let started = false;

function apply(): void {
  const root = document.documentElement;
  const url = found[getColorMode()];
  if (url) {
    root.style.setProperty('--page-bg-image', `url("${url}")`);
    root.setAttribute('data-page-bg', 'on');
  } else {
    root.style.removeProperty('--page-bg-image');
    root.removeAttribute('data-page-bg');
  }
}

export function initPageBackground(): void {
  if (typeof document === 'undefined' || started) return;
  started = true;
  const base = (import.meta as any).env?.BASE_URL || '/';
  (['light', 'dark'] as ColorMode[]).forEach((mode) => {
    findFirstLoadableImage(pageBackgroundCandidates(mode, base), browserLoad).then((u) => { found[mode] = u; apply(); });
  });
  window.addEventListener(CHANGE_EVENT, apply);
}
