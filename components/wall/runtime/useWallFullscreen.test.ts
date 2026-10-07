import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWallFullscreen } from './useWallFullscreen';

const root = document.documentElement as unknown as { requestFullscreen?: () => Promise<void> };

function stubStandalone(standalone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: standalone && query.includes('standalone'), media: query }));
}

afterEach(() => {
  delete root.requestFullscreen;
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  vi.unstubAllGlobals();
});

describe('useWallFullscreen', () => {
  it('goes full screen on a touch in a Safari tab, and not again while it is', () => {
    stubStandalone(false);
    const request = vi.fn(async () => undefined);
    root.requestFullscreen = request;
    renderHook(() => useWallFullscreen(true));
    document.body.click();
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    document.body.click();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('leaves a Home Screen app and a member preview alone', () => {
    const request = vi.fn(async () => undefined);
    root.requestFullscreen = request;
    stubStandalone(true);
    const app = renderHook(() => useWallFullscreen(true));
    document.body.click();
    app.unmount();
    stubStandalone(false);
    renderHook(() => useWallFullscreen(false));
    document.body.click();
    expect(request).not.toHaveBeenCalled();
  });
});
