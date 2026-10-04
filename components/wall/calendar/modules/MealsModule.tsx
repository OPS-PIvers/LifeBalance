import React, { useMemo } from 'react';
import { addDaysTo, weekdayName } from '@/utils/wall/wallCalendar';
import { useWallData } from '@/components/wall/data/wallData';

interface MealsModuleProps {
  today: string;
  /** Opens the Meals screen on that day's dinner (absent until the Meals screen ships). */
  onOpenMeal?: (date: string) => void;
}

/** "Meals this week": dinner for today and the next six days. */
const MealsModule: React.FC<MealsModuleProps> = ({ today, onOpenMeal }) => {
  const { mealPlan } = useWallData();
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = addDaysTo(today, i);
        return { date, label: i === 0 ? 'Today' : weekdayName(date).slice(0, 3), dinner: mealPlan.find(m => m.date === date && m.type === 'dinner') };
      }),
    [mealPlan, today]
  );
  if (days.every(d => !d.dinner)) return <div className="empty">No dinners planned this week</div>;
  return (
    <>
      {days.map((d, i) => {
        const body = (
          <>
            <span className={i === 0 ? 'd on' : 'd'}>{d.label}</span>
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
    </>
  );
};

export default MealsModule;
