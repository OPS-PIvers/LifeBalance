import { useLayoutEffect, type RefObject } from 'react';
import { fitScale } from '@/utils/wall/wallFit';

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

/**
 * Shows only the children of `ref` that fit whole and hides the rest, so a
 * list never ends on half a day (the Week panel's "fill whole days"). The
 * first child always shows. The box needs `position: relative` (children are
 * measured against it) and a height of its own. Unmeasured (0 high, as in
 * tests) → everything shows.
 */
export function useWholeFill(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const fill = () => {
      frame = 0;
      const items = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
      for (const c of items) c.hidden = false;
      const limit = el.clientHeight;
      if (limit <= 0) return;
      let cut = false;
      items.forEach((c, i) => {
        if (i > 0 && (cut || c.offsetTop + c.offsetHeight > limit + 1)) {
          cut = true;
          c.hidden = true;
        }
      });
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(fill);
    };
    fill();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(el);
    // Only the list changing: `hidden` is an attribute, so hiding doesn't re-trigger this.
    const mutate = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later);
    mutate?.observe(el, { childList: true, subtree: true, characterData: true });
    if ('fonts' in document) void document.fonts.ready.then(later);
    return () => {
      resize?.disconnect();
      mutate?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
}
