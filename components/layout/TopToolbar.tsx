
import React, { useState, useRef } from 'react';
import { Star, TrendingUp, User, AlertCircle } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { useAuth } from '../../contexts/AuthContext';
import RewardsModal from '../modals/RewardsModal';
import SafeToSpendModal from '../modals/SafeToSpendModal';
import FeedbackModal from '../modals/FeedbackModal';
import ProfileMenu from './ProfileMenu';

const TopToolbar: React.FC = () => {
  const { safeToSpend, dailyPoints, weeklyPoints } = useHousehold();
  const { currentUser } = useAuth();
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);
  const [isSafeSpendOpen, setIsSafeSpendOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  const isPositive = safeToSpend >= 0;

  return (
    <>
      <div className="relative">
        <header className="z-40 w-full bg-brand-800 shadow-md px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 flex items-center justify-between text-white">
          {/* Left Container: Safe-to-Spend */}
          <button
            type="button"
            aria-label="View Safe to Spend details"
            className="flex flex-col text-left cursor-pointer active:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:rounded-lg"
            onClick={() => setIsSafeSpendOpen(true)}
          >
            <span
              className={`text-2xl font-mono font-bold tabular-nums ${isPositive ? 'text-money-pos' : 'text-money-neg'}`}
            >
              ${Math.abs(safeToSpend).toFixed(2)}
            </span>
            <span className="text-[10px] text-brand-400 uppercase tracking-wider font-bold leading-tight">
              Safe to Spend
            </span>
          </button>

          {/* Right Container: Points Cluster + Profile */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsFeedbackOpen(true)}
              className="p-1.5 text-brand-300 hover:text-white hover:bg-brand-700 rounded-full transition-colors"
              aria-label="Send Feedback"
            >
              <AlertCircle size={18} />
            </button>

            {/* Points Container - Clickable to open Rewards Modal */}
            <button
              type="button"
              aria-label="View Rewards and Points breakdown"
              className="flex items-center gap-2 sm:gap-4 cursor-pointer active:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:rounded-lg"
              onClick={() => setIsRewardsOpen(true)}
            >
              {/* Daily Points (Gold Star) */}
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1">
                  <span className="text-xl font-bold text-habit-gold tabular-nums">
                    +{dailyPoints}
                  </span>
                  <Star className="w-4 h-4 fill-habit-gold text-habit-gold" />
                </div>
                <span className="text-[9px] text-brand-400 uppercase tracking-wider">Today</span>
              </div>

              {/* Vertical Divider */}
              <div className="h-8 w-px bg-brand-600"></div>

              {/* Weekly Points (Blue TrendingUp) */}
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1">
                  <span className="text-xl font-bold text-habit-blue tabular-nums">
                    +{weeklyPoints}
                  </span>
                  <TrendingUp className="w-4 h-4 text-habit-blue" />
                </div>
                <span className="text-[9px] text-brand-400 uppercase tracking-wider">Week</span>
              </div>
            </button>

            {/* Profile Icon */}
            <button
              ref={profileButtonRef}
              type="button"
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="ml-1 w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center text-brand-200 border border-brand-600 active:bg-brand-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label="Open Profile Menu"
              aria-expanded={isProfileOpen}
              aria-haspopup="menu"
            >
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt={currentUser.displayName ? `${currentUser.displayName}'s profile picture` : 'Profile picture'} className="w-full h-full rounded-full object-cover" />
              ) : currentUser?.displayName ? (
                <span className="font-bold text-sm">
                  {currentUser.displayName.charAt(0)}
                </span>
              ) : (
                <User className="w-5 h-5" />
              )}
            </button>
          </div>
        </header>

        <ProfileMenu isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} anchorRef={profileButtonRef} />
      </div>

      <RewardsModal isOpen={isRewardsOpen} onClose={() => setIsRewardsOpen(false)} />
      <SafeToSpendModal isOpen={isSafeSpendOpen} onClose={() => setIsSafeSpendOpen(false)} />
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </>
  );
};

export default TopToolbar;
