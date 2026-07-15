import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

/**
 * Unified trash purge (F-XCUT-03).
 *
 * Soft-deleted records are mirrored into each household's `trash` subcollection
 * with a `deletedAt` server timestamp. This scheduled job runs daily and
 * permanently removes any trash doc older than the retention window, matching
 * the client-side "Recently Deleted" 30-day promise.
 *
 * Uses a collectionGroup query over `trash` so it scales across all households
 * without enumerating them. Deletes are chunked into batches (Firestore caps a
 * writeBatch at 500 ops).
 *
 * NOTE: the collectionGroup query needs a single-field index on
 * `trash`/`deletedAt` (collection-group scope). Document this in the trash
 * firestore.rules / indexes PR; the job fails-soft (logs + returns) if the index
 * is missing rather than throwing.
 */

/** Keep soft-deleted records recoverable for this many days, then purge. */
export const TRASH_RETENTION_DAYS = 30;

const BATCH_LIMIT = 400;

export const purgetrash = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  let purged = 0;
  try {
    // Page through expired trash docs across every household, re-querying each
    // pass because we delete as we go. Bounded by `hasMore` rather than an
    // always-true loop.
    let hasMore = true;
    while (hasMore) {
      const snap = await db
        .collectionGroup("trash")
        .where("deletedAt", "<=", cutoff)
        .limit(BATCH_LIMIT)
        .get();

      if (snap.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      purged += snap.size;

      // Fewer than a full page means we've drained the backlog.
      hasMore = snap.size === BATCH_LIMIT;
    }

    logger.info(`purgetrash: removed ${purged} expired trash record(s)`);
  } catch (error) {
    // Fail-soft: a missing collection-group index (before the trash rules/index
    // PR ships) or a transient error must not crash the scheduler.
    logger.error("purgetrash: failed to purge expired trash", error);
  }
});
