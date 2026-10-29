import { describe, it, expect } from 'vitest';
import { pageBackgroundCandidates, findFirstLoadableImage } from '../src/theme/pageBackground';

describe('imagem de fundo das páginas', () => {
  it('gera candidatos PNG, JPG e JPEG por modo', () => {
    expect(pageBackgroundCandidates('light')).toEqual(['/page-bg-light.png', '/page-bg-light.jpg', '/page-bg-light.jpeg']);
    expect(pageBackgroundCandidates('dark', '/app')).toEqual(['/app/page-bg-dark.png', '/app/page-bg-dark.jpg', '/app/page-bg-dark.jpeg']);
  });
  it('usa o primeiro ficheiro que existe', async () => {
    const ok = new Set(['/page-bg-light.jpg']);
    expect(await findFirstLoadableImage(pageBackgroundCandidates('light'), async (u) => ok.has(u))).toBe('/page-bg-light.jpg');
  });
  it('sem nenhum ficheiro devolve null (o sistema fica sem fundo, como antes)', async () => {
    expect(await findFirstLoadableImage(pageBackgroundCandidates('dark'), async () => false)).toBeNull();
  });
  it('um erro ao carregar um candidato não impede os seguintes', async () => {
    const r = await findFirstLoadableImage(['/a.png', '/b.jpg'], async (u) => { if (u === '/a.png') throw new Error('x'); return true; });
    expect(r).toBe('/b.jpg');
  });
});
