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
 * @param itemName - Noun for the thing being deleted, e.g. "transaction",
 *   "shopping item", "calendar item". It is interpolated into both the dialog
 *   title (`Delete this {itemName}?`) and the host's failure toast, so it must
 *   read as a singular noun. **Required on purpose:** this used to default to
 *   "task", which meant every caller that deleted something else — a
 *   transaction, a shopping item — silently asked "Delete this task?" over the
 *   wrong noun. Making it required means a new call site cannot inherit that
 *   mistake; it has to name what it deletes.
 */
export const showDeleteConfirmation = (
  onConfirm: () => void | Promise<void>,
  itemName: string
) => {
  requestDeleteConfirmation({ onConfirm, itemName });
};
