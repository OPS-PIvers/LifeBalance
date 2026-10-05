import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_START_MS, createSpeechEngine, type SpeechRecognitionLike } from './voiceEngines';

/** A recognizer that does only what the test makes it do (like Safari in a Home Screen app: nothing). */
class SilentRecognizer implements SpeechRecognitionLike {
  static last: SilentRecognizer | null = null;
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    SilentRecognizer.last = this;
  }
  hear(text: string) {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: false })] } as unknown as SpeechRecognitionEvent);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSpeechEngine', () => {
  it('a recognizer that never starts is reported as unsupported instead of listening forever', async () => {
    vi.useFakeTimers();
    const session = createSpeechEngine(SilentRecognizer).listen({});
    const outcome = session.result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SPEECH_START_MS + 400);
    expect(await outcome).toMatchObject({ code: 'unsupported' });
    expect(SilentRecognizer.last?.abort).toHaveBeenCalled();
  });

  it('Done settles with what was heard even if the recognizer never ends', async () => {
    vi.useFakeTimers();
    const session = createSpeechEngine(SilentRecognizer).listen({});
    SilentRecognizer.last?.onstart?.();
    SilentRecognizer.last?.hear('show meals');
    session.finish();
    expect(SilentRecognizer.last?.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'show meals' });
  });

  it('a normal end still resolves at once', async () => {
    const session = createSpeechEngine(SilentRecognizer).listen({});
    const r = SilentRecognizer.last!;
    r.onstart?.();
    r.hear('undo');
    r.onend?.();
    await expect(session.result).resolves.toEqual({ kind: 'text', transcript: 'undo' });
  });

  it('Cancel settles as aborted even if the recognizer never ends', async () => {
    vi.useFakeTimers();
    const session = createSpeechEngine(SilentRecognizer).listen({});
    SilentRecognizer.last?.onstart?.();
    session.cancel();
    const outcome = session.result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await outcome).toMatchObject({ code: 'aborted' });
  });
});
