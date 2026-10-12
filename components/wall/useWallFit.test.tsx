import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWholeWords } from './useWallFit';

/** Pretends the box is `client` wide and its widest line `scroll` wide. */
function Title({ text, client, scroll }: { text: string; client: number; scroll: number }) {
  const ref = useRef<HTMLElement>(null);
  const measured = (el: HTMLElement | null) => {
    if (!el) return;
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
    ref.current = el;
  };
  useWholeWords(ref, text);
  return <b ref={measured}>{text}</b>;
}

describe('useWholeWords', () => {
  it('leaves the type alone when every word fits', () => {
    const { container } = render(<Title text="Tacos" client={230} scroll={230} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--words')).toBe('1');
  });

  it('shrinks the type so a word wider than the box fits', () => {
    const { container } = render(<Title text="Bacon Cheeseburger Sliders" client={180} scroll={200} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--words')).toBe('0.9');
  });

  it('does nothing while the box is unmeasured', () => {
    const { container } = render(<Title text="Cheeseburger" client={0} scroll={0} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--words')).toBe('1');
  });
});
