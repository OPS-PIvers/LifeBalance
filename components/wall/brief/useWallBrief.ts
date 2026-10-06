import { useCallback, useEffect, useRef, useState } from 'react';
import type { WallBrief } from '@/utils/wall/wallBrief';
import type { WallSound } from '@/components/wall/sound/wallSound';

/** The card stays this long after the last line is read (or after it opens, when sound is off). */
export const BRIEF_LINGER_MS = 30_000;

export interface BriefState {
  brief: WallBrief;
  /** The line being read, or -1. */
  line: number;
  speaking: boolean;
}

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/**
 * Plays a day brief or a spoken answer (plan §12): a chime, then each line read in turn while
 * the card highlights it. With sound locked or set to chime only, the card
 * just shows.
 */
export function useWallBrief(sound: WallSound, speak: boolean) {
  const [state, setState] = useState<BriefState | null>(null);
  const token = useRef(0);

  const open = useCallback(
    (brief: WallBrief) => {
      token.current += 1;
      const mine = token.current;
      sound.stop();
      const live = speak && sound.getState() === 'ready';
      setState({ brief, line: -1, speaking: live });
      if (!live) {
        sound.chime('brief');
        return;
      }
      void (async () => {
        brief.lines.forEach(l => {
          if (l.speech) sound.prepare(l.speech);
        });
        await wait(sound.chime('brief'));
        for (let i = 0; i < brief.lines.length; i++) {
          if (mine !== token.current) return;
          const speech = brief.lines[i]?.speech ?? '';
          // An answer's list rows are shown, not read: its headline already said them.
          if (!speech) continue;
          setState(s => (s ? { ...s, line: i } : s));
          await sound.speak(speech);
        }
        if (mine === token.current) setState(s => (s ? { ...s, line: -1, speaking: false } : s));
      })();
    },
    [sound, speak]
  );

  const close = useCallback(() => {
    token.current += 1;
    sound.stop();
    setState(null);
  }, [sound]);

  const speaking = state?.speaking ?? false;
  const shown = state !== null;
  useEffect(() => {
    if (!shown || speaking) return undefined;
    const id = window.setTimeout(() => setState(null), BRIEF_LINGER_MS);
    return () => window.clearTimeout(id);
  }, [shown, speaking]);

  return { state, open, close };
}
