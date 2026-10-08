import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { WallRailMode } from '@/types/schema';

/** How long a tap keeps the rail out ('tap' mode), from the last touch. */
export const RAIL_PEEK_MS = 8000;
/** How long the clock is held to open the display menu. */
export const CLOCK_HOLD_MS = 700;
/** A finger that drifts further than this is scrolling, not holding. */
const HOLD_SLOP_PX = 12;
/** The clock on the Week masthead and on every other screen's header. */
const CLOCK_SELECTOR = '.mast .clock, .hdr .hclk > b';

interface Hold {
  timer: number;
  x: number;
  y: number;
}

/**
 * The rail's Settings choice on the wall (`wallSettings.rail`). 'tap' brings
 * the rail up as a floating toolbar (wall.css) on any touch and takes it away
 * after RAIL_PEEK_MS without one; the touch itself still lands on what was touched. Holding the
 * clock opens the display menu in every mode, which is the way in when the
 * rail (and its button) is hidden.
 */
export function useWallRail(mode: WallRailMode, onHoldClock: () => void) {
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const hold = useRef<Hold | null>(null);
  const holdCb = useRef(onHoldClock);
  useEffect(() => {
    holdCb.current = onHoldClock;
  }, [onHoldClock]);

  const cancelHold = useCallback(() => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    setPeek(false);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(peekTimer.current);
      cancelHold();
    },
    [cancelHold]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode === 'tap') {
        setPeek(true);
        window.clearTimeout(peekTimer.current);
        peekTimer.current = window.setTimeout(() => setPeek(false), RAIL_PEEK_MS);
      }
      cancelHold();
      if (e.target instanceof Element && e.target.closest(CLOCK_SELECTOR)) {
        hold.current = {
          x: e.clientX,
          y: e.clientY,
          timer: window.setTimeout(() => {
            hold.current = null;
            holdCb.current();
          }, CLOCK_HOLD_MS),
        };
      }
    },
    [mode, cancelHold]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const h = hold.current;
      if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) cancelHold();
    },
    [cancelHold]
  );

  return {
    /** The rail sits over the screen instead of beside it. */
    floating: mode === 'tap',
    /** Render the rail at all. */
    shown: mode !== 'hidden',
    /** 'tap' mode: the rail is out right now. */
    open: mode === 'tap' && peek,
    hide,
    handlers: { onPointerDown, onPointerMove, onPointerUp: cancelHold, onPointerCancel: cancelHold },
  };
}
