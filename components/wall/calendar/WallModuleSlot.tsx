import React, { useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { ModuleScrollContext, type ModuleScroll } from './modules/moduleScroll';
import { useModuleSwipe } from './useModuleSwipe';

interface WallModuleSlotProps {
  className: string;
  title: string;
  /** What the heading carries beside the title (Coming up's Week · Month, "2 of 5 done"). */
  extra?: React.ReactNode;
  /** No heading of its own (the day column's Due today draws one). */
  bare?: boolean;
  scrollOn: boolean;
  onScroll: (on: boolean) => void;
  onSwipe: (dir: 1 | -1) => void;
  swipeable: boolean;
  /** The slot was just swiped to: slide in from that side. */
  enter?: 1 | -1 | null;
  children: React.ReactNode;
}

/**
 * One module on the Week screen, outside Arrange mode: swiped sideways to
 * switch what it shows, and, when its list is longer than its box, a
 * pause / play button in its heading that stops or starts its auto scroll
 * (the usual control for anything that moves by itself).
 */
const WallModuleSlot: React.FC<WallModuleSlotProps> = ({
  className,
  title,
  extra,
  bare = false,
  scrollOn,
  onScroll,
  onSwipe,
  swipeable,
  enter = null,
  children,
}) => {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  useModuleSwipe(ref, onSwipe, { enabled: swipeable, reduceMotion });
  const [overflows, setOverflows] = useState(false);
  const scroll = useMemo<ModuleScroll>(() => ({ on: scrollOn, onOverflow: setOverflows }), [scrollOn]);
  const cls = [className, 'swipe', enter === 1 ? 'swin-next' : enter === -1 ? 'swin-prev' : ''].filter(Boolean).join(' ');

  if (bare) {
    return (
      <section ref={ref} className={cls} aria-label={title}>
        {children}
      </section>
    );
  }
  return (
    <section ref={ref} className={cls} aria-label={title}>
      <div className="mh">
        <b>{title}</b>
        {extra}
        {overflows && !reduceMotion && (
          <button
            type="button"
            className="mplay"
            aria-label={scrollOn ? `Stop scrolling ${title}` : `Scroll ${title} by itself`}
            onClick={() => onScroll(!scrollOn)}
          >
            {scrollOn ? <Pause className="wi" size="1em" aria-hidden="true" /> : <Play className="wi" size="1em" aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="mb">
        <ModuleScrollContext.Provider value={scroll}>{children}</ModuleScrollContext.Provider>
      </div>
    </section>
  );
};

export default WallModuleSlot;
