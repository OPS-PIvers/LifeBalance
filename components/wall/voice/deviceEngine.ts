import type { WallWakeFile, WallWakeModel } from '@/types/schema';
import { VoiceCaptureError, type VoiceCapture, type VoiceEngine, type VoiceSession } from './voiceEngines';

/**
 * The on-device engine (docs/plans/wall-display-kiosk.md §12 "Wake word"):
 * openWakeWord listens for the wake word and Vosk transcribes the command,
 * both in WebAssembly on the iPad, fed by ONE microphone stream (the
 * open-source @picovoice/web-voice-processor; no account or key). Nothing is
 * sent anywhere, so it costs nothing, and it doesn't use Safari's
 * `webkitSpeechRecognition`, which never fires a single event in a Home
 * Screen app.
 *
 * Each command gets two fresh Vosk recognizers on the same audio: a free one
 * (for adds and to-dos) and one limited to the wall's fixed commands, which
 * hears "show the calendar" where the free one hears "though the calendar".
 * The hook picks between them (`pickTranscript`).
 *
 * The mic is handed over, never dropped: the recognizers subscribe BEFORE the
 * wake word unsubscribes, and the reverse after. The processor releases the
 * mic whenever its subscriber list empties, and a fresh `getUserMedia` can
 * re-prompt on iPadOS.
 */

/** After the wake word (or a tap): give up if nobody speaks. */
export const DEVICE_NO_SPEECH_MS = 6000;
/** A command never runs longer than this. */
export const DEVICE_MAX_MS = 12_000;
/** How long to wait for a recognizer's last words after asking for them. */
export const DEVICE_FINAL_MS = 1500;
/** Say "getting voice ready" only when starting takes longer than this (the first run downloads the model). */
const LOADING_AFTER_MS = 400;

/** The open-source WebVoiceProcessor delivers 16 kHz int16 frames to any object with `onmessage`. */
export interface MicListener {
  onmessage: (event: MessageEvent<{ command: string; inputFrame: Int16Array }>) => void;
}

export interface WakeListener extends MicListener {
  /**
   * Everything heard from just before the last detection until now, played
   * into the recognizers so words said straight after the wake word (while
   * they start up) aren't lost.
   */
  sinceWake: () => Int16Array;
  /** Forget everything heard, so the wake word that opened a command can't fire again after it. */
  reset: () => Promise<void>;
  release: () => void;
}

export interface RecognizerEvents {
  onPartial: (text: string) => void;
  /** A finished utterance ('' when it heard nothing). */
  onResult: (text: string) => void;
  onError: (error: Error) => void;
}

export interface Recognizer extends MicListener {
  /** Audio that isn't from the mic (the moments before the wake word). */
  feed: (pcm: Int16Array) => void;
  /** Ends now: `onResult` follows with whatever was heard. */
  finish: () => void;
  release: () => void;
}

/** The seam to the real libraries (localVoiceLoader.ts); tests inject a fake. */
export interface LocalVoiceLib {
  /** Starts loading the speech model, so the first command doesn't wait for it. */
  prepare: () => Promise<void>;
  /** `loadFile` fetches a custom model's .onnx (built-in ones are served with the app). */
  createWake: (model: WallWakeModel, onWake: () => void, loadFile: (file: WallWakeFile) => Promise<Uint8Array>) => Promise<WakeListener>;
  /** A fresh recognizer; with `phrases`, it can only hear those (anything else is "[unk]"). */
  createRecognizer: (events: RecognizerEvents, phrases?: readonly string[]) => Promise<Recognizer>;
  /** Listeners passed together start on the same mic frame. */
  subscribe: (listeners: MicListener[]) => Promise<void>;
  unsubscribe: (listeners: MicListener[]) => Promise<void>;
}

/** The real libraries, loaded only when the wall first listens (never in tests). */
const loadLocalVoice = (): Promise<LocalVoiceLib> => import('./localVoiceLoader').then(m => m.loadLocalVoice());

/** Mic and library errors → the banner's codes. */
export function deviceErrorCode(error: unknown): VoiceCaptureError {
  if (error instanceof VoiceCaptureError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (/PermissionError|NotAllowedError|SecurityError/.test(name) || /permission/i.test(message)) {
    return new VoiceCaptureError('not-allowed', message);
  }
  return new VoiceCaptureError('unavailable', message);
}

export interface DeviceListenOptions {
  /** The wake word opened this command: include the moments before it. */
  afterWake?: boolean;
  /** The speech model is still loading (first run downloads it). */
  onLoading?: (loading: boolean) => void;
}

export interface DeviceVoiceEngine extends VoiceEngine {
  kind: 'device';
  listen: (listeners: Parameters<VoiceEngine['listen']>[0] & DeviceListenOptions) => VoiceSession;
  /**
   * Turns wake-word listening on or off. Resolves once the mic is listening
   * (or released); rejects with a VoiceCaptureError when it can't start.
   */
  setWake: (on: boolean) => Promise<void>;
}

export interface DeviceEngineOptions {
  /** The libraries (injected by tests). */
  lib?: () => Promise<LocalVoiceLib>;
  /** What the command-only recognizer can hear; none = free recognizer only. */
  commandPhrases?: readonly string[];
  /** Fetches a custom wake word's .onnx. */
  loadFile?: (file: WallWakeFile) => Promise<Uint8Array>;
  timers?: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void };
}

export function createDeviceEngine(model: WallWakeModel, onWake: () => void, options: DeviceEngineOptions = {}): DeviceVoiceEngine {
  const lib = options.lib ?? loadLocalVoice;
  const commandPhrases = options.commandPhrases ?? [];
  const loadFile = options.loadFile ?? (() => Promise.reject(new Error('No wake word file loader.')));
  const timers = options.timers ?? {
    set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
    clear: (id: number) => window.clearTimeout(id),
  };
  let libP: Promise<LocalVoiceLib> | null = null;
  let wakeP: Promise<WakeListener> | null = null;
  let disposed = false;
  let wakeWanted = false;
  let wakeOn = false;
  let inCommand = false;
  // Every mic change runs in order, so a quick wake → command → wake never races.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const getLib = () =>
    (libP ??= lib()).catch(error => {
      libP = null;
      throw deviceErrorCode(error);
    });
  const getWake = () =>
    (wakeP ??= getLib().then(l =>
      l.createWake(
        model,
        () => {
          if (wakeOn && !inCommand && !disposed) onWake();
        },
        loadFile
      )
    )).catch(error => {
      wakeP = null;
      throw deviceErrorCode(error);
    });

  const applyWake = () =>
    serial(async () => {
      if (disposed) return;
      const want = wakeWanted && !inCommand;
      if (want === wakeOn) return;
      const l = await getLib();
      const wake = await getWake();
      if (want) {
        // Load the speech model now, not on the first "Hey …".
        void l.prepare().catch(() => undefined);
        await l.subscribe([wake]).catch(error => {
          throw deviceErrorCode(error);
        });
        wakeOn = true;
      } else {
        wakeOn = false;
        await l.unsubscribe([wake]);
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
      void serial(async () => {
        const l = await libP?.catch(() => null);
        const w = await wakeP?.catch(() => null);
        if (l && w) await l.unsubscribe([w]).catch(() => undefined);
        w?.release();
      });
    },
    listen: ({ onInterim, afterWake = false, onLoading }): VoiceSession => {
      let settled = false;
      let stopReason: 'done' | 'cancel' | null = null;
      let finishNow: (() => void) | null = null;
      let fail: ((e: VoiceCaptureError) => void) | null = null;
      const timersOn: number[] = [];

      const result = new Promise<VoiceCapture>((resolve, reject) => {
        let free: Recognizer | null = null;
        let command: Recognizer | null = null;
        let heard = '';
        let freeFinal: string | null = null;
        let commandFinal: string | null = null;
        let finishing = false;

        const end = (outcome: { ok: VoiceCapture } | { err: VoiceCaptureError }) => {
          if (settled) return;
          settled = true;
          timersOn.forEach(timers.clear);
          onLoading?.(false);
          const used = [free, command].filter((r): r is Recognizer => r !== null);
          // Hand the mic back to the wake word (fresh, so it can't re-fire on
          // what it already heard) before letting the recognizers go.
          void serial(async () => {
            inCommand = false;
            const l = await getLib().catch(() => null);
            if (!l) return;
            if (wakeWanted && !disposed && !wakeOn) {
              const wake = await getWake().catch(() => null);
              if (wake) {
                await wake.reset().catch(() => undefined);
                await l.subscribe([wake]).then(
                  () => {
                    wakeOn = true;
                  },
                  () => undefined
                );
              }
            }
            await l.unsubscribe(used).catch(() => undefined);
            used.forEach(r => r.release());
          });
          if ('ok' in outcome) resolve(outcome.ok);
          else reject(outcome.err);
        };

        const settleIfDone = () => {
          if (freeFinal === null) return;
          // The command-only recognizer only rescues an unreadable free transcript;
          // don't hold the answer for it once the free one is done and it isn't.
          if (command && commandFinal === null) return;
          const transcript = (freeFinal || heard).trim();
          const alt = commandFinal?.trim() ?? '';
          if (!transcript && !alt) end({ err: new VoiceCaptureError('no-speech') });
          else end({ ok: { kind: 'text', transcript: transcript || alt, ...(alt && transcript ? { alternative: alt } : {}) } });
        };

        const finishAll = () => {
          if (finishing || settled) return;
          finishing = true;
          free?.finish();
          command?.finish();
          // Recognizers that never answer mustn't strand the banner.
          timersOn.push(
            timers.set(() => {
              freeFinal ??= heard;
              commandFinal ??= '';
              settleIfDone();
            }, DEVICE_FINAL_MS)
          );
        };
        finishNow = finishAll;
        fail = err => end({ err });

        const onError = (e: Error) => end({ err: deviceErrorCode(e) });

        void serial(async () => {
          if (settled) return;
          inCommand = true;
          const l = await getLib();
          const loading = timers.set(() => onLoading?.(true), LOADING_AFTER_MS);
          timersOn.push(loading);
          // A recognizer that arrives after the command ended is let go at once.
          const adopt = (r: Recognizer): Recognizer | null => {
            if (!settled) return r;
            r.release();
            return null;
          };
          free = adopt(
            await l.createRecognizer({
              onPartial: text => {
                // Vosk repeats the same partial for every chunk of audio.
                if (settled || !text || text === heard) return;
                heard = text;
                onInterim?.(text);
              },
              onResult: text => {
                if (settled) return;
                // An empty result is Vosk noticing silence; keep listening unless we asked to stop.
                if (!text && !finishing) return;
                if (text) heard = text;
                freeFinal = text || heard;
                onInterim?.(heard);
                if (!finishing) {
                  finishing = true;
                  command?.finish();
                  timersOn.push(
                    timers.set(() => {
                      commandFinal ??= '';
                      settleIfDone();
                    }, DEVICE_FINAL_MS)
                  );
                }
                settleIfDone();
              },
              onError,
            })
          );
          if (!free) return;
          if (commandPhrases.length > 0) {
            command = adopt(
              await l.createRecognizer(
                {
                  onPartial: () => undefined,
                  onResult: text => {
                    if (settled) return;
                    if (!text && !finishing) return;
                    commandFinal = text;
                    settleIfDone();
                  },
                  onError: () => {
                    // The free transcript still stands without it.
                    commandFinal ??= '';
                    settleIfDone();
                  },
                },
                commandPhrases
              )
            );
            if (!command) return;
          }
          timers.clear(loading);
          onLoading?.(false);
          // The wake word is still listening, so this covers everything up to now.
          const before = afterWake && wakeOn ? (await getWake()).sinceWake() : null;
          if (before && before.length > 0) {
            free.feed(before);
            command?.feed(before);
          }
          await l.subscribe(command ? [free, command] : [free]).catch(error => {
            throw deviceErrorCode(error);
          });
          // The recognizers have the mic now; the wake word can step off.
          if (wakeOn) {
            const wake = await getWake();
            wakeOn = false;
            await l.unsubscribe([wake]);
          }
        }).then(
          () => {
            if (settled) return;
            if (stopReason === 'cancel') {
              end({ err: new VoiceCaptureError('aborted') });
              return;
            }
            if (stopReason === 'done') {
              finishAll();
              return;
            }
            timersOn.push(
              timers.set(() => {
                if (!heard.trim() && !finishing) end({ err: new VoiceCaptureError('no-speech') });
              }, DEVICE_NO_SPEECH_MS),
              timers.set(finishAll, DEVICE_MAX_MS)
            );
          },
          error => end({ err: deviceErrorCode(error) })
        );
      });

      return {
        result,
        finish: () => {
          stopReason ??= 'done';
          finishNow?.();
        },
        cancel: () => {
          stopReason = 'cancel';
          fail?.(new VoiceCaptureError('aborted'));
        },
      };
    },
  };
}
