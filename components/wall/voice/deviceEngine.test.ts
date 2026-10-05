import { describe, expect, it, vi } from 'vitest';
import type { WallPicovoice } from '@/types/schema';
import { VoiceCaptureError } from './voiceEngines';
import { DEVICE_MAX_MS, DEVICE_NO_SPEECH_MS, createDeviceEngine, deviceErrorCode, type PicovoiceEngine, type PicovoiceLib } from './deviceEngine';

const CONFIG: WallPicovoice = { accessKey: 'k', keyword: 'Computer', label: 'Computer', sensitivity: 0.5 };

type Transcript = { transcript: string; isEndpoint?: boolean; isFlushed?: boolean };

/** A fake Picovoice: records every mic change and lets the test speak. */
function fakeLib(opts: { cheetahError?: Error; subscribeError?: Error } = {}) {
  const log: string[] = [];
  const live = new Set<string>();
  /** The fewest subscribers the mic ever had after first opening. */
  let opened = false;
  let dippedToZero = false;
  let onTranscript: (t: Transcript) => void = () => undefined;
  let onWake: () => void = () => undefined;
  const flushes: (() => void)[] = [];
  const cheetah = {
    name: 'cheetah',
    worker: {} as Worker,
    flush: vi.fn(() => {
      log.push('flush');
      flushes.push(() => onTranscript({ transcript: '', isFlushed: true }));
    }),
    release: vi.fn(async () => undefined),
    terminate: vi.fn(),
  };
  const porcupine = { name: 'porcupine', worker: {} as Worker, release: vi.fn(async () => undefined), terminate: vi.fn() };
  const nameOf = (e: PicovoiceEngine) => (e === cheetah ? 'cheetah' : 'porcupine');
  const lib: PicovoiceLib = {
    createCheetah: async (_key, t) => {
      if (opts.cheetahError) throw opts.cheetahError;
      onTranscript = t;
      return cheetah;
    },
    createPorcupine: async (_config, wake) => {
      onWake = wake;
      return porcupine;
    },
    subscribe: async e => {
      if (opts.subscribeError) throw opts.subscribeError;
      log.push(`sub:${nameOf(e)}`);
      live.add(nameOf(e));
      opened = true;
    },
    unsubscribe: async e => {
      log.push(`unsub:${nameOf(e)}`);
      live.delete(nameOf(e));
      if (opened && live.size === 0) dippedToZero = true;
    },
  };
  return {
    lib,
    log,
    live,
    cheetah,
    dippedToZero: () => dippedToZero,
    say: (t: Transcript) => onTranscript(t),
    wake: () => onWake(),
    answerFlushes: () => flushes.splice(0).forEach(f => f()),
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

describe('createDeviceEngine', () => {
  it('listens for the wake word, then hands the mic to Cheetah and back without ever releasing it', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const onWake = vi.fn();
    const engine = createDeviceEngine(CONFIG, onWake, async () => f.lib, timers);
    await engine.setWake(true);
    expect([...f.live]).toEqual(['porcupine']);
    f.wake();
    expect(onWake).toHaveBeenCalledTimes(1);

    const interim: string[] = [];
    const session = engine.listen({ onInterim: t => interim.push(t) });
    await settle();
    expect(f.log).toEqual(['sub:porcupine', 'sub:cheetah', 'unsub:porcupine']);
    // A wake word said mid-command doesn't open another one.
    f.wake();
    expect(onWake).toHaveBeenCalledTimes(1);

    f.say({ transcript: 'Add milk' });
    f.say({ transcript: ' and eggs.', isEndpoint: true });
    expect(interim).toEqual(['Add milk', 'Add milk and eggs.']);
    expect(f.cheetah.flush).toHaveBeenCalledTimes(1);
    f.answerFlushes();
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'Add milk and eggs.' });
    await settle();
    expect(f.log.slice(-2)).toEqual(['sub:porcupine', 'unsub:cheetah']);
    expect([...f.live]).toEqual(['porcupine']);
    expect(f.dippedToZero()).toBe(false);
  });

  it('gives up with no-speech when nobody talks, and the cleanup flush never ends the next command', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const first = engine.listen({});
    await settle();
    timers.fire(DEVICE_NO_SPEECH_MS);
    await expect(first.result).rejects.toMatchObject({ code: 'no-speech' });
    await settle();
    expect(f.cheetah.flush).toHaveBeenCalledTimes(1);

    const second = engine.listen({});
    await settle();
    // The first command's flush answers late: it must not end this one.
    f.answerFlushes();
    f.say({ transcript: 'show meals', isEndpoint: true });
    f.answerFlushes();
    await expect(second.result).resolves.toEqual({ kind: 'text', transcript: 'show meals' });
  });

  it('Done flushes what was heard so far', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const session = engine.listen({});
    await settle();
    f.say({ transcript: 'show the' });
    session.finish();
    f.say({ transcript: ' calendar' });
    f.answerFlushes();
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'show the calendar' });
  });

  it('Done before the engine is ready still ends the command', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const session = engine.listen({});
    session.finish();
    await settle();
    f.answerFlushes();
    await expect(session.result).rejects.toMatchObject({ code: 'no-speech' });
  });

  it('stops at the max length with what it heard', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const session = engine.listen({});
    await settle();
    f.say({ transcript: 'add milk and' });
    timers.fire(DEVICE_MAX_MS);
    f.answerFlushes();
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'add milk and' });
  });

  it('a flush that never answers still settles', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const session = engine.listen({});
    await settle();
    f.say({ transcript: 'undo', isEndpoint: true });
    timers.fire(1500);
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'undo' });
  });

  it('Cancel rejects as aborted and releases Cheetah', async () => {
    const f = fakeLib();
    const timers = fakeTimers();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, timers);
    const session = engine.listen({});
    await settle();
    session.cancel();
    await expect(session.result).rejects.toMatchObject({ code: 'aborted' });
    await settle();
    expect(f.live.size).toBe(0);
  });

  it('reports a bad AccessKey and a blocked mic in the banner’s terms', async () => {
    const bad = fakeLib({ cheetahError: Object.assign(new Error('AccessKey is invalid'), { name: 'CheetahActivationRefusedError' }) });
    const s1 = createDeviceEngine(CONFIG, vi.fn(), async () => bad.lib, fakeTimers()).listen({});
    await expect(s1.result).rejects.toMatchObject({ code: 'unavailable', message: 'activation' });

    const blocked = fakeLib({ subscribeError: Object.assign(new Error('microphone permissions denied'), { name: 'PermissionError' }) });
    await expect(createDeviceEngine(CONFIG, vi.fn(), async () => blocked.lib, fakeTimers()).setWake(true)).rejects.toMatchObject({
      code: 'not-allowed',
    });
  });

  it('turning the wake word off releases the mic', async () => {
    const f = fakeLib();
    const engine = createDeviceEngine(CONFIG, vi.fn(), async () => f.lib, fakeTimers());
    await engine.setWake(true);
    await engine.setWake(false);
    expect(f.log).toEqual(['sub:porcupine', 'unsub:porcupine']);
  });
});

describe('deviceErrorCode', () => {
  it('keeps a capture error and maps the rest', () => {
    const e = new VoiceCaptureError('no-speech');
    expect(deviceErrorCode(e)).toBe(e);
    expect(deviceErrorCode(new Error('boom'))).toMatchObject({ code: 'unavailable', message: 'boom' });
  });
});
