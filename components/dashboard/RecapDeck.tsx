import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight, Crown, Lock, Sparkle, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  buildPersonalTiles,
  weekdayNameOf,
  type RecapChartDay,
  type RecapDeck as RecapDeckModel,
  type RecapSpendLine,
} from '@/utils/recapDeck';
import MemberAvatar from '@/components/ui/MemberAvatar';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { RecapMemberFacts, WeeklyRecap } from '@/types/schema';

/**
 * RecapDeck — the weekly ceremony's story deck, rendered inside the existing
 * `WeeklyRecapDrawer`.
 *
 * 🛡️ ONE JOB PER CARD (DECK-1). The first ceremony shipped four cards carrying
 * three ideas. The household total was the hero of card 2 and again of card 4;
 * the head-to-head was a footnote under a figure you had already read; a member
 * with no perfect habit got a tile reading `0` / "Nothing perfect this week"; a
 * day that netted negative drew nothing at all; and MONEY — in a household
 * finance app — was banished to a disclosure BELOW the ceremony. The deck is
 * now cover → money → [head-to-head] → household week → personal →
 * [head-to-head] → finish, each card answering exactly one question, and no
 * figure is the hero twice. Card ORDER and every derived figure live in
 * `utils/recapDeck.ts`; this file only draws them.
 *
 * 🛡️ NO FLAME RINGS. Streaks appear here as CONTENT (a stat tile), never as
 * decoration on an avatar — the flame ring is habits-page-only UI (locked
 * decision). Avatars in the deck are always plain.
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

/**
 * A week-over-week delta chip.
 *
 * 🛡️ POLARITY IS NOT THE SIGN. More POINTS is good; more SPENDING is not. The
 * pre-DECK-1 chip hard-coded "positive ⇒ green", which is right for the points
 * trend and exactly backwards for the money card it now also serves — a 40%
 * jump in day-to-day spending would have been painted as a win.
 */
const TrendChip: React.FC<{ pct: number; polarity?: 'more-is-good' | 'more-is-bad' }> = ({
  pct,
  polarity = 'more-is-good',
}) => {
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  const good = polarity === 'more-is-good' ? pct >= 0 : pct <= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-xs font-semibold',
        good
          ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/20 dark:border-money-pos/35'
          : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/20 dark:border-money-neg/35'
      )}
    >
      <Icon size={12} aria-hidden="true" />
      {Math.abs(pct)}%
    </span>
  );
};

/** The big serif figure the deck anchors a card on. */
const HeroNumber: React.FC<{ value: string; unit: string; className?: string }> = ({
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
// Card 1 — cover · WHICH WEEK IS THIS?
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
// Card 2 — money · WHAT DID THE WEEK COST TO LIVE?
// ---------------------------------------------------------------------------

/**
 * One spend line's week-over-week comparison, in words.
 *
 * Three distinct states, because "no percentage" has two very different causes
 * and neither may be rendered as a confident 0%: the recap can carry no prior
 * figure at all (`prior === null`, an optional field a document may predate),
 * or it can carry a prior of zero, where a percentage is undefined but the
 * comparison is still meaningful and worth saying.
 */
const SpendComparison: React.FC<{
  line: RecapSpendLine;
  format: (amount: number) => string;
  className?: string;
}> = ({ line, format, className }) => {
  if (line.changePct !== null && line.prior !== null) {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
        <TrendChip pct={line.changePct} polarity="more-is-bad" />
        <span className="text-sm text-brand-500 dark:text-brand-400">vs {format(line.prior)} last week</span>
      </div>
    );
  }
  return (
    <p className={cn('text-sm text-brand-500 dark:text-brand-400', className)}>
      {line.prior === null ? 'no prior week to compare' : 'nothing here last week'}
    </p>
  );
};

const MoneyCard: React.FC<{ deck: RecapDeckModel }> = ({ deck }) => {
  const fmt = useFormatCurrency();
  const whole = useCallback((amount: number) => fmt(amount, { decimals: 0 }), [fmt]);
  const { money } = deck;

  // No split on the document — say only what it can support. Deliberately NOT
  // a `$0` of day-to-day spending: the week was never measured that way.
  if (!money.hasSplit || !money.dayToDay || !money.bills) {
    return (
      <div className="flex h-full flex-col justify-center px-5">
        <CardEyebrow tone="accent">The week&apos;s money</CardEyebrow>
        <HeroNumber value={whole(money.total.amount)} unit="spent" className="text-[52px]" />
        <SpendComparison line={money.total} format={whole} className="mt-2" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center px-5">
      <CardEyebrow tone="accent">The week&apos;s money</CardEyebrow>
      {/* 🛡️ DAY-TO-DAY IS THE HERO, never `totalSpend`. A lumpy bill week makes
          the sum swing wildly around spending that never moved — the figure the
          owner called out as a scary number nobody could act on. */}
      <HeroNumber value={whole(money.dayToDay.amount)} unit="day to day" className="text-[52px]" />
      <SpendComparison line={money.dayToDay} format={whole} className="mt-2" />

      <div className="mt-5 rounded-card border border-brand-200 bg-white p-3.5 dark:border-brand-700 dark:bg-brand-800">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-brand-700 dark:text-brand-200">
            Bills the calendar already had
          </span>
          <span className="stat-num shrink-0 text-base font-semibold text-brand-900 dark:text-brand-50">
            {whole(money.bills.amount)}
          </span>
        </div>
        <SpendComparison line={money.bills} format={whole} className="mt-1.5" />
      </div>

      <p className="mt-3 font-mono text-[11.5px] tabular-nums text-brand-450 dark:text-brand-400">
        {whole(money.total.amount)} out the door all in
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 3 — the household week · HOW DID THE HOUSEHOLD SCORE, DAY BY DAY?
// ---------------------------------------------------------------------------

/**
 * One day of the 7-day chart.
 *
 * 🛡️ TWO REGISTERS, ONE BASELINE (DECK-1). The stack ABOVE the baseline is
 * positive-only — the standing product decision, and the right one: a stacked
 * bar cannot honestly show a negative slice. But that used to mean a losing day
 * drew nothing whatsoever, so the real 2026-W31 chart showed six days and a
 * blank. The deficit now gets its own register BELOW a drawn baseline, so
 * "positive-only" no longer means "invisible" — and the stack itself is
 * untouched. `min-h-[3px]` floors the stub so the shallowest loss of a week is
 * still a mark rather than a sub-pixel nothing.
 */
const DayColumn: React.FC<{ day: RecapChartDay; showDeficit: boolean }> = ({ day, showDeficit }) => (
  <div className="flex h-full flex-1 flex-col items-center">
    <div className="flex w-full flex-1 flex-col justify-end">
      <div
        className="relative flex w-full flex-col justify-end gap-[2px]"
        style={{ height: `${day.heightPct}%` }}
      >
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
    </div>

    {showDeficit && (
      <>
        <div className="mt-[3px] h-px w-full bg-brand-200 dark:bg-brand-600" aria-hidden="true" />
        <div className="h-3.5 w-full pt-[2px]">
          {day.negative && (
            <div
              className="min-h-[3px] w-full rounded-b-[4px] bg-money-neg"
              style={{ height: `${day.deficitPct}%` }}
              data-testid={`recap-chart-deficit-${day.date}`}
            />
          )}
        </div>
      </>
    )}

    <span
      className={cn(
        'mt-1.5 text-[10px] font-semibold',
        day.negative
          ? 'text-money-neg dark:text-money-negDark'
          : day.best
            ? 'text-warm-600 dark:text-warm-300'
            : 'text-brand-450 dark:text-brand-400'
      )}
    >
      {day.label}
    </span>
  </div>
);

const WeekCard: React.FC<{ deck: RecapDeckModel }> = ({ deck }) => {
  const legend = deck.headToHead.standings.filter(s => s.points !== 0);
  const showDeficit = deck.worstDay !== null;
  const split = deck.householdSplit;

  return (
    <div className="flex h-full flex-col justify-center px-5">
      {/* 🛡️ THE ONE PLACE the household total is the hero. The tone no longer
          swaps this card's headline for the head-to-head — the head-to-head has
          its own card, and duplicating a figure across two cards is what made
          the four-card deck feel like three. */}
      <CardEyebrow>Together you scored</CardEyebrow>
      <HeroNumber value={String(deck.totalPoints)} unit="pts" />
      <div className="mt-1 flex items-center gap-2 text-sm text-brand-500 dark:text-brand-400">
        {deck.trendPct !== null && deck.trendPct !== 0 && <TrendChip pct={deck.trendPct} />}
        <span>{deck.trendPct === null ? 'first week on record' : 'vs last week'}</span>
      </div>

      <div className="mt-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-450 dark:text-brand-400">
          Points by day
        </span>
        <div className={cn('mt-2.5 flex items-stretch gap-2.5', showDeficit ? 'h-[132px]' : 'h-[110px]')}>
          {deck.chart.map(day => (
            <DayColumn key={day.date} day={day} showDeficit={showDeficit} />
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
          {/* Label only, and gated on a DRAWN bar (`chartHasHouseholdBar`
              couples segment existence to column height — see the model). The
              member entries carry no figure either; the legend names series. */}
          {deck.chartHasHouseholdBar && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-[2px] bg-brand-300" aria-hidden="true" />
              Household
            </span>
          )}
          {showDeficit && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-[2px] bg-money-neg" aria-hidden="true" />
              Below zero
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
        {deck.worstDay && (
          <p className="mt-1.5 text-[11.5px] text-brand-450 dark:text-brand-400" data-testid="recap-worst-day">
            <b className="font-semibold text-money-neg dark:text-money-negDark">
              {weekdayNameOf(deck.worstDay.date)}
            </b>{' '}
            finished below zero · {deck.worstDay.total} pts
          </p>
        )}

        {/* 🛡️ `householdShareCopy` IS DELETED, not extended. It was four
            branches apologising for a signed figure sitting beside a
            positive-only chart, and it existed only because "unattributed" was
            a nameless residual. `unattributedSplit` names it: `householdCredit`
            is points from `creditMode: 'household'` habits, which belong to
            nobody ON PURPOSE. A first-class series gets stated, not excused.
            `unclaimed` stays its own quiet line — never a caveat bolted onto
            the first. Both lines are phrased sign-neutrally, so a household
            that ran a penalty habit reads true without a fifth branch. */}
        {split ? (
          <>
            {split.householdCredit !== 0 && (
              <p
                className="mt-1.5 text-[11.5px] text-brand-450 dark:text-brand-400"
                data-testid="recap-household-credit"
              >
                <b className="font-semibold text-brand-600 dark:text-brand-200">{split.householdCredit}</b> from
                habits the whole household shares
              </p>
            )}
            {split.unclaimed !== 0 && (
              <p
                className="mt-1.5 text-[11.5px] text-brand-450 dark:text-brand-400"
                data-testid="recap-household-unclaimed"
              >
                <b className="font-semibold text-brand-600 dark:text-brand-200">{split.unclaimed}</b> we
                couldn&apos;t trace back to a person
              </p>
            )}
          </>
        ) : (
          // No split on the document — state the figure plainly. NEVER render
          // it as "0 household credit"; the week simply never measured why.
          deck.householdSharePoints !== 0 && (
            <p
              className="mt-1.5 text-[11.5px] text-brand-450 dark:text-brand-400"
              data-testid="recap-household-share"
            >
              <b className="font-semibold text-brand-600 dark:text-brand-200">{deck.householdSharePoints}</b>{' '}
              credited to no one member
            </p>
          )
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 4 — the viewer's own week · HOW DID YOU DO?
// ---------------------------------------------------------------------------

const StatTile: React.FC<{ value: string; label: string; detail: string }> = ({ value, label, detail }) => (
  <div className="flex-1 rounded-card border border-brand-200 bg-white p-3.5 dark:border-brand-700 dark:bg-brand-800">
    <div className="font-display text-[30px] font-semibold leading-none tracking-tight text-brand-900 dark:text-brand-50">
      {value}
    </div>
    <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-450 dark:text-brand-400">
      {label}
    </div>
    <div className="mt-0.5 truncate text-[11px] text-brand-500 dark:text-brand-400">{detail}</div>
  </div>
);

const PersonalCard: React.FC<{ deck: RecapDeckModel; facts: RecapMemberFacts }> = ({ deck, facts }) => {
  // `deck.viewerStanding` is resolved for whoever `deck.viewer` is, including
  // a managed kid (who never appears in the adults-only `headToHead.standings`)
  // — always present here since this card only renders when `deck.viewer` is
  // set (see the `body` switch below), but guarded rather than asserted.
  const standing = deck.viewerStanding;
  // 🛡️ TILES ARE DRAWN FROM WHAT HAPPENED, and a candidate that would render
  // zero never becomes a tile (`buildPersonalTiles`). The shipped deck showed
  // the owner a tile reading `0` / "Every day" / "Nothing perfect this week" —
  // an absence formatted as a statistic. Hooks stay above the early return.
  const tiles = useMemo(() => buildPersonalTiles(facts), [facts]);
  if (!standing) return null;
  // 🛡️ ONE GATE, shared with `buildPersonalTiles`. A zero-day `topStreak` is
  // not a streak: guarding the prose below on the object's mere PRESENCE while
  // the tile guards on `days > 0` let the two surfaces disagree, and the card
  // would announce "Morning walk is your longest run · 0 days" beside a tile
  // row that had (correctly) dropped it — the same zero-as-a-statistic this
  // rebuild exists to remove. Normalise once, here.
  const streak = facts.topStreak && facts.topStreak.days > 0 ? facts.topStreak : null;
  const perfect = facts.perfectHabits[0];

  return (
    <div className="flex h-full flex-col justify-center px-5">
      <div className="flex items-center gap-2.5">
        <MemberAvatar name={standing.name} photoURL={standing.photoURL} color={standing.color} size={34} />
        <CardEyebrow tone="accent">Your week, {facts.name}</CardEyebrow>
      </div>
      <div className="mt-2">
        <HeroNumber value={String(facts.points)} unit="pts" />
      </div>
      <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
        <b className="font-semibold text-brand-700 dark:text-brand-200">
          {facts.completions} completion{facts.completions === 1 ? '' : 's'}
        </b>
        {facts.bestDay && ` · best on ${weekdayNameOf(facts.bestDay.date)}`}
      </p>

      {tiles.length > 0 ? (
        <div className="mt-5 flex gap-2.5">
          {tiles.map(tile => (
            <StatTile key={tile.id} value={tile.value} label={tile.label} detail={tile.detail} />
          ))}
        </div>
      ) : (
        // Nothing qualified — say so in a sentence rather than padding the card
        // with two zeroes. True, short, and not a scoreboard of an absence.
        <p className="mt-5 text-[13px] text-brand-500 dark:text-brand-400" data-testid="recap-quiet-week">
          A quiet week under your name — nothing logged, no streak running.
        </p>
      )}

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
// Card 5 — the head-to-head · HOW DID IT SPLIT BETWEEN THE ADULTS?
// ---------------------------------------------------------------------------

/**
 * 🛡️ ADULTS ONLY. `deck.headToHead.standings` is already filtered by
 * `!isManaged` in `buildHeadToHead`, matching `selectAdultStandings` — a
 * chore-heavy kid week must never crown the kid. The kid still gets their own
 * personal card; this one is a competition and their points are an allowance
 * ledger.
 *
 * The tone chooses the FRAME, and `buildRecapDeck` has already chosen this
 * card's POSITION from the same verdict: `podium` (and `adaptive` on a runaway)
 * crowns and sits ahead of the household week; `household_first` reports the
 * split flat, behind the personal card.
 */
const StandingsCard: React.FC<{ deck: RecapDeckModel }> = ({ deck }) => {
  const { headToHead: h2h } = deck;
  const podium = deck.framing === 'podium' && h2h.leader && h2h.runnerUp;
  // Bars are shares of the largest ABSOLUTE score, so a net-negative week still
  // draws proportionate bars instead of collapsing every one of them to zero.
  const scale = Math.max(1, ...h2h.standings.map(s => Math.abs(s.points)));

  return (
    <div className="flex h-full flex-col justify-center px-5">
      {podium && h2h.leader ? (
        <>
          <CardEyebrow>{h2h.runaway ? 'Ran away with the week' : 'Won the week'}</CardEyebrow>
          <div className="mt-1.5 flex items-center gap-2.5">
            <MemberAvatar
              name={h2h.leader.name}
              photoURL={h2h.leader.photoURL}
              color={h2h.leader.color}
              size={34}
            />
            <span className="font-display text-[28px] font-semibold leading-none tracking-tight text-brand-900 dark:text-brand-50">
              {h2h.leader.name}
            </span>
            <Crown size={18} className="text-habit-gold" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
            {h2h.margin} clear of {h2h.runnerUp?.name}
          </p>
        </>
      ) : (
        <>
          <CardEyebrow tone="quiet">How the week split</CardEyebrow>
          <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
            Everyone&apos;s own score, chores included.
          </p>
        </>
      )}

      <ul className="mt-5 space-y-3">
        {h2h.standings.map(s => (
          <li key={s.memberId} className="flex items-center gap-2.5">
            <MemberAvatar name={s.name} photoURL={s.photoURL} color={s.color} size={26} />
            <span className="w-[68px] shrink-0 truncate text-[13px] font-semibold text-brand-700 dark:text-brand-200">
              {s.name}
            </span>
            <span
              className="h-2 flex-1 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-700"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(Math.abs(s.points) / scale) * 100}%`,
                  backgroundColor: s.color,
                }}
              />
            </span>
            <span
              className={cn(
                'stat-num w-[52px] shrink-0 text-right text-sm font-semibold',
                s.points < 0
                  ? 'text-money-neg dark:text-money-negDark'
                  : 'text-brand-900 dark:text-brand-50'
              )}
            >
              {s.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 6 — finish · WHAT DOES IT ADD UP TO?
// ---------------------------------------------------------------------------

/**
 * 🛡️ A PAYOFF, NOT A REPEAT. The shipped finish card re-anchored the household
 * total that card 2 had already made its hero — 28 pts, twice, in a four-card
 * deck. This card carries only things the deck has not said yet: the week's
 * verdict, the count of things actually done, the narrative, and what to carry
 * into next week. The standings live on their own card and are not echoed here.
 *
 * 🛡️ THREE NARRATIVE STATES, NOT TWO (ARCH-1). `premium` gates the UPSELL; it
 * does not decide whether prose exists. A client-derived recap has real numbers
 * and no narrative — it must render neither the prose nor a paywall for
 * content that was never written. `deck.hasNarrative` is checked FIRST, so the
 * absent state is unreachable from the not-premium branch.
 */
const FinishCard: React.FC<{ deck: RecapDeckModel; recap: WeeklyRecap }> = ({ deck, recap }) => {
  const { headToHead: h2h } = deck;
  const podium = deck.framing === 'podium' && h2h.leader;
  const weekLabel = deck.weekNumber !== null ? `Week ${deck.weekNumber}` : 'the week';
  const verdict = deck.isBestWeekThisMonth
    ? 'Best week this month'
    : podium && h2h.leader
      ? `${h2h.leader.name} takes ${weekLabel}`
      : `That's a wrap on ${weekLabel}`;
  const carry = recap.streaksAtRisk.slice(0, 3);

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 text-center">
      <CardEyebrow>{deck.weekNumber !== null ? `Week ${deck.weekNumber} · Final` : 'Final'}</CardEyebrow>
      {h2h.standings.length > 0 && (
        <div className="mt-3.5 flex items-center gap-3">
          {h2h.standings.map(s => (
            <MemberAvatar key={s.memberId} name={s.name} photoURL={s.photoURL} color={s.color} size={38} />
          ))}
        </div>
      )}

      <p className="mt-4 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-brand-900 dark:text-brand-50">
        {verdict}
      </p>
      {recap.habitCompletions > 0 && (
        <p className="mt-1.5 text-sm text-brand-500 dark:text-brand-400">
          <b className="font-semibold text-brand-700 dark:text-brand-200">{recap.habitCompletions}</b> things
          done, together
        </p>
      )}

      {/* State 1/2 only. State 3 (no narrative) renders nothing here at all —
          no prose, no upsell, and no filler standing in for either. */}
      {deck.hasNarrative && (
        <div className="mt-5 w-full">
          {recap.premium ? (
            <p className="text-[13px] leading-relaxed text-brand-600 dark:text-brand-300">{recap.narrative}</p>
          ) : (
            <div>
              <p
                className="text-[13px] leading-relaxed text-brand-600 dark:text-brand-300 blur-sm select-none"
                aria-hidden="true"
              >
                {recap.narrative}
              </p>
              <span className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-warm-700 dark:text-warm-300">
                <Lock size={13} aria-hidden="true" />
                Unlock your personal recap with Premium
              </span>
            </div>
          )}
        </div>
      )}

      {carry.length > 0 && (
        <div className="mt-5 w-full" data-testid="recap-carry-forward">
          <CardEyebrow tone="quiet">Carry into next week</CardEyebrow>
          <ul className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {carry.map(s => (
              <li
                key={s.habitTitle}
                className="inline-flex items-center gap-1 rounded-full border border-warm-200 bg-warm-50 px-2.5 py-1 text-xs font-semibold text-warm-700 dark:border-warm-700/50 dark:bg-warm-500/10 dark:text-warm-300"
              >
                {s.habitTitle}
                <span className="font-mono tabular-nums text-warm-600 dark:text-warm-400">
                  {s.streakDays}d
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      case 'money':
        return <MoneyCard deck={deck} />;
      case 'week':
        return <WeekCard deck={deck} />;
      case 'personal':
        return deck.viewer ? <PersonalCard deck={deck} facts={deck.viewer} /> : null;
      case 'standings':
        return <StandingsCard deck={deck} />;
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
