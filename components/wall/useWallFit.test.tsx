import { useRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLineClamp, useWholeWords } from './useWallFit';

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

/** Lays the children out as `perRow` to a row, like a flex-wrap line `perRow` items wide. */
function Line({ count, perRow, lines }: { count: number; perRow: number; lines: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLineClamp(ref, lines);
  const rowOf = (el: HTMLElement) => {
    const shown = Array.from(el.parentElement?.children ?? []).filter(c => !(c as HTMLElement).hidden);
    return Math.floor(shown.indexOf(el) / perRow);
  };
  const place = (el: HTMLElement | null) => {
    if (el) el.getBoundingClientRect = () => ({ top: rowOf(el) * 30 }) as DOMRect;
  };
  return (
    <div ref={ref}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} ref={place}>
          {`item ${i}`}
        </span>
      ))}
      <span className="more" ref={place} hidden />
    </div>
  );
}

describe('useLineClamp', () => {
  const visible = (c: HTMLElement) => Array.from(c.querySelectorAll('span')).filter(s => !s.hidden).map(s => s.textContent);

  it('shows every item when they fit in the rows allowed', () => {
    const { container } = render(<Line count={6} perRow={3} lines={2} />);
    expect(visible(container)).toEqual(['item 0', 'item 1', 'item 2', 'item 3', 'item 4', 'item 5']);
  });

  it('folds the overflow into "+N more" on the last row', () => {
    const { container } = render(<Line count={10} perRow={3} lines={2} />);
    expect(visible(container)).toEqual(['item 0', 'item 1', 'item 2', 'item 3', 'item 4', '+5 more']);
  });
});
