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
  type ScoreboardWeekOption,
  type ScoreboardWeekStanding,
} from '@/utils/scoreboardWidget';
import { calculateHouseholdPointsForDateRange, calculateMemberPointsForDateRange } from '@/utils/habitAttribution';
import { fetchSubmissionTotals } from '@/utils/habitSubmissionTotals';
import { cn } from '@/utils/cn';
import { Section, SurfaceList } from '@/components/ui/Section';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import MemberAvatar from '@/components/ui/MemberAvatar';

/** Result of the async past-week recompute, keyed to whichever week it was fetched for. */
interface PastWeekData {
  total: number;
  standings: ScoreboardWeekStanding[];
  hasAttribution: boolean;
}

/**
 * ScoreboardWidget — home-feed points scoreboard (per-member points, PR 4/6).
 *
 * Household-first (mock `scoreboard-v3.png` / `.claude/mocks/per-member-points/
 * r3-scoreboard.html`): the household's live "N household total" total leads,
 * with a best-week sub-label + trend chip; adult standings rows (weekly bar,
 * today's points, crown on a strict leader) follow underneath. Plain avatars —
 * NO flame rings, which are habits-page-only UI per the locked decision.
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
        setPastWeekData({
          total,
          standings: hasAttribution ? buildWeekStandings(adults, pointsByMemberId) : [],
          hasAttribution,
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
        {/* Household lead block */}
        <div className="flex items-end justify-between gap-2.5 pb-2.5">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                data-testid="scoreboard-total"
                className="font-display font-semibold text-[38px] leading-none tracking-tight text-brand-900 dark:text-brand-50"
              >
                {isPastWeek && displayTotal === undefined ? '…' : (displayTotal ?? 0)}
              </span>
              <span className="font-display text-[15px] font-semibold text-warm-600 dark:text-warm-300">
                household total
              </span>
            </div>
            {!isPastWeek && trend.isBestWeek && (
              <div className="mt-1 text-[10.5px] text-brand-500 dark:text-brand-400">
                Best week this month
              </div>
            )}
          </div>
          {!isPastWeek && trend.trendPct !== null && trend.trendPct !== 0 && (
            <span
              className={cn(
                'flex-none inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs font-semibold border mb-[3px]',
                trendPositive
                  ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/18 dark:border-money-pos/35'
                  : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/18 dark:border-money-neg/35'
              )}
            >
              <TrendIcon size={12} aria-hidden="true" />
              {Math.abs(trend.trendPct)}% vs last week
            </span>
          )}
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
          </div>
        )}
      </SurfaceList>
    </Section>
  );
});

ScoreboardWidget.displayName = 'ScoreboardWidget';
