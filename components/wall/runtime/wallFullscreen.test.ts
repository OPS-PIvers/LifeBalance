// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canFullscreen, isFullscreen, toggleFullscreen } from './wallFullscreen';

type Fs = { requestFullscreen?: () => Promise<void>; exitFullscreen?: () => Promise<void> };
const proto = Element.prototype as unknown as Fs;
const doc = document as unknown as Fs;

function stubStandalone(standalone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: standalone && query.includes('standalone'), media: query }));
}

afterEach(() => {
  delete proto.requestFullscreen;
  delete doc.exitFullscreen;
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  vi.unstubAllGlobals();
});

describe('wallFullscreen', () => {
  it('is offered in a Safari tab that has the API, not in a Home Screen app', () => {
    stubStandalone(false);
    proto.requestFullscreen = vi.fn(async () => undefined);
    expect(canFullscreen()).toBe(true);
    stubStandalone(true);
    expect(canFullscreen()).toBe(false);
  });

  it('puts the wall box full screen, never the page, and leaves on the next toggle', () => {
    const wall = document.createElement('div');
    const request = vi.fn(async () => undefined);
    (wall as unknown as Fs).requestFullscreen = request;
    toggleFullscreen(wall);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(wall);

    Object.defineProperty(document, 'fullscreenElement', { value: wall, configurable: true });
    expect(isFullscreen()).toBe(true);
    const exit = vi.fn(async () => undefined);
    doc.exitFullscreen = exit;
    toggleFullscreen(wall);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a touch: no listener asks for full screen by itself', () => {
    const request = vi.fn(async () => undefined);
    proto.requestFullscreen = request;
    document.body.dispatchEvent(new Event('touchend', { bubbles: true }));
    document.body.click();
    expect(request).not.toHaveBeenCalled();
  });
});
