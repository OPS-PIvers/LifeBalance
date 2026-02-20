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
    <div className="bg-white/60 backdrop-blur-sm rounded-xl p-5 ring-1 ring-black/5 shadow-sm transition-all hover:shadow-md hover:bg-white/70">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 text-center">
        Household Invite Code
      </p>
      <div className="flex items-center justify-between gap-4 bg-white/50 rounded-lg p-2 pr-3 ring-1 ring-black/5">
        <div className="flex-1 text-center">
          <span className="font-mono text-3xl font-bold text-slate-900 tracking-[0.2em] ml-2">
            {inviteCode}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-all active:scale-95"
          aria-label="Copy invite code"
          title="Copy to clipboard"
        >
          {copied ? <Check size={20} className="text-emerald-500" /> : <Copy size={20} />}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-4 text-center leading-relaxed">
        Share this code with family members to join your household
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
