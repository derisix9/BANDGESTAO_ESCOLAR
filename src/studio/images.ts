/**
 * Utilitários de imagem e ficheiros do Estúdio de Documentos (só corre no browser).
 * - carregar um URL (brasão, logótipo) como data URL;
 * - comprimir fotos enviadas pelo utilizador;
 * - recortar/arredondar uma imagem ao rectângulo do modelo (usado na exportação PPTX);
 * - descarregar bytes como ficheiro.
 */

export type ImageSlots = Record<string, string | undefined>;

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    r.readAsDataURL(blob);
  });

/** Carrega uma imagem por URL (ex.: /pauta/insignia_angola.png) e devolve-a como data URL. */
export async function urlToDataUrl(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) return undefined; // servidor SPA devolve index.html para ficheiros em falta
    return await blobToDataUrl(blob);
  } catch {
    try {
      const res = await fetch(url);
      if (!res.ok) return undefined;
      return await blobToDataUrl(await res.blob());
    } catch {
      return undefined;
    }
  }
}

const loadImgRaw = (src: string, cors = false): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida.'));
    img.src = src;
  });

/**
 * Carrega uma imagem SEM contaminar o canvas ("Tainted canvases may not be exported"):
 * URLs remotos (fotos no armazenamento, logótipos) são primeiro convertidos em data URL.
 */
const loadImg = async (src: string): Promise<HTMLImageElement> => {
  if (/^(data|blob):/.test(src)) return loadImgRaw(src);
  const inline = await urlToDataUrl(src);
  if (inline) return loadImgRaw(inline);
  return loadImgRaw(src, true);
};

/** Garante que a imagem é um data URL (descarta as que não for possível ler, em vez de rebentar a exportação). */
export async function toInlineImage(src?: string): Promise<string | undefined> {
  if (!src) return undefined;
  if (src.startsWith('data:')) return src;
  return urlToDataUrl(src);
}

/** Lê um ficheiro de imagem e reduz-o (lado maior `maxPx`) para não pesar nos documentos. */
export async function fileToDataUrl(file: File, maxPx = 1200, quality = 0.88): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('O ficheiro escolhido não é uma imagem.');
  const raw = await blobToDataUrl(file);
  const img = await loadImg(raw);
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 400_000) return raw;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const keepAlpha = /png|gif|webp/.test(file.type);
  return c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality);
}

export interface FitOptions { round?: boolean; fit?: 'cover' | 'contain' | 'stretch'; opacity?: number; /** Imagem opaca (fundos): JPEG sobre branco, ficheiro bem mais leve. */ jpeg?: boolean }

/**
 * Recorta a imagem à proporção do rectângulo (wMm × hMm), com opção redonda e opacidade.
 * Resolução ~300 dpi (limitada) para ficar nítida na impressão sem inflar o ficheiro.
 */
export async function fitImage(dataUrl: string, wMm: number, hMm: number, o: FitOptions = {}): Promise<string> {
  const img = await loadImg(dataUrl);
  const px = (mm: number) => Math.max(8, Math.min(2400, Math.round(mm * 11.81)));
  const W = px(wMm), H = px(hMm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (o.round) {
    g.beginPath();
    g.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
    g.clip();
  }
  if (o.jpeg) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); }
  g.globalAlpha = o.opacity ?? 1;
  if (o.fit === 'stretch') {
    g.drawImage(img, 0, 0, W, H);
  } else {
    const contain = o.fit === 'contain';
    const k = contain ? Math.min(W / img.width, H / img.height) : Math.max(W / img.width, H / img.height);
    const dw = img.width * k, dh = img.height * k;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  return o.jpeg ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png');
}

/**
 * Gradiente linear como imagem (o PPTX não tem gradientes nas formas geradas por aqui). Segue a
 * mesma geometria do CSS `linear-gradient(<ângulo>deg, c1, c2)`, para sair igual ao ecrã.
 */
export function gradientImage(wMm: number, hMm: number, c1: string, c2: string, angleDeg = 135): string {
  const px = (mm: number) => Math.max(8, Math.min(1600, Math.round(mm * 8)));
  const W = px(wMm), H = px(hMm);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const len = Math.abs(W * Math.abs(dx)) + Math.abs(H * Math.abs(dy));
  const cx = W / 2, cy = H / 2;
  const grad = g.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return c.toDataURL('image/png');
}

/** Descarrega bytes como ficheiro (DOCX, PPTX, PDF…). */
export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf'
} as const;
