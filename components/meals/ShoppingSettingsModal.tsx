import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { Store as StoreIcon, Plus, Trash2, Edit2, Save, RotateCcw, Search, Check, ShoppingBag, Sparkles, X, GripVertical } from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import { toastIcon } from '@/components/ui/toastIcon';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { QuickStockList, Store } from '@/types/schema';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialTemplateData?: Partial<QuickStockList> | null;
}

const ShoppingSettingsModal: React.FC<Props> = ({ isOpen, onClose, initialTemplateData }) => {
  const {
    stores,
    addStore,
    updateStore,
    deleteStore,
    reorderStores,
    groceryCategories,
    updateGroceryCategories,
    groceryCatalog,
    loadFullGroceryCatalog,
    quickStockLists,
    addQuickStockList,
    updateQuickStockList,
    deleteQuickStockList,
    addGroceryCatalogItem
  } = useShopping();

  const [activeTab, setActiveTab] = useState<'stores' | 'categories' | 'templates'>('stores');
  // Guards the footer save buttons against double-taps: both handlers are
  // async writes, and a second tap before the first resolves would issue a
  // concurrent duplicate (a repeated addQuickStockList creates a second doc).
  const [isSaving, setIsSaving] = useState(false);

  // Shared destructive-confirmation dialog state
  const [confirm, setConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Template Form State
  const [editingTemplate, setEditingTemplate] = useState<Partial<QuickStockList> | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  // The live grocery-catalog listener is bounded (top items by purchaseCount);
  // the template item picker searches the FULL catalog, so lazily pull in the
  // rest on the first keystroke (idempotent per household).
  useEffect(() => {
    if (itemSearch.trim()) void loadFullGroceryCatalog();
  }, [itemSearch, loadFullGroceryCatalog]);

  // Store Form State
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreColor, setNewStoreColor] = useState(DEFAULT_STORE_COLOR);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editStoreName, setEditStoreName] = useState('');
  const [editStoreColor, setEditStoreColor] = useState(DEFAULT_STORE_COLOR);

  // Household visit order (F-MEALS-07): stores sorted by `order` (unset last,
  // alpha fallback), drag-reordered via Reorder.Group. Same optimistic-local-
  // state-while-dragging pattern as HabitCategoryList — dragItems is shown
  // only mid-drag, then we persist and fall back to the Firestore-synced
  // `stores` prop so there's no synchronizing useEffect.
  const sortedStores = useMemo(() => {
    return [...stores].sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [stores]);
  const [dragStores, setDragStores] = useState<Store[]>([]);
  const [isDraggingStores, setIsDraggingStores] = useState(false);
  const storeItems = isDraggingStores ? dragStores : sortedStores;

  const handleStoreReorder = (newOrder: Store[]) => {
    setIsDraggingStores(true);
    setDragStores(newOrder);
  };

  const handleStoreReorderSave = useCallback(() => {
    setIsDraggingStores(false);
    void reorderStores(dragStores.map(s => s.id));
  }, [dragStores, reorderStores]);

  // Category Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [localCategories, setLocalCategories] = useState<string[]>([]);
  const [hasUnsavedCategoryChanges, setHasUnsavedCategoryChanges] = useState(false);

  // Initialize local categories from context (or default if empty)
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (groceryCategories && groceryCategories.length > 0) {
          setLocalCategories([...groceryCategories]);
        } else {
          setLocalCategories([...GROCERY_CATEGORIES]);
        }
        setHasUnsavedCategoryChanges(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, groceryCategories]);

  // Pre-fill template if provided
  useEffect(() => {
    if (isOpen && initialTemplateData && !editingTemplate) {
      const timer = setTimeout(() => {
        setActiveTab('templates');
        setEditingTemplate(initialTemplateData);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialTemplateData, editingTemplate]);

  // Reset editing state when modal closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setEditingTemplate(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSaveTemplate = async () => {
    if (!editingTemplate || !editingTemplate.name?.trim() || isSaving) return;

    setIsSaving(true);
    try {
      if (editingTemplate.id) {
        await updateQuickStockList(editingTemplate as QuickStockList);
      } else {
        await addQuickStockList({
          name: editingTemplate.name.trim(),
          items: editingTemplate.items || [],
          icon: editingTemplate.icon || 'ShoppingBag',
          color: editingTemplate.color || DEFAULT_STORE_COLOR
        });
      }
      setEditingTemplate(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleItemInTemplate = (itemId: string) => {
    if (!editingTemplate) return;
    const currentItems = editingTemplate.items || [];
    const exists = currentItems.includes(itemId);

    setEditingTemplate({
      ...editingTemplate,
      items: exists
        ? currentItems.filter(i => i !== itemId)
        : [...currentItems, itemId]
    });
  };

  const handleCreateAndAddItem = async () => {
    if (!itemSearch.trim() || !editingTemplate) return;

    const rawName = itemSearch.trim();
    // Check if it already exists in catalog (case-insensitive) to avoid duplicates
    const existing = groceryCatalog.find(i => i.name.toLowerCase() === rawName.toLowerCase());

    if (existing) {
      toggleItemInTemplate(existing.id);
      setItemSearch('');
      toast('Item found in history and added', { icon: toastIcon(Sparkles) });
      return;
    }

    try {
      const newItem = {
        name: rawName,
        category: 'Uncategorized',
        lastPurchased: new Date().toISOString(),
        purchaseCount: 1 // Start at 1 since we're explicitly adding it
      };

      const newId = await addGroceryCatalogItem(newItem);

      // Add to template
      setEditingTemplate(prev => ({
        ...prev,
        items: [...(prev?.items || []), newId]
      }));

      setItemSearch('');
      toast.success('Created and added to template');
    } catch (error) {
      console.error('Failed to create item:', error);
      toast.error('Failed to create item');
    }
  };

  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) return;

    await addStore({
      name: newStoreName.trim(),
      icon: 'Store', // Default icon for now
      color: newStoreColor
    });
    setNewStoreName('');
    setNewStoreColor(DEFAULT_STORE_COLOR);
  };

  const handleUpdateStore = async () => {
    if (!editingStoreId || !editStoreName.trim()) return;

    // Find existing to preserve other fields
    const existing = stores.find(s => s.id === editingStoreId);
    if (!existing) return;

    await updateStore({
      ...existing,
      name: editStoreName.trim(),
      color: editStoreColor
    });
    setEditingStoreId(null);
  };

  const handleDeleteStore = (id: string) => {
    setConfirm({
      title: 'Delete Store',
      message: 'Delete this store? Items will lose this tag.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        void deleteStore(id);
      },
    });
  };

  // Category Management
  const addCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;

    // Check duplicates case-insensitively
    if (localCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Category already exists');
      return;
    }

    // Normalize to Title Case for consistency
    const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

    setLocalCategories([...localCategories, normalized]);
    setNewCategoryName('');
    setHasUnsavedCategoryChanges(true);
  };

  const removeCategory = (catToRemove: string) => {
    setLocalCategories(localCategories.filter(c => c !== catToRemove));
    setHasUnsavedCategoryChanges(true);
  };

  const saveCategories = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateGroceryCategories(localCategories);
      setHasUnsavedCategoryChanges(false);
    } catch (error) {
      console.error('Failed to save grocery categories', error);
      toast.error('Failed to save categories. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const resetCategories = () => {
    setConfirm({
      title: 'Reset Categories',
      message: 'Reset to default categories?',
      confirmLabel: 'Reset',
      onConfirm: () => {
        setLocalCategories([...GROCERY_CATEGORIES]);
        setHasUnsavedCategoryChanges(true);
      },
    });
  };

  // Tab bar — the standardized Tabs strip (same primitive as ListsPage), in the
  // Drawer's fixed header slot so it never scrolls and the sheet frame stays
  // stable across tabs.
  const tabBar = (
      <div className="px-4 pb-3 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
              <TabsList size="sm">
                  <TabsTrigger value="stores" className="flex-1">Stores</TabsTrigger>
                  <TabsTrigger value="categories" className="flex-1">Categories</TabsTrigger>
                  <TabsTrigger value="templates" className="flex-1">Templates</TabsTrigger>
              </TabsList>
          </Tabs>
      </div>
  );

  // Per-tab action bars — rendered in the Drawer's fixed footer slot (below the
  // scrollable body) so they stay pinned to the sheet bottom at the tall detent.
  const footer =
    activeTab === 'categories' ? (
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
            <Button
                variant="primary"
                size="lg"
                onClick={saveCategories}
                disabled={!hasUnsavedCategoryChanges || isSaving}
                className="w-full"
            >
                Save Category Changes
            </Button>
        </div>
    ) : activeTab === 'templates' && editingTemplate ? (
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
            <Button
              variant="primary"
              size="lg"
              onClick={handleSaveTemplate}
              disabled={!editingTemplate.name?.trim() || isSaving}
              className="w-full"
            >
              Save Template
            </Button>
        </div>
    ) : undefined;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Shopping List Settings"
      noPadding={true}
      // Fixed tall detent: the sheet frame stays the same height across the
      // Stores / Categories / Templates tabs instead of resizing to each tab's
      // content, which made the whole sheet jump on every tab switch.
      height="tall"
      header={tabBar}
      footer={footer}
    >
        {/* min-h-full so the tinted body fills the fixed-height sheet even when
            a tab's content is short. */}
        <div className="min-h-full p-4 sm:p-6 bg-brand-50 dark:bg-brand-900/40">

          {activeTab === 'stores' && (
            <div className="space-y-6">
              {/* Add Store — flat, typography-led; no bordered form card */}
              <Section title="Add store">
                <form onSubmit={handleAddStore} className="space-y-3">
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {Object.values(STORE_COLORS).map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => setNewStoreColor(color.id)}
                        className={`w-7 h-7 rounded-full border-2 transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 ${color.bg} ${
                          newStoreColor === color.id ? 'border-brand-600 scale-110 ring-2 ring-brand-200' : 'border-transparent hover:scale-105'
                        }`}
                        title={color.label}
                        aria-label={`Select color ${color.label}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newStoreName}
                      onChange={(e) => setNewStoreName(e.target.value)}
                      placeholder="Store Name (e.g. Costco)"
                      className="flex-1 p-2.5 bg-white border border-brand-200 rounded-xl text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!newStoreName.trim()}
                      leftIcon={<Plus className="w-4 h-4" />}
                    >
                      Add
                    </Button>
                  </div>
                </form>
              </Section>

              {/* Store List — drag the grip to set the household's shop-by-store
                  visit order (F-MEALS-07), persisted as Store.order and
                  consumed by the shopping list's 'store' sort mode. */}
              <Section title="My stores" action={storeItems.length > 1 && (
                <span className="text-xxs text-brand-400 dark:text-brand-450">Drag to reorder</span>
              )}>
                {stores.length === 0 ? (
                  <p className="text-sm text-brand-400 dark:text-brand-450 italic pl-1">No stores added yet.</p>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={storeItems}
                    onReorder={handleStoreReorder}
                    as="ul"
                    className="surface-section overflow-hidden [&>*:first-child]:border-t-0 list-none"
                    aria-label="My stores, in shopping visit order"
                  >
                    {storeItems.map(store => (
                      <StoreRow
                        key={store.id}
                        store={store}
                        isEditing={editingStoreId === store.id}
                        editStoreName={editStoreName}
                        editStoreColor={editStoreColor}
                        onEditStoreNameChange={setEditStoreName}
                        onEditStoreColorChange={setEditStoreColor}
                        onStartEdit={() => {
                          setEditingStoreId(store.id);
                          setEditStoreName(store.name);
                          setEditStoreColor(store.color || DEFAULT_STORE_COLOR);
                        }}
                        onCancelEdit={() => setEditingStoreId(null)}
                        onSaveEdit={handleUpdateStore}
                        onDelete={() => handleDeleteStore(store.id)}
                        onReorderDragEnd={handleStoreReorderSave}
                      />
                    ))}
                  </Reorder.Group>
                )}
              </Section>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="space-y-6">
                <Section title="Add category">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                            placeholder="Category Name"
                            className="flex-1 p-2 bg-white border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
                        />
                        <Button
                            variant="primary"
                            onClick={addCategory}
                            disabled={!newCategoryName.trim()}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
                </Section>

                <Section
                  title="Active categories"
                  action={
                    <button
                      onClick={resetCategories}
                      className="text-xs text-brand-600 hover:underline flex items-center gap-1 dark:text-brand-300"
                    >
                      <RotateCcw className="w-3 h-3" /> Defaults
                    </button>
                  }
                >
                    <div className="flex flex-wrap gap-2">
                        {localCategories.map(cat => (
                            <div key={cat} className="flex items-center gap-1 bg-white border border-brand-200 pl-3 pr-1 py-1.5 rounded-full text-sm dark:bg-brand-800 dark:border-brand-700">
                                <span className="text-brand-700 dark:text-brand-200 font-medium">{cat}</span>
                                <button
                                    onClick={() => removeCategory(cat)}
                                    className="p-1 text-brand-400 hover:text-money-neg hover:bg-money-bgNeg rounded-full transition-colors dark:text-brand-450 dark:hover:text-money-negDark dark:hover:bg-money-neg/15"
                                    aria-label={`Remove category ${cat}`}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-6">
              {!editingTemplate ? (
                <>
                  <Button
                    variant="dashed"
                    size="lg"
                    onClick={() => setEditingTemplate({ name: '', items: [], icon: 'ShoppingBag', color: DEFAULT_STORE_COLOR })}
                    leftIcon={<Plus className="w-5 h-5" />}
                    className="w-full"
                  >
                    Create New Template
                  </Button>

                  {quickStockLists.length === 0 ? (
                    <p className="text-center text-brand-400 dark:text-brand-450 text-sm py-4">No templates yet. Create one for &quot;Work Week&quot;, &quot;Camping&quot;, etc.</p>
                  ) : (
                    <SurfaceList>
                      {quickStockLists.map(list => {
                         const Icon = TEMPLATE_ICONS.find(i => i.id === list.icon)?.icon || ShoppingBag;
                         const color = STORE_COLORS[list.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!; // DEFAULT_STORE_COLOR is always present

                         return (
                        <Row key={list.id} className="justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                             <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${color.bg} ${color.text}`}>
                                <Icon className="w-5 h-5" />
                             </div>
                             <div className="min-w-0">
                                <h4 className="font-bold text-brand-800 dark:text-brand-200 truncate">{list.name}</h4>
                                <p className="text-xs text-brand-500 dark:text-brand-400">{list.items.length} items</p>
                             </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                             <Button
                               variant="ghost"
                               size="icon-sm"
                               onClick={() => setEditingTemplate(list)}
                               className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/30"
                               aria-label={`Edit template ${list.name}`}
                             >
                               <Edit2 className="w-4 h-4" />
                             </Button>
                             <Button
                               variant="ghost-destructive"
                               size="icon-sm"
                               onClick={() => {
                                 setConfirm({
                                   title: 'Delete Template',
                                   message: `Delete template "${list.name}"?`,
                                   confirmLabel: 'Delete',
                                   onConfirm: () => {
                                     // deleteQuickStockList already toasts on success.
                                     void deleteQuickStockList(list.id);
                                   },
                                 });
                               }}
                               aria-label={`Delete template ${list.name}`}
                             >
                               <Trash2 className="w-4 h-4" />
                             </Button>
                          </div>
                        </Row>
                      );
                      })}
                    </SurfaceList>
                  )}
                </>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                     <h4 className="font-bold text-brand-800 dark:text-brand-200">{editingTemplate.id ? 'Edit Template' : 'New Template'}</h4>
                     <Button variant="ghost" size="icon-sm" onClick={() => setEditingTemplate(null)} aria-label="Close"><X className="w-5 h-5 text-brand-400 dark:text-brand-450" /></Button>
                  </div>

                  <input
                    type="text"
                    value={editingTemplate.name}
                    onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})}
                    placeholder="Template Name (e.g. Weekly Basics)"
                    className="w-full p-2.5 bg-white border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
                    autoFocus
                  />

                  {/* Icon & Color — flat, typography-labeled; no wrapping box */}
                  <div>
                    <span className="text-xs font-bold text-brand-400 dark:text-brand-450 uppercase mb-2 block">Icon</span>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {TEMPLATE_ICONS.map(({ id, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setEditingTemplate({...editingTemplate, icon: id})}
                                className={`p-2 rounded-lg transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 ${
                                    (editingTemplate.icon || 'ShoppingBag') === id
                                        ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500 ring-offset-1 dark:bg-brand-700/40 dark:text-brand-200 dark:ring-offset-brand-800'
                                        : 'bg-brand-50 text-brand-400 hover:bg-brand-100/50 hover:text-brand-600 dark:bg-brand-700/40 dark:text-brand-400 dark:hover:bg-brand-700 dark:hover:text-brand-200'
                                }`}
                            >
                                <Icon className="w-5 h-5" />
                            </button>
                        ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-brand-400 dark:text-brand-450 uppercase mb-2 block">Color</span>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {Object.values(STORE_COLORS).map((color) => (
                            <button
                                key={color.id}
                                onClick={() => setEditingTemplate({...editingTemplate, color: color.id})}
                                className={`w-6 h-6 rounded-full border-2 transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 ${color.bg} ${
                                    (editingTemplate.color || DEFAULT_STORE_COLOR) === color.id
                                        ? 'border-brand-600 scale-110'
                                        : 'border-transparent hover:scale-105'
                                }`}
                            />
                        ))}
                    </div>
                  </div>

                  <div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 dark:text-brand-450" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={e => setItemSearch(e.target.value)}
                        placeholder="Search or add new item..."
                        className="w-full pl-9 p-2.5 bg-white border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
                      />
                    </div>

                    {/* Add New Item Action */}
                    {itemSearch.trim() && !groceryCatalog.some(i => i.name.toLowerCase() === itemSearch.trim().toLowerCase()) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCreateAndAddItem}
                            leftIcon={<Plus className="w-4 h-4" />}
                            className="w-full mt-2 bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 border-dashed dark:bg-brand-700/30 dark:text-brand-200 dark:border-brand-500/40 dark:hover:bg-brand-700/50"
                        >
                            Create & Add &quot;{itemSearch}&quot;
                        </Button>
                    )}
                  </div>

                  <SurfaceList className="max-h-72 overflow-y-auto">
                    {groceryCatalog
                      .filter(item =>
                         !itemSearch || item.name.toLowerCase().includes(itemSearch.toLowerCase())
                      )
                      .sort((a, b) => {
                         const aSelected = editingTemplate.items?.includes(a.id);
                         const bSelected = editingTemplate.items?.includes(b.id);
                         if (aSelected && !bSelected) return -1;
                         if (!aSelected && bSelected) return 1;
                         return b.purchaseCount - a.purchaseCount;
                      })
                      .slice(0, 50) // Limit render
                      .map(item => {
                        const isSelected = editingTemplate.items?.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            onClick={() => toggleItemInTemplate(item.id)}
                            className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 hairline-divider text-sm text-left transition-colors ${
                              isSelected
                                ? 'text-brand-900 dark:text-brand-100 font-medium'
                                : 'text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-700/40'
                            }`}
                          >
                            <span>{item.name}</span>
                            {isSelected && <Check className="w-4 h-4 text-brand-600 dark:text-brand-300" />}
                          </button>
                        );
                      })}
                  </SurfaceList>
                </div>
              )}
            </div>
          )}
        </div>

        <ConfirmDialog
          isOpen={confirm !== null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            confirm?.onConfirm();
            setConfirm(null);
          }}
          title={confirm?.title ?? ''}
          message={confirm?.message}
          confirmLabel={confirm?.confirmLabel}
          confirmVariant="destructive"
        />
    </Drawer>
  );
};

interface StoreRowProps {
  store: Store;
  isEditing: boolean;
  editStoreName: string;
  editStoreColor: string;
  onEditStoreNameChange: (value: string) => void;
  onEditStoreColorChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReorderDragEnd: () => void;
}

/**
 * A single draggable store row (F-MEALS-07). Split out of the inline `.map`
 * so the grip's `useDragControls` instance is stable per store rather than
 * being re-created every render of the parent list.
 */
const StoreRow: React.FC<StoreRowProps> = ({
  store, isEditing, editStoreName, editStoreColor,
  onEditStoreNameChange, onEditStoreColorChange,
  onStartEdit, onCancelEdit, onSaveEdit, onDelete, onReorderDragEnd,
}) => {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={store}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onReorderDragEnd}
      style={{ position: 'relative' }}
    >
      {isEditing ? (
        <Row className="flex-col items-stretch gap-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Object.values(STORE_COLORS).map((color) => (
              <button
                key={color.id}
                type="button"
                onClick={() => onEditStoreColorChange(color.id)}
                className={`w-6 h-6 rounded-full border-2 transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 ${color.bg} ${
                  editStoreColor === color.id ? 'border-brand-600 scale-110' : 'border-transparent hover:scale-105'
                }`}
                title={color.label}
                aria-label={`Select color ${color.label}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={editStoreName}
              onChange={e => onEditStoreNameChange(e.target.value)}
              className="flex-1 p-1.5 border border-brand-300 rounded-sm text-base outline-hidden dark:bg-brand-700/50 dark:border-brand-500/40 dark:text-brand-200"
            />
            <Button variant="ghost" size="icon-sm" onClick={onSaveEdit} className="text-money-pos hover:text-money-pos hover:bg-money-bgPos dark:text-money-posDark dark:hover:text-money-posDark dark:hover:bg-money-pos/15" aria-label="Save store name"><Save className="w-4 h-4"/></Button>
            <Button variant="ghost" size="icon-sm" onClick={onCancelEdit} className="text-brand-400 hover:bg-brand-100/50 dark:hover:bg-brand-700/50" aria-label="Cancel editing"><X className="w-4 h-4"/></Button>
          </div>
        </Row>
      ) : (
        <Row className="justify-between">
          <div className="flex items-center gap-1 min-w-0">
            {/* Pointer-only decoration (mirrors ListRow's grip): keyboard/AT
                users don't get drag-reordering here, matching HabitCategoryList. */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="touch-none cursor-grab active:cursor-grabbing p-1.5 -ml-1.5 text-brand-300 hover:text-brand-600 dark:text-brand-500 dark:hover:text-brand-300 rounded-sm shrink-0"
              aria-hidden="true"
            >
              <GripVertical className="w-4 h-4" />
            </div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${(STORE_COLORS[store.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!).iconBg}`}>
                <StoreIcon className="w-4 h-4" />
            </div>
            <span className="font-medium text-brand-800 dark:text-brand-200 truncate">{store.name}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
              <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onStartEdit}
                  className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 dark:text-brand-450 dark:hover:text-brand-300 dark:hover:bg-brand-700/30"
                  aria-label={`Edit store ${store.name}`}
              >
                  <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  onClick={onDelete}
                  aria-label={`Delete store ${store.name}`}
              >
                  <Trash2 className="w-4 h-4" />
              </Button>
          </div>
        </Row>
      )}
    </Reorder.Item>
  );
};

export default ShoppingSettingsModal;
