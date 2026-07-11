import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useKeyboardViewportAnchor, KEYBOARD_MIN_HEIGHT_PX } from './useKeyboardViewportAnchor';

// Minimal stand-in for window.visualViewport: a real EventTarget with
// mutable height/scale so tests can simulate the iOS keyboard opening.
class FakeVisualViewport extends EventTarget {
  height: number;
  scale = 1;
  constructor(height: number) {
    super();
    this.height = height;
  }
  open(keyboardHeight: number) {
    this.height = window.innerHeight - keyboardHeight;
    this.dispatchEvent(new Event('resize'));
  }
  close() {
    this.height = window.innerHeight;
    this.dispatchEvent(new Event('resize'));
  }
}

const Shell: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const shellRef = useKeyboardViewportAnchor<HTMLDivElement>();
  return (
    <div ref={shellRef} data-testid="shell">
      <input data-testid="in-shell-input" />
      {children}
    </div>
  );
};

const appHeightVar = () => document.documentElement.style.getPropertyValue('--app-height');

describe('useKeyboardViewportAnchor', () => {
  let fakeViewport: FakeVisualViewport;
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom: innerHeight defaults to 768 and documentElement.clientHeight is 0,
    // so the hook falls back to innerHeight as the layout-viewport height.
    fakeViewport = new FakeVisualViewport(window.innerHeight);
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: fakeViewport as unknown as VisualViewport,
    });
    scrollToSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollToSpy });
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--app-height');
  });

  const openKeyboardWithFocus = (getByTestId: (id: string) => HTMLElement) => {
    getByTestId('in-shell-input').focus();
    act(() => {
      fakeViewport.open(336);
    });
  };

  it('sets --app-height to the visual viewport height when the keyboard opens on a shell input', () => {
    const { getByTestId } = render(<Shell />);
    openKeyboardWithFocus((id) => getByTestId(id));
    expect(appHeightVar()).toBe(`${window.innerHeight - 336}px`);
  });

  it('clears --app-height when the keyboard closes', () => {
    const { getByTestId } = render(<Shell />);
    openKeyboardWithFocus((id) => getByTestId(id));
    act(() => {
      fakeViewport.close();
    });
    expect(appHeightVar()).toBe('');
  });

  it('does not anchor for a shrink smaller than a keyboard', () => {
    const { getByTestId } = render(<Shell />);
    getByTestId('in-shell-input').focus();
    act(() => {
      fakeViewport.open(KEYBOARD_MIN_HEIGHT_PX - 1);
    });
    expect(appHeightVar()).toBe('');
  });

  it('does not anchor when focus is outside the shell (portal overlays keep native pan)', () => {
    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    render(<Shell />);
    outsideInput.focus();
    act(() => {
      fakeViewport.open(336);
    });
    expect(appHeightVar()).toBe('');
    outsideInput.remove();
  });

  it('pins the window scroll back to (0,0) while anchored', () => {
    const { getByTestId } = render(<Shell />);
    openKeyboardWithFocus((id) => getByTestId(id));
    scrollToSpy.mockClear();
    // Simulate WebKit panning the layout viewport to reveal the input.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('does not pin window scroll when not anchored', () => {
    render(<Shell />);
    scrollToSpy.mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('clears --app-height on unmount', () => {
    const { getByTestId, unmount } = render(<Shell />);
    openKeyboardWithFocus((id) => getByTestId(id));
    expect(appHeightVar()).not.toBe('');
    unmount();
    expect(appHeightVar()).toBe('');
  });

  it('clears the anchor when the input blurs while the keyboard closes', () => {
    const { getByTestId } = render(<Shell />);
    openKeyboardWithFocus((id) => getByTestId(id));
    act(() => {
      getByTestId('in-shell-input').blur();
      fakeViewport.close();
    });
    expect(appHeightVar()).toBe('');
  });
});
