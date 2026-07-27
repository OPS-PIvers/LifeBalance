// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haptic, hapticForNativeSwitch } from './haptics';

// jsdom has no matchMedia; stub it per-test so we control reduced-motion.
const stubMatchMedia = (reducedMotion: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
};

const setUserAgent = (ua: string) => {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
};

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15';

describe('haptic', () => {
  // The iOS transport creates, clicks, and removes a hidden label
  // synchronously, so observe the clicks themselves rather than the DOM.
  let clickedElements: HTMLElement[];

  beforeEach(() => {
    stubMatchMedia(false);
    clickedElements = [];
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      clickedElements.push(this);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses navigator.vibrate when available', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('light');
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(clickedElements).toHaveLength(0);
    // Remove the stub so later tests exercise the no-vibrate path.
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it('suppresses vibration under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('medium');
    expect(vibrate).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it('falls back to a hidden switch-toggle click on iOS-like devices without vibrate', () => {
    setUserAgent(IOS_UA);
    haptic('light');
    expect(clickedElements).toHaveLength(1);
    const label = clickedElements[0]!;
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(label.querySelector('input[type="checkbox"][switch]')).not.toBeNull();
    // Throwaway element: removed synchronously after the click.
    expect(document.head.contains(label)).toBe(false);
  });

  it('adds a delayed second tick on iOS for success/warning/error patterns', () => {
    vi.useFakeTimers();
    setUserAgent(IOS_UA);
    haptic('success');
    expect(clickedElements).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(clickedElements).toHaveLength(2);
  });

  it('still ticks on iOS under prefers-reduced-motion (System Haptics governs there)', () => {
    stubMatchMedia(true);
    setUserAgent(IOS_UA);
    haptic('light');
    expect(clickedElements).toHaveLength(1);
  });

  it('does nothing on non-iOS devices without vibrate', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
    haptic('light');
    expect(clickedElements).toHaveLength(0);
  });
});

describe('hapticForNativeSwitch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses navigator.vibrate when available', () => {
    stubMatchMedia(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    hapticForNativeSwitch('light');
    expect(vibrate).toHaveBeenCalledWith(10);
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it('never falls back to the programmatic switch tick on iOS (the real switch input provides the haptic)', () => {
    stubMatchMedia(false);
    setUserAgent(IOS_UA);
    const clicked: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      clicked.push(this);
    });
    hapticForNativeSwitch('success');
    expect(clicked).toHaveLength(0);
  });
});
