import {
  doc,
  updateDoc,
  arrayUnion,
  type Firestore,
} from 'firebase/firestore';
import { NotificationLogEntry } from '@/types/schema';

/**
 * F-NOTIF-02 (in-app notification inbox) — mark-read mutations for the
 * notification log. Entries are server-written (Admin SDK) so the only client
 * write path is appending the current member's uid to `readBy`. See the
 * flat-subcollection note on `NotificationLogEntry` for why this lives at
 * `households/{id}/notificationLog/{id}` rather than nested under the member
 * doc, and CLAUDE.md / the PR description for the follow-up rule-tightening
 * this implies (today it relies on the generic member-write catch-all rule).
 */
export function makeNotificationMutations(deps: {
  db: Firestore;
  householdId: string | null;
  currentUserUid: string | null;
  /** The provider's already-filtered (current member's own), newest-first list. */
  notificationLog: NotificationLogEntry[];
}) {
  const { db, householdId, currentUserUid, notificationLog } = deps;

  const markNotificationRead = async (entryId: string): Promise<void> => {
    if (!householdId || !currentUserUid) return;
    await updateDoc(doc(db, `households/${householdId}/notificationLog/${entryId}`), {
      readBy: arrayUnion(currentUserUid),
    });
  };

  const markAllNotificationsRead = async (): Promise<void> => {
    if (!householdId || !currentUserUid) return;
    const unread = notificationLog.filter((entry) => !entry.readBy.includes(currentUserUid));
    await Promise.all(
      unread.map((entry) =>
        updateDoc(doc(db, `households/${householdId}/notificationLog/${entry.id}`), {
          readBy: arrayUnion(currentUserUid),
        })
      )
    );
  };

  return { markNotificationRead, markAllNotificationsRead };
}
