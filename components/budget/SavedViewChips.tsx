import React, { useState, useEffect } from 'react';
import { Bookmark, Plus, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import CountBadge from '@/components/ui/CountBadge';

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

/**
 * Saved-view control for the transactions filter row. Renders a compact
 * bookmark icon (sized to sit beside the Filter / Select icons) that opens a
 * dropdown of saved filter presets — tap to apply, ✕ to delete, plus a
 * "Save current view" action. Nothing renders below the filter row, so an empty
 * preset list costs zero vertical space (previously a permanent "Save View" row
 * sat under the filters even with no saved views).
 */
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

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [viewToDelete, setViewToDelete] = useState<string | null>(null);

  // Save to localStorage whenever views change
  useEffect(() => {
    if (!householdId) return;
    const key = `transaction_views_${householdId}`;
    localStorage.setItem(key, JSON.stringify(views));
  }, [views, householdId]);

  const closeMenu = () => {
    setIsOpen(false);
    setIsSaving(false);
    setNewViewName('');
  };

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

  const handleDeleteView = (id: string) => {
    // Close the menu first so its focus trap doesn't fight the confirm dialog's.
    setIsOpen(false);
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

      <div className="relative shrink-0">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => (isOpen ? closeMenu() : setIsOpen(true))}
          aria-label={views.length > 0 ? `Saved views, ${views.length} saved` : 'Saved views'}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className="h-11 relative"
        >
          <Bookmark size={16} />
          <CountBadge count={views.length} className="bg-accent-600" />
        </Button>

        <Popover
          isOpen={isOpen}
          onClose={closeMenu}
          role="dialog"
          ariaLabel="Saved views"
          className="w-64 p-2"
        >
          <p className="px-2 pt-1 pb-2 text-xxs font-bold uppercase tracking-wider text-brand-400 dark:text-brand-450">
            Saved views
          </p>

          {views.length > 0 ? (
            <ul className="space-y-0.5">
              {views.map(view => (
                <li key={view.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(view.filters);
                      toast.success(`Applied "${view.name}"`);
                      closeMenu();
                    }}
                    className="min-w-0 flex-1 truncate rounded-btn px-2 py-2 text-left text-sm font-medium text-brand-700 dark:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                    title={`Apply ${view.name}`}
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteView(view.id)}
                    aria-label={`Delete view ${view.name}`}
                    className="shrink-0 rounded-btn p-2 text-brand-300 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark hover:bg-money-bgNeg dark:hover:bg-money-neg/15 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-money-neg/40"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-xs text-brand-400 dark:text-brand-450">
              No saved views yet.
            </p>
          )}

          <div className="my-1.5 h-px bg-brand-200 dark:bg-brand-700" />

          {isSaving ? (
            <form onSubmit={handleSaveView} className="flex items-center gap-1 px-1 pb-1">
              <input
                type="text"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="View name…"
                aria-label="View name"
                className="min-w-0 flex-1 rounded-btn border border-brand-300 px-2 py-1.5 text-sm dark:border-brand-700 dark:bg-brand-800 dark:text-brand-100 dark:placeholder:text-brand-450 focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!newViewName.trim()}
                className="shrink-0 rounded-btn bg-accent-600 p-2 text-white disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                aria-label="Confirm save view"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setIsSaving(false)}
                className="shrink-0 rounded-btn p-2 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40"
                aria-label="Cancel save view"
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsSaving(true)}
              className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-sm font-semibold text-accent-700 dark:text-accent-300 hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
            >
              <Plus size={14} />
              Save current view
            </button>
          )}
        </Popover>
      </div>
    </>
  );
};

export default SavedViewChips;
