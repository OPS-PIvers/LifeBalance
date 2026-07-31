import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight, Crown, Flame, Check, Lock, Sparkle, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  UNATTRIBUTED_SERIES,
  weekdayNameOf,
  type RecapChartDay,
  type RecapDeck as RecapDeckModel,
} from '@/utils/recapDeck';
import MemberAvatar from '@/components/ui/MemberAvatar';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { RecapMemberFacts, WeeklyRecap } from '@/types/schema';

/**
 * RecapDeck — the weekly ceremony's 4-card story deck (per-member points,
 * stage 5), rendered inside the existing `WeeklyRecapDrawer`.
 *
 * Matches `.claude/mocks/per-member-points/r3-ceremony-1..4.html`: cover →
 * household week (giant Together total + member-stacked 7-day chart) → the
 * VIEWER's personal card → finish (household number anchored, head-to-head
 * demoted to one mono line). The `Household.ceremonyTone` setting reframes it:
 * `podium` leads the week card and the finish anchor with the head-to-head,
 * `household_first` (the default) keeps both about the household, `adaptive`
 * picks per the week's margin.
 *
 * 🛡️ NO FLAME RINGS. Streaks appear here as CONTENT (a stat tile), never as
 * decoration on an avatar — the flame ring is habits-page-only UI (locked
 * decision, handoff §1). Avatars in the deck are always plain.
 *
 * Motion: horizontal drag with prev/next buttons and progress dots as the
 * non-gestural path. Under `prefers-reduced-motion` the slide becomes a
 * crossfade and drag is disabled, so the deck is still fully navigable.
 */

interface RecapDeckProps {
  deck: RecapDeckModel;
  recap: WeeklyRecap;
  /** Household display name for the cover ("The Ivers Household"). */
  householdName: string;
  /** Fired once, the first time the viewer reaches the final card. */
  onComplete?: () => void;
}

/** Distance (px) or velocity past which a drag commits to the next card. */
const SWIPE_DISTANCE = 60;
const SWIPE_VELOCITY = 320;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const CardEyebrow: React.FC<{ children: React.ReactNode; tone?: 'warm' | 'accent' | 'quiet' }> = ({
  children,
  tone = 'warm',
}) => (
  <span
    className={cn(
      'text-[11.5px] font-bold uppercase tracking-[0.2em]',
      tone === 'warm' && 'text-warm-600 dark:text-warm-300',
      tone === 'accent' && 'text-accent-600 dark:text-accent-300',
      tone === 'quiet' && 'text-brand-450 dark:text-brand-400'
    )}
  >
    {children}
  </span>
);

const TrendChip: React.FC<{ pct: number }> = ({ pct }) => {
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-xs font-semibold',
        pct >= 0
          ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/20 dark:border-money-pos/35'
          : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/20 dark:border-money-neg/35'
      )}
    >
      <Icon size={12} aria-hidden="true" />
      {Math.abs(pct)}%
    </span>
  );
};

/** The big serif figure the mocks anchor every card on. */
const HeroNumber: React.FC<{ value: number; unit: string; className?: string }> = ({
  value,
  unit,
  className,
}) => (
  <div className="flex items-baseline gap-2">
    <span
      className={cn(
        'font-display font-semibold leading-none tracking-[-0.03em] text-brand-900 dark:text-brand-50',
        className ?? 'text-[68px]'
      )}
    >
      {value}
    </span>
    <span className="font-display text-lg font-semibold text-warm-600 dark:text-warm-300">{unit}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Card 1 — cover
// ---------------------------------------------------------------------------

const CoverCard: React.FC<{ deck: RecapDeckModel; householdName: string }> = ({ deck, householdName }) => (
  <div className="flex h-full flex-col items-center justify-center px-5 text-center">
    <CardEyebrow tone="quiet">{householdName}</CardEyebrow>
    <div className="mt-5 font-display text-lg font-semibold uppercase tracking-[0.3em] text-warm-600 dark:text-warm-300">
      Week
    </div>
    <div className="font-display text-[104px] font-semibold leading-none tracking-[-0.045em] text-brand-900 dark:text-brand-50">
      {deck.weekNumber ?? '—'}
    </div>
    <div className="mt-2 h-[3px] w-11 rounded-full bg-warm-400" aria-hidden="true" />
    {deck.weekRange && (
      <p className="mt-3 text-sm font-semibold text-brand-500 dark:text-brand-400">{deck.weekRange}</p>
    )}
    {deck.headToHead.standings.length > 0 && (
      <div className="mt-6 flex items-center gap-3">
        {deck.headToHead.standings.map(s => (
          <MemberAvatar key={s.memberId} name={s.name} photoURL={s.photoURL} color={s.color} size={44} />
        ))}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Card 2 — the household week (or, under podium, the head-to-head)
// ---------------------------------------------------------------------------

const DayColumn: React.FC<{ day: RecapChartDay }> = ({ day }) => (
  <div className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
    <div className="relative flex w-full flex-col justify-end gap-[2px]" style={{ height: `${day.heightPct}%` }}>
      {day.best && (
        <Sparkle
          size={12}
          className="absolute -top-4 left-1/2 -translate-x-1/2 text-habit-gold"
          aria-hidden="true"
        />
      )}
      {day.segments.map(segment => (
        <div
          key={segment.key}
          className="w-full rounded-[5px]"
          style={{
            height: `${segment.pct}%`,
            backgroundColor: segment.color,
            // Quiet days keep the member's hue but drop to a ghost weight, so
            // a slow day still reads as "that person", just faintly.
            opacity: day.quiet ? 0.35 : 1,
          }}
        />
      ))}
    </div>
    <span
      className={cn(
        'text-[10px] font-semibold',
        day.best ? 'text-warm-600 dark:text-warm-300' : 'text-brand-450 dark:text-brand-400'
      )}
    >
      {day.label}
    </span>
  </div>
);

/**
 * The wording of the household-share line under the chart.
 *
 * TWO independent facts decide it, and conflating them is the whole bug this
 * function exists to prevent:
 *
 *  - the figure's SIGN — a loss must never be phrased as something "earned";
 *  - whether the chart actually DRAWS a Household bar (`hasHouseholdBar`) —
 *    only then does the figure have a visible cause anywhere on the card.
 *
 * All four combinations are reachable (see `WeekCard` for why bar-drawn and
 * figure-sign are independent), so each gets copy that is literally true of
 * what is on screen. The chart itself stays POSITIVE-ONLY by product decision;
 * every fix here is on the labelling side.
 */
function householdShareCopy(points: number, hasHouseholdBar: boolean): string {
  if (points > 0) {
    return hasHouseholdBar
      ? 'earned together, credited to no one member'
      : // A real gain with no bar to sit in. The reason is only provable for
        // the days carrying a POSITIVE contribution — those are exactly what
        // `hasHouseholdBar` looks for, so its being false means every one of
        // them netted <= 0 overall and got no column height. Days carrying a
        // NEGATIVE contribution are clamped out of the chart by
        // `buildRecapChart` regardless of how they netted, and one of those can
        // be the week's tallest column while the total still comes out
        // positive — so this must say "gained on", never "fell on".
        'earned together, credited to no one member — the days it was gained on ended flat or down, so the chart draws no column for them';
  }
  // A LOSS — never "earned". When a Household bar IS drawn (a mixed-sign week
  // whose positive days show while its bigger negative days don't), the figure
  // already has a visible cause, and claiming "this loss is not in it" would be
  // wrong about the part that IS drawn — so say nothing about the chart there.
  return hasHouseholdBar
    ? 'points, credited to no one member'
    : 'points, credited to no one member — the chart only draws points gained, so this loss is not in it';
}

const WeekCard: React.FC<{ deck: RecapDeckModel }> = ({ deck }) => {
  const { headToHead: h2h, framing } = deck;
  const podium = framing === 'podium' && h2h.leader && h2h.runnerUp;
  const legend = h2h.standings.filter(s => s.points !== 0);
  // Does the chart actually DRAW a Household bar? Segment EXISTENCE is not the
  // same question: a segment exists when `day.unattributed > 0`, while the
  // column has height only when `day.total > 0` — two independent figures. A
  // day where the members net deeply negative while a household-credit habit
  // scores puts a household segment on a ZERO-HEIGHT column, so gating on
  // existence alone paints a legend swatch and claims points "earned together"
  // beside zero drawn pixels. Both conditions, always.
  const hasHouseholdBar = deck.chart.some(
    d => d.heightPct > 0 && d.segments.some(s => s.key === UNATTRIBUTED_SERIES)
  );

  return (
    <div className="flex h-full flex-col justify-center px-5">
      {podium && h2h.leader ? (
        <>
          <CardEyebrow>{h2h.runaway ? 'Ran away with the week' : 'Won the week'}</CardEyebrow>
          <div className="mt-1 flex items-center gap-2.5">
            <MemberAvatar name={h2h.leader.name} photoURL={h2h.leader.photoURL} color={h2h.leader.color} size={34} />
            <span className="font-display text-[28px] font-semibold leading-none tracking-tight text-brand-900 dark:text-brand-50">
              {h2h.leader.name}
            </span>
            <Crown size={18} className="text-habit-gold" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
            <span className="stat-num font-semibold text-brand-700 dark:text-brand-200">
              {h2h.leader.points}
            </span>{' '}
            to {h2h.runnerUp?.name}&apos;s{' '}
            <span className="stat-num font-semibold text-brand-700 dark:text-brand-200">
              {h2h.runnerUp?.points}
            </span>{' '}
            · {deck.totalPoints} together
          </p>
        </>
      ) : (
        <>
          <CardEyebrow>Together you scored</CardEyebrow>
          <HeroNumber value={deck.totalPoints} unit="pts" />
          <div className="mt-1 flex items-center gap-2 text-sm text-brand-500 dark:text-brand-400">
            {deck.trendPct !== null && deck.trendPct !== 0 && <TrendChip pct={deck.trendPct} />}
            <span>{deck.trendPct === null ? 'first week on record' : 'vs last week'}</span>
          </div>
        </>
      )}

      <div className="mt-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-450 dark:text-brand-400">
          Points by day
        </span>
        <div className="mt-2.5 flex h-[110px] items-end gap-2.5">
          {deck.chart.map(day => (
            <DayColumn key={day.date} day={day} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-brand-500 dark:text-brand-400">
          {legend.map(s => (
            <span key={s.memberId} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: s.color }}
                aria-hidden="true"
              />
              {s.name}
            </span>
          ))}
          {hasHouseholdBar && (
            // Label only — deliberately NO figure here. `buildRecapChart`
            // clamps every segment to its positive share (`Math.max(0, ...)`,
            // `points > 0`), so a week with a net-negative unattributed total
            // draws no household segment at all while the swatch's number
            // would still show the signed total — a legend that contradicts
            // its own chart. The member legend entries above carry no figure
            // either (just `{s.name}`), so this stays consistent with them:
            // the legend is a series LABEL, not a second place to read the
            // number. The signed total lives on `householdShare` below,
            // where no chart sits beside it to disagree with.
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-[2px] bg-brand-300" aria-hidden="true" />
              Household
            </span>
          )}
        </div>
        {deck.bestDay && (
          <p className="mt-2.5 text-[11.5px] text-brand-450 dark:text-brand-400">
            <b className="font-semibold text-brand-600 dark:text-brand-200">
              {weekdayNameOf(deck.bestDay.date)}
            </b>{' '}
            was your best day together · {deck.bestDay.total} pts
          </p>
        )}
        {/* The household's OWN (signed) share of the week — `unattributed`
            summed across all 7 days, which can legitimately be negative (a
            penalty habit that credits the household). It lives here rather
            than on the legend above because nothing here draws a bar beside
            it, so it can't contradict the chart's positive-only segments the
            way a figure on the swatch would.

            The wording is `householdShareCopy`'s job, because the figure and
            the chart can disagree in BOTH directions and one sentence cannot
            honestly cover both: a negative share can sit beside seven
            full-height columns (the members carried the week, the household's
            own loss simply isn't a segment), and a positive share can sit
            beside none at all (every day it was GAINED on netted <= 0, so none
            of those got column height). Never claim "only positive days are
            shown" — in the first case every day IS shown; and never widen the
            second reason past the days it was gained on — a day carrying a
            negative contribution is clamped out of the chart no matter how
            tall its column is. */}
        {deck.householdSharePoints !== 0 && (
          <p className="mt-1.5 text-[11.5px] text-brand-450 dark:text-brand-400" data-testid="recap-household-share">
            <b className="font-semibold text-brand-600 dark:text-brand-200">{deck.householdSharePoints}</b>{' '}
            {householdShareCopy(deck.householdSharePoints, hasHouseholdBar)}
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 3 — the viewer's own week
// ---------------------------------------------------------------------------

const StatTile: React.FC<{
  icon: React.ReactNode;
  value: string;
  label: string;
  detail?: string;
}> = ({ icon, value, label, detail }) => (
  <div className="flex-1 rounded-card border border-brand-200 bg-white p-3.5 dark:border-brand-700 dark:bg-brand-800">
    <div className="flex items-center gap-2 font-display text-[30px] font-semibold leading-none tracking-tight text-brand-900 dark:text-brand-50">
      {icon}
      {value}
    </div>
    <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-450 dark:text-brand-400">
      {label}
    </div>
    {detail && <div className="mt-0.5 truncate text-[11px] text-brand-500 dark:text-brand-400">{detail}</div>}
  </div>
);

const PersonalCard: React.FC<{ deck: RecapDeckModel; facts: RecapMemberFacts }> = ({ deck, facts }) => {
  // `deck.viewerStanding` is resolved for whoever `deck.viewer` is, including
  // a managed kid (who never appears in the adults-only `headToHead.standings`)
  // — always present here since this card only renders when `deck.viewer` is
  // set (see the `body` switch below), but guarded rather than asserted.
  const standing = deck.viewerStanding;
  if (!standing) return null;
  const perfect = facts.perfectHabits[0];
  const streak = facts.topStreak;

  return (
    <div className="flex h-full flex-col justify-center px-5">
      <div className="flex items-center gap-2.5">
        <MemberAvatar name={standing.name} photoURL={standing.photoURL} color={standing.color} size={34} />
        <CardEyebrow tone="accent">Your week, {facts.name}</CardEyebrow>
      </div>
      <div className="mt-2">
        <HeroNumber value={facts.points} unit="pts" />
      </div>
      <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
        <b className="font-semibold text-brand-700 dark:text-brand-200">
          {facts.completions} completion{facts.completions === 1 ? '' : 's'}
        </b>
        {facts.bestDay && ` · best on ${weekdayNameOf(facts.bestDay.date)}`}
      </p>

      <div className="mt-5 flex gap-2.5">
        <StatTile
          icon={<Flame size={20} className="text-habit-streak" aria-hidden="true" />}
          value={streak ? String(streak.days) : '0'}
          label={streak?.period === 'weekly' ? 'Week streak' : 'Day streak'}
          detail={streak?.habitTitle ?? 'No streak yet'}
        />
        <StatTile
          icon={<Check size={19} className="text-accent-600 dark:text-accent-300" aria-hidden="true" />}
          value={perfect ? '7/7' : String(facts.perfectHabits.length)}
          label="Every day"
          detail={perfect ?? 'Nothing perfect this week'}
        />
      </div>

      {(perfect || streak) && (
        <p className="mt-5 text-[13px] text-brand-500 dark:text-brand-400">
          {perfect ? (
            <>
              <b className="font-semibold text-brand-700 dark:text-brand-200">{perfect}</b> carried the week ·
              every single day
            </>
          ) : (
            streak && (
              <>
                <b className="font-semibold text-brand-700 dark:text-brand-200">{streak.habitTitle}</b> is your
                longest run · {streak.days} {streak.period === 'weekly' ? 'week' : 'day'}
                {streak.days === 1 ? '' : 's'}
              </>
            )
          )}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 4 — finish
// ---------------------------------------------------------------------------

const FinishCard: React.FC<{ deck: RecapDeckModel; recap: WeeklyRecap }> = ({ deck, recap }) => {
  const { headToHead: h2h } = deck;
  const podium = deck.framing === 'podium' && h2h.leader;

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 text-center">
      <CardEyebrow>Week {deck.weekNumber ?? ''} · Final</CardEyebrow>
      {h2h.standings.length > 0 && (
        <div className="mt-3.5 flex items-center gap-3">
          {h2h.standings.map(s => (
            <MemberAvatar key={s.memberId} name={s.name} photoURL={s.photoURL} color={s.color} size={38} />
          ))}
        </div>
      )}

      <div className="mt-4">
        {podium && h2h.leader ? (
          <>
            <HeroNumber value={h2h.leader.points} unit="pts" className="text-[76px]" />
            <p className="mt-1 text-sm font-semibold text-brand-500 dark:text-brand-400">
              {h2h.leader.name} takes the week · {deck.totalPoints} together
            </p>
          </>
        ) : (
          <HeroNumber value={deck.totalPoints} unit="pts" className="text-[76px]" />
        )}
      </div>

      {(deck.isBestWeekThisMonth || deck.trendPct !== null) && (
        <div className="mt-5 flex w-full items-center justify-center gap-3 rounded-card bg-accent-600 px-4 py-3 text-[15px] font-semibold text-white shadow-raised">
          <span>{deck.isBestWeekThisMonth ? 'Best week this month' : 'Week complete'}</span>
          {deck.trendPct !== null && deck.trendPct !== 0 && (
            <>
              <span className="h-4 w-px bg-white/25" aria-hidden="true" />
              <span className="inline-flex items-center gap-1 text-money-posDark">
                {deck.trendPct >= 0 ? (
                  <TrendingUp size={14} aria-hidden="true" />
                ) : (
                  <TrendingDown size={14} aria-hidden="true" />
                )}
                {Math.abs(deck.trendPct)}%
              </span>
            </>
          )}
        </div>
      )}

      {h2h.standings.length > 1 && (
        <p className="mt-5 flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-brand-500 dark:text-brand-400">
          {h2h.leader && <Crown size={13} className="text-habit-gold" aria-hidden="true" />}
          {h2h.standings.map((s, i) => (
            <React.Fragment key={s.memberId}>
              {i > 0 && (
                <span className="px-0.5 text-brand-400" aria-hidden="true">
                  ·
                </span>
              )}
              <span>
                {s.name} {s.points}
              </span>
            </React.Fragment>
          ))}
        </p>
      )}

      {/* The narrative — premium-gated exactly as the pre-deck layout gated it. */}
      <div className="mt-5 w-full">
        {recap.premium ? (
          <p className="text-[13px] leading-relaxed text-brand-600 dark:text-brand-300">{recap.narrative}</p>
        ) : (
          <div>
            <p
              className="text-[13px] leading-relaxed text-brand-600 dark:text-brand-300 blur-sm select-none"
              aria-hidden="true"
            >
              {recap.narrative || 'Your personalized weekly summary is ready to read.'}
            </p>
            <span className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-warm-700 dark:text-warm-300">
              <Lock size={13} aria-hidden="true" />
              Unlock your personal recap with Premium
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The deck shell
// ---------------------------------------------------------------------------

export const RecapDeck: React.FC<RecapDeckProps> = ({ deck, recap, householdName, onComplete }) => {
  const reduceMotion = useReducedMotion();
  // Position and travel direction move together: the slide's sign is READ
  // during render, so it has to be state (a ref read in render is both a lint
  // error and a genuine staleness hazard — the sign would lag a frame).
  const [{ index, direction }, setPosition] = useState({ index: 0, direction: 1 });
  const cardRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  // Focus moves to the card only in response to a NAVIGATION, never on mount —
  // stealing focus from the Drawer's own initial target would fight the focus
  // trap and drop screen-reader users into the middle of the sheet.
  const navigatedRef = useRef(false);

  const count = deck.cards.length;
  const card = deck.cards[index];

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(count - 1, next));
      if (clamped === index) return;
      navigatedRef.current = true;
      setPosition({ index: clamped, direction: clamped > index ? 1 : -1 });
    },
    [count, index]
  );

  useEffect(() => {
    if (!navigatedRef.current) return;
    cardRef.current?.focus();
  }, [index]);

  useEffect(() => {
    if (index !== count - 1 || completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [index, count, onComplete]);

  const handleDragEnd = useCallback(
    (_event: unknown, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.x < -SWIPE_DISTANCE || velocity.x < -SWIPE_VELOCITY) go(index + 1);
      else if (offset.x > SWIPE_DISTANCE || velocity.x > SWIPE_VELOCITY) go(index - 1);
    },
    [go, index]
  );

  const body = useMemo(() => {
    if (!card) return null;
    switch (card.kind) {
      case 'cover':
        return <CoverCard deck={deck} householdName={householdName} />;
      case 'week':
        return <WeekCard deck={deck} />;
      case 'personal':
        return deck.viewer ? <PersonalCard deck={deck} facts={deck.viewer} /> : null;
      case 'finish':
        return <FinishCard deck={deck} recap={recap} />;
      default:
        return null;
    }
  }, [card, deck, householdName, recap]);

  // 🛡️ ENTER-ONLY, NO `AnimatePresence` EXIT. An exit transition would make the
  // NEXT card's mount wait on the previous one's animation finishing — and a
  // stalled rAF (a backgrounded tab, a non-compositing embedded view) then
  // leaves the deck stuck on a card the progress dots say you already left.
  // Re-keying a single motion.div replaces the card immediately and still
  // animates it in; under `prefers-reduced-motion` it is a plain crossfade with
  // no travel at all.
  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, x: direction * 40 },
        animate: { opacity: 1, x: 0 },
      };

  return (
    <div className="-mx-4">
      <div className="relative overflow-hidden rounded-card bg-brand-50 dark:bg-brand-800/60">
        <div className="relative h-[clamp(390px,56vh,520px)]">
          <motion.div
            key={card?.id ?? index}
            ref={cardRef}
            tabIndex={-1}
            role="group"
            aria-roledescription="slide"
            aria-label={`Card ${index + 1} of ${count}`}
            className="absolute inset-0 outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
            drag={reduceMotion ? false : 'x'}
            dragDirectionLock
            dragElastic={0.12}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={reduceMotion ? undefined : handleDragEnd}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            {...slide}
          >
            {body}
          </motion.div>
        </div>
      </div>

      {/* Navigation — buttons and dots, so the deck never depends on a gesture. */}
      <div className="mt-3 flex items-center justify-between gap-3 px-4">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous card"
          className="flex h-11 w-11 items-center justify-center rounded-full text-brand-500 hover:text-brand-800 disabled:opacity-30 dark:text-brand-400 dark:hover:text-brand-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>

        <div className="flex items-center gap-[7px]" aria-hidden="true">
          {deck.cards.map((c, i) => (
            <span
              key={c.id}
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color] duration-(--duration-fast)',
                i === index ? 'w-[18px] bg-accent-600 dark:bg-accent-400' : 'w-1.5 bg-brand-300 dark:bg-brand-600'
              )}
            />
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          Card {index + 1} of {count}
        </span>

        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === count - 1}
          aria-label="Next card"
          className="flex h-11 w-11 items-center justify-center rounded-full text-brand-500 hover:text-brand-800 disabled:opacity-30 dark:text-brand-400 dark:hover:text-brand-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
