import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Crown, Gift, TrendingDown, TrendingUp, X } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Drawer } from '@/components/ui/Drawer';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { getAdultStandings, computePointsTrend, type PointsDrawerPeriod } from '@/utils/pointsDrawer';
import { calculateHouseholdShareForDateRange } from '@/utils/scoreboardWidget';
import { fetchSubmissionTotals, submissionCacheKey } from '@/utils/habitSubmissionTotals';
import type { SubmissionTotalsByHabitDate } from '@/utils/habitLogic';
import { buildMemberPointsLedger, buildSharedPointsLedger } from '@/utils/pointsLedger';
import PointsLedgerList, { SHARED_ROW_ID } from '@/components/habits/PointsLedgerList';

interface PointsBreakdownDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Points Breakdown drawer (PER_MEMBER_POINTS_HANDOFF.md §4, PR3) — opened by
 * tapping the TopToolbar points cluster (retargeted from the old direct
 * Rewards deep-link; Rewards is now one tap deeper via the row at the bottom).
 *
 * Household-first stack, locked: grab handle → title + Day/Week toggle →
 * the household hero row (household badge + "Household" + the total, with the
 * period label and a "vs last week" trend chip — derived from the newest
 * WeeklyRecap — on its subtitle line) → adults-only per-member standings
 * (plain avatars, crown on the sole leader) → Reward pool row (lifetime pool
 * total + the pending-redemption count, absorbed from the header, + a Rewards
 * deep-link).
 *
 * The hero deliberately shares the standings rows' silhouette — [avatar] ·
 * name · ——— · points — so the household, each member and the shared-habits
 * row all line up on one vertical grid. That is also why the row below that
 * reports the household's OWN share is labelled "Shared habits" rather than
 * "Household": with the hero restructured, two rows reading "Household" with
 * the same badge would be indistinguishable at a glance.
 *
 * Reads ONLY the narrow `useGamification`/`useHouseholdCore` slices, and reads
 * `dailyPoints`/`weeklyPoints`/member `points` as-is rather than re-deriving
 * them (that's what those stored figures already exist for). Default export
 * so it can be `React.lazy`-loaded (keeps Drawer/framer-motion off the boot
 * bundle, like every other TopToolbar-triggered drawer).
 *
 * ONE exception to "never re-expands habits in render" (household-points-
 * visibility): the Household row's value — the `unattributed` remainder of
 * `household = Σ members + unattributed` — has no stored counterpart to read
 * as-is, so it's derived via `calculateHouseholdShareForDateRange`
 * (utils/scoreboardWidget.ts) over `habits`, mirroring how the Scoreboard
 * widget derives the same figure for a past week. This is deliberately NOT a
 * subtraction of the displayed household/member totals — see that util's own
 * doc comment.
 */
const PointsBreakdownDrawer: React.FC<PointsBreakdownDrawerProps> = ({ open, onClose }) => {
  const titleId = useId();
  const { dailyPoints, weeklyPoints, totalPoints, habits, getHabitSubmissions } = useGamification();
  const { members, household, recaps } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PointsDrawerPeriod>('week');

  const standings = useMemo(() => getAdultStandings(members, period), [members, period]);
  // Same MemberColorMap habitRowAttribution.ts/recapDeck.ts build — a plain
  // `resolveAvatarColor(avatarColor, uid)` call uid-hashes into a DIFFERENT
  // palette and swaps a member's color against those other surfaces.
  const colors = useMemo(() => buildMemberColorMap(members), [members]);

  const householdTotal = period === 'day' ? dailyPoints : weeklyPoints;

  // The submissions FETCH window — always the current week, for BOTH periods,
  // and therefore deliberately independent of `period`.
  //
  // It used to narrow to today for Day, which meant every Day↔Week tap changed
  // the window, changed `submissionCacheKey`, and sent `householdShare` back to
  // `undefined` until a fresh fetch resolved — unmounting the "Shared habits"
  // row for a frame or two. In a bottom sheet that costs a whole row of height,
  // so the drawer visibly dropped and snapped back on every toggle. The day
  // window (today..today) is a strict SUBSET of the week window, and
  // `calculateHouseholdShareForDateRange` only ever looks totals up for the
  // dates it walks — so one week-wide fetch serves both periods exactly, and a
  // period switch is now a pure synchronous recompute with no refetch at all.
  //
  // Anchored on `getLocalDateString()` (never a bare `new Date()`) so it's
  // deterministic under the same mock the rest of the per-member-points
  // surfaces use in tests. Recomputed every render rather than memoized: it's
  // a plain STRING, so the effect/memo dependency comparisons below behave
  // identically to a memoized one, while a drawer left mounted across a week
  // rollover (this one is kept mounted by `LazyMount`) still picks up the new
  // week instead of pinning the one it first mounted under.
  const shareWindowStart = format(
    startOfWeek(parseISO(getLocalDateString()), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  );

  // Stored submissions covering the Household row's window — see the module
  // doc comment's "ONE exception" above. A submission can OUTLIVE its
  // completion date (a reverted toggle removes the date from
  // `completedDates` but never deletes the submission doc — see
  // `pointsForHabitOnDate`'s doc comment in utils/habitLogic.ts), and without
  // this map `decomposeDayPoints` would collapse that day to 0 while
  // `dailyPoints`/`weeklyPoints` (written by `usePointsSync`'s corrective
  // recompute, which DOES fold submissions in) still counts it — making the
  // Household row structurally disagree with the total it exists to explain.
  // Fetched via the same `fetchSubmissionTotals` helper `usePointsSync` uses.
  //
  // `key` is `submissionCacheKey(habits, shareWindowStart)` — the window PLUS
  // the fingerprint of every tracked habit's `lastUpdated` — rather than just
  // the window, so a habits snapshot that can't have touched a submission (any
  // toggle on a habit without `hasSubmissionTracking`, which is most of them)
  // doesn't re-fetch. `fetchedShareCacheRef` mirrors this same {key, totals}
  // shape but is read (not a dependency) by the effect below purely to gate
  // the fetch — putting the state itself in the dependency array would retry a
  // persistently-failing fetch on every render instead of only on the next
  // real habits/window change.
  //
  // Read at render time by `householdShare` below, rather than eagerly reset
  // with a synchronous setState at the top of the effect (a react-hooks/
  // set-state-in-effect footgun). A `key` mismatch is treated exactly like
  // "not fetched yet" and hides the row (see the `householdShare !== undefined`
  // render guards) — render nothing, never a wrong number. Since the window no
  // longer depends on `period`, that hidden state is reached only by a real
  // habits change or a failed fetch, not by a Day↔Week tap.
  const fetchedShareCacheRef =
    useRef<{ key: string; totals: SubmissionTotalsByHabitDate } | null>(null);
  const [fetchedShare, setFetchedShare] =
    useState<{ key: string; totals: SubmissionTotalsByHabitDate } | undefined>(undefined);

  useEffect(() => {
    const cacheKey = submissionCacheKey(habits, shareWindowStart);
    if (fetchedShareCacheRef.current?.key === cacheKey) return;

    let cancelled = false;
    (async () => {
      try {
        const today = getLocalDateString();
        const totals = await fetchSubmissionTotals(habits, shareWindowStart, today, getHabitSubmissions);
        if (!cancelled) {
          const entry = { key: cacheKey, totals };
          fetchedShareCacheRef.current = entry;
          setFetchedShare(entry);
        }
      } catch {
        // A transient failure leaves the row hidden rather than showing a
        // stale/incomplete figure; the cache isn't updated on failure, so
        // the next habits snapshot or period switch re-fires this effect
        // and retries.
        if (!cancelled) setFetchedShare(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [habits, shareWindowStart, getHabitSubmissions]);

  /**
   * The fetched submissions when they still describe the CURRENT window, else
   * `undefined` — a key mismatch is treated exactly like "not fetched yet" (see
   * `fetchedShare`'s doc comment). Shared by the Household row's figure and by
   * the itemized receipts below, so a row and its own breakdown are always
   * scored against the same map.
   */
  const shareTotals = useMemo(() => {
    const cacheKey = submissionCacheKey(habits, shareWindowStart);
    return fetchedShare && fetchedShare.key === cacheKey ? fetchedShare.totals : undefined;
  }, [habits, shareWindowStart, fetchedShare]);

  // The DISPLAY range narrows to today for Day; the totals map behind it stays
  // the week-wide one fetched above (a superset — see `shareWindowStart`), so
  // switching period re-scores synchronously without dropping the row.
  const householdShare = useMemo(() => {
    if (!shareTotals) return undefined;
    const today = getLocalDateString();
    const start = period === 'day' ? today : shareWindowStart;
    return calculateHouseholdShareForDateRange(habits, start, today, today, shareTotals);
  }, [habits, shareWindowStart, period, shareTotals]);

  // Which row's itemized breakdown is open — a member uid, `SHARED_ROW_ID`, or
  // null. One at a time, matching the Scoreboard widget's disclosure.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  /**
   * The open row's receipt — every habit that moved that row's figure, with the
   * date it was completed on. Scored over the SAME range the row's own number
   * is (today for Day, the Monday-anchored week for Week) so the lines add up to
   * it; see utils/pointsLedger.ts.
   *
   * Chores are itemized because a member's row here reads their stored
   * `points.daily`/`points.weekly`, which carries both their assigned chores and
   * their attributed share (`computeMemberPointsReset`).
   */
  const expandedLedger = useMemo(() => {
    if (!expandedRowId) return null;
    const today = getLocalDateString();
    const start = period === 'day' ? today : shareWindowStart;
    return expandedRowId === SHARED_ROW_ID
      ? buildSharedPointsLedger(habits, start, today, today, shareTotals)
      : buildMemberPointsLedger(habits, expandedRowId, start, today, today, shareTotals);
  }, [expandedRowId, habits, period, shareWindowStart, shareTotals]);

  const periodLabel = period === 'day' ? 'today' : 'this week';

  const trend = useMemo(
    () => (period === 'week' ? computePointsTrend(weeklyPoints, recaps, members) : null),
    [period, weeklyPoints, recaps, members],
  );

  const dateLabel = useMemo(() => {
    const now = new Date();
    if (period === 'day') return `Today · ${format(now, 'MMM d')}`;
    const start = startOfWeek(now, { weekStartsOn: 1 });
    const end = endOfWeek(now, { weekStartsOn: 1 });
    return `This week · ${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
  }, [period]);

  // Plan 080d-2: pending kid-redemption-request count — moved here from the
  // header (this drawer absorbs it wholesale; see the handoff doc's "muscle
  // memory" note). Dormant unless Kid Mode is on and a request is waiting.
  const pendingRedemptionCount = kidModeEnabled ? household?.pendingRedemptions?.length ?? 0 : 0;

  /**
   * Every dismissal path funnels through here (the Drawer's own backdrop/swipe
   * close included), so an open receipt is collapsed on the way out rather than
   * greeting the next open still expanded — this drawer is kept MOUNTED by
   * `LazyMount`, so its state outlives a close.
   */
  const handleClose = () => {
    setExpandedRowId(null);
    onClose();
  };

  const goToRewards = () => {
    handleClose();
    navigate('/habits', { state: { tab: 'rewards' } });
  };

  return (
    <Drawer
      isOpen={open}
      onClose={handleClose}
      ariaLabelledBy={titleId}
      noPadding
      header={
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-brand-200 dark:border-brand-700">
          <h3 id={titleId} className="font-display font-semibold text-lg text-brand-800 dark:text-brand-100">
            Points
          </h3>
          <div className="flex items-center gap-1">
            <SegmentedControl
              name="Points period"
              size="sm"
              className="w-auto"
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
              ]}
              value={period}
              onChange={setPeriod}
            />
            <button
              type="button"
              onClick={handleClose}
              className="p-2.5 min-w-11 min-h-11 flex items-center justify-center text-brand-400 hover:text-brand-600 rounded-full hover:bg-brand-100 dark:text-brand-450 dark:hover:text-brand-200 dark:hover:bg-brand-700"
              aria-label="Close drawer"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5 px-4 pt-4 pb-4">
        {/* The household total — the headline figure (members + the household's
            own share + any unattributed remainder), drawn on the SAME
            [avatar] · name · ——— · points silhouette as the standings rows
            below so all three row types share one vertical grid instead of the
            hero floating on a layout of its own. The numeral stays visibly
            larger than a member's, but it sits in the same right-aligned slot.

            The trend chip rides the SUBTITLE line rather than the row's right
            edge: that edge is the points column now, and anything parked there
            pushes the total out of alignment with the member rows. It also
            belongs with `dateLabel` — it is a statement about the period ("vs
            last week"), not about the household. */}
        <SurfaceList>
          <Row className="gap-3" data-testid="points-drawer-hero-row">
            <HouseholdAvatar size={30} className="flex-none" data-testid="points-drawer-hero-badge" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50">
                Household
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-xxs text-brand-450 dark:text-brand-450">{dateLabel}</span>
                {trend && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-xxs font-semibold',
                      trend.percent >= 0
                        ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/20'
                        : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/20',
                    )}
                  >
                    {trend.percent >= 0 ? (
                      <TrendingUp size={11} aria-hidden="true" />
                    ) : (
                      <TrendingDown size={11} aria-hidden="true" />
                    )}
                    {Math.abs(trend.percent)}%
                    {/* The arrow supplying the direction is aria-hidden, so
                        without this a screen reader gets an unqualified "12%"
                        with nothing to say whether it is up or down. Matches
                        the ScoreboardWidget chip. */}
                    <span className="sr-only">
                      {trend.percent >= 0 ? ' up' : ' down'} vs last week
                    </span>
                  </span>
                )}
              </span>
            </span>
            <span className="flex-none flex items-baseline gap-1">
              <span className="font-mono font-bold tabular-nums text-2xl tracking-tight text-brand-900 dark:text-brand-50">
                {householdTotal}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-450 dark:text-brand-450">
                pts
              </span>
            </span>
          </Row>
        </SurfaceList>

        {/* Per-member standings — adults only — plus the "Shared habits" row,
            the `unattributed` remainder of `household = Σ members +
            unattributed` (pre-attribution legacy history today, plus habits
            that credit the household). Always shown once its submission-aware
            figure has loaded — see `householdShare`'s doc comment — even at 0,
            same as the per-member rows, so the drawer doesn't jump when the
            Day/Week toggle moves this value across zero. */}
        {(standings.length > 0 || householdShare !== undefined) && (
          <SurfaceList>
            {standings.map((row) => {
              const isExpanded = expandedRowId === row.memberId;
              const detailId = `points-drawer-ledger-${row.memberId}`;
              return (
                // The wrapper (not the button) is the SurfaceList's direct
                // child, so it carries the row's hairline and the list's
                // `[&>*:first-child]:border-t-0` reset still finds it.
                <div key={row.memberId} className="hairline-divider">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRowId(prev => (prev === row.memberId ? null : row.memberId))
                    }
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                    data-testid={`points-drawer-row-${row.memberId}`}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
                  >
                    <MemberAvatar
                      data-testid={`points-drawer-avatar-${row.memberId}`}
                      name={row.name}
                      photoURL={row.photoURL}
                      color={memberColorFor(colors, row.memberId)}
                      size={30}
                      className="flex-none"
                    />
                    <span className="min-w-0 flex-1 flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50">
                        {row.name}
                      </span>
                      {row.isLeader && (
                        <>
                          <Crown size={13} className="flex-none text-habit-gold" aria-hidden="true" />
                          <span className="sr-only">{`${row.name} is leading`}</span>
                        </>
                      )}
                    </span>
                    <span className="flex-none flex items-baseline gap-1">
                      <span className="font-mono font-bold tabular-nums text-base text-brand-900 dark:text-brand-50">
                        {row.points}
                      </span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-450 dark:text-brand-450">
                        pts
                      </span>
                    </span>
                    <ChevronDown
                      size={15}
                      aria-hidden="true"
                      className={cn(
                        'flex-none text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                        isExpanded && 'rotate-180',
                      )}
                    />
                  </button>
                  {isExpanded && (
                    <div
                      id={detailId}
                      className="px-4 pb-3.5 pl-[54px] animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
                    >
                      <PointsLedgerList
                        entries={expandedLedger ?? []}
                        emptyLabel={`${row.name} hasn't logged a habit ${periodLabel}.`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {householdShare !== undefined && (
              <div className="hairline-divider" data-testid="points-drawer-household-row">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedRowId(prev => (prev === SHARED_ROW_ID ? null : SHARED_ROW_ID))
                  }
                  aria-expanded={expandedRowId === SHARED_ROW_ID}
                  aria-controls="points-drawer-ledger-shared"
                  data-testid="points-drawer-row-shared"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
                >
                  <HouseholdAvatar size={30} className="flex-none" data-testid="points-drawer-household-badge" />
                  <span className="min-w-0 flex-1 flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold tracking-tight text-brand-900 dark:text-brand-50">
                      Shared habits
                    </span>
                  </span>
                  <span className="flex-none flex items-baseline gap-1">
                    <span className="font-mono font-bold tabular-nums text-base text-brand-900 dark:text-brand-50">
                      {householdShare}
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-450 dark:text-brand-450">
                      pts
                    </span>
                  </span>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={cn(
                      'flex-none text-brand-400 dark:text-brand-450 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                      expandedRowId === SHARED_ROW_ID && 'rotate-180',
                    )}
                  />
                </button>
                {expandedRowId === SHARED_ROW_ID && (
                  <div
                    id="points-drawer-ledger-shared"
                    className="px-4 pb-3.5 pl-[54px] animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
                  >
                    <PointsLedgerList
                      entries={expandedLedger ?? []}
                      emptyLabel={`No shared-habit points ${periodLabel}.`}
                    />
                  </div>
                )}
              </div>
            )}
          </SurfaceList>
        )}

        {/* Reward pool — lifetime redeemable total, pending-redemption count
            (absorbed from the header), and the Rewards deep-link. */}
        <SurfaceList>
          <Row className="gap-3">
            <span
              className="flex-none w-[30px] h-[30px] rounded-full flex items-center justify-center bg-warm-50 dark:bg-warm-500/10 border border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-300"
              aria-hidden="true"
            >
              <Gift size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-brand-900 dark:text-brand-50">
                Reward pool
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <span className="font-mono font-bold tabular-nums text-xs text-brand-700 dark:text-brand-200">
                  {totalPoints} pts
                </span>
                {pendingRedemptionCount > 0 && (
                  <span className="inline-flex items-center rounded-full border border-warm-200 dark:border-warm-700 bg-warm-100 dark:bg-warm-500/15 px-1.5 py-0.5 text-xxs font-semibold text-warm-700 dark:text-warm-300">
                    {pendingRedemptionCount} pending
                  </span>
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={goToRewards}
              className="flex-none inline-flex items-center gap-1 text-sm font-semibold text-accent-600 dark:text-accent-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-btn px-1 -mx-1"
            >
              Rewards
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </Row>
        </SurfaceList>
      </div>
    </Drawer>
  );
};

export default PointsBreakdownDrawer;
