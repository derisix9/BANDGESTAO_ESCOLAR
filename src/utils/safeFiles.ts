/**
 * Abertura segura de ficheiros guardados (data URL → Blob).
 * Um Blob aberto num separador herda a ORIGEM da aplicação. Se o tipo MIME guardado for text/html ou
 * image/svg+xml, o conteúdo executaria scripts com acesso à sessão (XSS armazenado). Por isso só se
 * abrem no navegador tipos de uma lista fechada; todo o resto é descarregado como octet-stream.
 */
export const VIEWABLE_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const cleanMime = (m?: string): string => String(m || '').split(';')[0].trim().toLowerCase();

/** Tipo MIME aceite para abrir no navegador, ou null. */
export function viewableMime(m?: string): string | null {
  const c = cleanMime(m);
  return (VIEWABLE_MIME as readonly string[]).includes(c) ? c : null;
}

/** Separa um data URL em tipo e base64. Devolve null se o formato não for `data:<tipo>;base64,<dados>`. */
export function parseDataUrl(dataUrl?: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*);base64,([A-Za-z0-9+/=\s]*)$/i.exec(String(dataUrl || ''));
  return m ? { mime: cleanMime(m[1]), base64: m[3].replace(/\s/g, '') } : null;
}

/** Data URL de imagem seguro para `src` (png/jpeg/gif/webp em base64; nunca svg nem html). */
export function safeImageDataUrl(dataUrl?: string): string | null {
  const p = parseDataUrl(dataUrl);
  return p && /^image\/(png|jpeg|gif|webp)$/.test(p.mime) ? `data:${p.mime};base64,${p.base64}` : null;
}

/** Valor seguro para `href` + `download` (só data URLs em base64; nunca javascript:). */
export function safeDownloadHref(dataUrl?: string): string | undefined {
  return parseDataUrl(dataUrl) ? String(dataUrl) : undefined;
}

/** Cria o Blob. `viewable` diz se pode abrir no navegador; se não, tem de ser descarregado. */
export function blobFromDataUrl(dataUrl?: string, declaredMime?: string): { blob: Blob; viewable: boolean } | null {
  const p = parseDataUrl(dataUrl);
  if (!p) return null;
  try {
    const bin = atob(p.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const mime = viewableMime(declaredMime) && viewableMime(p.mime) ? p.mime : null;
    return { blob: new Blob([bytes], { type: mime || 'application/octet-stream' }), viewable: !!mime };
  } catch {
    return null;
  }
}

/** Só aceita endereços da própria aplicação (QR lido não pode levar o utilizador a outro site). */
export function sameOriginUrl(text: string, origin: string = typeof window !== 'undefined' ? window.location.origin : ''): string | null {
  try {
    const u = new URL(text.trim(), origin);
    return u.origin === origin && (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null;
  } catch {
    return null;
  }
}
