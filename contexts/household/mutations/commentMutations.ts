import {
  doc,
  collection,
  writeBatch,
  getDocs,
  query,
  orderBy,
  increment,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { TransactionComment } from '@/types/schema';
import { transactionCommentConverter } from '@/utils/firestoreConverters';

// Plan 23 — Transaction comments. Comments are loaded ON DEMAND (a getDocs
// fetch when a transaction's detail view opens) — never via a standing
// listener, mirroring the existing getHabitSubmissions pattern
// (hooks/useHabitActions.tsx). The add/delete mutations co-commit the
// denormalized Transaction.commentCount bump in the SAME writeBatch as the
// comment doc write so the count can never drift from the actual doc count
// (CLAUDE.md Atomicity convention).
//
// NOTE: `households/{hid}/transactions/{txnId}/comments` has NO firestore.rules
// entry yet — see advisor-plans/23-transaction-comments-spike.md for the
// draft diff, which ships as its own human-watched PR. Until that PR
// deploys, every call here will reject with `permission-denied`; callers
// already surface that via a toast + rejected promise, so no code changes
// are needed once rules land.

const MAX_COMMENT_LENGTH = 500;

/**
 * getTransactionComments — one-shot fetch (NOT a listener), oldest-first so
 * a thread reads top-to-bottom like a conversation.
 */
export function makeGetTransactionComments(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const getTransactionComments = async (transactionId: string): Promise<TransactionComment[]> => {
    if (!householdId) return [];

    try {
      const commentsQuery = query(
        collection(db, `households/${householdId}/transactions/${transactionId}/comments`).withConverter(transactionCommentConverter),
        orderBy('createdAt', 'asc')
      );
      const snapshot = await getDocs(commentsQuery);
      return snapshot.docs.map(d => d.data());
    } catch (error) {
      console.error('[getTransactionComments] Failed:', error);
      return [];
    }
  };

  return { getTransactionComments };
}

/**
 * addTransactionComment — comment doc + Transaction.commentCount increment,
 * co-committed in one writeBatch (see module doc above).
 */
export function makeAddTransactionComment(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
}) {
  const { db, householdId, user } = deps;

  const addTransactionComment = async (transactionId: string, text: string): Promise<void> => {
    if (!householdId) return;
    if (!user) {
      toast.error('Not authenticated');
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Comment cannot be empty');
      return;
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      toast.error(`Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
      return;
    }

    try {
      const batch = writeBatch(db);
      const commentRef = doc(
        collection(db, `households/${householdId}/transactions/${transactionId}/comments`)
      );
      const comment: Omit<TransactionComment, 'id'> = {
        authorUid: user.uid,
        text: trimmed,
        // ISO timestamp (not serverTimestamp()) — the read model orders by
        // this field client-side immediately after the optimistic getDocs
        // re-fetch, and a pending serverTimestamp() sentinel would sort
        // incorrectly until the write settles. CLAUDE.md's
        // getLocalDateString() convention is for calendar-day strings
        // (yyyy-MM-dd); a comment needs a real instant, so use the Date ISO
        // string directly, same as addHabitSubmission's `timestamp` default.
        createdAt: new Date().toISOString(),
      };
      batch.set(commentRef, comment);
      batch.update(doc(db, `households/${householdId}/transactions`, transactionId), {
        commentCount: increment(1),
      });
      await batch.commit();
    } catch (error) {
      console.error('[addTransactionComment] Failed:', error);
      toast.error('Failed to add comment');
      throw error;
    }
  };

  return { addTransactionComment };
}

/**
 * deleteTransactionComment — author-only in the (future) rules; the client
 * does not enforce authorship itself (rules are the source of truth), it
 * just fires the batched delete + count decrement.
 */
export function makeDeleteTransactionComment(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const deleteTransactionComment = async (transactionId: string, commentId: string): Promise<void> => {
    if (!householdId) return;

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, `households/${householdId}/transactions/${transactionId}/comments`, commentId));
      batch.update(doc(db, `households/${householdId}/transactions`, transactionId), {
        commentCount: increment(-1),
      });
      await batch.commit();
    } catch (error) {
      console.error('[deleteTransactionComment] Failed:', error);
      toast.error('Failed to delete comment');
      throw error;
    }
  };

  return { deleteTransactionComment };
}

// Re-exported for callers that want the cap without duplicating the magic
// number (e.g. a composer's maxLength/character-counter).
export { MAX_COMMENT_LENGTH };
