import { requestDeleteConfirmation } from '@/components/ui/confirmDialogStore';

/**
 * Shows a centered confirmation dialog for deleting a task/item.
 *
 * Delegates to the app-level {@link ConfirmDialogHost}, which renders the
 * standard centered `ConfirmDialog` (backdrop, focus trap, Escape handling)
 * rather than a top-of-screen toast — keeping destructive confirmations
 * visually consistent with the rest of the app and front-and-center for the
 * user. The imperative call signature is preserved for existing call sites.
 *
 * @param onConfirm - Callback to execute when user confirms deletion
 * @param itemName - Optional name of the item being deleted (defaults to "task")
 */
export const showDeleteConfirmation = (
  onConfirm: () => void | Promise<void>,
  itemName: string = 'task'
) => {
  requestDeleteConfirmation({ onConfirm, itemName });
};
