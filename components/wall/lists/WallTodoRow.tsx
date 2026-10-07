import React from 'react';
import { Check } from 'lucide-react';
import type { ToDo } from '@/types/schema';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { subtaskProgress } from '@/utils/subtasks';
import WallSwipeRow from './WallSwipeRow';
import { useWallListActions } from './useWallListActions';

interface WallTodoRowProps {
  todo: ToDo;
  people: WallPeople;
  /** Person / day / overdue text after the label. */
  meta: React.ReactNode;
}

/**
 * One to-do on the wall. A to-do with steps shows them as their own checkable
 * rows under it, indented to the parent's text (a hanging indent), so the
 * family can see and tick them off right here: a habit-linked to-do can't be
 * completed until every step is done. The parent shows "n/m" progress.
 */
const WallTodoRow: React.FC<WallTodoRowProps> = ({ todo, people, meta }) => {
  const act = useWallListActions();
  const subtasks = todo.subtasks ?? [];
  const { done, total } = subtaskProgress(subtasks);

  const row = (
    <WallSwipeRow
      label={todo.text}
      done={todo.isCompleted}
      onToggle={() => act.toggleTodo(todo)}
      onDelete={() => act.deleteTodo(todo)}
      meta={
        <>
          {total > 0 && (
            <span className="stp" title={`${done} of ${total} steps done`}>
              {done}/{total}
            </span>
          )}
          {meta}
        </>
      }
    />
  );
  if (total === 0) return row;

  return (
    <div className="tblk">
      {row}
      <ul className="subs" aria-label={`Steps for ${todo.text}`}>
        {subtasks.map(s => (
          <li key={s.id}>
            <button
              type="button"
              className={s.isDone ? 'sub done' : 'sub'}
              aria-pressed={s.isDone}
              onClick={() => act.toggleSubtask(todo, s)}
            >
              <span className="bx">{s.isDone && <Check className="wi" size="1em" aria-hidden="true" />}</span>
              <span className="tx">{s.text}</span>
              {s.assigneeId && (
                <span className="nm">
                  <span className="dot" style={{ background: people.color(s.assigneeId) }} /> {people.name(s.assigneeId)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WallTodoRow;
