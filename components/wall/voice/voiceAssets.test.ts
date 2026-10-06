import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { looksLikeHtml } from './voiceAssets';

const buf = (s: string) => new TextEncoder().encode(s).buffer;

describe('looksLikeHtml', () => {
  it('spots the app page Hosting serves for a missing file', () => {
    expect(looksLikeHtml(buf('<!doctype html><html lang="en">'))).toBe(true);
    expect(looksLikeHtml(buf('\n  <html>'))).toBe(true);
  });

  it('passes an ONNX model, whatever Hosting labels it', () => {
    // ONNX is protobuf: field 1 (ir_version) first, tag byte 0x08.
    expect(looksLikeHtml(new Uint8Array([0x08, 0x07, 0x12, 0x07, 0x70, 0x79]).buffer)).toBe(false);
    expect(looksLikeHtml(new ArrayBuffer(0))).toBe(false);
  });

  it('passes the shipped wake word model', () => {
    const path = 'public/voice/openwakeword-0.5.1/melspectrogram.onnx';
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return; // voice assets are fetched at deploy (pnpm voice:assets); absent in most checkouts
    }
    expect(looksLikeHtml(new Uint8Array(bytes).buffer)).toBe(false);
  });
});
