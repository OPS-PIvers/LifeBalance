import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

/** Pins the "detected browser zone" the component reads at mount so the
 * timezone-row assertions below don't depend on the test runner's actual TZ. */
const DETECTED_ZONE = 'America/Chicago';
const stubDetectedTimezone = () => {
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    ((...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
      const real = new OriginalDateTimeFormat(...args);
      return {
        ...real,
        resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: DETECTED_ZONE }),
      } as Intl.DateTimeFormat;
    }) as unknown as typeof Intl.DateTimeFormat
  );
};

describe('NotificationSettings', () => {
  it('renders the flat preference list without a nested card heading', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NotificationSettings householdId="h1" onSave={onSave} />);

    // The redesigned component drops its own boxed heading (the enclosing Drawer
    // supplies the title) and renders the preferences directly as a flat list.
    expect(screen.queryByText('Notification Preferences')).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Daily habit check-in reminders' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Preferences' })
    ).toBeInTheDocument();
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

  describe('Timezone row (TZ-1)', () => {
    beforeEach(() => {
      stubDetectedTimezone();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('defaults to the detected zone and shows it matches', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue(DETECTED_ZONE);
      expect(screen.getByText("Matches your device's detected zone.")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Use detected zone' })).not.toBeInTheDocument();
    });

    it('flags a saved timezone that differs from the detected zone', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const saved: NotificationPreferences = {
        habitReminders: { enabled: false, time: '20:00' },
        actionQueueReminders: { enabled: false, time: '08:00' },
        budgetAlerts: { enabled: true, threshold: 0 },
        streakWarnings: { enabled: false, time: '21:00' },
        billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
        timezone: 'UTC',
      };

      render(<NotificationSettings householdId="h1" currentPreferences={saved} onSave={onSave} />);

      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
      expect(
        screen.getByText(new RegExp(`This differs from your device's detected zone \\(${DETECTED_ZONE}\\)`))
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Use detected zone' })).toBeInTheDocument();
    });

    it('"Use detected zone" resets the picker to the detected zone', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      const saved: NotificationPreferences = {
        habitReminders: { enabled: false, time: '20:00' },
        actionQueueReminders: { enabled: false, time: '08:00' },
        budgetAlerts: { enabled: true, threshold: 0 },
        streakWarnings: { enabled: false, time: '21:00' },
        billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
        timezone: 'UTC',
      };

      render(<NotificationSettings householdId="h1" currentPreferences={saved} onSave={onSave} />);

      await user.click(screen.getByRole('button', { name: 'Use detected zone' }));

      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue(DETECTED_ZONE);
      expect(screen.getByText("Matches your device's detected zone.")).toBeInTheDocument();
    });

    it('saves an explicit override selection', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Timezone' }), 'Pacific/Honolulu');
      await user.click(screen.getByRole('button', { name: 'Save Preferences' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({ timezone: 'Pacific/Honolulu' });
    });
  });
});
