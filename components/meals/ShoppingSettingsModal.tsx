/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Store as StoreIcon, Plus, Trash2, X, Save, RotateCcw } from 'lucide-react';
import { GROCERY_CATEGORIES } from '@/data/groceryCategories';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ShoppingSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    stores,
    addStore,
    updateStore,
    deleteStore,
    groceryCategories,
    updateGroceryCategories
  } = useHousehold();

  const [activeTab, setActiveTab] = useState<'stores' | 'categories'>('stores');

  // Store Form State
  const [newStoreName, setNewStoreName] = useState('');
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editStoreName, setEditStoreName] = useState('');

  // Category Form State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [localCategories, setLocalCategories] = useState<string[]>([]);
  const [hasUnsavedCategoryChanges, setHasUnsavedCategoryChanges] = useState(false);

  // Initialize local categories from context (or default if empty)
  useEffect(() => {
    if (isOpen) {
      if (groceryCategories && groceryCategories.length > 0) {
        setLocalCategories([...groceryCategories]);
      } else {
        setLocalCategories([...GROCERY_CATEGORIES]);
      }
      setHasUnsavedCategoryChanges(false);
    }
  }, [isOpen, groceryCategories]);

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

  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) return;

    await addStore({
      name: newStoreName.trim(),
      icon: 'Store' // Default icon for now
    });
    setNewStoreName('');
  };

  const handleUpdateStore = async () => {
    if (!editingStoreId || !editStoreName.trim()) return;

    // Find existing to preserve other fields
    const existing = stores.find(s => s.id === editingStoreId);
    if (!existing) return;

    await updateStore({
      ...existing,
      name: editStoreName.trim()
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        role="presentation"
      />

      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 bg-white">
          <h3 id="settings-title" className="text-lg font-bold text-gray-800">Shopping List Settings</h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setActiveTab('stores')}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'stores' ? 'text-brand-600 bg-brand-50/50' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            Stores
            {activeTab === 'stores' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'categories' ? 'text-brand-600 bg-brand-50/50' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            Categories
            {activeTab === 'categories' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50">

          {activeTab === 'stores' && (
            <div className="space-y-6">
              {/* Add Store */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">Add New Store</h4>
                <form onSubmit={handleAddStore} className="flex gap-2">
                  <input
                    type="text"
                    value={newStoreName}
                    onChange={(e) => setNewStoreName(e.target.value)}
                    placeholder="Store Name (e.g. Costco)"
                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!newStoreName.trim()}
                    className="bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                </form>
              </div>

              {/* Store List */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wide pl-1">My Stores</h4>
                {stores.length === 0 ? (
                  <p className="text-sm text-gray-400 italic pl-1">No stores added yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {stores.map(store => (
                      <div key={store.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between group">
                        {editingStoreId === store.id ? (
                           <div className="flex-1 flex gap-2 mr-2">
                             <input
                                autoFocus
                                type="text"
                                value={editStoreName}
                                onChange={e => setEditStoreName(e.target.value)}
                                className="flex-1 p-1.5 border border-brand-300 rounded text-sm outline-none"
                             />
                             <button onClick={handleUpdateStore} className="text-green-600 p-1 hover:bg-green-50 rounded"><Save className="w-4 h-4"/></button>
                             <button onClick={() => setEditingStoreId(null)} className="text-gray-400 p-1 hover:bg-gray-100 rounded"><X className="w-4 h-4"/></button>
                           </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-600">
                                    <StoreIcon className="w-4 h-4" />
                                </div>
                                <span className="font-medium text-gray-800">{store.name}</span>
                            </div>
                        )}

                        {editingStoreId !== store.id && (
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => {
                                        setEditingStoreId(store.id);
                                        setEditStoreName(store.name);
                                    }}
                                    className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                                >
                                    <span className="text-xs font-medium">Edit</span>
                                </button>
                                <button
                                    onClick={() => handleDeleteStore(store.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
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
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">Add Category</h4>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                            placeholder="Category Name"
                            className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                        />
                        <button
                            onClick={addCategory}
                            disabled={!newCategoryName.trim()}
                            className="bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between pl-1">
                         <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Active Categories</h4>
                         <button
                            onClick={resetCategories}
                            className="text-xs text-brand-600 hover:underline flex items-center gap-1"
                         >
                            <RotateCcw className="w-3 h-3" /> Defaults
                         </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {localCategories.map(cat => (
                            <div key={cat} className="flex items-center gap-1 bg-white border border-gray-200 pl-3 pr-1 py-1.5 rounded-full shadow-sm text-sm">
                                <span className="text-gray-700 font-medium">{cat}</span>
                                <button
                                    onClick={() => removeCategory(cat)}
                                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
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
      </div>
    </div>
  );
};

export default ShoppingSettingsModal;
