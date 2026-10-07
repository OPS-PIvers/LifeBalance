import React, { useRef } from 'react';
import { useWholeFill } from '@/components/wall/useWallFit';
import { useModuleScroll } from './moduleScroll';
import WallAutoScroll from './WallAutoScroll';

const WholeFill: React.FC<{ children: React.ReactNode; onCut: (cut: boolean) => void }> = ({ children, onCut }) => {
  const ref = useRef<HTMLDivElement>(null);
  useWholeFill(ref, onCut);
  return (
    <div className="fill" ref={ref}>
      {children}
    </div>
  );
};

/**
 * A module that shows whole items (Coming up's days, Dinners' nights): as
 * many as fit while its auto scroll is stopped, or all of them, turning like
 * the lists do, once it's started. `children` are the items themselves.
 */
const WallModuleFill: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { on, onOverflow } = useModuleScroll();
  return on ? <WallAutoScroll>{children}</WallAutoScroll> : <WholeFill onCut={onOverflow}>{children}</WholeFill>;
};

export default WallModuleFill;
