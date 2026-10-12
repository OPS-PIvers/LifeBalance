import { useLayoutEffect, useRef, type RefObject } from 'react';
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
 * tests) → everything shows. `onCut` hears whether anything was hidden.
 */
export function useWholeFill(ref: RefObject<HTMLElement | null>, onCut?: (cut: boolean) => void): void {
  // Held in a ref so a new callback each render doesn't re-attach the observers.
  const cutRef = useRef(onCut);
  useLayoutEffect(() => {
    cutRef.current = onCut;
  });
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
      cutRef.current?.(cut);
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

/**
 * Shrinks the type inside `ref` just enough that its longest word fits on one
 * line, so a narrow box shrinks a word like "Cheeseburger" instead of cutting
 * it off. Writes `--words` (1 when every word fits); its CSS multiplies its
 * font size by it. The box must not be wider than its column allows (a
 * `min-width: 0` flex or grid item), or a long word just widens it.
 */
export function useWholeWords(ref: RefObject<HTMLElement | null>, text: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const fit = () => {
      frame = 0;
      el.style.setProperty('--words', '1');
      // A word wider than the box overflows it sideways; the longest word scales with the font.
      const over = el.clientWidth ? el.scrollWidth / el.clientWidth : 1;
      el.style.setProperty('--words', over > 1 ? String(Math.floor(100 / over) / 100) : '1');
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(fit);
    };
    fit();
    // A rotation, a wider clock or weather column, or the display font arriving.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(el);
    if ('fonts' in document) void document.fonts.ready.then(later);
    return () => {
      resize?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, text]);
}
