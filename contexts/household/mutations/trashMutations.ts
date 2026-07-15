import {
  collection,
  doc,
  getDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type Unsubscribe,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import {
  TRASH_DOMAIN_META,
  trashDocId,
  isTrashDomain,
  type TrashDomain,
  type TrashedItem,
} from '@/utils/trash';

/**
 * Firestore-touching half of the unified trash (F-XCUT-03). The pure metadata /
 * TTL helpers live in `utils/trash.ts`; this module owns the soft-delete,
 * restore, purge and listener wiring against `households/{id}/trash`.
 *
 * Graceful degradation: the `trash` subcollection needs its own firestore.rules
 * entry (separate, human-watched PR — see F-XCUT-03). Until that lands, reads
 * permission-deny (the listener then reports an empty trash) and the soft-delete
 * batch falls back to a plain hard delete, so deleting keeps working — it just
 * isn't recoverable yet. Once the rules ship, no client change is needed.
 */

/** Live listener window — the Recently Deleted view never needs more than a
 *  few pages of recently-trashed records (older ones are purged at 30 days). */
export const TRASH_LIMIT = 100;

interface TrashDeps {
  db: Firestore;
  householdId: string | null;
  /** UID to stamp as `deletedBy` on the trash mirror, when known. */
  deletedBy?: string | null;
}

function isPermissionDenied(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'permission-denied';
}

/**
 * Atomically soft-delete a single document: mirror it into the household
 * `trash` subcollection and remove the original in ONE writeBatch. Reads the
 * source doc first so the mirror captures its full data for restore. Falls back
 * to a plain hard delete when the trash write is permission-denied (pre-rules).
 */
export async function softDeleteDoc(
  deps: TrashDeps,
  domain: TrashDomain,
  id: string
): Promise<void> {
  const { db, householdId, deletedBy } = deps;
  if (!householdId) throw new Error('Household not selected');

  const { collection: sourceCollection } = TRASH_DOMAIN_META[domain];
  const sourceRef = doc(db, `households/${householdId}/${sourceCollection}`, id);
  const trashRef = doc(db, `households/${householdId}/trash`, trashDocId(domain, id));

  try {
    const snap = await getDoc(sourceRef);
    if (!snap.exists()) {
      // Already gone — nothing to mirror.
      return;
    }
    const batch = writeBatch(db);
    batch.set(trashRef, {
      domain,
      originalId: id,
      data: sanitizeFirestoreData(snap.data()),
      deletedAt: serverTimestamp(),
      deletedBy: deletedBy ?? null,
    });
    batch.delete(sourceRef);
    await batch.commit();
  } catch (error) {
    if (isPermissionDenied(error)) {
      // trash rules not deployed yet — degrade to a hard delete so the user's
      // delete still takes effect (just not recoverable until rules ship).
      await deleteDoc(sourceRef);
      return;
    }
    console.error(`[softDeleteDoc] Failed to soft-delete ${domain}/${id}:`, error);
    throw error;
  }
}

/**
 * Restore a trashed record: re-create the original document from its mirrored
 * data and remove the trash doc, atomically.
 */
export async function restoreTrashedItem(
  deps: TrashDeps,
  item: TrashedItem
): Promise<void> {
  const { db, householdId } = deps;
  if (!householdId) throw new Error('Household not selected');

  const { collection: sourceCollection } = TRASH_DOMAIN_META[item.domain];
  const batch = writeBatch(db);
  batch.set(
    doc(db, `households/${householdId}/${sourceCollection}`, item.originalId),
    item.data
  );
  batch.delete(doc(db, `households/${householdId}/trash`, item.id));
  await batch.commit();
}

/** Permanently delete a trashed record now (no recovery). */
export async function purgeTrashedItem(
  deps: TrashDeps,
  item: TrashedItem
): Promise<void> {
  const { db, householdId } = deps;
  if (!householdId) throw new Error('Household not selected');
  await deleteDoc(doc(db, `households/${householdId}/trash`, item.id));
}

/** Map a raw trash doc into a typed {@link TrashedItem} (Timestamp → ISO). */
function mapTrashDoc(snap: QueryDocumentSnapshot<DocumentData>): TrashedItem | null {
  const raw = snap.data();
  if (!isTrashDomain(raw.domain)) return null;
  const deletedAtRaw = raw.deletedAt;
  const deletedAt =
    deletedAtRaw instanceof Timestamp
      ? deletedAtRaw.toDate().toISOString()
      : typeof deletedAtRaw === 'string'
        ? deletedAtRaw
        : new Date(0).toISOString();
  return {
    id: snap.id,
    domain: raw.domain,
    originalId: typeof raw.originalId === 'string' ? raw.originalId : snap.id,
    data: (raw.data as Record<string, unknown> | undefined) ?? {},
    deletedAt,
    deletedBy: typeof raw.deletedBy === 'string' ? raw.deletedBy : null,
  };
}

/**
 * Attach the trash listener — newest-first, bounded live window. Errors
 * (including the pre-rules permission-denied) collapse to an empty trash so the
 * Recently Deleted view degrades gracefully.
 */
export function attachTrashListener({
  db,
  householdId,
  setTrashedItems,
}: {
  db: Firestore;
  householdId: string;
  setTrashedItems: (items: TrashedItem[]) => void;
}): Unsubscribe {
  const trashQuery = query(
    collection(db, `households/${householdId}/trash`),
    orderBy('deletedAt', 'desc'),
    limit(TRASH_LIMIT)
  );
  return onSnapshot(
    trashQuery,
    (snapshot) => {
      const items: TrashedItem[] = [];
      for (const docSnap of snapshot.docs) {
        const mapped = mapTrashDoc(docSnap);
        if (mapped) items.push(mapped);
      }
      setTrashedItems(items);
    },
    (error) => {
      if (!isPermissionDenied(error)) {
        console.error('Error listening to trash:', error);
      }
      setTrashedItems([]);
    }
  );
}
