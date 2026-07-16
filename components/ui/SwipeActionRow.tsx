import React, { useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { haptic, type HapticPattern } from '@/utils/haptics';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTheme } from '@/contexts/ThemeContext';
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
 *    flick) → the PRIMARY action (first in the side's array) fires.
 * 3. Release in the middle zone → the row snaps open, leaving the side's
 *    actions as real tappable buttons (like Apple Mail: the primary sits at
 *    the outer edge, secondaries inline toward the content); tapping one
 *    fires it, tapping the row content (or dragging back) closes the row
 *    without acting.
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
  /**
   * Accessible name when the visible label alone lacks context — e.g.
   * "Delete Make your bed" instead of "Delete", since the stuck-open button
   * is announced before the row content it acts on.
   */
  ariaLabel?: string;
  /** Visual tone: background tint + icon/label color. */
  tone: 'positive' | 'destructive' | 'warm';
  /** Fired on commit-swipe or on tapping the stuck-open button. */
  onAction: () => void;
  /** Haptic fired alongside the action. Default 'light'. */
  hapticPattern?: HapticPattern;
}

interface SwipeActionRowProps {
  /**
   * Actions revealed under the LEFT edge when swiping right. The FIRST entry
   * is the primary (commits on a full swipe, rendered at the outer edge);
   * the rest are secondaries, tappable only from the stuck-open state.
   */
  startActions?: SwipeAction[];
  /** Actions revealed under the RIGHT edge when swiping left. Same order rules. */
  endActions?: SwipeAction[];
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

/** Width (px) of one revealed button; a stuck-open row rests at count × this. */
const OPEN_PX = 88;
/** Breathing room the commit distance keeps beyond the stuck-open width. */
const COMMIT_BEYOND_OPEN_PX = 48;
/** Minimum travel (px) for a release to stick open instead of snapping shut. */
const STICK_PX = 32;
/** Outward fling speed (px/s) that commits from anywhere past STICK_PX. */
const FLICK_VELOCITY = 800;
/**
 * Commit distance = this fraction of the row width, clamped to
 * [COMMIT_MIN_PX, COMMIT_MAX_PX]. The max keeps the commit reachable inside
 * DRAG_LIMIT_PX on wide rows (tablet/desktop) — and a ~320px drag is already
 * plenty deliberate with a mouse.
 */
const COMMIT_FRACTION = 0.55;
const COMMIT_MIN_PX = 160;
const COMMIT_MAX_PX = 320;
/** Hard cap on row travel. Must exceed COMMIT_MAX_PX or commits become unreachable. */
const DRAG_LIMIT_PX = 400;

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
  startActions,
  endActions,
  disabled = false,
  className,
  onSwipeStart,
  children,
}) => {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [open, setOpen] = useState<OpenSide>(null);
  // The app's theme is class-driven (ThemeContext resolves 'system' and stamps
  // `.dark`). Deriving from the OS media query instead would desync the
  // JS-painted rail backgrounds from the Tailwind `dark:` label tokens when
  // the OS scheme and the chosen app theme differ (dark rail + light-theme
  // labels fails AA).
  const isDark = useTheme().resolvedTheme === 'dark';

  const hasStart = Boolean(startActions?.length);
  const hasEnd = Boolean(endActions?.length);
  const enabled = !reduceMotion && !disabled && (hasStart || hasEnd);

  // Function-form transform so the range re-derives from the CURRENT
  // actions/theme every render (the array form captures its output statically).
  // The zone tint follows the side's PRIMARY action.
  const bgColor = useTransform(x, (latest: number) => {
    const theme = isDark ? 'dark' : 'light';
    const base = ROW_BG[theme];
    if (latest > 0 && startActions?.[0]) return TONE_BG[startActions[0].tone][theme];
    if (latest < 0 && endActions?.[0]) return TONE_BG[endActions[0].tone][theme];
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

  const openWidth = (side: Exclude<OpenSide, null>) =>
    OPEN_PX * ((side === 'end' ? endActions : startActions)?.length ?? 0);

  const commitDistance = (side: Exclude<OpenSide, null>) => {
    const width = containerRef.current?.offsetWidth ?? 0;
    const clamped = Math.min(COMMIT_MAX_PX, Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION));
    // Never let the commit point sit inside (or right at) the stuck-open rest
    // position — a multi-button side is wider than a single-button one.
    return Math.max(clamped, openWidth(side) + COMMIT_BEYOND_OPEN_PX);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    dragEndedAt.current = performance.now();
    // Decide from the row's CURRENT position (not the gesture's offset), so
    // dragging further from a stuck-open state behaves like one long swipe.
    const position = x.get();
    const side: Exclude<OpenSide, null> = position < 0 ? 'end' : 'start';
    const primary = (side === 'end' ? endActions : startActions)?.[0];
    const distance = Math.abs(position);

    if (!primary || distance < STICK_PX) {
      close();
      return;
    }
    const outwardFlick = side === 'end' ? info.velocity.x < -FLICK_VELOCITY : info.velocity.x > FLICK_VELOCITY;
    if (distance >= commitDistance(side) || outwardFlick) {
      fire(primary);
      return;
    }
    setOpen(side);
    settle(side === 'end' ? -openWidth('end') : openWidth('start'));
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

  const renderZone = (side: Exclude<OpenSide, null>, actions: SwipeAction[]) => {
    const isOpen = open === side;
    // Apple Mail order: the primary sits at the OUTER edge (so a full swipe
    // reads as "the edge button expanding"), secondaries inline toward the
    // content. actions[0] is primary, so the end side reverses render order.
    const ordered = side === 'end' ? [...actions].reverse() : actions;
    return (
      <motion.div
        style={{ opacity: side === 'start' ? startOpacity : endOpacity }}
        className={cn(
          'absolute inset-y-0 flex items-stretch',
          side === 'start' ? 'left-0' : 'right-0'
        )}
      >
        {ordered.map((action, index) => {
          const Icon = action.icon;
          const isPrimary = action === actions[0];
          return (
            <motion.button
              key={`${action.label}-${index}`}
              type="button"
              tabIndex={isOpen ? 0 : -1}
              aria-hidden={!isOpen}
              aria-label={action.ariaLabel}
              onClick={() => fire(action)}
              // Only the primary grows toward the commit point — it's the one
              // a continued swipe will fire.
              style={isPrimary ? { scale: side === 'start' ? startScale : endScale } : undefined}
              className={cn(
                'flex w-[88px] flex-col items-center justify-center gap-1 font-bold',
                TONE_TEXT[action.tone],
                // Only the stuck-open state is a real tap target; during a
                // drag the zone is purely an affordance.
                isOpen ? 'pointer-events-auto' : 'pointer-events-none'
              )}
            >
              <Icon size={22} />
              <span className="text-xxs uppercase tracking-wide">{action.label}</span>
            </motion.button>
          );
        })}
      </motion.div>
    );
  };

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden', className)}>
      <motion.div className="absolute inset-0 z-0" style={{ backgroundColor: bgColor }}>
        {startActions?.length ? renderZone('start', startActions) : null}
        {endActions?.length ? renderZone('end', endActions) : null}
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: hasEnd ? -DRAG_LIMIT_PX : 0, right: hasStart ? DRAG_LIMIT_PX : 0 }}
        dragElastic={{ left: hasEnd ? 0 : 0.15, right: hasStart ? 0 : 0.15 }}
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
