import React, { useMemo, useState } from 'react';
import { weekdayName } from '@/utils/wall/wallCalendar';
import { groupTodos } from '@/utils/wall/wallLists';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import WallTodoRow from './WallTodoRow';

interface WallTodosProps {
  today: string;
  timeZone: string;
  people: WallPeople;
}

/**
 * To-dos (plan §3): Overdue / Today / This week with person filter chips.
 * Saved-for-later items never reach the wall (the providers drop them).
 */
const WallTodos: React.FC<WallTodosProps> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const [person, setPerson] = useState('all');
  const groups = useMemo(() => groupTodos(todos, today, timeZone, person), [todos, today, timeZone, person]);
  const chips = [{ key: 'all', name: 'Everyone' }, { key: 'family', name: 'Family' }, ...people.members.map(m => ({ key: m.uid, name: m.name }))];

  return (
    <>
      <div className="pchips" role="group" aria-label="Filter by person">
        {chips.map(c => (
          <button key={c.key} type="button" className="pchip" aria-pressed={person === c.key} onClick={() => setPerson(c.key)}>
            {c.key !== 'all' && <span className="dot" style={{ background: people.color(c.key) }} />}
            {c.name}
          </button>
        ))}
      </div>
      <div className="lists">
        {groups.length === 0 ? (
          <div className="empty">No to-dos</div>
        ) : (
          <div className="flow2">
            {groups.map(g => (
              <section className="sec" key={g.key} aria-label={g.title}>
                <h3>
                  {g.title}
                  <span>{g.open} open</span>
                </h3>
                {g.items.map(t => (
                  <WallTodoRow
                    key={t.id}
                    todo={t}
                    people={people}
                    meta={
                      <span className="nm">
                        <span className="dot" style={{ background: people.color(t.assignedTo) }} /> {people.name(t.assignedTo)}
                        {g.key !== 'today' ? ` · ${weekdayName(t.completeByDate).slice(0, 3)}` : ''}
                      </span>
                    }
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default WallTodos;
