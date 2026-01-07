import React from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';

/**
 * Shows a confirmation toast for deleting a task/item
 * @param onConfirm - Callback to execute when user confirms deletion
 * @param itemName - Optional name of the item being deleted (defaults to "task")
 */
export const showDeleteConfirmation = (
  onConfirm: () => void | Promise<void>,
  itemName: string = 'task'
) => {
  toast.custom((t) => (
    <div className="bg-white shadow-lg rounded-lg p-4 border border-rose-100 max-w-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-rose-500">
          <Trash2 size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">
            Delete this {itemName}?
          </p>
          <p className="mt-1 text-xs text-gray-500">
            This action cannot be undone.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-500 rounded-md hover:bg-rose-600 transition-colors"
              onClick={async () => {
                try {
                  await onConfirm();
                  toast.dismiss(t.id);
                } catch (error) {
                  console.error('Failed to delete item:', error);
                  toast.dismiss(t.id);
                  toast.error(`Failed to delete ${itemName}. Please try again.`);
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  ));
};
