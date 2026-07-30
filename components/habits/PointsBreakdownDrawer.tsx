import React, { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Crown, Gift, TrendingDown, TrendingUp, X } from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { Drawer } from '@/components/ui/Drawer';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import MemberAvatar from '@/components/ui/MemberAvatar';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { getAdultStandings, computePointsTrend, type PointsDrawerPeriod } from '@/utils/pointsDrawer';

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
 * household total (with a "vs last week" trend chip, derived from the
 * newest WeeklyRecap) → adults-only per-member standings (plain avatars, crown
 * on the sole leader) → Reward pool row (lifetime pool total + the
 * pending-redemption count, absorbed from the header, + a Rewards deep-link).
 *
 * Reads ONLY the narrow `useGamification`/`useHouseholdCore` slices, and reads
 * `dailyPoints`/`weeklyPoints`/member `points` as-is — it never re-expands
 * habits in render (that's what `HouseholdMember.points` and the household
 * pool figure already exist for). Default export so it can be
 * `React.lazy`-loaded (keeps Drawer/framer-motion off the boot bundle, like
 * every other TopToolbar-triggered drawer).
 */
const PointsBreakdownDrawer: React.FC<PointsBreakdownDrawerProps> = ({ open, onClose }) => {
  const titleId = useId();
  const { dailyPoints, weeklyPoints, totalPoints } = useGamification();
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

  const goToRewards = () => {
    onClose();
    navigate('/habits', { state: { tab: 'rewards' } });
  };

  return (
    <Drawer
      isOpen={open}
      onClose={onClose}
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
              onClick={onClose}
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
        {/* Household total. */}
        <SurfaceList>
          <Row className="items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-semibold leading-none tracking-tight tabular-nums text-4xl text-brand-900 dark:text-brand-50">
                  {householdTotal}
                </span>
                <span className="font-display text-sm font-semibold text-warm-600 dark:text-warm-300">
                  household total
                </span>
              </div>
              <p className="mt-1 text-xxs text-brand-450 dark:text-brand-450">{dateLabel}</p>
            </div>
            {trend && (
              <span
                className={cn(
                  'flex-none inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold',
                  trend.percent >= 0
                    ? 'bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark border-money-pos/20'
                    : 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark border-money-neg/20',
                )}
              >
                {trend.percent >= 0 ? (
                  <TrendingUp size={12} aria-hidden="true" />
                ) : (
                  <TrendingDown size={12} aria-hidden="true" />
                )}
                {Math.abs(trend.percent)}%
              </span>
            )}
          </Row>
        </SurfaceList>

        {/* Per-member standings — adults only. */}
        {standings.length > 0 && (
          <SurfaceList>
            {standings.map((row) => (
              <Row key={row.memberId} className="gap-3">
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
              </Row>
            ))}
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
