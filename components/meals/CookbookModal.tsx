import React, { useState, useMemo } from 'react';
import { Meal } from '@/types/schema';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Search, ChevronRight, Copy, X, ArrowUpAZ, Calendar, Star, ChefHat } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface CookbookModalProps {
  isOpen: boolean;
  onClose: () => void;
  meals: Meal[];
  onSelect: (meal: Meal) => void;
  onClone: (meal: Meal) => void;
}

type SortOption = 'name' | 'rating' | 'lastCooked';

export const CookbookModal: React.FC<CookbookModalProps> = ({
  isOpen,
  onClose,
  meals,
  onSelect,
  onClone
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('name');

  // Derive unique tags from all meals
  const allTags = useMemo(() => {
    if (!isOpen) return []; // Short-circuit if closed
    const tags = new Set<string>();
    meals.forEach(meal => {
      meal.tags?.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [meals, isOpen]);

  // Filter and Sort Logic
  const filteredMeals = useMemo(() => {
    if (!isOpen) return []; // Short-circuit if closed

    const lowerCaseSearchTerm = searchTerm.trim().toLowerCase();

    const filtered = meals.filter(meal => {
      // 1. Tag Filter (Fail fast)
      if (selectedTags.length > 0) {
        const hasAllTags = selectedTags.every(tag => meal.tags?.includes(tag));
        if (!hasAllTags) return false;
      }

      // 2. Search Filter
      if (lowerCaseSearchTerm) {
        const matchesName = meal.name.toLowerCase().includes(lowerCaseSearchTerm);
        const matchesDesc = meal.description?.toLowerCase().includes(lowerCaseSearchTerm);
        const matchesIng = meal.ingredients?.some(ing => ing.name.toLowerCase().includes(lowerCaseSearchTerm));

        if (!matchesName && !matchesDesc && !matchesIng) return false;
      }

      return true;
    });

    // 3. Sort
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'lastCooked':
           // If lastCooked is missing, treat as oldest
           if (!a.lastCooked) return 1;
           if (!b.lastCooked) return -1;
           return b.lastCooked.localeCompare(a.lastCooked);
        default:
          return 0;
      }
    });
  }, [meals, searchTerm, selectedTags, sortBy, isOpen]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg" ariaLabelledBy="cookbook-modal-title">
      <div className="flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-brand-100 p-2 rounded-lg text-brand-600">
                <ChefHat size={20} />
            </div>
            <div>
                <h3 id="cookbook-modal-title" className="text-lg font-bold text-slate-900 tracking-tight">Cookbook</h3>
                <p className="text-xs text-slate-500 font-medium">{filteredMeals.length} recipes found</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="px-6 py-4 space-y-3 bg-slate-50/50 border-b border-slate-100 shrink-0">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search recipes, ingredients..."
            icon={<Search size={16} />}
            className="bg-white"
          />

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
             {/* Sort Dropdown (Simplified as buttons for mobile friendliness) */}
             <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm shrink-0">
                <button
                    type="button"
                    onClick={() => setSortBy('name')}
                    className={`p-1.5 rounded-md transition-colors ${sortBy === 'name' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Name"
                    aria-label="Sort by Name"
                >
                    <ArrowUpAZ size={16} />
                </button>
                <button
                    type="button"
                    onClick={() => setSortBy('lastCooked')}
                    className={`p-1.5 rounded-md transition-colors ${sortBy === 'lastCooked' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Recently Cooked"
                    aria-label="Sort by Recently Cooked"
                >
                    <Calendar size={16} />
                </button>
                <button
                    type="button"
                    onClick={() => setSortBy('rating')}
                    className={`p-1.5 rounded-md transition-colors ${sortBy === 'rating' ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Rating"
                    aria-label="Sort by Rating"
                >
                    <Star size={16} />
                </button>
             </div>

             <div className="h-6 w-px bg-slate-200 mx-1 shrink-0" />

             {/* Tag Filters */}
             {allTags.map(tag => (
                <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={selectedTags.includes(tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors whitespace-nowrap ${
                        selectedTags.includes(tag)
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                    }`}
                >
                    {tag}
                </button>
             ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredMeals.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
                <p>No matching recipes found.</p>
                {(searchTerm || selectedTags.length > 0) && (
                    <button
                        onClick={() => { setSearchTerm(''); setSelectedTags([]); }}
                        className="text-brand-600 font-bold text-sm mt-2 hover:underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>
          ) : (
            filteredMeals.map(meal => (
                <div key={meal.id} className="flex items-stretch gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={() => onSelect(meal)}
                        className="flex-1 text-left p-4 hover:bg-slate-50/80 rounded-2xl border border-slate-200/60 bg-white shadow-sm hover:shadow-md transition-all group flex justify-between items-center"
                    >
                        <div>
                            <span className="font-bold text-slate-700 group-hover:text-brand-700 block mb-0.5">{meal.name}</span>
                            <div className="flex items-center gap-2">
                                {meal.rating && meal.rating > 0 ? (
                                    <div className="flex items-center text-xs text-amber-500 font-bold">
                                        <Star size={10} fill="currentColor" className="mr-0.5" /> {meal.rating}
                                    </div>
                                ) : null}
                                {meal.lastCooked && (
                                    <div className="text-xs text-slate-400">
                                        Last: {format(parseISO(meal.lastCooked), 'MMM d, yyyy')}
                                    </div>
                                )}
                                {meal.tags && meal.tags.length > 0 && (
                                    <div className="hidden sm:flex gap-1">
                                        {meal.tags.slice(0, 2).map(t => (
                                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md font-medium">{t}</span>
                                        ))}
                                        {meal.tags.length > 2 && <span className="text-[10px] text-slate-400">+{meal.tags.length - 2}</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-brand-400 transition-colors" />
                    </button>
                    <button
                        type="button"
                        aria-label="Clone as New Meal"
                        onClick={() => onClone(meal)}
                        className="px-4 text-slate-400 hover:text-brand-600 hover:bg-brand-50 border border-slate-200/60 bg-white hover:border-brand-200 rounded-2xl transition-colors shadow-sm"
                        title="Clone as New Meal"
                    >
                        <Copy className="w-5 h-5" />
                    </button>
                </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 shrink-0">
            <Button variant="secondary" onClick={onClose} className="w-full">
                Close
            </Button>
        </div>
      </div>
    </Modal>
  );
};
