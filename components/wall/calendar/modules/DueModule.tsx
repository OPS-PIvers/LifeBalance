import React, { useMemo } from 'react';
import { dueTodayChecklist } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import WallTodoRow from '@/components/wall/lists/WallTodoRow';
import WallAutoScroll from './WallAutoScroll';

interface DueModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
}

/**
 * "Due today" as a module: the day column's checklist (overdue, due today,
 * and what was ticked off today), steps included, in the panel's list style.
 */
const DueModule: React.FC<DueModuleProps> = ({ today, timeZone, people }) => {
  const { todos } = useWallData();
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);
  if (due.length === 0) return <div className="empty">Nothing due today</div>;
  return (
    <WallAutoScroll>
      {due.map(t => (
        <WallTodoRow
          key={t.id}
          todo={t}
          people={people}
          meta={
            <>
              <span className="nm">{people.name(t.assignedTo)}</span>
              {!t.isCompleted && t.completeByDate < today && <span className="late">Overdue</span>}
            </>
          }
        />
      ))}
    </WallAutoScroll>
  );
};

export default DueModule;
