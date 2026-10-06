import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WallVoiceEngine, WallWakeFile, WallWakeModel } from '@/types/schema';
import type { WallVoiceCommand, WallVoiceContext } from '@/services/geminiService.types';
import { parseWallVoiceAudio, parseWallVoiceText } from '@/services/geminiService';
import {
  COMMAND_PHRASES,
  parseLocalCommand,
  pickTranscript,
  pickVoiceEngine,
  stripWakeWord,
  trimLeadIn,
  resolveVoiceCommand,
  voiceContextFrom,
  type LocalCommand,
  type VoiceSupport,
  type VoiceTarget,
} from '@/utils/wall/wallVoice';
import { parseLocalAdd } from '@/utils/wall/wallVoiceGrammar';
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
import { createDeviceEngine, type DeviceVoiceEngine } from './deviceEngine';

type EngineKind = 'device' | 'speech' | 'audio';

/** The banner's states (plan §3 "Voice"). */
export type WallVoiceState =
  /** `loading`: the on-device speech model is still starting (the first run downloads it). */
  | { phase: 'listening'; interim: string; loading?: boolean }
  | { phase: 'working'; heard: string | null }
  | { phase: 'result'; id: number; big: boolean; title: string; text: string; undo?: () => Promise<void>; show?: VoiceTarget }
  | { phase: 'error'; id: number; big: boolean; title: string; text: string; retry: boolean };

export const WALL_VOICE_BANNER_MS = 10_000;
/** Results and errors open as the big centered card, then shrink to the banner. */
export const WALL_VOICE_BIG_MS = 5_000;

/** What the wall plays when a command lands: a chime, and maybe these words. */
export interface WallVoiceFeedback {
  tone: 'ok' | 'error';
  speech: string;
}

export interface WallVoiceDeps {
  support?: VoiceSupport;
  createEngine?: (kind: 'speech' | 'audio') => VoiceEngine;
  createDeviceEngine?: (model: WallWakeModel, onWake: () => void, loadFile: (file: WallWakeFile) => Promise<Uint8Array>) => DeviceVoiceEngine;
  parseText?: (householdId: string, transcript: string, ctx: WallVoiceContext) => Promise<WallVoiceCommand>;
  parseAudio?: (householdId: string, data: string, mimeType: string, ctx: WallVoiceContext) => Promise<WallVoiceCommand>;
}

interface UseWallVoiceOptions {
  setting: WallVoiceEngine;
  /** The wake word the on-device engine listens for. */
  wakeModel: WallWakeModel;
  /**
   * Listen for the wake word now (on-device engine only). The caller turns
   * this off at night, while the sound is locked, and on a member preview.
   */
  wake?: boolean;
  today: string;
  timeZone: string;
  onShow: (target: VoiceTarget) => void;
  onRotate: (on: boolean) => void;
  /** "What's my day": the wall shows and reads the brief itself. */
  onBrief?: (day: 'today' | 'tomorrow' | 'auto') => void;
  /** Called once per result or error, for the chime and spoken reply. */
  onFeedback?: (feedback: WallVoiceFeedback) => void;
  /** The wake word was heard (before listening starts), for a short chime. */
  onWake?: () => void;
  deps?: WallVoiceDeps;
}

interface Captured {
  write: Promise<unknown>;
  undo?: () => Promise<void>;
}

/** The on-device engine runs in WebAssembly workers off the shared mic. */
function deviceSupported(): boolean {
  return (
    typeof WebAssembly !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function defaultCreateDeviceEngine(model: WallWakeModel, onWake: () => void, loadFile: (file: WallWakeFile) => Promise<Uint8Array>): DeviceVoiceEngine {
  return createDeviceEngine(model, onWake, { commandPhrases: COMMAND_PHRASES, loadFile });
}

function defaultCreateEngine(kind: 'speech' | 'audio'): VoiceEngine {
  const Ctor = getSpeechRecognition();
  return kind === 'speech' && Ctor ? createSpeechEngine(Ctor) : createAudioEngine();
}

const quote = (text: string) => `“${text}”`;

/** Which wake word an engine was built for; a change rebuilds it. */
const configKey = (m: WallWakeModel) => [m.keyword, m.label, m.threshold, m.file?.id ?? ''].join('|');

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
export function useWallVoice({ setting, wakeModel, wake = false, today, timeZone, onShow, onRotate, onBrief, onFeedback, onWake, deps }: UseWallVoiceOptions) {
  const { householdId, members, groceryCatalog, actions } = useWallData();
  const loadWakeFile = actions.loadWakeFile;
  const [state, setState] = useState<WallVoiceState | null>(null);
  /** The wake setup that's confirmed listening ('' = none). */
  const [wakeOnKey, setWakeOnKey] = useState('');
  const support = useMemo<VoiceSupport>(
    () => deps?.support ?? { speech: Boolean(getSpeechRecognition()), audio: audioSupported(), device: deviceSupported() },
    [deps?.support]
  );
  const createEngine = deps?.createEngine ?? defaultCreateEngine;
  const makeDeviceEngine = deps?.createDeviceEngine ?? defaultCreateDeviceEngine;
  const parseText = deps?.parseText ?? parseWallVoiceText;
  const parseAudio = deps?.parseAudio ?? parseWallVoiceAudio;

  const engines = useRef<Partial<Record<'speech' | 'audio', VoiceEngine>>>({});
  const device = useRef<{ key: string; engine: DeviceVoiceEngine } | null>(null);
  // The wake word calls start(), which is defined below and changes identity.
  const onWakeRef = useRef<() => void>(() => undefined);
  const stateRef = useRef<WallVoiceState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  });
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

  const latest = useRef({ members, groceryCatalog, today, timeZone, onShow, onRotate, onBrief, onFeedback, onWake, act, parseText, parseAudio, householdId, loadWakeFile });
  useEffect(() => {
    latest.current = { members, groceryCatalog, today, timeZone, onShow, onRotate, onBrief, onFeedback, onWake, act, parseText, parseAudio, householdId, loadWakeFile };
  });

  const available = pickVoiceEngine(setting, support, false) !== null;
  const usesDevice = pickVoiceEngine(setting, support, false) === 'device';

  /** The on-device engine for the current wake word (rebuilt when it changes). */
  const wakeKey = configKey(wakeModel);
  const wakeModelRef = useRef(wakeModel);
  useEffect(() => {
    wakeModelRef.current = wakeModel;
  });
  const deviceEngine = useCallback((): DeviceVoiceEngine => {
    if (device.current?.key === wakeKey) return device.current.engine;
    device.current?.engine.dispose();
    const engine = makeDeviceEngine(
      wakeModelRef.current,
      () => onWakeRef.current(),
      file => latest.current.loadWakeFile(file)
    );
    device.current = { key: wakeKey, engine };
    return engine;
  }, [wakeKey, makeDeviceEngine]);

  useEffect(
    () => () => {
      session.current?.cancel();
      Object.values(engines.current).forEach(e => e?.dispose());
      device.current?.engine.dispose();
      device.current = null;
    },
    []
  );

  // Results and errors open big, shrink to the banner, then clear themselves
  // (plan §3: "auto-dismisses after 10 s").
  const doneId = state?.phase === 'result' || state?.phase === 'error' ? state.id : null;
  useEffect(() => {
    if (doneId === null) return undefined;
    const mine = (cur: WallVoiceState | null) => cur && (cur.phase === 'result' || cur.phase === 'error') && cur.id === doneId;
    const shrink = window.setTimeout(() => setState(cur => (mine(cur) && cur ? { ...cur, big: false } : cur)), WALL_VOICE_BIG_MS);
    const clear = window.setTimeout(() => setState(cur => (mine(cur) ? null : cur)), WALL_VOICE_BANNER_MS);
    return () => {
      window.clearTimeout(shrink);
      window.clearTimeout(clear);
    };
  }, [doneId]);

  const result = useCallback((r: Omit<Extract<WallVoiceState, { phase: 'result' }>, 'phase' | 'id' | 'big'>, speech: string) => {
    seq.current += 1;
    setState({ phase: 'result', id: seq.current, big: true, ...r });
    latest.current.onFeedback?.({ tone: 'ok', speech });
  }, []);
  const fail = useCallback((title: string, text: string, retry = true) => {
    seq.current += 1;
    setState({ phase: 'error', id: seq.current, big: true, title, text, retry });
    latest.current.onFeedback?.({ tone: 'error', speech: title });
  }, []);

  const runUndo = useCallback(
    (undo: () => Promise<void>, text: string) => {
      lastUndo.current = null;
      result({ title: 'Undone', text }, 'Undone.');
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
        result(
          { title: command.on ? 'Rotating the panel' : 'Stopped rotating', text: command.on ? 'Say “stop rotating” to keep one module.' : 'The panel stays as it is.' },
          command.on ? 'Rotating the panel.' : 'Stopped rotating.'
        );
      } else if (command.kind === 'brief') {
        setState(null);
        l.onBrief?.(command.day);
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
      }, action.spoken);
      done?.write.catch(() => {
        setState(cur => (cur?.phase === 'result' && cur.id === id ? { phase: 'error', id, big: cur.big, title: "Couldn't save that", text: 'Try again.', retry: true } : cur));
      });
    },
    [fail, result]
  );

  const handleCapture = useCallback(
    async (cap: VoiceCapture, mine: number, engine: EngineKind) => {
      const l = latest.current;
      const addCtx = {
        memberNames: l.members.map(m => m.displayName).filter((n): n is string => Boolean(n)),
        catalogNames: l.groceryCatalog.map(i => i.name),
        today: l.today,
      };
      let transcript = cap.kind === 'text' ? cap.transcript : '';
      if (cap.kind === 'text') {
        if (engine === 'device') {
          const label = wakeModelRef.current.label;
          const readsAsAdd = (text: string) => parseLocalAdd(text, addCtx) !== null;
          const readable = (text: string) => parseLocalCommand(text) !== null || readsAsAdd(text);
          const clean = (text: string) => trimLeadIn(stripWakeWord(text, label), readable);
          transcript = pickTranscript(clean(cap.transcript), cap.alternative === undefined ? undefined : clean(cap.alternative), readsAsAdd);
          if (!transcript) {
            fail('Didn’t catch that', 'Say the command right after the wake word.');
            return;
          }
        }
        const local = parseLocalCommand(transcript);
        if (local) {
          runLocal(local);
          return;
        }
        // Adds the grammar can read never reach Gemini.
        const add = parseLocalAdd(transcript, addCtx);
        if (add) {
          runAction(add);
          return;
        }
        // The on-device engine is the no-AI engine: what the grammar can't read stops here.
        if (engine === 'device') {
          fail('Didn’t catch that', `${quote(transcript)} isn’t a command I know. Try “add milk” or “remind Sam to feed the cat”.`);
          return;
        }
      }
      setState({ phase: 'working', heard: cap.kind === 'text' ? transcript : null });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        fail('Voice needs the internet', 'Use Add instead. It saves offline.', false);
        return;
      }
      const ctx = voiceContextFrom(l.members, l.groceryCatalog, l.today, l.timeZone);
      let command: WallVoiceCommand;
      try {
        command =
          cap.kind === 'text'
            ? await l.parseText(l.householdId, transcript, ctx)
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

  /** `afterWake`: the wake word opened it, so the moments before count. */
  const begin = useCallback((afterWake: boolean) => {
    session.current?.cancel();
    epoch.current += 1;
    const mine = epoch.current;
    const listen = () => {
      const kind = pickVoiceEngine(setting, support, speechRefused.current);
      if (!kind) {
        fail('Voice isn’t available', 'This browser can’t use the microphone.', false);
        return;
      }
      setState({ phase: 'listening', interim: '' });
      const onInterim = (text: string) => {
        if (mine === epoch.current) setState(cur => (cur?.phase === 'listening' ? { phase: 'listening', interim: text } : cur));
      };
      let s: VoiceSession;
      if (kind === 'device') {
        s = deviceEngine().listen({
          onInterim,
          afterWake,
          onLoading: loading => {
            if (mine === epoch.current) setState(cur => (cur?.phase === 'listening' ? { ...cur, loading } : cur));
          },
        });
      } else {
        const engine = engines.current[kind] ?? createEngine(kind);
        engines.current[kind] = engine;
        s = engine.listen({ onInterim });
      }
      session.current = s;
      s.result.then(
        cap => {
          if (mine !== epoch.current) return;
          session.current = null;
          void handleCapture(cap, mine, kind);
        },
        (error: unknown) => {
          if (mine !== epoch.current) return;
          session.current = null;
          const code = error instanceof VoiceCaptureError ? error.code : 'failed';
          // Speech refused (or dead in a Home Screen app) on this launch: fall back to recorded audio (plan §6).
          if ((code === 'not-allowed' || code === 'unsupported') && kind === 'speech' && setting === 'auto' && support.audio) {
            speechRefused.current = true;
            listen();
            return;
          }
          if (code === 'aborted') setState(null);
          else if (code === 'no-speech') fail('Didn’t catch that', 'Try again a little closer to the iPad.');
          else if (code === 'not-allowed') fail('The microphone is blocked', 'Allow it in iPad Settings → Safari → Microphone, then try again.', false);
          else if (code === 'unsupported')
            fail('The iPad’s speech recognition doesn’t work here', 'It doesn’t run in a Home Screen app. Set up on-device voice in Settings → Wall display → Voice.', false);
          else if (kind === 'device' && code === 'unavailable') {
            console.error('[wall] on-device voice failed:', error);
            fail('Voice couldn’t start', 'Its speech files didn’t load. Check the wall’s internet connection, then try again.');
          } else fail('Voice isn’t working', 'The microphone couldn’t start. Try again.');
        }
      );
    };
    listen();
  }, [createEngine, deviceEngine, fail, handleCapture, setting, support]);
  // Public, and used as a click handler: never forward the event as `afterWake`.
  const start = useCallback(() => begin(false), [begin]);

  // The wake word: a detection opens a command unless one is already running.
  useEffect(() => {
    onWakeRef.current = () => {
      const cur = stateRef.current;
      if (cur?.phase === 'listening' || cur?.phase === 'working') return;
      latest.current.onWake?.();
      begin(true);
    };
  }, [begin]);

  // Wake-word listening follows `wake`; a failure to start is reported once per wake word.
  const listenKey = usesDevice && wake ? wakeKey : '';
  const reportedWake = useRef('');
  useEffect(() => {
    if (!usesDevice) {
      void device.current?.engine.setWake(false).catch(() => undefined);
      return undefined;
    }
    const engine = deviceEngine();
    const on = listenKey !== '';
    let live = true;
    engine.setWake(on).then(
      () => {
        if (live) setWakeOnKey(listenKey);
      },
      (error: unknown) => {
        if (!live) return;
        setWakeOnKey('');
        console.error(`[wall] wake word failed to ${on ? 'start' : 'stop'}:`, error);
        if (!on || reportedWake.current === listenKey) return;
        reportedWake.current = listenKey;
        const blocked = error instanceof VoiceCaptureError && error.code === 'not-allowed';
        // The wall has no console to read, so the reason goes on screen.
        const reason = error instanceof Error && error.message ? ` (${error.message.slice(0, 160)})` : '';
        fail(
          'The wake word isn’t listening',
          blocked
            ? 'Allow the microphone in iPad Settings → Safari → Microphone.'
            : `Tap the mic to talk meanwhile.${reason}`,
          false
        );
      }
    );
    return () => {
      live = false;
    };
  }, [usesDevice, listenKey, deviceEngine, fail]);

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

  const wakeListening = listenKey !== '' && wakeOnKey === listenKey;
  return { state, available, start, finish, cancel, undo, wakeListening };
}
