import React, { useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { haptic, type HapticPattern } from '@/utils/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

/**
 * Gmail / Apple Mail–style swipeable row.
 *
 * The interaction model (shared by every swipeable list row in the app):
 *
 * 1. The row tracks the finger 1:1, immediately revealing the action's icon +
 *    label on the side being uncovered — no more "the row barely moves while
 *    the raw finger offset silently commits" (the old rows pinned constraints
 *    at 0 with a small dragElastic, so a 100px swipe revealed ~10px of hint).
 * 2. Release PAST the commit distance (~55% of the row width, or an outward
 *    flick) → the action fires.
 * 3. Release in the middle zone → the row snaps open, leaving the action as a
 *    real tappable button (like Gmail); tapping it fires the action, tapping
 *    the row content (or dragging back) closes it without acting.
 * 4. Release before the reveal threshold → the row snaps shut, nothing fires.
 *
 * Under prefers-reduced-motion the drag is disabled entirely (existing app
 * convention); every swipe action must therefore remain reachable through a
 * visible control — swipes are shortcuts, never the only path.
 */

export interface SwipeAction {
  icon: LucideIcon;
  /** Short label rendered under the icon (e.g. "Delete", "Purchased"). */
  label: string;
  /** Visual tone: background tint + icon/label color. */
  tone: 'positive' | 'destructive' | 'warm';
  /** Fired on commit-swipe or on tapping the stuck-open button. */
  onAction: () => void;
  /** Haptic fired alongside the action. Default 'light'. */
  hapticPattern?: HapticPattern;
}

interface SwipeActionRowProps {
  /** Action revealed under the LEFT edge when swiping right. */
  startAction?: SwipeAction;
  /** Action revealed under the RIGHT edge when swiping left. */
  endAction?: SwipeAction;
  /** Disables the gesture (selection mode, expanded rows, …). */
  disabled?: boolean;
  /** Outer wrapper classes (the wrapper is relative + overflow-hidden). */
  className?: string;
  /**
   * Fired when a horizontal drag actually starts. Rows with tap/long-press
   * gestures use this to cancel pending long-presses and swallow the click
   * that browsers synthesize at the end of a swipe.
   */
  onSwipeStart?: () => void;
  children: React.ReactNode;
}

/** Rest offset (px) of a stuck-open row — the width of the revealed button. */
const OPEN_PX = 88;
/** Minimum travel (px) for a release to stick open instead of snapping shut. */
const STICK_PX = 32;
/** Outward fling speed (px/s) that commits from anywhere past STICK_PX. */
const FLICK_VELOCITY = 800;
/** Commit distance = this fraction of the row width (min COMMIT_MIN_PX). */
const COMMIT_FRACTION = 0.55;
const COMMIT_MIN_PX = 160;

// Background tints per tone, matching the app's money/warm token values
// (hex because framer-motion interpolates raw colors, same pattern the old
// per-row swipe layers used).
const TONE_BG = {
  positive: { light: '#eef6f1', dark: '#0f2e23' },   // money-bgPos / money-pos tint
  destructive: { light: '#fbeeec', dark: '#3f1d2b' }, // money-bgNeg / money-neg tint
  warm: { light: '#faf4ea', dark: '#3a2c15' },        // warm-50 / warm tint
} as const;
const ROW_BG = { light: '#ffffff', dark: '#242220' } as const; // white / brand-800

const TONE_TEXT = {
  positive: 'text-money-pos dark:text-money-posDark',
  destructive: 'text-money-neg dark:text-money-negDark',
  warm: 'text-warm-600 dark:text-warm-300',
} as const;

type OpenSide = 'start' | 'end' | null;

export const SwipeActionRow: React.FC<SwipeActionRowProps> = ({
  startAction,
  endAction,
  disabled = false,
  className,
  onSwipeStart,
  children,
}) => {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [open, setOpen] = useState<OpenSide>(null);
  const isDark = useMediaQuery('(prefers-color-scheme: dark)') ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  const enabled = !reduceMotion && !disabled && Boolean(startAction || endAction);

  // Function-form transform so the range re-derives from the CURRENT
  // actions/theme every render (the array form captures its output statically).
  const bgColor = useTransform(x, (latest: number) => {
    const theme = isDark ? 'dark' : 'light';
    const base = ROW_BG[theme];
    if (latest > 0 && startAction) return TONE_BG[startAction.tone][theme];
    if (latest < 0 && endAction) return TONE_BG[endAction.tone][theme];
    return base;
  });

  // Icon affordances fade in almost immediately (16px) — the whole point is
  // seeing what will happen before you're committed to it.
  const startOpacity = useTransform(x, [8, 32], [0, 1]);
  const endOpacity = useTransform(x, [-32, -8], [1, 0]);
  // Gentle grow as the swipe approaches commit territory.
  const startScale = useTransform(x, [64, 200], [1, 1.2]);
  const endScale = useTransform(x, [-200, -64], [1.2, 1]);

  // Browsers synthesize a click from the pointer-up that ends a drag; without
  // this stamp that click would instantly close a row that just stuck open.
  const dragEndedAt = useRef(0);

  const settle = (target: number) => {
    animate(x, target, { type: 'spring', stiffness: 500, damping: 40 });
  };

  const close = () => {
    setOpen(null);
    settle(0);
  };

  const fire = (action: SwipeAction) => {
    haptic(action.hapticPattern ?? 'light');
    setOpen(null);
    settle(0);
    action.onAction();
  };

  const commitDistance = () => {
    const width = containerRef.current?.offsetWidth ?? 0;
    return Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    dragEndedAt.current = performance.now();
    // Decide from the row's CURRENT position (not the gesture's offset), so
    // dragging further from a stuck-open state behaves like one long swipe.
    const position = x.get();
    const side: Exclude<OpenSide, null> = position < 0 ? 'end' : 'start';
    const action = side === 'end' ? endAction : startAction;
    const distance = Math.abs(position);

    if (!action || distance < STICK_PX) {
      close();
      return;
    }
    const outwardFlick = side === 'end' ? info.velocity.x < -FLICK_VELOCITY : info.velocity.x > FLICK_VELOCITY;
    if (distance >= commitDistance() || outwardFlick) {
      fire(action);
      return;
    }
    setOpen(side);
    settle(side === 'end' ? -OPEN_PX : OPEN_PX);
  };

  if (!enabled) {
    // Static fallback — actions stay reachable via the row's own controls.
    // A row can be disabled while stuck open (e.g. entering selection mode);
    // clear the leftover offset so re-enabling starts from rest. Motion
    // values live outside React state, so mutating here is safe and cheap.
    if (x.get() !== 0) x.set(0);
    if (open !== null) setOpen(null);
    return <div className={cn('relative', className)}>{children}</div>;
  }

  const renderZone = (side: Exclude<OpenSide, null>, action: SwipeAction) => {
    const Icon = action.icon;
    const isOpen = open === side;
    return (
      <motion.div
        style={{
          opacity: side === 'start' ? startOpacity : endOpacity,
          scale: side === 'start' ? startScale : endScale,
        }}
        className={cn(
          'absolute inset-y-0 flex items-center justify-center',
          side === 'start' ? 'left-0' : 'right-0'
        )}
      >
        <button
          type="button"
          tabIndex={isOpen ? 0 : -1}
          aria-hidden={!isOpen}
          onClick={() => fire(action)}
          className={cn(
            'flex h-full w-[88px] flex-col items-center justify-center gap-1 font-bold',
            TONE_TEXT[action.tone],
            // Only the stuck-open state is a real tap target; during a drag
            // the zone is purely an affordance.
            isOpen ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <Icon size={22} />
          <span className="text-xxs uppercase tracking-wide">{action.label}</span>
        </button>
      </motion.div>
    );
  };

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden', className)}>
      <motion.div className="absolute inset-0 z-0" style={{ backgroundColor: bgColor }}>
        {startAction && renderZone('start', startAction)}
        {endAction && renderZone('end', endAction)}
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: endAction ? -400 : 0, right: startAction ? 400 : 0 }}
        dragElastic={{ left: endAction ? 0 : 0.15, right: startAction ? 0 : 0.15 }}
        dragMomentum={false}
        onDragStart={onSwipeStart}
        onDragEnd={handleDragEnd}
        style={{ x, touchAction: 'pan-y' }}
        // A tap on the row content while stuck open just closes the row —
        // it must never trigger the row's normal tap action. The synthesized
        // click that ends the opening drag itself is ignored (see dragEndedAt).
        onClickCapture={
          open !== null
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (performance.now() - dragEndedAt.current > 400) close();
              }
            : undefined
        }
        className="relative z-10"
      >
        {children}
      </motion.div>
    </div>
  );
};

export default SwipeActionRow;
