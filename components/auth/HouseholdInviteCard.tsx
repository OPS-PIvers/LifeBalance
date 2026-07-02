import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildInviteUrl } from '@/utils/inviteLink';
import { Button } from '@/components/ui/Button';
import { SurfaceList, Row, DisclosureRow } from '@/components/ui/Section';

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
    <div className="space-y-2">
      <SurfaceList>
        <Row>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">
              Invite code
            </p>
            <span className="font-mono text-2xl font-bold tabular-nums text-brand-800 dark:text-brand-100 tracking-wider">
              {inviteCode}
            </span>
          </div>
          <Button
            variant="subtle"
            size="icon"
            className="shrink-0"
            onClick={handleCopy}
            aria-label="Copy invite code"
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </Button>
        </Row>

        <DisclosureRow
          icon={
            <div className="w-10 h-10 rounded-full bg-accent-50 dark:bg-accent-500/15 flex items-center justify-center shrink-0">
              <Share2 size={18} className="text-accent-600 dark:text-accent-300" />
            </div>
          }
          title="Share invite link"
          subtitle="One-tap joining for family members"
          onClick={handleShareLink}
        />
      </SurfaceList>

      <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
        Share the link for one-tap joining, or give family members the code to enter manually.
      </p>
    </div>
  );
};

export default HouseholdInviteCard;
