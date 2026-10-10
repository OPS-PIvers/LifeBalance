import React, { useMemo, useState } from 'react';
import type { ToDo } from '@/types/schema';
import { dueTodayChecklist, eventTimeText, groupComingUp, splitComingUpDay, weekdayName } from '@/utils/wall/wallCalendar';
import { groupTodos } from '@/utils/wall/wallLists';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { WallDot } from '@/components/wall/WallAvatar';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';
import WallTodoRow from '@/components/wall/lists/WallTodoRow';
import WallAutoScroll from '@/components/wall/calendar/modules/WallAutoScroll';
import WallModuleFill from '@/components/wall/calendar/modules/WallModuleFill';

/** Coming up, Board size: one row per day with something on it, its first two events and its untimed line. */
export const BoardComing: React.FC<{ today: string; timeZone: string; people: WallPeople; onOpenDay: (date: string) => void }> = ({
  today,
  timeZone,
  people,
  onOpenDay,
}) => {
  const { wallEvents } = useWallData();
  const days = useMemo(() => groupComingUp(wallEvents, today, 14), [wallEvents, today]);
  if (days.length === 0) return <div className="empty">Nothing in the next two weeks</div>;
  return (
    <WallModuleFill>
      {days.map(day => {
        const { untimed, timed } = splitComingUpDay(day);
        return (
          <button type="button" key={day.date} className="cr" onClick={() => onOpenDay(day.date)}>
            <span className="cdh">
              <b>{day.rel ?? day.weekday}</b>
              <small>{day.rel ? `${day.weekday} ${day.dayOfMonth}` : day.dayOfMonth}</small>
            </span>
            <span className="ce">
              {timed.slice(0, 2).map(e => (
                <span key={e.id} className="ci">
                  <WallDot people={people} who={e.ownerKey} />
                  <span className="tm">{eventTimeText(e.start, timeZone)}</span>
                  <span className="tt">{e.title}</span>
                </span>
              ))}
              {timed.length > 2 && <span className="cm">+{timed.length - 2} more</span>}
              {untimed.length > 0 && <WallUntimedLine events={untimed} people={people} />}
            </span>
          </button>
        );
      })}
    </WallModuleFill>
  );
};

/** Who has to-dos due today, done / total: unassigned (anyone's) first like the lanes, then roster order. */
function dueByPerson(due: readonly ToDo[], people: WallPeople): { key: string; done: number; total: number }[] {
  const by = new Map<string, ToDo[]>();
  for (const t of due) {
    const key = t.assignedTo ?? 'family';
    by.set(key, [...(by.get(key) ?? []), t]);
  }
  return ['family', ...people.members.map(m => m.uid)]
    .filter(k => by.has(k))
    .map(key => {
      const list = by.get(key) ?? [];
      return { key, done: list.filter(t => t.isCompleted).length, total: list.length };
    });
}

/**
 * Due today, Board size: a ring per person (done / due), then the to-dos
 * themselves as big checkboxes. Tapping a ring narrows the list to that
 * person; tapping it again shows everyone. Checking one off gets the wall's
 * usual 10 s Undo.
 */
export const BoardDue: React.FC<{ today: string; timeZone: string; people: WallPeople }> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);
  const rings = useMemo(() => dueByPerson(due, people), [due, people]);
  const [who, setWho] = useState<string | null>(null);
  if (due.length === 0) return <div className="empty">Nothing due today</div>;
  const shown = who ? due.filter(t => (t.assignedTo ?? 'family') === who) : due;
  const name = (key: string) => (key === 'family' ? 'Anyone' : (people.firstName(key) ?? people.name(key)));
  return (
    <div className="bdue">
      <div className="rings" role="group" aria-label="Show one person's to-dos">
        {rings.map(r => (
          <button
            type="button"
            key={r.key}
            className="prs"
            aria-pressed={who === r.key}
            style={{ '--c': people.color(r.key) } as React.CSSProperties}
            onClick={() => setWho(w => (w === r.key ? null : r.key))}
          >
            <Ring done={r.done} total={r.total} />
            <small>{name(r.key)}</small>
          </button>
        ))}
      </div>
      <WallAutoScroll>
        {shown.map(t => (
          <WallTodoRow
            key={t.id}
            todo={t}
            people={people}
            swipeToDelete={false}
            meta={
              <>
                {!t.isCompleted && t.completeByDate < today && <span className="late">Overdue</span>}
                {!who && <WallDot people={people} who={t.assignedTo} />}
              </>
            }
          />
        ))}
      </WallAutoScroll>
    </div>
  );
};

/** A progress ring in the person's color, the count inside. */
const Ring: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? done / total : 0;
  return (
    <span className={done === total ? 'rg all' : 'rg'}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="trk" />
        {done > 0 && <circle cx="36" cy="36" r={r} className="val" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 36 36)" />}
      </svg>
      <b>
        {done}/{total}
      </b>
    </span>
  );
};

/** To-dos, Board size: overdue, today and this week, each owner as a color dot (the lanes' colors), like Due today. */
export const BoardTodos: React.FC<{ today: string; timeZone: string; people: WallPeople }> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const items = useMemo(() => groupTodos(todos, today, timeZone).flatMap(g => g.items.map(t => ({ t, group: g.key }))), [todos, today, timeZone]);
  if (items.length === 0) return <div className="empty">No to-dos</div>;
  return (
    <WallAutoScroll>
      {items.map(({ t, group }) => (
        <WallTodoRow
          key={t.id}
          todo={t}
          people={people}
          swipeToDelete={false}
          meta={
            <>
              {group === 'week' && <span className="nm">{weekdayName(t.completeByDate).slice(0, 3)}</span>}
              {group === 'overdue' && !t.isCompleted && <span className="late">Overdue</span>}
              <WallDot people={people} who={t.assignedTo} />
            </>
          }
        />
      ))}
    </WallAutoScroll>
  );
};
