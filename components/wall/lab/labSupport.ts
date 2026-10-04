/**
 * Non-component helpers for the Phase 0 wall lab (kept apart from the
 * components so fast refresh works). Throwaway: deleted with the lab.
 */
import { getSpeechRecognition } from '@/components/wall/voice/voiceEngines';
import { LAUNCH_ID, isStandalone } from './labLog';

export { getSpeechRecognition, type SpeechRecognitionLike } from '@/components/wall/voice/voiceEngines';

const supports = (css: string) => typeof CSS !== 'undefined' && CSS.supports(css);

/** Feature probes for the Safari 16.4–16.6 budget in plan §2. */
export function probes(): [string, boolean | string][] {
  const mr = typeof MediaRecorder !== 'undefined';
  return [
    ['Standalone (Home Screen app)', isStandalone()],
    ['Viewport', `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
    ['SpeechRecognition (A)', Boolean(getSpeechRecognition())],
    ['MediaRecorder (B)', mr],
    ['MediaRecorder audio/mp4', mr && MediaRecorder.isTypeSupported('audio/mp4')],
    ['getUserMedia', Boolean(navigator.mediaDevices?.getUserMedia)],
    ['AudioContext', 'AudioContext' in window || 'webkitAudioContext' in window],
    ['Permissions-Policy allows mic', (document as Document & { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy?.allowsFeature('microphone') ?? 'unknown'],
    ['color-mix()', supports('color: color-mix(in srgb, red 50%, blue)')],
    [':has()', supports('selector(:has(a))')],
    ['dvh', supports('height: 100dvh')],
    ['overscroll-behavior', supports('overscroll-behavior: contain')],
    ['Screen Wake Lock', 'wakeLock' in navigator],
    ['Online', navigator.onLine],
  ];
}

export function environmentSummary(): string {
  return [`- Launch: ${LAUNCH_ID}`, `- UA: ${navigator.userAgent}`, ...probes().map(([k, v]) => `- ${k}: ${String(v)}`)].join('\n');
}

const FONT_FILES: [family: string, weights: string, file: string][] = [
  ['Besley', '400 900', 'besley-latin.woff2'],
  ['Schibsted Grotesk', '400 700', 'schibsted-grotesk-latin.woff2'],
  ['Spline Sans Mono', '300 700', 'spline-sans-mono-latin.woff2'],
];

const KIOSK_CSS = `
.head, .chips, .toggles, .notes { display: none !important; }
html, body { margin: 0; overflow: hidden; }
.page { padding: 0 !important; max-width: none !important; gap: 0 !important; }
.stage { border: 0 !important; border-radius: 0 !important; }
`;

export function buildPrototypeDoc(html: string, origin: string): string {
  const fonts = FONT_FILES.map(
    ([family, weights, file]) =>
      `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weights}; font-display: block; src: url('${origin}/fonts/${file}') format('woff2'); }`
  ).join('\n');
  return html
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '')
    .replace('</head>', `<style>${fonts}${KIOSK_CSS}</style></head>`);
}

