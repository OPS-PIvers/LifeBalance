import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePwaInstallPrompt, isIosSafari } from './usePwaInstallPrompt';

describe('isIosSafari', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
  });

  it('detects iOS Safari', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    expect(isIosSafari()).toBe(true);
  });

  it('excludes iOS Chrome (CriOS)', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    expect(isIosSafari()).toBe(false);
  });

  it('excludes desktop Chrome', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    expect(isIosSafari()).toBe(false);
  });
});

describe('usePwaInstallPrompt', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts uninstallable and uninstalled when no signal is present', () => {
    const { result } = renderHook(() => usePwaInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('captures beforeinstallprompt, preventDefault-ing it, and exposes canInstall', () => {
    const { result } = renderHook(() => usePwaInstallPrompt());
    const preventDefault = vi.fn();
    const promptEvent = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault,
      platforms: ['web'],
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });

    act(() => {
      window.dispatchEvent(promptEvent);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(true);
  });

  it('marks installed and clears canInstall on appinstalled', () => {
    const { result } = renderHook(() => usePwaInstallPrompt());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
    expect(window.localStorage.getItem('lb_pwa_installed')).toBe('1');
  });

  it('starts already-installed when the localStorage flag was previously set', () => {
    window.localStorage.setItem('lb_pwa_installed', '1');
    const { result } = renderHook(() => usePwaInstallPrompt());
    expect(result.current.isInstalled).toBe(true);
  });
});
