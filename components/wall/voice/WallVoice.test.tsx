import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ShoppingItem, WallVoiceEngine, WallWakeModel } from '@/types/schema';
import type { WallVoiceCommand } from '@/services/geminiService.types';
import { WallDataContext, type WallData } from '@/components/wall/data/wallData';
import { makeWallData } from '@/components/wall/data/wallTestData';
import { VoiceCaptureError, type VoiceCapture, type VoiceEngine } from './voiceEngines';
import type { DeviceListenOptions, DeviceVoiceEngine } from './deviceEngine';
import { DEFAULT_WAKE_MODEL } from '@/utils/wall/wallSettings';
import { WALL_VOICE_BANNER_MS, WALL_VOICE_BIG_MS, useWallVoice, type WallVoiceDeps, type WallVoiceFeedback } from './useWallVoice';
import WallVoiceBanner from './WallVoiceBanner';

vi.mock('@/services/geminiService', () => ({
  parseWallVoiceText: vi.fn(),
  parseWallVoiceAudio: vi.fn(),
}));

const TODAY = '2026-10-04';

interface FakeSession {
  kind: 'speech' | 'audio' | 'device';
  resolve: (capture: VoiceCapture) => void;
  reject: (error: unknown) => void;
}

function fakeEngines() {
  const sessions: FakeSession[] = [];
  const createEngine = vi.fn(
    (kind: 'speech' | 'audio'): VoiceEngine => ({
      kind,
      dispose: vi.fn(),
      listen: () => {
        let session!: FakeSession;
        const result = new Promise<VoiceCapture>((resolve, reject) => {
          session = { kind, resolve, reject };
        });
        sessions.push(session);
        return { result, finish: vi.fn(), cancel: () => session.reject(new VoiceCaptureError('aborted')) };
      },
    })
  );
  let onWake: () => void = () => undefined;
  const listenOptions: DeviceListenOptions[] = [];
  const setWake = vi.fn(async (_on: boolean) => undefined);
  const createDeviceEngine = vi.fn(
    (_model: WallWakeModel, wake: () => void): DeviceVoiceEngine => {
      onWake = wake;
      return {
        kind: 'device',
        dispose: vi.fn(),
        setWake,
        listen: (options: DeviceListenOptions) => {
          listenOptions.push(options);
          let session!: FakeSession;
          const result = new Promise<VoiceCapture>((resolve, reject) => {
            session = { kind: 'device', resolve, reject };
          });
          sessions.push(session);
          return { result, finish: vi.fn(), cancel: () => session.reject(new VoiceCaptureError('aborted')) };
        },
      };
    }
  );
  return { sessions, createEngine, createDeviceEngine, setWake, listenOptions, wake: () => onWake() };
}


const Harness: React.FC<{
  setting?: WallVoiceEngine;
  wakeModel?: WallWakeModel;
  wake?: boolean;
  onWake?: () => void;
  deps: WallVoiceDeps;
  onShow: (t: string) => void;
  onRotate: (on: boolean) => void;
  onFeedback: (f: WallVoiceFeedback) => void;
}> = ({ setting = 'auto', wakeModel = DEFAULT_WAKE_MODEL, wake, onWake, deps, onShow, onRotate, onFeedback }) => {
  const voice = useWallVoice({ setting, wakeModel, wake, onWake, today: TODAY, timeZone: 'America/Chicago', onShow, onRotate, onFeedback, deps });
  return (
    <>
      <button type="button" onClick={voice.start}>
        Mic
      </button>
      {voice.wakeListening && <span>wake on</span>}
      {voice.state && (
        <WallVoiceBanner
          state={voice.state}
          onFinish={voice.finish}
          onCancel={voice.cancel}
          onRetry={voice.start}
          onUndo={voice.undo}
          onShow={onShow}
        />
      )}
    </>
  );
};

function setup(
  opts: {
    setting?: WallVoiceEngine;
    parse?: (c: WallVoiceCommand) => void;
    command?: WallVoiceCommand;
    parseError?: Error;
    support?: { speech: boolean; audio: boolean; device?: boolean };
    wakeModel?: WallWakeModel;
    wake?: boolean;
  } = {}
) {
  const engines = fakeEngines();
  const command = opts.command ?? { transcript: 'add milk and eggs', intent: 'add_shopping', items: [{ name: 'milk' }, { name: 'eggs' }] };
  const parse = vi.fn(async () => {
    if (opts.parseError) throw opts.parseError;
    return command;
  });
  const deps: WallVoiceDeps = {
    support: opts.support ?? { speech: true, audio: true },
    createEngine: engines.createEngine,
    createDeviceEngine: engines.createDeviceEngine,
    parseText: parse,
    parseAudio: parse,
  };
  const data = makeWallData(vi.fn, { shoppingList: [] });
  const onShow = vi.fn();
  const onRotate = vi.fn();
  const onFeedback = vi.fn();
  const onWake = vi.fn();
  let wake = opts.wake ?? false;
  let wakeModel = opts.wakeModel;
  const ui = () => (
    <WallDataContext.Provider value={data}>
      <Harness
        setting={opts.setting}
        {...(wakeModel ? { wakeModel } : {})}
        wake={wake}
        onWake={onWake}
        deps={deps}
        onShow={onShow}
        onRotate={onRotate}
        onFeedback={onFeedback}
      />
    </WallDataContext.Provider>
  );
  const utils = render(ui());
  const rerenderWith = (patch: Partial<WallData>) => {
    Object.assign(data, patch);
    utils.rerender(ui());
  };
  const setWake = (on: boolean) => {
    wake = on;
    utils.rerender(ui());
  };
  const rerenderWake = (model: WallWakeModel) => {
    wakeModel = model;
    utils.rerender(ui());
  };
  const say = async (capture: VoiceCapture) => {
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions.at(-1)!.resolve(capture);
    });
  };
  return { engines, parse, data, onShow, onRotate, onFeedback, onWake, rerenderWith, setWake, rerenderWake, say };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('wall voice', () => {
  it('runs navigation through the local grammar with no AI call', async () => {
    const { say, parse, onShow } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    expect(screen.getByText('Listening')).toBeInTheDocument();
    // Tapping again starts a fresh session.
    await say({ kind: 'text', transcript: 'Show the meals' });
    expect(onShow).toHaveBeenCalledWith('meals');
    expect(parse).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('adds shopping items, then Undo removes exactly what it added', async () => {
    const { say, parse, data, rerenderWith } = setup();
    // Wording the no-AI grammar can't read goes to Gemini.
    await say({ kind: 'text', transcript: 'grab what we need for breakfast' });
    expect(parse).toHaveBeenCalledWith('h1', 'grab what we need for breakfast', expect.objectContaining({ memberNames: ['Paul', 'Leo'], today: TODAY }));
    expect(screen.getByText('Added to Shopping')).toBeInTheDocument();
    expect(screen.getByText('Milk, Eggs')).toBeInTheDocument();
    expect(data.actions.addShoppingItem).toHaveBeenCalledTimes(2);
    expect(data.actions.addShoppingItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Milk', source: 'voice' }));

    rerenderWith({
      shoppingList: [
        { id: 'n1', name: 'Milk', category: 'Dairy', isPurchased: false },
        { id: 'n2', name: 'Eggs', category: 'Dairy', isPurchased: false },
      ] as ShoppingItem[],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
    expect(data.actions.deleteShoppingItem).toHaveBeenCalledWith('n1');
    expect(data.actions.deleteShoppingItem).toHaveBeenCalledWith('n2');
    expect(screen.getByText('Undone')).toBeInTheDocument();
  });

  it('reads a plain add itself, with no AI call', async () => {
    const { say, parse, data } = setup();
    await say({ kind: 'text', transcript: 'Add milk and eggs to the shopping list' });
    expect(parse).not.toHaveBeenCalled();
    expect(screen.getByText('Milk, Eggs')).toBeInTheDocument();
    expect(data.actions.addShoppingItem).toHaveBeenCalledTimes(2);
  });

  it('opens as the big card with a spoken reply, then shrinks to the banner', async () => {
    vi.useFakeTimers();
    const { say, onFeedback } = setup();
    await say({ kind: 'text', transcript: 'add milk and eggs' });
    expect(onFeedback).toHaveBeenCalledWith({ tone: 'ok', speech: 'Added milk and eggs to shopping.' });
    expect(document.querySelector('.spot')).not.toBeNull();
    expect(document.querySelector('.vb')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(WALL_VOICE_BIG_MS);
    });
    expect(document.querySelector('.spot')).toBeNull();
    expect(document.querySelector('.vb')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WALL_VOICE_BANNER_MS - WALL_VOICE_BIG_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an error is spoken by its title', async () => {
    const { say, onFeedback } = setup({ command: { transcript: 'sing', intent: 'unknown' } });
    await say({ kind: 'text', transcript: 'sing' });
    expect(onFeedback).toHaveBeenCalledWith({ tone: 'error', speech: 'Didn’t catch that' });
  });

  it('“Show list” goes to the list it added to', async () => {
    const { say, onShow } = setup();
    await say({ kind: 'text', transcript: 'add milk and eggs' });
    fireEvent.click(screen.getByRole('button', { name: 'Show list' }));
    expect(onShow).toHaveBeenCalledWith('shopping');
  });

  it('adds a to-do for the named member, and “undo” by voice reverses it', async () => {
    const { say, data, rerenderWith } = setup({
      command: { transcript: 'remind Leo to feed the fish tomorrow', intent: 'add_todo', todo: { text: 'feed the fish', assigneeName: 'leo', due: 'tomorrow' } },
    });
    await say({ kind: 'text', transcript: 'remind Leo to feed the fish tomorrow' });
    expect(data.actions.addToDo).toHaveBeenCalledWith({
      text: 'Feed the fish',
      completeByDate: '2026-10-05',
      isCompleted: false,
      source: 'voice',
      assignedTo: 'l',
    });
    expect(screen.getByText('Added to To-dos')).toBeInTheDocument();
    rerenderWith({
      todos: [{ id: 'nt', text: 'Feed the fish', completeByDate: '2026-10-05', isCompleted: false, createdAt: 'x', createdBy: 'd' }],
    });
    await say({ kind: 'text', transcript: 'undo that' });
    expect(data.actions.deleteToDo).toHaveBeenCalledWith('nt');
  });

  it('falls back to recorded audio when on-device speech is refused, and the grammar still wins', async () => {
    const { engines, parse, onShow } = setup({ command: { transcript: 'show the calendar', intent: 'unknown' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions[0]!.reject(new VoiceCaptureError('not-allowed'));
    });
    expect(engines.sessions[1]?.kind).toBe('audio');
    await act(async () => {
      engines.sessions[1]!.resolve({ kind: 'audio', data: 'AAAA', mimeType: 'audio/wav' });
    });
    expect(parse).toHaveBeenCalledWith('h1', 'AAAA', 'audio/wav', expect.anything());
    expect(onShow).toHaveBeenCalledWith('week');
    // The refusal sticks for this launch.
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    expect(engines.sessions[2]?.kind).toBe('audio');
  });

  it('a forced on-device engine says the mic is blocked instead of falling back', async () => {
    const { engines } = setup({ setting: 'speech' });
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions[0]!.reject(new VoiceCaptureError('not-allowed'));
    });
    expect(screen.getByText('The microphone is blocked')).toBeInTheDocument();
    expect(engines.sessions).toHaveLength(1);
  });

  it('“Didn’t catch that” offers Try again and clears itself after 10 s', async () => {
    vi.useFakeTimers();
    const { engines } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions[0]!.reject(new VoiceCaptureError('no-speech'));
    });
    expect(screen.getByText('Didn’t catch that')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WALL_VOICE_BANNER_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains a used-up AI allowance', async () => {
    const { say } = setup({ parseError: new Error('Daily AI quota exceeded (100 requests/day). Try again tomorrow.') });
    await say({ kind: 'text', transcript: 'grab what we need for breakfast' });
    expect(screen.getByText("Today's AI allowance is used up")).toBeInTheDocument();
  });

  it('an unknown command quotes what it heard', async () => {
    const { say, data } = setup({ command: { transcript: 'what is the weather', intent: 'unknown' } });
    await say({ kind: 'text', transcript: 'what is the weather' });
    expect(screen.getByText('“what is the weather” isn’t a command I know.')).toBeInTheDocument();
    expect(data.actions.addShoppingItem).not.toHaveBeenCalled();
  });

  it('rotation commands reach the wall', async () => {
    const { say, onRotate } = setup();
    await say({ kind: 'text', transcript: 'stop rotating' });
    expect(onRotate).toHaveBeenCalledWith(false);
    expect(screen.getByText('Stopped rotating')).toBeInTheDocument();
  });

  it('Cancel while listening drops a late result', async () => {
    const { engines, parse } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    const first = engines.sessions[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      first.resolve({ kind: 'text', transcript: 'add milk' });
    });
    expect(parse).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  describe('on-device (openWakeWord + Vosk)', () => {
    const device = { speech: true, audio: true, device: true };

    it('Auto uses it wherever it runs, and never calls Gemini', async () => {
      const { engines, parse, say, data } = setup({ support: device });
      await say({ kind: 'text', transcript: 'add milk and two avocados' });
      expect(engines.sessions[0]?.kind).toBe('device');
      expect(data.actions.addShoppingItem).toHaveBeenCalledTimes(2);
      await say({ kind: 'text', transcript: 'grab what we need for breakfast' });
      expect(parse).not.toHaveBeenCalled();
      expect(screen.getByText('Didn’t catch that')).toBeInTheDocument();
      expect(screen.getByText(/isn’t a command I know\. Try “add milk”/)).toBeInTheDocument();
    });

    it('where it can’t run, Auto uses Safari', async () => {
      const { engines } = setup({ support: { speech: true, audio: true, device: false } });
      fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
      expect(engines.sessions[0]?.kind).toBe('speech');
    });

    it('drops the wake word and a stray lead-in, then reads the command', async () => {
      const { say, onShow } = setup({ support: device });
      await say({ kind: 'text', transcript: 'hey jarvis this show the meals', alternative: '[unk] show the meals' });
      expect(onShow).toHaveBeenCalledWith('meals');
    });

    it('rescues a misheard command with the command-only transcript', async () => {
      const { say, onShow } = setup({ support: device });
      await say({ kind: 'text', transcript: 'though the calendar', alternative: 'show the calendar' });
      expect(onShow).toHaveBeenCalledWith('week');
    });

    it('a tap listens without the moments before; the wake word with them', async () => {
      const { engines, onWake } = setup({ support: device, wake: true });
      await act(async () => undefined);
      fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
      expect(engines.listenOptions.at(-1)?.afterWake).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await act(async () => undefined);
      act(() => engines.wake());
      expect(onWake).toHaveBeenCalledTimes(1);
      expect(engines.listenOptions.at(-1)?.afterWake).toBe(true);
    });

    it('the wake word opens a command, and follows `wake`', async () => {
      const { engines, setWake, onWake } = setup({ support: device, wake: true });
      await act(async () => undefined);
      expect(engines.setWake).toHaveBeenLastCalledWith(true);
      expect(screen.getByText('wake on')).toBeInTheDocument();
      act(() => engines.wake());
      expect(onWake).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Listening')).toBeInTheDocument();
      expect(engines.sessions).toHaveLength(1);
      // Heard again mid-command: ignored.
      act(() => engines.wake());
      expect(engines.sessions).toHaveLength(1);
      await act(async () => setWake(false));
      expect(engines.setWake).toHaveBeenLastCalledWith(false);
      expect(screen.queryByText('wake on')).toBeNull();
    });

    it('says when the wake word can’t start, once', async () => {
      const { engines, setWake, onFeedback } = setup({ support: device });
      engines.setWake.mockRejectedValue(new VoiceCaptureError('not-allowed'));
      await act(async () => setWake(true));
      expect(screen.getByText('The wake word isn’t listening')).toBeInTheDocument();
      expect(screen.getByText(/Allow the microphone/)).toBeInTheDocument();
      await act(async () => setWake(false));
      await act(async () => setWake(true));
      expect(onFeedback.mock.calls.filter(([f]) => f.speech === 'The wake word isn’t listening')).toHaveLength(1);
    });

    it('shows why the wake word didn’t start, since the wall has no console', async () => {
      const { engines, setWake } = setup({ support: device });
      engines.setWake.mockRejectedValue(new VoiceCaptureError('unavailable', 'The wake word failed to load: no wasm'));
      await act(async () => setWake(true));
      expect(screen.getByText(/\(The wake word failed to load: no wasm\)/)).toBeInTheDocument();
    });

    it('speech files that don’t load say so', async () => {
      const { engines } = setup({ support: device });
      fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
      await act(async () => {
        engines.sessions[0]!.reject(new VoiceCaptureError('unavailable', 'Voice model /voice/x is missing from this deploy.'));
      });
      expect(screen.getByText('Voice couldn’t start')).toBeInTheDocument();
    });

    it('a new wake word rebuilds the engine', async () => {
      const { engines, rerenderWake } = setup({ support: device, wake: true });
      await act(async () => undefined);
      expect(engines.createDeviceEngine).toHaveBeenCalledTimes(1);
      await act(async () => rerenderWake({ keyword: 'hey_mycroft', label: 'Hey Mycroft', threshold: 0.5 }));
      expect(engines.createDeviceEngine).toHaveBeenCalledTimes(2);
      expect(engines.createDeviceEngine.mock.calls[1]?.[0]).toMatchObject({ keyword: 'hey_mycroft' });
    });
  });

  it('Safari’s recognizer that never starts falls back to Recording on Auto', async () => {
    const { engines } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions[0]!.reject(new VoiceCaptureError('unsupported'));
    });
    expect(engines.sessions[1]?.kind).toBe('audio');
  });

  it('Safari forced and dead says to set up on-device voice', async () => {
    const { engines } = setup({ setting: 'speech' });
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions[0]!.reject(new VoiceCaptureError('unsupported'));
    });
    expect(screen.getByText('The iPad’s speech recognition doesn’t work here')).toBeInTheDocument();
  });
});
