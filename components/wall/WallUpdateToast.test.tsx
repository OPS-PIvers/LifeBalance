import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WallUpdateToast from './WallUpdateToast';

describe('WallUpdateToast', () => {
  it('offers the update and hands Later to the parent', () => {
    const onLater = vi.fn();
    render(<WallUpdateToast onUpdate={vi.fn(async () => true)} onLater={onLater} />);
    expect(screen.getByRole('status')).toHaveTextContent('An update is available.');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('says so when it can not update offline, and lets you try again', async () => {
    const onUpdate = vi.fn(async () => false);
    render(<WallUpdateToast onUpdate={onUpdate} onLater={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Can't update until the wall is back online."));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('hides its buttons while the update is saving', () => {
    render(<WallUpdateToast onUpdate={() => new Promise<boolean>(() => undefined)} onLater={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByRole('status')).toHaveTextContent('Updating…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
