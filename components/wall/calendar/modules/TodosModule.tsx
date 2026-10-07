import React, { useMemo } from 'react';
import { weekdayName } from '@/utils/wall/wallCalendar';
import { groupTodos } from '@/utils/wall/wallLists';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import WallTodoRow from '@/components/wall/lists/WallTodoRow';
import WallAutoScroll from './WallAutoScroll';

interface TodosModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
}

/** The panel's To-dos module: overdue, today and this week in one list; a long list turns like a wheel. */
const TodosModule: React.FC<TodosModuleProps> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const items = useMemo(
    () => groupTodos(todos, today, timeZone).flatMap(g => g.items.map(t => ({ t, group: g.key }))),
    [todos, today, timeZone]
  );
  if (items.length === 0) return <div className="empty">No to-dos</div>;
  return (
    <WallAutoScroll>
      {items.map(({ t, group }) => (
        <WallTodoRow
          key={t.id}
          todo={t}
          people={people}
          meta={
            <>
              <span className="nm">
                {people.name(t.assignedTo)}
                {group === 'week' ? ` · ${weekdayName(t.completeByDate).slice(0, 3)}` : ''}
              </span>
              {group === 'overdue' && !t.isCompleted && <span className="late">Overdue</span>}
            </>
          }
        />
      ))}
    </WallAutoScroll>
  );
};

export default TodosModule;
