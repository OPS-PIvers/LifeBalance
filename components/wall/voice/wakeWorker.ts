/// <reference lib="webworker" />
/**
 * The wake word runs here, off the main thread: it scores every 80 ms of
 * audio all day, and on the wall's 2015 iPad that would otherwise compete
 * with the UI. Loaded by localVoiceLoader.ts as a module worker.
 *
 * In:  init { models, threshold, ortPrefix } · audio { pcm } · reset { id }
 * Out: ready · error { message } · wake { at } · reset { id }
 *
 * `at` is where the detection happened, in samples since the first one sent,
 * so the main thread can replay the audio from just before it.
 */
import * as ort from 'onnxruntime-web/wasm';
import { WAKE_CHUNK, WakeWordModel, type OrtApi } from './wakeWordModel';

export type WakeWorkerIn =
  | { type: 'init'; models: { melspectrogram: ArrayBuffer; embedding: ArrayBuffer; wake: ArrayBuffer }; threshold: number; ortPrefix: string }
  | { type: 'audio'; pcm: Int16Array }
  | { type: 'reset'; id: number };

export type WakeWorkerOut = { type: 'ready' } | { type: 'error'; message: string } | { type: 'wake'; at: number } | { type: 'reset'; id: number };

/** Once it fires, the same "Hey …" can't fire again for this long. */
const COOLDOWN_SAMPLES = 16000 * 2;
/** If scoring falls this far behind (a slow moment), skip ahead rather than lag. */
const MAX_BACKLOG_SAMPLES = 16000 * 2;
const KEEP_ON_SKIP_SAMPLES = 16000 / 2;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WakeWorkerOut) => ctx.postMessage(m);

let model: WakeWordModel<ort.Tensor> | null = null;
let threshold = 0.5;
let backlog: Int16Array[] = [];
let backlogSamples = 0;
/** Every sample ever received; the backlog ends here. */
let received = 0;
let busy = false;
let quietFor = COOLDOWN_SAMPLES;
let resets: number[] = [];

const api: OrtApi<ort.Tensor> = {
  // logSeverityLevel 3 = errors only: the stock models carry unused initializers ONNX Runtime warns about.
  createSession: bytes => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], logSeverityLevel: 3 }),
  tensor: (data, dims) => new ort.Tensor('float32', data, dims),
};

async function drain(): Promise<void> {
  if (busy || !model) return;
  busy = true;
  try {
    while (model && (backlog.length > 0 || resets.length > 0)) {
      if (resets.length > 0) {
        const ids = resets;
        resets = [];
        backlog = [];
        backlogSamples = 0;
        await model.reset();
        quietFor = COOLDOWN_SAMPLES;
        ids.forEach(id => post({ type: 'reset', id }));
        continue;
      }
      // The backlog ends at `received` (audio arriving during the await goes to the next round).
      const chunkEnd = received;
      let chunk: Int16Array;
      if (backlogSamples > MAX_BACKLOG_SAMPLES) {
        const all = concat(backlog, backlogSamples);
        chunk = all.slice(all.length - KEEP_ON_SKIP_SAMPLES);
      } else {
        chunk = concat(backlog, backlogSamples);
      }
      backlog = [];
      backlogSamples = 0;
      const scores = await model.process(chunk);
      // Score i covers the 80 ms chunk ending here (the model holds back a partial chunk).
      const lastEnd = chunkEnd - model.pendingSamples;
      scores.forEach((score, i) => {
        quietFor += WAKE_CHUNK;
        if (score >= threshold && quietFor >= COOLDOWN_SAMPLES) {
          quietFor = 0;
          post({ type: 'wake', at: lastEnd - (scores.length - 1 - i) * WAKE_CHUNK });
        }
      });
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
}

function concat(parts: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

ctx.onmessage = (event: MessageEvent<WakeWorkerIn>) => {
  const m = event.data;
  if (m.type === 'init') {
    threshold = m.threshold;
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads = 1; // no SharedArrayBuffer without cross-origin isolation
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = m.ortPrefix;
    WakeWordModel.create(api, {
      melspectrogram: new Uint8Array(m.models.melspectrogram),
      embedding: new Uint8Array(m.models.embedding),
      wake: new Uint8Array(m.models.wake),
    }).then(
      created => {
        model = created;
        post({ type: 'ready' });
        void drain();
      },
      (error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    );
  } else if (m.type === 'audio') {
    backlog.push(m.pcm);
    backlogSamples += m.pcm.length;
    received += m.pcm.length;
    void drain();
  } else {
    resets.push(m.id);
    void drain();
  }
};
