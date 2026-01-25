import React, { useState, useEffect } from 'react';
import { Plus, X, Bookmark, Tag } from 'lucide-react';
import toast from 'react-hot-toast';

export interface SavedViewFilters {
  search: string;
  category: string;
  source: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
}

interface SavedViewChipsProps {
  currentFilters: SavedViewFilters;
  onApply: (filters: SavedViewFilters) => void;
  householdId: string | null;
}

export const SavedViewChips: React.FC<SavedViewChipsProps> = ({
  currentFilters,
  onApply,
  householdId
}) => {
  const storageKey = `transaction_views_${householdId || 'default'}`;

  // Initialize state lazily
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load saved views:', error);
      return [];
    }
  });

  // Update state when storageKey changes (e.g. user switch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSavedViews(JSON.parse(stored));
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSavedViews([]);
      }
    } catch (error) {
      console.error('Failed to load saved views:', error);
    }
  }, [storageKey]);

  // Save views to localStorage
  const persistViews = (views: SavedView[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(views));
      setSavedViews(views);
    } catch (error) {
      console.error('Failed to save views:', error);
      toast.error('Failed to save view');
    }
  };

  const handleSaveCurrent = () => {
    const name = window.prompt('Name this view (e.g., "Grocery Receipts"):');
    if (!name || !name.trim()) return;

    const newView: SavedView = {
      id: crypto.randomUUID(),
      name: name.trim(),
      filters: { ...currentFilters }
    };

    const updated = [...savedViews, newView];
    persistViews(updated);
    toast.success('View saved');
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this saved view?')) return;

    const updated = savedViews.filter(v => v.id !== id);
    persistViews(updated);
    toast.success('View deleted');
  };

  if (!householdId) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center mb-3">
      <span className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1">
        <Bookmark size={12} /> Saved Views
      </span>

      {savedViews.map(view => (
        <button
          key={view.id}
          onClick={() => {
            onApply(view.filters);
            toast.success(`Applied "${view.name}"`);
          }}
          className="group flex items-center gap-2 px-3 py-1 bg-white border border-brand-200 rounded-full text-xs font-medium text-brand-600 hover:bg-brand-50 hover:border-brand-300 transition-all active:scale-95 shadow-sm"
          title={`Search: ${view.filters.search || 'None'}, Cat: ${view.filters.category}, Src: ${view.filters.source}`}
        >
          <Tag size={12} className="text-brand-400 group-hover:text-brand-500" />
          {view.name}
          <div
            role="button"
            onClick={(e) => handleDelete(view.id, e)}
            className="ml-1 p-0.5 rounded-full hover:bg-rose-100 text-brand-300 hover:text-rose-500 transition-colors"
          >
            <X size={10} />
          </div>
        </button>
      ))}

      <button
        onClick={handleSaveCurrent}
        className="flex items-center gap-1 px-3 py-1 bg-brand-50 border border-brand-200 border-dashed rounded-full text-xs font-medium text-brand-500 hover:bg-brand-100 hover:text-brand-700 transition-all active:scale-95"
      >
        <Plus size={12} />
        Save Current
      </button>
    </div>
  );
};
