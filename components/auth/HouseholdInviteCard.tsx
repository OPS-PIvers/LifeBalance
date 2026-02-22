import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
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
    <div className="bg-slate-50/50 backdrop-blur-sm border border-slate-200/60 ring-1 ring-black/5 rounded-xl p-6 transition-all hover:bg-slate-50">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 text-center">
        Household Invite Code
      </p>
      <div className="flex items-center justify-between gap-4 bg-white/60 p-3 rounded-lg border border-slate-100 shadow-inner">
        <span className="font-mono text-3xl font-bold text-slate-900 tracking-[0.2em] flex-grow text-center">
          {inviteCode}
        </span>
        <Button
          onClick={handleCopy}
          variant="secondary"
          size="icon"
          className="flex-shrink-0 h-10 w-10 shadow-sm"
          aria-label="Copy invite code"
        >
          {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
        </Button>
      </div>
      <p className="text-xs text-slate-400 mt-4 text-center leading-relaxed">
        Share this code with family members so they can join your household.
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
