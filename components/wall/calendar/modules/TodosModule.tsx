import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { weekdayName } from '@/utils/wall/wallCalendar';
import { groupTodos } from '@/utils/wall/wallLists';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallToaster } from '@/components/wall/wallToast';

interface TodosModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
}

/** The panel's To-dos module: overdue, today and this week in one list. */
const TodosModule: React.FC<TodosModuleProps> = ({ today, timeZone, people }) => {
  const { todos, actions } = useWallData();
  const toaster = useWallToaster();
  const items = useMemo(() => groupTodos(todos, today, timeZone).flatMap(g => g.items.map(t => ({ t, group: g.key }))), [todos, today, timeZone]);
  if (items.length === 0) return <div className="empty">No to-dos</div>;
  return (
    <>
      {items.map(({ t, group }) => (
        <div className={t.isCompleted ? 'row done' : 'row'} key={t.id}>
          <button
            type="button"
            className="in"
            aria-pressed={t.isCompleted}
            onClick={() =>
              t.isCompleted
                ? toaster.run(actions.uncompleteToDo(t.id), `Unchecked ${t.text}`, () => actions.completeToDo(t.id))
                : toaster.run(actions.completeToDo(t.id), `Completed ${t.text}`, () => actions.uncompleteToDo(t.id))
            }
          >
            <span className="bx">{t.isCompleted && <Check className="wi" size="1em" aria-hidden="true" />}</span>
            <span className="tx">{t.text}</span>
            <span className="nm">
              {people.name(t.assignedTo)}
              {group === 'week' ? ` · ${weekdayName(t.completeByDate).slice(0, 3)}` : ''}
            </span>
            {group === 'overdue' && !t.isCompleted && <span className="late">Overdue</span>}
          </button>
        </div>
      ))}
    </>
  );
};

export default TodosModule;
