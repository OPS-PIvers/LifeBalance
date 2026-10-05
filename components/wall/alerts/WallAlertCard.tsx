import React from 'react';
import { Bell, Bike, Car, Footprints, TrainFront } from 'lucide-react';
import type { WallTravelMode } from '@/types/schema';
import type { AlertWords, WallAlert } from '@/utils/wall/wallAlerts';
import WallSpotlight from '@/components/wall/WallSpotlight';

const MODE_ICON: Record<WallTravelMode, typeof Car> = { drive: Car, walk: Footprints, bike: Bike, transit: TrainFront };

interface WallAlertCardProps {
  alert: WallAlert;
  words: AlertWords;
  /** During the night window: dimmed, above the night screen (and silent). */
  night: boolean;
  onClose: () => void;
}

/** A starting-soon alert (plan §12): big enough to read from across the room. */
const WallAlertCard: React.FC<WallAlertCardProps> = ({ alert, words, night, onClose }) => {
  const Icon = alert.kind === 'soon' ? Bell : MODE_ICON[alert.mode];
  return (
    <WallSpotlight
      tone="alert"
      night={night}
      icon={<Icon className="wi" size="1em" />}
      kicker={words.kicker}
      title={words.title}
      label={`${words.kicker}: ${words.title}`}
      onClose={onClose}
      actions={
        <button type="button" className="btn pri" onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="spot-d">{words.detail}</div>
      {words.leaveBy && <div className="spot-lb">{words.leaveBy}</div>}
    </WallSpotlight>
  );
};

export default WallAlertCard;
