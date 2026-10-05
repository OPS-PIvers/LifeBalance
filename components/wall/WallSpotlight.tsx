import React from 'react';

export type SpotlightTone = 'ok' | 'error' | 'alert' | 'brief';

interface WallSpotlightProps {
  tone: SpotlightTone;
  icon: React.ReactNode;
  /** Small caps line above the title, e.g. "Added to Shopping". */
  kicker: string;
  /** The words that matter, readable from across the room. */
  title: React.ReactNode;
  /** Anything under the title (a list, a detail line). */
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** Tapping outside the card. */
  onClose: () => void;
  label: string;
  /** Over the night screen: dimmer colors, above the black overlay. */
  night?: boolean;
}

/**
 * The wall's big centered card (docs/plans/wall-display-kiosk.md §12): voice
 * confirmations, starting-soon alerts and the day brief. Built to be read
 * from across the kitchen: a 64px title on a dimmed screen.
 */
const WallSpotlight: React.FC<WallSpotlightProps> = ({ tone, icon, kicker, title, children, actions, onClose, label, night = false }) => (
  <>
    <button type="button" className={night ? 'scrim spot-scrim night' : 'scrim spot-scrim'} aria-label="Close" onClick={onClose} />
    <section className={`spot ${tone}${night ? ' night' : ''}`} role={tone === 'alert' ? 'alertdialog' : 'status'} aria-label={label}>
      <div className="spot-orb" aria-hidden="true">
        {icon}
      </div>
      <div className="spot-k">{kicker}</div>
      <div className="spot-t">{title}</div>
      {children}
      {actions && <div className="spot-a">{actions}</div>}
    </section>
  </>
);

export default WallSpotlight;
