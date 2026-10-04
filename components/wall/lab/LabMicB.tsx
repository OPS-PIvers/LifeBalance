import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { parseWallVoiceAudio } from '@/services/geminiService';
import { bytesToBase64, downmix, encodeWav, resample, rmsFromBytes } from '@/utils/wall/wavEncode';
import { LAUNCH_ID, isStandalone, logEvent, type LabAttempt } from './labLog';
import { useLabVoiceContext } from './useLabVoiceContext';

/** Voice-activity settings from docs/plans/wall-display-kiosk.md §4.10. */
const SILENCE_STOP_MS = 1500;
const MAX_RECORD_MS = 8000;
const NO_SPEECH_STOP_MS = 5000;
const CALIBRATE_MS = 300;
const MIN_THRESHOLD = 0.02;
const WAV_RATE = 16_000;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

interface LabMicBProps {
  onAttempt: (attempt: LabAttempt) => void;
}

/** Engine B: MediaRecorder + a level-based end-of-speech detector, then one Gemini call with the audio. */
const LabMicB: React.FC<LabMicBProps> = ({ onAttempt }) => {
  const { householdId, ctx } = useLabVoiceContext();
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [status, setStatus] = useState<'idle' | 'listening' | 'parsing'>('idle');
  const [level, setLevel] = useState(0);
  const [keepStream, setKeepStream] = useState(true);
  const [sendWav, setSendWav] = useState(true);
  const [sensitivity, setSensitivity] = useState(3);
  const [heard, setHeard] = useState('');

  // Release the mic when leaving the tab.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    },
    []
  );

  const mimeType = pickMimeType();
  const AudioCtx = getAudioContextCtor();
  if (typeof MediaRecorder === 'undefined' || !AudioCtx || !navigator.mediaDevices?.getUserMedia) {
    return <p className="text-xl text-money-neg">MediaRecorder, Web Audio or getUserMedia is missing, so engine B fails check 3.</p>;
  }

  const releaseOrMute = () => {
    const stream = streamRef.current;
    if (!stream) return;
    if (keepStream) {
      stream.getAudioTracks().forEach(t => { t.enabled = false; });
    } else {
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const listen = async () => {
    if (!householdId || status !== 'idle') return;
    const tap = performance.now();
    const base = {
      id: `${Date.now()}`,
      engine: 'B' as const,
      at: new Date().toISOString(),
      launchId: LAUNCH_ID,
      standalone: isStandalone(),
    };
    setHeard('');
    setStatus('listening');

    let stream = streamRef.current;
    let prompted = false;
    try {
      if (!stream || stream.getAudioTracks().every(t => t.readyState === 'ended')) {
        prompted = true;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        logEvent('micB-getUserMedia', `granted in ${Math.round(performance.now() - tap)} ms`);
      }
      stream.getAudioTracks().forEach(t => { t.enabled = true; });
      audioCtxRef.current ??= new AudioCtx();
      await audioCtxRef.current.resume();
    } catch (e) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logEvent('micB-permission', message);
      onAttempt({ ...base, transcript: '', intentJson: '', latencyMs: null, detail: 'getUserMedia', error: message });
      setStatus('idle');
      return;
    }

    const audioCtx = audioCtxRef.current;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    const recStart = performance.now();
    recorder.start(250);

    // Level-based end-of-speech: calibrate a noise floor, then stop after
    // SILENCE_STOP_MS below threshold once speech was heard.
    let floor = 0;
    let floorSamples = 0;
    let lastLoud = 0;
    let heardSpeech = false;
    let stopReason = '';
    await new Promise<void>(resolve => {
      const id = window.setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        const rms = rmsFromBytes(buf);
        const now = performance.now();
        setLevel(rms);
        if (now - recStart < CALIBRATE_MS) {
          floor = (floor * floorSamples + rms) / (floorSamples + 1);
          floorSamples++;
          return;
        }
        if (rms > Math.max(MIN_THRESHOLD, floor * sensitivity)) {
          heardSpeech = true;
          lastLoud = now;
        }
        if (heardSpeech && now - lastLoud > SILENCE_STOP_MS) stopReason = 'silence';
        else if (now - recStart > MAX_RECORD_MS) stopReason = 'max length';
        else if (!heardSpeech && now - recStart > NO_SPEECH_STOP_MS) stopReason = 'no speech';
        if (stopReason) {
          window.clearInterval(id);
          resolve();
        }
      }, 50);
    });
    recorder.stop();
    await stopped;
    const recordedAt = performance.now();
    source.disconnect();
    setLevel(0);
    releaseOrMute();

    const recordDetail = `${prompted ? 'prompted · ' : ''}recorded ${Math.round(recordedAt - recStart)} ms (${stopReason}) · ${mimeType ?? 'default'}`;
    if (!heardSpeech) {
      onAttempt({ ...base, transcript: '', intentJson: '', latencyMs: null, detail: recordDetail, error: 'no speech' });
      setStatus('idle');
      return;
    }

    setStatus('parsing');
    const blob = new Blob(chunks, { type: chunks[0]?.type || mimeType || 'audio/mp4' });
    let payload: string;
    let payloadType: string;
    let encodeNote: string;
    const encodeStart = performance.now();
    try {
      if (sendWav) {
        const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
        const wav = encodeWav(resample(downmix(channels), decoded.sampleRate, WAV_RATE), WAV_RATE);
        payload = bytesToBase64(wav);
        payloadType = 'audio/wav';
      } else {
        payload = await blobToBase64(blob);
        payloadType = (blob.type || 'audio/mp4').split(';')[0] ?? 'audio/mp4';
      }
      encodeNote = `${payloadType} ${Math.round(payload.length / 1024)} KB b64, encode ${Math.round(performance.now() - encodeStart)} ms`;
    } catch (e) {
      // Decoding failed: send what MediaRecorder made and note it.
      payload = await blobToBase64(blob);
      payloadType = (blob.type || 'audio/mp4').split(';')[0] ?? 'audio/mp4';
      encodeNote = `WAV failed (${e instanceof Error ? e.message : String(e)}), sent ${payloadType}`;
    }

    const parseStart = performance.now();
    try {
      const command = await parseWallVoiceAudio(householdId, payload, payloadType, ctx);
      const done = performance.now();
      setHeard(command.transcript);
      onAttempt({
        ...base,
        transcript: command.transcript,
        intentJson: JSON.stringify({ ...command, transcript: undefined }),
        latencyMs: done - lastLoud,
        detail: `${recordDetail} · ${encodeNote} · gemini ${Math.round(done - parseStart)} ms`,
      });
    } catch (e) {
      onAttempt({
        ...base,
        transcript: '',
        intentJson: '',
        latencyMs: null,
        detail: `${recordDetail} · ${encodeNote}`,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6">
        <Button size="lg" onClick={() => void listen()} disabled={status !== 'idle' || !householdId} className="h-20 px-10 text-2xl">
          {status === 'listening' ? 'Listening…' : status === 'parsing' ? 'Thinking…' : 'Tap and speak'}
        </Button>
        <div className="h-4 w-64 rounded-full bg-brand-200 dark:bg-brand-700 overflow-hidden" aria-label="Input level">
          <div className="h-full bg-accent-600" style={{ width: `${Math.min(100, level * 400)}%` }} />
        </div>
      </div>
      <p className="text-2xl min-h-[2.5rem]">{heard}</p>
      <div className="flex flex-wrap gap-x-10 gap-y-3 text-base items-center">
        <div className="flex items-center gap-3">
          <Switch checked={keepStream} onCheckedChange={setKeepStream} aria-label="Keep mic open between commands" />
          Keep mic open between commands (check 4)
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={sendWav} onCheckedChange={setSendWav} aria-label="Re-encode as WAV" />
          Re-encode as 16 kHz WAV
        </div>
        <label className="flex items-center gap-3">
          Sensitivity ×{sensitivity}
          <input type="range" min={1.5} max={6} step={0.5} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
};

export default LabMicB;
