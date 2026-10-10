import type { ToDo } from '@/types/schema';
import type { TodayRow } from '@/utils/wall/wallCalendar';

/** Lanes across the day: Everyone plus up to this many people. */
export const BOARD_MAX_PEOPLE = 4;
/** The lane key for people past the cap (and owners who've left). */
export const BOARD_OTHERS = 'others';

export interface BoardLane {
  /** 'family', a member uid, or BOARD_OTHERS. */
  key: string;
  rows: TodayRow[];
  /** That lane's to-dos due today (and still-open overdue ones). */
  todos: ToDo[];
}

const isFamily = (key: string | undefined) => !key || key === 'family';

/**
 * Today split into one lane per person, in roster order, so everyone is always
 * in the same place; Everyone first. Events go by owner, to-dos by assignee:
 * an unassigned to-do is the household's, under Everyone. Past the cap the
 * last lane is "Others": everyone left over, plus owners and assignees no
 * longer in the household.
 */
export function boardLanes(rows: readonly TodayRow[], due: readonly ToDo[], memberUids: readonly string[]): BoardLane[] {
  const overflow = memberUids.length > BOARD_MAX_PEOPLE;
  const own = memberUids.slice(0, overflow ? BOARD_MAX_PEOPLE - 1 : BOARD_MAX_PEOPLE);
  const lanes: BoardLane[] = ['family', ...own].map(key => ({ key, rows: [], todos: [] }));
  const others: BoardLane = { key: BOARD_OTHERS, rows: [], todos: [] };
  const laneFor = (key: string | undefined): BoardLane => (isFamily(key) ? lanes[0] : lanes.find(l => l.key === key)) ?? others;
  for (const row of rows) laneFor(row.event.ownerKey).rows.push(row);
  for (const todo of due) laneFor(todo.assignedTo).todos.push(todo);
  if (overflow || others.rows.length > 0 || others.todos.length > 0) lanes.push(others);
  return lanes;
}
