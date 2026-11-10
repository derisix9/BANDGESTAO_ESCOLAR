import { describe, it, expect } from 'vitest';
import { setCardHighlight } from '../src/utils/cardHighlight';

function makeCard() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const style = {
    transition: '',
    backgroundColor: 'linear-gradient(135deg, #2563eb, #1647b1)',
    color: '#ffffff'
  };
  const classList = {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
    contains: (name: string) => classes.has(name)
  };
  const card = {
    classList,
    style,
    parentElement: null,
    setAttribute: (name: string, value: string) => attributes.set(name, value)
  } as unknown as HTMLElement;
  return { card, classes, attributes, style };
}

describe('cardHighlight', () => {
  it('destaca o card sem mudar fundo ou cor do texto', () => {
    const { card, classes, style, attributes } = makeCard();
    const background = style.backgroundColor;
    const color = style.color;

    setCardHighlight(card, true);

    expect(classes.has('card-hl-on')).toBe(true);
    expect(style.backgroundColor).toBe(background);
    expect(style.color).toBe(color);
    expect(attributes.get('data-hl-t')).toBe('1');
  });

  it('remove apenas as classes de destaque ao sair do card', () => {
    const { card, classes, style } = makeCard();
    setCardHighlight(card, true);
    setCardHighlight(card, false);

    expect(classes.has('card-hl-on')).toBe(false);
    expect(style.backgroundColor).toBe('linear-gradient(135deg, #2563eb, #1647b1)');
    expect(style.color).toBe('#ffffff');
  });
});
