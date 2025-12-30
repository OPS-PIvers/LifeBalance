import React from 'react';
import { X, Lock } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

interface RewardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RewardsModal: React.FC<RewardsModalProps> = ({ isOpen, onClose }) => {
  const { rewardsInventory, currentUser, redeemReward } = useHousehold();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-brand-50 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-brand-800 text-white">
          <div>
            <h2 className="text-xl font-bold">Rewards Store</h2>
            <p className="text-xs text-brand-300">Balance: {currentUser.points.total} pts</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-2 gap-4">
          {rewardsInventory.map(reward => {
            const canAfford = currentUser.points.total >= reward.cost;

            return (
              <div 
                key={reward.id}
                className={`flex flex-col p-4 bg-white rounded-xl border border-brand-100 shadow-sm transition-all ${
                  !canAfford ? 'opacity-60 grayscale-[0.5]' : 'hover:border-habit-gold/50'
                }`}
              >
                <div className="text-4xl mb-3 self-center">{reward.icon}</div>
                <h3 className="font-bold text-brand-800 text-sm text-center mb-1">{reward.title}</h3>
                <p className="text-xs font-bold text-habit-gold text-center mb-4">{reward.cost} pts</p>
                
                <button
                  onClick={() => {
                    if (canAfford) redeemReward(reward.id);
                  }}
                  disabled={!canAfford}
                  className={`mt-auto py-2 rounded-lg text-xs font-bold transition-transform active:scale-95 ${
                    canAfford 
                      ? 'bg-brand-800 text-white shadow-md hover:bg-brand-700' 
                      : 'bg-brand-100 text-brand-400 cursor-not-allowed'
                  }`}
                >
                  {canAfford ? 'Redeem' : 'Locked'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default RewardsModal;