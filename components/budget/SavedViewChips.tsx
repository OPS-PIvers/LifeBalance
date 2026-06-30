import React, { useState, useEffect } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface SavedView {
  id: string;
  name: string;
  filters: {
    searchTerm: string;
    categoryFilter: string;
    sourceFilter: string;
  };
}

interface SavedViewChipsProps {
  householdId: string | null;
  currentFilters: {
    searchTerm: string;
    categoryFilter: string;
    sourceFilter: string;
  };
  onApply: (filters: { searchTerm: string; categoryFilter: string; sourceFilter: string }) => void;
}

const SavedViewChips: React.FC<SavedViewChipsProps> = ({ householdId, currentFilters, onApply }) => {
  // Use lazy initialization to load from localStorage
  const [views, setViews] = useState<SavedView[]>(() => {
    if (!householdId) return [];
    const key = `transaction_views_${householdId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse saved views', e);
      }
    }
    return [];
  });

  const [isSaving, setIsSaving] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [viewToDelete, setViewToDelete] = useState<string | null>(null);

  // Save to localStorage whenever views change
  useEffect(() => {
    if (!householdId) return;
    const key = `transaction_views_${householdId}`;
    localStorage.setItem(key, JSON.stringify(views));
  }, [views, householdId]);

  const handleSaveView = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newViewName.trim()) return;

    const newView: SavedView = {
      id: crypto.randomUUID(),
      name: newViewName.trim(),
      filters: { ...currentFilters }
    };

    setViews(prev => [...prev, newView]);
    setNewViewName('');
    setIsSaving(false);
    toast.success('View saved');
  };

  const handleDeleteView = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewToDelete(id);
  };

  const confirmDeleteView = () => {
    if (!viewToDelete) return;
    setViews(prev => prev.filter(v => v.id !== viewToDelete));
    toast.success('View deleted');
    setViewToDelete(null);
  };

  if (!householdId) return null;

  return (
    <>
    <ConfirmDialog
      isOpen={viewToDelete !== null}
      onClose={() => setViewToDelete(null)}
      onConfirm={confirmDeleteView}
      title="Delete Saved View"
      message="Delete this saved view?"
      confirmLabel="Delete"
      confirmVariant="destructive"
    />
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-brand-200 dark:border-brand-700 mt-2">
      <div className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wider flex items-center gap-1 mr-1">
        <Bookmark size={12} />
        <span>Views</span>
      </div>

      {views.map(view => (
        <div
          key={view.id}
          className="group inline-flex items-center bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-full text-xs font-medium text-brand-700 dark:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-700/50 hover:border-brand-300 dark:hover:border-brand-600 transition-all"
        >
          <button
            onClick={() => {
              onApply(view.filters);
              toast.success(`Applied "${view.name}"`);
            }}
            className="pl-3 pr-1 py-1 rounded-l-full hover:text-brand-900 dark:hover:text-brand-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-accent-500 focus:ring-offset-1"
            title={`Apply ${view.name}`}
          >
            {view.name}
          </button>
          <div className="w-px h-3 bg-brand-200 dark:bg-brand-700 mx-0.5" />
          <button
             type="button"
             onClick={(e) => handleDeleteView(view.id, e)}
             className="pr-2 pl-1 py-1 rounded-r-full text-brand-300 dark:text-brand-500 hover:text-money-neg dark:hover:text-money-negDark hover:bg-money-bgNeg dark:hover:bg-money-neg/15 transition-colors focus:outline-hidden focus:ring-2 focus:ring-money-neg focus:ring-offset-1"
             aria-label={`Delete view ${view.name}`}
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {isSaving ? (
        <form onSubmit={handleSaveView} className="flex items-center gap-1 animate-in fade-in zoom-in duration-200">
          <input
            type="text"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder="View Name..."
            className="w-32 px-2 py-1 text-xs border border-brand-300 dark:border-brand-700 dark:bg-brand-800 dark:text-brand-100 dark:placeholder:text-brand-500 rounded-btn focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
            autoFocus
            onBlur={() => !newViewName && setIsSaving(false)}
          />
          <button
            type="submit"
            disabled={!newViewName.trim()}
            className="p-1 bg-brand-600 text-white rounded-md disabled:opacity-50"
            aria-label="Confirm save view"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={() => setIsSaving(false)}
            className="p-1 text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300"
            aria-label="Cancel save view"
          >
            <X size={12} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setIsSaving(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-md transition-colors"
        >
          <Plus size={12} />
          <span>Save View</span>
        </button>
      )}
    </div>
    </>
  );
};

export default SavedViewChips;
