import React, { useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import { dueTodayChecklist, eventTimeText, todayFocus, todayTimeline, untilText } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import { useWallFit } from '@/components/wall/useWallFit';
import { WallAvatar } from '@/components/wall/WallAvatar';
import WallMasthead from '@/components/wall/WallMasthead';

/** Rows after "Next" before the rest folds into "+N more today" (the fit rule shrinks them first). */
const LATER_MAX = 5;
/** Finished events kept under "Earlier today" (the latest ones); older ones fold into "+N earlier". */
const EARLIER_MAX = 3;

interface WallTodayProps {
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  weather: WallWeather | null;
  onWeather: () => void;
  showDueToday: boolean;
  /** Opens Day view on today ("+N more today"). */
  onOpenDay: () => void;
}

/**
 * The Week screen's day column: the masthead, the event that's next (or
 * running), the rest of today, Due today and dinner tonight. Its type grows
 * to fill the column on a quiet day and shrinks on a busy one.
 */
const WallToday: React.FC<WallTodayProps> = ({ today, now, timeZone, people, weather, onWeather, showDueToday, onOpenDay }) => {
  const { wallEvents, todos, mealPlan } = useWallData();
  const act = useWallListActions();
  const timeline = useMemo(() => todayTimeline(wallEvents, today, now, timeZone), [wallEvents, today, now, timeZone]);
  const focus = useMemo(() => todayFocus(timeline, now), [timeline, now]);
  const due = useMemo(() => (showDueToday ? dueTodayChecklist(todos, today, timeZone) : []), [showDueToday, todos, today, timeZone]);
  const dinner = mealPlan.find(m => m.date === today && m.type === 'dinner');
  const ref = useRef<HTMLElement>(null);
  useWallFit(ref, { on: true, min: 0.8, max: 1.4 });

  const lead = focus.lead;
  let leadLabel = '';
  if (lead) {
    const end = lead.event.end ? eventTimeText(lead.event.end, timeZone) : '';
    leadLabel = focus.leadIsNow ? (end ? `Now · until ${end}` : 'Now') : `Next · ${untilText(Date.parse(lead.event.start ?? ''), now.getTime())}`;
  }
  const later = focus.later.slice(0, LATER_MAX);
  const moreLater = focus.later.length - later.length;
  const earlier = focus.earlier.slice(-EARLIER_MAX);
  const moreEarlier = focus.earlier.length - earlier.length;
  const doneCount = due.filter(t => t.isCompleted).length;

  return (
    <section ref={ref} className="today" aria-label="Today">
      <WallMasthead now={now} timeZone={timeZone} weather={weather} onWeather={onWeather} untimed={timeline.allDay} people={people} />
      {lead ? (
        <div className="nx">
          <span className="nxk">{leadLabel}</span>
          <b className="nxt">{lead.event.title}</b>
          <span className="nxw">
            <span className="tm">{lead.time}</span>
            <WallAvatar people={people} who={lead.event.ownerKey} small />
            {lead.event.ownerKey === 'family' || !lead.event.ownerKey ? 'Everyone' : people.name(lead.event.ownerKey)}
          </span>
        </div>
      ) : (
        <div className="tempty">{timeline.rows.length > 0 ? 'Nothing else today' : 'No events today'}</div>
      )}
      {later.length > 0 && (
        <div className="lt">
          {later.map(row => (
            <div className="lr" key={row.event.id}>
              <span className="tm">{row.time}</span>
              <WallAvatar people={people} who={row.event.ownerKey} />
              <span className="tt">{row.event.title}</span>
            </div>
          ))}
          {moreLater > 0 && (
            <button type="button" className="more-link" onClick={onOpenDay}>
              +{moreLater} more today
            </button>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <div className="earl">
          <span className="ek">Earlier today</span>
          {earlier.map(row => (
            <div className="er" key={row.event.id}>
              <span className="tm">{row.time}</span>
              <span className="tt">{row.event.title}</span>
            </div>
          ))}
          {moreEarlier > 0 && <span className="em">+{moreEarlier} earlier</span>}
        </div>
      )}
      {due.length > 0 && (
        <div className="due">
          <div className="dh">
            <b>Due today</b>
            <span>
              {doneCount} of {due.length} done
            </span>
          </div>
          <div className="dg">
            {due.map(t => (
              <button
                key={t.id}
                type="button"
                className={t.isCompleted ? 'ck done' : 'ck'}
                aria-pressed={t.isCompleted}
                onClick={() => act.toggleTodo(t)}
              >
                <span className="bx">{t.isCompleted && <Check className="wi" size="1em" aria-hidden="true" />}</span>
                <WallAvatar people={people} who={t.assignedTo} small />
                <span className="tx">
                  {t.text}
                  {!t.isCompleted && t.completeByDate < today && <small className="late">Overdue</small>}
                </span>
                <span className="sr">{people.name(t.assignedTo)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {dinner && (
        <div className="foot">
          <span>Dinner tonight</span>
          <b>{dinner.mealName}</b>
        </div>
      )}
    </section>
  );
};

export default WallToday;
