import React, { useEffect, useId, useMemo, useRef } from 'react';
import { PartyPopper, Star, Flame } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { DayCompleteSummary } from '@/hooks/useDayCompleteCelebration';

interface DayCompleteCelebrationProps {
  summary: DayCompleteSummary;
  onClose: () => void;
}

/**
 * The end-of-day "day complete" peak-end moment (impeccable r5).
 *
 * A brief, warm, dismissible flourish shown the instant the user finishes their
 * last due daily habit. Consistent with DESIGN.md: warm-paper hero surface,
 * Besley display voice, amber/gold gamification accents — no glass, no gradient
 * text, no side-stripes. Motion is confined to a lightweight CSS confetti burst
 * plus the global `animate-in` entrance; under `prefers-reduced-motion` both are
 * suppressed and the moment simply appears (the guaranteed static alternative).
 *
 * Lazy-loaded (see Habits page) so its chunk stays off the boot path.
 */

// Auto-dismiss so the moment never blocks the tracker for more than a beat; it
// is also dismissible immediately (button, backdrop, Escape).
const AUTO_DISMISS_MS = 5000;

// Confetti pieces tint from the gamification token ramp (amber / gold / streak /
// evergreen / slate-teal) — never raw hex.
const CONFETTI_COLORS = [
  'bg-habit-gold',
  'bg-habit-streak',
  'bg-warm-500',
  'bg-accent-500',
  'bg-habit-blue',
] as const;

const CONFETTI_COUNT = 16;

/**
 * Deterministic pseudo-random in [0,1) from a seed — pure (no `Math.random`,
 * which the React-purity lint bans during render), so the confetti layout is
 * stable across re-renders while still looking scattered.
 */
const seededUnit = (seed: number): number => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

interface ConfettiPiece {
  left: number;
  delay: number;
  duration: number;
  size: number;
  rotate: number;
  color: string;
  round: boolean;
}

const DayCompleteCelebration: React.FC<DayCompleteCelebrationProps> = ({ summary, onClose }) => {
  const titleId = useId();
  const descId = useId();
  const reduceMotion = useReducedMotion();
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  // Hold the latest onClose so the Escape/auto-dismiss effects can stay
  // mount-only (empty deps) without going stale — synced in its own effect
  // (assigning a ref during render is disallowed by the React-purity lint).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape to dismiss (mirrors the dialog primitives).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Auto-dismiss after a beat.
  useEffect(() => {
    const t = window.setTimeout(() => onCloseRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Confetti geometry is computed once per mount. Skipped entirely under reduced
  // motion (the CSS keyframe below isn't covered by the global animate-in guard).
  const confetti = useMemo<ConfettiPiece[]>(() => {
    if (reduceMotion) return [];
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      left: Math.round((i / CONFETTI_COUNT) * 100 + (seededUnit(i + 1) * 8 - 4)),
      delay: Math.round(seededUnit(i + 2) * 400),
      duration: 2600 + Math.round(seededUnit(i + 3) * 1400),
      size: 7 + Math.round(seededUnit(i + 4) * 6),
      rotate: Math.round(seededUnit(i + 5) * 360),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? 'bg-habit-gold',
      round: i % 3 === 0,
    }));
  }, [reduceMotion]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      {/* Backdrop — no blur (DESIGN §4). Tap to dismiss. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-brand-900/60 animate-in fade-in duration-(--duration-base) focus:outline-hidden"
      />

      {/* Confetti burst (motion only) — behind the card, non-interactive. */}
      {!reduceMotion && confetti.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <style>{`
            @keyframes dc-confetti-fall {
              0%   { transform: translateY(-12%) rotate(0deg); opacity: 0; }
              8%   { opacity: 1; }
              100% { transform: translateY(112vh) rotate(600deg); opacity: 0; }
            }
          `}</style>
          {confetti.map((p, i) => (
            <span
              key={i}
              className={`absolute top-0 ${p.color} ${p.round ? 'rounded-full' : 'rounded-[2px]'}`}
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animation: `dc-confetti-fall ${p.duration}ms cubic-bezier(0.3,0.1,0.3,1) ${p.delay}ms both`,
                transform: `rotate(${p.rotate}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {/* Hero card — warm-paper surface, hairline + the one reserved hero shadow. */}
      <div
        ref={containerRef}
        tabIndex={-1}
        className="relative w-full max-w-xs rounded-lg surface-section shadow-raised px-6 py-7 text-center animate-in fade-in zoom-in-95 duration-(--duration-base) ease-(--ease-standard) focus:outline-hidden"
      >
        {/* Amber medallion */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warm-100 text-warm-600 dark:bg-warm-900/30 dark:text-warm-300">
          <PartyPopper size={26} aria-hidden="true" />
        </div>

        <p className="text-xxs font-bold uppercase tracking-wider text-warm-600 dark:text-warm-300">
          Today
        </p>
        <h2
          id={titleId}
          className="mt-1 font-display text-2xl font-semibold tracking-tight text-brand-900 dark:text-brand-50"
        >
          Day complete
        </h2>
        <p id={descId} className="mt-1.5 text-sm text-brand-600 dark:text-brand-300">
          {summary.total === 1
            ? 'Your habit for today is done. Rest easy.'
            : `All ${summary.total} habits for today are done. Rest easy.`}
        </p>

        {/* Points + streak context — quiet stat row, gamification tokens. */}
        <div className="mt-5 flex items-stretch justify-center divide-x divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700">
          <div className="flex flex-col items-center px-5 py-3">
            <span className="flex items-center gap-1 stat-num text-xl font-bold text-habit-gold">
              <Star size={15} className="fill-current" aria-hidden="true" />
              {summary.dailyPoints}
            </span>
            <span className="mt-0.5 text-xxs font-bold uppercase tracking-wider text-brand-400 dark:text-brand-450">
              Points today
            </span>
          </div>
          {summary.topStreak > 0 && (
            <div className="flex flex-col items-center px-5 py-3">
              <span className="flex items-center gap-1 stat-num text-xl font-bold text-habit-streak">
                <Flame size={15} aria-hidden="true" />
                {summary.topStreak}
              </span>
              <span className="mt-0.5 text-xxs font-bold uppercase tracking-wider text-brand-400 dark:text-brand-450">
                Best streak
              </span>
            </div>
          )}
        </div>

        <Button variant="warning" size="md" className="mt-6 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
};

export default DayCompleteCelebration;
