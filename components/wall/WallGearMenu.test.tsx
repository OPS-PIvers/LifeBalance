import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { hashKidPin } from '@/utils/kidPin';
import WallGearMenu from './WallGearMenu';

const props = { title: 'Kitchen iPad', isDisplay: true, onClose: vi.fn(), onReload: vi.fn(), onUnpair: vi.fn(), onSyncCalendars: vi.fn(async () => ({ failed: 0 })), rotating: false, rotationIntervalSec: 60, onToggleRotation: vi.fn() };

function typePin(pin: string) {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }));
}

describe('WallGearMenu', () => {
  it('opens straight to the menu when no PIN is set', () => {
    render(<WallGearMenu {...props} />);
    expect(screen.getByRole('button', { name: /Unpair this iPad/ })).toBeInTheDocument();
    expect(screen.getByText(/Set a family PIN/)).toBeInTheDocument();
  });

  it('unlocks with the right PIN and rejects a wrong one', async () => {
    const pinHash = await hashKidPin('2468');
    render(<WallGearMenu {...props} pinHash={pinHash} />);
    expect(screen.getByText('Enter family PIN')).toBeInTheDocument();

    typePin('135791');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("That's not the PIN."));
    expect(screen.queryByRole('button', { name: /Unpair/ })).not.toBeInTheDocument();

    typePin('2468');
    await waitFor(() => expect(screen.getByRole('button', { name: /Unpair this iPad/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Unpair this iPad/ }));
    expect(props.onUnpair).toHaveBeenCalled();
  });

  it('says "Leave the wall" for a member preview', () => {
    render(<WallGearMenu {...props} isDisplay={false} />);
    expect(screen.getByRole('button', { name: /Leave the wall/ })).toBeInTheDocument();
  });

  it('syncs calendars and reports the outcome in place', async () => {
    const onSyncCalendars = vi
      .fn<() => Promise<{ failed: number }>>()
      .mockResolvedValueOnce({ failed: 1 })
      .mockRejectedValueOnce(new Error('Calendars synced a moment ago. Try again in a couple of minutes.'));
    render(<WallGearMenu {...props} onSyncCalendars={onSyncCalendars} />);
    fireEvent.click(screen.getByRole('button', { name: /Sync calendars now/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("1 calendar couldn't be read"));
    fireEvent.click(screen.getByRole('button', { name: /Sync calendars now/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('synced a moment ago'));
  });

  it('starts and stops the panel rotation', () => {
    const { rerender } = render(<WallGearMenu {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Start rotating the panel.*Every 1 min/ }));
    expect(props.onToggleRotation).toHaveBeenCalled();
    rerender(<WallGearMenu {...props} rotating />);
    expect(screen.getByRole('button', { name: /Stop rotating the panel/ })).toBeInTheDocument();
  });
});
