import { describe, expect, it, vi } from 'vitest';
import type { WallWakeModel } from '@/types/schema';
import { VoiceCaptureError } from './voiceEngines';
import {
  DEVICE_FINAL_MS,
  DEVICE_MAX_MS,
  DEVICE_NO_SPEECH_MS,
  createDeviceEngine,
  deviceErrorCode,
  type LocalVoiceLib,
  type MicListener,
  type Recognizer,
  type RecognizerEvents,
} from './deviceEngine';

const MODEL: WallWakeModel = { keyword: 'hey_jarvis', label: 'Hey Jarvis', threshold: 0.5 };
const PHRASES = ['show the calendar', 'undo'];

interface FakeRecognizer extends Recognizer {
  name: string;
  phrases: readonly string[] | undefined;
  events: RecognizerEvents;
  fed: Int16Array[];
  released: boolean;
  finishes: number;
}

/** A fake openWakeWord + Vosk: records every mic change and lets the test speak. */
function fakeLib(opts: { recognizerError?: Error; subscribeError?: Error } = {}) {
  const log: string[] = [];
  const live = new Set<MicListener>();
  let opened = false;
  let dippedToZero = false;
  let onWake: () => void = () => undefined;
  const recognizers: FakeRecognizer[] = [];
  const wake = {
    onmessage: () => undefined,
    sinceWake: vi.fn(() => new Int16Array([1, 2, 3])),
    reset: vi.fn(async () => {
      log.push('wake-reset');
    }),
    release: vi.fn(),
  };
  const nameOf = (l: MicListener) => (l === wake ? 'wake' : ((l as FakeRecognizer).name ?? '?'));
  const lib: LocalVoiceLib = {
    prepare: vi.fn(async () => undefined),
    createWake: async (model, w, loadFile) => {
      onWake = w;
      if (model.keyword === 'custom' && model.file) log.push(`custom:${(await loadFile(model.file)).length}`);
      return wake;
    },
    createRecognizer: async (events, phrases) => {
      if (opts.recognizerError) throw opts.recognizerError;
      const r: FakeRecognizer = {
        name: phrases ? 'command' : 'free',
        phrases,
        events,
        fed: [],
        released: false,
        finishes: 0,
        onmessage: () => undefined,
        feed: pcm => r.fed.push(pcm),
        finish: () => {
          r.finishes += 1;
        },
        release: () => {
          r.released = true;
        },
      };
      recognizers.push(r);
      return r;
    },
    subscribe: async ls => {
      if (opts.subscribeError) throw opts.subscribeError;
      ls.forEach(l => {
        log.push(`sub:${nameOf(l)}`);
        live.add(l);
      });
      opened = true;
    },
    unsubscribe: async ls => {
      ls.forEach(l => {
        log.push(`unsub:${nameOf(l)}`);
        live.delete(l);
      });
      if (opened && live.size === 0) dippedToZero = true;
    },
  };
  const named = (n: string) => recognizers.filter(r => r.name === n).at(-1);
  return {
    lib,
    log,
    live,
    wake,
    recognizers,
    free: () => named('free'),
    command: () => named('command'),
    dippedToZero: () => dippedToZero,
    heardWake: () => onWake(),
  };
}

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    set: (fn: () => void, ms: number) => {
      pending.set(next, { fn, ms });
      return next++;
    },
    clear: (id: number) => {
      pending.delete(id);
    },
    /** Runs every pending timer of exactly this length. */
    fire: (ms: number) => {
      for (const [id, t] of [...pending]) {
        if (t.ms === ms) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));

function setup(opts: Parameters<typeof fakeLib>[0] & { wakeOnly?: boolean } = {}) {
  const f = fakeLib(opts);
  const timers = fakeTimers();
  const onWake = vi.fn();
  const engine = createDeviceEngine(MODEL, onWake, { lib: async () => f.lib, commandPhrases: PHRASES, timers, wakeOnly: opts.wakeOnly ?? false });
  return { f, timers, onWake, engine };
}

describe('createDeviceEngine', () => {
  it('hands the mic from the wake word to both recognizers and back, never releasing it', async () => {
    const { f, onWake, engine } = setup();
    await engine.setWake(true);
    expect(f.log).toEqual(['sub:wake']);
    expect(f.lib.prepare).toHaveBeenCalled();
    f.heardWake();
    expect(onWake).toHaveBeenCalledTimes(1);

    const interim: string[] = [];
    const session = engine.listen({ afterWake: true, onInterim: t => interim.push(t) });
    await settle();
    // Both recognizers start on the same frame, before the wake word steps off.
    expect(f.log).toEqual(['sub:wake', 'sub:free', 'sub:command', 'unsub:wake']);
    expect(f.command()?.phrases).toEqual(PHRASES);
    // The moments around the wake word are replayed into both.
    expect(f.free()?.fed).toEqual([new Int16Array([1, 2, 3])]);
    expect(f.command()?.fed).toEqual([new Int16Array([1, 2, 3])]);
    // A wake word heard mid-command doesn't open another one.
    f.heardWake();
    expect(onWake).toHaveBeenCalledTimes(1);

    f.free()?.events.onPartial('add milk');
    f.free()?.events.onPartial('add milk');
    f.free()?.events.onPartial('add milk and eggs');
    expect(interim).toEqual(['add milk', 'add milk and eggs']);
    f.free()?.events.onResult('add milk and eggs');
    expect(f.command()?.finishes).toBe(1);
    f.command()?.events.onResult('[unk]');
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'add milk and eggs', alternative: '[unk]' });
    await settle();
    // The wake word is reset and back on the mic before the recognizers let go.
    expect(f.log.slice(-4)).toEqual(['wake-reset', 'sub:wake', 'unsub:free', 'unsub:command']);
    expect(f.recognizers.every(r => r.released)).toBe(true);
    expect([...f.live]).toEqual([f.wake]);
    expect(f.dippedToZero()).toBe(false);
  });

  it('a tap (no wake word) replays nothing', async () => {
    const { f, engine } = setup();
    await engine.setWake(true);
    engine.listen({});
    await settle();
    expect(f.free()?.fed).toEqual([]);
    expect(f.wake.sinceWake).not.toHaveBeenCalled();
  });

  it('ignores the empty results Vosk sends on silence, and gives up with no-speech', async () => {
    const { f, timers, engine } = setup();
    const session = engine.listen({});
    await settle();
    f.free()?.events.onResult('');
    timers.fire(DEVICE_NO_SPEECH_MS);
    await expect(session.result).rejects.toMatchObject({ code: 'no-speech' });
  });

  it('does not give up while someone is talking', async () => {
    const { f, timers, engine } = setup();
    const session = engine.listen({});
    await settle();
    f.free()?.events.onPartial('remind sam');
    timers.fire(DEVICE_NO_SPEECH_MS);
    f.free()?.events.onResult('remind sam to feed the cat');
    f.command()?.events.onResult('[unk]');
    await expect(session.result).resolves.toMatchObject({ transcript: 'remind sam to feed the cat' });
  });

  it('Done asks both recognizers for their last words', async () => {
    const { f, engine } = setup();
    const session = engine.listen({});
    await settle();
    f.free()?.events.onPartial('show the');
    session.finish();
    expect(f.free()?.finishes).toBe(1);
    expect(f.command()?.finishes).toBe(1);
    f.free()?.events.onResult('though the calendar');
    f.command()?.events.onResult('show the calendar');
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'though the calendar', alternative: 'show the calendar' });
  });

  it('Done before the recognizers exist still ends the command', async () => {
    const { timers, engine } = setup();
    const session = engine.listen({});
    session.finish();
    await settle();
    timers.fire(DEVICE_FINAL_MS);
    await expect(session.result).rejects.toMatchObject({ code: 'no-speech' });
  });

  it('stops at the max length with what it heard, even if the recognizers never answer', async () => {
    const { f, timers, engine } = setup();
    const session = engine.listen({});
    await settle();
    f.free()?.events.onPartial('add milk and');
    timers.fire(DEVICE_MAX_MS);
    timers.fire(DEVICE_FINAL_MS);
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'add milk and' });
  });

  it('a silent command-only recognizer never holds the answer', async () => {
    const { f, timers, engine } = setup();
    const session = engine.listen({});
    await settle();
    f.free()?.events.onResult('add bread');
    timers.fire(DEVICE_FINAL_MS);
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'add bread' });
  });

  it('Cancel rejects as aborted and releases the recognizers', async () => {
    const { f, engine } = setup();
    const session = engine.listen({});
    await settle();
    session.cancel();
    await expect(session.result).rejects.toMatchObject({ code: 'aborted' });
    await settle();
    expect(f.live.size).toBe(0);
    expect(f.recognizers.every(r => r.released)).toBe(true);
  });

  it('a recognizer that arrives after Cancel is released at once', async () => {
    const { f, engine } = setup();
    const session = engine.listen({});
    session.cancel();
    await expect(session.result).rejects.toMatchObject({ code: 'aborted' });
    await settle();
    await settle();
    expect(f.recognizers.every(r => r.released)).toBe(true);
    expect(f.live.size).toBe(0);
  });

  it('says it is loading only when starting takes a while', async () => {
    const { f, timers, engine } = setup();
    let open: () => void = () => undefined;
    const gate = new Promise<void>(r => {
      open = r;
    });
    const create = f.lib.createRecognizer;
    f.lib.createRecognizer = async (events, phrases) => {
      await gate;
      return create(events, phrases);
    };
    const loading = vi.fn();
    engine.listen({ onLoading: loading });
    await settle();
    timers.fire(400);
    expect(loading.mock.calls.map(c => c[0])).toEqual([true]);
    open();
    await settle();
    expect(loading.mock.calls.map(c => c[0])).toEqual([true, false]);
  });

  it('stays quiet about loading when the recognizers are ready at once', async () => {
    const { timers, engine } = setup();
    const loading = vi.fn();
    engine.listen({ onLoading: loading });
    await settle();
    timers.fire(400);
    expect(loading).not.toHaveBeenCalledWith(true);
  });

  it('reports a model that will not load and a blocked mic in the banner’s terms', async () => {
    const bad = setup({ recognizerError: new Error('The speech model failed to load.') });
    await expect(bad.engine.listen({}).result).rejects.toMatchObject({ code: 'unavailable' });

    const blocked = setup({ subscribeError: Object.assign(new Error('microphone permissions denied'), { name: 'PermissionError' }) });
    await expect(blocked.engine.setWake(true)).rejects.toMatchObject({ code: 'not-allowed' });
  });

  it('hands a custom wake word its file', async () => {
    const f = fakeLib();
    const loadFile = vi.fn(async () => new Uint8Array(5));
    const custom: WallWakeModel = { keyword: 'custom', file: { id: 'f1', chunks: 1, bytes: 5 }, label: 'Hey Home', threshold: 0.5 };
    const engine = createDeviceEngine(custom, vi.fn(), { lib: async () => f.lib, loadFile, timers: fakeTimers() });
    await engine.setWake(true);
    expect(loadFile).toHaveBeenCalledWith({ id: 'f1', chunks: 1, bytes: 5 });
    expect(f.log).toEqual(['custom:5', 'sub:wake']);
  });

  it('turning the wake word off releases the mic', async () => {
    const { f, engine } = setup();
    await engine.setWake(true);
    await engine.setWake(false);
    expect(f.log).toEqual(['sub:wake', 'unsub:wake']);
  });

  it('wake-only (Safari hears the command) skips the speech model, and forgets the old "Hey …" when it comes back', async () => {
    const { f, engine } = setup({ wakeOnly: true });
    await engine.setWake(true);
    expect(f.lib.prepare).not.toHaveBeenCalled();
    await engine.setWake(false);
    await engine.setWake(true);
    expect(f.log).toEqual(['sub:wake', 'unsub:wake', 'wake-reset', 'sub:wake']);
  });
});

describe('deviceErrorCode', () => {
  it('keeps a capture error and maps the rest', () => {
    const e = new VoiceCaptureError('no-speech');
    expect(deviceErrorCode(e)).toBe(e);
    expect(deviceErrorCode(new Error('boom'))).toMatchObject({ code: 'unavailable', message: 'boom' });
  });
});
