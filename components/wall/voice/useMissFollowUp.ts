import { useCallback, useEffect, useRef } from 'react';
import type { VoiceMissDraft } from '@/utils/wall/wallVoiceMiss';
import {
  MISS_FOLLOW_UP_WINDOW_MS,
  describeFollowUps,
  noteFollowUps,
  snapshotLists,
  wantsFollowUp,
  type FollowUpChange,
  type FollowUpLists,
  type ListSnapshot,
} from '@/utils/wall/wallVoiceMissFollowUp';

interface PendingMiss {
  draft: VoiceMissDraft;
  baseline: ListSnapshot;
  seen: Map<string, FollowUpChange>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Holds a miss the wall didn't act on (unparsed, undone, cancelled) for
 * MISS_FOLLOW_UP_WINDOW_MS and writes it with what was added or renamed on
 * Shopping and To-dos meanwhile, by hand on the wall or from a phone. The
 * log is create-only, so the record is written once, complete. The next miss,
 * the page going away, or unmounting writes a held one early. Any other kind
 * is written straight away.
 */
export function useMissFollowUp(lists: FollowUpLists, write: (miss: VoiceMissDraft) => void): (miss: VoiceMissDraft) => void {
  const pending = useRef<PendingMiss | null>(null);
  const latest = useRef({ lists, write });
  useEffect(() => {
    latest.current = { lists, write };
  });

  const flush = useCallback(() => {
    const held = pending.current;
    if (!held) return;
    pending.current = null;
    clearTimeout(held.timer);
    const after = describeFollowUps(held.seen);
    latest.current.write(after ? { ...held.draft, after } : held.draft);
  }, []);

  const { shoppingList, todos } = lists;
  useEffect(() => {
    const held = pending.current;
    if (held) held.seen = noteFollowUps(held.baseline, snapshotLists({ shoppingList, todos }), held.seen);
  }, [shoppingList, todos]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return useCallback(
    (miss: VoiceMissDraft) => {
      flush();
      if (!wantsFollowUp(miss.kind)) {
        latest.current.write(miss);
        return;
      }
      pending.current = {
        draft: miss,
        baseline: snapshotLists(latest.current.lists),
        seen: new Map(),
        timer: setTimeout(flush, MISS_FOLLOW_UP_WINDOW_MS),
      };
    },
    [flush]
  );
}
