import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WallAutoScroll from './WallAutoScroll';
import WallModuleSlot from '@/components/wall/calendar/WallModuleSlot';

/** jsdom lays nothing out: give the wheel and its list real heights, and fire the observer by hand. */
function layout(contentHeight: number | (() => number), viewportHeight: number) {
  const content = typeof contentHeight === 'number' ? () => contentHeight : contentHeight;
  const observers: ResizeObserverCallback[] = [];
  // The wheel's frame loop isn't under test here; keep it from running.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.classList.contains('track') && this === this.parentElement.firstElementChild ? content() : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('wheel') ? viewportHeight : 0;
  });
  return () => act(() => observers.forEach(cb => cb([], {} as ResizeObserver)));
}

function reducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const List = () => (
  <WallAutoScroll>
    <button type="button">Milk</button>
    <button type="button">Eggs</button>
  </WallAutoScroll>
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WallAutoScroll', () => {
  it('leaves a list that fits alone: one copy, no seam', () => {
    const measure = layout(300, 600);
    const { container } = render(<List />);
    measure();
    expect(screen.getAllByText('Milk')).toHaveLength(1);
    expect(screen.queryByText('Top of list')).toBeNull();
    expect(container.querySelector('.wheel')).not.toHaveClass('on');
  });

  it('turns a list taller than its module: the list, a seam, then a hidden copy', () => {
    const measure = layout(900, 600);
    const { container } = render(<List />);
    measure();
    expect(container.querySelector('.wheel')).toHaveClass('on');
    expect(screen.getByText('Top of list')).toBeInTheDocument();
    // Assistive tech sees the list once; the copy is only there to look continuous.
    expect(screen.getAllByRole('button', { name: 'Milk' })).toHaveLength(1);
    expect(screen.getAllByText('Milk')).toHaveLength(2);
  });

  it('stays a plain hand-scrolled list under reduced motion', () => {
    reducedMotion(true);
    const measure = layout(900, 600);
    const { container } = render(<List />);
    measure();
    expect(container.querySelector('.wheel')).not.toHaveClass('on');
    expect(screen.getAllByText('Milk')).toHaveLength(1);
  });

  it('stops turning when the list shrinks to fit', () => {
    let content = 900;
    const fire = layout(() => content, 600);
    const { container } = render(<List />);
    fire();
    expect(container.querySelector('.wheel')).toHaveClass('on');
    content = 400;
    fire();
    expect(container.querySelector('.wheel')).not.toHaveClass('on');
    expect(screen.queryByText('Top of list')).toBeNull();
  });
});

describe('a module’s pause / play', () => {
  const Slot = ({ on, onScroll }: { on: boolean; onScroll: (on: boolean) => void }) => (
    <WallModuleSlot className="mod top" title="Shopping" scrollOn={on} onScroll={onScroll} onSwipe={() => undefined} swipeable={false}>
      <List />
    </WallModuleSlot>
  );

  it('shows only when the list is longer than its module', () => {
    const measure = layout(300, 600);
    render(<Slot on onScroll={vi.fn()} />);
    measure();
    expect(screen.queryByRole('button', { name: /scroll/i })).toBeNull();
  });

  it('pauses a turning list, and a paused list stays plain and offers play', () => {
    const measure = layout(900, 600);
    const onScroll = vi.fn();
    const { container, rerender } = render(<Slot on onScroll={onScroll} />);
    measure();
    expect(container.querySelector('.wheel')).toHaveClass('on');
    fireEvent.click(screen.getByRole('button', { name: 'Stop scrolling Shopping' }));
    expect(onScroll).toHaveBeenLastCalledWith(false);
    rerender(<Slot on={false} onScroll={onScroll} />);
    measure();
    expect(container.querySelector('.wheel')).not.toHaveClass('on');
    expect(screen.queryByText('Top of list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scroll Shopping by itself' }));
    expect(onScroll).toHaveBeenLastCalledWith(true);
  });

  it('offers no control under reduced motion, where nothing turns', () => {
    reducedMotion(true);
    const measure = layout(900, 600);
    render(<Slot on onScroll={vi.fn()} />);
    measure();
    expect(screen.queryByRole('button', { name: /scroll/i })).toBeNull();
  });
});
