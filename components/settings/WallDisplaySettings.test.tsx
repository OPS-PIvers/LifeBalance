import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';
import type { WallSettings } from '@/types/schema';

const mocks = vi.hoisted(() => ({
  settings: null as WallSettings | null,
  setDoc: vi.fn(async () => undefined),
}));

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

import WallDisplaySettings from './WallDisplaySettings';

const renderIt = () => render(<WallDisplaySettings householdId="h1" isAdmin members={[]} />);
const saved = () => (mocks.setDoc.mock.calls.at(-1) as unknown[] | undefined)?.[1];

beforeEach(() => {
  mocks.settings = null;
  mocks.setDoc.mockClear();
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
