import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  AUTOSCROLL_REST_MS,
  AUTOSCROLL_RESUME_MS,
  glideOffset,
  shouldAutoScroll,
  wrapOffset,
} from '@/utils/wall/wallAutoScroll';
import { useModuleScroll } from './moduleScroll';
import { useWallPaused } from '@/components/wall/runtime/wallPaused';

/** How far a finger must travel up or down before a touch counts as spinning the list. */
const DRAG_PX = 8;
/** The top edge fades in over this many px of travel, so the resting first item is never dimmed. */
const FADE_PX = 36;

type Motion =
  | { phase: 'rest'; until: number }
  | { phase: 'glide'; start: number; from: number; distance: number }
  | { phase: 'held' };

/**
 * A panel list that's taller than its module turns like a wheel (see
 * `utils/wall/wallAutoScroll.ts`): it rests with the first item at the top,
 * glides up, runs on into a copy of itself past a quiet "Top of list" seam,
 * and settles with the first item back at the top. A touch holds it and a
 * vertical drag spins it by hand; it moves again after a pause. A list that
 * fits, a module whose auto scroll is stopped, or a reduced-motion device gets
 * a plain list (scrollable by hand).
 */
const WallAutoScroll: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const reduceMotion = useReducedMotion();
  const wheelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const seamRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const { on, onOverflow } = useModuleScroll();
  const paused = useWallPaused();
  const active = on && overflows && !reduceMotion;
  // Under the night screen the list keeps its shape but stops moving.
  const turning = active && !paused;

  useEffect(() => {
    onOverflow(overflows);
  }, [overflows, onOverflow]);

  useEffect(() => {
    const wheel = wheelRef.current;
    const content = contentRef.current;
    if (!wheel || !content || typeof ResizeObserver === 'undefined') return undefined;
    // Observing fires once straight away, which takes the first measurement.
    const ro = new ResizeObserver(() => setOverflows(shouldAutoScroll(content.offsetHeight, wheel.clientHeight)));
    ro.observe(wheel);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const wheel = wheelRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    if (!turning || !wheel || !content || !track) return undefined;

    let y = 0;
    let motion: Motion = { phase: 'rest', until: 0 };
    let drag: { startY: number; startX: number; from: number; moved: boolean } | null = null;
    let suppressClick = false;
    let raf = 0;
    let restTimer: number | undefined;

    // The lap is measured when it changes, not on every frame: reading
    // offsetHeight in a frame forces a layout.
    const lap = () => content.offsetHeight + (seamRef.current?.offsetHeight ?? 0);
    let len = lap();
    const paint = () => {
      track.style.transform = `translate3d(0, ${-y}px, 0)`;
      wheel.style.setProperty('--fade-top', `${Math.min(FADE_PX, y, len - y).toFixed(1)}px`);
    };

    const halt = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      window.clearTimeout(restTimer);
      restTimer = undefined;
    };
    // A resting or held list draws no frames: a timer wakes it when the rest ends.
    const rest = (ms: number) => {
      halt();
      motion = { phase: 'rest', until: performance.now() + ms };
      restTimer = window.setTimeout(() => {
        restTimer = undefined;
        raf = requestAnimationFrame(frame);
      }, ms);
    };

    const frame = (now: number) => {
      raf = 0;
      if (motion.phase === 'held') return;
      if (motion.phase === 'rest') {
        if (now < motion.until) {
          raf = requestAnimationFrame(frame);
          return;
        }
        // Glide on to the next lap's start; a hand-spun list finishes the lap it's in.
        const distance = len - y > 0.5 ? len - y : len;
        motion = { phase: 'glide', start: now, from: y, distance };
      }
      const g = glideOffset(motion.distance, now - motion.start);
      if (g.done) {
        y = 0;
        paint();
        rest(AUTOSCROLL_REST_MS);
        return;
      }
      y = wrapOffset(motion.from + g.offset, len);
      paint();
      raf = requestAnimationFrame(frame);
    };

    // Items checked off or added change the lap; keep the position inside it.
    const ro = new ResizeObserver(() => {
      len = lap();
      if (motion.phase === 'glide') return; // the next frame uses the new lap
      y = wrapOffset(y, len);
      paint();
    });
    ro.observe(content);
    if (seamRef.current) ro.observe(seamRef.current);

    paint();
    rest(AUTOSCROLL_REST_MS);

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      if (!drag.moved && Math.abs(dy) > DRAG_PX && Math.abs(dy) > Math.abs(e.clientX - drag.startX)) drag.moved = true;
      if (!drag.moved) return;
      y = wrapOffset(drag.from + dy, len);
      paint();
    };
    const onUp = () => {
      if (drag?.moved) suppressClick = true;
      drag = null;
      rest(AUTOSCROLL_RESUME_MS);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const onDown = (e: PointerEvent) => {
      drag = { startY: e.clientY, startX: e.clientX, from: y, moved: false };
      suppressClick = false;
      halt();
      motion = { phase: 'held' };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    // A spin ends in a click on whatever row is under the finger; it only turned the list.
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    wheel.addEventListener('pointerdown', onDown);
    wheel.addEventListener('click', onClick, true);

    return () => {
      halt();
      ro.disconnect();
      wheel.removeEventListener('pointerdown', onDown);
      wheel.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      track.style.transform = '';
      wheel.style.removeProperty('--fade-top');
    };
  }, [turning]);

  return (
    <div ref={wheelRef} className={active ? 'wheel on' : 'wheel'}>
      <div ref={trackRef} className="track">
        <div ref={contentRef}>{children}</div>
        {active && (
          <>
            <div ref={seamRef} className="seam" aria-hidden="true">
              Top of list
            </div>
            <div aria-hidden="true">{children}</div>
          </>
        )}
      </div>
    </div>
  );
};

export default WallAutoScroll;
