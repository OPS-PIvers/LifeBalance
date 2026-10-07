import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { fitScale } from '@/utils/wall/wallFit';

const PORTRAIT = '(orientation: portrait)';

/** Whether the screen is taller than it is wide (an iPad standing up). */
export function useWallPortrait(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [portrait, setPortrait] = useState(() => supported && window.matchMedia(PORTRAIT).matches);
  useEffect(() => {
    if (!supported) return undefined;
    const list = window.matchMedia(PORTRAIT);
    const update = () => setPortrait(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [supported]);
  return portrait;
}

/**
 * Grows the type inside `ref` until it fills the box, and shrinks it on a busy
 * day so nothing is cut off. Writes `--fit` on the element; its CSS multiplies
 * its sizes by it. The box must have a height of its own (not sized by its
 * content), or everything fits at any size. Off → `--fit` is 1.
 */
export function useWallFit(ref: RefObject<HTMLElement | null>, opts: { on: boolean; min: number; max: number }): void {
  const { on, min, max } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!on) {
      el.style.setProperty('--fit', '1');
      return undefined;
    }
    let frame = 0;
    const fit = () => {
      frame = 0;
      const scale = fitScale(min, max, s => {
        el.style.setProperty('--fit', String(s));
        return el.scrollHeight <= el.clientHeight + 1;
      });
      el.style.setProperty('--fit', String(scale));
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(fit);
    };
    fit();
    // A new event, a ticked-off to-do, a rotation, or the display font arriving.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(el);
    const mutate = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later);
    mutate?.observe(el, { childList: true, subtree: true, characterData: true });
    if ('fonts' in document) void document.fonts.ready.then(later);
    return () => {
      resize?.disconnect();
      mutate?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, on, min, max]);
}
