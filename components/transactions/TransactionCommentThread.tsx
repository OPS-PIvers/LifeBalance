import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MessageSquare, Send, Trash2, Loader2 } from 'lucide-react';
import { formatDistanceToNowStrict, parseISO, isValid } from 'date-fns';
import type { TransactionComment } from '@/types/schema';
import { useFinance, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { MAX_COMMENT_LENGTH } from '@/contexts/household/mutations/commentMutations';

/** Relative "time ago" for an ISO timestamp, with a safe fallback. */
const timeAgo = (iso: string): string => {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true });
};

export interface TransactionCommentThreadProps {
  transactionId: string;
  /** Only fetch/render while the host drawer is actually open — avoids a
   *  wasted getDocs call and stale state carried across different transactions. */
  isOpen: boolean;
}

/**
 * Plan 23 — the comment thread section rendered inside `EditTransactionModal`.
 * Comments are loaded ON DEMAND on open (a one-shot `getTransactionComments`
 * fetch), never via a standing listener. Until the (separate, human-watched)
 * firestore.rules PR ships, every call here rejects with `permission-denied`
 * in production — that's an expected, caught-and-toasted failure, not a bug;
 * Test Mode (`MockHouseholdContext`) implements this fully in-memory so the
 * feature is visually verifiable today.
 */
export const TransactionCommentThread: React.FC<TransactionCommentThreadProps> = ({ transactionId, isOpen }) => {
  const { getTransactionComments, addTransactionComment, deleteTransactionComment } = useFinance();
  const { members, currentUser } = useHouseholdCore();

  const [comments, setComments] = useState<TransactionComment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Monotonic request id: EditTransactionModal stays mounted and swaps its
  // `transaction` prop, so a slow fetch for transaction A could resolve after
  // the user has switched to B. Each load claims a new id and only the latest
  // is allowed to write state — stale responses are dropped.
  const latestRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequestRef.current;
    setIsLoading(true);
    setComments([]);
    try {
      const fetched = await getTransactionComments(transactionId);
      if (latestRequestRef.current !== requestId) return;
      setComments(fetched);
    } finally {
      if (latestRequestRef.current === requestId) setIsLoading(false);
    }
  }, [getTransactionComments, transactionId]);

  // Fetch once per (open, transactionId) pair — not a listener. Re-fetches if
  // the drawer is reopened on a different transaction.
  useEffect(() => {
    if (!isOpen || !transactionId) return;
    // load() is an async Firestore fetch that synchronously flips the loading
    // flag (and clears stale comments) before awaiting — legitimate external-
    // system synchronization (re-fetched whenever the drawer opens for a
    // transaction), not derivable state; deferring it would flash the PREVIOUS
    // transaction's comments before the spinner. load is also invoked from
    // the post/delete handlers, so it must remain a callable that owns its
    // loading state. Mirrors HabitSubmissionLogModal's identical pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load-on-open; see comment above
    load();
  }, [isOpen, transactionId, load]);

  const nameFor = (uid: string) =>
    members.find((m) => m.uid === uid)?.displayName ?? 'Someone';

  const handlePost = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isPosting) return;
    setIsPosting(true);
    try {
      await addTransactionComment(transactionId, trimmed);
      setDraft('');
      await load();
    } catch {
      // addTransactionComment already toasts the failure (e.g. permission-denied
      // pre-rules-deploy); nothing further to do here.
    } finally {
      setIsPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (deletingId) return;
    setDeletingId(commentId);
    try {
      await deleteTransactionComment(transactionId, commentId);
      await load();
    } catch {
      // deleteTransactionComment already toasts the failure.
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-200">
        <MessageSquare size={14} />
        Comments
      </h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-4 text-brand-400 dark:text-brand-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        // dark:brand-450 on the metadata texts here: brand-500 on the brand-800
        // card is 3.56:1; brand-450 is 4.95:1 (small text needs 4.5).
        <p className="text-xs text-brand-400 dark:text-brand-450">
          No comments yet. Add one if you want to flag or explain this transaction.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 group">
              <div className="min-w-0">
                <p className="text-sm text-brand-800 dark:text-brand-100 break-words">{c.text}</p>
                <p className="text-[11px] text-brand-400 dark:text-brand-450 mt-0.5">
                  {nameFor(c.authorUid)} · {timeAgo(c.createdAt)}
                </p>
              </div>
              {currentUser?.uid === c.authorUid && (
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                  aria-label="Delete comment"
                  className="shrink-0 p-1 rounded-btn text-brand-300 hover:text-money-neg hover:bg-money-bgNeg dark:text-brand-500 dark:hover:text-money-negDark opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-50"
                >
                  {deletingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="transaction-comment-draft"
            aria-label="Add a comment"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handlePost();
              }
            }}
            placeholder="Add a comment…"
            disabled={isPosting}
            maxLength={MAX_COMMENT_LENGTH}
          />
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={handlePost}
          disabled={isPosting || !draft.trim()}
          aria-label="Post comment"
        >
          {isPosting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
};

export default TransactionCommentThread;
