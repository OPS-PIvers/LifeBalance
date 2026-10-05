import React from 'react';
import { VolumeX } from 'lucide-react';

/**
 * Shown while iPadOS has the wall's audio locked (after a launch or a
 * reload). Any touch unlocks it; this just says so, so sound is never
 * silently off.
 */
const WallSoundChip: React.FC = () => (
  <button type="button" className="sndchip">
    <VolumeX className="wi" size="1em" aria-hidden="true" />
    Tap to turn on sound
  </button>
);

export default WallSoundChip;
