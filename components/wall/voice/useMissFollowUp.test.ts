import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingItem } from '@/types/schema';
import type { VoiceMissDraft } from '@/utils/wall/wallVoiceMiss';
import { MISS_FOLLOW_UP_WINDOW_MS } from '@/utils/wall/wallVoiceMissFollowUp';
import { useMissFollowUp } from './useMissFollowUp';

const item = (id: string, name: string): ShoppingItem => ({ id, name, category: 'Other', isPurchased: false });
const miss = (kind: VoiceMissDraft['kind'], heard = 'add window'): VoiceMissDraft => ({
  kind, heard, free: heard, alternative: '', engine: 'device', view: 'shopping', appVersion: 'wall-4', at: '2026-10-10T23:50:00.000Z',
});

function setup(shoppingList: ShoppingItem[]) {
  const write = vi.fn();
  const hook = renderHook(({ list }) => useMissFollowUp({ shoppingList: list, todos: [] }, write), { initialProps: { list: shoppingList } });
  return { write, hook };
}

describe('useMissFollowUp', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds an undone command and writes it with what was typed in after', () => {
    const { write, hook } = setup([item('w', 'Window')]);
    act(() => hook.result.current({ ...miss('undo'), did: 'Added to Shopping: Window' }));
    expect(write).not.toHaveBeenCalled();
    hook.rerender({ list: [] });
    hook.rerender({ list: [item('x', 'Windex')] });
    act(() => vi.advanceTimersByTime(MISS_FOLLOW_UP_WINDOW_MS));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ ...miss('undo'), did: 'Added to Shopping: Window', after: 'Added to Shopping: Windex' });
  });

  it('writes a held miss with no `after` when nothing was changed', () => {
    const { write, hook } = setup([]);
    act(() => hook.result.current(miss('unparsed')));
    act(() => vi.advanceTimersByTime(MISS_FOLLOW_UP_WINDOW_MS));
    expect(write).toHaveBeenCalledWith(miss('unparsed'));
  });

  it('writes other kinds at once, and a new miss writes the held one first', () => {
    const { write, hook } = setup([]);
    act(() => hook.result.current(miss('cancel', 'never mind')));
    act(() => hook.result.current(miss('no-speech', '')));
    expect(write.mock.calls.map(c => (c[0] as VoiceMissDraft).kind)).toEqual(['cancel', 'no-speech']);
  });

  it('writes a held miss when the page goes away or the wall unmounts', () => {
    const { write, hook } = setup([]);
    act(() => hook.result.current(miss('unparsed')));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(write).toHaveBeenCalledTimes(1);
    act(() => hook.result.current(miss('undo')));
    hook.unmount();
    expect(write).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(MISS_FOLLOW_UP_WINDOW_MS));
    expect(write).toHaveBeenCalledTimes(2);
  });
});
