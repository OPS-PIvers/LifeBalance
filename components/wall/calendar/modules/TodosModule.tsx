import React, { useMemo } from 'react';
import { weekdayName } from '@/utils/wall/wallCalendar';
import { groupTodos } from '@/utils/wall/wallLists';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import WallSwipeRow from '@/components/wall/lists/WallSwipeRow';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';

interface TodosModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
}

/** The panel's To-dos module: overdue, today and this week in one list. */
const TodosModule: React.FC<TodosModuleProps> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const act = useWallListActions();
  const items = useMemo(
    () => groupTodos(todos, today, timeZone).flatMap(g => g.items.map(t => ({ t, group: g.key }))),
    [todos, today, timeZone]
  );
  if (items.length === 0) return <div className="empty">No to-dos</div>;
  return (
    <>
      {items.map(({ t, group }) => (
        <WallSwipeRow
          key={t.id}
          label={t.text}
          done={t.isCompleted}
          onToggle={() => act.toggleTodo(t)}
          onDelete={() => act.deleteTodo(t)}
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
    </>
  );
};

export default TodosModule;
