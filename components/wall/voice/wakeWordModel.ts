/**
 * openWakeWord's streaming pipeline (github.com/dscripka/openWakeWord,
 * `openwakeword/utils.py` AudioFeatures + `model.py` predict), ported line for
 * line so a model scores the same here as in Python:
 *
 *   16 kHz int16 audio, 1280 samples (80 ms) at a time
 *   → melspectrogram.onnx   on the new chunk plus the 480 samples before it
 *                           → 8 frames × 32 bins, then x / 10 + 2
 *   → embedding_model.onnx  on the last 76 mel frames → one 96-number feature
 *   → the wake word model   on the last N features (16 for every openWakeWord model)
 *                           → a 0–1 score
 *
 * ONNX Runtime is injected (`OrtApi`), so this file has no runtime dependency
 * and is checked against Python's scores in wakeWordModel.test.ts.
 */

export interface OrtTensorLike {
  readonly data: ArrayLike<unknown>;
  readonly dims: readonly number[];
}

/** `T` is the runtime's own tensor type, so sessions take what `tensor()` makes. */
export interface OrtSessionLike<T> {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run: (feeds: Record<string, T>) => Promise<Record<string, OrtTensorLike>>;
}

export interface OrtApi<T = OrtTensorLike> {
  createSession: (model: Uint8Array) => Promise<OrtSessionLike<T>>;
  tensor: (data: Float32Array, dims: number[]) => T;
}

/** A float from an output tensor (ONNX Runtime's data can be any typed array). */
const num = (data: ArrayLike<unknown>, i: number): number => {
  const v = data[i];
  return typeof v === 'number' ? v : 0;
};

export interface WakeWordModels {
  melspectrogram: Uint8Array;
  embedding: Uint8Array;
  wake: Uint8Array;
}

/** Samples per step (80 ms at 16 kHz). */
export const WAKE_CHUNK = 1280;
/** Extra history the melspectrogram needs before each chunk (3 hops of 160). */
const MEL_CONTEXT = 160 * 3;
const MEL_BINS = 32;
/** Mel frames per embedding window, and per 80 ms chunk. */
const MEL_WINDOW = 76;
const MEL_STEP = 8;
const MEL_MAX = 10 * 97;
const FEATURE_DIM = 96;
const FEATURE_MAX = 120;
/** Python zeroes the first 5 predictions while the buffers fill. */
const WARMUP_PREDICTIONS = 5;
/** Feature-window lengths to try when a model doesn't take 16 (dynamic or unusual inputs). */
const FRAME_CANDIDATES = [16, 8, 12, 20, 24, 28, 32];

/** A small deterministic PRNG (mulberry32) for the startup noise, so runs are repeatable. */
function noise(samples: number, seed = 0x5eed): Int16Array {
  let a = seed >>> 0;
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    // np.random.randint(-1000, 1000): -1000 ≤ x < 1000
    out[i] = Math.floor(r * 2000) - 1000;
  }
  return out;
}

export class WakeWordModel<T = OrtTensorLike> {
  private melBuffer: Float32Array[] = [];
  private features: Float32Array[] = [];
  /** The last MEL_CONTEXT samples heard, prepended to the next chunk. */
  private history = new Int16Array(0);
  /** Samples waiting for a full chunk. */
  private pending = new Int16Array(0);
  private predictions = 0;

  private constructor(
    private readonly api: OrtApi<T>,
    private readonly mel: OrtSessionLike<T>,
    private readonly embed: OrtSessionLike<T>,
    private readonly wake: OrtSessionLike<T>,
    /** How many features the wake model reads. */
    readonly frames: number
  ) {}

  static async create<T>(api: OrtApi<T>, models: WakeWordModels): Promise<WakeWordModel<T>> {
    const [mel, embed, wake] = await Promise.all([
      api.createSession(models.melspectrogram),
      api.createSession(models.embedding),
      api.createSession(models.wake),
    ]);
    let frames: number | null = null;
    for (const n of FRAME_CANDIDATES) {
      try {
        await WakeWordModel.score(api, wake, Array.from({ length: n }, () => new Float32Array(FEATURE_DIM)), n);
        frames = n;
        break;
      } catch {
        // Not this length; try the next.
      }
    }
    if (frames === null) throw new Error('This wake word model takes an input openWakeWord doesn’t make.');
    const model = new WakeWordModel<T>(api, mel, embed, wake, frames);
    await model.reset();
    return model;
  }

  private static async score<T>(api: OrtApi<T>, wake: OrtSessionLike<T>, rows: Float32Array[], frames: number): Promise<number> {
    const input = new Float32Array(frames * FEATURE_DIM);
    rows.slice(-frames).forEach((row, i) => input.set(row, i * FEATURE_DIM));
    const name = wake.inputNames[0] ?? 'input';
    const out = await wake.run({ [name]: api.tensor(input, [1, frames, FEATURE_DIM]) });
    const first = out[wake.outputNames[0] ?? ''];
    const value = first?.data[0];
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('No score');
    return value;
  }

  /** Mel frames for some int16 audio: [frames][32], transformed as openWakeWord does. */
  private async melFrames(audio: Int16Array): Promise<Float32Array[]> {
    const input = Float32Array.from(audio);
    const out = await this.mel.run({ [this.mel.inputNames[0] ?? 'input']: this.api.tensor(input, [1, input.length]) });
    const t = out[this.mel.outputNames[0] ?? ''];
    if (!t) throw new Error('melspectrogram gave no output');
    const count = Math.floor(t.data.length / MEL_BINS);
    const rows: Float32Array[] = [];
    for (let f = 0; f < count; f++) {
      const row = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) row[b] = num(t.data, f * MEL_BINS + b) / 10 + 2;
      rows.push(row);
    }
    return rows;
  }

  /** One 96-number feature from 76 mel frames. */
  private async embedding(window: Float32Array[]): Promise<Float32Array> {
    const input = new Float32Array(MEL_WINDOW * MEL_BINS);
    window.forEach((row, i) => input.set(row, i * MEL_BINS));
    const out = await this.embed.run({
      [this.embed.inputNames[0] ?? 'input_1']: this.api.tensor(input, [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    const t = out[this.embed.outputNames[0] ?? ''];
    if (!t || t.data.length < FEATURE_DIM) throw new Error('embedding gave no output');
    return Float32Array.from({ length: FEATURE_DIM }, (_, i) => num(t.data, i));
  }

  /** Samples fed but not yet scored (less than one chunk). */
  get pendingSamples(): number {
    return this.pending.length;
  }

  /** Back to a fresh start (Python's `reset()`): forget everything heard. */
  async reset(): Promise<void> {
    this.melBuffer = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.history = new Int16Array(0);
    this.pending = new Int16Array(0);
    this.predictions = 0;
    // Like Python, prime the features with 4 s of quiet noise.
    const mel = await this.melFrames(noise(16000 * 4));
    const features: Float32Array[] = [];
    for (let i = 0; i + MEL_WINDOW <= mel.length; i += MEL_STEP) features.push(await this.embedding(mel.slice(i, i + MEL_WINDOW)));
    this.features = features;
  }

  /**
   * Feeds 16 kHz int16 audio of any length. Returns one score per completed
   * 80 ms chunk (often none, sometimes several).
   */
  async process(audio: Int16Array): Promise<number[]> {
    const joined = new Int16Array(this.pending.length + audio.length);
    joined.set(this.pending);
    joined.set(audio, this.pending.length);
    const scores: number[] = [];
    let at = 0;
    for (; at + WAKE_CHUNK <= joined.length; at += WAKE_CHUNK) {
      scores.push(await this.step(joined.subarray(at, at + WAKE_CHUNK)));
    }
    this.pending = joined.slice(at);
    return scores;
  }

  private async step(chunk: Int16Array): Promise<number> {
    const input = new Int16Array(this.history.length + chunk.length);
    input.set(this.history);
    input.set(chunk, this.history.length);
    this.history = input.slice(Math.max(0, input.length - MEL_CONTEXT));

    this.melBuffer.push(...(await this.melFrames(input)));
    if (this.melBuffer.length > MEL_MAX) this.melBuffer = this.melBuffer.slice(-MEL_MAX);
    const window = this.melBuffer.slice(-MEL_WINDOW);
    if (window.length === MEL_WINDOW) this.features.push(await this.embedding(window));
    if (this.features.length > FEATURE_MAX) this.features = this.features.slice(-FEATURE_MAX);

    const score = await WakeWordModel.score(this.api, this.wake, this.features, this.frames);
    this.predictions += 1;
    return this.predictions <= WARMUP_PREDICTIONS ? 0 : score;
  }
}
