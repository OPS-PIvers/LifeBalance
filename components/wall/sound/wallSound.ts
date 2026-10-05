/**
 * The wall's sound (docs/plans/wall-display-kiosk.md §12 "Sound"): soft
 * chimes synthesized with Web Audio (no files to load) and spoken lines.
 *
 * Speech prefers a natural cloud voice (`walltts`, decoded and played through
 * the same AudioContext) and falls back to the iPad's built-in voice when the
 * cloud is slow, offline or refusing.
 *
 * iPadOS keeps all audio locked until a touch in this page session, so
 * `unlock()` must run inside a touch handler. Until then everything here is
 * silent and `state` reads 'locked' (the wall shows "Tap to turn on sound").
 */

export type SoundState = 'locked' | 'ready' | 'unsupported';
export type ChimeKind = 'ok' | 'error' | 'alert' | 'brief' | 'wake';

interface Note {
  freq: number;
  at: number; // s after start
  dur: number; // s
}

/** Gentle, short phrases: a rising pair for yes, a falling pair for no, a three-note bell for alerts. */
export const CHIMES: Record<ChimeKind, { notes: Note[]; peak: number }> = {
  ok: { notes: [{ freq: 880, at: 0, dur: 0.45 }, { freq: 1318.5, at: 0.12, dur: 0.6 }], peak: 0.22 },
  error: { notes: [{ freq: 587.3, at: 0, dur: 0.4 }, { freq: 440, at: 0.16, dur: 0.55 }], peak: 0.2 },
  alert: {
    notes: [{ freq: 659.3, at: 0, dur: 1.1 }, { freq: 784, at: 0.2, dur: 1.1 }, { freq: 1046.5, at: 0.4, dur: 1.4 }],
    peak: 0.2,
  },
  brief: { notes: [{ freq: 784, at: 0, dur: 0.5 }, { freq: 1046.5, at: 0.14, dur: 0.7 }], peak: 0.2 },
  /** The wake word was heard: one short, high note, so it's out of the way before you talk. */
  wake: { notes: [{ freq: 1174.7, at: 0, dur: 0.22 }], peak: 0.18 },
};

/** How long a chime rings before speech should start, in ms. */
export function chimeLengthMs(kind: ChimeKind): number {
  const notes = CHIMES[kind].notes;
  return Math.round(Math.max(...notes.map(n => n.at + n.dur * 0.6)) * 1000);
}

/** Wait this long for the cloud voice before using the iPad's. */
export const CLOUD_TIMEOUT_MS = 5000;
/** After a cloud failure, use the iPad's voice for this long. */
export const CLOUD_BACKOFF_MS = 10 * 60 * 1000;
const CACHE_SIZE = 40;

/** Base64 → bytes, without atob's string limits mattering for a few seconds of MP3. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The best English voice the iPad has: an Enhanced/Premium download beats the default. */
export function pickSystemVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter(v => /^en[-_]US/i.test(v.lang));
  const pool = english.length > 0 ? english : voices.filter(v => /^en/i.test(v.lang));
  return (
    pool.find(v => /premium/i.test(`${v.name} ${v.voiceURI}`)) ??
    pool.find(v => /enhanced/i.test(`${v.name} ${v.voiceURI}`)) ??
    pool.find(v => /samantha/i.test(v.name)) ??
    pool.find(v => v.default) ??
    pool[0]
  );
}

export interface WallSoundDeps {
  createContext?: () => AudioContext | null;
  synth?: SpeechSynthesis | null;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
  online?: () => boolean;
  now?: () => number;
}

export interface WallSound {
  getState: () => SoundState;
  subscribe: (fn: () => void) => () => void;
  /** Call from a touch handler: creates/resumes audio and primes speech. */
  unlock: () => void;
  setVolume: (volume: number) => void;
  /** The cloud voice (base64 MP3 for a phrase), or null for the iPad's voice only. */
  setSynthesizer: (fn: ((text: string) => Promise<string>) | null) => void;
  /** Plays a chime; returns how long to wait before speaking over it. */
  chime: (kind: ChimeKind) => number;
  /** Fetches a phrase's cloud audio ahead of time. */
  prepare: (text: string) => void;
  /** Speaks a line; resolves when it's done (or immediately while locked). */
  speak: (text: string) => Promise<void>;
  stop: () => void;
  dispose: () => void;
}

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return typeof AudioContext === 'undefined' ? w.webkitAudioContext : AudioContext;
}

function defaultContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  return Ctor ? new Ctor() : null;
}

export function createWallSound(deps: WallSoundDeps = {}): WallSound {
  const createContext = deps.createContext ?? defaultContext;
  const synth = deps.synth !== undefined ? deps.synth : typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
  const makeUtterance = deps.makeUtterance ?? ((text: string) => new SpeechSynthesisUtterance(text));
  const online = deps.online ?? (() => navigator.onLine !== false);
  const now = deps.now ?? (() => Date.now());

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let volume = 0.7;
  let synthPrimed = false;
  let synthesize: ((text: string) => Promise<string>) | null = null;
  let cloudDownUntil = 0;
  let source: AudioBufferSourceNode | null = null;
  let finishCurrent: (() => void) | null = null;
  let token = 0;
  const listeners = new Set<() => void>();
  const cache = new Map<string, Promise<AudioBuffer>>();

  const notify = () => listeners.forEach(fn => fn());
  const hasAudio = Boolean(deps.createContext) || Boolean(audioContextCtor());
  const unsupported = () => !hasAudio && !synth;

  const getState = (): SoundState => {
    if (ctx) return ctx.state === 'running' ? 'ready' : 'locked';
    return unsupported() ? 'unsupported' : 'locked';
  };

  const unlock = () => {
    if (!ctx) {
      try {
        ctx = createContext();
      } catch {
        ctx = null;
      }
      if (ctx) {
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
        ctx.onstatechange = notify;
      }
    }
    if (ctx && ctx.state !== 'running') {
      // A one-sample silent buffer is what actually unlocks iOS output.
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(ctx.destination);
        s.start(0);
      } catch {
        // Not fatal; resume() below may still do it.
      }
      void ctx.resume().then(notify, notify);
    }
    if (synth && !synthPrimed) {
      synthPrimed = true;
      try {
        const u = makeUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      } catch {
        // The iPad voice may stay locked; cloud speech still works.
      }
    }
    notify();
  };

  const chime = (kind: ChimeKind): number => {
    if (!ctx || !master || ctx.state !== 'running') return 0;
    const { notes, peak } = CHIMES[kind];
    const t0 = ctx.currentTime + 0.02;
    for (const n of notes) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0 + n.at);
      env.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      env.connect(master);
      // A sine plus a quiet octave reads as a soft bell rather than a beep.
      for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n.freq * mult;
        g.gain.value = level;
        osc.connect(g);
        g.connect(env);
        osc.start(t0 + n.at);
        osc.stop(t0 + n.at + n.dur + 0.05);
      }
    }
    return chimeLengthMs(kind);
  };

  const cloudBuffer = (text: string): Promise<AudioBuffer> => {
    const hit = cache.get(text);
    if (hit) {
      cache.delete(text);
      cache.set(text, hit);
      return hit;
    }
    const audio = ctx;
    const fn = synthesize;
    if (!audio || !fn) return Promise.reject(new Error('no cloud voice'));
    const p = fn(text).then(b64 => {
      const bytes = base64ToBytes(b64);
      return audio.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    });
    cache.set(text, p);
    p.catch(() => {
      cache.delete(text);
      cloudDownUntil = now() + CLOUD_BACKOFF_MS;
    });
    while (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return p;
  };

  const cloudUsable = () => Boolean(synthesize && ctx && ctx.state === 'running' && online() && now() >= cloudDownUntil);

  const stop = () => {
    token += 1;
    try {
      source?.stop();
    } catch {
      // Already stopped.
    }
    source = null;
    synth?.cancel();
    finishCurrent?.();
    finishCurrent = null;
  };

  const speakSystem = (text: string, mine: number): Promise<void> =>
    new Promise(resolve => {
      if (!synth || mine !== token) return resolve();
      const u = makeUtterance(text);
      u.volume = volume;
      u.rate = 1;
      const voice = pickSystemVoice(synth.getVoices());
      if (voice) u.voice = voice;
      // iOS sometimes never fires `end`; don't hang a brief on it.
      const guard = window.setTimeout(done, 3000 + text.length * 120);
      function done() {
        window.clearTimeout(guard);
        if (finishCurrent === done) finishCurrent = null;
        resolve();
      }
      finishCurrent = done;
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });

  const speak = async (text: string): Promise<void> => {
    stop();
    const mine = token;
    if (getState() !== 'ready') return;
    if (cloudUsable()) {
      try {
        const buffer = await Promise.race([
          cloudBuffer(text),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('slow')), CLOUD_TIMEOUT_MS)),
        ]);
        if (mine !== token || !ctx || !master) return;
        const audio = ctx;
        const out = master;
        await new Promise<void>(resolve => {
          const s = audio.createBufferSource();
          s.buffer = buffer;
          s.connect(out);
          const done = () => {
            if (finishCurrent === done) finishCurrent = null;
            if (source === s) source = null;
            resolve();
          };
          finishCurrent = done;
          s.onended = done;
          source = s;
          s.start();
        });
        return;
      } catch {
        if (mine !== token) return;
      }
    }
    await speakSystem(text, mine);
  };

  return {
    getState,
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    unlock,
    setVolume: v => {
      volume = Math.min(1, Math.max(0, v));
      if (master) master.gain.value = volume;
    },
    setSynthesizer: fn => {
      synthesize = fn;
      cache.clear();
    },
    chime,
    prepare: text => {
      if (cloudUsable()) cloudBuffer(text).catch(() => undefined);
    },
    speak,
    stop,
    dispose: () => {
      stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
      master = null;
    },
  };
}
