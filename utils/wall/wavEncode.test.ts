import { describe, expect, it } from 'vitest';
import { bytesToBase64, downmix, encodeWav, resample, rmsFromBytes } from './wavEncode';

describe('downmix', () => {
  it('averages channels and passes mono through', () => {
    const mono = new Float32Array([0.5, -0.5]);
    expect(downmix([mono])).toBe(mono);
    expect(Array.from(downmix([new Float32Array([1, 0]), new Float32Array([0, -1])]))).toEqual([0.5, -0.5]);
    expect(downmix([]).length).toBe(0);
  });
});

describe('resample', () => {
  it('box-filters down to the target rate', () => {
    const out = resample(new Float32Array([1, 1, 1, 0, 0, 0]), 48_000, 16_000);
    expect(Array.from(out)).toEqual([1, 0]);
  });

  it('returns the input when not downsampling', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resample(input, 16_000, 16_000)).toBe(input);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono header and clamped samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const view = new DataView(wav.buffer);
    const text = (o: number, n: number) => String.fromCharCode(...wav.subarray(o, o + n));
    expect(wav.length).toBe(44 + 8);
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });
});

describe('bytesToBase64', () => {
  it('matches Buffer encoding, including across chunk boundaries', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('rmsFromBytes', () => {
  it('is 0 for silence and 1 for full-scale square', () => {
    expect(rmsFromBytes(new Uint8Array([128, 128]))).toBe(0);
    expect(rmsFromBytes(new Uint8Array([0, 0]))).toBe(1);
    expect(rmsFromBytes(new Uint8Array(0))).toBe(0);
  });
});
