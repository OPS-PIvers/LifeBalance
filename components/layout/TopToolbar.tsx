
import React, { useState } from 'react';
import { Star, Settings, TrendingUp } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { useNavigate } from 'react-router-dom';
import RewardsModal from '../modals/RewardsModal';
import SafeToSpendModal from '../modals/SafeToSpendModal';

const TopToolbar: React.FC = () => {
  const { safeToSpend, dailyPoints, weeklyPoints } = useHousehold();
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

        {/* Right Container: Points Cluster + Settings */}
        <div className="flex items-center gap-3">
          {/* Points Container - Clickable to open Rewards Modal */}
          <div
            className="flex items-center gap-4 cursor-pointer active:opacity-80 transition-opacity"
            onClick={() => setIsRewardsOpen(true)}
          >
            {/* Daily Points (Gold Star) */}
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1">
                <span className="text-2xl font-bold text-habit-gold tabular-nums">
                  +{dailyPoints}
                </span>
                <Star className="w-5 h-5 fill-habit-gold text-habit-gold" />
              </div>
              <span className="text-[10px] text-brand-400 uppercase tracking-wider">Today</span>
            </div>

            {/* Vertical Divider */}
            <div className="h-10 w-px bg-brand-600"></div>

            {/* Weekly Points (Blue TrendingUp) */}
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1">
                <span className="text-2xl font-bold text-habit-blue tabular-nums">
                  +{weeklyPoints}
                </span>
                <TrendingUp className="w-5 h-5 text-habit-blue" />
              </div>
              <span className="text-[10px] text-brand-400 uppercase tracking-wider">This Week</span>
            </div>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 hover:bg-brand-700 rounded-lg active:scale-95 transition-all duration-200"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-brand-300" />
          </button>
        </div>
      </header>

      <RewardsModal isOpen={isRewardsOpen} onClose={() => setIsRewardsOpen(false)} />
      <SafeToSpendModal isOpen={isSafeSpendOpen} onClose={() => setIsSafeSpendOpen(false)} />
    </>
  );
};

export default TopToolbar;
