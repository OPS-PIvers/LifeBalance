import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';
import type { WallSettings } from '@/types/schema';

const mocks = vi.hoisted(() => ({
  settings: null as WallSettings | null,
  setDoc: vi.fn(async () => undefined),
  call: vi.fn(async (_name: string, _data: unknown): Promise<unknown> => ({ ok: true })),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: (_f: unknown, name: string) => (data: unknown) => mocks.call(name, data).then(r => ({ data: r })) }));

vi.mock('@/firebase.config', () => ({ db: {}, getFunctionsInstance: async () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({ withConverter: () => ({ kind: 'collection' }) }),
  doc: () => ({ withConverter: () => ({ kind: 'doc' }) }),
  setDoc: mocks.setDoc,
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
  mocks.call.mockClear();
});

describe('WallDisplaySettings → Week layout', () => {
  it('sets the starting modules, top first, never the same twice', () => {
    renderIt();
    expect(screen.getByLabelText('Top module')).toHaveValue('coming');
    fireEvent.change(screen.getByLabelText('Bottom module'), { target: { value: 'shopping' } });
    expect(saved()).toMatchObject({ defaultModules: ['coming', 'shopping'] });
    expect(screen.getByLabelText('Bottom module').querySelector('option[value="coming"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Top module'), { target: { value: 'none' } });
    expect(saved()).toMatchObject({ defaultModules: [] });
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
  it('shows the allowance left and switches the engine', () => {
    renderIt();
    expect(screen.getByText(/96 left today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Recording' }));
    expect(saved()).toMatchObject({ voice: 'audio' });
  });

  it('turning voice off hides the listening choice', () => {
    mocks.settings = { ...DEFAULT_WALL_SETTINGS, voice: 'off' };
    renderIt();
    expect(screen.queryByRole('radio', { name: 'Recording' })).toBeNull();
    fireEvent.click(screen.getAllByRole('radio', { name: 'On' }).at(-1)!);
    expect(saved()).toMatchObject({ voice: 'auto' });
  });
});

describe('WallDisplaySettings → Sound', () => {
  it('sets the volume and the reply style', () => {
    renderIt();
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
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
