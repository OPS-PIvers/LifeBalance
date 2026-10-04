import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';
import type { HouseholdMember, WallCalendarFeed } from '@/types/schema';

const mocks = vi.hoisted(() => ({
  feeds: [] as WallCalendarFeed[],
  call: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/firebase.config', () => ({ db: {}, getFunctionsInstance: async () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({ withConverter: () => ({}) }),
  onSnapshot: (_ref: unknown, next: (snap: { docs: { data: () => WallCalendarFeed }[] }) => void) => {
    next({ docs: mocks.feeds.map(f => ({ data: () => f })) });
    return () => undefined;
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => async (data: unknown) => ({ data: await mocks.call(name, data) }),
}));
vi.mock('@/components/wall/wallCalendarService', () => ({ syncWallCalendarsNow: mocks.sync }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import WallCalendarSettings from './WallCalendarSettings';

const members = [
  { uid: 'u1', displayName: 'Paul', role: 'admin' },
  { uid: 'u2', displayName: 'Ava', role: 'member' },
] as HouseholdMember[];

const feed = (over: Partial<WallCalendarFeed>): WallCalendarFeed => ({
  id: 'f1',
  label: 'Work',
  ownerKey: 'u1',
  kind: 'ics',
  createdBy: 'u1',
  eventCount: 4,
  stale: false,
  lastSyncAt: new Date().toISOString(),
  lastSuccessAt: new Date().toISOString(),
  ...over,
});

const renderIt = (isAdmin = true, onSave = vi.fn(async () => undefined)) =>
  render(
    <WallCalendarSettings householdId="h1" isAdmin={isAdmin} members={members} settings={DEFAULT_WALL_SETTINGS} onSave={onSave} />
  );

beforeEach(() => {
  mocks.feeds = [];
  mocks.call.mockReset();
  mocks.sync.mockReset();
});

describe('WallCalendarSettings', () => {
  it('lists feeds with their owner and health, holidays last', () => {
    mocks.feeds = [
      feed({ id: 'holidays', label: 'US holidays', ownerKey: 'family', kind: 'holidays' }),
      feed({ id: 'f2', label: 'School', ownerKey: 'u2', stale: true, lastSuccessAt: '2026-10-01T18:00:00Z' }),
      feed({}),
    ];
    renderIt();
    const labels = screen.getAllByText(/^(Work|School|US holidays)$/).map(el => el.textContent);
    // The last is the US holidays toggle row, below every feed.
    expect(labels).toEqual(['School', 'Work', 'US holidays', 'US holidays']);
    expect(screen.getByText('Ava', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/Hasn't updated since Oct 1/)).toBeInTheDocument();
    expect(screen.getAllByText(/4 events · synced/)).toHaveLength(2); // Work + holidays
    // The built-in holidays feed is managed by its toggle, not Edit/Remove.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
  });

  it('adds a calendar through the callable and shows server errors inline', async () => {
    mocks.call.mockRejectedValueOnce(new Error("That link isn't a calendar file.")).mockResolvedValueOnce({ feedId: 'f9', eventCount: 7 });
    renderIt();
    fireEvent.change(screen.getByLabelText('Calendar link'), { target: { value: ' webcal://cal.example.com/a.ics ' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Soccer' } });
    fireEvent.change(screen.getByLabelText('Whose'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("isn't a calendar file"));
    expect(mocks.call).toHaveBeenCalledWith('addwallcalendarfeed', {
      householdId: 'h1',
      url: 'webcal://cal.example.com/a.ics',
      label: 'Soccer',
      ownerKey: 'u2',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
  });

  it('edits without resending the link unless a new one is pasted', async () => {
    mocks.feeds = [feed({})];
    mocks.call.mockResolvedValue({ ok: true });
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('updatewallcalendarfeed', { householdId: 'h1', feedId: 'f1', label: 'Office', ownerKey: 'u1' })
    );
  });

  it('gives non-admins the toggles and sync, but no editing', async () => {
    mocks.feeds = [feed({})];
    mocks.sync.mockResolvedValue({ failed: 0 });
    const onSave = vi.fn(async () => undefined);
    renderIt(false, onSave);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Calendar link')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('radio', { name: 'Hide' })[1]!);
    expect(onSave).toHaveBeenCalledWith({ showBills: false });
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith('h1'));
  });
});
