
import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { useNavigate } from 'react-router-dom';
import RewardsModal from '../modals/RewardsModal';
import SafeToSpendModal from '../modals/SafeToSpendModal';

const TopToolbar: React.FC = () => {
  const { safeToSpend, dailyPoints, weeklyPoints, totalPoints } = useHousehold();
  const navigate = useNavigate();
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);
  const [isSafeSpendOpen, setIsSafeSpendOpen] = useState(false);

  const isPositive = safeToSpend >= 0;

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-brand-800 shadow-md px-4 py-3 flex items-center justify-between text-white">
        {/* Left Container: Safe-to-Spend */}
        <div 
          className="flex flex-col cursor-pointer active:opacity-80 transition-opacity"
          onClick={() => setIsSafeSpendOpen(true)}
        >
          <span className="text-[10px] text-brand-400 uppercase tracking-wider font-bold leading-tight">
            Safe to Spend
          </span>
          <span 
            className={`text-2xl font-mono font-bold tabular-nums ${isPositive ? 'text-money-pos' : 'text-money-neg'}`}
          >
            ${Math.abs(safeToSpend).toFixed(2)}
          </span>
        </div>

        {/* Right Container: Points Cluster */}
        <div 
          className="flex items-center gap-3 cursor-pointer active:opacity-80 transition-opacity"
          onClick={() => setIsRewardsOpen(true)}
        >
          {/* Primary Stat (Daily) */}
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
              <span className="text-2xl font-bold text-habit-gold tabular-nums">
                +{dailyPoints}
              </span>
              <Star className="w-4 h-4 fill-habit-gold text-habit-gold" />
            </div>
            <span className="text-[10px] text-brand-400">Today</span>
          </div>

          {/* Vertical Divider */}
          <div className="h-8 w-px bg-brand-600"></div>

          {/* Secondary Stats */}
          <div className="flex flex-col items-end text-xs">
            <div>
              <span className="font-bold text-white tabular-nums">{weeklyPoints}</span>
              <span className="text-brand-300 ml-1">Wk</span>
            </div>
            <div>
              <span className="font-bold text-white tabular-nums">{totalPoints}</span>
              <span className="text-brand-300 ml-1">Tot</span>
            </div>
          </div>
        </div>
      </header>

      <RewardsModal isOpen={isRewardsOpen} onClose={() => setIsRewardsOpen(false)} />
      <SafeToSpendModal isOpen={isSafeSpendOpen} onClose={() => setIsSafeSpendOpen(false)} />
    </>
  );
};

export default TopToolbar;
