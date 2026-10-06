/**
 * Where the wall's on-device voice files are served from (same origin, put in
 * public/voice/ at deploy time by scripts/fetch-voice-assets.mjs; change both
 * together). Paths carry their versions, so Hosting caches them forever and
 * Vosk keeps its unpacked model by URL: a file whose SHA-256 changes needs a
 * new path here, or walls keep the old one (docs/DECISIONS.md).
 */

const BASE = '/voice/';

const OWW = `${BASE}openwakeword-0.5.1/`;
export const WAKE_FEATURE_URLS = {
  melspectrogram: `${OWW}melspectrogram.onnx`,
  embedding: `${OWW}embedding_model.onnx`,
} as const;

/** A built-in openWakeWord model by keyword ('hey_jarvis' → hey_jarvis_v0.1.onnx). */
export const builtInWakeUrl = (keyword: string): string => `${OWW}${keyword}_v0.1.onnx`;

export const VOSK_MODEL_URL = `${BASE}vosk-model-small-en-us-0.15.tar.gz`;

/** ONNX Runtime looks up ort-wasm-simd.wasm / ort-wasm.wasm under this prefix. */
export const ORT_WASM_PREFIX = `${BASE}ort-1.17.3/`;
