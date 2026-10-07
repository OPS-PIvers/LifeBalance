import { useEffect, useRef, type RefObject } from 'react';

/** Sideways travel before a touch counts as a swipe (and stops being a tap). */
const DECIDE_PX = 14;
/** A swipe must be this much more sideways than up-and-down. */
const SIDEWAYS = 1.4;
/** Travel that switches the module on release; a quick flick needs less. */
const COMMIT_PX = 90;
const FLICK_PX = 40;
const FLICK_MS = 260;
/** How far the module follows the finger, as a share of the finger's travel. */
const FOLLOW = 0.55;
const OUT_MS = 130;

/**
 * A sideways swipe on a Week-screen module switches what that slot shows
 * (`swipeModule` in utils/wall/wallModules.ts): left for the next module,
 * right for the previous one. The module follows the finger and fades; past
 * the line it slides out and the new one slides in (WallWeek's `.swin-*`
 * classes), otherwise it springs back. An up-and-down drag is left alone, so
 * a list still scrolls and the auto-scroll wheel still spins, and a swipe
 * never ends in a tap on the row under the finger. Reduced motion: no
 * following, the module just changes.
 */
export function useModuleSwipe(
  ref: RefObject<HTMLElement | null>,
  onSwipe: (dir: 1 | -1) => void,
  opts: { enabled: boolean; reduceMotion: boolean }
): void {
  const swipeRef = useRef(onSwipe);
  useEffect(() => {
    swipeRef.current = onSwipe;
  });
  const { enabled, reduceMotion } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;
    let drag: { x: number; y: number; t: number; sideways: boolean | null; dx: number } | null = null;
    let suppressClick = false;
    let outTimer = 0;

    const paint = (dx: number) => {
      if (reduceMotion) return;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${(dx * FOLLOW).toFixed(1)}px, 0, 0)`;
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 700));
    };
    const settle = () => {
      el.style.transition = 'transform 180ms ease, opacity 180ms ease';
      el.style.transform = '';
      el.style.opacity = '';
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (drag.sideways === null) {
        if (Math.abs(dx) > DECIDE_PX && Math.abs(dx) > Math.abs(dy) * SIDEWAYS) drag.sideways = true;
        else if (Math.abs(dy) > DECIDE_PX) drag.sideways = false;
      }
      if (!drag.sideways) return;
      drag.dx = dx;
      paint(dx);
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = () => {
      end();
      if (!drag?.sideways) {
        drag = null;
        return;
      }
      const { dx, t } = drag;
      drag = null;
      suppressClick = true;
      const quick = performance.now() - t < FLICK_MS && Math.abs(dx) > FLICK_PX;
      if (Math.abs(dx) < COMMIT_PX && !quick) {
        settle();
        return;
      }
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      if (reduceMotion) {
        swipeRef.current(dir);
        return;
      }
      el.style.transition = `transform ${OUT_MS}ms ease-in, opacity ${OUT_MS}ms ease-in`;
      el.style.transform = `translate3d(${dir === 1 ? -60 : 60}px, 0, 0)`;
      el.style.opacity = '0';
      outTimer = window.setTimeout(() => {
        // The slot remounts with the new module; clear in case it doesn't (nothing else to show).
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
        swipeRef.current(dir);
      }, OUT_MS);
    };
    const onCancel = () => {
      end();
      if (drag?.sideways) settle();
      drag = null;
    };
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), sideways: null, dx: 0 };
      suppressClick = false;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    };
    // A swipe ends in a click on whatever was under the finger; it only switched the module.
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick, true);
    return () => {
      end();
      window.clearTimeout(outTimer);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick, true);
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    };
  }, [ref, enabled, reduceMotion]);
}
