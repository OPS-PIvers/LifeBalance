import { bytesToBase64, downmix, encodeWav, resample, rmsFromBytes } from '@/utils/wall/wavEncode';

/**
 * The two ways the wall listens (docs/plans/wall-display-kiosk.md §4.10):
 *  - speech: on-device `webkitSpeechRecognition`, live text, ends on silence;
 *  - audio: `MediaRecorder` with a level-based end-of-speech detector, sent
 *    to Gemini as 16 kHz WAV for transcript + intent in one call.
 * Both are proven out by the Phase 0 lab (components/wall/lab).
 */

export type VoiceCapture = { kind: 'text'; transcript: string } | { kind: 'audio'; data: string; mimeType: string };

/** `unsupported`: the recognizer started but never ran (Safari in a Home Screen app). */
export type VoiceErrorCode = 'no-speech' | 'not-allowed' | 'unavailable' | 'unsupported' | 'aborted' | 'failed';

export class VoiceCaptureError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    message: string = code
  ) {
    super(message);
    this.name = 'VoiceCaptureError';
  }
}

export interface VoiceSession {
  /** Resolves with what was heard, or rejects with a VoiceCaptureError. */
  result: Promise<VoiceCapture>;
  /** Stop listening now and use what was heard so far. */
  finish: () => void;
  /** Stop and discard. */
  cancel: () => void;
}

export interface VoiceListeners {
  onInterim?: (text: string) => void;
  onLevel?: (level: number) => void;
}

export interface VoiceEngine {
  kind: 'speech' | 'audio' | 'device';
  listen: (listeners: VoiceListeners) => VoiceSession;
  /** Releases the microphone (unmount). */
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Engine A: on-device speech recognition
// ---------------------------------------------------------------------------

/** The slice of the (webkit)SpeechRecognition API the wall uses; TS's DOM lib omits it. */
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Safari's recognizer has no end on its own when nobody speaks; this is the backstop. */
const SPEECH_MAX_MS = 10_000;
/**
 * In a Home Screen app iPadOS's recognizer accepts start() and then fires
 * nothing at all: no start, no result, no error, no end. No start event by
 * now means it never will.
 */
export const SPEECH_START_MS = 2500;
/** stop() and abort() can go unanswered too; settle with what was heard after this. */
const SPEECH_SETTLE_MS = 1500;

function speechErrorCode(error: string): VoiceErrorCode {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'not-allowed';
  if (error === 'no-speech') return 'no-speech';
  if (error === 'aborted') return 'aborted';
  if (error === 'audio-capture' || error === 'network') return 'unavailable';
  return 'failed';
}

export function createSpeechEngine(Ctor: SpeechRecognitionCtor): VoiceEngine {
  // One recognizer per launch, as the Phase 0 lab measured it.
  let rec: SpeechRecognitionLike | null = null;
  return {
    kind: 'speech',
    dispose: () => rec?.abort(),
    listen: ({ onInterim }) => {
      const r = rec ?? new Ctor();
      rec = r;
      r.lang = 'en-US';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let finalText = '';
      let interimText = '';
      let error: VoiceErrorCode | null = null;
      let cancelled = false;
      let started = false;
      const timers: number[] = [];
      let settle: () => void = () => undefined;
      const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
      const result = new Promise<VoiceCapture>((resolve, reject) => {
        let settled = false;
        settle = () => {
          if (settled) return;
          settled = true;
          timers.forEach(id => window.clearTimeout(id));
          // Safari sometimes ends without flagging a final result; use what it heard.
          const transcript = (finalText || interimText).trim();
          if (cancelled) reject(new VoiceCaptureError('aborted'));
          else if (error === 'unsupported') reject(new VoiceCaptureError('unsupported'));
          else if (transcript) resolve({ kind: 'text', transcript });
          else reject(new VoiceCaptureError(error ?? 'no-speech'));
        };
        r.onstart = () => {
          started = true;
        };
        r.onspeechstart = null;
        r.onspeechend = null;
        r.onresult = event => {
          started = true;
          let text = '';
          let isFinal = false;
          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (!res) continue;
            text += res[0]?.transcript ?? '';
            if (res.isFinal) isFinal = true;
          }
          interimText = text;
          if (isFinal) finalText = text;
          onInterim?.(text);
        };
        r.onerror = event => {
          started = true;
          error = speechErrorCode(event.error);
        };
        r.onend = () => settle();
      });
      // Stop, and settle even if the recognizer never says it ended.
      const stopNow = () => {
        r.stop();
        later(settle, SPEECH_SETTLE_MS);
      };
      try {
        r.start();
        later(stopNow, SPEECH_MAX_MS);
        later(() => {
          if (started) return;
          error = 'unsupported';
          r.abort();
          later(settle, 300);
        }, SPEECH_START_MS);
      } catch {
        // start() throws InvalidStateError while a previous session is closing.
        r.abort();
        timers.forEach(id => window.clearTimeout(id));
        return { result: Promise.reject(new VoiceCaptureError('failed', 'busy')), finish: () => undefined, cancel: () => undefined };
      }
      return {
        result,
        finish: stopNow,
        cancel: () => {
          cancelled = true;
          r.abort();
          later(settle, SPEECH_SETTLE_MS);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Engine B: recorded audio
// ---------------------------------------------------------------------------

/** Voice-activity settings from plan §4.10 (tuned in the Phase 0 lab). */
const SILENCE_STOP_MS = 1500;
const MAX_RECORD_MS = 8000;
const NO_SPEECH_STOP_MS = 5000;
const CALIBRATE_MS = 300;
const MIN_THRESHOLD = 0.02;
const LOUDNESS = 3;
const WAV_RATE = 16_000;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function audioSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    Boolean(getAudioContextCtor()) &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function pickMimeType(): string | undefined {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
}

async function toWavBase64(ctx: AudioContext, blob: Blob): Promise<{ data: string; mimeType: string }> {
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    return { data: bytesToBase64(encodeWav(resample(downmix(channels), decoded.sampleRate, WAV_RATE), WAV_RATE)), mimeType: 'audio/wav' };
  } catch {
    // Decoding failed: send what MediaRecorder made.
    return { data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), mimeType: (blob.type || 'audio/mp4').split(';')[0] ?? 'audio/mp4' };
  }
}

/**
 * The stream from the first grant stays open with its track disabled between
 * commands, so iPadOS asks for the mic once per launch (plan §4.10).
 */
export function createAudioEngine(): VoiceEngine {
  const AudioCtx = getAudioContextCtor();
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;

  const openStream = async (): Promise<MediaStream> => {
    if (stream && stream.getAudioTracks().some(t => t.readyState !== 'ended')) return stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      return stream;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new VoiceCaptureError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'unavailable');
    }
  };

  return {
    kind: 'audio',
    dispose: () => {
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
      void audioCtx?.close();
      audioCtx = null;
    },
    listen: ({ onLevel }) => {
      let stopReason: 'done' | 'cancel' | null = null;
      const result = (async (): Promise<VoiceCapture> => {
        if (!AudioCtx) throw new VoiceCaptureError('unavailable');
        const s = await openStream();
        if (stopReason === 'cancel') throw new VoiceCaptureError('aborted');
        s.getAudioTracks().forEach(t => {
          t.enabled = true;
        });
        audioCtx ??= new AudioCtx();
        await audioCtx.resume();
        const ctx = audioCtx;
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        const stopped = new Promise<void>(resolve => {
          recorder.onstop = () => resolve();
        });
        const start = performance.now();
        recorder.start(250);

        let floor = 0;
        let samples = 0;
        let lastLoud = 0;
        let heard = false;
        await new Promise<void>(resolve => {
          const id = window.setInterval(() => {
            analyser.getByteTimeDomainData(buf);
            const rms = rmsFromBytes(buf);
            const now = performance.now();
            onLevel?.(rms);
            if (now - start < CALIBRATE_MS) {
              floor = (floor * samples + rms) / (samples + 1);
              samples++;
            } else if (rms > Math.max(MIN_THRESHOLD, floor * LOUDNESS)) {
              heard = true;
              lastLoud = now;
            }
            const end =
              stopReason !== null ||
              (heard && now - lastLoud > SILENCE_STOP_MS) ||
              now - start > MAX_RECORD_MS ||
              (!heard && now - start > NO_SPEECH_STOP_MS);
            if (end) {
              window.clearInterval(id);
              resolve();
            }
          }, 50);
        });
        recorder.stop();
        await stopped;
        source.disconnect();
        onLevel?.(0);
        s.getAudioTracks().forEach(t => {
          t.enabled = false;
        });
        if (stopReason === 'cancel') throw new VoiceCaptureError('aborted');
        // "Done" counts as speech: the person says they finished talking.
        if (!heard && stopReason !== 'done') throw new VoiceCaptureError('no-speech');
        const blob = new Blob(chunks, { type: chunks[0]?.type || mimeType || 'audio/mp4' });
        return { kind: 'audio', ...(await toWavBase64(ctx, blob)) };
      })();
      return {
        result,
        finish: () => {
          stopReason ??= 'done';
        },
        cancel: () => {
          stopReason = 'cancel';
        },
      };
    },
  };
}
