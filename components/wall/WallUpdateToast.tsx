import React, { useState } from 'react';

interface WallUpdateToastProps {
  /** Resolves false when the wall couldn't save its queued changes (offline). */
  onUpdate: () => Promise<boolean>;
  onLater: () => void;
}

/**
 * The wall's "update available" prompt, the phone's confirm() in the toast
 * slot. It stays until someone answers, since nobody may be looking when the
 * deploy lands; at night the wall updates on its own (useWallRuntime).
 */
const WallUpdateToast: React.FC<WallUpdateToastProps> = ({ onUpdate, onLater }) => {
  const [state, setState] = useState<'ask' | 'saving' | 'offline'>('ask');
  const text =
    state === 'saving'
      ? 'Updating…'
      : state === 'offline'
        ? "Can't update until the wall is back online."
        : 'An update is available.';
  return (
    <div className="toast update" role="status">
      <span>{text}</span>
      {state !== 'saving' && (
        <>
          <button type="button" className="later" onClick={onLater}>
            Later
          </button>
          <button
            type="button"
            onClick={() => {
              setState('saving');
              void onUpdate().then(ok => {
                if (!ok) setState('offline');
              });
            }}
          >
            {state === 'offline' ? 'Try again' : 'Update'}
          </button>
        </>
      )}
    </div>
  );
};

export default WallUpdateToast;
