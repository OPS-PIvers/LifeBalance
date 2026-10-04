import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ShoppingItem, WallVoiceEngine } from '@/types/schema';
import type { WallVoiceCommand } from '@/services/geminiService.types';
import { WallDataContext, type WallData } from '@/components/wall/data/wallData';
import { makeWallData } from '@/components/wall/data/wallTestData';
import { VoiceCaptureError, type VoiceCapture, type VoiceEngine } from './voiceEngines';
import { WALL_VOICE_BANNER_MS, useWallVoice, type WallVoiceDeps } from './useWallVoice';
import WallVoiceBanner from './WallVoiceBanner';

vi.mock('@/services/geminiService', () => ({
  parseWallVoiceText: vi.fn(),
  parseWallVoiceAudio: vi.fn(),
}));

const TODAY = '2026-10-04';

interface FakeSession {
  kind: 'speech' | 'audio';
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
  return { sessions, createEngine };
}

const Harness: React.FC<{
  setting?: WallVoiceEngine;
  deps: WallVoiceDeps;
  onShow: (t: string) => void;
  onRotate: (on: boolean) => void;
}> = ({ setting = 'auto', deps, onShow, onRotate }) => {
  const voice = useWallVoice({ setting, today: TODAY, timeZone: 'America/Chicago', onShow, onRotate, deps });
  return (
    <>
      <button type="button" onClick={voice.start}>
        Mic
      </button>
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

function setup(opts: { setting?: WallVoiceEngine; parse?: (c: WallVoiceCommand) => void; command?: WallVoiceCommand; parseError?: Error; support?: { speech: boolean; audio: boolean } } = {}) {
  const engines = fakeEngines();
  const command = opts.command ?? { transcript: 'add milk and eggs', intent: 'add_shopping', items: [{ name: 'milk' }, { name: 'eggs' }] };
  const parse = vi.fn(async () => {
    if (opts.parseError) throw opts.parseError;
    return command;
  });
  const deps: WallVoiceDeps = {
    support: opts.support ?? { speech: true, audio: true },
    createEngine: engines.createEngine,
    parseText: parse,
    parseAudio: parse,
  };
  const data = makeWallData(vi.fn, { shoppingList: [] });
  const onShow = vi.fn();
  const onRotate = vi.fn();
  const ui = () => (
    <WallDataContext.Provider value={data}>
      <Harness setting={opts.setting} deps={deps} onShow={onShow} onRotate={onRotate} />
    </WallDataContext.Provider>
  );
  const utils = render(ui());
  const rerenderWith = (patch: Partial<WallData>) => {
    Object.assign(data, patch);
    utils.rerender(ui());
  };
  const say = async (capture: VoiceCapture) => {
    fireEvent.click(screen.getByRole('button', { name: 'Mic' }));
    await act(async () => {
      engines.sessions.at(-1)!.resolve(capture);
    });
  };
  return { engines, parse, data, onShow, onRotate, rerenderWith, say };
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
    await say({ kind: 'text', transcript: 'add milk and eggs' });
    expect(parse).toHaveBeenCalledWith('h1', 'add milk and eggs', expect.objectContaining({ memberNames: ['Paul', 'Leo'], today: TODAY }));
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
    await say({ kind: 'text', transcript: 'add milk' });
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
});
