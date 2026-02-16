import React, { useState, useEffect } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';

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
    if (window.confirm('Delete this saved view?')) {
      setViews(prev => prev.filter(v => v.id !== id));
      toast.success('View deleted');
    }
  };

  if (!householdId) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100/50 mt-2">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1">
        <Bookmark size={12} />
        <span>Views</span>
      </div>

      {views.map(view => (
        <div
          key={view.id}
          className="group inline-flex items-center bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-full text-xs font-medium text-slate-600 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all ring-1 ring-black/5"
        >
          <button
            onClick={() => {
              onApply(view.filters);
              toast.success(`Applied "${view.name}"`);
            }}
            className="pl-3 pr-1 py-1 rounded-l-full hover:text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
            title={`Apply ${view.name}`}
          >
            {view.name}
          </button>
          <div className="w-px h-3 bg-slate-200 mx-0.5" />
          <button
             type="button"
             onClick={(e) => handleDeleteView(view.id, e)}
             className="pr-2 pl-1 py-1 rounded-r-full text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1"
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
            className="w-32 px-2 py-1 text-xs bg-white/50 backdrop-blur-sm border border-slate-300/50 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-500 text-slate-700 placeholder:text-slate-400"
            autoFocus
            onBlur={() => !newViewName && setIsSaving(false)}
          />
          <button
            type="submit"
            disabled={!newViewName.trim()}
            className="p-1 bg-slate-800 text-white rounded-md disabled:opacity-50 hover:bg-slate-700 transition-colors"
            aria-label="Confirm save view"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={() => setIsSaving(false)}
            className="p-1 text-slate-400 hover:text-slate-600"
            aria-label="Cancel save view"
          >
            <X size={12} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setIsSaving(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
        >
          <Plus size={12} />
          <span>Save View</span>
        </button>
      )}
    </div>
  );
};

export default SavedViewChips;
