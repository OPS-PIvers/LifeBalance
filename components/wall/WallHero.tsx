import React from 'react';

interface WallHeroProps {
  big: React.ReactNode;
  top: React.ReactNode;
  bottom: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * The shared "hero + two sub-rows" unit (plan §3, top bar). The clock and the
 * weather both use it, so their sizes and spacing can't drift apart.
 */
const WallHero: React.FC<WallHeroProps> = ({ big, top, bottom, icon }) => (
  <span className="hero">
    {icon}
    <span className="big">{big}</span>
    <span className="sub">
      <span>{top}</span>
      <span>{bottom}</span>
    </span>
  </span>
);

export default WallHero;
