import React, { useMemo } from 'react';
import { weekdayName } from '@/utils/wall/wallCalendar';
import { mealWeek } from '@/utils/wall/wallLists';
import { useWallData } from '@/components/wall/data/wallData';
import WallRecipePanel from './WallRecipePanel';

interface WallMealsProps {
  today: string;
  /** The day whose recipe is open, or null. */
  openDate: string | null;
  onOpen: (date: string | null) => void;
}

/** Meals (plan §3): dinner rows, breakfast and lunch only when planned. */
const WallMeals: React.FC<WallMealsProps> = ({ today, openDate, onOpen }) => {
  const { mealPlan } = useWallData();
  const week = useMemo(() => mealWeek(mealPlan, today), [mealPlan, today]);
  const open = week.find(d => d.date === openDate)?.dinner;

  return (
    <div className="ml2">
      <div className="mrows">
        {week.map(day => {
          const others = [
            day.breakfast ? `Breakfast: ${day.breakfast.mealName}` : '',
            day.lunch ? `Lunch: ${day.lunch.mealName}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const label = (
            <span className="d">
              {day.date === today ? 'Today' : weekdayName(day.date).slice(0, 3)}
              <b>{Number(day.date.slice(8, 10))}</b>
            </span>
          );
          const body = (
            <span>
              <span className={day.dinner ? 'n' : 'n none'}>{day.dinner?.mealName ?? 'Nothing planned'}</span>
              {others && <span className="o">{others}</span>}
            </span>
          );
          const cls = ['mr', day.date === today ? 'on' : '', openDate === day.date ? 'sel' : ''].filter(Boolean).join(' ');
          return day.dinner ? (
            <button key={day.date} type="button" className={cls} onClick={() => onOpen(openDate === day.date ? null : day.date)}>
              {label}
              {body}
            </button>
          ) : (
            <div key={day.date} className={cls}>
              {label}
              {body}
            </div>
          );
        })}
      </div>
      {open && <WallRecipePanel entry={open} today={today} onClose={() => onOpen(null)} />}
    </div>
  );
};

export default WallMeals;
