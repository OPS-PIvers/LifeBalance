import { describe, it, expect } from 'vitest';
import { accumulate, ToastAccumulatorState } from './toastAccumulator';

describe('accumulate', () => {
  it('starts a fresh entry for a key with no prior state', () => {
    const state: ToastAccumulatorState = new Map();
    const result = accumulate(state, 'habit-a', 10, 1000, 1500);
    expect(result).toEqual({ net: 10, count: 1 });
    expect(state.get('habit-a')).toEqual({ net: 10, count: 1, lastAt: 1000 });
  });

  it('accumulates repeated deltas within the window', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', 10, 1000, 1500);
    const second = accumulate(state, 'habit-a', 5, 2000, 1500); // +1000ms, within 1500ms window
    expect(second).toEqual({ net: 15, count: 2 });

    const third = accumulate(state, 'habit-a', 5, 2500, 1500); // +500ms, still within window
    expect(third).toEqual({ net: 20, count: 3 });
  });

  it('resets to a fresh entry once the window has expired', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', 10, 1000, 1500);
    const afterExpiry = accumulate(state, 'habit-a', 5, 3000, 1500); // +2000ms, beyond 1500ms window
    expect(afterExpiry).toEqual({ net: 5, count: 1 });
  });

  it('treats an exact boundary hit (now - lastAt === windowMs) as still within the window', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', 10, 1000, 1500);
    const atBoundary = accumulate(state, 'habit-a', 5, 2500, 1500); // exactly +windowMs
    expect(atBoundary).toEqual({ net: 15, count: 2 });
  });

  it('tracks independent keys separately', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', 10, 1000, 1500);
    accumulate(state, 'habit-b', -20, 1000, 1500);
    const a = accumulate(state, 'habit-a', 5, 1200, 1500);
    const b = accumulate(state, 'habit-b', -5, 1200, 1500);

    expect(a).toEqual({ net: 15, count: 2 });
    expect(b).toEqual({ net: -25, count: 2 });
  });

  it('accumulates negative deltas correctly', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', -10, 1000, 1500);
    const result = accumulate(state, 'habit-a', -5, 1500, 1500);
    expect(result).toEqual({ net: -15, count: 2 });
  });

  it('lets net reach zero when opposing deltas cancel out', () => {
    const state: ToastAccumulatorState = new Map();
    accumulate(state, 'habit-a', 10, 1000, 1500);
    const result = accumulate(state, 'habit-a', -10, 1200, 1500);
    expect(result).toEqual({ net: 0, count: 2 });
  });
});
