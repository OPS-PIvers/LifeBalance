import type { WallPicovoice } from '@/types/schema';
import { VoiceCaptureError, type VoiceCapture, type VoiceEngine, type VoiceSession } from './voiceEngines';

/**
 * The on-device engine (docs/plans/wall-display-kiosk.md §12 "Wake word"):
 * Picovoice Porcupine listens for the wake word and Cheetah transcribes the
 * command, both in WebAssembly on the iPad, fed by ONE microphone stream
 * (Picovoice's WebVoiceProcessor). Nothing is sent anywhere, so it costs no
 * AI allowance, and it doesn't use Safari's `webkitSpeechRecognition`, which
 * never fires a single event in a Home Screen app.
 *
 * The mic is handed over, never dropped: during a command Cheetah subscribes
 * BEFORE Porcupine unsubscribes, and the reverse after it. The processor
 * releases the mic whenever its subscriber list empties, and a fresh
 * `getUserMedia` can re-prompt on iPadOS.
 */

/** Porcupine's and Cheetah's English models, from Picovoice's own repos (cached in IndexedDB after the first load). */
export const PORCUPINE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/Picovoice/porcupine@v4.0/lib/common/porcupine_params.pv';
// 35.7 MB: over jsDelivr's 20 MB GitHub limit, so straight from GitHub (CORS *).
export const CHEETAH_MODEL_URL = 'https://raw.githubusercontent.com/Picovoice/cheetah/v4.2/lib/common/cheetah_params.pv';

/** After the wake word: give up if nobody speaks. */
export const DEVICE_NO_SPEECH_MS = 6000;
/** A command never runs longer than this. */
export const DEVICE_MAX_MS = 12_000;
/** Silence that ends a command (Cheetah's endpoint). */
export const DEVICE_ENDPOINT_SEC = 1.0;

interface Transcript {
  transcript: string;
  isEndpoint?: boolean;
  isFlushed?: boolean;
}

/** The slice of Picovoice's API this engine uses (injectable for tests). */
export interface PicovoiceEngine {
  worker: Worker;
}
export interface CheetahHandle extends PicovoiceEngine {
  flush: () => void;
  release: () => Promise<void>;
  terminate: () => void;
}
export interface PorcupineHandle extends PicovoiceEngine {
  release: () => Promise<void>;
  terminate: () => void;
}
export interface PicovoiceLib {
  createCheetah: (accessKey: string, onTranscript: (t: Transcript) => void, onError: (e: Error) => void) => Promise<CheetahHandle>;
  createPorcupine: (config: WallPicovoice, onWake: () => void, onError: (e: Error) => void) => Promise<PorcupineHandle>;
  subscribe: (engine: PicovoiceEngine) => Promise<void>;
  unsubscribe: (engine: PicovoiceEngine) => Promise<void>;
}

/** The real Picovoice packages, loaded only when the wall first listens (never in tests). */
const loadPicovoice = (): Promise<PicovoiceLib> => import('./picovoiceLoader').then(m => m.loadPicovoice());

/** Picovoice's and the mic's errors → the banner's codes. */
export function deviceErrorCode(error: unknown): VoiceCaptureError {
  if (error instanceof VoiceCaptureError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (/PermissionError|NotAllowedError|SecurityError/.test(name) || /permission/i.test(message)) {
    return new VoiceCaptureError('not-allowed', message);
  }
  if (/Activation|AccessKey|Key/i.test(name) || /AccessKey|activation/i.test(message)) {
    return new VoiceCaptureError('unavailable', 'activation');
  }
  return new VoiceCaptureError('unavailable', message);
}

export interface DeviceVoiceEngine extends VoiceEngine {
  kind: 'device';
  /**
   * Turns wake-word listening on or off. Resolves once the mic is listening
   * (or released); rejects with a VoiceCaptureError when it can't start.
   */
  setWake: (on: boolean) => Promise<void>;
}

export function createDeviceEngine(
  config: WallPicovoice,
  onWake: () => void,
  lib: () => Promise<PicovoiceLib> = loadPicovoice,
  timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void } = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: id => window.clearTimeout(id),
  }
): DeviceVoiceEngine {
  let libP: Promise<PicovoiceLib> | null = null;
  let cheetahP: Promise<CheetahHandle> | null = null;
  let porcupineP: Promise<PorcupineHandle> | null = null;
  let disposed = false;
  let wakeWanted = false;
  let wakeOn = false;
  let inCommand = false;
  /** Where Cheetah's transcripts go while a command runs. */
  let onTranscript: ((t: Transcript) => void) | null = null;
  let onCheetahError: ((e: Error) => void) | null = null;
  /** Flush answers still owed for commands that already ended; theirs, not the next one's. */
  let staleFlushes = 0;
  // Every mic change runs in order, so a quick wake → command → wake never races.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const getLib = () => (libP ??= lib());
  const getCheetah = () =>
    (cheetahP ??= getLib().then(l =>
      l.createCheetah(
        config.accessKey,
        t => {
          if (staleFlushes > 0) {
            if (t.isFlushed) staleFlushes -= 1;
            return;
          }
          onTranscript?.(t);
        },
        e => onCheetahError?.(e)
      )
    )).catch(error => {
      cheetahP = null;
      throw deviceErrorCode(error);
    });
  const getPorcupine = () =>
    (porcupineP ??= getLib().then(l =>
      l.createPorcupine(
        config,
        () => {
          if (wakeOn && !inCommand) onWake();
        },
        e => console.error('[wall] wake word error:', e)
      )
    )).catch(error => {
      porcupineP = null;
      throw deviceErrorCode(error);
    });

  const applyWake = () =>
    serial(async () => {
      if (disposed) return;
      const want = wakeWanted && !inCommand;
      if (want === wakeOn) return;
      const l = await getLib();
      const porcupine = await getPorcupine();
      if (want) {
        await l.subscribe(porcupine).catch(error => {
          throw deviceErrorCode(error);
        });
        wakeOn = true;
      } else {
        wakeOn = false;
        await l.unsubscribe(porcupine);
      }
    });

  return {
    kind: 'device',
    setWake: on => {
      wakeWanted = on;
      return applyWake();
    },
    dispose: () => {
      disposed = true;
      onTranscript = null;
      const release = async () => {
        const l = await libP?.catch(() => null);
        const c = await cheetahP?.catch(() => null);
        const p = await porcupineP?.catch(() => null);
        if (l && c) await l.unsubscribe(c).catch(() => undefined);
        if (l && p) await l.unsubscribe(p).catch(() => undefined);
        await c?.release().catch(() => undefined);
        c?.terminate();
        await p?.release().catch(() => undefined);
        p?.terminate();
      };
      void serial(release);
    },
    listen: ({ onInterim }): VoiceSession => {
      let text = '';
      let settled = false;
      let flushing = false;
      let stopReason: 'done' | 'cancel' | null = null;
      let flushNow: (() => void) | null = null;
      let fail: ((e: VoiceCaptureError) => void) | null = null;
      const timersOn: number[] = [];

      const result = new Promise<VoiceCapture>((resolve, reject) => {
        let cheetah: CheetahHandle | null = null;
        let flushAnswered = false;
        const end = (outcome: { ok: string } | { err: VoiceCaptureError }) => {
          if (settled) return;
          settled = true;
          timersOn.forEach(timers.clear);
          onTranscript = null;
          onCheetahError = null;
          const c = cheetah;
          // Hand the mic back to the wake word before letting Cheetah go.
          void serial(async () => {
            inCommand = false;
            const l = await getLib();
            if (wakeWanted && !disposed && !wakeOn) {
              const p = await getPorcupine().catch(() => null);
              if (p) {
                await l.subscribe(p).then(
                  () => {
                    wakeOn = true;
                  },
                  () => undefined
                );
              }
            }
            if (!c) return;
            await l.unsubscribe(c).catch(() => undefined);
            // Cheetah keeps what it heard until a flush: clear it so it can't
            // open the next command, and drop the answer when it comes.
            if (!flushing) {
              staleFlushes += 1;
              c.flush();
            } else if (!flushAnswered) {
              staleFlushes += 1;
            }
          });
          if ('ok' in outcome) resolve({ kind: 'text', transcript: outcome.ok });
          else reject(outcome.err);
        };
        const heard = () => (text.trim() ? { ok: text.trim() } : { err: new VoiceCaptureError('no-speech') });
        const flush = () => {
          if (flushing || settled || !cheetah) return;
          flushing = true;
          cheetah.flush();
          // A flush that never answers mustn't strand the banner.
          timersOn.push(timers.set(() => end(heard()), 1500));
        };
        flushNow = flush;
        fail = err => end({ err });

        void serial(async () => {
          if (settled) return;
          inCommand = true;
          const l = await getLib();
          const c = await getCheetah();
          if (settled) return;
          cheetah = c;
          onTranscript = t => {
            if (settled) return;
            if (t.transcript) {
              text += t.transcript;
              onInterim?.(text.trim());
            }
            if (t.isFlushed) {
              flushAnswered = true;
              end(heard());
            } else if (t.isEndpoint && text.trim()) {
              flush();
            }
          };
          onCheetahError = e => end({ err: deviceErrorCode(e) });
          await l.subscribe(c).catch(error => {
            throw deviceErrorCode(error);
          });
          // Cheetah has the mic now; the wake word can step off.
          if (wakeOn) {
            const p = await getPorcupine();
            wakeOn = false;
            await l.unsubscribe(p);
          }
        }).then(
          () => {
            if (settled) return;
            if (stopReason === 'cancel') {
              end({ err: new VoiceCaptureError('aborted') });
              return;
            }
            if (stopReason === 'done') {
              flush();
              return;
            }
            timersOn.push(
              timers.set(() => {
                if (!text.trim()) end({ err: new VoiceCaptureError('no-speech') });
              }, DEVICE_NO_SPEECH_MS),
              timers.set(flush, DEVICE_MAX_MS)
            );
          },
          error => end({ err: deviceErrorCode(error) })
        );
      });

      return {
        result,
        finish: () => {
          stopReason ??= 'done';
          flushNow?.();
        },
        cancel: () => {
          stopReason = 'cancel';
          fail?.(new VoiceCaptureError('aborted'));
        },
      };
    },
  };
}
