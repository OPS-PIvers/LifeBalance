import React from 'react';

export interface UndoToastProps {
  /** e.g. `Deleted "Oat milk"` or `To-Do completed` — the toast body text. */
  message: string;
  onUndo: () => void;
}

/**
 * Shared toast body for a destructive/irreversible-feeling action + an Undo
 * action. react-hot-toast has no built-in action slot, so this renders
 * inside `toast((t) => ...)`. Originated as `DeleteUndoToast` in
 * ShoppingListTab.tsx (PR #898); generalized here (F-TODO-11) so other
 * destructive events (todo completion, etc.) can reuse the same pattern.
 *
 * Toasts always sit on the dark brand-800 surface (Toaster config in
 * App.tsx), so light-tint text is correct in both themes — no dark: pair
 * needed here.
 */
export const UndoToast: React.FC<UndoToastProps> = ({ message, onUndo }) => (
  <div className="flex min-w-0 items-center gap-2">
    {/* min-w-0 + truncate keep a long message from pushing Undo off-screen */}
    <span className="min-w-0 flex-1 truncate text-sm" title={message}>{message}</span>
    {/* -my-3 lets the 44px hit area overhang the toast padding without growing it */}
    <button
      type="button"
      onClick={onUndo}
      className="-my-3 min-h-[44px] min-w-[44px] shrink-0 px-3 text-sm font-semibold text-accent-300 hover:text-accent-200 focus:outline-hidden focus:underline"
    >
      Undo
    </button>
  </div>
);
