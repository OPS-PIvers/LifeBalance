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
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-brand-100 mt-2">
      <div className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1 mr-1">
        <Bookmark size={12} />
        <span>Views</span>
      </div>

      {views.map(view => (
        <button
          key={view.id}
          onClick={() => {
            onApply(view.filters);
            toast.success(`Applied "${view.name}"`);
          }}
          className="group flex items-center gap-1.5 pl-3 pr-2 py-1 bg-white border border-brand-200 rounded-full text-xs font-medium text-brand-700 hover:bg-brand-50 hover:border-brand-300 transition-all active:scale-95"
          title={`Apply ${view.name}`}
        >
          <span>{view.name}</span>
          <div
             role="button"
             onClick={(e) => handleDeleteView(view.id, e)}
             className="p-0.5 rounded-full hover:bg-red-100 text-brand-300 hover:text-red-500 transition-colors"
          >
            <X size={10} />
          </div>
        </button>
      ))}

      {isSaving ? (
        <form onSubmit={handleSaveView} className="flex items-center gap-1 animate-in fade-in zoom-in duration-200">
          <input
            type="text"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder="View Name..."
            className="w-32 px-2 py-1 text-xs border border-brand-300 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
            onBlur={() => !newViewName && setIsSaving(false)}
          />
          <button
            type="submit"
            disabled={!newViewName.trim()}
            className="p-1 bg-brand-600 text-white rounded-md disabled:opacity-50"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={() => setIsSaving(false)}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={12} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setIsSaving(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-500 hover:text-brand-700 hover:bg-brand-50 rounded-md transition-colors"
        >
          <Plus size={12} />
          <span>Save View</span>
        </button>
      )}
    </div>
  );
};

export default SavedViewChips;
