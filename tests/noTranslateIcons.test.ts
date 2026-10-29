// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { protectIconsFromBrowserTranslate } from '../src/utils/noTranslateIcons';

describe('ícones não são traduzidos pelo navegador', () => {
  it('marca os existentes e os que aparecem depois, e não toca no texto normal', async () => {
    document.body.innerHTML = '<span class="material-symbols-outlined">school</span><p id="t">Olá</p>';
    protectIconsFromBrowserTranslate(document);
    const first = document.querySelector('.material-symbols-outlined')!;
    expect(first.getAttribute('translate')).toBe('no');
    expect(first.classList.contains('notranslate')).toBe(true);

    const wrap = document.createElement('div');
    wrap.innerHTML = '<button><span class="material-symbols-outlined">payments</span></button><i class="bi bi-house"></i>';
    document.body.appendChild(wrap);
    await new Promise((r) => setTimeout(r, 0));
    wrap.querySelectorAll('.material-symbols-outlined, i.bi').forEach((el) => expect(el.getAttribute('translate')).toBe('no'));
    expect(document.getElementById('t')!.getAttribute('translate')).toBeNull();
  });
});
