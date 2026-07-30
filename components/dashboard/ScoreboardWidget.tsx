import React, { useMemo } from 'react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { Sparkle, Crown, TrendingUp, TrendingDown } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { resolveAvatarColor } from '@/utils/avatarColor';
import { selectAdultStandings, deriveScoreboardTrend } from '@/utils/scoreboardWidget';
import { cn } from '@/utils/cn';
import Eyebrow from '@/components/ui/Eyebrow';

/**
 * ScoreboardWidget — home-feed points scoreboard (per-member points, PR 4/6).
 *
 * Household-first (mock `scoreboard-v3.png` / `.claude/mocks/per-member-points/
 * r3-scoreboard.html`): the household's live "N pts together" total leads,
 * with a best-week sub-label + trend chip; adult standings rows (weekly bar,
 * today's points, crown on a strict leader) follow underneath. Plain avatars —
 * NO flame rings, which are habits-page-only UI per the locked decision.
 *
 * Default-on and never hides itself: before any member has earned points it
 * renders the same layout with quiet zeros (0% bars, no crown, no trend chip)
 * rather than disappearing, since a brand-new default-on widget vanishing
 * would read as broken, not empty.
 */
export const ScoreboardWidget: React.FC = React.memo(() => {
  const { members, recaps } = useHouseholdCore();
  const { weeklyPoints } = useGamification();

  const standings = useMemo(() => selectAdultStandings(members), [members]);
  const trend = useMemo(
    () => deriveScoreboardTrend(recaps, weeklyPoints, members),
    [recaps, weeklyPoints, members]
  );

  const weekLabel = useMemo(() => {
    const anchor = parseISO(getLocalDateString());
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
  }, []);

  // No adult members at all is not a real scenario (the signed-in admin is
  // always one) but keeps this self-nulling like the rest of the widget stack
  // rather than rendering an empty standings block.
  if (standings.length === 0) return null;

  const TrendIcon = (trend.trendPct ?? 0) >= 0 ? TrendingUp : TrendingDown;
  const trendPositive = (trend.trendPct ?? 0) >= 0;

  return (
    <div className="surface-section px-3.5 pt-[11px] pb-2.5">
      {/* Header — eyebrow label + this-week date range, matching the mock's
          in-card header (not a separate outer Section title). */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <Eyebrow tone="warm" className="flex items-center gap-1.5">
          <Sparkle size={11} aria-hidden="true" />
          Scoreboard
        </Eyebrow>
        <span className="text-xxs text-brand-500 dark:text-brand-400">
          This week · {weekLabel}
        </span>
      </div>

      {/* Household lead block */}
      <div className="flex items-end justify-between gap-2.5 pb-2.5">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span
              data-testid="scoreboard-total"
              className="font-display font-semibold text-[38px] leading-none tracking-tight text-brand-900 dark:text-brand-50"
            >
              {weeklyPoints}
            </span>
            <span className="font-display text-[15px] font-semibold text-warm-600 dark:text-warm-300">
              pts together
            </span>
          </div>
          {trend.isBestWeek && (
            <div className="mt-1 text-[10.5px] text-brand-500 dark:text-brand-400">
              Best week this month
            </div>
          )}
        </div>
        {trend.trendPct !== null && trend.trendPct !== 0 && (
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

      {/* Standings */}
      <div className="border-t border-brand-200 dark:border-brand-700 pt-1">
        {standings.map(s => (
          <div key={s.memberId} className="flex items-center gap-[11px] py-[5px]">
            <div
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0"
              style={{ backgroundColor: resolveAvatarColor(s.avatarColor, s.memberId) }}
              aria-hidden="true"
            >
              {s.avatarEmoji ?? s.name.charAt(0).toUpperCase()}
            </div>
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
                <span className="text-[10.5px] text-brand-500 dark:text-brand-400 whitespace-nowrap">
                  {s.today} today
                </span>
              </div>
              <div className="mt-[5px] h-1 rounded-full bg-brand-100 dark:bg-brand-700 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${s.barPct}%`,
                    backgroundColor: resolveAvatarColor(s.avatarColor, s.memberId),
                  }}
                />
              </div>
            </div>
            <div className="flex-none w-14 text-right">
              <div className="font-mono font-bold text-[17px] leading-tight text-brand-900 dark:text-brand-50 tabular-nums">
                {s.weekly}
              </div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                Week
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

ScoreboardWidget.displayName = 'ScoreboardWidget';
