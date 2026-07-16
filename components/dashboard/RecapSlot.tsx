import React from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { WeeklyRecapCard } from '@/components/dashboard/WeeklyRecapCard';
import { MoneyRecapCard } from '@/components/dashboard/MoneyRecapCard';
import { weeklyRecapCardVisible, moneyRecapCardVisible } from '@/components/dashboard/recapVisibility';

/**
 * RecapSlot — the single Dashboard slot the weekly recap and the monthly money
 * recap share. Early in a month their freshness windows overlap (weekly is
 * fresh Sun→Wed, monthly the first ~6 days), and before this slot existed both
 * cards stacked back-to-back with near-identical anatomy — two "you spent $X"
 * summaries in a Dashboard that is already 10+ sections tall.
 *
 * At most ONE card renders: when both are fresh and undismissed, the more
 * recently generated recap wins (it's the newer news). The losing card still
 * mounts in `drawerOnly` mode so its push deep link (`?recap=` /
 * `?moneyrecap=`) keeps opening the full detail drawer.
 *
 * Member customization (Settings → Dashboard widgets) still applies upstream:
 * each card only reaches this slot when its widget id is visible, via the
 * `weekly` / `money` props.
 */
interface RecapSlotProps {
  /** The member's widget list still includes `weeklyRecap`. */
  weekly: boolean;
  /** The member's widget list still includes `moneyRecap`. */
  money: boolean;
}

export const RecapSlot: React.FC<RecapSlotProps> = ({ weekly, money }) => {
  const { recaps, moneyRecaps } = useHouseholdCore();

  const weeklyWants = weekly && weeklyRecapCardVisible(recaps[0]);
  const moneyWants = money && moneyRecapCardVisible(moneyRecaps[0]);

  // Both fresh → the newer generation wins the slot.
  let showWeekly = weeklyWants;
  let showMoney = moneyWants;
  if (weeklyWants && moneyWants) {
    const weeklyAt = new Date(recaps[0]?.generatedAt ?? 0).getTime();
    const moneyAt = new Date(moneyRecaps[0]?.generatedAt ?? 0).getTime();
    showWeekly = weeklyAt >= moneyAt;
    showMoney = !showWeekly;
  }

  return (
    <>
      {weekly && <WeeklyRecapCard drawerOnly={!showWeekly} />}
      {money && <MoneyRecapCard drawerOnly={!showMoney} />}
    </>
  );
};
