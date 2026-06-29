import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogHost } from './ConfirmDialogHost';
import { requestDeleteConfirmation } from './confirmDialogStore';

describe('ConfirmDialogHost', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is closed until a delete confirmation is requested', () => {
    render(<ConfirmDialogHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a centered confirm dialog naming the item when requested', async () => {
    render(<ConfirmDialogHost />);

    requestDeleteConfirmation({ onConfirm: vi.fn(), itemName: 'calendar item' });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Delete this calendar item?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('runs the callback and closes when confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmDialogHost />);

    requestDeleteConfirmation({ onConfirm, itemName: 'task' });
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not run the callback when cancelled', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialogHost />);

    requestDeleteConfirmation({ onConfirm, itemName: 'task' });
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
