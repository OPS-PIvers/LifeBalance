import React, { useEffect, useRef, useState } from 'react';
import { createWallSound, type WallSound } from '@/components/wall/sound/wallSound';
import { LAUNCH_ID, logEvent } from './labLog';
import {
  PORCUPINE_MODEL_URL,
  clearWakeLog,
  fileToBase64,
  readDetections,
  readMisses,
  readSessions,
  readWakeSettings,
  saveDetections,
  saveMisses,
  saveSessions,
  saveWakeSettings,
  summarizeWake,
  wakeMarkdown,
  type WakeDetection,
  type WakeSettings,
} from './labWake';

const BUILT_INS = ['Computer', 'Jarvis', 'Porcupine', 'Bumblebee', 'Terminator', 'Picovoice', 'Grapefruit', 'Blueberry'];

interface Running {
  stop: () => Promise<void>;
}

/**
 * Wake-word lab (plan §12): runs Picovoice Porcupine on-device with the mic
 * open, so the owner can leave it listening for a day and score it. Proves
 * (or not) that an always-listening wall works on iPadOS 16 before "Hey Home"
 * goes live: mic prompts per launch, false triggers, misses, heat.
 */
const LabWake: React.FC = () => {
  const [settings, setSettings] = useState<WakeSettings>(readWakeSettings);
  const [detections, setDetections] = useState<WakeDetection[]>(readDetections);
  const [sessions, setSessions] = useState(readSessions);
  const [misses, setMisses] = useState(readMisses);
  const [status, setStatus] = useState('Stopped');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = useRef<Running | null>(null);
  const sound = useRef<WallSound | null>(null);

  useEffect(() => saveWakeSettings(settings), [settings]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(
    () => () => {
      void running.current?.stop();
    },
    []
  );
  useEffect(() => {
    if (flash === null) return undefined;
    const id = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(id);
  }, [flash]);

  const patch = (p: Partial<WakeSettings>) => setSettings(s => ({ ...s, ...p }));

  const start = async () => {
    if (!settings.accessKey.trim()) {
      setStatus('Paste your Picovoice AccessKey first.');
      return;
    }
    if (settings.keyword === 'custom' && !settings.customPpn) {
      setStatus('Choose your .ppn file first.');
      return;
    }
    // Sound for the detection chime, unlocked by this tap.
    sound.current ??= createWallSound();
    sound.current.unlock();
    setBusy(true);
    setStatus('Starting… (allow the microphone if asked)');
    const t0 = performance.now();
    const startedAt = Date.now();
    try {
      const [{ PorcupineWorker, BuiltInKeyword }, { WebVoiceProcessor }] = await Promise.all([
        import('@picovoice/porcupine-web'),
        import('@picovoice/web-voice-processor'),
      ]);
      const builtin = Object.values(BuiltInKeyword).find(k => k === settings.keyword);
      const keyword =
        settings.keyword === 'custom'
          ? { base64: settings.customPpn, label: settings.customLabel || 'Custom', sensitivity: settings.sensitivity }
          : { builtin: builtin ?? BuiltInKeyword.Computer, sensitivity: settings.sensitivity };
      const engine = await PorcupineWorker.create(
        settings.accessKey.trim(),
        [keyword],
        detection => {
          const d: WakeDetection = { at: Date.now(), label: detection.label, launch: LAUNCH_ID };
          setDetections(list => saveDetections([...list, d]));
          setFlash(d.at);
          sound.current?.chime('ok');
          logEvent('wake', detection.label);
        },
        { publicPath: PORCUPINE_MODEL_URL, customWritePath: 'porcupine_v4', version: 1 },
        {
          processErrorCallback: error => {
            logEvent('wake-error', error.message);
            setStatus(`Error while listening: ${error.message}`);
          },
        }
      );
      await WebVoiceProcessor.subscribe(engine);
      const readyMs = Math.round(performance.now() - t0);
      setSessions(list => saveSessions([...list, { launch: LAUNCH_ID, startedAt, readyMs }]));
      logEvent('wake-start', `${readyMs} ms`);
      setListening(true);
      setStatus(`Listening (ready in ${readyMs} ms). Say “${settings.keyword === 'custom' ? settings.customLabel : settings.keyword}”.`);
      running.current = {
        stop: async () => {
          await WebVoiceProcessor.unsubscribe(engine);
          await engine.release();
          engine.terminate();
          setSessions(list => {
            const copy = [...list];
            const last = copy[copy.length - 1];
            if (last && last.startedAt === startedAt) copy[copy.length - 1] = { ...last, stoppedAt: Date.now() };
            return saveSessions(copy);
          });
          logEvent('wake-stop');
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessions(list => saveSessions([...list, { launch: LAUNCH_ID, startedAt, readyMs: Math.round(performance.now() - t0), stoppedAt: Date.now(), error: message }]));
      logEvent('wake-error', message);
      setStatus(`Couldn't start: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const r = running.current;
    running.current = null;
    await r?.stop();
    setListening(false);
    setStatus('Stopped');
  };

  const mark = (at: number, verdict: 'real' | 'false') =>
    setDetections(list => saveDetections(list.map(d => (d.at === at ? { ...d, verdict } : d))));

  const summary = summarizeWake(detections, sessions, misses, now);

  return (
    <div className="grid grid-cols-[1fr_24rem] gap-10">
      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Wake word</h2>
          <label className="block text-lg">
            Picovoice AccessKey
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full h-14 rounded-xl border border-brand-300 px-4 bg-white dark:bg-brand-800"
              value={settings.accessKey}
              onChange={e => patch({ accessKey: e.target.value })}
            />
          </label>
          <div className="flex gap-4 items-end flex-wrap">
            <label className="text-lg">
              Word
              <select
                className="mt-1 block h-14 rounded-xl border border-brand-300 px-4 bg-white dark:bg-brand-800"
                value={settings.keyword}
                onChange={e => patch({ keyword: e.target.value })}
              >
                {BUILT_INS.map(k => (
                  <option key={k} value={k}>
                    {k} (built in)
                  </option>
                ))}
                <option value="custom">My .ppn file{settings.customPpn ? ` (${settings.customLabel})` : ''}</option>
              </select>
            </label>
            <label className="text-lg">
              Sensitivity {settings.sensitivity.toFixed(2)}
              <input
                type="range"
                min={0.2}
                max={0.9}
                step={0.05}
                className="block w-56 h-14"
                value={settings.sensitivity}
                onChange={e => patch({ sensitivity: Number(e.target.value) })}
              />
            </label>
          </div>
          {settings.keyword === 'custom' && (
            <div className="flex gap-4 items-end flex-wrap">
              <label className="text-lg">
                Label
                <input
                  className="mt-1 block h-14 rounded-xl border border-brand-300 px-4 bg-white dark:bg-brand-800"
                  value={settings.customLabel}
                  onChange={e => patch({ customLabel: e.target.value })}
                />
              </label>
              <label className="text-lg">
                .ppn file (Picovoice Console → Porcupine → platform “Web (WASM)”)
                <input
                  type="file"
                  accept=".ppn"
                  className="mt-1 block"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) patch({ customPpn: await fileToBase64(file) });
                  }}
                />
              </label>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void (listening ? stop() : start())}
              className="h-16 px-8 rounded-xl text-xl font-semibold bg-accent-600 text-white disabled:opacity-50"
            >
              {listening ? 'Stop listening' : 'Start listening'}
            </button>
            <button
              type="button"
              onClick={() => {
                const n = misses + 1;
                setMisses(n);
                saveMisses(n);
              }}
              className="h-16 px-6 rounded-xl text-lg font-semibold border border-brand-300"
            >
              I said it, nothing happened
            </button>
          </div>
          <p role="status" className="text-lg">
            {status}
          </p>
          {flash !== null && <p className="text-3xl font-display text-accent-700">Heard it!</p>}
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-2xl">Detections</h2>
          {detections.length === 0 && <p className="text-brand-500">None yet.</p>}
          <ul className="space-y-2">
            {[...detections].reverse().slice(0, 40).map(d => (
              <li key={d.at} className="flex items-center gap-4 text-lg">
                <span className="w-56 tabular-nums">{new Date(d.at).toLocaleString()}</span>
                <span className="w-32">{d.label}</span>
                {(['real', 'false'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={d.verdict === v}
                    onClick={() => mark(d.at, v)}
                    className={`h-12 px-4 rounded-lg border ${d.verdict === v ? 'bg-brand-800 text-white' : 'border-brand-300'}`}
                  >
                    {v === 'real' ? 'Someone said it' : 'False trigger'}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-3 text-lg">
        <h2 className="font-display text-2xl">How to run it</h2>
        <ol className="list-decimal pl-6 space-y-1">
          <li>Start listening from the Home Screen app, then leave the page open all day.</li>
          <li>Say the word now and then from across the room. Mark each detection.</li>
          <li>When it misses you, tap “I said it, nothing happened”.</li>
          <li>Close and reopen the app a few times; note whether iPadOS asks for the mic again.</li>
          <li>Feel the back of the iPad after an hour or two.</li>
        </ol>
        <h2 className="font-display text-2xl pt-4">So far</h2>
        <pre className="whitespace-pre-wrap text-sm bg-white dark:bg-brand-800 rounded-xl p-4">{wakeMarkdown(summary, settings)}</pre>
        <div className="flex gap-3">
          <button
            type="button"
            className="h-12 px-4 rounded-lg border border-brand-300"
            onClick={() => void navigator.clipboard?.writeText(wakeMarkdown(summary, settings))}
          >
            Copy
          </button>
          <button
            type="button"
            className="h-12 px-4 rounded-lg border border-brand-300"
            onClick={() => {
              clearWakeLog();
              setDetections([]);
              setSessions([]);
              setMisses(0);
            }}
          >
            Clear
          </button>
        </div>
        <p className="text-brand-500 text-base">Pass: no extra mic prompt within a launch, under 1 false trigger an hour, 9 in 10 heard from 3 m.</p>
      </aside>
    </div>
  );
};

export default LabWake;
