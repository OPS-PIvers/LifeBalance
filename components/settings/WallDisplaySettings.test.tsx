import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';
import type { WallSettings } from '@/types/schema';

const mocks = vi.hoisted(() => ({
  settings: null as WallSettings | null,
  setDoc: vi.fn(async () => undefined),
  batchSet: vi.fn(),
  commit: vi.fn(async () => undefined),
  call: vi.fn(async (_name: string, _data: unknown): Promise<unknown> => ({ ok: true })),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: (_f: unknown, name: string) => (data: unknown) => mocks.call(name, data).then(r => ({ data: r })) }));

vi.mock('@/firebase.config', () => ({ db: {}, getFunctionsInstance: async () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({ withConverter: () => ({ kind: 'collection' }) }),
  doc: (_db: unknown, path: string) => ({ path, withConverter: () => ({ kind: 'doc' }) }),
  setDoc: mocks.setDoc,
  writeBatch: () => ({ set: mocks.batchSet, commit: mocks.commit }),
  Bytes: { fromUint8Array: (u: Uint8Array) => ({ bytes: Array.from(u) }) },
  onSnapshot: (ref: { kind: string }, next: (snap: unknown) => void) => {
    if (ref.kind === 'doc') next({ data: () => mocks.settings ?? undefined });
    else next({ docs: [] });
    return () => undefined;
  },
}));
vi.mock('./WallCalendarSettings', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAiUsageToday', () => ({ useAiUsageToday: () => ({ used: 4, cap: 100 }) }));

import WallDisplaySettings from './WallDisplaySettings';

const renderIt = () => render(<WallDisplaySettings householdId="h1" isAdmin members={[]} />);
const saved = () => (mocks.setDoc.mock.calls.at(-1) as unknown[] | undefined)?.[1];

beforeEach(() => {
  mocks.settings = null;
  mocks.setDoc.mockClear();
  mocks.batchSet.mockClear();
  mocks.commit.mockClear();
  mocks.call.mockClear();
});

describe('WallDisplaySettings → Week layout', () => {
  it('sets the starting modules, top first, never the same twice', () => {
    renderIt();
    expect(screen.getByLabelText('Top module')).toHaveValue('coming');
    fireEvent.change(screen.getByLabelText('Bottom module'), { target: { value: 'shopping' } });
    expect(saved()).toMatchObject({ defaultModules: ['coming', 'shopping'] });
    expect(screen.getByLabelText('Bottom module').querySelector('option[value="coming"]')).toBeNull();
    // The top can't be empty: there is no "Nothing" choice for it.
    expect(screen.getByLabelText('Top module').querySelector('option[value="none"]')).toBeNull();
  });

  it('shows the interval only while rotation is on', () => {
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, rotation: { enabled: true, intervalSec: 60 } };
    renderIt();
    fireEvent.click(screen.getByRole('radio', { name: '2 min' }));
    expect(saved()).toMatchObject({ rotation: { enabled: true, intervalSec: 120 } });
    fireEvent.click(screen.getAllByRole('radio', { name: 'Off' })[0]!);
    expect(saved()).toMatchObject({ rotation: { enabled: false, intervalSec: 60 } });
  });
});

describe('WallDisplaySettings → Voice', () => {
  it('switches the engine, and shows the allowance left where it’s spent', () => {
    renderIt();
    fireEvent.click(screen.getByRole('radio', { name: 'Recording' }));
    expect(saved()).toMatchObject({ voice: 'audio' });
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, voice: 'audio' };
    renderIt();
    expect(screen.getByText(/96 left today/)).toBeInTheDocument();
  });

  it('turning voice off hides the listening choice', () => {
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, voice: 'off' };
    renderIt();
    expect(screen.queryByRole('radio', { name: 'Recording' })).toBeNull();
    fireEvent.click(screen.getAllByRole('radio', { name: 'On' }).at(-1)!);
    expect(saved()).toMatchObject({ voice: 'auto' });
  });
});

describe('WallDisplaySettings → Voice → wake word', () => {
  it('says on-device voice never uses the allowance, and asks for no key', () => {
    renderIt();
    expect(screen.getByText(/never uses the AI allowance/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/AccessKey/)).toBeNull();
    expect(screen.getByText(/Say “Hey Jarvis” instead of tapping the mic/)).toBeInTheDocument();
  });

  it('picks a built-in word and a sensitivity', () => {
    renderIt();
    fireEvent.change(screen.getByLabelText('Wake word'), { target: { value: 'hey_mycroft' } });
    expect(saved()).toMatchObject({ wakeModel: { keyword: 'hey_mycroft', label: 'Hey Mycroft', threshold: 0.5 } });
    const sensitivity = screen.getByRole('radiogroup', { name: 'Wake word sensitivity' });
    fireEvent.click(within(sensitivity).getByRole('radio', { name: 'High' }));
    expect(saved()).toMatchObject({ wakeModel: { threshold: 0.3 } });
  });

  it('turns hands-free off', () => {
    renderIt();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Hands-free wake word' })).getByRole('radio', { name: 'Off' }));
    expect(saved()).toMatchObject({ wakeWord: false });
  });

  it('uploads a custom .onnx as chunks plus the setting that points at them, in one batch', async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText('What the word is called'), { target: { value: 'Hey Home' } });
    const file = new File([new Uint8Array([104, 105])], 'hey_home.onnx');
    fireEvent.change(screen.getByLabelText('Wake word file'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const [chunk, config] = mocks.batchSet.mock.calls as unknown as [[{ path: string }, { id: string; data: { bytes: number[] } }], [{ path: string }, { wakeModel: unknown }, unknown]];
    expect(chunk[0].path).toBe('households/h1/wallSettings/wake-0');
    expect(chunk[1].data).toEqual({ bytes: [104, 105] });
    expect(config[0].path).toBe('households/h1/wallSettings/config');
    expect(config[1].wakeModel).toEqual({ keyword: 'custom', file: { id: chunk[1].id, chunks: 1, bytes: 2 }, label: 'Hey Home', threshold: 0.5 });
    expect(config[2]).toEqual({ merge: true });
  });

  it('refuses a file that isn’t an .onnx', async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText('Wake word file'), { target: { files: [new File(['x'], 'hey_home.ppn')] } });
    await new Promise(r => setTimeout(r, 0));
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('hides the wake word when voice goes to Gemini', () => {
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, voice: 'audio' };
    renderIt();
    expect(screen.queryByLabelText('Wake word')).toBeNull();
  });
});

describe('WallDisplaySettings → Sound', () => {
  it('sets the volume and the reply style', () => {
    renderIt();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Wall volume' })).getByRole('radio', { name: 'High' }));
    expect(saved()).toMatchObject({ sound: { confirm: 'speak', alerts: 'speak', volume: 1 } });
    fireEvent.click(screen.getAllByRole('radio', { name: 'Chime only' })[0]!);
    expect(saved()).toMatchObject({ sound: { confirm: 'chime', volume: 0.7 } });
    fireEvent.click(screen.getAllByRole('radio', { name: 'Chime only' })[1]!);
    expect(saved()).toMatchObject({ sound: { alerts: 'chime' } });
  });
});

describe('WallDisplaySettings → Starting-soon alerts', () => {
  it('sets the lead time', () => {
    renderIt();
    fireEvent.click(screen.getByRole('radio', { name: '15 min' }));
    expect(saved()).toMatchObject({ alerts: { leadMin: 15 } });
  });

  it('saves the home address through the server, never to settings', async () => {
    renderIt();
    expect(screen.getByText(/Not set: alerts use the lead time/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Home address'), { target: { value: ' 1 Main St, Orono ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('setwallhomeaddress', { householdId: 'h1', address: '1 Main St, Orono' }));
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('shows the server’s travel problem and offers Remove once saved', () => {
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, homeAddressSet: true, travelError: 'Travel times need the Routes API turned on.' };
    renderIt();
    expect(screen.getByText('Travel times need the Routes API turned on.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
