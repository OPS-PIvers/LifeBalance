import type { ShoppingItem, ToDo, WallVoiceMissKind } from '@/types/schema';
import { MISS_TEXT_MAX } from '@/utils/wall/wallVoiceMiss';

/**
 * What the household did by hand right after a voice command went wrong
 * (docs/DECISIONS.md "Voice misses"). Say "add Windex", get "Window", undo it
 * and type "Windex": the miss is held for a short window and logged with
 * `after: "Added to Shopping: Windex"`, so the nightly routine sees the word
 * that was meant, not just the one that was heard.
 */

/** How long after a miss a hand-made add or rename still counts as its follow-up. */
export const MISS_FOLLOW_UP_WINDOW_MS = 120_000;

/** Misses worth waiting on: the ones where the wall didn't do what was said. */
export const FOLLOW_UP_KINDS: readonly WallVoiceMissKind[] = ['unparsed', 'undo', 'cancel'];

export const wantsFollowUp = (kind: WallVoiceMissKind) => FOLLOW_UP_KINDS.includes(kind);

/** The lists voice can write to, which is where a fix by hand lands. */
export interface FollowUpLists {
  shoppingList: ShoppingItem[];
  todos: ToDo[];
}

/** `shopping:<id>` / `todo:<id>` → the item's name, at one moment. */
export type ListSnapshot = Map<string, string>;

/** What happened to one item since the miss. */
export interface FollowUpChange {
  list: 'Shopping' | 'To-dos';
  name: string;
  /** Set for an item that was already there and was renamed. */
  from?: string;
}

export function snapshotLists({ shoppingList, todos }: FollowUpLists): ListSnapshot {
  const snap: ListSnapshot = new Map();
  for (const item of shoppingList) snap.set(`shopping:${item.id}`, item.name);
  for (const todo of todos) snap.set(`todo:${todo.id}`, todo.text);
  return snap;
}

/**
 * Folds the lists as they are now into what's been seen since the miss: items
 * that weren't there at the miss are adds, items whose name changed are
 * renames. An add that's later renamed keeps its latest name; one that's later
 * deleted stays (a typo typed and removed is still a clue).
 */
export function noteFollowUps(baseline: ListSnapshot, current: ListSnapshot, seen: Map<string, FollowUpChange>): Map<string, FollowUpChange> {
  const next = new Map(seen);
  for (const [key, name] of current) {
    const list = key.startsWith('shopping:') ? 'Shopping' : 'To-dos';
    const before = baseline.get(key);
    if (before === undefined) next.set(key, { list, name });
    else if (before !== name) next.set(key, { list, name, from: before });
  }
  return next;
}

/** One line for the log, e.g. "Added to Shopping: Windex; Renamed on To-dos: Window → Windex". */
export function describeFollowUps(seen: Map<string, FollowUpChange>): string {
  return [...seen.values()]
    .map(c => (c.from === undefined ? `Added to ${c.list}: ${c.name}` : `Renamed on ${c.list}: ${c.from} → ${c.name}`))
    .join('; ')
    .slice(0, MISS_TEXT_MAX);
}
