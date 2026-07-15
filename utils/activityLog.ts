import {
  collection,
  doc,
  serverTimestamp,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { activityLogConverter } from '@/utils/firestoreConverters';
import type { ActivityDomain, ActivityLogEntry } from '@/types/schema';
import { formatCurrency } from '@/utils/formatCurrency';

/** The minimal actor identity an activity-log entry records. */
export interface ActivityActor {
  uid: string;
  name: string;
}

/** Description of an activity, before actor/id/timestamp are attached. */
export interface ActivityDescriptor {
  domain: ActivityDomain;
  /** Machine-readable action slug, e.g. 'habit_completed'. */
  action: string;
  /** Human-readable one-liner shown in the feed. */
  summary: string;
}

/** A fallback name for an actor with no resolvable display name. */
const UNKNOWN_ACTOR_NAME = 'Someone';

/**
 * Normalise an actor's display name to a non-empty, trimmed string so the feed
 * never renders a blank or whitespace-only name.
 */
export function resolveActorName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_ACTOR_NAME;
}

/**
 * Build the persisted shape of an activity-log entry from an actor + descriptor.
 *
 * Pure and unit-tested: it does NOT include the synthetic `id` (that becomes the
 * Firestore doc id) and writes `timestamp` as the caller-supplied sentinel so
 * the same builder serves both real writes (serverTimestamp) and deterministic
 * tests (a fixed ISO string). Returned object is ready for `batch.set()`.
 */
export function buildActivityLogEntry(
  actor: ActivityActor,
  descriptor: ActivityDescriptor,
  timestamp: unknown
): Omit<ActivityLogEntry, 'id'> {
  return {
    actorUid: actor.uid,
    actorName: resolveActorName(actor.name),
    domain: descriptor.domain,
    action: descriptor.action,
    summary: descriptor.summary,
    // Cast: real callers pass a Firestore serverTimestamp() sentinel; tests pass
    // an ISO string. The converter normalises whatever lands to an ISO string.
    timestamp: timestamp as string,
  };
}

/**
 * Compose a human-readable summary like "Paul paid Electric Bill ($142)". The
 * amount is optional and rendered with the household's money formatter.
 */
export function composeSummary(
  actorName: string,
  verb: string,
  subject: string,
  amount?: number
): string {
  const name = resolveActorName(actorName);
  const money =
    typeof amount === 'number'
      ? ` (${formatCurrency(amount, { decimals: 0 })})`
      : '';
  return `${name} ${verb} ${subject}${money}`;
}

/**
 * Append an activity-log entry to an EXISTING `writeBatch` so it co-commits
 * atomically with the mutation it describes — the entry can never diverge from
 * the underlying change. Generates a fresh auto-id doc ref under the household's
 * `activityLog` subcollection and writes a serverTimestamp for `timestamp`.
 *
 * No-ops when `householdId` is falsy so call sites can stay one-liners.
 */
export function appendActivityLog(
  batch: WriteBatch,
  db: Firestore,
  householdId: string | null | undefined,
  actor: ActivityActor,
  descriptor: ActivityDescriptor
): void {
  if (!householdId) return;
  const ref = doc(
    collection(db, `households/${householdId}/activityLog`)
  ).withConverter(activityLogConverter);
  batch.set(ref, {
    id: ref.id,
    ...buildActivityLogEntry(actor, descriptor, serverTimestamp()),
  });
}
