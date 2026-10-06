import type { WallWakeFile, WallWakeModel } from '@/types/schema';
import type { LocalVoiceLib, MicListener, Recognizer, RecognizerEvents, WakeListener } from './deviceEngine';
import type { WakeWorkerIn, WakeWorkerOut } from './wakeWorker';
import { ORT_WASM_PREFIX, VOSK_MODEL_URL, WAKE_FEATURE_URLS, builtInWakeUrl } from './voiceAssets';

/**
 * deviceEngine's seam to the real libraries: openWakeWord (in wakeWorker.ts),
 * Vosk (vosk-browser, in its own worker) and the shared mic
 * (@picovoice/web-voice-processor: open source, no key, 16 kHz int16 frames).
 * Its own module so these WebAssembly packages load only on a wall that
 * listens, and so tests (which inject a fake lib) never resolve them.
 */

/** Ready once the model is unpacked; the first run downloads 41 MB, so allow for a slow connection. */
const VOSK_LOAD_MS = 180_000;
const WAKE_LOAD_MS = 60_000;
/**
 * Played into a command from just before the wake word fired, for a command
 * said without a pause. Kept short: more catches the end of the wake word
 * itself ("Jarvis" → "this"), which trimLeadIn has to clean up.
 */
const PRE_WAKE_SAMPLES = 16000 / 10;
/** Audio kept for that, from the detection until the recognizers take over. */
const RING_SAMPLES = 16000 * 8;

/**
 * Fetches a model file. Hosting answers an unknown path with the app's page (200, HTML), and
 * voice/** is cached for a year, so a device that once got that page can keep it: anything that
 * isn't a model is fetched once more past the cache before giving up.
 */
async function fetchModel(url: string): Promise<ArrayBuffer> {
  const notModel = (res: Response) => !res.ok || (res.headers.get('content-type') ?? '').includes('text/html');
  let res = await fetch(url);
  if (notModel(res)) res = await fetch(url, { cache: 'reload' });
  if (notModel(res)) {
    const type = res.headers.get('content-type') || 'no type';
    throw new Error(`Voice model ${url} didn't load (${res.status}, ${type}).`);
  }
  return res.arrayBuffer();
}

type VoskModule = typeof import('vosk-browser');
type VoskModel = InstanceType<VoskModule['Model']>;

export async function loadLocalVoice(): Promise<LocalVoiceLib> {
  const [vosk, { WebVoiceProcessor }] = await Promise.all([import('vosk-browser'), import('@picovoice/web-voice-processor')]);

  let voskP: Promise<VoskModel> | null = null;
  const voskModel = () =>
    (voskP ??= new Promise<VoskModel>((resolve, reject) => {
      // Not vosk.createModel: it never settles when loading fails.
      const model = new vosk.Model(new URL(VOSK_MODEL_URL, window.location.origin).href, -1);
      const timer = window.setTimeout(() => {
        model.terminate();
        reject(new Error('The speech model took too long to load.'));
      }, VOSK_LOAD_MS);
      let loaded = false;
      model.on('load', message => {
        window.clearTimeout(timer);
        loaded = message.event === 'load' && message.result;
        if (loaded) resolve(model);
        else reject(new Error('The speech model failed to load.'));
      });
      model.on('error', message => {
        // vosk-browser sends no text when the file isn't a model it can unpack.
        const text = (message.event === 'error' && message.error) || 'the file isn’t a model it can unpack';
        // After loading, a model-level error is one message gone wrong, not a dead model.
        if (loaded) {
          console.warn('[wall] speech model:', text);
          return;
        }
        window.clearTimeout(timer);
        model.terminate();
        reject(new Error(`The speech model failed to load: ${text}`));
      });
    })).catch(error => {
      voskP = null;
      throw error;
    });

  const createRecognizer = async (events: RecognizerEvents, phrases?: readonly string[]): Promise<Recognizer> => {
    const model = await voskModel();
    const rec = new model.KaldiRecognizer(16000, phrases && phrases.length > 0 ? JSON.stringify([...phrases, '[unk]']) : undefined);
    rec.on('partialresult', message => {
      if (message.event === 'partialresult') events.onPartial(message.result.partial);
    });
    rec.on('result', message => {
      if (message.event === 'result') events.onResult(message.result.text);
    });
    rec.on('error', message => {
      if (message.event === 'error') events.onError(new Error(message.error));
    });
    let released = false;
    // vosk-browser scales -1…1 floats to int16 range itself.
    const feed = (pcm: Int16Array) => {
      if (released || pcm.length === 0) return;
      const f = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f[i] = (pcm[i] ?? 0) / 32768;
      rec.acceptWaveformFloat(f, 16000);
    };
    return {
      onmessage: event => feed(event.data.inputFrame),
      feed,
      finish: () => {
        if (!released) rec.retrieveFinalResult();
      },
      release: () => {
        if (released) return;
        released = true;
        rec.remove();
      },
    };
  };

  const createWake = async (
    wakeModel: WallWakeModel,
    onWake: () => void,
    loadFile: (file: WallWakeFile) => Promise<Uint8Array>
  ): Promise<WakeListener> => {
    const custom = wakeModel.keyword === 'custom' ? wakeModel.file : undefined;
    const [melspectrogram, embedding, wake] = await Promise.all([
      fetchModel(WAKE_FEATURE_URLS.melspectrogram),
      fetchModel(WAKE_FEATURE_URLS.embedding),
      // A copy: the worker takes ownership of what it's sent.
      custom ? loadFile(custom).then(bytes => bytes.slice().buffer) : fetchModel(builtInWakeUrl(wakeModel.keyword)),
    ]);
    const worker = new Worker(new URL('./wakeWorker.ts', import.meta.url), { type: 'module' });
    const ring = new Int16Array(RING_SAMPLES);
    let written = 0; // total samples ever heard
    let wakeAt = 0; // where the last detection fired, on the same count
    let resetId = 0;
    const resetWaiters = new Map<number, () => void>();

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The wake word took too long to load.')), WAKE_LOAD_MS);
      worker.onmessage = (event: MessageEvent<WakeWorkerOut>) => {
        const m = event.data;
        if (m.type === 'ready') {
          window.clearTimeout(timer);
          resolve();
        } else if (m.type === 'error') {
          window.clearTimeout(timer);
          reject(new Error(`The wake word failed to load: ${m.message}`));
        }
      };
      worker.onerror = event => {
        window.clearTimeout(timer);
        reject(new Error(`The wake word failed to load: ${event.message || 'its worker didn’t start'}`));
      };
      const init: WakeWorkerIn = {
        type: 'init',
        models: { melspectrogram, embedding, wake },
        threshold: wakeModel.threshold,
        ortPrefix: new URL(ORT_WASM_PREFIX, window.location.origin).href,
      };
      worker.postMessage(init, [melspectrogram, embedding, wake]);
    }).catch(error => {
      worker.terminate();
      throw error;
    });

    worker.onmessage = (event: MessageEvent<WakeWorkerOut>) => {
      const m = event.data;
      if (m.type === 'wake') {
        wakeAt = m.at;
        onWake();
      } else if (m.type === 'reset') {
        resetWaiters.get(m.id)?.();
        resetWaiters.delete(m.id);
      } else if (m.type === 'error') {
        console.error('[wall] wake word error:', m.message);
      }
    };

    return {
      onmessage: event => {
        const frame = event.data.inputFrame;
        for (let i = 0; i < frame.length; i++) ring[(written + i) % RING_SAMPLES] = frame[i] ?? 0;
        written += frame.length;
        const copy = frame.slice();
        const msg: WakeWorkerIn = { type: 'audio', pcm: copy };
        worker.postMessage(msg, [copy.buffer]);
      },
      sinceWake: () => {
        const from = Math.max(0, wakeAt - PRE_WAKE_SAMPLES, written - RING_SAMPLES);
        const out = new Int16Array(written - from);
        for (let i = 0; i < out.length; i++) out[i] = ring[(from + i) % RING_SAMPLES] ?? 0;
        return out;
      },
      reset: () =>
        new Promise<void>(resolve => {
          resetId += 1;
          const id = resetId;
          // Never hang the mic hand-back on it.
          const timer = window.setTimeout(() => {
            resetWaiters.delete(id);
            resolve();
          }, 5000);
          resetWaiters.set(id, () => {
            window.clearTimeout(timer);
            resolve();
          });
          const msg: WakeWorkerIn = { type: 'reset', id };
          worker.postMessage(msg);
        }),
      release: () => worker.terminate(),
    };
  };

  return {
    prepare: () => voskModel().then(() => undefined),
    createWake,
    createRecognizer,
    subscribe: (listeners: MicListener[]) => WebVoiceProcessor.subscribe(listeners),
    unsubscribe: (listeners: MicListener[]) => WebVoiceProcessor.unsubscribe(listeners),
  };
}
