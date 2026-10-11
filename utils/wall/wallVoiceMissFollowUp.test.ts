import { describe, expect, it } from 'vitest';
import type { ShoppingItem, ToDo } from '@/types/schema';
import { MISS_TEXT_MAX } from './wallVoiceMiss';
import { describeFollowUps, noteFollowUps, snapshotLists, wantsFollowUp } from './wallVoiceMissFollowUp';

const item = (id: string, name: string): ShoppingItem => ({ id, name, category: 'Other', isPurchased: false });
const todo = (id: string, text: string): ToDo => ({ id, text, completeByDate: '2026-10-10', isCompleted: false, createdBy: 'u1', createdAt: '2026-10-10T12:00:00.000Z' });

describe('voice miss follow-ups', () => {
  it('waits only on misses the wall did not act on', () => {
    expect(['unparsed', 'undo', 'cancel'].every(k => wantsFollowUp(k as 'undo'))).toBe(true);
    expect(wantsFollowUp('no-speech')).toBe(false);
    expect(wantsFollowUp('ai')).toBe(false);
  });

  it('sees "Windex" typed in after an undone "Window"', () => {
    const baseline = snapshotLists({ shoppingList: [item('a', 'Milk'), item('w', 'Window')], todos: [] });
    // The undo removes "Window"; then Windex is typed in by hand.
    const seen = noteFollowUps(baseline, snapshotLists({ shoppingList: [item('a', 'Milk'), item('x', 'Windex')], todos: [] }), new Map());
    expect(describeFollowUps(seen)).toBe('Added to Shopping: Windex');
  });

  it('records renames, to-dos, a later rename of an add, and keeps a deleted add', () => {
    const baseline = snapshotLists({ shoppingList: [item('a', 'Window')], todos: [todo('t', 'Cal mom')] });
    let seen = noteFollowUps(baseline, snapshotLists({ shoppingList: [item('a', 'Windex'), item('b', 'Papr towels')], todos: [todo('t', 'Cal mom')] }), new Map());
    seen = noteFollowUps(baseline, snapshotLists({ shoppingList: [item('a', 'Windex'), item('b', 'Paper towels')], todos: [todo('t', 'Call mom'), todo('n', 'Soccer')] }), seen);
    seen = noteFollowUps(baseline, snapshotLists({ shoppingList: [item('a', 'Windex')], todos: [todo('t', 'Call mom')] }), seen);
    expect(describeFollowUps(seen)).toBe(
      'Renamed on Shopping: Window → Windex; Added to Shopping: Paper towels; Renamed on To-dos: Cal mom → Call mom; Added to To-dos: Soccer'
    );
  });

  it('is empty when nothing changed, and clipped to the log bound', () => {
    const baseline = snapshotLists({ shoppingList: [item('a', 'Milk')], todos: [] });
    expect(describeFollowUps(noteFollowUps(baseline, baseline, new Map()))).toBe('');
    const many = Array.from({ length: 40 }, (_, i) => item(`n${i}`, `Item number ${i}`));
    expect(describeFollowUps(noteFollowUps(baseline, snapshotLists({ shoppingList: many, todos: [] }), new Map()))).toHaveLength(MISS_TEXT_MAX);
  });
});
