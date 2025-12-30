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
    <div className="bg-brand-50 border-2 border-brand-200 rounded-xl p-4">
      <p className="text-xs font-bold text-brand-500 uppercase tracking-wider mb-2">
        Household Invite Code
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-2xl font-bold text-brand-800 tracking-wider">
          {inviteCode}
        </span>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 p-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 active:scale-95 transition-all duration-200"
          aria-label="Copy invite code"
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
        </button>
      </div>
      <p className="text-xs text-brand-500 mt-3">
        Share this code with family members to join your household
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
