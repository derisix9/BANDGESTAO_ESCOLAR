import { describe, it, expect } from 'vitest';
import { applyBg, DEFAULT_BG } from '../src/studio/bg';
import type { Scene } from '../src/studio/scene';

const scene: Scene = {
  w: 85.6, h: 53.98,
  prims: [
    { k: 'rect', x: 0, y: 0, w: 85.6, h: 53.98, fill: '#12498a', fill2: '#2563eb' },
    { k: 'rect', x: 2, y: 2, w: 81, h: 8, fill: '#ffffff', stroke: '#000000', sw: 0.3 },
    { k: 'text', x: 4, y: 4, w: 40, h: 4, text: 'NOME', size: 6 }
  ]
};

describe('estúdio · fundo personalizado', () => {
  it('modo "modelo" não toca na cena', () => {
    expect(applyBg(scene, DEFAULT_BG)).toBe(scene);
    expect(applyBg(scene, { ...DEFAULT_BG, mode: 'cor', back: false }, 'back')).toBe(scene); // verso sem back=true fica igual
  });

  it('cor lisa: retira o preenchimento do fundo do modelo e põe a nova cor por baixo', () => {
    const out = applyBg(scene, { ...DEFAULT_BG, mode: 'cor', color: '#ff0000' });
    const first = out.prims[0];
    expect(first).toMatchObject({ k: 'rect', x: 0, y: 0, w: 85.6, h: 53.98, fill: '#ff0000' });
    const old = out.prims.find((p) => p.k === 'rect' && p.w === 85.6 && p !== first);
    expect(old && (old as any).fill).toBeUndefined(); // fundo do modelo perde o fill
    const faixa = out.prims.find((p) => p.k === 'rect' && p.w === 81) as any;
    expect(faixa.fill).toBe('#ffffff'); // as outras camadas ficam intactas
  });

  it('gradiente usa as duas cores e o ângulo', () => {
    const out = applyBg(scene, { ...DEFAULT_BG, mode: 'gradiente', color: '#111111', color2: '#eeeeee', angle: 90 });
    expect(out.prims[0]).toMatchObject({ k: 'rect', fill: '#111111', fill2: '#eeeeee', ang: 90 });
  });

  it('imagem cobre a folha toda no slot "fundo" e o véu fica por cima', () => {
    const out = applyBg(scene, { ...DEFAULT_BG, mode: 'imagem', fit: 'stretch', veil: 0.4 });
    expect(out.prims[0]).toMatchObject({ k: 'image', slot: 'fundo', x: 0, y: 0, w: 85.6, h: 53.98, fit: 'stretch' });
    expect(out.prims[1]).toMatchObject({ k: 'rect', fill: '#ffffff', opacity: 0.4 });
    expect(out.prims[2]).toMatchObject({ k: 'rect' }); // conteúdo do modelo por cima
  });

  it('verso também recebe o fundo quando back=true', () => {
    const out = applyBg(scene, { ...DEFAULT_BG, mode: 'cor', color: '#00ff00', back: true }, 'back');
    expect(out.prims[0]).toMatchObject({ fill: '#00ff00' });
  });
});
