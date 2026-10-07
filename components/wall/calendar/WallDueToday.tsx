import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { dueTodayChecklist } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import WallSubtasks, { WallStepCount } from '@/components/wall/lists/WallSubtasks';
import { WallAvatar } from '@/components/wall/WallAvatar';

interface WallDueTodayProps {
  today: string;
  timeZone: string;
  people: WallPeople;
  /** Arrange mode draws its own heading over the slot. */
  heading?: boolean;
}

/**
 * The day column's Due today: open overdue and due-today to-dos as big
 * checkboxes, each one's steps checkable under it. Sized by the column's fit
 * (--k), so it grows and shrinks with the rest of today. Nothing due → nothing.
 */
const WallDueToday: React.FC<WallDueTodayProps> = ({ today, timeZone, people, heading = true }) => {
  const { todos } = useWallData();
  const act = useWallListActions();
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);
  if (due.length === 0) return heading ? null : <div className="dempty">Nothing due today</div>;
  const doneCount = due.filter(t => t.isCompleted).length;

  return (
    <div className="due">
      {heading && (
        <div className="dh">
          <b>Due today</b>
          <span>
            {doneCount} of {due.length} done
          </span>
        </div>
      )}
      <div className="dg">
        {due.map(t => (
          <div className="dblk" key={t.id}>
            <button type="button" className={t.isCompleted ? 'ck done' : 'ck'} aria-pressed={t.isCompleted} onClick={() => act.toggleTodo(t)}>
              <span className="bx">{t.isCompleted && <Check className="wi" size="1em" aria-hidden="true" />}</span>
              <span className="tx">
                {t.text}
                {!t.isCompleted && t.completeByDate < today && <small className="late">Overdue</small>}
              </span>
              <WallStepCount todo={t} />
              <WallAvatar people={people} who={t.assignedTo} small />
              <span className="sr">{people.name(t.assignedTo)}</span>
            </button>
            <WallSubtasks todo={t} people={people} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default WallDueToday;
