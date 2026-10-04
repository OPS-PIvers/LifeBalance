import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { hashKidPin } from '@/utils/kidPin';
import WallGearMenu from './WallGearMenu';

const props = { title: 'Kitchen iPad', isDisplay: true, onClose: vi.fn(), onReload: vi.fn(), onUnpair: vi.fn() };

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
});
