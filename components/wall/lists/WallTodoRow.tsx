import React from 'react';
import type { ToDo } from '@/types/schema';
import type { WallPeople } from '@/utils/wall/wallPeople';
import WallSwipeRow from './WallSwipeRow';
import WallSubtasks, { WallStepCount } from './WallSubtasks';
import { useWallListActions } from './useWallListActions';

interface WallTodoRowProps {
  todo: ToDo;
  people: WallPeople;
  /** Person / day / overdue text after the label. */
  meta: React.ReactNode;
}

/**
 * One to-do on the wall. A to-do with steps shows them as their own checkable
 * rows under it (WallSubtasks): a habit-linked to-do can't be completed until
 * every step is done. The parent shows "n/m" progress.
 */
const WallTodoRow: React.FC<WallTodoRowProps> = ({ todo, people, meta }) => {
  const act = useWallListActions();
  const row = (
    <WallSwipeRow
      label={todo.text}
      done={todo.isCompleted}
      onToggle={() => act.toggleTodo(todo)}
      onDelete={() => act.deleteTodo(todo)}
      meta={
        <>
          <WallStepCount todo={todo} />
          {meta}
        </>
      }
    />
  );
  if (!todo.subtasks?.length) return row;

  return (
    <div className="tblk">
      {row}
      <WallSubtasks todo={todo} people={people} />
    </div>
  );
};

export default WallTodoRow;
