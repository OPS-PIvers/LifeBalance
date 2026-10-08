import React, { useMemo } from 'react';
import { addDaysTo, weekdayName } from '@/utils/wall/wallCalendar';
import { useWallData } from '@/components/wall/data/wallData';
import WallModuleFill from './WallModuleFill';

interface MealsModuleProps {
  today: string;
  /** Opens the Meals screen on that day's dinner. */
  onOpenMeal?: (date: string) => void;
}

/**
 * "Dinners": the next week's dinners, starting tomorrow (tonight's is in the
 * day column), as many nights as fit, or all seven turning once auto
 * scroll is started.
 */
const MealsModule: React.FC<MealsModuleProps> = ({ today, onOpenMeal }) => {
  const { mealPlan } = useWallData();
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = addDaysTo(today, i + 1);
        return { date, label: weekdayName(date).slice(0, 3), dinner: mealPlan.find(m => m.date === date && m.type === 'dinner') };
      }),
    [mealPlan, today]
  );
  if (days.every(d => !d.dinner)) return <div className="empty">No dinners planned this week</div>;
  return (
    <WallModuleFill>
      {days.map(d => {
        const body = (
          <>
            <span className="d">{d.label}</span>
            <span className={d.dinner ? 'n' : 'n none'}>{d.dinner?.mealName ?? 'Nothing planned'}</span>
          </>
        );
        return onOpenMeal && d.dinner ? (
          <button key={d.date} type="button" className="mrow" onClick={() => onOpenMeal(d.date)}>
            {body}
          </button>
        ) : (
          <div key={d.date} className="mrow">
            {body}
          </div>
        );
      })}
    </WallModuleFill>
  );
};

export default MealsModule;
