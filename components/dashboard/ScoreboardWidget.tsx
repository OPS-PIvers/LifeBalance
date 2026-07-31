import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseISO } from 'date-fns';
import { Sparkle, Crown, TrendingUp, TrendingDown, Calendar, ChevronDown } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import {
  selectAdultStandings,
  deriveScoreboardTrend,
  listScoreboardWeekOptions,
  weekHasMemberAttribution,
  buildWeekStandings,
  calculateHouseholdShareForDateRange,
  type ScoreboardWeekOption,
  type ScoreboardWeekStanding,
} from '@/utils/scoreboardWidget';
import { calculateHouseholdPointsForDateRange, calculateMemberPointsForDateRange } from '@/utils/habitAttribution';
import { fetchSubmissionTotals, submissionCacheKey } from '@/utils/habitSubmissionTotals';
import type { SubmissionTotalsByHabitDate } from '@/utils/habitLogic';
import { cn } from '@/utils/cn';
import { Section, SurfaceList } from '@/components/ui/Section';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';

/** Result of the async past-week recompute, keyed to whichever week it was fetched for. */
interface PastWeekData {
  total: number;
  standings: ScoreboardWeekStanding[];
  hasAttribution: boolean;
  /** The household's own share of `total` — see `calculateHouseholdShareForDateRange`. */
  householdShare: number;
}

/**
 * ScoreboardWidget — home-feed points scoreboard (per-member points, PR 4/6).
 *
 * Household-first (mock `scoreboard-v3.png` / `.claude/mocks/per-member-points/
 * r3-scoreboard.html`): a household hero ROW leads — household badge +
 * "Household" + the live total, with the best-week sub-label and the trend
 * chip on its subtitle line; adult standings rows (weekly bar, today's points,
 * crown on a strict leader) follow underneath. The hero shares the standings
 * rows' silhouette on purpose so every row lines up on one vertical grid,
 * which is also why the household's OWN share below is labelled "Shared
 * habits" rather than "Household". Plain avatars — NO flame rings, which are
 * habits-page-only UI per the locked decision.
 *
 * Default-on and never hides itself: before any member has earned points it
 * renders the same layout with quiet zeros (0% bars, no crown, no trend chip)
 * rather than disappearing, since a brand-new default-on widget vanishing
 * would read as broken, not empty.
 *
 * Header (paper cut #2): converted to `Section` + `SurfaceList` so its title
 * sits OUTSIDE the card, matching every other Dashboard widget (see
 * CreditCardActivityWidget) instead of the old in-card Eyebrow row.
 *
 * Week selector (paper cut #3): the old static "This week · <range>" label is
 * now the Section's `action` — a button that opens a `Menu` of recent weeks.
 * Selecting a past week re-derives that week's figures from habit history
 * (`points.weekly` is current-week-only and gets overwritten on rollover, so
 * it can't serve history — see utils/habitAttribution.ts's range scorers);
 * the current week keeps reading the live `weeklyPoints`/`members` figures
 * unchanged. Selection is component state only — never persisted — so a
 * reload always lands back on the current week.
 */
export const ScoreboardWidget: React.FC = React.memo(() => {
  const { members, recaps } = useHouseholdCore();
  const { weeklyPoints, habits, getHabitSubmissions } = useGamification();

  const adults = useMemo(() => members.filter(m => !m.isManaged), [members]);
  // Same MemberColorMap habitRowAttribution.ts/recapDeck.ts build — a plain
  // `resolveAvatarColor(avatarColor, uid)` call uid-hashes into a DIFFERENT
  // palette and swaps a member's color against those other surfaces.
  const colors = useMemo(() => buildMemberColorMap(members), [members]);

  // Current-week figures — unchanged from before this cut.
  const standings = useMemo(() => selectAdultStandings(members), [members]);
  const trend = useMemo(
    () => deriveScoreboardTrend(recaps, weeklyPoints, members),
    [recaps, weeklyPoints, members]
  );

  // Frozen at mount so the offered week list (and the "current week" boundary)
  // never shifts mid-session; reloading picks up the new "today", which is
  // what makes the selector reset to the current week on reload.
  const todayAnchorRef = useRef(parseISO(getLocalDateString()));
  const weekOptions = useMemo(
    () => listScoreboardWeekOptions(habits, todayAnchorRef.current),
    [habits]
  );
  const currentWeek = weekOptions[0] ?? null;

  // The household's own share of the CURRENT week's total — the unattributed
  // remainder (pre-attribution legacy history today, OR a stored submission
  // that OUTLIVES its completion date: a reverted toggle removes the date
  // from `completedDates` but never deletes the submission doc, so its
  // points still stand on their own — see `pointsForHabitOnDate`'s doc
  // comment in utils/habitLogic.ts). Without threading `submissionTotals`
  // through, `decomposeDayPoints` collapses such a day to 0, while the
  // canonical `weeklyPoints` figure (written by `usePointsSync`'s corrective
  // recompute, which DOES fold submissions in) still counts it — so the
  // Household row would silently disagree with the total it's supposed to
  // help explain. Fetched the same way the past-week path below already
  // does, via the same `fetchSubmissionTotals` helper `usePointsSync` uses.
  //
  // `undefined` means "not fetched yet for this week" — the Household row
  // stays hidden (see the `!!householdShare` render guard) rather than
  // flashing a submission-less, possibly-wrong figure while the fetch is in
  // flight; render nothing, never a wrong number.
  const [currentWeekSubmissionTotals, setCurrentWeekSubmissionTotals] =
    useState<SubmissionTotalsByHabitDate | undefined>(undefined);

  // Last-fetched fingerprint + totals for the current-week window, read via a
  // ref rather than folded into the effect's own dependency array — a ref
  // write doesn't retrigger the effect, so a failed fetch retries only on the
  // next real habits snapshot/week change instead of looping tightly (see
  // `submissionCacheKey`'s doc comment in utils/habitSubmissionTotals.ts for
  // why an unchanged fingerprint means the previously fetched totals are
  // still current — `usePointsSync` uses the exact same cache shape).
  const currentWeekSubmissionCacheRef =
    useRef<{ key: string; totals: SubmissionTotalsByHabitDate } | null>(null);

  useEffect(() => {
    if (!currentWeek) {
      setCurrentWeekSubmissionTotals(undefined);
      return;
    }
    const cacheKey = submissionCacheKey(habits, `${currentWeek.weekStart}..${getLocalDateString()}`);
    // The always-mounted Dashboard re-renders this effect on every habits
    // snapshot (a fresh array identity on every habit toggle). Bail out
    // before issuing a query when no tracked habit's `lastUpdated` — and
    // hence no submission — could have changed since the last fetch.
    if (currentWeekSubmissionCacheRef.current?.key === cacheKey) return;

    let cancelled = false;
    (async () => {
      try {
        const totals = await fetchSubmissionTotals(
          habits,
          currentWeek.weekStart,
          getLocalDateString(),
          getHabitSubmissions,
        );
        if (!cancelled) {
          currentWeekSubmissionCacheRef.current = { key: cacheKey, totals };
          setCurrentWeekSubmissionTotals(totals);
        }
      } catch {
        // A transient failure leaves the row hidden (per the doc comment
        // above) rather than showing a stale/incomplete figure; the cache
        // isn't updated on failure, so the next habits snapshot or week
        // change re-fires this effect and retries.
        if (!cancelled) setCurrentWeekSubmissionTotals(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [habits, currentWeek, getHabitSubmissions]);

  const currentWeekHouseholdShare = useMemo(
    () =>
      currentWeekSubmissionTotals === undefined
        ? undefined
        : calculateHouseholdShareForDateRange(
            habits,
            currentWeek?.weekStart ?? getLocalDateString(),
            getLocalDateString(),
            getLocalDateString(),
            currentWeekSubmissionTotals,
          ),
    [habits, currentWeek, currentWeekSubmissionTotals]
  );

  // null = current week. Component state only, never written to storage.
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const [isWeekMenuOpen, setIsWeekMenuOpen] = useState(false);
  const selectedWeek = selectedWeekStart
    ? weekOptions.find(w => w.weekStart === selectedWeekStart) ?? null
    : null;
  const isPastWeek = selectedWeek !== null && !selectedWeek.isCurrent;

  const [pastWeekData, setPastWeekData] = useState<PastWeekData | null>(null);
  const [isLoadingPastWeek, setIsLoadingPastWeek] = useState(false);

  useEffect(() => {
    if (!isPastWeek || !selectedWeek) {
      setPastWeekData(null);
      // Also clear the spinner: returning to the current week while a fetch is
      // in flight would otherwise leave this stuck true.
      setIsLoadingPastWeek(false);
      return;
    }
    const { weekStart, weekEnd } = selectedWeek;
    let cancelled = false;
    setIsLoadingPastWeek(true);
    // Clear stale data up front so a week-to-week switch can't briefly render
    // the PREVIOUS selection's totals/standings under the new week's label.
    setPastWeekData(null);
    (async () => {
      // Fetched fresh per selection rather than cached. usePointsSync's
      // habit-lastUpdated cache key exists to stop an idle 5-MINUTE background
      // scheduler from re-querying every tick; a user tapping a past week is a
      // rare, explicit interaction, so a plain per-selection fetch — the same
      // shape useHabitCalendarData already uses for its own window — is
      // simpler and doesn't need that cache's bookkeeping.
      try {
        const submissionTotals = await fetchSubmissionTotals(habits, weekStart, weekEnd, getHabitSubmissions);
        if (cancelled) return;
        const today = getLocalDateString();
        const total = calculateHouseholdPointsForDateRange(habits, weekStart, weekEnd, today, submissionTotals);
        const hasAttribution = weekHasMemberAttribution(habits, weekStart, weekEnd);
        const pointsByMemberId = new Map(
          adults.map(m => [m.uid, calculateMemberPointsForDateRange(habits, m.uid, weekStart, weekEnd, today)])
        );
        const householdShare = calculateHouseholdShareForDateRange(
          habits,
          weekStart,
          weekEnd,
          today,
          submissionTotals
        );
        setPastWeekData({
          total,
          standings: hasAttribution ? buildWeekStandings(adults, pointsByMemberId) : [],
          hasAttribution,
          householdShare,
        });
      } catch {
        // A transient Firestore failure in fetchSubmissionTotals must not leave
        // the widget showing its loading placeholder forever. `pastWeekData`
        // stays null, so the empty-state copy renders and re-picking the week
        // retries.
        if (!cancelled) setPastWeekData(null);
      } finally {
        if (!cancelled) setIsLoadingPastWeek(false);
      }
    })();
    return () => { cancelled = true; };
    // `selectedWeek` is a stable object reference across re-renders (it's a
    // `.find()` hit into the memoized `weekOptions` array), so this only
    // re-fires when the user picks a different week or `weekOptions` itself
    // is rebuilt (habits changed) — correctly refreshing an open past-week
    // view rather than leaving it stale.
  }, [isPastWeek, selectedWeek, habits, adults, getHabitSubmissions]);

  const handleSelectWeek = useCallback((option: ScoreboardWeekOption) => {
    setSelectedWeekStart(option.isCurrent ? null : option.weekStart);
    // Clear eagerly (not just inside the fetch effect) so switching directly
    // from one past week to another can't render a frame of the PREVIOUS
    // week's totals/standings under the new week's label while the fetch for
    // the new selection is in flight.
    setPastWeekData(null);
  }, []);

  // No adult members at all is not a real scenario (the signed-in admin is
  // always one) but keeps this self-nulling like the rest of the widget stack
  // rather than rendering an empty standings block.
  if (standings.length === 0) return null;

  const activeWeekStart = selectedWeek?.weekStart ?? currentWeek?.weekStart;
  const weekMenuItems: MenuItem[] = weekOptions.map(option => ({
    key: option.weekStart,
    label: option.isCurrent ? `This week · ${option.label}` : option.label,
    onSelect: () => handleSelectWeek(option),
    selected: option.weekStart === activeWeekStart,
    group: 'Week',
  }));
  const triggerLabel = isPastWeek && selectedWeek ? selectedWeek.label : 'This week';

  const TrendIcon = (trend.trendPct ?? 0) >= 0 ? TrendingUp : TrendingDown;
  const trendPositive = (trend.trendPct ?? 0) >= 0;

  const displayTotal = isPastWeek ? pastWeekData?.total : weeklyPoints;
  // The Household row's value — see `currentWeekHouseholdShare`'s doc comment
  // for why this is a derived figure, not `displayTotal - Σ rows.value`.
  const householdShare = isPastWeek ? pastWeekData?.householdShare : currentWeekHouseholdShare;
  const rows = isPastWeek
    ? (pastWeekData?.standings ?? []).map(s => ({
        memberId: s.memberId,
        name: s.name,
        avatarEmoji: s.avatarEmoji,
        photoURL: s.photoURL,
        isLeader: s.isLeader,
        barPct: s.barPct,
        value: s.points,
        subLabel: null as string | null,
      }))
    : standings.map(s => ({
        memberId: s.memberId,
        name: s.name,
        avatarEmoji: s.avatarEmoji,
        photoURL: s.photoURL,
        isLeader: s.isLeader,
        barPct: s.barPct,
        value: s.weekly,
        subLabel: `${s.today} today`,
      }));

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Sparkle size={14} className="text-warm-600 dark:text-warm-300" aria-hidden="true" />
          Scoreboard
        </span>
      }
      action={
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsWeekMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={isWeekMenuOpen}
            aria-label={`Select week. Currently viewing ${isPastWeek && selectedWeek ? selectedWeek.label : `this week, ${currentWeek?.label ?? ''}`}.`}
            className="relative before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] inline-flex items-center gap-1 text-xxs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
          >
            <Calendar size={12} aria-hidden="true" />
            {triggerLabel}
            <ChevronDown
              size={12}
              aria-hidden="true"
              className={cn('transition-transform duration-(--duration-fast) ease-(--ease-standard)', isWeekMenuOpen && 'rotate-180')}
            />
          </button>
          <Menu
            isOpen={isWeekMenuOpen}
            onClose={() => setIsWeekMenuOpen(false)}
            items={weekMenuItems}
            ariaLabel="Select week"
            position="top-full right-0 mt-2"
            className="min-w-[200px]"
          />
        </div>
      }
    >
      <SurfaceList className="px-3.5 pt-[11px] pb-2.5">
        {/* Household lead row — same [avatar] · name · ——— · points silhouette
            as the standings rows below (and as the Points drawer's hero), so
            the household, each member and the shared-habits row all sit on one
            vertical grid instead of the hero floating on a layout of its own.
            The numeral stays larger than a member's, but in the same
            right-aligned `w-14` column.

            The trend chip moved off the row's right edge onto the subtitle
            line: that edge is the points column now, and anything parked there
            pushes the total out of alignment with the rows underneath. It also
            sits naturally beside "Best week this month" — both are notes about
            the week, not about the household. */}
        <div className="flex items-center gap-[11px] pb-2.5" data-testid="scoreboard-hero-row">
          <HouseholdAvatar size={30} data-testid="scoreboard-hero-badge" />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate">
              Household
            </div>
            {!isPastWeek && (trend.isBestWeek || (trend.trendPct !== null && trend.trendPct !== 0)) && (
              <div className="mt-[3px] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {trend.isBestWeek && (
                  <span className="text-[10.5px] text-brand-500 dark:text-brand-400">
                    Best week this month
                  </span>
                )}
                {trend.trendPct !== null && trend.trendPct !== 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold border',
                      trendPositive
                        ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/18 dark:border-money-pos/35'
                        : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/18 dark:border-money-neg/35'
                    )}
                  >
                    <TrendIcon size={10} aria-hidden="true" />
                    {Math.abs(trend.trendPct)}% vs last week
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex-none w-14 text-right">
            <div
              data-testid="scoreboard-total"
              className="font-mono font-bold text-[22px] leading-none tracking-tight text-brand-900 dark:text-brand-50 tabular-nums"
            >
              {isPastWeek && displayTotal === undefined ? '…' : (displayTotal ?? 0)}
            </div>
            <div className="mt-[3px] text-[9px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              Week
            </div>
          </div>
        </div>

        {/* A grandfathered past week (no per-member attribution recorded) gets a
            quiet note instead of a row of invented member zeroes. */}
        {isPastWeek && !isLoadingPastWeek && pastWeekData && !pastWeekData.hasAttribution && (
          <div className="border-t border-brand-200 dark:border-brand-700 pt-2.5 text-xs text-brand-500 dark:text-brand-400">
            Per-person scores aren&apos;t available for this week yet.
          </div>
        )}

        {/* Standings */}
        {(!isPastWeek || (pastWeekData?.hasAttribution ?? false)) && (
          <div className="border-t border-brand-200 dark:border-brand-700 pt-1">
            {rows.map(s => (
              <div key={s.memberId} className="flex items-center gap-[11px] py-[5px]">
                <MemberAvatar
                  data-testid={`scoreboard-avatar-${s.memberId}`}
                  name={s.name}
                  photoURL={s.photoURL}
                  color={memberColorFor(colors, s.memberId)}
                  fallbackGlyph={s.avatarEmoji}
                  size={30}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13.5px] font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate">
                      {s.name}
                    </span>
                    {s.isLeader && (
                      <>
                        <Crown size={12} className="text-habit-gold shrink-0 self-center" aria-hidden="true" />
                        <span className="sr-only">Leading</span>
                      </>
                    )}
                    {s.subLabel && (
                      <span className="text-[10.5px] text-brand-500 dark:text-brand-400 whitespace-nowrap">
                        {s.subLabel}
                      </span>
                    )}
                  </div>
                  <div className="mt-[5px] h-1 rounded-full bg-brand-100 dark:bg-brand-700 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${s.barPct}%`,
                        backgroundColor: memberColorFor(colors, s.memberId),
                      }}
                    />
                  </div>
                </div>
                <div className="flex-none w-14 text-right">
                  <div className="font-mono font-bold text-[17px] leading-tight text-brand-900 dark:text-brand-50 tabular-nums">
                    {s.value}
                  </div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                    Week
                  </div>
                </div>
              </div>
            ))}
            {/* "Shared habits" row — the unattributed remainder: pre-attribution
                legacy history, plus habits that credit the household instead of
                a member. Shown only when nonzero so an ordinary household with
                neither sees exactly what it saw before this row existed.
                Labelled "Shared habits", not "Household": the hero row above is
                the household now, and two rows with the same badge and the same
                word would be indistinguishable at a glance. */}
            {householdShare !== undefined && householdShare !== 0 && (
              <div className="flex items-center gap-[11px] py-[5px]" data-testid="scoreboard-household-row">
                <HouseholdAvatar size={30} data-testid="scoreboard-household-badge" />
                <div className="flex-1 min-w-0">
                  <span className="text-[13.5px] font-semibold text-brand-900 dark:text-brand-50 tracking-tight truncate">
                    Shared habits
                  </span>
                </div>
                <div className="flex-none w-14 text-right">
                  <div className="font-mono font-bold text-[17px] leading-tight text-brand-900 dark:text-brand-50 tabular-nums">
                    {householdShare}
                  </div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                    Week
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </SurfaceList>
    </Section>
  );
});

ScoreboardWidget.displayName = 'ScoreboardWidget';
