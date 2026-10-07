import React, { useMemo } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { dueTodayChecklist } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import { WallWeatherIcon } from '@/components/wall/WallIcons';
import WallSubtasks, { WallStepCount } from '@/components/wall/lists/WallSubtasks';

interface WallDayPanelProps {
  date: string;
  today: string;
  timeZone: string;
  people: WallPeople;
  weather: WallWeather | null;
  /** Opens the add sheet with this day as the due date. */
  onAddTodo: (date: string) => void;
  onOpenMeal: (date: string) => void;
}

/**
 * Day view's right panel: what belongs to the day on screen, not the Week
 * panel's modules. Weather only for a later day (the top bar already has
 * today's), that day's to-dos as real checkboxes (steps too), and its dinner.
 */
const WallDayPanel: React.FC<WallDayPanelProps> = ({ date, today, timeZone, people, weather, onAddTodo, onOpenMeal }) => {
  const { todos, mealPlan } = useWallData();
  const act = useWallListActions();
  const isToday = date === today;
  const due = useMemo(
    () =>
      isToday
        ? dueTodayChecklist(todos, today, timeZone)
        : todos.filter(t => t.completeByDate === date).sort((a, b) => a.text.localeCompare(b.text)),
    [isToday, todos, today, timeZone, date]
  );
  const forecast = isToday ? undefined : weather?.days.find(d => d.date === date);
  const dinner = mealPlan.find(m => m.date === date && m.type === 'dinner');

  return (
    <aside className="dp" aria-label="This day">
      {forecast && (
        <div className="dpw" aria-label="Forecast">
          <WallWeatherIcon icon={forecast.icon} />
          <b>{forecast.high}°</b>
          <span>
            L {forecast.low}°{forecast.precipMax >= 30 ? ` · ${Math.round(forecast.precipMax)}% rain` : ''}
          </span>
        </div>
      )}
      <section className="dps grow" aria-label={isToday ? 'Due today' : 'To-dos'}>
        <div className="dph">
          <b>{isToday ? 'Due today' : 'To-dos'}</b>
          {date >= today && (
            <button type="button" className="dpadd" onClick={() => onAddTodo(date)}>
              <Plus className="wi" size="1em" aria-hidden="true" />
              Add
            </button>
          )}
        </div>
        <div className="dpl">
          {due.length === 0 && <div className="dpn">Nothing due</div>}
          {due.map(t => (
            <div className="dblk" key={t.id}>
              <button type="button" className={t.isCompleted ? 'ck done' : 'ck'} aria-pressed={t.isCompleted} onClick={() => act.toggleTodo(t)}>
                <span className="bx">{t.isCompleted && <Check className="wi" size="1em" aria-hidden="true" />}</span>
                <span className="tx">
                  {t.text}
                  <small>
                    {people.name(t.assignedTo)}
                    {!t.isCompleted && t.completeByDate < date && <span className="late">Overdue</span>}
                  </small>
                </span>
                <WallStepCount todo={t} />
              </button>
              <WallSubtasks todo={t} people={people} />
            </div>
          ))}
        </div>
      </section>
      <section className="dps" aria-label="Dinner">
        <div className="dph">
          <b>Dinner</b>
        </div>
        {dinner ? (
          <button type="button" className="dpd" onClick={() => onOpenMeal(date)}>
            <span>{dinner.mealName}</span>
            <ChevronRight className="wi" size="1em" aria-hidden="true" />
          </button>
        ) : (
          <div className="dpn">Nothing planned</div>
        )}
      </section>
    </aside>
  );
};

export default WallDayPanel;
