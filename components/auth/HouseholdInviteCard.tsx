import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  inviteCode: string;
}

const HouseholdInviteCard: React.FC<Props> = ({ inviteCode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    toast.success('Invite code copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white/50 backdrop-blur-sm border border-slate-200/60 rounded-2xl p-6 shadow-sm">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
        Household Invite Code
      </p>
      <div className="flex items-center justify-between gap-4 bg-white/80 border border-slate-200/50 rounded-xl p-3 pl-4 shadow-inner">
        <span className="font-mono text-xl font-bold text-slate-900 tracking-[0.2em] select-all">
          {inviteCode}
        </span>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-2.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg active:scale-95 transition-all duration-200 group"
          aria-label="Copy invite code"
        >
          {copied ? (
            <Check size={18} className="text-emerald-500" />
          ) : (
            <Copy size={18} className="group-hover:scale-110 transition-transform" />
          )}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-4 leading-relaxed">
        Share this code with family members to join your household
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
