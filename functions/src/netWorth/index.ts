import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { format } from "date-fns";
import { computeNetWorth, type NetWorthAccountLike } from "./computeNetWorth";

/**
 * Net worth history (F-MONEY-09) — daily server-side snapshot of every
 * household's total assets/liabilities/net worth, persisted to
 * `households/{id}/netWorthSnapshots/{yyyy-MM-dd}` so the client's
 * `NetWorthTrendChart` (Money → Trends) has something to plot over time.
 * `BudgetAccounts.tsx`'s live figure is otherwise a snapshot with no history.
 *
 * Runs once daily. The doc id is the UTC calendar date at run time — a
 * single global run time (rather than per-household-timezone, unlike the
 * recap/reminder jobs) keeps this cheap and simple; a household near the UTC
 * day boundary may see its "today" snapshot land on the neighboring date by
 * local-time reckoning, which is an acceptable trade-off for a slow-moving
 * trend metric (see CLAUDE.md's local-date convention for user-facing
 * "today" — that convention governs same-day UX, not this backend rollup).
 *
 * Idempotent: writing the same doc id twice on a retry simply overwrites with
 * the same (or a newer, still-correct) computation — no accumulation, no
 * duplicate-detection needed.
 */
export const snapshotnetworth = onSchedule(
  { schedule: "every 24 hours", timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore();
    const date = format(new Date(), "yyyy-MM-dd");
    logger.info(`snapshotnetworth: starting run for ${date}`);

    const householdRefs = await db.collection("households").listDocuments();
    logger.info(`snapshotnetworth: found ${householdRefs.length} household(s)`);

    let succeeded = 0;
    let failed = 0;
    for (const householdRef of householdRefs) {
      try {
        await snapshotHousehold(db, householdRef.id, date);
        succeeded++;
      } catch (error) {
        // One household's failure must never throw out of the whole run.
        failed++;
        logger.error(`snapshotnetworth: failed processing household ${householdRef.id}`, error);
      }
    }

    logger.info(`snapshotnetworth: finished run for ${date} (succeeded=${succeeded}, failed=${failed})`);
  }
);

async function snapshotHousehold(db: admin.firestore.Firestore, householdId: string, date: string): Promise<void> {
  const accountsSnap = await db.collection(`households/${householdId}/accounts`).get();
  const accounts: NetWorthAccountLike[] = accountsSnap.docs.map((d) => {
    const data = d.data();
    return {
      type: data.type as NetWorthAccountLike["type"],
      balance: typeof data.balance === "number" ? data.balance : 0,
    };
  });

  // A household with no accounts yet (mid-onboarding) still gets a zeroed
  // snapshot rather than being skipped — consistent history beats a gap.
  const { totalAssets, totalLiabilities, netWorth } = computeNetWorth(accounts);

  await db.doc(`households/${householdId}/netWorthSnapshots/${date}`).set({
    date,
    totalAssets,
    totalLiabilities,
    netWorth,
  });
}
