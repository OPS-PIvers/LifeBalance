import React from 'react';
import { Check } from 'lucide-react';
import type { ToDo } from '@/types/schema';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { subtaskProgress } from '@/utils/subtasks';
import { useWallListActions } from './useWallListActions';

/** "2/3" steps done, beside a to-do with steps. Nothing for a to-do without them. */
export const WallStepCount: React.FC<{ todo: ToDo }> = ({ todo }) => {
  const { done, total } = subtaskProgress(todo.subtasks ?? []);
  if (total === 0) return null;
  return (
    <span className="stp" title={`${done} of ${total} steps done`}>
      {done}/{total}
    </span>
  );
};

/**
 * A to-do's steps as their own checkable rows, indented to the parent's text
 * (a hanging indent), so the family can see and tick them off where the
 * to-do shows: the To-dos lists, Due today, and Day view.
 */
const WallSubtasks: React.FC<{ todo: ToDo; people: WallPeople }> = ({ todo, people }) => {
  const act = useWallListActions();
  const subtasks = todo.subtasks ?? [];
  if (subtasks.length === 0) return null;
  return (
    <ul className="subs" aria-label={`Steps for ${todo.text}`}>
      {subtasks.map(s => (
        <li key={s.id}>
          <button type="button" className={s.isDone ? 'sub done' : 'sub'} aria-pressed={s.isDone} onClick={() => act.toggleSubtask(todo, s)}>
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
  );
};

export default WallSubtasks;
