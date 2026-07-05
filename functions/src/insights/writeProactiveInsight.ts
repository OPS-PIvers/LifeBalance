import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { isoWeekId } from "../shared/isoWeek";
import { checkAndIncrementProactiveCap, ProactiveCapState } from "./proactiveCap";

/**
 * Loosely-typed view of the household doc fields this module reads/writes —
 * functions/ keeps local type views of Firestore docs rather than importing
 * the client's `types/schema.ts` (separate pnpm package; see the same pattern
 * in functions/src/recap/index.ts).
 */
export interface ProactiveCapHouseholdDoc extends ProactiveCapState {
  id?: string;
}

/** Shape written to `households/{id}/insights` — mirrors `types/schema.ts`'s `Insight`. */
export interface ProactiveInsightDoc {
  text: string;
  generatedAt: string; // ISO timestamp
  type: "general" | "spending" | "habits";
}

/**
 * Attempts to write a proactive insight doc for `householdId`, subject to the
 * shared 2-per-ISO-week cap (see `proactiveCap.ts`). The cap check-and-increment
 * happens in the SAME batch as the insight write, so the two can never diverge
 * (matching the atomicity conventions documented in CLAUDE.md for other
 * multi-document mutations).
 *
 * `docId`, when provided, is used as the insight doc's id (for deterministic,
 * idempotent writes — e.g. the budget-anomaly trigger keys on
 * `anomaly_<bucketId>_<periodKey>` so re-firing the same anomaly is a no-op).
 * When omitted, an auto-generated id is used (matching the manual
 * `refreshInsight` button's `addDoc` behavior).
 *
 * Returns `true` if the insight was written, `false` if skipped (cap reached,
 * or a deterministic id that already exists).
 */
export async function writeProactiveInsight(
  db: admin.firestore.Firestore,
  householdId: string,
  household: ProactiveCapHouseholdDoc,
  insight: ProactiveInsightDoc,
  now: Date,
  timezone: string,
  docId?: string
): Promise<boolean> {
  const householdRef = db.doc(`households/${householdId}`);
  const insightsCollection = db.collection(`households/${householdId}/insights`);
  const insightRef = docId ? insightsCollection.doc(docId) : insightsCollection.doc();

  if (docId) {
    const existing = await insightRef.get();
    if (existing.exists) {
      logger.info(
        `writeProactiveInsight: household ${householdId} already has insight ${docId}, skipping (idempotent)`
      );
      return false;
    }
  }

  const isoWeek = isoWeekId(now, timezone);
  const capResult = checkAndIncrementProactiveCap(household, isoWeek);

  if (!capResult.allowed) {
    logger.info(
      `writeProactiveInsight: household ${householdId} hit the proactive-insight weekly cap for ${isoWeek}, skipping`
    );
    return false;
  }

  const batch = db.batch();
  batch.set(insightRef, insight);
  batch.update(householdRef, capResult.patch as Record<string, unknown>);
  await batch.commit();

  logger.info(
    `writeProactiveInsight: wrote proactive insight for household ${householdId} (type=${insight.type}, week=${isoWeek})`
  );
  return true;
}
