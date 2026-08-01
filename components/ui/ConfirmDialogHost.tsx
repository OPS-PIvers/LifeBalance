import React, { useEffect, useRef, useState } from 'react';
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
  // Ref guard against concurrent confirms: the Button is disabled via
  // `isConfirming` once it re-renders, but a fast double-click within the same
  // frame would otherwise re-enter handleConfirm before that state lands (both
  // closures read the stale `false`). A ref updates synchronously and closes
  // that one-frame gap.
  const confirmingRef = useRef(false);

  useEffect(() => subscribeToDeleteConfirmations((next) => {
    setRequest(next);
    setIsConfirming(false);
    confirmingRef.current = false;
  }), []);

  const handleClose = () => {
    if (isConfirming) return;
    setRequest(null);
  };

  const handleConfirm = async () => {
    if (!request || confirmingRef.current) return;
    confirmingRef.current = true;
    setIsConfirming(true);
    try {
      await request.onConfirm();
      setRequest(null);
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error(`Failed to delete ${request.itemName}. Please try again.`);
      setRequest(null);
    } finally {
      confirmingRef.current = false;
      setIsConfirming(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen={request !== null}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={request?.title ?? `Delete this ${request?.itemName ?? 'item'}?`}
      message={request?.message ?? 'This action cannot be undone.'}
      confirmLabel={request?.confirmLabel ?? 'Delete'}
      isConfirming={isConfirming}
    />
  );
};
