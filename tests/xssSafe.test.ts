import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../src/studio/rich';
import { parseDataUrl, safeImageDataUrl, safeDownloadHref, viewableMime, sameOriginUrl, blobFromDataUrl } from '../src/utils/safeFiles';

describe('sanitizeHtml (texto guardado no Estúdio)', () => {
  it('remove scripts, handlers e imagens', () => {
    const out = sanitizeHtml('<b>ok</b><img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/<img|<script|<a |onerror|href/i);
    expect(out).toContain('<b>ok</b>');
  });
  it('escapa texto com < e aspas', () => {
    expect(sanitizeHtml('a &lt;script&gt; "x"')).not.toContain('<script');
  });
  it('mantém só a cor em hexadecimal', () => {
    expect(sanitizeHtml('<span style="color:#c00000;background:url(javascript:1)">t</span>')).toBe('<span style="color:#C00000">t</span>');
  });
});

describe('safeFiles', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  it('só aceita PDF e imagens raster para abrir', () => {
    expect(viewableMime('application/pdf')).toBe('application/pdf');
    expect(viewableMime('text/html')).toBeNull();
    expect(viewableMime('image/svg+xml')).toBeNull();
  });
  it('safeImageDataUrl recusa svg, html e aspas', () => {
    expect(safeImageDataUrl(png)).toBe(png);
    expect(safeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safeImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeImageDataUrl('data:image/png;base64,AAAA" onerror="x')).toBeNull();
  });
  it('safeDownloadHref recusa javascript:', () => {
    expect(safeDownloadHref('javascript:alert(1)')).toBeUndefined();
    expect(safeDownloadHref(png)).toBe(png);
  });
  it('HTML guardado como PDF ou SVG nunca fica visualizável', () => {
    const html = 'data:text/html;base64,' + Buffer.from('<script>1</script>').toString('base64');
    const r = blobFromDataUrl(html, 'text/html');
    expect(r?.viewable).toBe(false);
    expect(r?.blob.type).toBe('application/octet-stream');
    // tipo declarado seguro mas data URL diz html → não confia
    expect(blobFromDataUrl(html, 'application/pdf')?.viewable).toBe(false);
  });
  it('parseDataUrl recusa formato inválido', () => {
    expect(parseDataUrl('data:text/plain,abc')).toBeNull();
    expect(parseDataUrl(png)?.mime).toBe('image/png');
  });
  it('sameOriginUrl só aceita a própria origem', () => {
    const o = 'https://app.exemplo.ao';
    expect(sameOriginUrl('https://app.exemplo.ao/?pv=abc', o)).toContain('pv=abc');
    expect(sameOriginUrl('https://evil.example/?pv=abc', o)).toBeNull();
    expect(sameOriginUrl('javascript:alert(1)', o)).toBeNull();
    expect(sameOriginUrl('https://app.exemplo.ao.evil.com/', o)).toBeNull();
  });
});
