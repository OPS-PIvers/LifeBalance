import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from './ConfirmDialog';
import {
  DeleteConfirmRequest,
  subscribeToDeleteConfirmations,
} from './confirmDialogStore';

/**
 * Single, app-level host that renders the active delete confirmation using the
 * app's standard centered {@link ConfirmDialog} (built on the `Modal`
 * primitive: backdrop, focus trap, Escape handling, scroll lock).
 *
 * This replaces the previous top-of-screen `react-hot-toast` confirmation so
 * destructive confirmations are visually congruent with the rest of the app
 * and demand the user's full attention. Driven imperatively via
 * {@link requestDeleteConfirmation} (see `utils/toastHelpers`), which keeps the
 * ergonomics of a single function call at the call sites.
 *
 * Mount exactly once near the root (see App.tsx). The dialog portals to
 * `document.body`, so its position in the tree is not significant.
 */
export const ConfirmDialogHost: React.FC = () => {
  const [request, setRequest] = useState<DeleteConfirmRequest | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => subscribeToDeleteConfirmations((next) => {
    setRequest(next);
    setIsConfirming(false);
  }), []);

  const handleClose = () => {
    if (isConfirming) return;
    setRequest(null);
  };

  const handleConfirm = async () => {
    if (!request) return;
    setIsConfirming(true);
    try {
      await request.onConfirm();
      setRequest(null);
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error(`Failed to delete ${request.itemName}. Please try again.`);
      setRequest(null);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen={request !== null}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={`Delete this ${request?.itemName ?? 'item'}?`}
      message="This action cannot be undone."
      confirmLabel="Delete"
      isConfirming={isConfirming}
    />
  );
};
