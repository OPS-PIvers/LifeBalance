import {
  collection,
  query,
  onSnapshot,
  orderBy,
  limit,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { shoppingItemConverter, groceryCatalogItemConverter } from '@/utils/firestoreConverters';
import { GROCERY_CATALOG_LIMIT } from '@/utils/listenerWindows';
import { ShoppingItem, GroceryCatalogItem } from '@/types/schema';

/**
 * Attaches the shopping-list + grocery-catalog listeners (verbatim move from
 * FirebaseHouseholdContext's main listener effect). Stores/quickStockLists
 * live on the household document itself and are covered by the household
 * settings listener, not here.
 */
export function attachShoppingListeners({
  db,
  householdId,
  setShoppingList,
  setGroceryCatalogWindow,
}: {
  db: Firestore;
  householdId: string;
  setShoppingList: (items: ShoppingItem[]) => void;
  setGroceryCatalogWindow: (items: GroceryCatalogItem[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Shopping List listener
  const shoppingListQuery = query(collection(db, `households/${householdId}/shoppingList`).withConverter(shoppingItemConverter));
  unsubscribers.push(
    onSnapshot(shoppingListQuery, (snapshot) => {
      setShoppingList(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[shoppingList] listener failed:', error);
    })
  );

  // Grocery Catalog listener — bounded to the most-purchased items so the cold
  // load doesn't scale with a household's lifetime catalog. Docs missing
  // `purchaseCount` are excluded by the orderBy (Firestore semantics); they —
  // and anything past the limit — remain reachable via the context's on-demand
  // `loadFullGroceryCatalog()`. Single-field orderBy: no composite index needed.
  const groceryCatalogQuery = query(
    collection(db, `households/${householdId}/groceryCatalog`).withConverter(groceryCatalogItemConverter),
    orderBy('purchaseCount', 'desc'),
    limit(GROCERY_CATALOG_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(groceryCatalogQuery, (snapshot) => {
      setGroceryCatalogWindow(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[groceryCatalog] listener failed:', error);
    })
  );

  return unsubscribers;
}
