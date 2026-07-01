import React, { useState, useEffect } from 'react';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { Store as StoreIcon, Plus, Trash2, Save, RotateCcw, Search, Check, ShoppingBag, X } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { QuickStockList } from '@/types/schema';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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
    groceryCategories,
    updateGroceryCategories,
    groceryCatalog,
    quickStockLists,
    addQuickStockList,
    updateQuickStockList,
    deleteQuickStockList,
    addGroceryCatalogItem
  } = useShopping();

  const [activeTab, setActiveTab] = useState<'stores' | 'categories' | 'templates'>('stores');

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

  // Store Form State
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreColor, setNewStoreColor] = useState(DEFAULT_STORE_COLOR);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editStoreName, setEditStoreName] = useState('');
  const [editStoreColor, setEditStoreColor] = useState(DEFAULT_STORE_COLOR);

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
    if (!editingTemplate || !editingTemplate.name?.trim()) return;

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
      toast('Item found in history and added', { icon: '✨' });
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
    try {
      await updateGroceryCategories(localCategories);
      setHasUnsavedCategoryChanges(false);
    } catch (error) {
      console.error('Failed to save grocery categories', error);
      toast.error('Failed to save categories. Please try again.');
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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Shopping List Settings"
      noPadding={true}
    >
      {/* Tabs */}
      <div className="flex border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 sticky top-0 z-10">
          <button
            onClick={() => setActiveTab('stores')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${
              activeTab === 'stores' ? 'text-accent-700 bg-brand-50 dark:text-accent-300 dark:bg-brand-700/40' : 'text-brand-500 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-700/50'
            }`}
          >
            Stores
            {activeTab === 'stores' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-600 dark:bg-accent-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${
              activeTab === 'categories' ? 'text-accent-700 bg-brand-50 dark:text-accent-300 dark:bg-brand-700/40' : 'text-brand-500 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-700/50'
            }`}
          >
            Categories
            {activeTab === 'categories' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-600 dark:bg-accent-400" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${
              activeTab === 'templates' ? 'text-accent-700 bg-brand-50 dark:text-accent-300 dark:bg-brand-700/40' : 'text-brand-500 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-700/50'
            }`}
          >
            Templates
            {activeTab === 'templates' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-600 dark:bg-accent-400" />
            )}
          </button>
        </div>

        <div className="flex-1 scroll-contain-y p-4 sm:p-6 bg-brand-50 dark:bg-brand-900/40">

          {activeTab === 'stores' && (
            <div className="space-y-6">
              {/* Add Store */}
              <div className="bg-white p-5 rounded-2xl border border-brand-200 dark:bg-brand-800 dark:border-brand-700">
                <h4 className="text-xs font-bold text-brand-400 dark:text-brand-500 mb-3 uppercase tracking-wider">Add New Store</h4>
                <form onSubmit={handleAddStore} className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
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
                      className="flex-1 p-2.5 bg-brand-50 border border-brand-200 rounded-xl text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-500"
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
              </div>

              {/* Store List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wider pl-1">My Stores</h4>
                {stores.length === 0 ? (
                  <p className="text-sm text-brand-400 dark:text-brand-500 italic pl-1">No stores added yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {stores.map(store => (
                      <div key={store.id} className="bg-white p-4 rounded-xl border border-brand-200 flex items-center justify-between group hover:border-brand-300 transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:bg-brand-800 dark:border-brand-700 dark:hover:border-brand-600">
                        {editingStoreId === store.id ? (
                           <div className="flex-1 space-y-2 mr-2">
                             <div className="flex gap-2 overflow-x-auto pb-1">
                                {Object.values(STORE_COLORS).map((color) => (
                                  <button
                                    key={color.id}
                                    type="button"
                                    onClick={() => setEditStoreColor(color.id)}
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
                                  onChange={e => setEditStoreName(e.target.value)}
                                  className="flex-1 p-1.5 border border-brand-300 rounded-sm text-base outline-hidden dark:bg-brand-700/50 dark:border-brand-500/40 dark:text-brand-200"
                               />
                               <Button variant="ghost" size="icon-sm" onClick={handleUpdateStore} className="text-money-pos hover:text-money-pos hover:bg-money-bgPos dark:text-money-posDark dark:hover:text-money-posDark dark:hover:bg-money-pos/15" aria-label="Save store name"><Save className="w-4 h-4"/></Button>
                               <Button variant="ghost" size="icon-sm" onClick={() => setEditingStoreId(null)} className="text-brand-400 hover:bg-brand-100/50 dark:hover:bg-brand-700/50" aria-label="Cancel editing"><X className="w-4 h-4"/></Button>
                             </div>
                           </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${(STORE_COLORS[store.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!).iconBg}`}>
                                    <StoreIcon className="w-4 h-4" />
                                </div>
                                <span className="font-medium text-brand-800 dark:text-brand-200">{store.name}</span>
                            </div>
                        )}

                        {editingStoreId !== store.id && (
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setEditingStoreId(store.id);
                                        setEditStoreName(store.name);
                                        setEditStoreColor(store.color || DEFAULT_STORE_COLOR);
                                    }}
                                    className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/30"
                                >
                                    <span className="text-xs font-medium">Edit</span>
                                </Button>
                                <Button
                                    variant="ghost-destructive"
                                    size="icon"
                                    onClick={() => handleDeleteStore(store.id)}
                                    aria-label={`Delete store ${store.name}`}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="space-y-6">
                <div className="bg-white p-4 rounded-xl border border-brand-200 dark:bg-brand-800 dark:border-brand-700">
                    <h4 className="text-sm font-bold text-brand-700 dark:text-brand-200 mb-3 uppercase tracking-wide">Add Category</h4>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                            placeholder="Category Name"
                            className="flex-1 p-2 border border-brand-300 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-500"
                        />
                        <Button
                            variant="primary"
                            onClick={addCategory}
                            disabled={!newCategoryName.trim()}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between pl-1">
                         <h4 className="text-sm font-bold text-brand-500 dark:text-brand-400 uppercase tracking-wide">Active Categories</h4>
                         <button
                            onClick={resetCategories}
                            className="text-xs text-brand-600 hover:underline flex items-center gap-1 dark:text-brand-300"
                         >
                            <RotateCcw className="w-3 h-3" /> Defaults
                         </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {localCategories.map(cat => (
                            <div key={cat} className="flex items-center gap-1 bg-white border border-brand-200 pl-3 pr-1 py-1.5 rounded-full text-sm dark:bg-brand-800 dark:border-brand-700">
                                <span className="text-brand-700 dark:text-brand-200 font-medium">{cat}</span>
                                <button
                                    onClick={() => removeCategory(cat)}
                                    className="p-1 text-brand-400 hover:text-money-neg hover:bg-money-bgNeg rounded-full transition-colors dark:text-brand-500 dark:hover:text-money-negDark dark:hover:bg-money-neg/15"
                                    aria-label={`Remove category ${cat}`}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
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

                  <div className="space-y-3">
                    {quickStockLists.map(list => {
                       const Icon = TEMPLATE_ICONS.find(i => i.id === list.icon)?.icon || ShoppingBag;
                       const color = STORE_COLORS[list.color || DEFAULT_STORE_COLOR] ?? STORE_COLORS[DEFAULT_STORE_COLOR]!; // DEFAULT_STORE_COLOR is always present

                       return (
                      <div key={list.id} className="bg-white p-4 rounded-xl border border-brand-200 flex items-center justify-between group dark:bg-brand-800 dark:border-brand-700">
                        <div className="flex items-center gap-3">
                           <div className={`w-10 h-10 rounded-full flex items-center justify-center ${color.bg} ${color.text}`}>
                              <Icon className="w-5 h-5" />
                           </div>
                           <div>
                              <h4 className="font-bold text-brand-800 dark:text-brand-200">{list.name}</h4>
                              <p className="text-xs text-brand-500 dark:text-brand-400">{list.items.length} items</p>
                           </div>
                        </div>
                        <div className="flex gap-2">
                           <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => setEditingTemplate(list)}
                             className="text-brand-400 hover:text-brand-600 hover:bg-brand-50 dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/30"
                           >
                             <span className="text-xs font-medium">Edit</span>
                           </Button>
                           <Button
                             variant="ghost-destructive"
                             size="icon"
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
                           >
                             <Trash2 className="w-4 h-4" />
                           </Button>
                        </div>
                      </div>
                    );
                    })}
                    {quickStockLists.length === 0 && (
                      <p className="text-center text-brand-400 dark:text-brand-500 text-sm py-4">No templates yet. Create one for &quot;Work Week&quot;, &quot;Camping&quot;, etc.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                     <h4 className="font-bold text-brand-800 dark:text-brand-200">{editingTemplate.id ? 'Edit Template' : 'New Template'}</h4>
                     <Button variant="ghost" size="icon-sm" onClick={() => setEditingTemplate(null)} aria-label="Close"><X className="w-5 h-5 text-brand-400 dark:text-brand-500" /></Button>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-brand-200 space-y-3 dark:bg-brand-800 dark:border-brand-700">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingTemplate.name}
                        onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})}
                        placeholder="Template Name (e.g. Weekly Basics)"
                        className="flex-1 p-2 border border-brand-300 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-500"
                        autoFocus
                      />
                    </div>

                    {/* Icon & Color Selection */}
                    <div className="flex flex-col gap-3 p-3 bg-brand-50 rounded-xl border border-brand-200 dark:bg-brand-700/30 dark:border-brand-700">
                         <div>
                            <span className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase mb-2 block">Icon</span>
                            <div className="flex gap-2 overflow-x-auto p-2 scrollbar-hide">
                                {TEMPLATE_ICONS.map(({ id, icon: Icon }) => (
                                    <button
                                        key={id}
                                        onClick={() => setEditingTemplate({...editingTemplate, icon: id})}
                                        className={`p-2 rounded-lg transition-colors duration-(--duration-fast) ease-(--ease-standard) shrink-0 ${
                                            (editingTemplate.icon || 'ShoppingBag') === id
                                                ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500 ring-offset-1 dark:bg-brand-700/40 dark:text-brand-200 dark:ring-offset-brand-800'
                                                : 'bg-white text-brand-400 hover:bg-brand-100/50 hover:text-brand-600 dark:bg-brand-700/50 dark:text-brand-400 dark:hover:bg-brand-700 dark:hover:text-brand-200'
                                        }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </button>
                                ))}
                            </div>
                         </div>
                         <div>
                            <span className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase mb-2 block">Color</span>
                            <div className="flex gap-2 overflow-x-auto p-2 scrollbar-hide">
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
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-400 dark:text-brand-500" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={e => setItemSearch(e.target.value)}
                        placeholder="Search or add new item..."
                        className="w-full pl-9 p-2 bg-brand-50/50 border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-500"
                      />
                    </div>

                    {/* Add New Item Action */}
                    {itemSearch.trim() && !groceryCatalog.some(i => i.name.toLowerCase() === itemSearch.trim().toLowerCase()) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCreateAndAddItem}
                            leftIcon={<Plus className="w-4 h-4" />}
                            className="w-full bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 border-dashed dark:bg-brand-700/30 dark:text-brand-200 dark:border-brand-500/40 dark:hover:bg-brand-700/50"
                        >
                            Create & Add &quot;{itemSearch}&quot;
                        </Button>
                    )}
                  </div>

                  <div className="space-y-1">
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
                            className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors bg-white border dark:bg-brand-800 ${
                              isSelected
                                ? 'border-brand-200 text-brand-800 dark:border-brand-500/40 dark:text-brand-200'
                                : 'border-brand-200 hover:bg-brand-50/50 text-brand-700 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-700/50'
                            }`}
                          >
                            <span>{item.name}</span>
                            {isSelected && <Check className="w-4 h-4 text-brand-600 dark:text-brand-300" />}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {activeTab === 'categories' && (
            <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
                <Button
                    variant="primary"
                    size="lg"
                    onClick={saveCategories}
                    disabled={!hasUnsavedCategoryChanges}
                    className="w-full"
                >
                    Save Category Changes
                </Button>
            </div>
        )}

        {activeTab === 'templates' && editingTemplate && (
            <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleSaveTemplate}
                  disabled={!editingTemplate.name?.trim()}
                  className="w-full"
                >
                  Save Template
                </Button>
            </div>
        )}

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

export default ShoppingSettingsModal;
