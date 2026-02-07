import React, { useState, useEffect } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Store as StoreIcon, Plus, Trash2, Save, RotateCcw, Search, Check, ShoppingBag, X } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import { QuickStockList } from '@/types/schema';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import toast from 'react-hot-toast';
import { Drawer } from '@/components/ui/Drawer';

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
  } = useHousehold();

  const [activeTab, setActiveTab] = useState<'stores' | 'categories' | 'templates'>('stores');

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

  const handleDeleteStore = async (id: string) => {
    toast((t) => (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Delete this store? Items will lose this tag.</span>
        <div className="flex justify-end gap-2">
          <button
            className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancel
          </button>
          <button
            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            onClick={async () => {
              toast.dismiss(t.id);
              await deleteStore(id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    ), { duration: 5000 });
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
    toast((t) => (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Reset to default categories?</span>
        <div className="flex justify-end gap-2">
          <button
            className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancel
          </button>
          <button
            className="px-2 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700"
            onClick={() => {
              toast.dismiss(t.id);
              setLocalCategories([...GROCERY_CATEGORIES]);
              setHasUnsavedCategoryChanges(true);
            }}
          >
            Reset
          </button>
        </div>
      </div>
    ), { duration: 5000 });
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Shopping List Settings"
      noPadding={true}
    >
      {/* Tabs */}
      <div className="flex p-2 gap-2 bg-slate-50 border-b border-slate-100">
          {(['stores', 'categories', 'templates'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">

          {activeTab === 'stores' && (
            <div className="space-y-6">
              {/* Add Store */}
              <div className="bg-white p-5 rounded-2xl shadow-sm ring-1 ring-black/5">
                <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Add New Store</h4>
                <form onSubmit={handleAddStore} className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {Object.values(STORE_COLORS).map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => setNewStoreColor(color.id)}
                        className={`w-8 h-8 rounded-full border-2 transition-all flex-shrink-0 ${color.bg} ${
                          newStoreColor === color.id ? 'border-brand-600 scale-110 shadow-md' : 'border-transparent hover:scale-105'
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
                      className="flex-1 p-3 bg-slate-50 border border-slate-200/60 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={!newStoreName.trim()}
                      className="bg-slate-900 text-white px-5 py-2 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200 flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>
                </form>
              </div>

              {/* Store List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">My Stores</h4>
                {stores.length === 0 ? (
                  <p className="text-sm text-slate-400 italic pl-1">No stores added yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {stores.map(store => (
                      <div key={store.id} className="bg-white p-3.5 rounded-xl shadow-sm ring-1 ring-black/5 flex items-center justify-between group hover:shadow-md transition-all">
                        {editingStoreId === store.id ? (
                           <div className="flex-1 space-y-2 mr-2">
                             <div className="flex gap-2 overflow-x-auto pb-1">
                                {Object.values(STORE_COLORS).map((color) => (
                                  <button
                                    key={color.id}
                                    type="button"
                                    onClick={() => setEditStoreColor(color.id)}
                                    className={`w-6 h-6 rounded-full border-2 transition-all flex-shrink-0 ${color.bg} ${
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
                                  className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none"
                               />
                               <button onClick={handleUpdateStore} className="text-green-600 p-2 hover:bg-green-50 rounded-lg" aria-label="Save store name"><Save className="w-4 h-4"/></button>
                               <button onClick={() => setEditingStoreId(null)} className="text-slate-400 p-2 hover:bg-slate-100 rounded-lg" aria-label="Cancel editing"><X className="w-4 h-4"/></button>
                             </div>
                           </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${(STORE_COLORS[store.color || DEFAULT_STORE_COLOR] || STORE_COLORS[DEFAULT_STORE_COLOR]).bg}`}>
                                    <StoreIcon className={`w-4 h-4 ${(STORE_COLORS[store.color || DEFAULT_STORE_COLOR] || STORE_COLORS[DEFAULT_STORE_COLOR]).text}`} />
                                </div>
                                <span className="font-bold text-slate-800 text-sm tracking-tight">{store.name}</span>
                            </div>
                        )}

                        {editingStoreId !== store.id && (
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => {
                                        setEditingStoreId(store.id);
                                        setEditStoreName(store.name);
                                        setEditStoreColor(store.color || DEFAULT_STORE_COLOR);
                                    }}
                                    className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                                >
                                    <span className="text-xs font-bold uppercase tracking-wider">Edit</span>
                                </button>
                                <button
                                    onClick={() => handleDeleteStore(store.id)}
                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    aria-label={`Delete store ${store.name}`}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
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
                <div className="bg-white p-5 rounded-2xl shadow-sm ring-1 ring-black/5">
                    <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Add Category</h4>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                            placeholder="Category Name"
                            className="flex-1 p-3 bg-slate-50 border border-slate-200/60 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all placeholder:text-slate-400"
                        />
                        <button
                            onClick={addCategory}
                            disabled={!newCategoryName.trim()}
                            className="bg-slate-900 text-white px-5 py-2 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between pl-1">
                         <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Categories</h4>
                         <button
                            onClick={resetCategories}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-brand-50 transition-colors"
                         >
                            <RotateCcw className="w-3 h-3" /> Defaults
                         </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {localCategories.map(cat => (
                            <div key={cat} className="flex items-center gap-1.5 bg-white border border-slate-200/60 pl-3.5 pr-1.5 py-1.5 rounded-full shadow-sm text-sm ring-1 ring-black/5">
                                <span className="text-slate-700 font-medium">{cat}</span>
                                <button
                                    onClick={() => removeCategory(cat)}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                    aria-label={`Remove category ${cat}`}
                                >
                                    <X className="w-3.5 h-3.5" />
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
                  <button
                    onClick={() => setEditingTemplate({ name: '', items: [], icon: 'ShoppingBag', color: DEFAULT_STORE_COLOR })}
                    className="w-full py-4 border-2 border-dashed border-slate-300/60 rounded-xl text-slate-500 font-medium hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/30 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Create New Template
                  </button>

                  <div className="space-y-3">
                    {quickStockLists.map(list => {
                       const Icon = TEMPLATE_ICONS.find(i => i.id === list.icon)?.icon || ShoppingBag;
                       const color = STORE_COLORS[list.color || DEFAULT_STORE_COLOR] || STORE_COLORS[DEFAULT_STORE_COLOR];

                       return (
                      <div key={list.id} className="bg-white p-4 rounded-xl shadow-sm ring-1 ring-black/5 flex items-center justify-between group hover:shadow-md transition-all">
                        <div className="flex items-center gap-4">
                           <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${color.bg} ${color.text}`}>
                              <Icon className="w-6 h-6" />
                           </div>
                           <div>
                              <h4 className="font-bold text-slate-900 tracking-tight">{list.name}</h4>
                              <p className="text-xs text-slate-500 font-medium">{list.items.length} items</p>
                           </div>
                        </div>
                        <div className="flex gap-2">
                           <button
                             onClick={() => setEditingTemplate(list)}
                             className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                           >
                             <span className="text-xs font-bold uppercase tracking-wider">Edit</span>
                           </button>
                           <button
                             onClick={() => {
                               toast((t) => (
                                 <div className="flex flex-col gap-2">
                                   <span className="text-sm font-medium">Delete template &quot;{list.name}&quot;?</span>
                                   <div className="flex justify-end gap-2">
                                     <button
                                       className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
                                       onClick={() => toast.dismiss(t.id)}
                                     >
                                       Cancel
                                     </button>
                                     <button
                                       className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                       onClick={async () => {
                                         toast.dismiss(t.id);
                                         await deleteQuickStockList(list.id);
                                         toast.success('Template deleted');
                                       }}
                                     >
                                       Delete
                                     </button>
                                   </div>
                                 </div>
                               ));
                             }}
                             className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                        </div>
                      </div>
                    );
                    })}
                    {quickStockLists.length === 0 && (
                      <p className="text-center text-slate-400 text-sm py-4">No templates yet. Create one for &quot;Work Week&quot;, &quot;Camping&quot;, etc.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                     <h4 className="font-bold text-slate-800 text-lg tracking-tight">{editingTemplate.id ? 'Edit Template' : 'New Template'}</h4>
                     <button onClick={() => setEditingTemplate(null)} aria-label="Close"><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
                  </div>

                  <div className="bg-white p-5 rounded-2xl shadow-sm ring-1 ring-black/5 space-y-4">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingTemplate.name}
                        onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})}
                        placeholder="Template Name (e.g. Weekly Basics)"
                        className="flex-1 p-3 bg-slate-50 border border-slate-200/60 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all placeholder:text-slate-400"
                        autoFocus
                      />
                    </div>

                    {/* Icon & Color Selection */}
                    <div className="flex flex-col gap-3 p-4 bg-slate-50/50 rounded-xl ring-1 ring-slate-200/60">
                         <div>
                            <span className="text-xs font-bold text-slate-400 uppercase mb-2.5 block tracking-wider">Icon</span>
                            <div className="flex gap-2 overflow-x-auto p-1 scrollbar-hide -ml-1">
                                {TEMPLATE_ICONS.map(({ id, icon: Icon }) => (
                                    <button
                                        key={id}
                                        onClick={() => setEditingTemplate({...editingTemplate, icon: id})}
                                        className={`p-2.5 rounded-xl transition-all shrink-0 ${
                                            (editingTemplate.icon || 'ShoppingBag') === id
                                                ? 'bg-white text-brand-700 shadow-md ring-1 ring-black/5 scale-105'
                                                : 'text-slate-400 hover:bg-white/60 hover:text-slate-600'
                                        }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </button>
                                ))}
                            </div>
                         </div>
                         <div>
                            <span className="text-xs font-bold text-slate-400 uppercase mb-2.5 block tracking-wider">Color</span>
                            <div className="flex gap-2 overflow-x-auto p-1 scrollbar-hide -ml-1">
                                {Object.values(STORE_COLORS).map((color) => (
                                    <button
                                        key={color.id}
                                        onClick={() => setEditingTemplate({...editingTemplate, color: color.id})}
                                        className={`w-7 h-7 rounded-full border-2 transition-all flex-shrink-0 ${color.bg} ${
                                            (editingTemplate.color || DEFAULT_STORE_COLOR) === color.id
                                                ? 'border-brand-600 scale-110 shadow-sm'
                                                : 'border-transparent hover:scale-105'
                                        }`}
                                    />
                                ))}
                            </div>
                         </div>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={e => setItemSearch(e.target.value)}
                        placeholder="Search or add new item..."
                        className="w-full pl-10 p-3 bg-slate-50 border border-slate-200/60 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all placeholder:text-slate-400"
                      />
                    </div>

                    {/* Add New Item Action */}
                    {itemSearch.trim() && !groceryCatalog.some(i => i.name.toLowerCase() === itemSearch.trim().toLowerCase()) && (
                        <button
                            onClick={handleCreateAndAddItem}
                            className="w-full flex items-center gap-2 p-3 bg-brand-50/50 text-brand-700 hover:bg-brand-100/50 rounded-xl text-sm font-bold transition-colors border border-brand-200/60 border-dashed justify-center"
                        >
                            <Plus className="w-4 h-4" />
                            Create & Add &quot;{itemSearch}&quot;
                        </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
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
                            className={`w-full flex items-center justify-between p-3 rounded-xl text-sm transition-all border ${
                              isSelected
                                ? 'bg-brand-50/50 border-brand-200 text-brand-900 shadow-sm'
                                : 'bg-white border-transparent hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <span className="font-medium">{item.name}</span>
                            {isSelected && <Check className="w-4 h-4 text-brand-600" />}
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
            <div className="p-4 border-t border-gray-100 bg-white">
                <button
                    onClick={saveCategories}
                    disabled={!hasUnsavedCategoryChanges}
                    className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                    Save Category Changes
                </button>
            </div>
        )}

        {activeTab === 'templates' && editingTemplate && (
            <div className="p-4 border-t border-gray-100 bg-white">
                <button
                  onClick={handleSaveTemplate}
                  disabled={!editingTemplate.name?.trim()}
                  className="w-full py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  Save Template
                </button>
            </div>
        )}
    </Drawer>
  );
};

export default ShoppingSettingsModal;
