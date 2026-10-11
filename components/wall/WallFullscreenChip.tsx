import React from 'react';
import { Maximize } from 'lucide-react';

/**
 * Shown on a paired wall in a Safari tab whenever it isn't full screen: after
 * a reload, and after iPadOS's swipe-down took it out. One tap goes back; the
 * display menu's button is still there to leave on purpose.
 */
const WallFullscreenChip: React.FC<{ onTap: () => void }> = ({ onTap }) => (
  <button type="button" className="fschip" onClick={onTap}>
    <Maximize className="wi" size="1em" strokeWidth={2} aria-hidden="true" />
    Full screen
  </button>
);

export default WallFullscreenChip;
