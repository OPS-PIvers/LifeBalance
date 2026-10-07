import React, { useMemo, useRef } from 'react';
import { Check, Flag, Plus, Receipt } from 'lucide-react';
import { dueTodayChecklist, isMutedLine, todayTimeline } from '@/utils/wall/wallCalendar';
import { wallTimeText, zonedParts } from '@/utils/wall/wallTime';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import { useWallFit } from '@/components/wall/useWallFit';

interface WallTodayProps {
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  showDueToday: boolean;
  showDinner: boolean;
  /** Today-only mode: bigger type and an "Add module" button. */
  solo: boolean;
  /** Stacked above the modules (portrait): sized by its content, so no fitting. */
  stacked?: boolean;
  onAddModule: () => void;
}

/** The Week screen's left panel (plan §3 "Week"): events, Due today, dinner. */
const WallToday: React.FC<WallTodayProps> = ({ today, now, timeZone, people, showDueToday, showDinner, solo, stacked = false, onAddModule }) => {
  const { wallEvents, todos, mealPlan } = useWallData();
  const act = useWallListActions();
  const timeline = useMemo(() => todayTimeline(wallEvents, today, now, timeZone), [wallEvents, today, now, timeZone]);
  const due = useMemo(() => (showDueToday ? dueTodayChecklist(todos, today, timeZone) : []), [showDueToday, todos, today, timeZone]);
  const dinner = showDinner ? mealPlan.find(m => m.date === today && m.type === 'dinner') : undefined;
  const p = zonedParts(now, timeZone);
  const empty = timeline.rows.length === 0 && timeline.allDay.length === 0;
  // Fill the panel from across the room: type grows into the space a quiet day
  // leaves, and shrinks on a busy one so nothing is cut off.
  const ref = useRef<HTMLElement>(null);
  useWallFit(ref, { on: !stacked, min: 0.8, max: solo ? 1.6 : 1.3 });

  return (
    <section ref={ref} className="today" aria-label="Today">
      <div className="th">
        <b>Today</b>
        <span>{p.weekday}</span>
      </div>
      {empty && <div className="tempty">No events today</div>}
      {timeline.allDay.length > 0 && (
        <ul className="tall">
          {timeline.allDay.map(e => (
            <li key={e.id} className={isMutedLine(e) ? 'muted' : undefined}>
              {e.source === 'bill' ? (
                <Receipt className="wi" size="1em" aria-hidden="true" />
              ) : e.source === 'holiday' ? (
                <Flag className="wi" size="1em" aria-hidden="true" />
              ) : (
                <span className="dot" style={{ background: people.color(e.ownerKey) }} />
              )}
              {e.title}
            </li>
          ))}
        </ul>
      )}
      {timeline.rows.length > 0 && (
        <div className="tev">
          {timeline.rows.map((row, i) => (
            <React.Fragment key={row.event.id}>
              {timeline.nowIndex === i && <div className="nowmark">{wallTimeText(p.hour, p.minute)}</div>}
              <span className={row.past ? 'tm past' : 'tm'}>{row.time}</span>
              <span className={row.past ? 'tt past' : 'tt'}>
                {row.event.title}
                <small>
                  <span className="dot" style={{ background: people.color(row.event.ownerKey) }} />
                  {people.name(row.event.ownerKey)}
                </small>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
      {due.length > 0 && (
        <div className="due">
          <div className="lab">Due today</div>
          {due.map(t => (
            <button
              key={t.id}
              type="button"
              className={t.isCompleted ? 'ck done' : 'ck'}
              aria-pressed={t.isCompleted}
              onClick={() => act.toggleTodo(t)}
            >
              <span className="bx">{t.isCompleted && <Check className="wi" size="1em" aria-hidden="true" />}</span>
              <span className="tx">{t.text}</span>
              <span className="nm">{people.name(t.assignedTo)}</span>
              {!t.isCompleted && t.completeByDate < today && <span className="late">Overdue</span>}
            </button>
          ))}
        </div>
      )}
      {dinner && (
        <div className="foot">
          Dinner<b>{dinner.mealName}</b>
        </div>
      )}
      {solo && (
        <button type="button" className="addmod solo" onClick={onAddModule}>
          <Plus className="wi" size="1em" aria-hidden="true" />
          Add module
        </button>
      )}
    </section>
  );
};

export default WallToday;
