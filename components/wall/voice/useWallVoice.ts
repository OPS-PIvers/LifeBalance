import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WallVoiceEngine } from '@/types/schema';
import type { WallVoiceCommand, WallVoiceContext } from '@/services/geminiService.types';
import { parseWallVoiceAudio, parseWallVoiceText } from '@/services/geminiService';
import {
  parseLocalCommand,
  pickVoiceEngine,
  resolveVoiceCommand,
  voiceContextFrom,
  type LocalCommand,
  type VoiceSupport,
  type VoiceTarget,
} from '@/utils/wall/wallVoice';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import type { WallToaster } from '@/components/wall/wallToast';
import {
  VoiceCaptureError,
  audioSupported,
  createAudioEngine,
  createSpeechEngine,
  getSpeechRecognition,
  type VoiceCapture,
  type VoiceEngine,
  type VoiceSession,
} from './voiceEngines';

/** The banner's states (plan §3 "Voice"). */
export type WallVoiceState =
  | { phase: 'listening'; interim: string }
  | { phase: 'working'; heard: string | null }
  | { phase: 'result'; id: number; title: string; text: string; undo?: () => Promise<void>; show?: VoiceTarget }
  | { phase: 'error'; id: number; title: string; text: string; retry: boolean };

export const WALL_VOICE_BANNER_MS = 10_000;

export interface WallVoiceDeps {
  support?: VoiceSupport;
  createEngine?: (kind: 'speech' | 'audio') => VoiceEngine;
  parseText?: (householdId: string, transcript: string, ctx: WallVoiceContext) => Promise<WallVoiceCommand>;
  parseAudio?: (householdId: string, data: string, mimeType: string, ctx: WallVoiceContext) => Promise<WallVoiceCommand>;
}

interface UseWallVoiceOptions {
  setting: WallVoiceEngine;
  today: string;
  timeZone: string;
  onShow: (target: VoiceTarget) => void;
  onRotate: (on: boolean) => void;
  deps?: WallVoiceDeps;
}

interface Captured {
  write: Promise<unknown>;
  undo?: () => Promise<void>;
}

function defaultCreateEngine(kind: 'speech' | 'audio'): VoiceEngine {
  const Ctor = getSpeechRecognition();
  return kind === 'speech' && Ctor ? createSpeechEngine(Ctor) : createAudioEngine();
}

const quote = (text: string) => `“${text}”`;

function parseErrorState(error: unknown): { title: string; text: string; retry: boolean } {
  const message = error instanceof Error ? error.message : '';
  if (/quota/i.test(message)) {
    return { title: "Today's AI allowance is used up", text: 'Use Add for now. Voice adds work again tomorrow.', retry: false };
  }
  if (/temporarily disabled/i.test(message)) {
    return { title: 'Voice is turned off right now', text: 'Use Add instead.', retry: false };
  }
  return { title: 'Something went wrong', text: "Couldn't understand that command. Try again.", retry: true };
}

/**
 * Tap-to-talk (plan §4.10): capture → local grammar (no AI) → Gemini intent →
 * the same list writes as a tap, with Undo. Writes go through
 * useWallListActions, whose toast is captured into the voice banner instead.
 */
export function useWallVoice({ setting, today, timeZone, onShow, onRotate, deps }: UseWallVoiceOptions) {
  const { householdId, members, groceryCatalog } = useWallData();
  const [state, setState] = useState<WallVoiceState | null>(null);
  const support = useMemo<VoiceSupport>(
    () => deps?.support ?? { speech: Boolean(getSpeechRecognition()), audio: audioSupported() },
    [deps?.support]
  );
  const createEngine = deps?.createEngine ?? defaultCreateEngine;
  const parseText = deps?.parseText ?? parseWallVoiceText;
  const parseAudio = deps?.parseAudio ?? parseWallVoiceAudio;

  const engines = useRef<Partial<Record<'speech' | 'audio', VoiceEngine>>>({});
  const speechRefused = useRef(false);
  const session = useRef<VoiceSession | null>(null);
  // Bumped on every start/cancel, so a late result from an old session is dropped.
  const epoch = useRef(0);
  const seq = useRef(0);
  const lastUndo = useRef<{ undo: () => Promise<void>; text: string } | null>(null);
  const capture = useRef<((c: Captured) => void) | null>(null);

  const voiceToaster = useMemo<WallToaster>(
    () => ({
      show: (_text, undo) => capture.current?.({ write: Promise.resolve(), ...(undo ? { undo } : {}) }),
      run: (write, _text, undo) => capture.current?.({ write, ...(undo ? { undo } : {}) }),
    }),
    []
  );
  const act = useWallListActions(voiceToaster);

  const latest = useRef({ members, groceryCatalog, today, timeZone, onShow, onRotate, act, parseText, parseAudio, householdId });
  useEffect(() => {
    latest.current = { members, groceryCatalog, today, timeZone, onShow, onRotate, act, parseText, parseAudio, householdId };
  });

  const available = pickVoiceEngine(setting, support, false) !== null;

  useEffect(
    () => () => {
      session.current?.cancel();
      Object.values(engines.current).forEach(e => e?.dispose());
    },
    []
  );

  // Results and errors clear themselves (plan §3: "auto-dismisses after 10 s").
  useEffect(() => {
    if (state?.phase !== 'result' && state?.phase !== 'error') return undefined;
    const { id } = state;
    const timer = window.setTimeout(
      () => setState(cur => (cur && (cur.phase === 'result' || cur.phase === 'error') && cur.id === id ? null : cur)),
      WALL_VOICE_BANNER_MS
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  const result = useCallback((r: Omit<Extract<WallVoiceState, { phase: 'result' }>, 'phase' | 'id'>) => {
    seq.current += 1;
    setState({ phase: 'result', id: seq.current, ...r });
  }, []);
  const fail = useCallback((title: string, text: string, retry = true) => {
    seq.current += 1;
    setState({ phase: 'error', id: seq.current, title, text, retry });
  }, []);

  const runUndo = useCallback(
    (undo: () => Promise<void>, text: string) => {
      lastUndo.current = null;
      result({ title: 'Undone', text });
      undo().catch(error => {
        console.error('[wall] voice undo failed:', error);
        fail("Couldn't undo that", 'Remove it from the list instead.', false);
      });
    },
    [fail, result]
  );

  const runLocal = useCallback(
    (command: LocalCommand) => {
      const l = latest.current;
      if (command.kind === 'show') {
        l.onShow(command.target);
        setState(null);
      } else if (command.kind === 'rotate') {
        l.onRotate(command.on);
        result({ title: command.on ? 'Rotating the panel' : 'Stopped rotating', text: command.on ? 'Say “stop rotating” to keep one module.' : 'The panel stays as it is.' });
      } else if (command.kind === 'undo') {
        if (lastUndo.current) runUndo(lastUndo.current.undo, lastUndo.current.text);
        else fail('Nothing to undo', 'Voice can undo the last thing it added.', false);
      } else {
        setState(null);
      }
    },
    [fail, result, runUndo]
  );

  const runAction = useCallback(
    (command: WallVoiceCommand) => {
      const l = latest.current;
      const action = resolveVoiceCommand(command, { members: l.members, catalog: l.groceryCatalog, today: l.today });
      if (action.kind === 'unknown') {
        fail('Didn’t catch that', command.transcript ? `${quote(command.transcript)} isn’t a command I know.` : 'Try again a little closer to the iPad.');
        return;
      }
      let captured: Captured | null = null;
      capture.current = c => {
        captured = c;
      };
      if (action.kind === 'shopping') l.act.addShopping(action.items);
      else l.act.addTodo(action.todo);
      capture.current = null;
      const done = captured as Captured | null;
      const undo = done?.undo;
      if (undo) lastUndo.current = { undo, text: action.summary };
      const id = seq.current + 1;
      result({
        title: action.kind === 'shopping' ? 'Added to Shopping' : 'Added to To-dos',
        text: action.summary,
        ...(undo ? { undo } : {}),
        show: action.kind === 'shopping' ? 'shopping' : 'todos',
      });
      done?.write.catch(() => {
        setState(cur => (cur?.phase === 'result' && cur.id === id ? { phase: 'error', id, title: "Couldn't save that", text: 'Try again.', retry: true } : cur));
      });
    },
    [fail, result]
  );

  const handleCapture = useCallback(
    async (cap: VoiceCapture, mine: number) => {
      const l = latest.current;
      if (cap.kind === 'text') {
        const local = parseLocalCommand(cap.transcript);
        if (local) {
          runLocal(local);
          return;
        }
      }
      setState({ phase: 'working', heard: cap.kind === 'text' ? cap.transcript : null });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        fail('Voice needs the internet', 'Use Add instead. It saves offline.', false);
        return;
      }
      const ctx = voiceContextFrom(l.members, l.groceryCatalog, l.today, l.timeZone);
      let command: WallVoiceCommand;
      try {
        command =
          cap.kind === 'text'
            ? await l.parseText(l.householdId, cap.transcript, ctx)
            : await l.parseAudio(l.householdId, cap.data, cap.mimeType, ctx);
      } catch (error) {
        if (mine !== epoch.current) return;
        console.error('[wall] voice parse failed:', error);
        const e = parseErrorState(error);
        fail(e.title, e.text, e.retry);
        return;
      }
      if (mine !== epoch.current) return;
      // The audio path only learns the words now; the grammar still wins, so
      // "show meals" never becomes an add.
      const local = cap.kind === 'audio' ? parseLocalCommand(command.transcript) : null;
      if (local) runLocal(local);
      else runAction(command);
    },
    [fail, runAction, runLocal]
  );

  const start = useCallback(() => {
    session.current?.cancel();
    epoch.current += 1;
    const mine = epoch.current;
    const listen = () => {
      const kind = pickVoiceEngine(setting, support, speechRefused.current);
      if (!kind) {
        fail('Voice isn’t available', 'This browser can’t use the microphone.', false);
        return;
      }
      const engine = engines.current[kind] ?? createEngine(kind);
      engines.current[kind] = engine;
      setState({ phase: 'listening', interim: '' });
      const s = engine.listen({
        onInterim: text => {
          if (mine === epoch.current) setState(cur => (cur?.phase === 'listening' ? { phase: 'listening', interim: text } : cur));
        },
      });
      session.current = s;
      s.result.then(
        cap => {
          if (mine !== epoch.current) return;
          session.current = null;
          void handleCapture(cap, mine);
        },
        (error: unknown) => {
          if (mine !== epoch.current) return;
          session.current = null;
          const code = error instanceof VoiceCaptureError ? error.code : 'failed';
          // Speech refused on this launch: fall back to recorded audio (plan §6).
          if (code === 'not-allowed' && kind === 'speech' && setting === 'auto' && support.audio) {
            speechRefused.current = true;
            listen();
            return;
          }
          if (code === 'aborted') setState(null);
          else if (code === 'no-speech') fail('Didn’t catch that', 'Try again a little closer to the iPad.');
          else if (code === 'not-allowed') fail('The microphone is blocked', 'Allow it in iPad Settings → Safari → Microphone, then try again.', false);
          else fail('Voice isn’t working', 'The microphone couldn’t start. Try again.');
        }
      );
    };
    listen();
  }, [createEngine, fail, handleCapture, setting, support]);

  const finish = useCallback(() => session.current?.finish(), []);
  const cancel = useCallback(() => {
    epoch.current += 1;
    session.current?.cancel();
    session.current = null;
    setState(null);
  }, []);
  const undo = useCallback(() => {
    if (state?.phase === 'result' && state.undo) runUndo(state.undo, state.text);
  }, [runUndo, state]);

  return { state, available, start, finish, cancel, undo };
}
