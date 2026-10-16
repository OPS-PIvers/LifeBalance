import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The wall runs for weeks without a reload, so its dated listeners must move
// with the day (plan 005): 15 quiet days in, a window frozen at mount had
// emptied tonight's dinner.

interface Ref {
  __path: string;
  withConverter: () => Ref;
}
interface Query {
  __path: string;
  bounds: Record<string, string>;
}

const firestore = vi.hoisted(() => ({
  queries: [] as { path: string; bounds: Record<string, string>; unsub: ReturnType<typeof vi.fn> }[],
  snapshotHandlers: [] as ((snap: unknown) => void)[],
}));
const listeners = vi.hoisted(() => ({
  todoAttaches: 0,
  mealRanges: [] as { start: string; end: string }[],
  unsubs: [] as ReturnType<typeof vi.fn>[],
}));
const day = vi.hoisted(() => ({ value: '2026-10-16', set: null as ((v: string) => void) | null }));

vi.mock('firebase/firestore', () => {
  const ref = (path: string): Ref => {
    const r: Ref = { __path: path, withConverter: () => r };
    return r;
  };
  return {
    doc: (_db: unknown, path: string) => ref(path),
    collection: (_db: unknown, path: string) => ref(path),
    where: (field: string, op: string, value: string) => ({ field, op, value }),
    query: (base: Ref, ...wheres: { field: string; op: string; value: string }[]): Query => ({
      __path: base.__path,
      bounds: Object.fromEntries(wheres.map(w => [`${w.field} ${w.op}`, w.value])),
    }),
    onSnapshot: (target: Ref | Query, next: (snap: unknown) => void) => {
      const unsub = vi.fn();
      if ('bounds' in target) firestore.queries.push({ path: target.__path, bounds: target.bounds, unsub });
      firestore.snapshotHandlers.push(next);
      return unsub;
    },
    updateDoc: vi.fn(),
    addDoc: vi.fn(),
    Timestamp: { fromMillis: (ms: number) => ({ ms }) },
  };
});
vi.mock('@/firebase.config', () => ({ db: {}, getFunctionsInstance: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ householdId: 'h1', displayId: 'd1', user: { uid: 'display_d1' } }),
}));
vi.mock('@/hooks/useLocalToday', async () => {
  const { useState } = await import('react');
  return {
    useLocalToday: () => {
      const [value, setValue] = useState(day.value);
      day.set = setValue;
      return value;
    },
  };
});
vi.mock('@/contexts/household/listeners/shoppingListeners', () => ({
  attachShoppingListeners: () => {
    const unsub = vi.fn();
    listeners.unsubs.push(unsub);
    return [unsub];
  },
}));
vi.mock('@/contexts/household/listeners/todoListeners', () => ({
  attachTodoListeners: () => {
    listeners.todoAttaches += 1;
    const unsub = vi.fn();
    listeners.unsubs.push(unsub);
    return [unsub];
  },
}));
vi.mock('@/contexts/household/listeners/mealListeners', () => ({
  attachMealListeners: ({ mealPlanRange }: { mealPlanRange: { start: string; end: string } }) => {
    listeners.mealRanges.push(mealPlanRange);
    const unsub = vi.fn();
    listeners.unsubs.push(unsub);
    return [unsub];
  },
}));
vi.mock('@/components/wall/wallCalendarService', () => ({
  syncWallCalendarsNow: vi.fn(),
  synthesizeWallSpeech: vi.fn(),
}));

import WallFirestoreProvider from './WallFirestoreProvider';

const eventBounds = () => firestore.queries.filter(q => q.path === 'households/h1/wallEvents');

beforeEach(() => {
  firestore.queries.length = 0;
  firestore.snapshotHandlers.length = 0;
  listeners.todoAttaches = 0;
  listeners.mealRanges.length = 0;
  listeners.unsubs.length = 0;
  day.value = '2026-10-16';
});

describe('WallFirestoreProvider date windows', () => {
  it('re-attaches the dated listeners with fresh windows when the day changes', () => {
    const onRevoked = vi.fn();
    render(
      <WallFirestoreProvider onRevoked={onRevoked}>
        <span />
      </WallFirestoreProvider>
    );

    expect(eventBounds()).toHaveLength(1);
    expect(eventBounds()[0]?.bounds).toEqual({ 'date >=': '2026-09-01', 'date <=': '2027-01-16' });
    expect(listeners.mealRanges).toEqual([{ start: '2026-10-15', end: '2026-10-30' }]);
    expect(listeners.todoAttaches).toBe(1);
    const firstEvents = eventBounds()[0];
    const firstHelperUnsubs = [...listeners.unsubs];

    // Twenty days of uptime later, just past midnight.
    act(() => day.set?.('2026-11-05'));

    expect(firstEvents?.unsub).toHaveBeenCalledTimes(1);
    firstHelperUnsubs.forEach(u => expect(u).toHaveBeenCalledTimes(1));
    expect(eventBounds()).toHaveLength(2);
    expect(eventBounds()[1]?.bounds).toEqual({ 'date >=': '2026-10-01', 'date <=': '2027-02-05' });
    expect(listeners.mealRanges[1]).toEqual({ start: '2026-11-04', end: '2026-11-19' });
    // The completed-to-dos window is computed at attach time, so it moves too.
    expect(listeners.todoAttaches).toBe(2);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('does not re-attach while the day stays the same', () => {
    const { rerender } = render(
      <WallFirestoreProvider onRevoked={vi.fn()}>
        <span />
      </WallFirestoreProvider>
    );
    act(() => day.set?.('2026-10-16'));
    rerender(
      <WallFirestoreProvider onRevoked={vi.fn()}>
        <span />
      </WallFirestoreProvider>
    );
    expect(eventBounds()).toHaveLength(1);
    expect(listeners.todoAttaches).toBe(1);
  });
});
