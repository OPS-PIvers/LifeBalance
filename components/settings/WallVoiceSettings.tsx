import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { WAKE_BUILT_INS, WAKE_CUSTOM_MAX_BYTES, WAKE_THRESHOLDS } from '@/utils/wall/wallSettings';
import type { WallSettings, WallVoiceEngine, WallWakeModel } from '@/types/schema';

interface WallVoiceSettingsProps {
  settings: WallSettings;
  save: (patch: Partial<WallSettings>) => Promise<void>;
  /** Stores a custom wake word's .onnx and switches to it. */
  uploadWakeFile: (bytes: Uint8Array, label: string) => Promise<void>;
  aiUsage: { used: number; cap: number } | null;
}

const ENGINE_NOTES: Record<Exclude<WallVoiceEngine, 'off'>, string> = {
  auto: 'On the iPad itself: free, private, no AI allowance',
  device: 'On the iPad itself: free, private, no AI allowance',
  speech: 'Safari’s recognizer. It doesn’t run in a Home Screen app',
  audio: 'Records and sends each command to Gemini (AI allowance)',
};

/** The Low / Medium / High step closest to a stored threshold. */
const nearestThreshold = (t: number) =>
  WAKE_THRESHOLDS.reduce((best, o) => (Math.abs(o.threshold - t) < Math.abs(best.threshold - t) ? o : best), WAKE_THRESHOLDS[1] ?? { label: 'Medium', threshold: 0.5 });

/**
 * Settings → Wall display → Voice (docs/plans/wall-display-kiosk.md §12
 * "Wake word"): voice on/off, how the wall listens, and the hands-free wake
 * word (openWakeWord: a built-in word, or a custom "Hey Home" model).
 */
const WallVoiceSettings: React.FC<WallVoiceSettingsProps> = ({ settings, save, uploadWakeFile, aiUsage }) => {
  const wake = settings.wakeModel;
  // The custom word's name; an edit in progress wins.
  const [editedLabel, setLabel] = useState<string | null>(null);
  const label = editedLabel ?? (wake.keyword === 'custom' ? wake.label : 'Hey Home');

  const usesDevice = settings.voice === 'auto' || settings.voice === 'device';
  const saveWake = (patch: Partial<WallWakeModel>) => save({ wakeModel: { ...wake, ...patch } });

  const pickModel = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > WAKE_CUSTOM_MAX_BYTES || file.size === 0 || !/\.onnx$/i.test(file.name)) {
      toast.error('Choose the .onnx file the wake word notebook made.');
      return;
    }
    try {
      await uploadWakeFile(new Uint8Array(await file.arrayBuffer()), label.trim() || 'Hey Home');
      setLabel(null);
      toast.success('Wake word saved. The wall switches to it in a few seconds.');
    } catch (e) {
      console.error('[wallSettings] wake word upload failed:', e);
      toast.error("Couldn't save the wake word file.");
    }
  };

  const allowance = usesDevice
    ? 'Voice runs on the iPad and never uses the AI allowance'
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

            {usesDevice && (
              <>
                <Row className="flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">Hands-free</p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      Say “{wake.label}” instead of tapping the mic. Off during night hours; starts after the first touch
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
                          A built-in word works now. For “Hey Home”, train it with openWakeWord’s free notebook and add the .onnx file below
                        </p>
                      </div>
                      <div className="w-48">
                        <Select
                          aria-label="Wake word"
                          value={wake.keyword}
                          onChange={e => {
                            const builtIn = WAKE_BUILT_INS.find(b => b.keyword === e.target.value);
                            if (builtIn) void saveWake({ keyword: builtIn.keyword, label: builtIn.label });
                          }}
                        >
                          {WAKE_BUILT_INS.map(b => (
                            <option key={b.keyword} value={b.keyword}>
                              {b.label}
                            </option>
                          ))}
                          {wake.keyword === 'custom' && <option value="custom">{wake.label} (my file)</option>}
                        </Select>
                      </div>
                    </Row>
                    <Row className="flex-col items-stretch gap-2">
                      <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">My own word (.onnx)</p>
                      <div className="flex gap-2 items-end flex-wrap">
                        <div className="w-40">
                          <Input
                            aria-label="What the word is called"
                            maxLength={40}
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            onBlur={() => {
                              const next = label.trim();
                              if (wake.keyword === 'custom' && next && next !== wake.label) {
                                void saveWake({ label: next }).then(() => setLabel(null));
                              }
                            }}
                          />
                        </div>
                        <input
                          aria-label="Wake word file"
                          type="file"
                          accept=".onnx"
                          className="text-sm text-brand-700 dark:text-brand-300"
                          onChange={e => void pickModel(e.target.files?.[0])}
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
                        options={WAKE_THRESHOLDS.map(o => ({ value: o.label, label: o.label }))}
                        value={nearestThreshold(wake.threshold).label}
                        onChange={v => {
                          const step = WAKE_THRESHOLDS.find(o => o.label === v);
                          if (step) void saveWake({ threshold: step.threshold });
                        }}
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
