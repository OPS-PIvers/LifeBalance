import {
  collection,
  query,
  onSnapshot,
  Firestore,
  QueryConstraint,
  DocumentData,
  QueryDocumentSnapshot,
  FirestoreError,
  Unsubscribe
} from 'firebase/firestore';

export interface SubscribeOptions<T> {
  constraints?: QueryConstraint[];
  transform?: (doc: QueryDocumentSnapshot<DocumentData>) => T;
  onError?: (error: FirestoreError) => void;
}

/**
 * Subscribes to a Firestore collection (or subcollection) with reduced boilerplate.
 *
 * @param db The Firestore instance
 * @param path The path to the collection (e.g., 'households/123/transactions')
 * @param callback The function to call with the array of data
 * @param options Optional constraints, transform function, and error handler
 * @returns An unsubscribe function
 */
export function subscribeToCollection<T>(
  db: Firestore,
  path: string,
  callback: (data: T[]) => void,
  options: SubscribeOptions<T> = {}
): Unsubscribe {
  const {
    constraints = [],
    transform = (doc) => ({ ...doc.data(), id: doc.id } as unknown as T),
    onError = (error) => console.error(`Error listening to ${path}:`, error)
  } = options;

  const q = query(collection(db, path), ...constraints);

  return onSnapshot(
    q,
    (snapshot) => {
      const data = snapshot.docs.map(transform);
      callback(data);
    },
    onError
  );
}
