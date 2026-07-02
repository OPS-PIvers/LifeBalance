import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationSettings from './NotificationSettings';
import type { NotificationPreferences } from '@/types/schema';

vi.mock('@/firebase.config', () => ({ getFunctionsInstance: vi.fn() }));
vi.mock('@/utils/platform', () => ({
  isIOSDevice: () => false,
  isPWA: () => false,
  supportsPush: () => false,
}));
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe('NotificationSettings', () => {
  it('renders a single Notification Preferences heading and no nested card wrapper', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NotificationSettings householdId="h1" onSave={onSave} />);

    expect(screen.getAllByText('Notification Preferences')).toHaveLength(1);
  });

  it('reveals the habit reminder time select once habit reminders are enabled', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NotificationSettings householdId="h1" onSave={onSave} />);

    expect(
      screen.queryByRole('combobox', { name: 'Habit reminder time' })
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: 'Daily habit check-in reminders' })
    );

    expect(
      screen.getByRole('combobox', { name: 'Habit reminder time' })
    ).toBeInTheDocument();
  });

  it('reveals bill reminder inline controls by accessible name once enabled', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NotificationSettings householdId="h1" onSave={onSave} />);

    await user.click(
      screen.getByRole('checkbox', { name: 'Bill payment reminders' })
    );

    expect(
      screen.getByRole('spinbutton', { name: 'Days before bill due' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Bill reminder time' })
    ).toBeInTheDocument();
  });

  it('fills in missing preference sections from defaults for legacy saved docs', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    // A legacy Firestore doc that predates the newer preference sections —
    // narrower at runtime than the type claims.
    const legacy = {
      habitReminders: { enabled: true, time: '19:00' },
    } as NotificationPreferences;

    render(
      <NotificationSettings
        householdId="h1"
        currentPreferences={legacy}
        onSave={onSave}
      />
    );

    // Renders without crashing on the missing sections, keeps the saved value...
    expect(
      screen.getByRole('checkbox', { name: 'Daily habit check-in reminders' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Bill payment reminders' })
    ).not.toBeChecked();

    // ...and saving emits a fully-populated preferences object.
    await user.click(screen.getByRole('button', { name: 'Save Preferences' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      habitReminders: { enabled: true, time: '19:00' },
      billReminders: expect.objectContaining({ enabled: false }),
      budgetAlerts: expect.objectContaining({ enabled: false }),
    });
  });

  it('displays a saved $0 low-balance threshold instead of falling back to $100', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const saved: NotificationPreferences = {
      habitReminders: { enabled: false, time: '20:00' },
      actionQueueReminders: { enabled: false, time: '08:00' },
      budgetAlerts: { enabled: true, threshold: 0 },
      streakWarnings: { enabled: false, time: '21:00' },
      billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
      timezone: 'America/Chicago',
    };

    render(
      <NotificationSettings
        householdId="h1"
        currentPreferences={saved}
        onSave={onSave}
      />
    );

    expect(
      screen.getByRole('spinbutton', { name: 'Low balance alert threshold in dollars' })
    ).toHaveValue(0);
  });

  it('calls onSave with the updated preferences when Save Preferences is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NotificationSettings householdId="h1" onSave={onSave} />);

    await user.click(
      screen.getByRole('checkbox', { name: 'Daily habit check-in reminders' })
    );

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      habitReminders: expect.objectContaining({ enabled: true }),
    });
  });
});
