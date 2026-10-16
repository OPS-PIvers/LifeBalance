import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WallAutoScroll from './WallAutoScroll';
import WallModuleSlot from '@/components/wall/calendar/WallModuleSlot';
import { WallPausedContext } from '@/components/wall/runtime/wallPaused';
import { AUTOSCROLL_REST_MS, AUTOSCROLL_RESUME_MS } from '@/utils/wall/wallAutoScroll';

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

describe('frames only while the list moves', () => {
  /** An overflowing list whose frame requests are recorded, not run. */
  function overflowing(paused = false) {
    vi.useFakeTimers();
    const measure = layout(900, 600);
    const raf = vi.fn((_cb: FrameRequestCallback) => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const tree = (p: boolean) => (
      <WallPausedContext.Provider value={p}>
        <List />
      </WallPausedContext.Provider>
    );
    const view = render(tree(paused));
    measure();
    const wheel = view.container.querySelector('.wheel') as HTMLElement;
    const track = view.container.querySelector('.track') as HTMLElement;
    return { raf, wheel, track, setPaused: (p: boolean) => view.rerender(tree(p)) };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for no frame until the rest is over', () => {
    const { raf } = overflowing();
    act(() => vi.advanceTimersByTime(AUTOSCROLL_REST_MS - 1));
    expect(raf).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('goes back to resting without frames once a lap is done', () => {
    const { raf, track } = overflowing();
    act(() => vi.advanceTimersByTime(AUTOSCROLL_REST_MS));
    const frame = raf.mock.calls[0]?.[0];
    expect(frame).toBeDefined();
    // Frame times from past the end of the rest, whether or not the clock is faked.
    const t0 = performance.now() + AUTOSCROLL_REST_MS;
    act(() => frame?.(t0));
    act(() => frame?.(t0 + 1000));
    expect(track.style.transform).not.toBe('translate3d(0, 0px, 0)');
    const during = raf.mock.calls.length;
    // Long past the end of the glide: the list settles at the top and rests.
    act(() => frame?.(t0 + 10 * 60_000));
    expect(track.style.transform).toBe('translate3d(0, 0px, 0)');
    expect(raf).toHaveBeenCalledTimes(during);
    act(() => vi.advanceTimersByTime(AUTOSCROLL_REST_MS - 1));
    expect(raf).toHaveBeenCalledTimes(during);
    act(() => vi.advanceTimersByTime(1));
    expect(raf).toHaveBeenCalledTimes(during + 1);
  });

  it('schedules nothing under the night screen, and keeps the list’s shape', () => {
    const { raf, wheel } = overflowing(true);
    expect(wheel).toHaveClass('on');
    expect(screen.getByText('Top of list')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(raf).not.toHaveBeenCalled();
  });

  it('turns again after the night screen goes', () => {
    const { raf, setPaused } = overflowing(true);
    setPaused(false);
    act(() => vi.advanceTimersByTime(AUTOSCROLL_REST_MS));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('stops when the night screen comes up mid-glide', () => {
    const cancel = vi.fn();
    const { raf, setPaused, track } = overflowing();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    act(() => vi.advanceTimersByTime(AUTOSCROLL_REST_MS));
    setPaused(true);
    expect(cancel).toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('draws no frames while a finger holds it, and a spin paints straight away', () => {
    const { raf, wheel, track } = overflowing();
    fireEvent.pointerDown(wheel, { clientX: 10, clientY: 300 });
    act(() => vi.advanceTimersByTime(60_000));
    expect(raf).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 10, clientY: 250 });
    expect(track.style.transform).toBe('translate3d(0, -50px, 0)');
    expect(raf).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    act(() => vi.advanceTimersByTime(AUTOSCROLL_RESUME_MS - 1));
    expect(raf).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
