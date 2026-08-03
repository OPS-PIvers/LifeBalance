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
        // `{...real}` only copies OWN enumerable properties, but
        // formatToParts/format live on the prototype — a bare spread silently
        // drops them, which breaks utils/timezoneOptions.ts's
        // formatTimezoneOffset (used by the Finding-3 offset-annotated
        // options below) since it calls formatToParts. Delegate explicitly so
        // every Intl.DateTimeFormat instance built under this mock still
        // behaves like a real one, with only resolvedOptions() overridden.
        formatToParts: (date?: Date | number) => real.formatToParts(date),
        format: (date?: Date | number) => real.format(date),
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

  // TZ-1 review, Finding 1 (data-loss fix): pages/Settings.tsx's
  // handleSaveNotificationPreferences persists this component's onSave payload
  // as a FULL-MAP updateDoc replace, not a dot-path merge. Before this fix,
  // mergePreferences() built a literal object enumerating only its own known
  // sections, so any section it didn't know about — e.g. F-HABITS-03's
  // perHabitReminders, written by HabitFormModal — was silently dropped on
  // the very next Save. These two cases prove the fix: mergePreferences now
  // spreads `current` first, so an unknown/unlisted section survives the
  // round trip untouched.
  it('preserves perHabitReminders through a save round trip (data-loss regression)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const saved: NotificationPreferences = {
      habitReminders: { enabled: false, time: '20:00' },
      actionQueueReminders: { enabled: false, time: '08:00' },
      budgetAlerts: { enabled: true, threshold: 0 },
      streakWarnings: { enabled: false, time: '21:00' },
      billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
      perHabitReminders: {
        'habit-1': { enabled: true, time: '07:30', days: [1, 3, 5] },
      },
    };

    render(<NotificationSettings householdId="h1" currentPreferences={saved} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      perHabitReminders: {
        'habit-1': { enabled: true, time: '07:30', days: [1, 3, 5] },
      },
    });
  });

  it('preserves an arbitrary unknown preference key through a save round trip', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    // A hypothetical section a future app version wrote that this component
    // has never heard of — narrower at runtime than the type claims, same as
    // the legacy-doc test below.
    const saved = {
      habitReminders: { enabled: false, time: '20:00' },
      actionQueueReminders: { enabled: false, time: '08:00' },
      budgetAlerts: { enabled: true, threshold: 0 },
      streakWarnings: { enabled: false, time: '21:00' },
      billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
      someFuturePreference: { enabled: true, foo: 'bar' },
    } as unknown as NotificationPreferences;

    render(<NotificationSettings householdId="h1" currentPreferences={saved} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      someFuturePreference: { enabled: true, foo: 'bar' },
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

    // TZ-1 review, Finding 5: the row's copy previously named only "Scheduled
    // reminders and your weekly recap" — undersold since the monthly money
    // recap (functions/src/moneyRecap/index.ts) and the AI daily briefing
    // (functions/src/dailyBriefing/index.ts) also key off this field.
    it('describes everything the timezone controls', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      expect(
        screen.getByText('All your scheduled reminders, recaps, and the daily briefing are timed to this zone.')
      ).toBeInTheDocument();
    });

    it('defaults to the detected zone and shows it matches', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue(DETECTED_ZONE);
      expect(screen.getByText("Matches your device's detected zone.")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Use detected zone' })).not.toBeInTheDocument();
    });

    // TZ-1 review, Finding 3: raw Intl.supportedValuesOf('timeZone') output is
    // ~400 bare, alphabetical, offset-less identifiers — markedly worse than
    // the hour picker two rows below it. Each option must carry its current
    // UTC offset, and the browser-detected zone must be identifiable and
    // pinned first.
    it('annotates every option with a UTC offset and pins the detected zone to the top', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      const select = screen.getByRole('combobox', { name: 'Timezone' }) as HTMLSelectElement;
      const options = Array.from(select.options);

      expect(options[0]?.value).toBe(DETECTED_ZONE);
      expect(options[0]?.textContent).toMatch(/detected/i);
      expect(options.length).toBeGreaterThan(20);
      expect(options.every((opt) => /GMT[+-]\d/.test(opt.textContent ?? ''))).toBe(true);
    });

    // TZ-1 review, Finding 3: the legacy/unknown-value guarantee that
    // getTimezoneOptionsIncluding already provides (a stored zone absent from
    // the base list is prepended, not dropped) must survive the offset/label
    // rework — the value stays selectable and correctly selected even though
    // its label can't carry a real offset.
    it('still selects a legacy/unknown stored zone the base list omits', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const saved: NotificationPreferences = {
        habitReminders: { enabled: false, time: '20:00' },
        actionQueueReminders: { enabled: false, time: '08:00' },
        budgetAlerts: { enabled: true, threshold: 0 },
        streakWarnings: { enabled: false, time: '21:00' },
        billReminders: { enabled: false, daysBeforeDue: 1, time: '09:00' },
        timezone: 'Moon/Base_Alpha',
      };

      render(<NotificationSettings householdId="h1" currentPreferences={saved} onSave={onSave} />);

      const select = screen.getByRole('combobox', { name: 'Timezone' }) as HTMLSelectElement;
      expect(select).toHaveValue('Moon/Base_Alpha');
      expect(
        Array.from(select.options).filter((opt) => opt.value === 'Moon/Base_Alpha')
      ).toHaveLength(1);
    });

    // TZ-1 review, Finding 4: the status paragraph toggles with the select's
    // value but must be wired for assistive tech via aria-describedby, and
    // live-announced since it's not the result of a user-initiated focus move.
    it('wires the select to the status text via aria-describedby inside a live region', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<NotificationSettings householdId="h1" onSave={onSave} />);

      const select = screen.getByRole('combobox', { name: 'Timezone' });
      const describedById = select.getAttribute('aria-describedby');
      expect(describedById).toBeTruthy();

      const status = document.getElementById(describedById as string);
      expect(status).toHaveTextContent("Matches your device's detected zone.");
      expect(status?.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
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
