import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildInviteUrl } from '@/utils/inviteLink';
import { Button } from '@/components/ui/Button';

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

  // Copy the shareable link to the clipboard, falling back to surfacing the
  // raw URL in a toast when the Clipboard API is unavailable.
  const copyInviteLink = async (url: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Invite link copied');
        return;
      } catch {
        // Fall through to surfacing the URL directly.
      }
    }
    toast(url, { duration: 8000 });
  };

  const handleShareLink = async () => {
    const url = buildInviteUrl(inviteCode);

    // Prefer the native share sheet (mobile) when available.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Join my LifeBalance household',
          text: 'Use this link to join my household on LifeBalance.',
          url,
        });
        return;
      } catch (error) {
        // User dismissing the share sheet is not an error worth surfacing.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        // Any other failure: fall back to copying the link.
      }
    }

    await copyInviteLink(url);
  };

  return (
    <div className="bg-warm-50 dark:bg-warm-500/10 border border-warm-200 dark:border-warm-500/30 rounded-card p-4">
      <p className="font-display text-xs font-semibold text-warm-700 dark:text-warm-200 uppercase tracking-wider mb-2">
        Household invite code
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-2xl font-bold tabular-nums text-brand-800 dark:text-brand-100 tracking-wider">
          {inviteCode}
        </span>
        <Button
          variant="primary"
          size="icon"
          className="shrink-0 p-2.5"
          onClick={handleCopy}
          aria-label="Copy invite code"
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
        </Button>
      </div>

      <Button
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        onClick={handleShareLink}
        leftIcon={<Share2 size={18} />}
      >
        <span>Share invite link</span>
      </Button>

      <p className="text-xs text-brand-500 dark:text-brand-400 mt-3">
        Share the link for one-tap joining, or give family members the code to enter manually
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
