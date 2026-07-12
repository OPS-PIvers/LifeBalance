import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haptic } from './haptics';

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

describe('haptic', () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Remove any hidden switch element left behind (the helper re-creates it
    // when detached, so removal keeps tests independent).
    document.querySelectorAll('label[aria-hidden="true"]').forEach(el => el.remove());
  });

  it('uses navigator.vibrate when available', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('light');
    expect(vibrate).toHaveBeenCalledWith(10);
    // Remove the stub so later tests exercise the no-vibrate path.
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it('respects prefers-reduced-motion', () => {
    stubMatchMedia(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    haptic('medium');
    expect(vibrate).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it('falls back to the hidden switch-toggle on iOS-like devices without vibrate', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15');
    haptic('light');
    const label = document.querySelector('label[aria-hidden="true"]');
    expect(label).not.toBeNull();
    const input = label?.querySelector('input[type="checkbox"][switch]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // A label click toggles its nested checkbox — that toggle is what fires
    // the iOS system haptic.
    expect(input.checked).toBe(true);
    haptic('light');
    expect(input.checked).toBe(false);
  });

  it('does nothing on non-iOS devices without vibrate', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
    haptic('light');
    expect(document.querySelector('label[aria-hidden="true"]')).toBeNull();
  });
});
