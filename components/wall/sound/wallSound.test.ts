// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_BACKOFF_MS, base64ToBytes, chimeLengthMs, createWallSound, pickSystemVoice } from './wallSound';

/** Just enough of an AudioContext to see what the engine schedules. */
function fakeAudio() {
  const started: { kind: string; freq?: number }[] = [];
  const sources: { onended: (() => void) | null; buffer: unknown }[] = [];
  const ctx = {
    state: 'suspended' as AudioContextState,
    currentTime: 0,
    destination: {},
    onstatechange: null as (() => void) | null,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => undefined),
    createGain: () => ({
      gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }),
    createOscillator: () => {
      const osc = { type: 'sine', frequency: { value: 0 }, connect: vi.fn(), start: () => started.push({ kind: 'osc', freq: osc.frequency.value }), stop: vi.fn() };
      return osc;
    },
    createBuffer: () => ({}),
    createBufferSource: () => {
      const src = {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        start: () => started.push({ kind: 'buffer' }),
        stop: vi.fn(),
      };
      sources.push(src);
      return src;
    },
    decodeAudioData: vi.fn(async () => ({ duration: 1 })),
  };
  return { ctx, started, sources };
}

function fakeSynth() {
  const spoken: SpeechSynthesisUtterance[] = [];
  const synth = {
    speak: vi.fn((u: SpeechSynthesisUtterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => [] as SpeechSynthesisVoice[],
  } as unknown as SpeechSynthesis;
  const makeUtterance = (text: string) => ({ text, volume: 1, rate: 1, voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance;
  return { synth, spoken, makeUtterance };
}

const flush = () => new Promise(r => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('createWallSound', () => {
  it('stays silent and locked until a touch unlocks it', async () => {
    const audio = fakeAudio();
    const { synth, spoken, makeUtterance } = fakeSynth();
    const sound = createWallSound({ createContext: () => audio.ctx as unknown as AudioContext, synth, makeUtterance });
    expect(sound.getState()).toBe('locked');
    expect(sound.chime('ok')).toBe(0);
    await sound.speak('Hello');
    expect(spoken).toHaveLength(0);

    const seen = vi.fn();
    sound.subscribe(seen);
    sound.unlock();
    await flush();
    expect(sound.getState()).toBe('ready');
    expect(seen).toHaveBeenCalled();
    // The prime: a silent utterance so the iPad voice is unlocked too.
    expect(spoken[0]?.volume).toBe(0);
  });

  it('plays a chime as notes and says how long to wait', async () => {
    const audio = fakeAudio();
    const sound = createWallSound({ createContext: () => audio.ctx as unknown as AudioContext, synth: null });
    sound.unlock();
    await flush();
    audio.started.length = 0;
    expect(sound.chime('alert')).toBe(chimeLengthMs('alert'));
    // Three notes, each a sine plus a quiet octave.
    expect(audio.started.filter(s => s.kind === 'osc')).toHaveLength(6);
  });

  it('speaks with the cloud voice, caching each phrase', async () => {
    const audio = fakeAudio();
    const synthesize = vi.fn(async () => btoa('mp3'));
    const sound = createWallSound({ createContext: () => audio.ctx as unknown as AudioContext, synth: null, online: () => true });
    sound.setSynthesizer(synthesize);
    sound.unlock();
    await flush();

    // Each line plays as its own buffer source; finish it so speak() resolves.
    const sayOnce = async () => {
      const count = audio.sources.length;
      const done = sound.speak('Added milk to shopping.');
      for (let i = 0; i < 10 && audio.sources.length === count; i++) await flush();
      expect(audio.sources).toHaveLength(count + 1);
      audio.sources.at(-1)!.onended?.();
      await done;
    };
    await sayOnce();
    expect(audio.started.at(-1)).toEqual({ kind: 'buffer' });
    await sayOnce();
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('falls back to the iPad voice when the cloud fails, and backs off', async () => {
    const audio = fakeAudio();
    const { synth, spoken, makeUtterance } = fakeSynth();
    let clock = 1000;
    const synthesize = vi.fn(async () => {
      throw new Error('API disabled');
    });
    const sound = createWallSound({
      createContext: () => audio.ctx as unknown as AudioContext,
      synth,
      makeUtterance,
      online: () => true,
      now: () => clock,
    });
    sound.setSynthesizer(synthesize);
    sound.unlock();
    await flush();

    const first = sound.speak('Soccer starts soon.');
    await flush();
    await flush();
    const u = spoken.find(x => x.text === 'Soccer starts soon.');
    expect(u?.volume).toBe(0.7);
    (u as unknown as { onend: () => void }).onend();
    await first;

    // While backing off, the cloud isn't asked again.
    void sound.speak('Next line.');
    await flush();
    expect(synthesize).toHaveBeenCalledTimes(1);
    clock += CLOUD_BACKOFF_MS;
    void sound.speak('Later line.');
    await flush();
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it('uses the iPad voice when offline', async () => {
    const audio = fakeAudio();
    const { synth, spoken, makeUtterance } = fakeSynth();
    const synthesize = vi.fn(async () => btoa('mp3'));
    const sound = createWallSound({ createContext: () => audio.ctx as unknown as AudioContext, synth, makeUtterance, online: () => false });
    sound.setSynthesizer(synthesize);
    sound.unlock();
    await flush();
    void sound.speak('Offline line.');
    await flush();
    expect(synthesize).not.toHaveBeenCalled();
    expect(spoken.some(u => u.text === 'Offline line.')).toBe(true);
  });
});

describe('pickSystemVoice', () => {
  const v = (name: string, lang = 'en-US', isDefault = false) => ({ name, lang, voiceURI: name, default: isDefault, localService: true }) as SpeechSynthesisVoice;

  it('prefers a downloaded Premium or Enhanced English voice', () => {
    expect(pickSystemVoice([v('Thomas', 'fr-FR'), v('Samantha'), v('Ava (Enhanced)')])?.name).toBe('Ava (Enhanced)');
    expect(pickSystemVoice([v('Ava (Enhanced)'), v('Zoe (Premium)')])?.name).toBe('Zoe (Premium)');
  });

  it('then Samantha, then the default', () => {
    expect(pickSystemVoice([v('Fred'), v('Samantha')])?.name).toBe('Samantha');
    expect(pickSystemVoice([v('Fred'), v('Alex', 'en-US', true)])?.name).toBe('Alex');
    expect(pickSystemVoice([])).toBeUndefined();
  });
});

describe('base64ToBytes', () => {
  it('decodes', () => {
    expect([...base64ToBytes(btoa('abc'))]).toEqual([97, 98, 99]);
  });
});
