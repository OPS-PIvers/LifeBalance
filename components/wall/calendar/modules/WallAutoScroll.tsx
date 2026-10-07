import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  AUTOSCROLL_REST_MS,
  AUTOSCROLL_RESUME_MS,
  glideOffset,
  shouldAutoScroll,
  wrapOffset,
} from '@/utils/wall/wallAutoScroll';

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
 * fits, or a reduced-motion device, gets a plain list (scrollable by hand).
 */
const WallAutoScroll: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const reduceMotion = useReducedMotion();
  const wheelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const seamRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const active = overflows && !reduceMotion;

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
    if (!active || !wheel || !content || !track) return undefined;

    let y = 0;
    let motion: Motion = { phase: 'rest', until: performance.now() + AUTOSCROLL_REST_MS };
    let drag: { startY: number; startX: number; from: number; moved: boolean } | null = null;
    let suppressClick = false;
    let raf = 0;

    const lap = () => content.offsetHeight + (seamRef.current?.offsetHeight ?? 0);
    const paint = (len: number) => {
      track.style.transform = `translate3d(0, ${-y}px, 0)`;
      wheel.style.setProperty('--fade-top', `${Math.min(FADE_PX, y, len - y).toFixed(1)}px`);
    };

    const frame = (now: number) => {
      const len = lap();
      if (motion.phase === 'rest' && now >= motion.until) {
        // Glide on to the next lap's start; a hand-spun list finishes the lap it's in.
        const distance = len - y > 0.5 ? len - y : len;
        motion = { phase: 'glide', start: now, from: y, distance };
      }
      if (motion.phase === 'glide') {
        const g = glideOffset(motion.distance, now - motion.start);
        if (g.done) {
          y = 0;
          motion = { phase: 'rest', until: now + AUTOSCROLL_REST_MS };
        } else {
          y = wrapOffset(motion.from + g.offset, len);
        }
      } else {
        // Items checked off or added change the lap; keep the position inside it.
        y = wrapOffset(y, len);
      }
      paint(len);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      if (!drag.moved && Math.abs(dy) > DRAG_PX && Math.abs(dy) > Math.abs(e.clientX - drag.startX)) drag.moved = true;
      if (drag.moved) y = wrapOffset(drag.from + dy, lap());
    };
    const onUp = () => {
      if (drag?.moved) suppressClick = true;
      drag = null;
      motion = { phase: 'rest', until: performance.now() + AUTOSCROLL_RESUME_MS };
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const onDown = (e: PointerEvent) => {
      drag = { startY: e.clientY, startX: e.clientX, from: y, moved: false };
      suppressClick = false;
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
      cancelAnimationFrame(raf);
      wheel.removeEventListener('pointerdown', onDown);
      wheel.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      track.style.transform = '';
      wheel.style.removeProperty('--fade-top');
    };
  }, [active]);

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
