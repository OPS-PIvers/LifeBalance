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
    <div className="bg-slate-50/50 border border-slate-200/60 rounded-2xl p-5 ring-1 ring-black/5 shadow-sm">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
        Household Invite Code
      </p>
      <div className="flex items-center justify-between gap-3 bg-white border border-slate-200/60 rounded-xl p-3 shadow-sm">
        <span className="font-mono text-2xl font-bold text-slate-900 tracking-widest pl-2">
          {inviteCode}
        </span>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-2.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 hover:text-slate-900 active:scale-95 transition-all duration-200"
          aria-label="Copy invite code"
        >
          {copied ? <Check size={20} className="text-emerald-600" /> : <Copy size={20} />}
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-3 font-medium leading-relaxed">
        Share this code with family members so they can join your household.
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
