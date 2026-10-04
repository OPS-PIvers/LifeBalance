import React from 'react';
import type { WallToastState, WallToaster } from './wallToast';

interface WallToastProps {
  toast: WallToastState;
  toaster: WallToaster;
  onDismiss: () => void;
}

/** Dark toast at bottom center with an optional Undo (plan §3). */
const WallToast: React.FC<WallToastProps> = ({ toast, toaster, onDismiss }) => {
  const { undo } = toast;
  return (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {undo && (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            undo().catch(error => {
              console.error('[wall] undo failed:', error);
              toaster.show("Couldn't undo that.");
            });
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
};

export default WallToast;
