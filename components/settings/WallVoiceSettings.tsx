import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { fileToBase64 } from '@/utils/wall/wallSettingsView';
import type { WallPicovoice, WallSettings, WallVoiceEngine } from '@/types/schema';

/** Porcupine's built-in words (any of them works with just an AccessKey). */
const WAKE_BUILT_INS = ['Computer', 'Jarvis', 'Porcupine', 'Bumblebee', 'Terminator', 'Picovoice', 'Grapefruit', 'Blueberry'];
const SENSITIVITIES = [
  { value: '0.35', label: 'Low' },
  { value: '0.5', label: 'Medium' },
  { value: '0.65', label: 'High' },
];
/** A .ppn is a few KB; anything this big isn't one. */
const MAX_PPN_BYTES = 100_000;

interface WallVoiceSettingsProps {
  settings: WallSettings;
  save: (patch: Partial<WallSettings>) => Promise<void>;
  aiUsage: { used: number; cap: number } | null;
}

const ENGINE_NOTES: Record<Exclude<WallVoiceEngine, 'off'>, string> = {
  auto: 'On-device once an AccessKey is saved; otherwise Safari, then Recording',
  device: 'Picovoice on the iPad: free, private, no AI allowance',
  speech: 'Safari’s recognizer. It doesn’t run in a Home Screen app',
  audio: 'Records and sends each command to Gemini (AI allowance)',
};

/**
 * Settings → Wall display → Voice (docs/plans/wall-display-kiosk.md §12
 * "Wake word"): voice on/off, how the wall listens, and the Picovoice setup
 * for the on-device engine and the hands-free wake word.
 */
const WallVoiceSettings: React.FC<WallVoiceSettingsProps> = ({ settings, save, aiUsage }) => {
  const pv = settings.picovoice;
  const [key, setKey] = useState('');
  // The custom word's name (a built-in word is called by its own name); an edit in progress wins.
  const customLabel = pv?.keyword === 'custom' ? pv.label : undefined;
  const [editedLabel, setLabel] = useState<string | null>(null);
  const label = editedLabel ?? customLabel ?? 'Hey Home';

  const usesDevice = settings.voice === 'device' || (settings.voice === 'auto' && Boolean(pv));
  const savePv = (patch: Partial<WallPicovoice>) => {
    if (!pv) return Promise.resolve();
    return save({ picovoice: { ...pv, ...patch } });
  };

  const saveKey = async () => {
    const accessKey = key.trim();
    if (!accessKey) return;
    await save({
      picovoice: pv ? { ...pv, accessKey } : { accessKey, keyword: 'Computer', label: 'Computer', sensitivity: 0.5 },
    });
    setKey('');
    toast.success('AccessKey saved. The wall picks it up in a few seconds.');
  };

  const pickPpn = async (file: File | undefined) => {
    if (!file || !pv) return;
    if (file.size > MAX_PPN_BYTES || !/\.ppn$/i.test(file.name)) {
      toast.error('Choose the .ppn file Picovoice Console made for “Web (WASM)”.');
      return;
    }
    const ppn = await fileToBase64(file);
    await savePv({ keyword: 'custom', ppn, label: label.trim() || 'Hey Home' });
  };

  const allowance = usesDevice
    ? 'On-device voice runs on the iPad and never uses the AI allowance'
    : aiUsage
      ? `Adds it can’t read itself use your daily AI allowance (${Math.max(0, aiUsage.cap - aiUsage.used)} left today)`
      : 'Adds it can’t read itself use your daily AI allowance. “Show”, “undo” and “add milk” don’t.';

  return (
    <Section title="Voice">
      <SurfaceList>
        <Row className="flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Voice on the wall</p>
            <p className="text-xs text-brand-500 dark:text-brand-400">{allowance}</p>
          </div>
          <SegmentedControl
            name="Voice on the wall"
            size="sm"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={settings.voice === 'off' ? 'off' : 'on'}
            onChange={v => void save({ voice: v === 'off' ? 'off' : 'auto' })}
          />
        </Row>
        {settings.voice !== 'off' && (
          <>
            <Row className="flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">How it listens</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">{ENGINE_NOTES[settings.voice]}</p>
              </div>
              <SegmentedControl
                name="How the wall listens"
                size="sm"
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'device', label: 'On-device' },
                  { value: 'speech', label: 'Safari' },
                  { value: 'audio', label: 'Recording' },
                ]}
                value={settings.voice}
                onChange={voice => void save({ voice })}
              />
            </Row>

            <Row className="flex-col items-stretch gap-2">
              <div>
                <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Picovoice AccessKey</p>
                <p className="text-xs text-brand-500 dark:text-brand-400">
                  {pv
                    ? `Saved (…${pv.accessKey.slice(-4)}). Paste a new one to replace it.`
                    : 'Free: sign up at console.picovoice.ai and copy your AccessKey. It turns on on-device voice and the wake word.'}
                </p>
              </div>
              <form
                className="flex gap-2 items-end"
                onSubmit={e => {
                  e.preventDefault();
                  void saveKey();
                }}
              >
                <div className="flex-1 min-w-0">
                  <Input
                    aria-label="Picovoice AccessKey"
                    type="password"
                    autoComplete="off"
                    maxLength={200}
                    placeholder={pv ? 'New AccessKey' : 'AccessKey'}
                    value={key}
                    onChange={e => setKey(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={!key.trim()}>
                  Save key
                </Button>
              </form>
            </Row>

            {pv && (
              <>
                <Row className="flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Hands-free</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      Say “{pv.label}” instead of tapping the mic. Off during night hours; starts after the first touch
                    </p>
                  </div>
                  <SegmentedControl
                    name="Hands-free wake word"
                    size="sm"
                    options={[
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Off' },
                    ]}
                    value={settings.wakeWord ? 'on' : 'off'}
                    onChange={v => void save({ wakeWord: v === 'on' })}
                  />
                </Row>
                {settings.wakeWord && (
                  <>
                    <Row className="flex-wrap gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Wake word</p>
                        <p className="text-xs text-brand-500 dark:text-brand-400">
                          A built-in word works now. For “Hey Home”, train it in Picovoice Console (platform Web (WASM)) and add the .ppn file
                        </p>
                      </div>
                      <div className="w-48">
                        <Select
                          aria-label="Wake word"
                          value={pv.keyword}
                          onChange={e => {
                            const keyword = e.target.value;
                            if (keyword === 'custom') {
                              if (pv.ppn) void savePv({ keyword, label: label.trim() || 'Hey Home' });
                            } else {
                              void savePv({ keyword, label: keyword });
                            }
                          }}
                        >
                          {WAKE_BUILT_INS.map(k => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                          {pv.ppn && <option value="custom">{pv.keyword === 'custom' ? pv.label : label || 'My word'} (.ppn)</option>}
                        </Select>
                      </div>
                    </Row>
                    <Row className="flex-col items-stretch gap-2">
                      <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">My own word (.ppn)</p>
                      <div className="flex gap-2 items-end flex-wrap">
                        <div className="w-40">
                          <Input
                            aria-label="What the word is called"
                            maxLength={40}
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            onBlur={() => {
                              if (pv.keyword === 'custom' && label.trim() && label.trim() !== pv.label) {
                                void savePv({ label: label.trim() }).then(() => setLabel(null));
                              }
                            }}
                          />
                        </div>
                        <input
                          aria-label="Wake word file"
                          type="file"
                          accept=".ppn"
                          className="text-sm text-brand-700 dark:text-brand-300"
                          onChange={e => void pickPpn(e.target.files?.[0])}
                        />
                      </div>
                    </Row>
                    <Row className="flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Sensitivity</p>
                        <p className="text-xs text-brand-500 dark:text-brand-400">Higher hears it from farther away, and wakes by mistake more often</p>
                      </div>
                      <SegmentedControl
                        name="Wake word sensitivity"
                        size="sm"
                        options={SENSITIVITIES}
                        value={SENSITIVITIES.find(o => Number(o.value) === pv.sensitivity)?.value ?? '0.5'}
                        onChange={v => void savePv({ sensitivity: Number(v) })}
                      />
                    </Row>
                  </>
                )}
              </>
            )}
          </>
        )}
      </SurfaceList>
    </Section>
  );
};

export default WallVoiceSettings;
