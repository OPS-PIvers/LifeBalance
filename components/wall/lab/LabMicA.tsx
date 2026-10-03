import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { parseWallVoiceText } from '@/services/geminiService';
import { LAUNCH_ID, isStandalone, logEvent, type LabAttempt } from './labLog';
import { getSpeechRecognition, type SpeechRecognitionLike } from './labSupport';
import { useLabVoiceContext } from './useLabVoiceContext';

interface Marks {
  tap: number;
  start?: number;
  speechStart?: number;
  firstResult?: number;
  final?: number;
  speechEnd?: number;
  end?: number;
}

const since = (from: number, to?: number) => (to === undefined ? '–' : `${Math.round(to - from)}`);

interface LabMicAProps {
  onAttempt: (attempt: LabAttempt) => void;
}

/** Engine A: on-device speech recognition, then the text intent call. */
const LabMicA: React.FC<LabMicAProps> = ({ onAttempt }) => {
  const { householdId, ctx } = useLabVoiceContext();
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [status, setStatus] = useState<'idle' | 'listening' | 'parsing'>('idle');
  const [live, setLive] = useState('');
  const Ctor = getSpeechRecognition();

  if (!Ctor) {
    return <p className="text-xl text-money-neg">Speech recognition isn&apos;t available in this browser, so engine A fails check 2.</p>;
  }

  const listen = () => {
    if (!householdId || status !== 'idle') return;
    // One recognizer per app launch, mirroring how the wall would hold it.
    const rec = recRef.current ?? new Ctor();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const marks: Marks = { tap: performance.now() };
    let finalText = '';
    let interimText = '';
    let error: string | undefined;

    rec.onstart = () => { marks.start = performance.now(); };
    rec.onspeechstart = () => { marks.speechStart = performance.now(); };
    rec.onspeechend = () => { marks.speechEnd = performance.now(); };
    rec.onresult = event => {
      marks.firstResult ??= performance.now();
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        text += result[0]?.transcript ?? '';
        if (result.isFinal) marks.final = performance.now();
      }
      interimText = text;
      if (marks.final !== undefined) finalText = text;
      setLive(text);
    };
    rec.onerror = event => {
      error = event.error + (event.message ? `: ${event.message}` : '');
      logEvent('micA-error', error);
    };
    rec.onend = () => {
      marks.end = performance.now();
      // Safari sometimes ends without flagging a final result; use what it heard.
      const transcript = (finalText || interimText).trim();
      const base = {
        id: `${Date.now()}`,
        engine: 'A' as const,
        at: new Date().toISOString(),
        launchId: LAUNCH_ID,
        standalone: isStandalone(),
        transcript,
      };
      const recog = `tap→start ${since(marks.tap, marks.start)} · start→1st result ${since(marks.start ?? marks.tap, marks.firstResult)} · speechend→final ${marks.speechEnd !== undefined ? since(marks.speechEnd, marks.final ?? marks.end) : '–'} ms`;
      if (error || !transcript) {
        onAttempt({ ...base, intentJson: '', latencyMs: null, detail: recog, error: error ?? 'no speech' });
        setStatus('idle');
        return;
      }
      const speechDone = Math.min(marks.speechEnd ?? Infinity, marks.final ?? Infinity, marks.end);
      setStatus('parsing');
      const parseStart = performance.now();
      parseWallVoiceText(householdId, transcript, ctx)
        .then(command => {
          const done = performance.now();
          onAttempt({
            ...base,
            intentJson: JSON.stringify({ ...command, transcript: undefined }),
            latencyMs: done - speechDone,
            detail: `${recog} · gemini ${Math.round(done - parseStart)} ms`,
          });
        })
        .catch((e: unknown) => {
          onAttempt({ ...base, intentJson: '', latencyMs: null, detail: recog, error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => setStatus('idle'));
    };

    setLive('');
    setStatus('listening');
    try {
      rec.start();
    } catch (e) {
      // start() throws InvalidStateError when a previous session is still closing.
      logEvent('micA-start-threw', e instanceof Error ? e.message : String(e));
      rec.abort();
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button size="lg" onClick={listen} disabled={status !== 'idle' || !householdId} className="h-20 px-10 text-2xl">
          {status === 'listening' ? 'Listening…' : status === 'parsing' ? 'Thinking…' : 'Tap and speak'}
        </Button>
        {status === 'listening' && (
          <Button variant="outline" size="lg" onClick={() => recRef.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-2xl min-h-[2.5rem]">{live}</p>
    </div>
  );
};

export default LabMicA;
