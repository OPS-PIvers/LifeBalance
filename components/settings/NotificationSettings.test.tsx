import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationSettings from './NotificationSettings';

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
