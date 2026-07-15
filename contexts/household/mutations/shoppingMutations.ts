import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  arrayUnion,
  increment,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Info } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { ShoppingItem, GroceryCatalogItem, Store, QuickStockList, Household } from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { track } from '@/services/analytics';

// Pure-ish factories for the shopping-list, shopping-settings, and
// grocery-catalog mutation families, moved verbatim out of
// FirebaseHouseholdContext. The factories are split by the exact set of
// REACTIVE values each function's original closure captured, so every
// provider `useCallback` constructs a deps object containing only what its
// original closure actually used — its dependency array stays byte-identical
// AND eslint's exhaustive-deps analysis sees no phantom dependencies.

/**
 * Mutations whose original closures captured only `householdId` (plus the
 * module-stable `db`): plain shopping-list CRUD, simple household-doc
 * settings writes, and grocery-catalog CRUD.
 */
export function makeShoppingListMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const addShoppingItem = async (item: Omit<ShoppingItem, 'id'>) => {
    if (!householdId) return;
    try {
      const sanitizedItem = sanitizeFirestoreData(item);
      await addDoc(collection(db, `households/${householdId}/shoppingList`), {
        ...sanitizedItem,
        createdAt: serverTimestamp(),
      });
      toast.success('Added to shopping list');
    } catch (error) {
      console.error('[addShoppingItem] Failed:', error);
      toast.error('Failed to add item');
    }
  };

  const addShoppingItems = async (items: Omit<ShoppingItem, 'id'>[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      const collectionRef = collection(db, `households/${householdId}/shoppingList`);

      items.forEach(item => {
        const docRef = doc(collectionRef); // Generate new ID
        const sanitizedItem = sanitizeFirestoreData(item);
        batch.set(docRef, {
          ...sanitizedItem,
          createdAt: serverTimestamp(),
        });
      });

      await batch.commit();
      // Toast handled by caller or generic success
    } catch (error) {
      console.error('[addShoppingItems] Failed:', error);
      toast.error('Failed to add items');
      throw error;
    }
  };

  const updateShoppingItem = async (item: ShoppingItem) => {
    if (!householdId) return;
    try {
      const { id, ...itemData } = item;
      const sanitizedData = sanitizeFirestoreData(itemData);
      await updateDoc(doc(db, `households/${householdId}/shoppingList`, id), {
        ...sanitizedData,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[updateShoppingItem] Failed:', error);
      toast.error('Failed to update item');
    }
  };

  const reorderShoppingItems = async (items: ShoppingItem[]) => {
    if (!householdId) return;
    try {
      const batch = writeBatch(db);
      items.forEach((item, index) => {
        const ref = doc(db, `households/${householdId}/shoppingList`, item.id);
        batch.update(ref, { order: index });
      });
      await batch.commit();
    } catch (error) {
      console.error('[reorderShoppingItems] Failed:', error);
      toast.error('Failed to reorder items');
    }
  };

  const deleteShoppingItem = async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/shoppingList`, id));
      toast.success('Removed from shopping list');
    } catch (error) {
      console.error('[deleteShoppingItem] Failed:', error);
      toast.error('Failed to remove item');
    }
  };

  const addStore = async (store: Omit<Store, 'id'>) => {
    if (!householdId) return;
    try {
      const newStore = { ...store, id: crypto.randomUUID() };
      await updateDoc(doc(db, `households/${householdId}`), {
        stores: arrayUnion(newStore)
      });
      toast.success('Store added');
    } catch (error) {
      console.error('[addStore] Failed:', error);
      toast.error('Failed to add store');
    }
  };

  const updateGroceryCategories = async (categories: string[]) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}`), {
        groceryCategories: categories
      });
      toast.success('Categories updated');
    } catch (error) {
      console.error('[updateGroceryCategories] Failed:', error);
      toast.error('Failed to update categories');
    }
  };

  const addQuickStockList = async (list: Omit<QuickStockList, 'id'>) => {
    if (!householdId) return;
    try {
      const newList = { ...list, id: crypto.randomUUID() };
      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: arrayUnion(newList)
      });
      toast.success('Template created');
    } catch (error) {
      console.error('[addQuickStockList] Failed:', error);
      toast.error('Failed to create template');
    }
  };

  // Replace the WHOLE quickStockLists array in one write. Callers that touch
  // multiple lists in a single user action (e.g. reassigning a catalog item
  // between lists) must compute the final array locally and persist it here,
  // rather than firing two sequential updateQuickStockList() calls — both of
  // those would start from the same stale `householdSettings` snapshot and the
  // second write would clobber the first.
  const updateQuickStockLists = async (lists: QuickStockList[]) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: lists
      });
    } catch (error) {
      // Rethrow rather than swallow: the sole caller (handleQuickListChange)
      // shows its own "Failed to update list" toast and skips the success toast
      // on throw. Swallowing here would let the caller report success on a failed
      // write (and double-toast the error).
      console.error('[updateQuickStockLists] Failed:', error);
      throw error;
    }
  };

  const addGroceryCatalogItem = async (item: Omit<GroceryCatalogItem, 'id'>): Promise<string> => {
    if (!householdId) throw new Error("Household ID missing");
    try {
      const docRef = await addDoc(collection(db, `households/${householdId}/groceryCatalog`), item);
      return docRef.id;
    } catch (error) {
      console.error('[addGroceryCatalogItem] Failed:', error);
      toast.error('Failed to add to history');
      throw error;
    }
  };

  const updateGroceryCatalogItem = async (id: string, updates: Partial<GroceryCatalogItem>) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/groceryCatalog`, id), updates);
      toast.success('Item updated');
    } catch (error) {
      console.error('[updateGroceryCatalogItem] Failed:', error);
      toast.error('Failed to update item');
    }
  };

  const deleteGroceryCatalogItem = async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/groceryCatalog`, id));
      toast.success('Removed from history');
    } catch (error) {
      console.error('[deleteGroceryCatalogItem] Failed:', error);
      toast.error('Failed to remove item');
    }
  };

  return {
    addShoppingItem, addShoppingItems, updateShoppingItem, reorderShoppingItems,
    deleteShoppingItem, addStore, updateGroceryCategories,
    addQuickStockList, updateQuickStockLists,
    addGroceryCatalogItem, updateGroceryCatalogItem, deleteGroceryCatalogItem,
  };
}

/**
 * toggleShoppingItemPurchased — original closure captured
 * `householdId`, `shoppingList`, `groceryCatalog`.
 */
export function makeToggleShoppingItemPurchased(deps: {
  db: Firestore;
  householdId: string | null;
  shoppingList: ShoppingItem[];
  groceryCatalog: GroceryCatalogItem[];
}) {
  const { db, householdId, shoppingList, groceryCatalog } = deps;

  const toggleShoppingItemPurchased = async (id: string) => {
    if (!householdId) return;

    try {
      const item = shoppingList.find(i => i.id === id);
      if (!item) return;

      if (!item.isPurchased) {
        // Commit the purchase flag and the catalog (history) upsert in a single
        // batch so they can never diverge (item checked off but its purchase
        // history never recorded, or vice versa).
        const purchaseBatch = writeBatch(db);

        // Mark as purchased
        purchaseBatch.update(doc(db, `households/${householdId}/shoppingList`, id), {
          isPurchased: true,
        });

        const normalizedItemName = normalizeToKey(item.name);

        // 1. Add to Grocery Catalog (History)
        // Check if item exists in catalog by normalized NAME only — every other
        // catalog lookup (smart add, templates, quick lists, ingredient confirm)
        // keys by name alone. Also matching on category would fork a second
        // "Milk" row the moment the user recategorizes the item, fragmenting
        // purchase history across duplicates; instead the category is refreshed
        // on the existing row below.
        const existingCatalogItem = groceryCatalog.find(c =>
          normalizeToKey(c.name) === normalizedItemName
        );

        if (existingCatalogItem) {
          // Update existing catalog item
          purchaseBatch.update(doc(db, `households/${householdId}/groceryCatalog`, existingCatalogItem.id), {
            lastPurchased: new Date().toISOString(),
            purchaseCount: increment(1),
            // Refresh the category to the item's latest categorization
            category: item.category,
            // Update default store if current item has one
            ...(item.store ? { defaultStore: item.store } : {}),
            // Update default quantity if current item has one
            ...(item.quantity ? { defaultQuantity: item.quantity } : {})
          });
        } else {
          // Add new catalog item
          const newCatalogItem = {
            name: item.name,
            category: item.category,
            defaultQuantity: item.quantity,
            defaultStore: item.store,
            lastPurchased: new Date().toISOString(),
            purchaseCount: 1
          };
          // Pre-allocate the ref so the create participates in the batch.
          purchaseBatch.set(
            doc(collection(db, `households/${householdId}/groceryCatalog`)),
            sanitizeFirestoreData(newCatalogItem)
          );
        }

        await purchaseBatch.commit();

        track('shopping_item_checked');
        toast.success('Marked as purchased');

      } else {
        // Unmark (undo)
        await updateDoc(doc(db, `households/${householdId}/shoppingList`, id), {
          isPurchased: false,
        });
        toast('Marked as not purchased', { icon: toastIcon(Info) });
      }

    } catch (error) {
      console.error('[toggleShoppingItemPurchased] Failed:', error);
      toast.error('Failed to update status');
    }
  };

  return { toggleShoppingItemPurchased };
}

/**
 * clearPurchasedShoppingItems — original closure captured
 * `householdId`, `shoppingList`.
 */
export function makeClearPurchasedShoppingItems(deps: {
  db: Firestore;
  householdId: string | null;
  shoppingList: ShoppingItem[];
}) {
  const { db, householdId, shoppingList } = deps;

  const clearPurchasedShoppingItems = async () => {
    if (!householdId) return;

    try {
      const batch = writeBatch(db);
      const purchasedItems = shoppingList.filter(item => item.isPurchased);

      if (purchasedItems.length === 0) return;

      purchasedItems.forEach(item => {
        const itemRef = doc(db, `households/${householdId}/shoppingList`, item.id);
        batch.delete(itemRef);
      });

      await batch.commit();
      toast.success(`Cleared ${purchasedItems.length} items`);
    } catch (error) {
      console.error('[clearPurchasedShoppingItems] Failed:', error);
      toast.error('Failed to clear items');
    }
  };

  return { clearPurchasedShoppingItems };
}

/**
 * updateStore / updateQuickStockList / deleteQuickStockList — original
 * closures captured `householdId`, `householdSettings`.
 */
export function makeStoreSettingsMutations(deps: {
  db: Firestore;
  householdId: string | null;
  householdSettings: Household | null;
}) {
  const { db, householdId, householdSettings } = deps;

  const updateStore = async (updatedStore: Store) => {
    if (!householdId || !householdSettings) return;
    try {
      // We need to replace the object in the array
      const currentStores = householdSettings.stores || [];
      const newStores = currentStores.map(s => s.id === updatedStore.id ? updatedStore : s);

      await updateDoc(doc(db, `households/${householdId}`), {
        stores: newStores
      });
      toast.success('Store updated');
    } catch (error) {
      console.error('[updateStore] Failed:', error);
      toast.error('Failed to update store');
    }
  };

  const updateQuickStockList = async (updatedList: QuickStockList) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentLists = householdSettings.quickStockLists || [];
      const newLists = currentLists.map(l => l.id === updatedList.id ? updatedList : l);

      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: newLists
      });
      toast.success('Template updated');
    } catch (error) {
      console.error('[updateQuickStockList] Failed:', error);
      toast.error('Failed to update template');
    }
  };

  const deleteQuickStockList = async (id: string) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentLists = householdSettings.quickStockLists || [];
      const newLists = currentLists.filter(l => l.id !== id);

      await updateDoc(doc(db, `households/${householdId}`), {
        quickStockLists: newLists
      });
      toast.success('Template deleted');
    } catch (error) {
      console.error('[deleteQuickStockList] Failed:', error);
      toast.error('Failed to delete template');
    }
  };

  // Stores live as an array field on the household doc (not a subcollection),
  // so "reorder" is a single whole-array write assigning sequential `order`
  // values per `orderedIds`, rather than a writeBatch of per-doc updates
  // (mirrors updateStore's read-current/replace-array pattern above).
  const reorderStores = async (orderedIds: string[]) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentStores = householdSettings.stores || [];
      const orderById = new Map(orderedIds.map((id, index) => [id, index]));
      const newStores = currentStores.map(s => {
        const order = orderById.get(s.id);
        return order === undefined ? s : { ...s, order };
      });

      await updateDoc(doc(db, `households/${householdId}`), {
        stores: newStores
      });
    } catch (error) {
      console.error('[reorderStores] Failed:', error);
      toast.error('Failed to reorder stores');
      throw error;
    }
  };

  return { updateStore, updateQuickStockList, deleteQuickStockList, reorderStores };
}

/**
 * deleteStore — original closure captured `householdId`,
 * `householdSettings`, `shoppingList`.
 */
export function makeDeleteStore(deps: {
  db: Firestore;
  householdId: string | null;
  householdSettings: Household | null;
  shoppingList: ShoppingItem[];
}) {
  const { db, householdId, householdSettings, shoppingList } = deps;

  const deleteStore = async (id: string) => {
    if (!householdId || !householdSettings) return;
    try {
      const storeToDelete = householdSettings.stores?.find(s => s.id === id);
      const storeName = storeToDelete?.name;

      const batch = writeBatch(db);
      const householdRef = doc(db, `households/${householdId}`);

      // 1. Remove store from household settings
      const currentStores = householdSettings.stores || [];
      const newStores = currentStores.filter(s => s.id !== id);
      batch.update(householdRef, { stores: newStores });

      // 2. Remove store tag from shopping list items
      // Note: This relies on matching by name string as per current schema
      if (storeName) {
        const itemsToUpdate = shoppingList.filter(item => item.store === storeName);
        itemsToUpdate.forEach(item => {
          const itemRef = doc(db, `households/${householdId}/shoppingList`, item.id);
          // Use deleteField() to remove the field entirely or set to null/undefined
          // Since schema defines it as optional string, we update it to delete the field
          // We can just update with { store: deleteField() } but we need to import deleteField
          // Alternatively, just update with store: null or similar if the sanitizer handles it.
          // The sanitizer `sanitizeFirestoreData` removes undefined, converts "" to null.
          batch.update(itemRef, { store: deleteField() });
        });
      }

      await batch.commit();
      toast.success('Store deleted');
    } catch (error) {
      console.error('[deleteStore] Failed:', error);
      toast.error('Failed to delete store');
    }
  };

  return { deleteStore };
}
