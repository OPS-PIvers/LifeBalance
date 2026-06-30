import React, { useState, useMemo } from 'react';
import { Meal } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
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
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      ariaLabelledBy="cookbook-modal-title"
      header={
        <>
        {/* Title row */}
        <div className="px-6 py-4 border-b border-brand-200 dark:border-brand-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand-100 p-2 rounded-btn text-brand-600 dark:bg-brand-700/40 dark:text-brand-300">
                <ChefHat size={20} />
            </div>
            <div>
                <h3 id="cookbook-modal-title" className="font-display text-lg font-semibold text-brand-900 dark:text-brand-100 tracking-tight">Cookbook</h3>
                <p className="text-xs text-brand-500 dark:text-brand-400 font-medium">{filteredMeals.length} recipes found</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-full transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search & Filter Controls (stay fixed above the scrolling list) */}
        <div className="px-6 py-4 space-y-3 bg-brand-50 dark:bg-brand-800/40 border-b border-brand-200 dark:border-brand-700">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search recipes, ingredients..."
            icon={<Search size={16} />}
            className="bg-white dark:bg-brand-700/50"
          />

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
             {/* Sort Dropdown (Simplified as buttons for mobile friendliness) */}
             <SegmentedControl
                name="Sort recipes"
                value={sortBy}
                onChange={setSortBy}
                className="shrink-0"
                options={[
                    { value: 'name', label: <ArrowUpAZ size={16} aria-hidden="true" />, ariaLabel: 'Sort by Name' },
                    { value: 'lastCooked', label: <Calendar size={16} aria-hidden="true" />, ariaLabel: 'Sort by Recently Cooked' },
                    { value: 'rating', label: <Star size={16} aria-hidden="true" />, ariaLabel: 'Sort by Rating' },
                ]}
             />

             <div className="h-6 w-px bg-brand-200 dark:bg-brand-700 mx-1 shrink-0" />

             {/* Tag Filters */}
             {allTags.map(tag => (
                <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={selectedTags.includes(tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors whitespace-nowrap ${
                        selectedTags.includes(tag)
                        ? 'bg-accent-600 text-white border-accent-600'
                        : 'bg-white text-brand-600 border-brand-200 hover:border-brand-300 dark:bg-brand-700/50 dark:text-brand-300 dark:border-brand-600 dark:hover:border-brand-500/50'
                    }`}
                >
                    {tag}
                </button>
             ))}
          </div>
        </div>
        </>
      }
    >
        {/* List (single Drawer scroll container) */}
        <div className="p-4 space-y-2">
          {filteredMeals.length === 0 ? (
            <div className="text-center py-12 text-brand-400 dark:text-brand-500">
                <p>No matching recipes found.</p>
                {(searchTerm || selectedTags.length > 0) && (
                    <button
                        onClick={() => { setSearchTerm(''); setSelectedTags([]); }}
                        className="text-brand-600 font-bold text-sm mt-2 hover:underline dark:text-brand-300"
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
                        className="flex-1 text-left p-4 hover:bg-brand-50 rounded-2xl border border-brand-200 bg-white transition-colors duration-(--duration-fast) ease-(--ease-standard) group flex justify-between items-center dark:bg-brand-800 dark:border-brand-700 dark:hover:bg-brand-700/50"
                    >
                        <div>
                            <span className="font-bold text-brand-700 group-hover:text-brand-700 block mb-0.5 dark:text-brand-200 dark:group-hover:text-brand-300">{meal.name}</span>
                            <div className="flex items-center gap-2">
                                {meal.rating && meal.rating > 0 ? (
                                    <div className="flex items-center text-xs text-amber-500 dark:text-amber-400 font-bold">
                                        <Star size={10} fill="currentColor" className="mr-0.5" /> {meal.rating}
                                    </div>
                                ) : null}
                                {meal.lastCooked && (
                                    <div className="text-xs text-brand-400 dark:text-brand-500">
                                        Last: {format(parseISO(meal.lastCooked), 'MMM d, yyyy')}
                                    </div>
                                )}
                                {meal.tags && meal.tags.length > 0 && (
                                    <div className="hidden sm:flex gap-1">
                                        {meal.tags.slice(0, 2).map(t => (
                                            <Badge key={t} variant="neutral" size="sm">{t}</Badge>
                                        ))}
                                        {meal.tags.length > 2 && <span className="text-xxs text-brand-400 dark:text-brand-500">+{meal.tags.length - 2}</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-brand-300 group-hover:text-brand-400 transition-colors dark:text-brand-600 dark:group-hover:text-brand-400" />
                    </button>
                    <button
                        type="button"
                        aria-label="Clone as New Meal"
                        onClick={() => onClone(meal)}
                        className="px-4 text-brand-400 hover:text-brand-600 hover:bg-brand-50 border border-brand-200 bg-white hover:border-brand-200 rounded-2xl transition-colors dark:text-brand-500 dark:hover:text-brand-300 dark:hover:bg-brand-700/30 dark:border-brand-700 dark:bg-brand-800 dark:hover:border-brand-500/40"
                        title="Clone as New Meal"
                    >
                        <Copy className="w-5 h-5" />
                    </button>
                </div>
            ))
          )}
        </div>

        {/* Footer (flows after the list) */}
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800/40">
            <Button variant="secondary" onClick={onClose} className="w-full">
                Close
            </Button>
        </div>
    </Drawer>
  );
};
