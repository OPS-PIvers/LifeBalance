import React, { useMemo, useRef } from 'react';
import { addDaysTo, weekdayName } from '@/utils/wall/wallCalendar';
import { useWallData } from '@/components/wall/data/wallData';
import { useWholeFill } from '@/components/wall/useWallFit';

interface MealsModuleProps {
  today: string;
  /** Opens the Meals screen on that day's dinner. */
  onOpenMeal?: (date: string) => void;
}

/**
 * "Dinners": the next week's dinners, starting tomorrow (tonight's is in the
 * day column), as many nights as fit.
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
  const ref = useRef<HTMLDivElement>(null);
  useWholeFill(ref);
  const none = days.every(d => !d.dinner);
  // The box always renders, so the fill keeps watching it when dinners get planned.
  return (
    <div className="fill" ref={ref}>
      {none && <div className="empty">No dinners planned this week</div>}
      {!none &&
        days.map(d => {
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
    </div>
  );
};

export default MealsModule;
