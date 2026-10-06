import { describe, expect, it } from 'vitest';
import { WAKE_CHUNK, WakeWordModel, type OrtApi, type OrtSessionLike, type OrtTensorLike } from './wakeWordModel';

/**
 * The streaming bookkeeping, against a fake runtime. That the real models
 * score exactly as Python openWakeWord does was checked against Python's own
 * output when this port was written (max |Δscore| < 1e-4 over five clips).
 */

interface Calls {
  melInputs: number[];
  wakeFrames: number[];
}

function fakeApi(opts: { wakeFrames?: number[]; score?: number } = {}) {
  const calls: Calls = { melInputs: [], wakeFrames: [] };
  const accepted = opts.wakeFrames ?? [16];
  const session = (run: (input: OrtTensorLike) => OrtTensorLike, name = 'input'): OrtSessionLike<OrtTensorLike> => ({
    inputNames: [name],
    outputNames: ['out'],
    run: async feeds => {
      const input = feeds[name];
      if (!input) throw new Error('no input');
      return { out: run(input) };
    },
  });
  const sessions = [
    // melspectrogram: (samples / 160 - 3) frames of 32 bins, each 10 (→ 3 after x / 10 + 2)
    session(input => {
      const samples = input.dims[1] ?? 0;
      calls.melInputs.push(samples);
      const frames = Math.max(0, Math.floor(samples / 160) - 3);
      return { data: new Float32Array(frames * 32).fill(10), dims: [frames, 1, 1, 32] };
    }),
    session(() => ({ data: new Float32Array(96).fill(0.5), dims: [1, 1, 1, 96] }), 'input_1'),
    session(input => {
      const frames = input.dims[1] ?? 0;
      if (!accepted.includes(frames)) throw new Error(`bad frames ${frames}`);
      calls.wakeFrames.push(frames);
      return { data: new Float32Array([opts.score ?? 0.9]), dims: [1, 1] };
    }, 'x.1'),
  ];
  let n = 0;
  const api: OrtApi = {
    createSession: async () => {
      const s = sessions[n++ % 3];
      if (!s) throw new Error('no session');
      return s;
    },
    tensor: (data, dims) => ({ data, dims }),
  };
  return { api, calls };
}

const models = { melspectrogram: new Uint8Array(), embedding: new Uint8Array(), wake: new Uint8Array() };

describe('WakeWordModel', () => {
  it('reads 16 features, like every openWakeWord model', async () => {
    const { api } = fakeApi();
    expect((await WakeWordModel.create(api, models)).frames).toBe(16);
  });

  it('finds a model’s own window length', async () => {
    const { api } = fakeApi({ wakeFrames: [12] });
    expect((await WakeWordModel.create(api, models)).frames).toBe(12);
  });

  it('rejects a model nothing fits', async () => {
    const { api } = fakeApi({ wakeFrames: [99] });
    await expect(WakeWordModel.create(api, models)).rejects.toThrow(/input/);
  });

  it('scores every 1280 samples whatever size the audio comes in, holding the rest back', async () => {
    const { api } = fakeApi();
    const model = await WakeWordModel.create(api, models);
    let scores = 0;
    for (let i = 0; i < 10; i++) scores += (await model.process(new Int16Array(512))).length;
    // 5120 samples → 4 chunks, 0 left over
    expect(scores).toBe(4);
    expect(model.pendingSamples).toBe(0);
    expect(await model.process(new Int16Array(700))).toEqual([]);
    expect(model.pendingSamples).toBe(700);
    expect((await model.process(new Int16Array(WAKE_CHUNK * 2))).length).toBe(2);
    expect(model.pendingSamples).toBe(700);
  });

  it('gives each chunk the 480 samples before it, as Python does (none before the first)', async () => {
    const { api, calls } = fakeApi();
    const model = await WakeWordModel.create(api, models);
    calls.melInputs.length = 0;
    await model.process(new Int16Array(WAKE_CHUNK * 3));
    expect(calls.melInputs).toEqual([1280, 1760, 1760]);
  });

  it('reports 0 for the first 5 chunks while the buffers fill', async () => {
    const { api } = fakeApi({ score: 0.9 });
    const model = await WakeWordModel.create(api, models);
    const scores = await model.process(new Int16Array(WAKE_CHUNK * 7));
    expect(scores).toEqual([0, 0, 0, 0, 0, 0.9, 0.9].map(s => expect.closeTo(s, 5)));
  });

  it('reset forgets the history, the leftover and the warm-up', async () => {
    const { api, calls } = fakeApi({ score: 0.9 });
    const model = await WakeWordModel.create(api, models);
    await model.process(new Int16Array(WAKE_CHUNK * 7 + 100));
    await model.reset();
    expect(model.pendingSamples).toBe(0);
    calls.melInputs.length = 0;
    const scores = await model.process(new Int16Array(WAKE_CHUNK));
    expect(calls.melInputs).toEqual([1280]);
    expect(scores).toEqual([0]);
  });
});
