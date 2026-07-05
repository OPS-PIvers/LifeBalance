import {
  collection,
  query,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { shoppingItemConverter, groceryCatalogItemConverter } from '@/utils/firestoreConverters';
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
  setGroceryCatalog,
}: {
  db: Firestore;
  householdId: string;
  setShoppingList: (items: ShoppingItem[]) => void;
  setGroceryCatalog: (items: GroceryCatalogItem[]) => void;
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

  // Grocery Catalog listener
  const groceryCatalogQuery = query(collection(db, `households/${householdId}/groceryCatalog`).withConverter(groceryCatalogItemConverter));
  unsubscribers.push(
    onSnapshot(groceryCatalogQuery, (snapshot) => {
      setGroceryCatalog(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[groceryCatalog] listener failed:', error);
    })
  );

  return unsubscribers;
}
