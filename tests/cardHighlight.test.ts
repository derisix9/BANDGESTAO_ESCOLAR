import { describe, it, expect } from 'vitest';
import { parseCssColor, pickHighlightColors, isNeutralColor } from '../src/utils/cardHighlight';

const c = (s: string) => parseCssColor(s)!;

describe('cardHighlight', () => {
  it('lê rgb/rgba', () => {
    expect(c('rgb(37, 99, 235)')).toEqual({ r: 37, g: 99, b: 235, a: 1 });
    expect(c('rgba(37, 99, 235, 0.1)').a).toBeCloseTo(0.1);
  });
  it('borda colorida → fundo 100 % da cor da borda, texto branco', () => {
    const r = pickHighlightColors({ border: c('rgb(37, 99, 235)'), text: c('rgb(30,58,138)'), background: c('rgb(255,255,255)') });
    expect(r).toEqual({ bg: 'rgb(37, 99, 235)', fg: '#ffffff', mode: 'color' });
  });
  it('borda colorida clara (tema escuro) → texto escuro', () => {
    const r = pickHighlightColors({ border: c('rgb(96, 165, 250)'), text: c('rgb(191,219,254)'), background: c('rgb(11,18,32)') });
    expect(r.fg).toBe('#0b1220');
    expect(r.bg).toBe('rgb(96, 165, 250)');
  });
  it('borda branca/preta → azul do menu lateral com texto branco', () => {
    const r = pickHighlightColors({ border: c('rgb(255,255,255)'), text: c('rgb(15,23,42)'), background: c('rgb(255,255,255)') });
    expect(r).toEqual({ bg: '#12498a', fg: '#ffffff', mode: 'invert' });
    const d = pickHighlightColors({ border: c('rgb(0,0,0)'), text: c('rgb(226,232,240)'), background: c('rgb(11,18,32)') });
    expect(d).toEqual({ bg: '#12498a', fg: '#ffffff', mode: 'invert' });
  });
  it('sem borda também inverte', () => {
    expect(pickHighlightColors({ border: null, text: c('rgb(0,0,0)'), background: c('rgb(255,255,255)') }).mode).toBe('invert');
    expect(isNeutralColor(c('rgb(128,128,128)'))).toBe(true);
  });
});
